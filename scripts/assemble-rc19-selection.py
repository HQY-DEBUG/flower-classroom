#!/usr/bin/env python3
"""Build an unapproved, explicit selection candidate from retained fresh executions.

This does not promote an unsuccessful run or approve a release. Every prior
attempt is retained by exact file and SHA; source26 follows the coordinator's
separate reviewed selection, and remaining groups use the latest strict pass.
"""
import collections
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifacts/rc19'

def read(p):
    return json.loads((ROOT / p).read_text())

def sha(p):
    return hashlib.sha256((ROOT / p).read_bytes()).hexdigest()

def write(p, value):
    (ROOT / p).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def key(row):
    return row['mode'] + '/' + row['group']

def accepted(row):
    return bool(row.get('passed')) and row.get('exitCode') == 0 and not any(row.get(k) for k in ['signal', 'harnessError', 'validationErrors', 'evidenceCaptureErrors']) and row.get('actualPassed') == row.get('expectedPassed') and row.get('expectedPassed', 0) > 0

def main():
    source = read('artifacts/rc19/source26-final-selection-candidate.json')
    source_contracts = read('artifacts/rc19/source26-completion-contract-candidate.json')['groups']
    required = {key(r) for r in read('artifacts/rc19/inherited-remaining-run-plan.json')['groups']}
    required |= {key(r) for r in read('artifacts/rc19/new-group-launch-contracts.json')['groups']}
    assert len(required) == 194
    histories = collections.defaultdict(list)
    for run in sorted((OUT / 'remaining').glob('recovered-*/runs.json')):
        selection_path = run.with_name('selections.json')
        if not selection_path.exists():
            continue
        selections = {key(r): r for r in json.loads(selection_path.read_text())['groups']}
        contracts = {key(r): r for r in json.loads(run.with_name('completion-contract.json').read_text())['groups']}
        for row in json.loads(run.read_text()):
            identity = key(row)
            if identity not in required:
                continue
            choice = copy.deepcopy(selections[identity])
            record = dict(identity=identity, startedAt=row['startedAt'], completedAt=row['completedAt'],
                          accepted=accepted(row), selection=choice, completionContract=contracts[identity],
                          executionFile=choice['executionFile'], executionSha256=sha(choice['executionFile']),
                          bindingProof=choice['proof'], bindingSha256=sha(choice['proof']),
                          exitCode=row.get('exitCode'), validationErrors=row.get('validationErrors', []),
                          actualPassed=row.get('actualPassed'), expectedPassed=row.get('expectedPassed'),
                          availableEvidenceFiles=[p for p in row.get('resultFiles', []) if (ROOT / p).is_file()],
                          retainedDiagnosticFiles=[p for p in [row.get('log'), *row.get('auxiliaryEvidenceFiles', []), *row.get('executionEvidenceFiles', [])] if p and (ROOT / p).is_file()])
            histories[identity].append(record)
    selected = copy.deepcopy(source['groups'])
    contracts = copy.deepcopy(source_contracts)
    missing = []
    history_rows = []
    for identity in sorted(required):
        attempts = sorted(histories[identity], key=lambda x: x['startedAt'])
        good = [a for a in attempts if a['accepted']]
        for i, attempt in enumerate(attempts):
            history_rows.append({k: v for k, v in attempt.items() if k not in ['selection', 'completionContract']})
        if not good:
            missing.append(identity)
            continue
        final = good[-1]
        choice = final['selection']
        choice.pop('passed', None)
        prior_failures = [a for a in attempts if not a['accepted'] and a['completedAt'] <= final['startedAt']]
        if prior_failures:
            prior = prior_failures[0]
            previous = prior['selection']
            choice['replaces'] = {k: previous[k] for k in ['mode', 'group', 'suite', 'proof', 'executionFile', 'executionPointer']}
            choice['replaces']['evidenceFiles'] = prior['availableEvidenceFiles']
            choice['replaces']['executionEvidenceFiles'] = prior['retainedDiagnosticFiles']
            choice['initialClassification'] = 'environment' if identity in ['packaged/rc15-independent-modules', 'packaged/reaudit-classroom-final-packaged-D01-identity-model'] else 'harness'
            choice['selectionReason'] = 'Fresh strict rerun after reviewed QA contract, fixture, launch identity, or execution-environment correction; frozen product source and selected ASAR are unchanged. Exact failed attempts and their errors remain in the linked attempt history.'
            choice['priorFailedExecutionFiles'] = [a['executionFile'] for a in prior_failures]
        choice['attemptHistoryIndex'] = 'artifacts/rc19/final220-attempt-history.json'
        choice['selectedFrom'] = str(Path(final['executionFile']).relative_to('artifacts/rc19/remaining').parts[0])
        selected.append(choice)
        contracts.append(final['completionContract'])
    assert len({key(r) for r in selected}) == len(selected)
    assert len(selected) + len(missing) == 220
    baseline = json.loads((ROOT.parent.parent / 'flower-rc18-work/FlowerClassroom-source/artifacts/rc18/final-test-manifest.json').read_text())
    base_ids = {key(r) for r in baseline['groups']}
    all_ids = required | {key(r) for r in source['groups']}
    assert len(base_ids) == 210 and base_ids <= all_ids and len(all_ids) == 220
    history_path = 'artifacts/rc19/final220-attempt-history.json'
    write(history_path, dict(schemaVersion=1, scope='All completed post-reset extended attempts, including failed and replaced executions; source26 initial modal failure is preserved in its coordinator selection', attempts=history_rows))
    contract_path = 'artifacts/rc19/final220-completion-contract-candidate.json'
    write(contract_path, dict(version='1.3.0-rc.19', coordinatorReviewed=False, scope='Exact predeclared contracts from selected fresh executions; pending coordinator approval', groups=contracts))
    candidate = dict(schemaVersion=1, version='1.3.0-rc.19', partial=True, coordinatorSelected=False,
                     fullInheritedRegression=False, independentReviewComplete=False,
                     createdAt=dt.datetime.now(dt.timezone.utc).isoformat(), sourceManifestSha256=source['sourceManifestSha256'], asarSha256=source['asarSha256'],
                     expectedGroups=sorted(all_ids), completionContract=contract_path, completionContractSha256=sha(contract_path),
                     attemptHistory=history_path, attemptHistorySha256=sha(history_path), groups=selected, missingGroups=missing)
    write('artifacts/rc19/final220-selection-candidate.json', candidate)
    summary = dict(selectedGroups=len(selected), requiredGroups=220, missingGroups=missing,
                   inheritedGroupsSelected=len(base_ids & {key(r) for r in selected}), newGroupsSelected=len({key(r) for r in selected} - base_ids),
                   passedAssertions=sum(r['expectedPassed'] for r in contracts), observations=sum(r.get('expectedObservations', 0) for r in contracts),
                   selectedByMode=dict(collections.Counter(r['mode'] for r in selected)), completedExtendedAttempts=len(history_rows),
                   failedExtendedAttempts=sum(not a['accepted'] for a in history_rows), windowsExecuted=False,
                   pending='Independent finalizer verification and coordinator review; this is not a release approval')
    write('artifacts/rc19/final220-selection-summary.json', summary)
    print(json.dumps(summary, ensure_ascii=False))

if __name__ == '__main__':
    main()
