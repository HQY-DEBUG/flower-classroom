from pathlib import Path
import argparse,subprocess,os,json,datetime,hashlib
r=Path(__file__).resolve().parent.parent;p=argparse.ArgumentParser();p.add_argument('mode',choices=['source','packaged']);a=p.parse_args();out=r/'artifacts/rc18';rows=[]
f=json.loads((out/'frozen-source.json').read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for stem in ['legacy-targeted','new-audit','features','extension-regression','inherited-independent','focused','rule-regression']:
 target=out/({'new-audit':'new-targeted','extension-regression':'extension','inherited-independent':'rc13-inherited','rule-regression':'rc14-inherited'}.get(stem,stem)+'-'+a.mode)
 script='scripts/run-rc18-'+stem+'.py';log=out/('extended-'+a.mode+'-'+stem+'.log');start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 assert all(sha(r/n)==h for n,h in f['files'].items())
 with log.open('w') as fp:result=subprocess.run(['python',script,a.mode],cwd=r,env={**os.environ,'FLOWER_QA_WORKERS':os.environ.get('FLOWER_QA_WORKERS','2')},stdout=fp,stderr=subprocess.STDOUT,timeout=2400)
 row={'suiteGroup':stem,'mode':a.mode,'script':script,'evidenceDirectory':str(target.relative_to(r)),'evidenceFiles':[str((target/'runs.json').relative_to(r))],'plannedBeforeExecution':True,'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':result.returncode,'log':str(log.relative_to(r))};rows.append(row);print(json.dumps(row),flush=True)
 (out/('extended-'+a.mode+'-runs.json')).write_text(json.dumps(rows,indent=2)+'\n')
 assert all(sha(r/n)==h for n,h in f['files'].items())
assert all(row['exitCode']==0 for row in rows)
