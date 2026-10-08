from pathlib import Path
import subprocess,os,json,hashlib,datetime
r=Path(__file__).resolve().parent.parent;out=r/'artifacts/rc18/remaining-tail';out.mkdir(exist_ok=True)
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat();sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
fpath=r/'artifacts/rc18/frozen-source.json';f=json.loads(fpath.read_text());archive=r/'dist-rc18-final/win-unpacked/resources/app.asar';ash=sha(archive)
jobs=[]
for mode in ['source','packaged']:
 for script,target in [('inherited-independent','rc13-inherited'),('focused','focused'),('rule-regression','rc14-inherited')]:jobs.append((mode,script,target+'-'+mode,False))
rows=[]
for mode,stem,target,override in jobs:
 assert all(sha(r/n)==h for n,h in f['files'].items());assert sha(archive)==ash
 script='scripts/run-rc18-'+stem+'.py';cmd=['python3',script,mode];env={**os.environ,'FLOWER_QA_WORKERS':'1'}
 if override:env['FLOWER_TARGETED_OUT']=str(r/'artifacts/rc18'/target)
 start=now();scriptsha=sha(r/script);log=out/(stem+'-'+mode+'.log')
 with log.open('w') as fp:res=subprocess.run(cmd,cwd=r,env=env,stdout=fp,stderr=subprocess.STDOUT,timeout=2400)
 row={'mode':mode,'suiteGroup':stem,'command':cmd,'scriptSha256':scriptsha,'scriptUnchanged':sha(r/script)==scriptsha,'startedAt':start,'completedAt':now(),'exitCode':res.returncode,'log':str(log.relative_to(r)),'evidenceFiles':['artifacts/rc18/'+target+'/runs.json'],'plannedBeforeExecution':True};rows.append(row);print(json.dumps(row),flush=True)
 record={'frozenAt':f['frozenAt'],'sourceManifestSha256':sha(fpath),'asarSha256':ash,'sourceUnchanged':all(sha(r/n)==h for n,h in f['files'].items()),'asarUnchanged':sha(archive)==ash,'runs':rows};(out/'runs.json').write_text(json.dumps(record,indent=2)+'\n')
assert all(x['exitCode']==0 and x['scriptUnchanged'] for x in rows)
