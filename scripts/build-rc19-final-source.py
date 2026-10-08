"""Preserve frozen source, current QA, report bindings and selected evidence.

Large complete attempt history is separately preserved in the verified Library
evidence checkpoint. This archive excludes private rosters and runtime profiles.
"""
from pathlib import Path
import datetime, hashlib, json, os, re, zipfile

r = Path(__file__).resolve().parent.parent
sha = lambda b: hashlib.sha256(b).hexdigest()
f = json.loads((r / 'artifacts/rc19/frozen-source.json').read_text())
m = json.loads((r / 'artifacts/rc19/final-test-manifest.json').read_text())
assert m['releaseGate']['passedInCoveredScope'] and m['releaseGate']['unresolvedDiscoveredDefects'] == 0
expected = {**f['files'], **f['assetFiles'], **f['packageFiles'], **f['packagedDocuments']}
chosen = {}

def add(value):
    p = Path(value)
    p = (p if p.is_absolute() else r / p).resolve()
    assert p.is_relative_to(r) and p.is_file(), str(p)
    n = p.relative_to(r).as_posix()
    assert not re.search(r'private[^/]*roster|roster[^/]*private|lock-io-review|video-reference/|video-audit-|user-error/|latest-ui-feedback/', n, re.I), n
    assert 'node_modules' not in p.parts, n
    chosen[n] = p

for n, h in expected.items():
    assert sha((r / n).read_bytes()) == h, n
    add(n)
for top in ['src', 'assets', 'scripts', 'tests']:
    for current, dirs, names in os.walk(r / top):
        dirs[:] = [d for d in dirs if d not in ['__pycache__', 'node_modules', 'lock-io-review']]
        for name in names:
            p = Path(current) / name
            if p.is_file() and p.suffix not in ['.pyc', '.tmp']:
                add(p)
# Historical QA entry points live in artifacts; exclude generated runtime copies.
for current, dirs, names in os.walk(r / 'artifacts'):
    dirs[:] = [d for d in dirs if d not in ['__pycache__', 'node_modules', 'lock-io-review', 'extracted-runtime', 'cloud-pristine-extraction', 'data', 'profile', 'profiles', 'user-data', 'resources', 'src', '数据', '头像']]
    for name in names:
        p = Path(current) / name
        if p.suffix in ['.py', '.cjs', '.mjs']:
            add(p)
for field in ['evidenceSha256', 'executionManifestSha256']:
    for name, h in m[field].items():
        assert sha((r / name).read_bytes()) == h, (field, name)
        add(name)
for n in ['artifacts/rc19/final-test-manifest.json', 'artifacts/rc19/package-summary.json', 'artifacts/rc19/frozen-source.json', 'artifacts/rc19/final220-selection.json', 'artifacts/rc19/final220-completion-contract.json', 'artifacts/rc19/final220-attempt-history.json']:
    add(n)
for top in ['artifacts/rc19-report', 'artifacts/rc19/provided-rosters', 'artifacts/rc19/recovered-roster-inputs', 'artifacts/rc19/recovered-comparison-inputs']:
    for p in (r / top).rglob('*'):
        if p.is_file() and p.suffix in ['.py', '.cjs', '.mjs', '.json', '.diff', '.log', '.csv', '.xlsx']:
            add(p)
for p in (r / 'outputs/flower-rc19-report').glob('*'):
    if p.is_file() and p.suffix in ['.pdf', '.xlsx', '.json']:
        add(p)
out = r.parent.parent / 'flower-rc19-deliverables'
dest = out / 'FlowerClassroom-1.3.0-rc.19-source-recovery.zip'
assert not dest.exists(), 'Preserve earlier recovery archives'
index = {n: {'sha256': sha(p.read_bytes()), 'sizeBytes': p.stat().st_size} for n, p in sorted(chosen.items())}
status = dict(version=f['candidateVersion'], createdAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
              sourceManifestSha256=sha((r / 'artifacts/rc19/frozen-source.json').read_bytes()),
              asarSha256=m['asarSha256'], finalTestManifestSha256=sha((r / 'artifacts/rc19/final-test-manifest.json').read_bytes()),
              privateRosterInputsIncluded=False, stoppedSpecialistExcluded=True,
              binaryRuntimeAndDependencyCacheExcluded=True,
              completeAttemptEvidenceLibraryId='libfile_5ad1625e7c708191b8f008f6b770ea6a',
              completeAttemptEvidenceSha256='035908c4b54515a268be5a7ec42d89e9cf7976e58595ce07f567e2f251252470',
              immutableRc18SourceLibraryId='libfile_de163473879c8191b602cdc9d83ef3c2',
              files=index)
with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for n, p in sorted(chosen.items()):
        z.write(p, 'FlowerClassroom-source/' + n)
    z.writestr('RECOVERY-INDEX.json', json.dumps(status, ensure_ascii=False, indent=2) + '\n')
with zipfile.ZipFile(dest) as z:
    assert z.testzip() is None
    for n, record in index.items():
        assert sha(z.read('FlowerClassroom-source/' + n)) == record['sha256'], n
summary = {k: v for k, v in status.items() if k != 'files'}
summary.update(path=str(dest), sizeBytes=dest.stat().st_size, sha256=sha(dest.read_bytes()), entries=len(index)+1, verified=True)
dest.with_suffix('.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(summary, ensure_ascii=False))
