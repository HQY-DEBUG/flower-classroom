#!/usr/bin/env python3
"""Preserve selected evidence and failed attempts without profiles or private data."""
from pathlib import Path
import datetime as dt
import hashlib
import io
import json
import re
import tarfile

ROOT = Path(__file__).resolve().parent.parent
FILES = set()

def add(value):
    if not value or not isinstance(value, str):
        return
    p = Path(value)
    if not p.is_absolute():
        p = ROOT / p
    p = p.resolve()
    assert p.is_relative_to(ROOT), p
    assert not re.search(r'private[^/]*roster|roster[^/]*private', str(p), re.I), p
    assert p.is_file(), p
    FILES.add(p.relative_to(ROOT).as_posix())

def read(value):
    return json.loads((ROOT / value).read_text())

def execution(value, pointer=''):
    add(value)
    row = read(value)
    for token in pointer.split('/')[1:]:
        token = token.replace('~1', '/').replace('~0', '~')
        row = row[int(token)] if isinstance(row, list) else row[token]
    for field in ['log', 'physicalLaunchLog']:
        if row.get(field) and (ROOT / row[field]).is_file():
            add(row[field])
    for field in ['resultFiles', 'availableEvidenceFiles', 'auxiliaryEvidenceFiles', 'executionEvidenceFiles']:
        for f in row.get(field, []):
            if (ROOT / f).is_file():
                add(f)
    for item in [*row.get('evidenceCapture', []), *row.get('screenshots', [])]:
        add(item['file'])
    for item in row.get('executedHarnessSnapshots', {}).values():
        add(item['file'])

def main():
    selection = 'artifacts/rc19/final220-selection-candidate.json'
    manifest = read(selection)
    assert len(manifest['groups']) == 220 and not manifest['missingGroups']
    for f in [selection, manifest['completionContract'], manifest['attemptHistory'],
              'artifacts/rc19/final220-selection-summary.json', 'artifacts/rc19/frozen-source.json',
              'artifacts/rc19/inherited-remaining-run-plan.json', 'artifacts/rc19/new-group-launch-contracts.json',
              'artifacts/rc19/inherited-application-exact-name-map.json', 'artifacts/rc19/workbook-inherited-case-name-migrations.json',
              'artifacts/rc19-report/required-run-plan.json', 'artifacts/rc19-report/historical-group-reconciliation-draft.json',
              'scripts/assemble-rc19-selection.py', 'scripts/checkpoint-rc19-selection.py']:
        add(f)
    for item in manifest['groups']:
        add(item['proof'])
        execution(item['executionFile'], item.get('executionPointer', ''))
        for f in item['evidenceFiles'] + item.get('executionEvidenceFiles', []):
            add(f)
        for snap in item.get('executedHarnessSnapshots', {}).values():
            add(snap['file'])
        if item.get('harnessVersionIndex'):
            add(item['harnessVersionIndex']['file'])
        if item.get('replaces'):
            prior = item['replaces']
            add(prior['proof'])
            execution(prior['executionFile'], prior.get('executionPointer', ''))
            for f in prior.get('evidenceFiles', []) + prior.get('executionEvidenceFiles', []):
                add(f)
    for attempt in read(manifest['attemptHistory'])['attempts']:
        add(attempt['bindingProof'])
        execution(attempt['executionFile'])
    for folder in ['artifacts/rc19/recovered-roster-inputs', 'artifacts/rc19/recovered-comparison-inputs',
                   'artifacts/rc19/harness-history', 'artifacts/rc19/qa-adaptations',
                   'artifacts/rc19/remaining/historical-harness-adaptation']:
        for p in (ROOT / folder).rglob('*'):
            if p.is_file() and p.suffix in ['.json', '.cjs', '.js', '.py', '.csv', '.xlsx']:
                add(str(p))
    hashes = {f: hashlib.sha256((ROOT / f).read_bytes()).hexdigest() for f in sorted(FILES)}
    content = dict(schemaVersion=1, createdAt=dt.datetime.now(dt.timezone.utc).isoformat(),
                   scope='Fresh RC19 selected220 evidence plus every completed extended attempt and historical QA-input provenance',
                   incompleteRelease=True, coordinatorApproved=False, windowsExecuted=False,
                   excludes=['temporary Electron profiles', 'temporary runtime/module copies', 'private roster inputs'],
                   files=hashes)
    payload = (json.dumps(content, ensure_ascii=False, indent=2) + '\n').encode()
    out = ROOT / 'artifacts/rc19/evidence-checkpoints/final220-evidence-review-candidate-20261007T1521.tar.xz'
    assert not out.exists(), 'Do not replace a checkpoint'
    with tarfile.open(out, 'w:xz', preset=7) as archive:
        item = tarfile.TarInfo('CHECKPOINT-MANIFEST.json')
        item.size = len(payload)
        archive.addfile(item, io.BytesIO(payload))
        for f in sorted(FILES):
            archive.add(ROOT / f, arcname=f, recursive=False)
    with tarfile.open(out, 'r:xz') as archive:
        assert set(archive.getnames()) == set(FILES) | {'CHECKPOINT-MANIFEST.json'}
        for f, expected in hashes.items():
            assert hashlib.sha256(archive.extractfile(f).read()).hexdigest() == expected, f
    record = dict(path=str(out.relative_to(ROOT)), sha256=hashlib.sha256(out.read_bytes()).hexdigest(),
                  sizeBytes=out.stat().st_size, files=len(FILES), verifiedEveryMember=True, incompleteRelease=True)
    out.with_suffix('.verified.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record), flush=True)

if __name__ == '__main__':
    main()
