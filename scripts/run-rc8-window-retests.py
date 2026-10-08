"""Retest immutable production source after fixing asynchronous native test input."""
from pathlib import Path
import concurrent.futures,subprocess,os,json,datetime,hashlib
root=Path(__file__).resolve().parent.parent;out=root/'artifacts/rc8'
main=json.loads((out/'window-exits-packaged-results.json').read_text())['entry']
assert Path(main.split('.asar/')[0]+'.asar').is_file()
frozen=json.loads((out/'frozen-source.json').read_text())['files']
assert all(hashlib.sha256((root/k).read_bytes()).hexdigest()==v for k,v in frozen.items())
jobs=[(kind,suite,entry) for kind in ['source','packaged'] for suite,entry in [('window-exits','scripts/qa-window-exits.cjs'),('window-readonly','artifacts/rc8/window-readonly-audit.cjs')]]
def run(item):
 kind,suite,entry=item;start=datetime.datetime.now(datetime.timezone.utc).isoformat();log=out/f'{kind}-{suite}-retest.log';env={**os.environ,'ELECTRON_CACHE':'/tmp/flower-electron-cache','XDG_CACHE_HOME':'/tmp/flower-cache'}
 if kind=='packaged':env['FLOWER_PACKAGE_MAIN']=main
 with log.open('w') as f:r=subprocess.run(['node',entry],cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=720)
 v={'kind':kind,'suite':suite,'exitCode':r.returncode,'log':str(log.relative_to(root)),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'harnessSha256':hashlib.sha256((root/entry).read_bytes()).hexdigest()};print(json.dumps(v),flush=True);return v
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:records=list(pool.map(run,jobs))
(out/'window-retest-runs.json').write_text(json.dumps(records,indent=2)+'\n')
assert all(r['exitCode']==0 for r in records),records
assert all(hashlib.sha256((root/k).read_bytes()).hexdigest()==v for k,v in frozen.items())
