from pathlib import Path
import argparse,subprocess,os,json,hashlib,datetime
r=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('mode',choices=['source','packaged']);a=p.parse_args()
out=r/'artifacts/rc15'/('rc14-inherited-'+a.mode);out.mkdir(parents=True,exist_ok=True)
archive=r/'dist-rc15-final/win-unpacked/resources/app.asar';entry=r/'src/main.cjs' if a.mode=='source' else archive/'src/main.cjs'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
files=lambda:{str(p.relative_to(r)):sha(p) for p in sorted((r/'src').iterdir()) if p.is_file()}
before=files();rows=[]
for name,script,suffix in [('feature','scripts/qa-independent-rc14.cjs',''),('crash-recovery','scripts/qa-rule-crash-recovery-rc15.cjs',''),('response-loss','scripts/qa-rule-response-recovery-rc15.cjs','response-loss')]:
 start=datetime.datetime.now(datetime.timezone.utc).isoformat();log=out/(name+'.log');target=out/suffix;target.mkdir(exist_ok=True)
 with log.open('w') as f:result=subprocess.run(['node',script],cwd=r,env={**os.environ,'FLOWER_PACKAGE_MAIN':str(entry),'FLOWER_REVIEW_OUT':str(target)},stdout=f,stderr=subprocess.STDOUT,timeout=300)
 row={'suite':name,'script':script,'scriptSha256':sha(r/script),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':result.returncode,'log':str(log.relative_to(r))};rows.append(row);print(json.dumps(row),flush=True)
record={'mode':a.mode,'entry':str(entry),'asarSha256':sha(archive) if a.mode=='packaged' else None,'sourceAtStart':before,'sourceAtFinish':files(),'sourceUnchanged':before==files(),'suites':rows}
(out/'runs.json').write_text(json.dumps(record,indent=2)+'\n');assert record['sourceUnchanged'] and all(x['exitCode']==0 for x in rows)
