from pathlib import Path
import subprocess,concurrent.futures,os,json,hashlib,datetime,tempfile
from rc18_evidence import Capture,regular_outputs,run_directory
r=Path(__file__).resolve().parent.parent;out=r/'artifacts/rc18/final-retests';out.mkdir(exist_ok=True);f=json.loads((r/'artifacts/rc18/frozen-source.json').read_text());archive=r/'dist-rc18-final/win-unpacked/resources/app.asar';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();ash=sha(archive)
def verify():
 assert all(sha(r/n)==h for n,h in {**f['files'],**f['assetFiles'],**f['packageFiles'],**f['packagedDocuments']}.items());assert sha(archive)==ash
jobs=[('focus','source','scripts/qa-focus-contrast.cjs',{}),('avatar-comprehensive','source','scripts/qa-avatar-comprehensive-rc11.cjs',{'FLOWER_AVATAR_AUDIT_OUT':str(out/'avatar-comprehensive-source')}),('catalog','packaged','scripts/qa-catalog.cjs',{}),('ui','packaged','scripts/qa-ui-lifecycle-rc10.cjs',{'FLOWER_UI_OUT':str(out/'ui-packaged')}),('feedback','packaged','scripts/qa-inherited-feedback-rc15.cjs',{'FEEDBACK_AUDIT_OUT':str(out/'feedback-packaged')})]
verify()
runroot=run_directory('final-retests-evidence')
def run(j):
 name,mode,script,extra=j;entry=r/'src/main.cjs' if mode=='source' else archive/'src/main.cjs';env={**os.environ,'XDG_CACHE_HOME':'/tmp/flower-rc18-cache','EXPECTED_ASAR_SHA':ash,**extra}
 if mode=='packaged':env['FLOWER_PACKAGE_MAIN']=str(entry)
 else:env.pop('FLOWER_PACKAGE_MAIN',None)
 raw={'avatar-comprehensive':[str((out/'avatar-comprehensive-source/results.json').relative_to(r))],'ui':[str((out/'ui-packaged/results.json').relative_to(r))],'feedback':[str((out/'feedback-packaged/results.json').relative_to(r)),str((out/'feedback-packaged/restart.json').relative_to(r))]}.get(name)
 if raw is None:raw=regular_outputs(mode,name)
 capture=Capture(runroot/(name+'-'+mode),name,mode,['node',script],raw);log=capture.log;before=sha(r/script)
 with log.open('w') as file:result=subprocess.run(['node',script],cwd=r,env=env,stdout=file,stderr=subprocess.STDOUT,timeout=600)
 verify();row=capture.finish(result.returncode,extra={'entry':str(entry),'script':script,'scriptSha256':before,'scriptUnchanged':before==sha(r/script)});print(json.dumps(row),flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("FLOWER_QA_WORKERS","2"))) as pool:results=list(pool.map(run,jobs))
verify();record={'sourceUnchanged':True,'frozenAt':f['frozenAt'],'asarSha256':ash,'suites':results};(out/'runs.json').write_text(json.dumps(record,indent=2));(runroot/'runs.json').write_text(json.dumps(record,indent=2));assert all(r['exitCode']==0 and r['scriptUnchanged'] for r in results)
