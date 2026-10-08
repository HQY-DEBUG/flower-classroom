from pathlib import Path
from rc18_evidence import harness_hashes
import argparse,subprocess,concurrent.futures,os,json,hashlib,datetime,tempfile
r=Path(__file__).resolve().parent.parent;p=argparse.ArgumentParser();p.add_argument('mode',choices=['source','packaged']);a=p.parse_args();out=r/'artifacts/rc18'/('focused-'+a.mode);out.mkdir(exist_ok=True)
entry=r/('src/main.cjs' if a.mode=='source' else 'dist-rc18-final/win-unpacked/resources/app.asar/src/main.cjs');f=json.loads((r/'artifacts/rc18/frozen-source.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def verify():
 assert all(sha(r/k)==h for k,h in {**f['files'],**f['assetFiles'],**f['packageFiles'],**f['packagedDocuments']}.items())
verify()
def run(row):
 name,script,key=row;start=datetime.datetime.now(datetime.timezone.utc).isoformat();env={**os.environ,'XDG_CACHE_HOME':'/tmp/flower-rc18-cache','FLOWER_PACKAGE_MAIN':str(entry),key:str(out/name)};log=out/(name+'.log')
 harness_before=harness_hashes(['node',script])
 with log.open('w') as fp:
  result=subprocess.run(['node',script],cwd=r,env=env,stdout=fp,stderr=subprocess.STDOUT,timeout=480)
 harness_after=harness_hashes(['node',script])
 rec={'suite':name,'harnessAtStart':harness_before,'harnessAtFinish':harness_after,'script':script,'entry':str(entry),'exitCode':result.returncode,'log':str(log.relative_to(r)),'result':str((out/name/'results.json').relative_to(r)),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps(rec),flush=True);return rec
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("FLOWER_QA_WORKERS","2"))) as pool:results=list(pool.map(run,[('score-editor','scripts/qa-score-editor-rc15.cjs','FLOWER_SCORE_EDITOR_OUT'),('avatar-access','scripts/qa-avatar-access-rc15.cjs','FLOWER_AVATAR_ACCESS_OUT')]))
verify();record={'mode':a.mode,'entry':str(entry),'frozenAt':f['frozenAt'],'sourceUnchanged':True,'asarSha256':sha(r/'dist-rc18-final/win-unpacked/resources/app.asar') if a.mode=='packaged' else None,'suites':results};(out/'runs.json').write_text(json.dumps(record,indent=2));assert all(v['exitCode']==0 for v in results)
