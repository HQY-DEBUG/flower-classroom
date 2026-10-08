#!/usr/bin/env python3
"""Select and bind RC15 folder-release evidence, without rerunning any tests.

Run only after the coordinator has finished all required runs.  --check-only
performs the same gates without creating final evidence.  Publication is
write-once: existing final manifests are never silently replaced.

Optional --retests JSON is {"replacements": [{"group": "...", "mode":
"source|packaged", "proof": ".../runs.json", "suite": "...",
"evidenceFiles": [".../results.json"], "initialEvidenceFiles": [".../failed.json"],
"reason": "..."}]}.  A replacement
must select one real, dated, successful row from a current-freeze proof.  The
original attempt remains in the final execution record and is not counted.
"""
from pathlib import Path
import argparse
import copy
import datetime as dt
import hashlib
import json
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifacts/rc15'
VERSION = '1.3.0-rc.15'
ASAR = ROOT / 'dist-rc15-final/win-unpacked/resources/app.asar'
EXPECTED_ASAR = '193ae2b1be926229478b41dad5abf6222e6c7ca2df5e7d53e04b34aa85ee064a'
EXPECTED_FOLDER = '45aa76715e4e85921aca2d52d920274d2884ca0e1077575b9f9b7d447c3c33cd'
WINDOWS_ITEMS = ['V033', 'V035', 'V037', 'V038', 'V052', 'V054', 'V067', 'R14-W01', 'R14-W02']


class GateError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def path(value):
    value = Path(value)
    return value if value.is_absolute() else ROOT / value


def rel(value):
    value = path(value).resolve()
    try:
        return value.relative_to(ROOT).as_posix()
    except ValueError:
        return str(value)


def read(value):
    p = path(value)
    require(p.is_file(), f'Missing evidence: {rel(p)}. Finish this run before finalizing.')
    try:
        return json.loads(p.read_text())
    except (ValueError, OSError) as error:
        raise GateError(f'Cannot read complete JSON evidence {rel(p)}: {error}') from error


def sha(value):
    p = path(value)
    require(p.is_file(), f'Missing file: {rel(p)}')
    h = hashlib.sha256()
    with p.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def timestamp(value, context):
    require(isinstance(value, str), f'{context}: missing original execution timestamp')
    try:
        parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError as error:
        raise GateError(f'{context}: invalid timestamp {value!r}') from error
    require(parsed.tzinfo is not None, f'{context}: timestamp has no timezone')
    return parsed


def hashes_normalized(values):
    require(isinstance(values, dict) and values, 'Empty source hash map in binding proof')
    return {('src/' + n if '/' not in n else n): h for n, h in values.items()}


def collect_checks(value, pointer=''):
    """Only count selected assertion leaves, never a summary and its children."""
    if isinstance(value, list):
        return [v for i, item in enumerate(value) for v in collect_checks(item, pointer + '/' + str(i))]
    if not isinstance(value, dict):
        return []
    if isinstance(value.get('checks'), list):
        return collect_checks(value['checks'], pointer + '/checks')
    if value.get('status') in ['passed', 'failed', 'observed', 'skipped', 'unverified']:
        return [(pointer, value)]
    for key in ['results', 'runs', 'report', 'result']:
        if isinstance(value.get(key), (list, dict)):
            return collect_checks(value[key], pointer + '/' + key)
    if isinstance(value.get('passed'), bool):
        return [(pointer, {'name': value.get('phase', 'Case passed'),
                           'status': 'passed' if value['passed'] else 'failed'})]
    if 'stateEqual' in value and 'transientModalsAbsent' in value:
        return [(pointer, {'name': 'Fresh process exact state and no transient modals',
                           'status': 'passed' if value['stateEqual'] and value['transientModalsAbsent'] else 'failed'})]
    return []


def nested_execution_gate(value, context):
    """Reject failed subprocesses even if a partial report has passing checks."""
    if isinstance(value, list):
        for i, item in enumerate(value):
            nested_execution_gate(item, f'{context}/{i}')
    elif isinstance(value, dict):
        expected_rule_crash = (value.get('passed') is True and value.get('phase') in ['before-json-crash', 'after-json-crash']
                               and value.get('signal') == 'SIGKILL' and value.get('exitCode') is None)
        expected_storage_crash = (value.get('phase') == 'terminate'
                                  and value.get('boundary') in ['temp-fsynced', 'before-rename', 'after-rename', 'before-notify']
                                  and value.get('expectedSignal') == value.get('signal') == 'SIGKILL'
                                  and 'expectedExit' in value and value['expectedExit'] is None and value.get('exitCode') is None)
        expected_crash = expected_rule_crash or expected_storage_crash
        if 'exitCode' in value and not expected_crash:
            require(value['exitCode'] == 0, f'{context}: subprocess exitCode={value["exitCode"]}')
        if 'code' in value and isinstance(value['code'], (int, type(None))) and ('phase' in value or 'result' in value):
            require(value['code'] == 0, f'{context}: subprocess code={value["code"]}')
        require(not value.get('fatal'), f'{context}: fatal report: {value.get("fatal")}')
        for key in ['results', 'runs', 'report', 'result', 'restarts']:
            if isinstance(value.get(key), (dict, list)):
                nested_execution_gate(value[key], f'{context}/{key}')


class Finalizer:
    def __init__(self, args):
        self.args = args
        self.freeze = read(OUT / 'frozen-source.json')
        require(self.freeze.get('candidateVersion') == VERSION, 'Wrong frozen candidate version')
        self.frozen_at = timestamp(self.freeze['frozenAt'], 'frozen source')
        self.freeze_sha = sha(OUT / 'frozen-source.json')
        self.source = self.freeze['files']
        self.all_frozen = {}
        for key in ['files', 'assetFiles', 'packageFiles', 'packagedDocuments']:
            self.all_frozen.update(self.freeze[key])
        self.groups = []
        self.selected = set()
        self.outputs = {}
        self.proofs = {}
        self.check_names = {}
        self.overrides = {}
        self.used_overrides = set()
        if args.retests:
            replacements = read(args.retests).get('replacements', [])
            for item in replacements:
                key = (item['mode'], item['group'])
                require(key not in self.overrides, f'Duplicate explicit retest: {key}')
                require(item.get('reason'), f'Retest {key} needs an explanation')
                self.overrides[key] = item

    def current_files_gate(self):
        actual_src = {rel(p) for p in (ROOT / 'src').iterdir() if p.is_file()}
        actual_assets = {rel(p) for p in (ROOT / 'assets').rglob('*') if p.is_file()}
        require(actual_src == set(self.source), 'Runtime source file set differs from freeze')
        require(actual_assets == set(self.freeze['assetFiles']), 'Asset file set differs from freeze')
        for name, expected in self.all_frozen.items():
            require(sha(name) == expected, f'Frozen file changed: {name}. Refreeze/rebuild/retest; do not reuse these results.')
        require(sha(ASAR) == EXPECTED_ASAR, 'Final ASAR differs from the approved freeze3 artifact')

    def times(self, row, context):
        started = row.get('startedAt')
        ended = row.get('completedAt', row.get('finishedAt'))
        start, end = timestamp(started, context), timestamp(ended, context)
        require(self.frozen_at <= start <= end, f'{context}: execution predates current freeze or dates are reversed')
        return started, ended

    def source_map_gate(self, values, context, complete=True):
        normalized = hashes_normalized(values)
        relevant = {n: h for n, h in normalized.items() if n in self.all_frozen}
        require(relevant, f'{context}: hash map contains no frozen runtime files')
        for n, h in relevant.items():
            require(h == self.all_frozen[n], f'{context}: stale source/asset hash for {n}')
        if complete:
            require(set(self.source) <= set(relevant), f'{context}: incomplete runtime hash map')
        return relevant

    def proof(self, proof_path, mode):
        key = (rel(proof_path), mode)
        if key in self.proofs:
            return self.proofs[key]
        d = read(proof_path)
        require(isinstance(d, dict), f'{rel(proof_path)}: proof must be an object')
        if d.get('frozenAt') is not None:
            require(d['frozenAt'] == self.freeze['frozenAt'], f'{rel(proof_path)}: wrong freeze timestamp')
        if d.get('sourceManifestSha256') is not None:
            require(d['sourceManifestSha256'] == self.freeze_sha, f'{rel(proof_path)}: frozen-manifest digest mismatch')
        matched_source = False
        for first, last in [('sourceAtStart', 'sourceAtFinish'), ('sourceBefore', 'sourceAfter')]:
            if first in d and last in d:
                a = self.source_map_gate(d[first], rel(proof_path) + '/' + first)
                b = self.source_map_gate(d[last], rel(proof_path) + '/' + last)
                require(a == b and d.get('sourceUnchanged') is True, f'{rel(proof_path)}: source changed during run')
                matched_source = True
        if 'sourceFiles' in d and isinstance(d['sourceFiles'], dict):
            self.source_map_gate(d['sourceFiles'], rel(proof_path) + '/sourceFiles')
            require(d.get('sourceUnchanged') is True, f'{rel(proof_path)}: no before/after equality assertion')
            matched_source = True
        if d.get('frozenAt') == self.freeze['frozenAt'] and d.get('sourceUnchanged') is True:
            # The focused/retest runners verify every frozen byte before and after.
            matched_source = True
        if mode == 'source':
            require(matched_source, f'{rel(proof_path)}: no current frozen-source before/after binding')
        else:
            digests = [d[k] for k in ['asarSha256', 'archiveSha256', 'asarSha256Before', 'asarSha256After', 'isolatedArchiveSha256'] if d.get(k)]
            require(digests and all(h == EXPECTED_ASAR for h in digests), f'{rel(proof_path)}: missing/stale production ASAR binding')
            if 'asarUnchanged' in d:
                require(d['asarUnchanged'] is True, f'{rel(proof_path)}: ASAR changed during run')
        self.proofs[key] = d
        return d

    def execution(self, row, context):
        require(row.get('exitCode') == 0, f'{context}: selected attempt failed with exitCode={row.get("exitCode")}; retain it and provide an explicit current retest')
        require(row.get('scriptUnchanged', True) is True, f'{context}: harness changed during execution')
        self.times(row, context)
        for key in ['scriptSha256', 'scriptSha256AtFinish']:
            if row.get(key) and row.get('script'):
                require(sha(row['script']) == row[key], f'{context}: recorded harness differs from current script {row["script"]}')

    def choose(self, group, mode, original, evidence, proof_path):
        selected = copy.deepcopy(original)
        selected['resultFiles'] = [rel(p) for p in evidence]
        selected['originalBindingProof'] = rel(proof_path)
        selected.setdefault('originalExecutionFile', rel(proof_path))
        key = (mode, group)
        if key in self.overrides:
            o = self.overrides[key]
            pd = self.proof(o['proof'], mode)
            candidates = pd.get('suites', pd.get('results', [pd]))
            matches = [r for r in candidates if r.get('suite') == o['suite'] and r.get('mode', pd.get('mode', mode)) == mode]
            require(len(matches) == 1, f'Retest {key}: expected exactly one matching execution row in {o["proof"]}')
            selected = copy.deepcopy(matches[0])
            if not isinstance(pd.get('suites', pd.get('results')), list):
                selected['executionRecordKind'] = 'top-level'
            require(timestamp(selected.get('startedAt'), f'Retest {key}') >= timestamp(original.get('completedAt', original.get('finishedAt')), f'Initial attempt {key}'),
                    f'Retest {key}: replacement ran before the initial attempt finished; a later failure cannot be hidden by an earlier pass')
            selected['initialAttempt'] = copy.deepcopy(original)
            selected['initialAttempt']['resultPathsAtExecution'] = [rel(p) for p in evidence]
            selected['initialAttempt']['originalBindingProof'] = rel(proof_path)
            historical = o.get('initialEvidenceFiles', [])
            selected['initialAttempt']['resultFiles'] = [rel(p) for p in historical]
            selected['initialAttempt']['evidenceSha256'] = {rel(p): sha(p) for p in historical}
            if original.get('log'):
                selected['initialAttempt']['logSha256'] = sha(original['log'])
            selected['initialAttempt']['resultPreservation'] = 'Original failure result copy retained' if historical else 'Original execution row and log retained; canonical result paths may have been superseded by the retest'
            selected['selectionReason'] = o['reason']
            selected['resultFiles'] = [rel(p) for p in o['evidenceFiles']]
            selected['originalBindingProof'] = rel(o['proof'])
            selected['originalExecutionFile'] = rel(o['proof'])
            self.used_overrides.add(key)
        self.execution(selected, f'{mode}/{group}')
        return selected

    def add(self, name, mode, row, binding, category='regression', checks=None):
        start, end = self.times(row, f'{mode}/{name}')
        count = observations = 0
        names = []
        fingerprints = {}
        for result_file in row['resultFiles']:
            result_path = path(result_file)
            fingerprints[rel(result_path)] = sha(result_path)
            modified = dt.datetime.fromtimestamp(result_path.stat().st_mtime, dt.timezone.utc)
            require(timestamp(start, name) - dt.timedelta(seconds=2) <= modified <= timestamp(end, name) + dt.timedelta(seconds=2),
                    f'{result_file}: result file was not produced within the selected original execution interval; select the actual current run or preserve its original result file')
            if checks is None:
                data = read(result_path)
                nested_execution_gate(data, result_file)
                found = collect_checks(data)
            else:
                found = checks
            require(found, f'{result_file}: no assertion rows found; refuse to invent a count')
            for pointer, check in found:
                identity = (str(result_path.resolve()), pointer)
                require(identity not in self.selected, f'Duplicate selected assertion: {result_file}#{pointer}')
                self.selected.add(identity)
                status = check.get('status')
                observed = status == 'observed' or check.get('name', '').startswith('Workbook format observation:')
                require(status in ['passed', 'observed'], f'{mode}/{name}: {result_file}#{pointer} failed/unverified: {check.get("name", "unnamed")} ({status})')
                if observed:
                    observations += 1
                else:
                    count += 1
                    names.append(check.get('name', ''))
        self.check_names[(mode, name)] = names
        group = {'group': name, 'suite': row['suite'], 'mode': mode, 'category': category,
                 'passed': count, 'observations': observations, 'failed': 0,
                 'evidenceFiles': row['resultFiles'], 'evidenceSha256': fingerprints,
                 'bindingProof': rel(binding), 'originalBindingProof': row.get('originalBindingProof', rel(binding)),
                 'executionLocator': {'file': row.get('originalExecutionFile', row.get('originalBindingProof', rel(binding))),
                                      'suite': row.get('originalSuite', row['suite']), 'mode': mode,
                                      'recordKind': row.get('executionRecordKind', 'suite-row')},
                 'startedAt': start, 'completedAt': end, 'windowsExecuted': False,
                 'execution': row}
        self.groups.append(group)
        return group

    def regular(self):
        old = read('artifacts/rc13/report/final-config.json')
        paths = {v['id']: v['file'].replace('artifacts/rc13/source-evidence/', 'artifacts/').replace('artifacts/rc13/', 'artifacts/rc15/')
                 for v in old['runs'] if v.get('bindingScope') == 'source'}
        paths['source-adversarial'] = 'artifacts/rc9/adversarial-source/results.json'
        names = {'primary': 'known-flows', 'care': 'pet-care', 'switch': 'pet-switch', 'petextra': 'pet-extra'}
        source_rows = read(OUT / 'source-runs.json')
        package_record = read(OUT / 'packaged-runs.json')
        require(len(source_rows) == 26 and len(package_record['results']) == 24, 'Regular suite set incomplete: expected 26 source and 24 packaged executions')
        for mode, rows in [('source', source_rows), ('packaged', package_record['results'])]:
            proof_path = OUT / f'{mode}-run-binding.json'
            proof = self.proof(proof_path, mode)
            if mode == 'packaged':
                require(package_record.get('asarSha256') == EXPECTED_ASAR, 'Regular package run recorded another ASAR')
                isolated = package_record.get('isolatedMain', '').split('/src/main.cjs')[0]
                require(isolated.endswith('.asar') and sha(isolated) == EXPECTED_ASAR, 'Retained isolated regular-run ASAR differs from final package')
            output = OUT / f'{mode}-final-runs.json'
            final_rows = []
            package_paths = read('artifacts/rc10/recovery/package-paths.json') if mode == 'packaged' else {}
            require(len({row['suite'] for row in rows}) == len(rows), f'{mode}: duplicate regular execution suite')
            for original in rows:
                original = {**original, 'originalExecutionFile': f'artifacts/rc15/{mode}-runs.json'}
                suite = original['suite']
                name = 'source-' + names.get(suite, suite) if mode == 'source' else suite
                evidence = [original['log']] if suite == 'unit' else [paths[name] if mode == 'source' else package_paths[suite]]
                row = self.choose(name, mode, original, evidence, proof_path)
                # Original proof envelope must cover the genuine original run.
                if 'startedAt' in proof and 'completedAt' in proof:
                    a, b = self.times(original, f'{mode}/{suite} initial')
                    require(timestamp(proof['startedAt'], 'regular envelope') <= timestamp(a, suite) and timestamp(b, suite) <= timestamp(proof['completedAt'], 'regular envelope'), f'{mode}/{suite}: execution outside original binding envelope')
                if suite == 'unit':
                    passed, checks = self.node_log(row['resultFiles'][0])
                    self.add(name, mode, row, output, 'node', checks)
                    self.source_node = passed
                else:
                    self.add(name, mode, row, output)
                final_rows.append(row)
            self.outputs[rel(output)] = final_rows if mode == 'source' else {**package_record, 'results': final_rows, 'bindingProof': rel(proof_path)}

    def node_log(self, filename):
        content = path(filename).read_text()
        totals = re.findall(r'(?:ℹ|#) pass (\d+)', content)
        failures = re.findall(r'(?:ℹ|#) fail (\d+)', content)
        require(totals and failures and int(failures[-1]) == 0, f'{filename}: missing or failed Node test summary')
        passed = int(totals[-1])
        # Node logs are assertion evidence. Preserve each actual test-name line.
        names = re.findall(r'^\s*(?:✔|ok \d+ -) (.+?)(?: \([\d.]+ms\))?$', content, re.M)
        require(len(names) == passed, f'{filename}: {len(names)} actual successful test rows disagree with summary {passed}')
        return passed, [(f'/tests/{i}', {'name': name, 'status': 'passed'}) for i, name in enumerate(names)]

    def suite_paths(self, stem, kind, row, base):
        directory = path(row.get('evidenceDirectory') or (Path(row['result']).parent if row.get('result') else base / kind))
        if kind in ['confirmations', 'target-confirmations']:
            run = read(directory / 'run.json')
            require(run.get('status') == 0 and all(v.get('status') == 0 for v in run['restarts']), f'{directory}: confirmation/restart subprocess failed')
            return [directory / 'flows.json'] + [directory / ('restart-' + x['name'] + '.json') for x in run['restarts']]
        if stem == 'new-targeted' and kind in ['transactions', 'startup-restore', 'missed-restore-notice']:
            run = read(directory / 'run.json')
            require(all(v.get('status') == 0 for v in run['runs']), f'{directory}: transaction phase failed')
            return [directory / (x['phase'] + '.json') for x in run['runs']]
        if stem == 'rc14-inherited':
            return [base / {'feature': 'results.json', 'crash-recovery': 'restart-results.json', 'response-loss': 'response-loss/result.json'}[kind]]
        results = [directory / 'results.json']
        if (stem == 'new-targeted' and kind == 'queued-restore') or (stem == 'rc13-inherited' and kind in ['feedback', 'cross-feature']):
            results.append(directory / 'restart.json')
        if stem == 'features' and kind == 'egg-comprehensive':
            results.append(directory / 'restart-result.json')
        return results

    def targeted(self):
        expected = {
            'legacy-targeted': ['cross-panel', 'destructive', 'imports', 'pets', 'receipts', 'modals', 'async-modals'],
            'new-targeted': ['storage', 'crash', 'transactions', 'ui', 'independent-ui', 'restore-toolbox', 'restore-classroom', 'queued-restore', 'startup-restore', 'missed-restore-notice'],
            'features': ['egg', 'avatars', 'avatar-import', 'egg-comprehensive', 'avatar-comprehensive', 'pet-feedback', 'keyboard'],
            'extension': ['rc12-review', 'rc12-tools', 'rc12-import', 'rc12-format', 'rc12-text', 'target-confirmations', 'album-refresh'],
            'rc13-inherited': ['confirmations', 'roster', 'roster-exact', 'feedback', 'cross-feature'],
            'focused': ['score-editor', 'avatar-access'],
            'rc14-inherited': ['feature', 'crash-recovery', 'response-loss'],
        }
        for mode in ['source', 'packaged']:
            for stem, required in expected.items():
                base = OUT / f'{stem}-{mode}'
                run = self.proof(base / 'runs.json', mode)
                rows = run['suites']
                require(sorted(v['suite'] for v in rows) == sorted(required), f'{base}: missing/duplicate suite; required {required}')
                final_rows = []
                for original in rows:
                    kind = original['suite']
                    name = ('rc14-' if stem == 'focused' else stem + '-') + kind
                    evidence = self.suite_paths(stem, kind, original, base)
                    row = self.choose(name, mode, original, evidence, base / 'runs.json')
                    self.add(name, mode, row, base / 'final-runs.json')
                    final_rows.append(row)
                self.outputs[rel(base / 'final-runs.json')] = {**run, 'suites': final_rows}

    def independent(self):
        for mode, suffix in [('source', 'final-source'), ('packaged', 'final-asar')]:
            base = ROOT / 'artifacts/rc15-independent-review' / suffix
            proof_path = base / 'run-manifest.json'
            run = self.proof(proof_path, mode)
            required = ['modules', 'runtime', 'migration', 'migration-ipc'] + (['package'] if mode == 'packaged' else [])
            require(sorted(v['suite'] for v in run['results']) == sorted(required), f'{proof_path}: independent suite set incomplete')
            for original in run['results']:
                name = 'rc15-independent-' + original['suite']
                row = self.choose(name, mode, original, [original['report']], proof_path)
                self.add(name, mode, row, proof_path)
            folder_file = OUT / f'folder-ui-{mode}/results.json'
            folder = read(folder_file)
            if mode == 'source':
                self.source_map_gate(folder['startHashes'], rel(folder_file) + '/startHashes', complete=False)
                self.source_map_gate(folder['endHashes'], rel(folder_file) + '/endHashes', complete=False)
            require(folder['startHashes'] == folder['endHashes'] and folder.get('codeUnchanged') is True, f'{folder_file}: folder UI code changed during run')
            require(folder.get('sourceUnchanged') is True, f'{folder_file}: original migration fixture changed')
            if mode == 'packaged':
                hashes = [v for k, v in folder['startHashes'].items() if 'asar' in k.lower()]
                require(EXPECTED_ASAR in hashes, f'{folder_file}: missing actual ASAR start/end fingerprint')
            row = {'suite': 'folder-ui', 'executionRecordKind': 'top-level', 'startedAt': folder['startedAt'], 'completedAt': folder['finishedAt'], 'exitCode': 0, 'resultFiles': [rel(folder_file)], 'originalBindingProof': rel(folder_file)}
            nested_execution_gate(folder, rel(folder_file))
            self.add('rc15-folder-ui', mode, row, folder_file)

    def supplemental(self):
        package_file = OUT / 'package-unit/results.json'
        package = read(package_file)
        require(package.get('asarSha256') == EXPECTED_ASAR and package.get('failed') == 0, 'Extracted package Node tests failed or belong to another ASAR')
        require(package.get('sourceFilesEqual') == len(self.source), 'Extracted package unit source file set mismatch')
        self.execution(package, 'package Node')
        passed, checks = self.node_log('artifacts/rc15/package-unit/run.log')
        require(passed == package['passed'], 'Package unit report does not match actual Node log rows')
        excluded = package.get('excludedSourceOnlyTests', [])
        require(excluded == ['preview-target-generation-rc13.test.cjs'] and passed == self.source_node - 1, 'Unexpected source/package Node coverage difference')
        row = {**package, 'suite': 'package-unit', 'executionRecordKind': 'top-level', 'resultFiles': ['artifacts/rc15/package-unit/run.log'], 'originalBindingProof': rel(package_file)}
        self.add('package-unit', 'packaged', row, package_file, 'node', checks)
        self.package_node = passed
        for suite, mode, result_name, proof_name, category in [
            ('startup-identity', 'packaged', 'startup-identity/results.json', 'startup-binding.json', 'startup'),
            ('preview', 'source', 'ui-review/preview/results.json', 'preview-binding.json', 'preview'),
        ]:
            proof_path = OUT / proof_name
            proof = self.proof(proof_path, mode)
            self.execution(proof, suite)
            result_file = OUT / result_name
            data = read(result_file)
            if suite == 'startup-identity':
                require(data.get('asarSha256') == EXPECTED_ASAR and data.get('failed') == 0, 'Startup identity results not bound to final ASAR or failed')
            row = {**proof, 'suite': suite, 'originalSuite': proof.get('suite', suite), 'executionRecordKind': 'top-level', 'resultFiles': [rel(result_file)], 'originalBindingProof': rel(proof_path)}
            self.add(suite, mode, row, proof_path, category)

    def artifact_gate(self):
        package = read(OUT / 'package/folder7z-verification.json')
        integrity = read(OUT / 'asar-source-match.json')
        pe = read(OUT / 'package/pe-verification.json')
        for label, record in [('folder7z', package), ('ASAR source match', integrity), ('PE integrity', pe)]:
            require(record.get('status') == 'passed' and record.get('asarSha256') == EXPECTED_ASAR, f'{label}: verification did not pass for final ASAR')
        require(integrity.get('folderOnly') is True and integrity.get('noRuntimeMarkdown') is True and integrity.get('sourceAndPackageSame') is True, 'Final integrity proof is not folder-only and source-identical')
        require(set(integrity['files']) == set(self.source) | set(self.freeze['assetFiles']), 'ASAR equality proof does not enumerate exact frozen source/assets')
        require(package.get('true7z') is True and package.get('crcPassed') is True, 'Archive is not a verified true 7z')
        require(package['sha256'] == EXPECTED_FOLDER and sha(package['file']) == EXPECTED_FOLDER, 'Folder 7z digest differs from verified freeze3 delivery')
        require(path(package['file']).stat().st_size == package['sizeBytes'] < 104857600, 'Folder 7z is not below 100 MiB or its recorded size is stale')
        require(package.get('emptyDirectoriesPreserved') == ['数据', '备份'] or set(package.get('emptyDirectoriesPreserved', [])) == {'数据', '备份'}, 'Expected empty data/backup directories missing from package verification')
        require(package.get('allAvatarOriginalHashesMatched') is True and package.get('avatarCount') == len(self.freeze['avatarAssets']), 'Packaged avatar identity verification incomplete')
        avatars = read('assets/avatar-defaults/manifest.json')
        original_avatars = [v for v in avatars['files'] if v.get('group') == 'original']
        require(len(original_avatars) == avatars['originalCount'] == 40, 'Original avatar group is incomplete')
        old_avatars = read('artifacts/rc14/frozen-source.json')['avatarAssets']
        for avatar in original_avatars:
            name = 'assets/avatar-defaults/' + avatar['fileName']
            require(self.freeze['avatarAssets'][name] == old_avatars[name] == avatar['sha256'], f'Original avatar changed since prior release: {name}')
        require(package.get('looseMarkdownCount') == 0, 'Runtime contains loose Markdown documents')
        require(not list((ROOT / 'dist-rc15-final').glob('*portable*.exe')), 'Folder-only release directory still contains a portable wrapper EXE')
        self.files = []
        for item, role in [(path(package['file']), 'primary-folder-7z'), (path(package['standardZip']), 'optional-standard-zip')]:
            require(item.is_file(), f'Missing verified release artifact {item}')
            digest = sha(item)
            if role == 'optional-standard-zip':
                require(digest == package['standardZipSha256'], 'Optional ZIP changed since folder/ZIP equivalence verification')
            self.files.append({'path': str(item.resolve()), 'fileName': item.name, 'name': item.name,
                               'sizeBytes': item.stat().st_size, 'bytes': item.stat().st_size,
                               'sha256': digest, 'role': role, 'under100MiB': item.stat().st_size < 104857600})
        # Validate every packaged file again; a stale successful archive report is insufficient.
        unpacked = ROOT / 'dist-rc15-final/win-unpacked'
        actual_files = {p.relative_to(unpacked).as_posix() for p in unpacked.rglob('*') if p.is_file()}
        require(actual_files == set(package['files']), 'Final unpacked runtime differs from verified archive file set')
        for name, record in package['files'].items():
            require(sha(unpacked / name) == record['sha256'] and (unpacked / name).stat().st_size == record['sizeBytes'], f'Final unpacked runtime changed: {name}')
        self.archive_proof = {'folder': 'artifacts/rc15/package/folder7z-verification.json', 'asar': 'artifacts/rc15/asar-source-match.json', 'pe': 'artifacts/rc15/package/pe-verification.json'}

    def findings_gate(self):
        migration_names = [
            'Regression: whole deleted old avatar folder suppresses40 seeded originals and protects a destination replacement',
            'Regression: customized old default retains exact filename and future roster avatar-name matching',
            'Folder-edition relative avatar index resolves from selected 数据 and waits for displayed-resource confirmation',
        ]
        proof_path = 'artifacts/rc15-independent-review/avatar-migration-case-proofs.json'
        case_proof = read(proof_path)
        require(case_proof.get('afterAsarSha256') == EXPECTED_ASAR, 'Migration closure proof belongs to another ASAR')
        cases = {v['name']: v for v in case_proof['cases']}
        for name in migration_names:
            require(name in cases and cases[name]['before']['status'] == 'failed' and cases[name]['after']['status'] == 'passed', f'Missing actual before/after closure for {name}')
            for mode in ['source', 'packaged']:
                require(name in self.check_names[(mode, 'rc15-independent-migration')], f'{mode}: migration fix is not in selected final checks: {name}')
        v1 = 'Frozen 1.0 fixture opens without touching legacy bytes or creating v2'
        require(v1 in self.check_names[('source', 'source-migration')], 'V1 startup write regression lacks selected successful no-write evidence')
        v1_catalog = 'Raw handwritten v1.0 starts without warning, mutation, premature save or loss of the original four pets'
        for mode, group in [('source', 'source-catalog'), ('packaged', 'catalog')]:
            require(v1_catalog in self.check_names[(mode, group)], f'{mode}: V1 startup no-write closure missing from selected catalog run')
        deps = 'Production dependency entry points needed for startup and workbook operations are bundled'
        require(deps in self.check_names[('packaged', 'rc15-independent-package')], 'Missing-dependency defect lacks selected final package regression')
        self.fixed = [
            {'id': 'RC15-V1-STARTUP-WRITE', 'status': 'closed-in-covered-scope', 'groups': ['source-migration', 'source-catalog', 'catalog'], 'assertions': [v1, v1_catalog]},
            {'id': 'RC15-FOLDER-BUILD-001', 'status': 'closed-in-covered-scope', 'groups': ['rc15-independent-package', 'rc15-independent-runtime', 'rc15-independent-migration-ipc'], 'assertion': deps},
        ] + [{'id': label, 'status': 'closed-in-covered-scope', 'groups': ['rc15-independent-migration'], 'assertion': name, 'beforeAfterProof': proof_path}
             for label, name in zip(['RC15-FOLDER-MIGRATION-001', 'RC15-FOLDER-MIGRATION-002', 'RC15-FOLDER-MIGRATION-RELATIVE-INDEX'], migration_names)]

    def finish(self):
        require(self.used_overrides == set(self.overrides), f'Unused retest selections: {set(self.overrides) - self.used_overrides}')
        self.current_files_gate()
        totals = {mode: sum(g['passed'] for g in self.groups if g['mode'] == mode and g['category'] == 'regression') for mode in ['source', 'packaged']}
        category_count = lambda name: sum(g['passed'] for g in self.groups if g['category'] == name)
        result = {
            'version': VERSION, 'candidateVersion': VERSION, 'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'status': 'passed-in-covered-cloud-scope', 'folderOnly': True, 'portableWrapperIncluded': False,
            'sourceTreeSha256': hashlib.sha256(json.dumps(self.source, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'sourceManifestSha256': self.freeze_sha, 'sourceFiles': self.source, 'sourceFileCount': len(self.source),
            'frozenAt': self.freeze['frozenAt'], 'avatarAssets': self.freeze['avatarAssets'], 'assetFiles': self.freeze['assetFiles'],
            'defaultAvatarCount': len(self.freeze['avatarAssets']), 'original40Unchanged': True, 'species': 40, 'speciesForms': 280,
            'sourceAndPackageSame': True, 'archiveVerificationPassed': True, 'archiveBindingProof': self.archive_proof,
            'asarSha256': EXPECTED_ASAR, 'files': self.files,
            'sourceNodePassed': self.source_node, 'packageNodePassed': self.package_node,
            'sourceElectronChecks': totals['source'], 'totalProductionAsarChecks': totals['packaged'],
            'sourceApplicationChecks': totals['source'], 'productionArtifactChecks': totals['packaged'],
            'regressionCountDefinition': 'Unique selected assertion leaves in regular, targeted, independent module/runtime/migration/package, and folder UI suites. Not exclusively Electron checks; Node, startup and source-preview counts are separate.',
            'legacyCountFieldNote': 'sourceElectronChecks is retained for report compatibility. Display sourceApplicationChecks as source application regression assertions; independent module/migration assertions are not Electron UI tests. Display productionArtifactChecks as production artifact assertions, including static payload inspection.',
            'startupChecksPassed': category_count('startup'), 'previewChecksPassed': category_count('preview'),
            'groups': self.groups, 'sourceRuns': 'artifacts/rc15/source-final-runs.json', 'packageRuns': 'artifacts/rc15/packaged-final-runs.json',
            'independentReview': 'artifacts/rc15-independent-review/REVIEW.md',
            'independentRunManifests': ['artifacts/rc15-independent-review/final-source/run-manifest.json', 'artifacts/rc15-independent-review/final-asar/run-manifest.json'],
            'windowsExecuted': False, 'unverifiedWindowsItems': WINDOWS_ITEMS,
            'windowsScope': 'Native Windows folder path, moving/copying, permissions, integration and hardware behavior remain unverified. R14-W01 concerns the folder runtime; no outer portable launcher is delivered.',
            'specializedAudit': 'Previously stopped lock/file SECURITY specialist audit remains stopped and unverified; ordinary inherited regressions and authorized new-feature error handling are distinct.',
            'realStudentDataTouched': False, 'syntheticOnly': True,
            'dataDirectory': 'Actual launched EXE sibling / 数据', 'backupDirectory': 'Actual launched EXE sibling / 备份',
            'resourceDirectory': 'Actual launched EXE sibling folder', 'avatarDirectory': 'Actual launched EXE sibling / 头像',
            'ruleWorkbook': 'Actual launched EXE sibling / 计分卡片.xlsx', 'configFile': 'Actual launched EXE sibling / 配置.txt',
            'schemaVersionChanged': False, 'newOptionalVersion2Fields': ['scoreRules[].growthDelta', 'logs[].growthDelta'],
            'appId': 'org.flowerclassroom.desktop', 'fixedFindings': self.fixed,
            'releaseGate': {'passedInCoveredScope': True, 'unresolvedDiscoveredDefects': 0, 'fixedFindings': len(self.fixed),
                            'fullFinalSourceAndAsarRegression': True, 'independentReviewComplete': True,
                            'unverifiedLimitsRetained': True, 'selectedFailedChecks': 0, 'developmentAttemptsExcluded': True},
            'developmentEvidence': {'excludedFromCounts': True, 'directories': ['artifacts/rc15/development', 'artifacts/rc15/harness-history', 'artifacts/rc15-independent-review/candidate2-final-source', 'artifacts/rc15-independent-review/candidate2-final-asar']},
            'languages': ['zh-CN', 'zh-TW', 'en-US'],
        }
        # Digest every input and selected result so later report generation can
        # verify it consumed exactly this immutable selection.
        inputs = {rel(OUT / 'frozen-source.json'), *self.archive_proof.values(), 'artifacts/rc15-independent-review/avatar-migration-case-proofs.json'}
        for g in self.groups:
            inputs.update(g['evidenceFiles'])
            inputs.add(g['originalBindingProof'])
            inputs.add(g['executionLocator']['file'])
            if g['execution'].get('initialAttempt'):
                initial = g['execution']['initialAttempt']
                inputs.update(initial.get('resultFiles', []))
                if initial.get('log'):
                    inputs.add(rel(initial['log']))
        result['evidenceSha256'] = {p: sha(p) for p in sorted(inputs)}
        result['executionManifestSha256'] = {p: hashlib.sha256((json.dumps(v, ensure_ascii=False, indent=2) + '\n').encode()).hexdigest() for p, v in sorted(self.outputs.items())}
        self.outputs['artifacts/rc15/final-test-manifest.json'] = result
        self.outputs['artifacts/rc15/package-summary.json'] = result
        if not self.args.check_only:
            for name in self.outputs:
                require(not path(name).exists(), f'Refusing to overwrite finalized evidence: {name}. Stop report binding and resolve explicitly with the coordinator.')
            for name, value in self.outputs.items():
                destination = path(name)
                destination.parent.mkdir(parents=True, exist_ok=True)
                with destination.open('x') as target:
                    target.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({k: result[k] for k in ['version', 'frozenAt', 'sourceTreeSha256', 'asarSha256', 'sourceNodePassed', 'packageNodePassed', 'sourceElectronChecks', 'totalProductionAsarChecks', 'startupChecksPassed', 'previewChecksPassed', 'files']}, ensure_ascii=False, indent=2))
        print('CHECK ONLY: no final artifacts written' if self.args.check_only else 'Final evidence written once; ready for report binding.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--retests', help='Explicit retest selections; never auto-select historical passes')
    args = parser.parse_args()
    finalizer = Finalizer(args)
    finalizer.current_files_gate()
    finalizer.regular()
    finalizer.targeted()
    finalizer.independent()
    finalizer.supplemental()
    finalizer.artifact_gate()
    finalizer.findings_gate()
    finalizer.finish()


if __name__ == '__main__':
    try:
        main()
    except (GateError, KeyError, TypeError, OSError) as error:
        print(f'RC15 RELEASE GATE BLOCKED: {error}', file=sys.stderr)
        sys.exit(1)
