"""Run affected suites sequentially, retain each first attempt, keep product frozen."""
from pathlib import Path
import subprocess,os,json,datetime,hashlib
r=Path(__file__).resolve().parent.parent;d=r/'artifacts/rc8'
pkg=json.loads((d/'packaged-runs.json').read_text());main=pkg['isolatedMain'];frozen=json.loads((d/'frozen-source.json').read_text())['files']
assert all(hashlib.sha256((r/k).read_bytes()).hexdigest()==v for k,v in frozen.items())
node=lambda f:['node',f];el=str(r/'node_modules/electron/dist/electron');electron=lambda f:[el,'--no-sandbox','--ozone-platform=headless','--disable-gpu',f]
jobs=[('source','ui',node('scripts/ui-test.cjs'),{}),('source','lock-layout',node('scripts/qa-lock-dialog-layout.cjs'),{}),('source','catalog',node('scripts/qa-catalog.cjs'),{}),('packaged','ui',electron('scripts/qa-package-isolated.cjs')+['qa-electron.cjs'],{}),('packaged','lock-layout',node('scripts/qa-lock-dialog-layout.cjs'),{}),('packaged','catalog',node('scripts/qa-catalog.cjs'),{}),('packaged','primary',node('scripts/qa-parity.cjs'),{'FLOWER_PARITY_OUT':str(d.parent/'rc8-packaged'),'FLOWER_PARITY_DATA':str(r/'.qa-parity-packaged')})]
records=[]
for kind,suite,cmd,extra in jobs:
 env={**os.environ,'ELECTRON_CACHE':'/tmp/flower-electron-cache','XDG_CACHE_HOME':'/tmp/flower-cache',**extra}
 if kind=='packaged':env['FLOWER_PACKAGE_MAIN']=main
 start=datetime.datetime.now(datetime.timezone.utc).isoformat();log=d/f'{kind}-{suite}-timing-retest.log'
 with log.open('w') as output:run=subprocess.run(cmd,cwd=r,env=env,stdout=output,stderr=subprocess.STDOUT,timeout=720)
 entry={'kind':kind,'suite':suite,'exitCode':run.returncode,'log':str(log.relative_to(r)),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'harnessSha256':{n:hashlib.sha256((r/n).read_bytes()).hexdigest() for n in ['scripts/qa-electron.cjs','scripts/qa-lock-dialog-layout.cjs','scripts/qa-catalog.cjs','scripts/qa-parity.cjs']}}
 records.append(entry);(d/'timing-retest-runs.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(entry),flush=True)
 if run.returncode:raise SystemExit('A focused retest failed; final results have not been changed.')
for kind,file in [('source','source-runs.json'),('packaged','packaged-runs.json')]:
 p=d/file;old=json.loads(p.read_text());target=d/'timing-first-attempt'/file
 assert target.exists()
 arr=old if kind=='source' else old['results']
 for row in [x for x in records if x['kind']==kind]:
  i=next(i for i,x in enumerate(arr) if x['suite']==row['suite']);arr[i]={**{k:v for k,v in row.items() if k!='kind'},'previousAttempts':[arr[i]],'retestReason':'Recorded native input completion and actual pause clock bounds; catalog waits for exact requested stage. Primary unchanged. Sequential retest against unchanged frozen runtime.'}
 assert all(x['exitCode']==0 for x in arr)
 p.write_text(json.dumps(arr if kind=='source' else {**old,'results':arr},indent=2)+'\n')
assert all(hashlib.sha256((r/k).read_bytes()).hexdigest()==v for k,v in frozen.items())
print('All affected source and packaged suites passed with unchanged frozen runtime.')
