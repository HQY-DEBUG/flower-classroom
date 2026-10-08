from pathlib import Path
import concurrent.futures,subprocess,os,json,datetime,hashlib
root=Path(__file__).resolve().parent.parent
el=str(root/'node_modules/electron/dist/electron')
env={**os.environ,'ELECTRON_CACHE':'/tmp/flower-electron-cache','XDG_CACHE_HOME':'/tmp/flower-cache','FLOWER_FREEZE_DIR':'artifacts/rc6'}
node=lambda f:['node',f]
electron=lambda f:[el,'--no-sandbox','--ozone-platform=headless','--disable-gpu',f]
jobs=[('unit',['npm','test']),('ui',node('scripts/ui-test.cjs')),('pets',node('scripts/pet-test-runner.cjs')),('catalog',node('scripts/qa-catalog.cjs')),('primary',node('scripts/qa-parity.cjs')),('migration',node('scripts/qa-pet-care-independent.cjs')),('care',node('scripts/run-frozen-check.cjs')+['care']),('wheels',node('scripts/qa-wheels.cjs')),('lock',node('scripts/run-frozen-check.cjs')+['lock']),('groups',node('scripts/qa-group-tools.cjs')),('classroom',node('scripts/qa-classroom-tools-native.cjs')),('switch',node('scripts/qa-pet-switch.cjs')),('narrow',node('scripts/qa-classroom-tools-240.cjs')),('organization',node('scripts/qa-organization.cjs')),('petextra',node('scripts/run-frozen-check.cjs')+['petextra']),('toolbox',node('scripts/qa-toolbox-extra-native.cjs'))]
def run(item):
 name,cmd=item;start=datetime.datetime.now(datetime.timezone.utc).isoformat();log=root/f'artifacts/rc6/source-{name}.log'
 with log.open('w') as f:r=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=360)
 v={'suite':name,'exitCode':r.returncode,'log':str(log.relative_to(root)),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps(v),flush=True);return v
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(run,jobs))
frozen=json.loads((root/'artifacts/rc6/frozen-source.json').read_text()); expected={k.removeprefix('src/'):v for k,v in frozen['files'].items()}
for name,rel in [('navigation','artifacts/rc6/navigation-source/results.json'),('palette','artifacts/rc6/tool-palette-source-run.json')]:
 r=json.loads((root/rel).read_text()); assert not r['sourceChanged']; assert r['sourceAtFinish']==expected
 assert r.get('failed',r.get('report',{}).get('failed'))==0
 results.append({'suite':name,'exitCode':0,'log':rel,'alreadyExecutedAgainstExactFrozenSource':True})
(root/'artifacts/rc6/source-runs.json').write_text(json.dumps(results,indent=2)+'\n')
assert all(r['exitCode']==0 for r in results),results
f=json.loads((root/'artifacts/rc6/frozen-source.json').read_text());assert all(hashlib.sha256((root/k).read_bytes()).hexdigest()==v for k,v in f['files'].items())
