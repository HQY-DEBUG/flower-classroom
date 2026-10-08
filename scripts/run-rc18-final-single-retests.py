from pathlib import Path
import os,subprocess,json,datetime
r=Path(__file__).resolve().parent.parent;o=r/'artifacts/rc18/final-single-retests';o.mkdir(exist_ok=True);rows=[]
jobs=[('avatar-access','source','scripts/qa-avatar-access-rc15.cjs','FLOWER_AVATAR_ACCESS_OUT','artifacts/rc18/avatar-access-final/source','results.json'),('avatar-access','packaged','scripts/qa-avatar-access-rc15.cjs','FLOWER_AVATAR_ACCESS_OUT','artifacts/rc18/avatar-access-final/packaged','results.json'),('response-loss','packaged','scripts/qa-rule-response-recovery-rc15.cjs','FLOWER_REVIEW_OUT','artifacts/rc18/response-loss-named-packaged','result.json'),('folder-package','packaged','scripts/qa-folder-package-independent-rc15.cjs','FLOWER_PACKAGE_REVIEW_OUT','artifacts/rc18/folder-package-final','results.json')]
for suite,mode,script,key,target,resultfile in jobs:
 (r/target).mkdir(parents=True,exist_ok=True);env={**os.environ,key:str(r/target),'FLOWER_FOLDER_PAYLOAD':str(r/'dist-rc18-final/win-unpacked')}
 cmd=['python3','scripts/run-rc18-retest.py','--suite',suite,'--mode',mode,'--script',script,'--evidence-file',target+'/'+resultfile];start=datetime.datetime.now(datetime.timezone.utc).isoformat();log=o/(suite+'-'+mode+'.log')
 with log.open('w') as fp:run=subprocess.run(cmd,cwd=r,env=env,stdout=fp,stderr=subprocess.STDOUT,timeout=700)
 row={'suite':suite,'mode':mode,'exitCode':run.returncode,'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':cmd,'proof':'artifacts/rc18/retests/'+suite+'-'+mode+'.json','results':target+'/'+resultfile,'log':str(log.relative_to(r))};rows.append(row);print(json.dumps(row),flush=True);(o/'runs.json').write_text(json.dumps(rows,indent=2)+'\n')
assert all(x['exitCode']==0 for x in rows)
