"""Record bounded independent source/ASAR suites with exact UTC times and byte manifests."""
from pathlib import Path
import argparse,concurrent.futures,datetime,hashlib,json,os,subprocess,time
from rc18_evidence import harness_hashes
p=argparse.ArgumentParser();p.add_argument('--mode',choices=['source','packaged'],required=True);p.add_argument('--payload',required=True);p.add_argument('--out',required=True);a=p.parse_args()
repo=Path(__file__).resolve().parent.parent;out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True);payload=Path(a.payload).resolve();archive=payload/'resources/app.asar';entry=archive/'src/main.cjs' if a.mode=='packaged' else repo/'src/main.cjs'
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
sha=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
def source_map():
 return {str(file.relative_to(repo)):sha(file) for file in sorted([*repo.joinpath('src').rglob('*'),*repo.joinpath('assets').rglob('*'),repo/'package.json',repo/'package-lock.json']) if file.is_file()}
started=now();before=source_map();asar_before=sha(archive) if a.mode=='packaged' else None
suites=[('modules','FLOWER_FOLDER_MODULE_OUT','qa-folder-modules-independent-rc15.cjs'),('runtime','FLOWER_FOLDER_REVIEW_OUT','qa-folder-independent-rc15.cjs'),('migration','FLOWER_MIGRATION_REVIEW_OUT','qa-migration-independent-rc15.cjs'),('migration-ipc','FLOWER_MIGRATION_IPC_OUT','qa-migration-ipc-independent-rc15.cjs')]
if a.mode=='packaged':suites.append(('package','FLOWER_PACKAGE_REVIEW_OUT','qa-folder-package-independent-rc15.cjs'))
def run(suite):
 label,key,script=suite;start=now();env={**os.environ,'FLOWER_PACKAGE_MAIN':str(entry),'FLOWER_FOLDER_PAYLOAD':str(payload),key:str(out/label)}
 command=['node',str(repo/'scripts'/script)]
 harness_before=harness_hashes(command)
 result=subprocess.run(command,cwd=repo,env=env,text=True,capture_output=True,timeout=180)
 (out/(label+'-launcher.log')).write_text(result.stdout+result.stderr)
 harness_after=harness_hashes(command)
 record={'suite':label,'startedAt':start,'completedAt':now(),'exitCode':result.returncode,'command':command,'report':str(out/label/'results.json'),'script':'scripts/'+script,'scriptSha256':harness_before['scripts/'+script],'scriptSha256AtFinish':harness_after['scripts/'+script],'scriptUnchanged':harness_before==harness_after,'harnessAtStart':harness_before,'harnessAtFinish':harness_after}
 print(label,result.returncode,result.stdout.strip(),flush=True);return record
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("FLOWER_QA_WORKERS","1"))) as pool:results=list(pool.map(run,suites))
after=source_map();asar_after=sha(archive) if a.mode=='packaged' else None
report={'mode':a.mode,'startedAt':started,'completedAt':now(),'entry':str(entry),'payload':str(payload),'results':results,'sourceBefore':before,'sourceAfter':after,'sourceUnchanged':before==after,'asarSha256Before':asar_before,'asarSha256After':asar_after,'asarUnchanged':asar_before==asar_after,'syntheticOnly':True,'windowsExecuted':False,'limitations':['Native app scenarios use real Linux Electron offscreen','File-write instrumentation records Node application calls; it is not an OS-wide or Windows file trace','No stopped security-specialist or lock-behavior tests are included']}
(out/'run-manifest.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
raise SystemExit(1 if any(x['exitCode'] for x in results) or before!=after or asar_before!=asar_after else 0)
