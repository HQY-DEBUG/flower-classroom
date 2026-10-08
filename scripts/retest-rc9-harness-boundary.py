from pathlib import Path
import json,shutil,subprocess,os,hashlib,datetime
r=Path(__file__).resolve().parent.parent;base=r/'artifacts/rc9/targeted-source';manifest=base/'runs.json';record=json.loads(manifest.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for name,script,var in [('destructive','scripts/qa-destructive-confirmations-rc9.cjs','FLOWER_DESTRUCTIVE_OUT'),('modals','artifacts/rc9/modal-audit/audit.cjs','FLOWER_MODAL_OUT')]:
 target=base/name;prior=base/(name+'-before-boundary-harness-final');shutil.copytree(target,prior);shutil.copy2(base/(name+'.log'),base/(name+'-before-boundary-harness-final.log'))
 old=next(x for x in record['suites'] if x['suite']==name);before=sha(r/script);started=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (base/(name+'.log')).open('w') as f:run=subprocess.run(['node',script],cwd=r,env={**os.environ,'FLOWER_PACKAGE_MAIN':str(r/'src/main.cjs'),var:str(target),'XDG_CACHE_HOME':'/tmp/flower-cache'},stdout=f,stderr=subprocess.STDOUT,timeout=480)
 item={**old,'scriptSha256':before,'scriptSha256AtFinish':sha(r/script),'scriptUnchanged':before==sha(r/script),'exitCode':run.returncode,'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'previousAttempts':[old],'retestReason':'Package dependency-boundary installation moved ahead of fixture imports; test harness only, runtime unchanged'}
 record['suites'][record['suites'].index(old)]=item;manifest.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(item),flush=True);assert run.returncode==0 and item['scriptUnchanged']
freeze=json.loads((r/'artifacts/rc9/frozen-source.json').read_text());assert all(sha(r/p)==v for p,v in freeze['files'].items())
