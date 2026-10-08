#!/usr/bin/env python3
"""Select and bind the fresh RC19 re-audit evidence, without rerunning tests.

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
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifacts/rc19'
VERSION = '1.3.0-rc.19'
ASAR = ROOT / 'dist-rc19-final/win-unpacked/resources/app.asar'
BASELINE_ASAR = 'a85789dd38dd2ddea662a1c5bb186d9e68ae537419c75200d73d116710c2026a'
WINDOWS_ITEMS = ['V033', 'V035', 'V037', 'V038', 'V052', 'V054', 'V067', 'R14-W01', 'R14-W02']


class GateError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise GateError(message)


def path(value):
    value = Path(value)
    value = value if value.is_absolute() else ROOT / value
    require(not re.search(r'private[^/]*roster|roster[^/]*private',value.as_posix()+' '+value.resolve().as_posix(),re.I), 'Private roster evidence is not a report input; use only the coordinator-provided sanitized aggregate')
    return value


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
    if isinstance(values.get('files'), dict):
        # RC19 sourceSnapshot.files already uses full root-relative paths.
        # Preserve root package files; legacy bare source maps below still need src/.
        require(values['files'], 'Empty root-relative snapshot file map')
        return dict(values['files'])
    if isinstance(values.get('hashes'), dict):
        require(not values.get('mismatches'), 'Runtime snapshot reports mismatching frozen files')
        values = values['hashes']
    return {('src/' + n if '/' not in n else n): h for n, h in values.items()}


def collect_checks(value, pointer='', inherited_name=''):
    """Only count selected assertion leaves, never a summary and its children."""
    if isinstance(value, list):
        return [v for i, item in enumerate(value) for v in collect_checks(item, pointer + '/' + str(i), inherited_name)]
    if not isinstance(value, dict):
        return []
    inherited_name = value.get('name') or inherited_name
    if isinstance(value.get('leaves'), list):
        return [(pointer + '/leaves/' + str(i), {**item, 'name': (item.get('case', '') + ' / ' if item.get('case') else '') + item['name']}) for i, item in enumerate(value['leaves'])]
    if isinstance(value.get('checks'), list):
        return collect_checks(value['checks'], pointer + '/checks', inherited_name)
    if value.get('status') in ['passed', 'failed', 'observed', 'skipped', 'unverified']:
        return [(pointer, {**value, 'name': inherited_name or pointer or 'Case result'})]
    for key in ['results', 'runs', 'report', 'result', 'phases']:
        if isinstance(value.get(key), (list, dict)):
            return collect_checks(value[key], pointer + '/' + key, inherited_name)
    if isinstance(value.get('passed'), bool):
        return [(pointer, {'name': inherited_name or value.get('phase', 'Case passed'),
                           'status': 'passed' if value['passed'] else 'failed'})]
    if 'stateEqual' in value and 'transientModalsAbsent' in value:
        return [(pointer, {'name': 'Fresh process exact state and no transient modals',
                           'status': 'passed' if value['stateEqual'] and value['transientModalsAbsent'] else 'failed'})]
    return []


def nested_execution_gate(value, context, *, record=True, allow_empty=False):
    """Validate all execution layers, not just the wrapper's zero exit status.

    Domain payloads may intentionally contain errors in negative tests. Only
    execution/result/assertion records interpret such fields as an outcome;
    every nested object is nevertheless visited for subprocess markers.
    """
    if isinstance(value, list):
        for i, item in enumerate(value):
            nested_execution_gate(item, f'{context}/{i}', record=record, allow_empty=allow_empty)
        return
    if not isinstance(value, dict):
        return
    process = any(k in value for k in ['exitCode', 'childExitCode', 'spawnError', 'processError', 'childSignal', 'childError'])
    process = process or ('phase' in value and any(k in value for k in ['signal', 'report', 'result', 'status', 'code']))
    expected_rule_crash = (value.get('passed') is True and value.get('phase') in ['before-json-crash', 'after-json-crash']
                           and value.get('signal') == 'SIGKILL' and value.get('exitCode') is None)
    expected_storage_crash = (value.get('phase') == 'terminate'
                              and value.get('boundary') in ['temp-fsynced', 'before-rename', 'after-rename', 'before-notify']
                              and value.get('expectedSignal') == value.get('signal') == 'SIGKILL'
                              and 'expectedExit' in value and value['expectedExit'] is None and value.get('exitCode') is None)
    expected_explicit_outcome = (value.get('passed') is True and 'expectedExitCode' in value
                                 and value.get('exitCode') == value['expectedExitCode']
                                 and value.get('signal') == value.get('expectedSignal'))
    expected_crash = expected_rule_crash or expected_storage_crash or expected_explicit_outcome
    if process:
        for key in ['error', 'childError', 'spawnError', 'processError', 'timeoutError']:
            require(not value.get(key), f'{context}: subprocess {key}={value.get(key)}')
        for key in ['timedOut', 'timeoutOccurred', 'killedByTimeout']:
            require(value.get(key) is not True, f'{context}: subprocess {key}')
        if not expected_crash:
            for key in ['exitCode', 'childExitCode', 'rawExitStatus', 'outerExitCode']:
                if key in value:
                    require(value[key] == 0, f'{context}: subprocess {key}={value[key]}')
            for key in ['signal', 'childSignal']:
                require(not value.get(key), f'{context}: subprocess terminated by {value.get(key)}')
            if 'code' in value and isinstance(value['code'], (int, type(None))):
                require(value['code'] == 0, f'{context}: subprocess code={value["code"]}')
            if isinstance(value.get('status'), (int, type(None))) and 'status' in value:
                require(value['status'] == 0, f'{context}: subprocess status={value["status"]}')
        for key in ['report', 'result']:
            if key in value:
                result = value[key]
                require(result is not None, f'{context}/{key}: required phase report is missing')
                if isinstance(result, (dict, list)) and not expected_crash:
                    require(collect_checks(result), f'{context}/{key}: phase has zero assertion leaves')
                elif isinstance(result, str):
                    require(path(result).is_file(), f'{context}/{key}: declared report file is missing: {result}')
    assertion = record and value.get('status') in ['passed', 'failed', 'observed', 'skipped', 'unverified'] and 'name' in value
    if record or process or assertion:
        for key in ['fatal', 'harnessError', 'processFailure', 'evidenceErrors', 'phaseErrors', 'validationError', 'validationErrors']:
            require(not value.get(key), f'{context}: {key} remains in selected execution: {value.get(key)}')
        for key in ['errors', 'runtimeErrors', 'rendererErrors']:
            if isinstance(value.get(key), list):
                require(not value[key], f'{context}: nonempty {key} remain in selected report')
        require(value.get('completed') is not False and value.get('complete') is not False,
                f'{context}: execution explicitly reports incomplete work')
        require(value.get('status') not in ['failed', 'blocked', 'error', 'unverified', 'confirmed-defect', 'running', 'pending', 'timeout'],
                f'{context}: report status is not a completed pass: {value.get("status")}')
        if type(value.get('failed')) is int:
            require(value['failed'] == 0, f'{context}: report retains {value["failed"]} failed checks')
        for key in ['failedCases', 'failedAssertions', 'failedChecks', 'executionFailures', 'processFailures', 'rendererErrorCount']:
            if type(value.get(key)) is int:
                require(value[key] == 0, f'{context}: nonzero {key} remains')
        for key in ['allExecutionsPassed', 'countMatches', 'runtimeUnchanged', 'sourceUnchanged', 'asarUnchanged', 'archiveUnchanged', 'matchingRunIdentity', 'harnessUnchanged', 'valid']:
            require(value.get(key) is not False, f'{context}: explicit integrity/completion failure: {key}')
        for expected,actual in [('expectedCases','actualCases'),('expectedCaseCount','actualCaseCount'),('expectedNamedLeaves','actualNamedLeaves'),('expectedChecks','actualChecks')]:
            if type(value.get(expected)) is int:
                actual_value = value.get(actual, value.get('checkCount') if actual == 'actualCaseCount' else None)
                require(actual_value == value[expected] and value[expected] > 0, f'{context}: incomplete {expected}/{actual}')
        for key in ['checkCount', 'passedCheckCount', 'caseCount', 'assertionCount']:
            if type(value.get(key)) is int:
                require(allow_empty or value[key] > 0, f'{context}: {key}=0 cannot establish a completed successful suite')
        if type(value.get('passed')) is int:
            require(allow_empty or value['passed'] > 0, f'{context}: passed=0 cannot establish a completed successful suite')
        for key in ['checks', 'leaves']:
            if isinstance(value.get(key), list):
                require(allow_empty or value[key], f'{context}/{key}: empty assertion array')
        for key in ['expectedPhases', 'requiredPhases']:
            if isinstance(value.get(key), list):
                phases = next((value[k] for k in ['phases', 'runs', 'results'] if isinstance(value.get(k), list)), [])
                actual = value.get('actualPhases', [p.get('phase') for p in phases if isinstance(p, dict)])
                require(sorted(actual) == sorted(value[key]), f'{context}: required phase set incomplete or duplicated')
        if isinstance(value.get('requiredCaseNames'), list):
            require(sorted(value.get('actualCaseNames', [])) == sorted(value['requiredCaseNames']),
                    f'{context}: required scenario set incomplete or duplicated')
        if isinstance(value.get('expectedRestartNames'), list):
            require(sorted(v.get('name') for v in value.get('restarts', [])) == sorted(value['expectedRestartNames']),
                    f'{context}: required restart scenario set incomplete or duplicated')
    record_keys = {'checks', 'leaves', 'results', 'runs', 'report', 'result', 'restarts', 'phases', 'execution', 'child', 'children', 'process', 'processes', 'validation', 'completion', 'summary'}
    for key, child in value.items():
        if key in ['initialAttempt', 'history', 'previousAttempts']:
            continue  # Unselected preserved history is checked separately, never promoted.
        if isinstance(child, (dict, list)):
            nested_execution_gate(child, f'{context}/{key}', record=record and key in record_keys,
                                  allow_empty=expected_crash and key in ['report', 'result'])


class Finalizer:
    def __init__(self, args):
        self.args = args
        self.freeze = read(OUT / 'frozen-source.json')
        require(self.freeze.get('candidateVersion') == VERSION, 'Wrong frozen candidate version')
        self.frozen_at = timestamp(self.freeze['frozenAt'], 'frozen source')
        self.freeze_sha = sha(OUT / 'frozen-source.json')
        self.retired_file = ROOT / 'artifacts/rc19-report/retired-candidates.json'
        retired = read(self.retired_file)['candidates'] if self.retired_file.is_file() else []
        require(self.freeze_sha not in {v['frozenSourceManifestSha256'] for v in retired}, 'This unpublished candidate was explicitly retired; refreeze/rebuild/retest before finalizing')
        self.source = self.freeze['files']
        self.asar_sha = sha(ASAR)
        require(self.asar_sha != BASELINE_ASAR, 'RC19 must contain the changed runtime, not the unchanged delivered RC18 ASAR')
        self.all_frozen = {}
        for key in ['files', 'assetFiles', 'packageFiles', 'packagedDocuments']:
            self.all_frozen.update(self.freeze[key])
        require(self.frozen_at >= timestamp('2026-10-07T12:00:00Z', 'audit start'), 'Current freeze predates this audit')
        self.groups = []
        self.selected = set()
        self.outputs = {}
        self.proofs = {}
        self.check_names = {}
        self.overrides = {}
        self.used_overrides = set()
        self.selection_input = None
        self.supplemental_verifications = []
        self.roster_summary = None
        self.proof_dependencies = set()
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
        require(sha(ASAR) == self.asar_sha, 'Final ASAR changed while selecting evidence')

    def selected_manifest(self):
        """Use exact coordinator selections; overlapping independent reruns are not added implicitly."""
        self.selection_input = rel(self.args.selection)
        manifest = read(self.selection_input)
        require(manifest.get('schemaVersion') == 1 and manifest.get('version') == VERSION, 'Wrong RC19 selection schema/version')
        require(manifest.get('partial') is not True, 'A partial availability or selection draft cannot finalize RC19')
        require(manifest.get('coordinatorSelected') is True, 'Final selections must be explicitly confirmed by the coordinator')
        require(manifest.get('sourceManifestSha256') == self.freeze_sha and manifest.get('asarSha256') == self.asar_sha, 'Selection targets another frozen source or ASAR')
        rows = manifest.get('groups', [])
        required = manifest.get('expectedGroups', [])
        identities = [f"{g['mode']}/{g['group']}" for g in rows]
        require(required and len(required) == len(set(required)) and sorted(required) == sorted(identities), 'Selected final suite set differs from the coordinator-required suite set')
        require(len(identities) == len(set(identities)), 'Duplicate final group selection')
        require(manifest.get('fullInheritedRegression') is True, 'Coordinator has not declared full inherited source/ASAR regression selection')
        require(manifest.get('independentReviewComplete') is True, 'Coordinator has not confirmed independent review of this final runtime')
        completion_file = manifest.get('completionContract')
        require(completion_file, 'Every selected batch needs a declared suite completion contract')
        completion = read(completion_file)
        require(completion.get('coordinatorReviewed') is True, 'Suite completion expectations have not been reviewed')
        require(sha(completion_file) == manifest.get('completionContractSha256'), 'Suite completion contract changed after selection')
        contracts = {(g['mode'], g['group']): g for g in completion['groups']}
        require(set(contracts) == {(g['mode'], g['group']) for g in rows}, 'Suite completion contract does not cover every selected group')
        expected_plan = read('artifacts/rc19-report/required-run-plan.json')
        require(expected_plan.get('requiredGroupCount', 0) >= 210 and set(contracts) == {(g['mode'], g['group']) for g in expected_plan['groups']},
                'Final selection omits a required ordinary inherited or RC19 suite from the complete inherited-plus-current-journey plan')
        historical_groups = {(g['baselineMode'], g['baselineGroup']) for g in read('artifacts/rc19-report/historical-group-reconciliation-draft.json')['groups']}
        require(len(historical_groups) == 210 and historical_groups <= set(contracts), 'A previously selected ordinary regression group is missing from RC19')
        self.proof_dependencies.add(rel(completion_file))
        self.proof_dependencies.add('artifacts/rc19-report/required-run-plan.json')
        self.source_node = self.package_node = 0
        self.source_node_names = []
        package_node_names = []; package_node_record = None
        for item in rows:
            mode, group = item['mode'], item['group']
            require(mode in ['source', 'packaged'], f'{group}: unknown scope')
            proof_path = item['proof']
            proof = self.proof(proof_path, mode)
            original = read(item.get('executionFile', proof_path))
            pointer = item.get('executionPointer', '')
            require(isinstance(pointer, str) and (pointer == '' or pointer.startswith('/')), f'{group}: executionPointer must be an exact JSON pointer')
            for token in pointer.split('/')[1:]:
                token = token.replace('~1', '/').replace('~0', '~')
                original = original[int(token)] if isinstance(original, list) else original[token]
            require(isinstance(original, dict), f'{group}: selected original execution is not an object')
            original = copy.deepcopy(original)
            require(original.get('suite', item.get('suite')) == item.get('suite', original.get('suite')), f'{group}: selected suite mismatch')
            original.setdefault('suite', item.get('suite', group))
            if 'exitCode' not in original and 'childExitCode' in original:
                require(original.get('passed') is True and (original.get('matchingRunIdentity') is True or proof.get('rc19StrictEnvelopeValidated') is True), f'{group}: UI envelope did not pass identity/outcome checks')
                original['exitCode'] = original['childExitCode']
                original['script'] = original.get('harnessPath')
                original['scriptSha256'] = original.get('harnessSha256') or hashes_normalized(original.get('sourceBefore',{})).get(rel(original['script']))
                original.setdefault('completedAt',original.get('endedAt'))
                original.setdefault('evidenceDirectory',rel(path(item.get('executionFile',proof_path)).parent))
            original['originalExecutionFile'] = rel(item.get('executionFile', proof_path))
            original['executionRecordKind'] = 'json-pointer'
            original['originalExecutionPointer'] = pointer
            original['originalExecutionLocator'] = item.get('executionLocator')
            if item.get('executedHarnessSnapshots'):
                original['executedHarnessSnapshots'] = copy.deepcopy(item['executedHarnessSnapshots'])
            if item.get('harnessVersionIndex'):
                index = item['harnessVersionIndex']
                require(sha(index['file']) == index['sha256'], f'{group}: retained execution-version index changed')
                self.proof_dependencies.add(rel(index['file']))
            require(item.get('evidenceFiles'), f'{group}: no explicit result files')
            def links(value, target):
                if isinstance(value, str):
                    try:
                        return path(value).resolve() == path(target).resolve()
                    except (OSError, ValueError):
                        return False
                if isinstance(value, list):
                    return any(links(v, target) for v in value)
                if isinstance(value, dict):
                    for k, v in value.items():
                        if k in ['evidenceDirectory','resultDirectory','outputDirectory'] and isinstance(v, str):
                            if path(target).resolve().is_relative_to(path(v).resolve()):
                                return True
                        if k in ['report','result','results','resultFiles','evidenceFiles','executionEvidenceFiles','file','path','output','log'] and links(v, target):
                            return True
                return False
            for result in item['evidenceFiles']:
                linked = rel(result) == original['originalExecutionFile'] or links(original, result)
                if not linked and item.get('companionExtractedNodeLog') is True:
                    linked = (path(result).resolve() == path(original['originalExecutionFile']).with_name('run.log').resolve()
                              and original.get('asarSha256') == self.asar_sha
                              and original.get('sourceFilesEqual') == len(self.source))
                require(linked, f'{group}: original execution row does not identify {result}')
            row = self.choose(group, mode, original, item['evidenceFiles'], proof_path)
            if item.get('replaces'):
                replaced = item['replaces']
                require(item.get('selectionReason'), f'{group}: missing explicit replacement reason')
                prior = read(replaced['executionFile'])
                for token in replaced.get('executionPointer', '').split('/')[1:]:
                    token = token.replace('~1', '/').replace('~0', '~')
                    prior = prior[int(token)] if isinstance(prior, list) else prior[token]
                require(prior.get('suite') == replaced.get('suite', row['suite']), f'{group}: replacement does not match its explicitly declared original suite')
                require(timestamp(row['startedAt'], group) >= timestamp(prior.get('completedAt') or prior.get('finishedAt'), group),
                        f'{group}: replacement predates the original attempt completion')
                prior = copy.deepcopy(prior)
                prior.update(resultFiles=replaced['evidenceFiles'], originalBindingProof=replaced['proof'],
                             originalExecutionFile=replaced['executionFile'], originalExecutionPointer=replaced.get('executionPointer', ''),
                             evidenceSha256={rel(f): sha(f) for f in replaced['evidenceFiles']})
                prior['originallyMissingEvidenceFiles'] = replaced.get('missingEvidenceFiles', [])
                prior['originallyMissingExecutionEvidenceFiles'] = replaced.get('missingExecutionEvidenceFiles', [])
                require(all(not path(f).exists() for f in prior['originallyMissingEvidenceFiles'] + prior['originallyMissingExecutionEvidenceFiles']),
                        f'{group}: a declared missing original output now exists; original evidence was overwritten or the replacement mapping is inaccurate')
                row['initialAttempt'] = prior
                row['selectionReason'] = item['selectionReason']
                if item.get('initialClassification'):
                    require(item['initialClassification'] in ['product','harness','environment'], 'Unknown original-attempt classification')
                    row['initialClassification'] = item['initialClassification']
                for file in [replaced['proof'], replaced['executionFile'], *replaced.get('executionEvidenceFiles', []), *replaced['evidenceFiles']]:
                    self.proof_dependencies.add(rel(file))
            for file in item.get('executionEvidenceFiles', []):
                phase_data = read(file)
                linked = links(original, file)
                if not linked and path(file).name == 'execution.json':
                    # Capture envelopes predeclare the raw result path. A sibling
                    # process record may be bound only by exact embedded report
                    # equality and the recorded raw/captured digest relationship.
                    for capture in row.get('evidenceCapture', []):
                        if path(capture['rawFile']).parent.resolve() != path(file).parent.resolve():
                            continue
                        if capture['rawFile'] not in row.get('rawEvidenceFiles', []):
                            continue
                        if sha(capture['rawFile']) == capture['sha256'] == sha(capture['file']) and phase_data.get('report') == read(capture['file']):
                            linked = True
                            self.proof_dependencies.add(rel(capture['rawFile']))
                require(linked, f'{group}: additional execution evidence is not linked by the original record: {file}')
                nested_execution_gate(phase_data, file)
                if isinstance(phase_data.get('expectedCases'),list) and isinstance(phase_data.get('sourceBefore',{}).get('files'),dict) and 'childExitCode' in phase_data:
                    origin=next((c for c in row.get('evidenceCapture',[]) if rel(c['file'])==rel(file)),None)
                    companions=None
                    if origin:
                        original_directory=path(origin['rawFile']).parent
                        companions={path(c['rawFile']).name:c['file'] for c in row['evidenceCapture'] if path(c['rawFile']).parent==original_directory}
                    self.rc19_envelope_gate(phase_data,file,mode,companions=companions,harness_snapshots=row.get('executedHarnessSnapshots',{}))
                modified = dt.datetime.fromtimestamp(path(file).stat().st_mtime, dt.timezone.utc)
                a, b = self.times(row, group)
                require(timestamp(a, group) - dt.timedelta(seconds=2) <= modified <= timestamp(b, group) + dt.timedelta(seconds=2),
                        f'{group}: execution phase record was not produced within this selected run: {file}')
                self.proof_dependencies.add(rel(file))
            row['executionEvidenceFiles'] = item.get('executionEvidenceFiles', [])
            if proof.get('startedAt') and (proof.get('completedAt') or proof.get('finishedAt')):
                pstart, pend = self.times(proof, f'{group} binding envelope')
                rstart, rend = self.times(row, f'{group} selected run')
                require(timestamp(pstart, group) <= timestamp(rstart, group) <= timestamp(rend, group) <= timestamp(pend, group), f'{group}: execution lies outside its original binding envelope')
            category = item.get('category', 'regression')
            require(category in ['node', 'regression', 'startup', 'preview'], f'{group}: unknown count category')
            if category == 'node':
                require(len(row['resultFiles']) == 1, f'{group}: Node selection must name the actual test log')
                count, checks = self.node_log(row['resultFiles'][0])
                self.add(group, mode, row, proof_path, category, checks)
                if mode == 'source':
                    require(self.source_node == 0, 'Select exactly one source Node suite')
                    expected_test_files={rel(p) for p in (ROOT/'tests').glob('*.test.cjs')}
                    executed_test_files={rel(p) for p in row.get('command',[]) if isinstance(p,str) and p.endswith('.test.cjs')}
                    require('--test' in row.get('command',[]) and executed_test_files==expected_test_files and expected_test_files,
                            'Source Node selection did not execute the complete current *.test.cjs set')
                    self.source_node = count
                    self.source_node_names = [c['name'] for _, c in checks]
                else:
                    require(self.package_node == 0, 'Select exactly one extracted-ASAR Node suite')
                    self.package_node = count
                    package_node_names = [c['name'] for _, c in checks]
                    package_node_record = row
                    require(row.get('passed') == count and row.get('failed') == 0, 'Extracted-ASAR summary differs from its exact Node log')
            else:
                selected = self.add(group, mode, row, proof_path, category)
                if item.get('title'):
                    selected['title'] = item['title']
                if item.get('auditDomain'):
                    selected['auditDomain'] = item['auditDomain']
            selected = self.groups[-1]
            contract = contracts[(mode, group)]
            require(type(contract.get('expectedPassed')) is int and contract['expectedPassed'] > 0, f'{mode}/{group}: positive expected case count is mandatory')
            require(selected['passed'] == contract['expectedPassed'] and selected['observations'] == contract['expectedObservations'],
                        f'{mode}/{group}: incomplete or unreviewed suite size; actual {selected["passed"]} passes/{selected["observations"]} observations, expected {contract["expectedPassed"]}/{contract["expectedObservations"]}')
            require(isinstance(contract.get('expectedAssertionNames'),list) and contract['expectedAssertionNames'],f'{mode}/{group}: exact expected assertion-name multiset is mandatory')
            require(sorted(c['name'] for c in selected['selectedAssertions']) == sorted(contract['expectedAssertionNames']),
                            f'{mode}/{group}: declared complete assertion-name set differs from actual selected leaves')
            selected['completionContract'] = contract
        require(self.source_node > 0 and self.package_node > 0, 'Missing final source or extracted-ASAR Node tests')
        expected_exclusions = ['preview-target-generation-rc13.test.cjs', 'preview-assets-rc18.test.cjs']
        require(package_node_record.get('excludedSourceOnlyTests') == expected_exclusions, 'Unexpected extracted-ASAR source-only exclusions')
        excluded_names = []
        for filename in expected_exclusions:
            excluded_names.extend(re.findall(r"test\('([^']+)'", path('tests/' + filename).read_text()))
        require(len(excluded_names) == 2 and all(n in self.source_node_names for n in excluded_names), 'Both source-only preview tests must actually pass in the selected full source run')
        require(sorted(package_node_names) == sorted(n for n in self.source_node_names if n not in excluded_names),
                'Source and extracted-ASAR Node assertion names differ beyond the two explicit preview-server tests')
        for mode in ['source', 'packaged']:
            require(any(g['mode'] == mode and g['category'] == 'regression' for g in self.groups), f'Missing final {mode} application regression')
        require(any(g['category'] == 'startup' and g['mode'] == 'packaged' for g in self.groups), 'Missing exact-ASAR startup identity run')
        require(any(g['category'] == 'preview' and g['mode'] == 'source' for g in self.groups), 'Missing current source preview run')
        for item in manifest.get('supplementalVerifications', []):
            require(item.get('excludedFromFinalCounts') is True and item.get('reason'), 'Independent subset verification must explicitly stay outside final assertion totals')
            record = read(item['file'])
            require(sha(item['file']) == item['sha256'], 'Supplemental verification changed after coordinator selection')
            self.supplemental_verifications.append(copy.deepcopy(item))
        self.fresh_proof = self.selection_input

    def roster_aggregate(self):
        """Read only a redacted aggregate that the coordinator intentionally placed in the project."""
        if not self.args.roster_summary:
            return
        p = path(self.args.roster_summary).resolve()
        require(p.is_relative_to((ROOT / 'artifacts/rc19').resolve()), 'Sanitized roster summary must be intentionally staged in artifacts/rc19')
        d = read(p)
        allowed = {'schemaVersion','version','sanitized','sourceManifestSha256','asarSha256','startedAt','completedAt','classes','checks','status','limits','realNamesIncluded','rawInputsIncluded','screenshotsIncluded','countedInFinalAssertions','coordinatorVerified','scope','originalProblem','repair','initialStatus','syntheticCounterpartEvidence','genderSummary'}
        require(set(d) <= allowed, f'Sanitized aggregate has unexpected top-level fields: {set(d) - allowed}')
        require(d.get('sanitized') is True and d.get('coordinatorVerified') is True, 'Roster aggregate must explicitly attest sanitization and coordinator verification')
        require(d.get('realNamesIncluded') is False and d.get('rawInputsIncluded') is False and d.get('screenshotsIncluded') is False, 'Roster aggregate may not contain names, raw inputs, or original screenshots')
        require(d.get('countedInFinalAssertions') is False, 'Private-roster scenario totals must be separate from synthetic final assertion totals')
        require(d.get('version') == VERSION and d.get('sourceManifestSha256') == self.freeze_sha and d.get('asarSha256') == self.asar_sha, 'Roster aggregate targets another final runtime')
        self.times(d, 'sanitized roster aggregate')
        require(d.get('status') == 'passed', 'Actual-roster aggregate has not passed')
        require(len(d.get('classes', [])) == 2, 'Expected two isolated real-roster scenarios')
        require(sorted(c.get('expectedCount') for c in d['classes'])==[52,53], 'Only the supplied two-class aggregate of 53 and 52 students is allowed')
        for c in d['classes']:
            require(set(c) <= {'alias','expectedCount','parsedCount','importedCount','status','sameNameRecordsPreserved','orderVerified','panelIsolationVerified','restartVerified','previewVerified'}, 'Roster classes may contain only aliases, counts, and outcome flags')
            require(c.get('alias') in ['班级A','班级B','Class A','Class B'], 'Use neutral roster aliases only')
            require(c.get('status') == 'passed' and c.get('expectedCount') == c.get('parsedCount') == c.get('importedCount'), 'Roster scenario count/status mismatch')
        for c in d.get('checks', []):
            require(set(c) <= {'id','name','status','actual','expected','scope'}, 'Roster check contains unsupported private detail field')
            require(c.get('status') == 'passed', 'Roster aggregate includes a non-passing check')
        if 'genderSummary' in d:
            require(isinstance(d['genderSummary'],dict) and set(d['genderSummary']) <= {'male','female','blank','total'},'Gender summary must contain only supplied aggregate counts')
            require(all(type(v) is int and v>=0 for v in d['genderSummary'].values()),'Invalid gender count')
            require(sum(d['genderSummary'].get(k,0) for k in ['male','female','blank'])==105,'Gender aggregate does not reconcile to105')
        self.roster_summary = {**d, 'file': rel(p), 'sha256': sha(p)}

    def times(self, row, context):
        started = row.get('startedAt')
        ended = row.get('completedAt') or row.get('finishedAt') or row.get('endedAt')
        start, end = timestamp(started, context), timestamp(ended, context)
        require(max(self.frozen_at, timestamp('2026-10-07T12:00:00Z', 'audit start')) <= start <= end, f'{context}: execution predates current freeze or dates are reversed')
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
        require(d.get('provisionalRuntime') is not True, f'{rel(proof_path)}: provisional development runtime cannot support final evidence')
        if isinstance(d.get('expectedCases'),list) and isinstance(d.get('sourceBefore',{}).get('files'),dict):
            self.rc19_envelope_gate(d,proof_path,mode)
            d={**d,'rc19StrictEnvelopeValidated':True}
            self.proofs[key]=d
            return d
        if str(d.get('schema','')).startswith('rc19-independent-'):
            require(isinstance(d.get('executedScriptHashesBefore'), dict) and d['executedScriptHashesBefore'],
                    f'{rel(proof_path)}: final independent audit requires execution-time script fingerprints; do not manufacture them after the run')
        if d.get('executedScriptHashesBefore') is not None:
            require(d['executedScriptHashesBefore'] == d.get('executedScriptHashesAfter') and d.get('executedScriptsUnchanged') is True,
                    f'{rel(proof_path)}: independent scripts changed during execution')
            for name, digest in d['executedScriptHashesBefore'].items():
                require(sha(name) == digest, f'{rel(proof_path)}: independent audit script changed: {name}')
                self.proof_dependencies.add(rel(name))
        if d.get('frozenAt') is not None:
            require(d['frozenAt'] == self.freeze['frozenAt'], f'{rel(proof_path)}: wrong freeze timestamp')
        if d.get('sourceManifestSha256') is not None:
            require(d['sourceManifestSha256'] == self.freeze_sha, f'{rel(proof_path)}: frozen-manifest digest mismatch')
        if d.get('frozenSourceManifestSha256') is not None:
            require(d['frozenSourceManifestSha256'] == self.freeze_sha, f'{rel(proof_path)}: UI frozen-manifest digest mismatch')
        matched_source = False
        for first, last in [('sourceAtStart', 'sourceAtFinish'), ('sourceBefore', 'sourceAfter')]:
            if first in d and last in d:
                a = self.source_map_gate(d[first], rel(proof_path) + '/' + first)
                b = self.source_map_gate(d[last], rel(proof_path) + '/' + last)
                require(a == b and d.get('sourceUnchanged') is True, f'{rel(proof_path)}: source changed during run')
                matched_source = True
        for first,last,expected in [('assetsAtStart','assetsAtFinish',self.freeze['assetFiles']),('packageAtStart','packageAtFinish',self.freeze['packageFiles'])]:
            if first in d or last in d:
                require(d.get(first)==d.get(last)==expected,f'{rel(proof_path)}: incomplete or changed {first}/{last}')
        if 'sourceFiles' in d and isinstance(d['sourceFiles'], dict):
            self.source_map_gate(d['sourceFiles'], rel(proof_path) + '/sourceFiles')
            require(d.get('sourceUnchanged') is True, f'{rel(proof_path)}: no before/after equality assertion')
            matched_source = True
        if isinstance(d.get('runtimeHashes'), dict):
            runtime_hashes = dict(d['runtimeHashes'])
            if mode == 'packaged' and 'package.json' in runtime_hashes:
                metadata = d.get('packageMetadata', {})
                require(metadata.get('sourceSha256') == self.freeze['packageFiles']['package.json'], f'{rel(proof_path)}: source package metadata mismatch')
                require(metadata.get('packagedSha256') == runtime_hashes['package.json'], f'{rel(proof_path)}: packaged metadata fingerprint mismatch')
                require(metadata.get('equivalentAfterRemoving') == ['scripts', 'devDependencies', 'build'], f'{rel(proof_path)}: unsupported package metadata transformation')
                extracted = subprocess.run(['node', '-e', "process.stdout.write(require('@electron/asar').extractFile(process.argv[1], 'package.json'))", str(ASAR)], cwd=ROOT, check=True, capture_output=True).stdout
                require(hashlib.sha256(extracted).hexdigest() == metadata['packagedSha256'], f'{rel(proof_path)}: metadata does not match the actual final ASAR')
                source_metadata = read('package.json')
                for name in metadata['equivalentAfterRemoving']:
                    source_metadata.pop(name, None)
                require(json.loads(extracted) == source_metadata, f'{rel(proof_path)}: actual packaged metadata differs beyond normal build-only stripping')
                runtime_hashes.pop('package.json')
            self.source_map_gate(runtime_hashes, rel(proof_path) + '/runtimeHashes')
            require(d.get('runtimeUnchanged') is True, f'{rel(proof_path)}: runtime changed during independent execution')
            bound = d.get('frozenSource', {})
            nested_binding = bound.get('sha256') == self.freeze_sha and bound.get('frozenAt') == self.freeze['frozenAt'] and bound.get('matches') is True
            folder_binding = (d.get('frozenSourceManifestSha256') == self.freeze_sha and d.get('frozenAt') == self.freeze['frozenAt']
                              and d.get('frozenRuntimeFilesVerified') == len(self.source)
                              and d.get('frozenResourceFilesVerified') == len(self.freeze['assetFiles']))
            require(nested_binding or folder_binding, f'{rel(proof_path)}: independent runtime proof does not match the current freeze')
            if folder_binding and mode == 'packaged':
                require(d.get('allDependenciesFromSelectedRuntime') is True and d.get('productionDependencyModuleCount', 0) > 0,
                        f'{rel(proof_path)}: packaged folder dependency boundary was not verified')
            matched_source = True
        # A matching timestamp and a boolean alone do not establish execution
        # identity. One of the explicit before/after hash routes above is required.
        if mode == 'source':
            require(matched_source, f'{rel(proof_path)}: no current frozen-source before/after binding')
        else:
            digests = [d[k] for k in ['asarSha256', 'archiveSha256', 'asarSha256Before', 'asarSha256After', 'archiveSha256After', 'isolatedArchiveSha256'] if d.get(k)]
            require(digests and all(h == self.asar_sha for h in digests), f'{rel(proof_path)}: missing/stale production ASAR binding')
            if 'asarUnchanged' in d:
                require(d['asarUnchanged'] is True, f'{rel(proof_path)}: ASAR changed during run')
            if 'archiveUnchanged' in d:
                require(d['archiveUnchanged'] is True, f'{rel(proof_path)}: archive changed during run')
        if d.get('runtimeBinding'):
            runtime = read(d['runtimeBinding'])
            self.proof_dependencies.add(rel(d['runtimeBinding']))
            require(d.get('childExitCode') == 0 and d.get('childSignal') is None and not d.get('childError'), f'{rel(proof_path)}: UI process did not finish successfully')
            require(d.get('passed') is True and d.get('matchingRunIdentity') is True and d.get('rendererErrorCount') == 0, f'{rel(proof_path)}: UI envelope result/identity/renderer gate failed')
            require(runtime.get('passed') is True and runtime.get('runId') == d.get('runId') and runtime.get('version') == VERSION, f'{rel(proof_path)}: runtime binding belongs to another execution/version')
            require(runtime.get('provisionalRuntime') is not True and runtime.get('frozenManifestSha256') == self.freeze_sha and runtime.get('frozenSourceMatches') is True, f'{rel(proof_path)}: runtime binding is not current frozen evidence')
            a = self.source_map_gate(runtime.get('runtimeFilesBefore'), 'UI runtime before')
            b = self.source_map_gate(runtime.get('runtimeFilesAfter'), 'UI runtime after')
            require(a == b and runtime.get('runtimeUnchanged') is True, f'{rel(proof_path)}: selected UI runtime changed')
            require(runtime.get('realElectronMainPreloadRenderer') is True and not runtime.get('dependencyViolations') and not runtime.get('rendererViolations'), f'{rel(proof_path)}: UI entry/preload/renderer/dependency boundary failed')
            require(sha('scripts/qa-rc19-runtime-binding.cjs') == d['bindingSha256'], f'{rel(proof_path)}: executed UI provenance helper changed')
            require(sha(d['harnessPath']) == d['harnessSha256'], f'{rel(proof_path)}: UI harness changed')
            outputs = d.get('evidenceFiles', [])
            require(len(outputs) == 1, f'{rel(proof_path)}: UI envelope must declare its exact result file')
            report = read(outputs[0])
            require(report.get('runId') == d['runId'] and not report.get('errors'), f'{rel(proof_path)}: UI result belongs to another run or retains renderer errors')
            require(len(report.get('checks', [])) == d.get('checkCount') == d.get('passedCheckCount'), f'{rel(proof_path)}: UI check-count identity mismatch')
        self.proofs[key] = d
        return d

    def rc19_envelope_gate(self,d,proof_path,mode,companions=None,harness_snapshots=None):
        """Validate the RC19 native UI envelope against its actual sibling outputs."""
        label=rel(proof_path);directory=path(proof_path).parent
        def companion(name):
            if companions is not None:
                require(name in companions,label+': missing preserved companion '+name)
                return path(companions[name])
            return directory/name
        self.times(d,label)
        before=hashes_normalized(d['sourceBefore']);after=hashes_normalized(d.get('sourceAfter',{}))
        require(before==after and d['sourceBefore'].get('sha256')==d.get('sourceAfter',{}).get('sha256'),label+': source/assets/QA changed during execution')
        require(set(self.source)|set(self.freeze['assetFiles']) <= set(before),label+': incomplete source and asset fingerprints')
        for name,digest in before.items():
            if name in self.all_frozen:require(digest==self.all_frozen[name],label+': stale frozen file '+name)
            snapshot=(harness_snapshots or {}).get(name)
            if snapshot and name not in self.all_frozen:
                require(snapshot.get('reason') and snapshot.get('sha256')==digest and sha(snapshot['file'])==digest,label+': preserved QA bytes differ '+name)
                self.proof_dependencies.add(rel(snapshot['file']))
            else:
                require(sha(name)==digest,label+': execution-time file changed '+name)
                self.proof_dependencies.add(rel(name))
        require(d.get('passed') is True and d.get('childExitCode')==0 and not d.get('childSignal') and not d.get('childError'),label+': unsuccessful UI process')
        require(d.get('rendererErrorCount')==0,label+': renderer errors or missing error count')
        expected=d['expectedCases'];require(expected and len(expected)==len(set(expected)),label+': empty or duplicate expected journey set')
        start=read(companion('run-start.json'));report=read(companion('results.json'));runtime=read(companion('runtime-binding.json'))
        for value in [start,report,runtime]:require(value.get('runId')==d.get('runId') and value.get('entry')==d.get('entry'),label+': mismatching run or entry')
        require(start.get('sourceBefore')==d['sourceBefore'] and start.get('expectedCases')==expected,label+': expected cases or initial fingerprints changed')
        require(report.get('complete') is True and report.get('errors')==[],label+': incomplete report or renderer errors')
        require(sorted(c['name'] for c in report.get('checks',[]))==sorted(expected) and all(c.get('status')=='passed' for c in report['checks']),label+': missing or failed required cases')
        require(d.get('reportCheckCount')==len(expected)>0,label+': report count is zero or incomplete')
        require(runtime.get('passed') is True and runtime.get('realElectronMainPreloadRenderer') is True and not runtime.get('invalidWindows') and len(runtime.get('windows',[]))>=2,label+': native main/preload/renderer provenance failed')
        require(runtime.get('actualMainSha256')==self.source['src/main.cjs'] and runtime.get('actualPreloadSha256')==self.source['src/preload.cjs'],label+': actual loaded main/preload differs from freeze')
        marker=f"FLOWER_QA_COMPLETE {d['runId']} {len(expected)}"
        require(marker in companion('run.log').read_text().splitlines(),label+': completion signal is missing')
        if mode=='packaged':
            require(d.get('archiveSha256')==d.get('archiveSha256After')==self.asar_sha,label+': final ASAR changed or mismatched')
            boundary=read(companion('dependency-boundary.json'))
            require(boundary.get('status')=='passed' and boundary.get('archive')==d.get('archive') and not boundary.get('violations'),label+': packaged dependency boundary failed')
            self.proof_dependencies.add(rel(companion('dependency-boundary.json')))
        else:require(d.get('archive') is None and d.get('archiveSha256') is None,label+': source run unexpectedly loaded an archive')
        for file in ['run-start.json','results.json','runtime-binding.json','run.log']:
            self.proof_dependencies.add(rel(companion(file)))

    def execution(self, row, context):
        nested_execution_gate(row, context)
        require(row.get('exitCode') == 0, f'{context}: selected attempt failed with exitCode={row.get("exitCode")}; retain it and provide an explicit current retest')
        require(row.get('scriptUnchanged', True) is True, f'{context}: harness changed during execution')
        if row.get('harnessAtStart') is not None:
            require(row['harnessAtStart'] == row.get('harnessAtFinish'), f'{context}: before/after harness fingerprints differ')
            snapshots = row.get('executedHarnessSnapshots', {})
            require(set(snapshots) <= set(row['harnessAtStart']), f'{context}: snapshot mapping names an unrecorded dependency')
            for name, digest in row['harnessAtStart'].items():
                if name in snapshots:
                    snapshot = snapshots[name]
                    require(snapshot.get('reason') and snapshot.get('sha256') == digest == row['harnessAtFinish'][name],
                            f'{context}: retained harness mapping does not match both original execution-time hashes')
                    require(sha(snapshot['file']) == digest, f'{context}: retained executed harness bytes are not exact')
                    self.proof_dependencies.add(rel(snapshot['file']))
                else:
                    require(sha(name) == digest, f'{context}: executed harness file has changed: {name}')
        if row.get('executedScriptHashesBefore') is not None:
            require(row['executedScriptHashesBefore'] == row.get('executedScriptHashesAfter') and row.get('executedScriptsUnchanged') is True,
                    f'{context}: independent audit scripts changed during execution')
            for name, digest in row['executedScriptHashesBefore'].items():
                require(sha(name) == digest, f'{context}: independent audit script has changed: {name}')
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
        selected_assertions = []
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
                selected_assertions.append({'file': rel(result_path), 'pointer': pointer,
                                            'name': check.get('name', ''),
                                            'status': 'observed' if observed else status})
        self.check_names[(mode, name)] = names
        group = {'group': name, 'suite': row['suite'], 'mode': mode, 'category': category,
                 'passed': count, 'observations': observations, 'failed': 0,
                 'evidenceFiles': row['resultFiles'], 'evidenceSha256': fingerprints,
                 'selectedAssertions': selected_assertions,
                 'bindingProof': rel(binding), 'originalBindingProof': row.get('originalBindingProof', rel(binding)),
                 'executionLocator': {'file': row.get('originalExecutionFile', row.get('originalBindingProof', rel(binding))),
                                      'suite': row.get('originalSuite', row['suite']), 'mode': mode,
                                      'locator': row.get('originalExecutionLocator'),
                                      'pointer': row.get('originalExecutionPointer'),
                                      'recordKind': row.get('executionRecordKind', 'suite-row')},
                 'startedAt': start, 'completedAt': end, 'windowsExecuted': False,
                 'execution': row}
        self.groups.append(group)
        return group

    def node_log(self, filename):
        content = path(filename).read_text()
        totals = re.findall(r'(?:ℹ|#) pass (\d+)', content)
        failures = re.findall(r'(?:ℹ|#) fail (\d+)', content)
        require(totals and failures and int(failures[-1]) == 0, f'{filename}: missing or failed Node test summary')
        passed = int(totals[-1])
        require(passed > 0, f'{filename}: zero completed Node tests')
        for label in ['cancelled', 'skipped', 'todo']:
            counts = re.findall(r'(?:ℹ|#) ' + label + r' (\d+)', content)
            require(counts and int(counts[-1]) == 0, f'{filename}: Node {label} tests or missing completion summary')
        # Node logs are assertion evidence. Preserve each actual test-name line.
        names = re.findall(r'^\s*(?:✔|ok \d+ -) (.+?)(?: \([\d.]+ms\))?$', content, re.M)
        require(len(names) == passed, f'{filename}: {len(names)} actual successful test rows disagree with summary {passed}')
        return passed, [(f'/tests/{i}', {'name': name, 'status': 'passed'}) for i, name in enumerate(names)]

    def artifact_gate(self):
        package = read(OUT / 'package/folder7z-verification.json')
        integrity = read(OUT / 'asar-source-match.json')
        pe = read(OUT / 'package/pe-verification.json')
        for label, record in [('folder7z', package), ('ASAR source match', integrity), ('PE integrity', pe)]:
            require(record.get('status') == 'passed' and record.get('asarSha256') == self.asar_sha, f'{label}: verification did not pass for final ASAR')
            require(record.get('version') == VERSION, f'{label}: wrong current version')
            if record.get('verifiedAtUtc'):
                require(timestamp(record['verifiedAtUtc'], label) >= self.frozen_at, f'{label}: archive verification predates current freeze')
            else:
                self.times(record, label)
        require(integrity.get('folderOnly') is True and integrity.get('noRuntimeMarkdown') is True and integrity.get('sourceAndPackageSame') is True, 'Final integrity proof is not folder-only and source-identical')
        require(set(integrity['files']) == set(self.source) | set(self.freeze['assetFiles']), 'ASAR equality proof does not enumerate exact frozen source/assets')
        require(package.get('true7z') is True and package.get('crcPassed') is True, 'Archive is not a verified true 7z')
        require(re.fullmatch(r'[0-9a-f]{64}', package.get('sha256', '')) and sha(package['file']) == package['sha256'], 'Folder 7z digest differs from its current verification record')
        require(path(package['file']).stat().st_size == package['sizeBytes'] < 104857600, 'Folder 7z is not below 100 MiB or its recorded size is stale')
        require(package.get('emptyDirectoriesPreserved') == ['数据', '备份'] or set(package.get('emptyDirectoriesPreserved', [])) == {'数据', '备份'}, 'Expected empty data/backup directories missing from package verification')
        require(package.get('allAvatarOriginalHashesMatched') is True and package.get('avatarCount') == len(self.freeze['avatarAssets']), 'Packaged avatar identity verification incomplete')
        avatars = read('assets/avatar-defaults/manifest.json')
        original_avatars = [v for v in avatars['files'] if v.get('group') == 'original']
        require(len(original_avatars) == avatars['originalCount'] == 40, 'Original avatar group is incomplete')
        historical_identity=read('artifacts/rc19-report/historical-rc18-identity.json')
        require(historical_identity.get('version')=='1.3.0-rc.18' and historical_identity.get('asarSha256')==BASELINE_ASAR,'Wrong immutable baseline identity')
        old_avatars = historical_identity['avatarAssets']
        require(self.freeze['avatarAssets']==old_avatars and len(old_avatars)==120,'One or more of the120 existing avatars changed')
        self.proof_dependencies.add('artifacts/rc19-report/historical-rc18-identity.json')
        for avatar in original_avatars:
            name = 'assets/avatar-defaults/' + avatar['fileName']
            require(self.freeze['avatarAssets'][name] == old_avatars[name] == avatar['sha256'], f'Original avatar changed since prior release: {name}')
        require(package.get('looseMarkdownCount') == 0, 'Runtime contains loose Markdown documents')
        require(not list((ROOT / 'dist-rc19-final').glob('*portable*.exe')), 'Folder-only release directory still contains a portable wrapper EXE')
        artifact_selection_file = 'artifacts/rc19/release-artifact-selection.json'
        artifact_selection = read(artifact_selection_file)
        require(artifact_selection.get('coordinatorSelected') is True and artifact_selection.get('version') == VERSION
                and artifact_selection.get('asarSha256') == self.asar_sha and artifact_selection.get('sourceManifestSha256') == self.freeze_sha,
                'Release artifact selection is not approved for this exact runtime')
        require(artifact_selection['originalVerification'] == {'file':'artifacts/rc19/package/folder7z-verification.json','sha256':sha('artifacts/rc19/package/folder7z-verification.json')},
                'Original archive verification was changed or replaced')
        require(artifact_selection['selected'] == [{'role':'primary-folder-7z','path':package['file'],'sha256':package['sha256'],'sizeBytes':package['sizeBytes']}],
                'Selected archive does not match the verified primary folder 7z')
        require(artifact_selection.get('selectedOriginalFileCount') == len(package['files']) > 0, 'Selected folder file count does not match verified files')
        require(all(v.get('role') != 'optional-standard-zip' or v.get('delivered') is False for v in artifact_selection.get('notSelected', [])), 'Unexpected optional ZIP delivery')
        self.proof_dependencies.add(artifact_selection_file)
        self.artifact_selection = artifact_selection
        self.files = []
        for item, role in [(path(package['file']), 'primary-folder-7z')]:
            require(item.is_file(), f'Missing verified release artifact {item}')
            digest = sha(item)
            if role == 'optional-standard-zip':
                require(digest == package['standardZipSha256'], 'Optional ZIP changed since folder/ZIP equivalence verification')
            self.files.append({'path': str(item.resolve()), 'fileName': item.name, 'name': item.name,
                               'sizeBytes': item.stat().st_size, 'bytes': item.stat().st_size,
                               'sha256': digest, 'role': role, 'under100MiB': item.stat().st_size < 104857600})
        # Validate every packaged file again; a stale successful archive report is insufficient.
        unpacked = ROOT / 'dist-rc19-final/win-unpacked'
        actual_files = {p.relative_to(unpacked).as_posix() for p in unpacked.rglob('*') if p.is_file()}
        require(actual_files == set(package['files']), 'Final unpacked runtime differs from verified archive file set')
        for name, record in package['files'].items():
            require(sha(unpacked / name) == record['sha256'] and (unpacked / name).stat().st_size == record['sizeBytes'], f'Final unpacked runtime changed: {name}')
        self.archive_proof = {'folder': 'artifacts/rc19/package/folder7z-verification.json', 'asar': 'artifacts/rc19/asar-source-match.json', 'pe': 'artifacts/rc19/package/pe-verification.json'}

    def findings_gate(self):
        proof_path = self.args.findings
        proof = read(proof_path)
        require(proof.get('schemaVersion') == 1 and proof.get('version') == VERSION, 'Wrong RC19 finding-closure schema/version')
        require(proof.get('coordinatorReviewed') is True, 'RC19 finding closure needs coordinator review')
        require(proof.get('asarSha256') == self.asar_sha and proof.get('sourceManifestSha256') == self.freeze_sha, 'Finding closure targets another final runtime')
        findings = proof.get('findings', [])
        require(sorted(f['id'] for f in findings) == sorted(proof.get('expectedFindingIds', [])), 'Confirmed RC19 defects must each appear exactly once')
        require(len({f['id'] for f in findings}) == len(findings), 'Duplicate finding closure')
        require(proof.get('unresolvedCoveredProductDefects') == 0, 'Known product defects remain open in the covered release scope')
        self.finding_inputs = {rel(proof_path)}
        self.fixed = []
        for finding in findings:
            require(finding.get('rootCause') and finding.get('fix') and finding.get('before'), f'{finding["id"]}: incomplete cause/fix/original evidence')
            for reference in finding['before'] + finding.get('repairIterations', []):
                data = read(reference['file'])
                require(sha(reference['file']) == reference['sha256'], f'{finding["id"]}: original evidence bytes changed')
                pointer = reference['pointer']
                require(isinstance(pointer, str) and pointer.startswith('/'), 'Original failure needs an exact JSON pointer')
                value = data
                for token in pointer.split('/')[1:]:
                    token = token.replace('~1', '/').replace('~0', '~')
                    value = value[int(token)] if isinstance(value, list) else value[token]
                require(value == reference['equals'], f'{finding["id"]}: original observed failure/repair iteration does not match {reference["file"]}#{pointer}')
                self.finding_inputs.add(rel(reference['file']))
            require(set(finding.get('afterAssertions', {})) == {'source', 'packaged'}, f'{finding["id"]}: needs source and exact ASAR closure')
            source_preview_only = finding.get('scope') == 'source-preview-only'
            if source_preview_only:
                require(finding.get('affectedFiles') == ['scripts/preview.cjs'] and 'scripts/preview.cjs' not in self.all_frozen
                        and finding.get('packagedNotApplicableReason'), 'Source-only closure must be the explicitly unbundled preview server')
            matched_groups = set()
            for mode, required in finding['afterAssertions'].items():
                if source_preview_only and mode == 'packaged':
                    require(required == [], 'Source-only preview defect must not invent ASAR assertions')
                    continue
                require(required and len(set(required)) == len(required), f'{finding["id"]}/{mode}: no exact unique final assertion names')
                for name in required:
                    groups = [group for (m, group), names in self.check_names.items() if m == mode and name in names]
                    require(groups, f'{finding["id"]}/{mode}: missing selected fresh final assertion: {name}')
                    matched_groups.update(groups)
            self.fixed.append({**finding, 'status': 'closed-in-covered-scope', 'groups': sorted(matched_groups), 'beforeAfterProof': rel(proof_path)})

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
            'asarSha256': self.asar_sha, 'files': self.files,
            'releaseArtifactSelection': self.artifact_selection,
            'sourceNodePassed': self.source_node, 'packageNodePassed': self.package_node,
            'sourceElectronChecks': totals['source'], 'totalProductionAsarChecks': totals['packaged'],
            'sourceApplicationChecks': totals['source'], 'productionArtifactChecks': totals['packaged'],
            'regressionCountDefinition': 'Unique selected assertion leaves in regular, targeted, independent module/runtime/migration/package, and folder UI suites. Not exclusively Electron checks; Node, startup and source-preview counts are separate.',
            'legacyCountFieldNote': 'sourceElectronChecks is retained for report compatibility. Display sourceApplicationChecks as source application regression assertions; independent module/migration assertions are not Electron UI tests. Display productionArtifactChecks as production artifact assertions, including static payload inspection.',
            'startupChecksPassed': category_count('startup'), 'previewChecksPassed': category_count('preview'),
            'groups': self.groups, 'sourceRuns': self.selection_input, 'packageRuns': self.selection_input,
            'independentReview': self.selection_input,
            'independentRunManifests': sorted({g['originalBindingProof'] for g in self.groups if 'independent' in g['group'] or g['group'].startswith('reaudit-')}),
            'windowsExecuted': False, 'unverifiedWindowsItems': WINDOWS_ITEMS,
            'windowsScope': 'Native Windows folder path, moving/copying, permissions, integration and hardware behavior remain unverified. R14-W01 concerns the folder runtime; no outer portable launcher is delivered.',
            'specializedAudit': 'Previously stopped lock/file SECURITY specialist audit remains stopped and unverified; ordinary inherited regressions and authorized new-feature error handling are distinct.',
            'allPublicTestFixturesSynthetic': True,
            'privateRosterQa': self.roster_summary or {'status': 'unverified', 'reason': 'No coordinator-sanitized final aggregate was supplied'},
            'privateRosterQaExcludedFromFinalAssertionCounts': True,
            'publicArtifactsContainRealRosterData': False,
            'smartScreen': {'status': 'unresolved', 'systemBlockShownInUserScreenshot': True, 'screenshotIdentifiesExactExecutable': False,
                            'signingOrReputationFixed': False, 'nativeWindowsVerified': False,
                            'note': 'SmartScreen unrecognized-app system block remains unresolved. The screenshot does not identify the exact EXE/version; delivered RC18 has an empty PE certificate table. No signing/reputation remediation or security bypass is part of this release'},
            'dataDirectory': 'Actual launched EXE sibling / 数据', 'backupDirectory': 'Actual launched EXE sibling / 备份',
            'resourceDirectory': 'Actual launched EXE sibling folder', 'avatarDirectory': 'Actual launched EXE sibling / 头像',
            'configurationWorkbook': 'Actual launched EXE sibling / 配置.xlsx',
            'ruleWorkbook': 'Active configuration workbook / 计分卡片 sheet',
            'configFile': 'Actual launched EXE sibling / 配置.xlsx',
            'legacyConfigurationFiles': ['配置.txt', '计分卡片.xlsx'],
            'legacyConfigurationPolicy': 'Retain originals safely during explicit migration; do not continue using them as active configuration sources',
            'runtimeSchema': 'See final source and migration acceptance results; this report does not infer schema compatibility from the previous release',
            'appId': 'org.flowerclassroom.desktop', 'fixedFindings': self.fixed,
            'releaseGate': {'passedInCoveredScope': True, 'unresolvedDiscoveredDefects': 0, 'fixedFindings': len(self.fixed),
                            'fullFinalSourceAndAsarRegression': True, 'independentReviewComplete': True,
                            'unverifiedLimitsRetained': True, 'selectedFailedChecks': 0, 'developmentAttemptsExcluded': True},
            'developmentEvidence': {'excludedFromCounts': True, 'directories': ['artifacts/rc19/development', 'artifacts/rc19/harness-history'], 'note': 'Only explicitly selected post-freeze executions support final counts. Prior RC18 executions, initial failures, successful defect-reproduction observations, harness corrections and repair iterations remain diagnostic evidence.'},
            'supplementalVerifications': self.supplemental_verifications,
            'languages': ['zh-CN', 'zh-TW', 'en-US'],
        }
        # Digest every input and selected result so later report generation can
        # verify it consumed exactly this immutable selection.
        inputs = {rel(OUT / 'frozen-source.json'), *self.archive_proof.values(), *self.finding_inputs, self.fresh_proof}
        if self.retired_file.is_file():inputs.add(rel(self.retired_file))
        inputs.update(self.proof_dependencies)
        if self.roster_summary:
            inputs.add(self.roster_summary['file'])
        inputs.update(v['file'] for v in self.supplemental_verifications)
        for g in self.groups:
            inputs.update(g['evidenceFiles'])
            inputs.add(g['originalBindingProof'])
            inputs.add(g['executionLocator']['file'])
            executed = g['execution']
            inputs.update(rel(p) for p in executed.get('harnessAtStart', {}))
            inputs.update(rel(p) for p in executed.get('executedScriptHashesBefore', {}))
            if executed.get('script') and executed.get('scriptSha256'):
                inputs.add(rel(executed['script']))
            if g['execution'].get('initialAttempt'):
                initial = g['execution']['initialAttempt']
                inputs.update(initial.get('resultFiles', []))
                if initial.get('log'):
                    inputs.add(rel(initial['log']))
        result['evidenceSha256'] = {p: sha(p) for p in sorted(inputs)}
        result['executionManifestSha256'] = {p: hashlib.sha256((json.dumps(v, ensure_ascii=False, indent=2) + '\n').encode()).hexdigest() for p, v in sorted(self.outputs.items())}
        self.outputs['artifacts/rc19/final-test-manifest.json'] = result
        self.outputs['artifacts/rc19/package-summary.json'] = result
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
    parser.add_argument('--selection', required=True, help='Explicit coordinator-selected RC19 groups; exact original execution pointers and evidence files')
    parser.add_argument('--roster-summary', help='Coordinator-sanitized two-class outcome staged under artifacts/rc19; no private files are read')
    parser.add_argument('--reaudit-manifest', default='artifacts/rc19/reaudit-final-runs.json', help='Original post-freeze execution envelope for the four new independent audit domains')
    parser.add_argument('--findings', default='artifacts/rc19/reaudit-findings-closure.json', help='Coordinator-reviewed original failures and exact final assertion selectors')
    args = parser.parse_args()
    finalizer = Finalizer(args)
    finalizer.current_files_gate()
    finalizer.selected_manifest()
    finalizer.artifact_gate()
    finalizer.findings_gate()
    finalizer.roster_aggregate()
    finalizer.finish()


if __name__ == '__main__':
    try:
        main()
    except (GateError, KeyError, TypeError, OSError) as error:
        print(f'RC19 RELEASE GATE BLOCKED: {error}', file=sys.stderr)
        sys.exit(1)
