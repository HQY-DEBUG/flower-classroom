from pathlib import Path
import concurrent.futures,subprocess,os,json,datetime,tempfile,shutil,hashlib
from rc19_evidence import Capture,regular_outputs,run_directory,now,sha,rel,harness_hashes
root=Path(__file__).resolve().parent.parent
out=root/'artifacts/rc19';freeze_path=out/'frozen-source.json';freeze=json.loads(freeze_path.read_text())
hashes=lambda:{n:sha(root/n) for n in freeze['files']}
before=hashes();assert before==freeze['files']
assets_before={k:sha(root/k) for k in freeze['assetFiles']};assert assets_before==freeze['assetFiles']
package_before={k:sha(root/k) for k in freeze['packageFiles']};assert package_before==freeze['packageFiles']
archive=root/'dist-rc19-final/win-unpacked/resources/app.asar';temp=Path(tempfile.mkdtemp(prefix='flower-rc9-isolated-'));shutil.copy2(archive,temp/'app.asar')
ash=sha(archive);assert sha(temp/'app.asar')==ash;started=now();runroot=run_directory('regular-packaged')
main=str(temp/'app.asar/src/main.cjs');el=str(root/'node_modules/electron/dist/electron')
env={**os.environ,'ELECTRON_CACHE':'/tmp/flower-electron-cache','XDG_CACHE_HOME':'/tmp/flower-cache','FLOWER_PACKAGE_MAIN':main}
env['FLOWER_FREEZE_DIR']='artifacts/rc19'
node=lambda f:['node',f]
electron=lambda f:[el,'--no-sandbox','--ozone-platform=headless','--disable-gpu',f]
jobs=[('ui',electron('scripts/qa-package-isolated.cjs')+['qa-electron.cjs'],{}),('pets',electron('scripts/qa-package-isolated.cjs')+['qa-pets.cjs'],{}),('catalog',node('scripts/qa-catalog.cjs'),{}),('primary',node('scripts/qa-parity.cjs'),{'FLOWER_PARITY_OUT':str(root/'artifacts/rc9-packaged'),'FLOWER_PARITY_DATA':str(root/'.qa-parity-packaged')}),('care',electron('scripts/qa-pet-care.cjs'),{}),('wheels',node('scripts/qa-wheels.cjs'),{}),('lock',node('tests/classroom-lock-fixture.cjs'),{}),('groups',node('scripts/qa-group-tools.cjs'),{}),('classroom',node('scripts/qa-classroom-tools-native.cjs'),{}),('switch',node('scripts/qa-pet-switch.cjs'),{}),('narrow',node('scripts/qa-classroom-tools-240.cjs'),{}),('organization',node('scripts/qa-organization.cjs'),{}),('petextra',electron('scripts/qa-pet-extra.cjs'),{}),('toolbox',node('scripts/qa-toolbox-extra-native.cjs'),{}),('navigation',node('scripts/qa-navigation-access.cjs'),{}),('palette',node('scripts/qa-tools-palette.cjs'),{}),('focus',node('scripts/qa-focus-contrast.cjs'),{}),('lifecycle',node('scripts/qa-adventure-lifecycle.cjs'),{}),('lazy-excel',node('scripts/qa-lazy-excel-native.cjs'),{'FLOWER_LAZY_EXCEL_OUT':str(root/'artifacts/rc9/lazy-excel-packaged')}),('lock-layout',node('scripts/qa-lock-dialog-layout.cjs'),{}),('modal-headers',node('scripts/qa-modal-headers.cjs'),{}),('window-exits',node('scripts/qa-window-exits.cjs'),{}),('adversarial',node('scripts/qa-adversarial-rc9.cjs'),{'FLOWER_ADVERSARIAL_OUT':str(root/'artifacts/rc9/adversarial-packaged')}),('window-readonly',node('artifacts/rc9/window-readonly-audit.cjs'),{})]
def run(item):
 name,cmd,extra=item;capture=Capture(runroot/name,name,'packaged',cmd,regular_outputs('packaged',name));log=capture.log;harness_before=harness_hashes(cmd);harness_before[rel(Path(__file__))]=sha(Path(__file__))
 failure=None
 with log.open('w') as f:
  try:r=subprocess.run(cmd,cwd=root,env={**env,**extra},stdout=f,stderr=subprocess.STDOUT,timeout=720);exit_code=r.returncode
  except subprocess.TimeoutExpired as error:exit_code=124;failure=str(error)
 harness_after=harness_hashes(cmd);harness_after[rel(Path(__file__))]=sha(Path(__file__));v=capture.finish(exit_code,failure,extra={'harnessAtStart':harness_before,'harnessAtFinish':harness_after,'scriptUnchanged':harness_before==harness_after});print(json.dumps(v),flush=True);return v
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("FLOWER_QA_WORKERS","2"))) as pool:results=list(pool.map(run,jobs))
after=hashes();endsha=sha(archive);finished=now()
record={'isolatedMain':main,'asarSha256':ash,'results':results,'windowsExecuted':False}
proof={'mode':'packaged','version':freeze['candidateVersion'],'frozenAt':freeze['frozenAt'],'sourceManifestSha256':sha(freeze_path),'sourceAtStart':before,'sourceAtFinish':after,'assetsAtStart':assets_before,'assetsAtFinish':{k:sha(root/k) for k in freeze['assetFiles']},'packageAtStart':package_before,'packageAtFinish':{k:sha(root/k) for k in freeze['packageFiles']},'sourceUnchanged':before==after,'asarSha256Before':ash,'asarSha256After':endsha,'isolatedArchiveSha256':sha(temp/'app.asar'),'asarUnchanged':ash==endsha==sha(temp/'app.asar'),'startedAt':started,'completedAt':finished,'runsFile':rel(runroot/'runs.json'),'runDirectory':rel(runroot),'syntheticOnly':True,'windowsExecuted':False}
(runroot/'runs.json').write_text(json.dumps(record,indent=2)+'\n');(runroot/'binding.json').write_text(json.dumps(proof,indent=2)+'\n')
(out/'packaged-runs.json').write_text(json.dumps(record,indent=2)+'\n');(out/'packaged-run-binding.json').write_text(json.dumps(proof,indent=2)+'\n')
assert all(r['exitCode']==0 for r in results)
assert before==after==freeze['files'] and proof['asarUnchanged']

assert assets_before=={k:sha(root/k) for k in freeze['assetFiles']}==freeze['assetFiles']
assert package_before=={k:sha(root/k) for k in freeze['packageFiles']}==freeze['packageFiles']
