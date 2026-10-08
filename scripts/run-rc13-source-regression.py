from pathlib import Path
import concurrent.futures,subprocess,os,json,datetime,hashlib
root=Path(__file__).resolve().parent.parent
el=str(root/'node_modules/electron/dist/electron')
env={**os.environ,'ELECTRON_CACHE':'/tmp/flower-electron-cache','XDG_CACHE_HOME':'/tmp/flower-cache','FLOWER_FREEZE_DIR':'artifacts/rc13','FLOWER_ADVERSARIAL_OUT':str(root/'artifacts/rc9/adversarial-source')}
node=lambda f:['node',f]
electron=lambda f:[el,'--no-sandbox','--ozone-platform=headless','--disable-gpu',f]
jobs=[('unit',['npm','test']),('ui',node('scripts/ui-test.cjs')),('pets',node('scripts/pet-test-runner.cjs')),('catalog',node('scripts/qa-catalog.cjs')),('primary',node('scripts/qa-parity.cjs')),('migration',node('scripts/qa-pet-care-independent.cjs')),('care',node('scripts/run-frozen-check.cjs')+['care']),('wheels',node('scripts/qa-wheels.cjs')),('lock',node('scripts/run-frozen-check.cjs')+['lock']),('groups',node('scripts/qa-group-tools.cjs')),('classroom',node('scripts/qa-classroom-tools-native.cjs')),('switch',node('scripts/qa-pet-switch.cjs')),('narrow',node('scripts/qa-classroom-tools-240.cjs')),('organization',node('scripts/qa-organization.cjs')),('petextra',node('scripts/run-frozen-check.cjs')+['petextra']),('toolbox',node('scripts/qa-toolbox-extra-native.cjs')),('navigation',node('scripts/qa-navigation-access.cjs')),('palette',node('scripts/qa-tools-palette.cjs')),('focus',node('scripts/qa-focus-contrast.cjs')),('lifecycle',node('scripts/qa-adventure-lifecycle.cjs')),('lazy-excel',node('scripts/qa-lazy-excel-native.cjs')),('lock-layout',node('scripts/qa-lock-dialog-layout.cjs')),('modal-headers',node('scripts/qa-modal-headers.cjs')),('window-exits',node('scripts/qa-window-exits.cjs')),('adversarial',node('scripts/qa-adversarial-rc9.cjs')),('window-readonly',node('artifacts/rc9/window-readonly-audit.cjs'))]
def run(item):
 name,cmd=item;start=datetime.datetime.now(datetime.timezone.utc).isoformat();log=root/f'artifacts/rc13/source-{name}.log'
 failure=None
 with log.open('w') as f:
  try:r=subprocess.run(cmd,cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=720);exit_code=r.returncode
  except subprocess.TimeoutExpired as error:exit_code=124;failure=str(error)
 v={'suite':name,'exitCode':exit_code,'harnessError':failure,'command':cmd,'log':str(log.relative_to(root)),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps(v),flush=True);return v
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("FLOWER_QA_WORKERS","2"))) as pool:results=list(pool.map(run,jobs))
(root/'artifacts/rc13/source-runs.json').write_text(json.dumps(results,indent=2)+'\n')
assert all(r['exitCode']==0 for r in results),results
f=json.loads((root/'artifacts/rc13/frozen-source.json').read_text());assert all(hashlib.sha256((root/k).read_bytes()).hexdigest()==v for k,v in f['files'].items())
