from pathlib import Path
import argparse, concurrent.futures, subprocess, os, json, datetime, hashlib, tempfile, shutil
r=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('mode',choices=['source','packaged']);a=p.parse_args()
base=r/'artifacts/rc15'/('new-targeted-'+a.mode);base.mkdir(parents=True,exist_ok=True)
archive=None
if a.mode=='packaged':
 archive=Path(tempfile.mkdtemp(prefix='flower-rc10-new-'))/'app.asar';shutil.copy2(r/'dist-rc15-final/win-unpacked/resources/app.asar',archive);main=archive/'src/main.cjs'
else:main=r/'src/main.cjs'
env={**os.environ,'XDG_CACHE_HOME':'/tmp/flower-cache','ELECTRON_CACHE':'/tmp/flower-electron-cache','FLOWER_PACKAGE_MAIN':str(main)}
jobs=[
 ('storage','scripts/qa-storage-startup-rc10.cjs',{'FLOWER_STORAGE_OUT':str(base/'storage')}),
 ('crash','scripts/qa-crash-restart-rc10.cjs',{'FLOWER_CRASH_OUT':str(base/'crash')}),
 ('transactions','artifacts/rc10/transaction-review/audit.cjs',{'FLOWER_TRANSACTION_MAIN':str(main),'FLOWER_TRANSACTION_OUT':str(base/'transactions')}),
 ('ui','scripts/qa-ui-lifecycle-rc10.cjs',{'FLOWER_UI_OUT':str(base/'ui')}),
 ('independent-ui','artifacts/rc10/independent-review/ui-independent.cjs',{'FLOWER_UI_OUT':str(base/'independent-ui')}),
 ('restore-toolbox','artifacts/rc10/independent-review/ui-restore-revision.cjs',{'FLOWER_UI_OUT':str(base/'restore-toolbox')}),
 ('restore-classroom','artifacts/rc10/independent-review/ui-restore-classroom.cjs',{'FLOWER_UI_OUT':str(base/'restore-classroom')}),
 ('queued-restore','artifacts/rc10/transaction-review/restore-epoch-audit.cjs',{'FLOWER_EPOCH_MAIN':str(main),'FLOWER_EPOCH_OUT':str(base/'queued-restore')}),
 ('startup-restore','artifacts/rc10/independent-review/startup-generation.cjs',{'FLOWER_TRANSACTION_MAIN':str(main),'FLOWER_TRANSACTION_OUT':str(base/'startup-restore')}),
 ('missed-restore-notice','artifacts/rc10/independent-review/missed-restore-notification.cjs',{'FLOWER_TRANSACTION_MAIN':str(main),'FLOWER_TRANSACTION_OUT':str(base/'missed-restore-notice')})]
hashes=lambda:{p.relative_to(r).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((r/'src').iterdir()) if p.is_file()}
before=hashes()
def run(job):
 name,script,extra=job;code=hashlib.sha256((r/script).read_bytes()).hexdigest();started=datetime.datetime.now(datetime.timezone.utc).isoformat();log=base/(name+'.log');error=None
 with log.open('w') as f:
  try:result=subprocess.run(['node',script],cwd=r,env={**env,**extra,'FLOWER_EXTERNAL_RESOURCE_DIR':tempfile.mkdtemp(prefix='flower-rc15-resources-')},stdout=f,stderr=subprocess.STDOUT,timeout=480);exit_code=result.returncode
  except subprocess.TimeoutExpired as e:exit_code=124;error=str(e)
 row={'suite':name,'entry':str(main),'script':script,'scriptSha256':code,'scriptUnchanged':code==hashlib.sha256((r/script).read_bytes()).hexdigest(),'exitCode':exit_code,'harnessError':error,'log':str(log.relative_to(r)),'evidenceDirectory':str((base/name).relative_to(r)),'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps(row),flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get('FLOWER_QA_WORKERS','2'))) as pool:rows=list(pool.map(run,jobs))
after=hashes();record={'version':json.loads((r/'package.json').read_text())['version'],'mode':a.mode,'entry':str(main),'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest() if archive else None,'sourceAtStart':before,'sourceAtFinish':after,'sourceUnchanged':before==after,'syntheticOnly':True,'windowsExecuted':False,'suites':rows}
(base/'runs.json').write_text(json.dumps(record,indent=2)+'\n');assert before==after and all(row['exitCode']==0 and row['scriptUnchanged'] for row in rows)
