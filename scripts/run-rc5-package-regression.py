from pathlib import Path
import concurrent.futures,subprocess,os,json,datetime,tempfile,shutil,hashlib
root=Path(__file__).resolve().parent.parent
archive=root/'dist-rc5-final/win-unpacked/resources/app.asar';temp=Path(tempfile.mkdtemp(prefix='flower-rc5-isolated-'));shutil.copy2(archive,temp/'app.asar')
main=str(temp/'app.asar/src/main.cjs');el=str(root/'node_modules/electron/dist/electron')
env={**os.environ,'ELECTRON_CACHE':'/tmp/flower-electron-cache','XDG_CACHE_HOME':'/tmp/flower-cache','FLOWER_PACKAGE_MAIN':main}
node=lambda f:['node',f]
electron=lambda f:[el,'--no-sandbox','--ozone-platform=headless','--disable-gpu',f]
jobs=[('ui',electron('scripts/qa-package-isolated.cjs')+['qa-electron.cjs'],{}),('pets',electron('scripts/qa-package-isolated.cjs')+['qa-pets.cjs'],{}),('catalog',node('scripts/qa-catalog.cjs'),{}),('primary',node('scripts/qa-parity.cjs'),{'FLOWER_PARITY_OUT':str(root/'artifacts/rc5-packaged'),'FLOWER_PARITY_DATA':str(root/'.qa-parity-packaged')}),('care',electron('scripts/qa-pet-care.cjs'),{}),('wheels',node('scripts/qa-wheels.cjs'),{}),('lock',node('tests/classroom-lock-fixture.cjs'),{}),('groups',node('scripts/qa-group-tools.cjs'),{}),('classroom',node('scripts/qa-classroom-tools-native.cjs'),{}),('switch',node('scripts/qa-pet-switch.cjs'),{}),('narrow',node('scripts/qa-classroom-tools-240.cjs'),{}),('organization',node('scripts/qa-organization.cjs'),{}),('petextra',electron('scripts/qa-pet-extra.cjs'),{}),('toolbox',node('scripts/qa-toolbox-extra-native.cjs'),{})]
def run(item):
 name,cmd,extra=item;start=datetime.datetime.now(datetime.timezone.utc).isoformat();log=root/f'artifacts/rc5/packaged-{name}.log'
 with log.open('w') as f:r=subprocess.run(cmd,cwd=root,env={**env,**extra},stdout=f,stderr=subprocess.STDOUT,timeout=300)
 v={'suite':name,'exitCode':r.returncode,'log':str(log.relative_to(root)),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps(v),flush=True);return v
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(run,jobs))
record={'isolatedMain':main,'asarSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'results':results,'windowsExecuted':False}
(root/'artifacts/rc5/packaged-runs.json').write_text(json.dumps(record,indent=2)+'\n');assert all(r['exitCode']==0 for r in results)
