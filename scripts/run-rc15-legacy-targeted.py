from pathlib import Path
import argparse,concurrent.futures,subprocess,os,json,datetime,hashlib,tempfile,shutil
r=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('mode',choices=['source','packaged']);p.add_argument('--archive',default='dist-rc15-final/win-unpacked/resources/app.asar');a=p.parse_args()
base=r/'artifacts/rc15'/('legacy-targeted-'+a.mode);base.mkdir(parents=True,exist_ok=True)
archive=None
if a.mode=='packaged':
 original=(r/a.archive).resolve();temp=Path(tempfile.mkdtemp(prefix='flower-rc9-targeted-'));archive=temp/'app.asar';shutil.copy2(original,archive);main=archive/'src/main.cjs'
else:main=r/'src/main.cjs'
env={**os.environ,'XDG_CACHE_HOME':'/tmp/flower-cache','ELECTRON_CACHE':'/tmp/flower-electron-cache','FLOWER_PACKAGE_MAIN':str(main)}
hashes=lambda:{p.relative_to(r).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((r/'src').iterdir()) if p.is_file()}
before=hashes()
jobs=[
 ('cross-panel','scripts/qa-cross-panel-rc9.cjs',{'FLOWER_CROSS_OUT':str(base/'cross-panel')}),
 ('destructive','scripts/qa-destructive-confirmations-rc9.cjs',{'FLOWER_DESTRUCTIVE_OUT':str(base/'destructive')}),
 ('imports','scripts/qa-import-atomicity-rc9.cjs',{'FLOWER_IMPORT_OUT':str(base/'imports')}),
 ('pets','artifacts/rc9/pet-audit/audit.cjs',{'FLOWER_PET_AUDIT_OUT':str(base/'pets'),'FLOWER_AUDIT_MAIN':str(main)}),
 ('receipts','artifacts/rc10/transaction-review/rc9-receipt-regression.cjs',{'FLOWER_RECEIPT_OUT':str(base/'receipts'),'FLOWER_RECEIPT_MAIN':str(main)}),
 ('modals','artifacts/rc9/modal-audit/audit.cjs',{'FLOWER_MODAL_OUT':str(base/'modals')}),
 ('async-modals','artifacts/rc9/modal-audit/extended.cjs',{'FLOWER_MODAL_OUT':str(base/'async-modals')})]
def run(job):
 name,script,extra=job;script_start=hashlib.sha256((r/script).read_bytes()).hexdigest();started=datetime.datetime.now(datetime.timezone.utc).isoformat();log=base/(name+'.log')
 with log.open('w') as f:result=subprocess.run(['node',script],cwd=r,env={**env,**extra,'FLOWER_EXTERNAL_RESOURCE_DIR':tempfile.mkdtemp(prefix='flower-rc15-resources-')},stdout=f,stderr=subprocess.STDOUT,timeout=480)
 row={'suite':name,'entry':str(main),'script':script,'scriptSha256':script_start,'scriptSha256AtFinish':hashlib.sha256((r/script).read_bytes()).hexdigest(),'scriptUnchanged':script_start==hashlib.sha256((r/script).read_bytes()).hexdigest(),'exitCode':result.returncode,'log':str(log.relative_to(r)),'result':str((base/name/'results.json').relative_to(r)),'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps(row),flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("FLOWER_QA_WORKERS","2"))) as pool:rows=list(pool.map(run,jobs))
after=hashes();record={'version':json.loads((r/'package.json').read_text())['version'],'mode':a.mode,'entry':str(main),'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest() if archive else None,'sourceAtStart':before,'sourceAtFinish':after,'sourceUnchanged':before==after,'syntheticOnly':True,'windowsExecuted':False,'suites':rows}
(base/'runs.json').write_text(json.dumps(record,indent=2)+'\n');assert before==after and all(row['exitCode']==0 and row['scriptUnchanged'] for row in rows)
