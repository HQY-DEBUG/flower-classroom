from pathlib import Path
import concurrent.futures,subprocess,os,json,datetime,hashlib,tempfile,shutil
from rc19_evidence import Capture,regular_outputs,run_directory,now,sha,rel,harness_hashes
root=Path(__file__).resolve().parent.parent
out=root/'artifacts/rc19';out.mkdir(parents=True,exist_ok=True)
freeze_path=out/'frozen-source.json';freeze=json.loads(freeze_path.read_text())
hashes=lambda:{n:sha(root/n) for n in freeze['files']}
before=hashes();assert before==freeze['files']
assets_before={k:sha(root/k) for k in freeze['assetFiles']};assert assets_before==freeze['assetFiles']
package_before={k:sha(root/k) for k in freeze['packageFiles']};assert package_before==freeze['packageFiles']
started=now();runroot=run_directory('regular-source')
el=str(root/'node_modules/electron/dist/electron')
env={**os.environ,'ELECTRON_CACHE':'/tmp/flower-electron-cache','XDG_CACHE_HOME':'/tmp/flower-cache','FLOWER_FREEZE_DIR':'artifacts/rc19','FLOWER_ADVERSARIAL_OUT':str(root/'artifacts/rc9/adversarial-source')}
env.pop('FLOWER_PACKAGE_MAIN',None)
node=lambda f:['node',f]
electron=lambda f:[el,'--no-sandbox','--ozone-platform=headless','--disable-gpu',f]
jobs=[('unit',['node','--test','--test-concurrency=2']+[str(x.relative_to(root)) for x in sorted((root/'tests').glob('*.test.cjs'))]),('ui',node('scripts/ui-test.cjs')),('pets',node('scripts/pet-test-runner.cjs')),('catalog',node('scripts/qa-catalog.cjs')),('primary',node('scripts/qa-parity.cjs')),('migration',node('scripts/qa-pet-care-independent.cjs')),('care',node('scripts/run-frozen-check.cjs')+['care']),('wheels',node('scripts/qa-wheels.cjs')),('lock',node('scripts/run-frozen-check.cjs')+['lock']),('groups',node('scripts/qa-group-tools.cjs')),('classroom',node('scripts/qa-classroom-tools-native.cjs')),('switch',node('scripts/qa-pet-switch.cjs')),('narrow',node('scripts/qa-classroom-tools-240.cjs')),('organization',node('scripts/qa-organization.cjs')),('petextra',node('scripts/run-frozen-check.cjs')+['petextra']),('toolbox',node('scripts/qa-toolbox-extra-native.cjs')),('navigation',node('scripts/qa-navigation-access.cjs')),('palette',node('scripts/qa-tools-palette.cjs')),('focus',node('scripts/qa-focus-contrast.cjs')),('lifecycle',node('scripts/qa-adventure-lifecycle.cjs')),('lazy-excel',node('scripts/qa-lazy-excel-native.cjs')),('lock-layout',node('scripts/qa-lock-dialog-layout.cjs')),('modal-headers',node('scripts/qa-modal-headers.cjs')),('window-exits',node('scripts/qa-window-exits.cjs')),('adversarial',node('scripts/qa-adversarial-rc9.cjs')),('window-readonly',node('artifacts/rc9/window-readonly-audit.cjs'))]
jobs=[j for j in jobs if not os.environ.get('FLOWER_ONLY_SUITES') or j[0] in os.environ['FLOWER_ONLY_SUITES'].split(',')]
def run(item):
 name,cmd=item;capture=Capture(runroot/name,name,'source',cmd,regular_outputs('source',name),name=='unit');log=capture.log;harness_before=harness_hashes(cmd,name=='unit');harness_before[rel(Path(__file__))]=sha(Path(__file__))
 failure=None
 with log.open('w') as f:
  try:r=subprocess.run(cmd,cwd=root,env={**env},stdout=f,stderr=subprocess.STDOUT,timeout=720);exit_code=r.returncode
  except subprocess.TimeoutExpired as error:exit_code=124;failure=str(error)
 harness_after=harness_hashes(cmd,name=='unit');harness_after[rel(Path(__file__))]=sha(Path(__file__));v=capture.finish(exit_code,failure,extra={'harnessAtStart':harness_before,'harnessAtFinish':harness_after,'scriptUnchanged':harness_before==harness_after})
 if name=='unit':shutil.copy2(log,out/'source-unit.log')
 print(json.dumps(v),flush=True);return v
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("FLOWER_QA_WORKERS","2"))) as pool:results=list(pool.map(run,jobs))
after=hashes();finished=now()
proof={'mode':'source','version':freeze['candidateVersion'],'frozenAt':freeze['frozenAt'],'sourceManifestSha256':sha(freeze_path),'sourceAtStart':before,'sourceAtFinish':after,'assetsAtStart':assets_before,'assetsAtFinish':{k:sha(root/k) for k in freeze['assetFiles']},'packageAtStart':package_before,'packageAtFinish':{k:sha(root/k) for k in freeze['packageFiles']},'sourceUnchanged':before==after,'startedAt':started,'completedAt':finished,'runsFile':rel(runroot/'runs.json'),'runDirectory':rel(runroot),'syntheticOnly':True,'windowsExecuted':False}
(runroot/'runs.json').write_text(json.dumps(results,indent=2)+'\n');(runroot/'binding.json').write_text(json.dumps(proof,indent=2)+'\n')
(out/'source-runs.json').write_text(json.dumps(results,indent=2)+'\n');(out/'source-run-binding.json').write_text(json.dumps(proof,indent=2)+'\n')
assert all(r['exitCode']==0 for r in results),results
assert before==after==freeze['files']

assert assets_before=={k:sha(root/k) for k in freeze['assetFiles']}==freeze['assetFiles']
assert package_before=={k:sha(root/k) for k in freeze['packageFiles']}==freeze['packageFiles']
