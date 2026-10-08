from pathlib import Path
import subprocess,concurrent.futures,os,json,hashlib,datetime,tempfile
r=Path(__file__).resolve().parent.parent;out=r/'artifacts/rc17/final-retests';out.mkdir(exist_ok=True);f=json.loads((r/'artifacts/rc17/frozen-source.json').read_text());archive=r/'dist-rc17-final/win-unpacked/resources/app.asar';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();ash=sha(archive)
def verify():
 assert all(sha(r/n)==h for n,h in {**f['files'],**f['assetFiles'],**f['packageFiles'],**f['packagedDocuments']}.items());assert sha(archive)==ash
jobs=[('focus','source','scripts/qa-focus-contrast.cjs',{}),('avatar-comprehensive','source','scripts/qa-avatar-comprehensive-rc11.cjs',{'FLOWER_AVATAR_AUDIT_OUT':str(out/'avatar-comprehensive-source')}),('catalog','packaged','scripts/qa-catalog.cjs',{}),('ui','packaged','scripts/qa-ui-lifecycle-rc10.cjs',{'FLOWER_UI_OUT':str(out/'ui-packaged')}),('feedback','packaged','scripts/qa-inherited-feedback-rc15.cjs',{'FEEDBACK_AUDIT_OUT':str(out/'feedback-packaged')})]
verify()
def run(j):
 name,mode,script,extra=j;entry=r/'src/main.cjs' if mode=='source' else archive/'src/main.cjs';env={**os.environ,'XDG_CACHE_HOME':'/tmp/flower-rc17-cache','EXPECTED_ASAR_SHA':ash,'FLOWER_EXTERNAL_RESOURCE_DIR':tempfile.mkdtemp(prefix='flower-rc17-retest-'),**extra}
 if mode=='packaged':env['FLOWER_PACKAGE_MAIN']=str(entry)
 log=out/(name+'-'+mode+'.log');start=datetime.datetime.now(datetime.timezone.utc).isoformat();before=sha(r/script)
 with log.open('w') as file:result=subprocess.run(['node',script],cwd=r,env=env,stdout=file,stderr=subprocess.STDOUT,timeout=600)
 verify();row={'suite':name,'mode':mode,'entry':str(entry),'exitCode':result.returncode,'log':str(log.relative_to(r)),'script':script,'scriptSha256':before,'scriptUnchanged':before==sha(r/script),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps(row),flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("FLOWER_QA_WORKERS","2"))) as pool:results=list(pool.map(run,jobs))
verify();(out/'runs.json').write_text(json.dumps({'sourceUnchanged':True,'frozenAt':f['frozenAt'],'asarSha256':ash,'suites':results},indent=2));assert all(r['exitCode']==0 and r['scriptUnchanged'] for r in results)
