import concurrent.futures,datetime,hashlib,json,os,pathlib,subprocess
HERE=pathlib.Path(__file__).resolve().parent
AUDIT=HERE.parents[2]
FINAL=pathlib.Path('/tmp/flower-classroom-workspace/flower-rc16-work/FlowerClassroom-source')
PAYLOAD=FINAL/'dist-rc16-final/win-unpacked'
ASAR=PAYLOAD/'resources/app.asar'
OUT=FINAL/'artifacts/rc16-independent-review/avatars-final'
OUT.mkdir(parents=True,exist_ok=True)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def maps():return {'source':{str(p.relative_to(FINAL)):sha(p) for p in sorted((FINAL/'src').rglob('*')) if p.is_file()},'asar':{'path':str(ASAR),'sha256':sha(ASAR)},'externalAvatars':{p.name:sha(p) for p in sorted((PAYLOAD/'头像').iterdir()) if p.is_file()},'seedMarker':sha(PAYLOAD/'头像-初始化-v2.txt')}
assert sha(ASAR)=='3b5d3b873b2f645409f3e503f41407b20b99ff2972379c84e77906a738a43587'
rows=[]
def run(suite,mode,script):
 target=OUT/suite;target.mkdir(exist_ok=True)
 env=os.environ.copy();env.update(AUDIT_OUT=str(target),AUDIT_PAYLOAD=str(PAYLOAD))
 env.pop('AUDIT_MAIN',None);env.pop('AUDIT_ASAR',None)
 if mode=='source':env['AUDIT_MAIN']=str(FINAL/'src/main.cjs')
 else:env['AUDIT_ASAR']=str(ASAR)
 command=['node',str(HERE/script)]
 before=maps();(target/'runtime-before.json').write_text(json.dumps(before,indent=2))
 started=now()
 try:
  result=subprocess.run(command,cwd=AUDIT,env=env,capture_output=True,text=True,timeout=240)
  code=result.returncode;log=result.stdout+'\n'+result.stderr
 except subprocess.TimeoutExpired as e:
  code=124;log=str(e)
 completed=now();(target/'execution.log').write_text(log)
 after=maps();(target/'runtime-after.json').write_text(json.dumps(after,indent=2))
 evidence=sorted(str(p) for p in target.iterdir() if p.is_file())
 row={'suite':suite,'mode':mode,'domain':'avatars','startedAt':started,'completedAt':completed,'exitCode':code,'command':command,'environmentOverrides':{k:env[k] for k in ['AUDIT_OUT','AUDIT_PAYLOAD','AUDIT_MAIN','AUDIT_ASAR'] if k in env},'log':str(target/'execution.log'),'evidenceFiles':evidence,'script':str(HERE/script),'scriptSha256':sha(HERE/script),'runtimeUnchanged':before==after,'asarSha256':after['asar']['sha256']}
 (target/'execution-row.json').write_text(json.dumps(row,indent=2))
 print(json.dumps({'suite':suite,'exitCode':code,'runtimeUnchanged':before==after}),flush=True)
 return row
spec=[('focused-source','source','audit-batch-races.cjs'),('focused-asar','packaged','audit-batch-races.cjs'),('avatar-roster-asar','packaged','audit-delivered.cjs')]
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
 futures=[pool.submit(run,*s) for s in spec]
 for f in concurrent.futures.as_completed(futures):
  rows.append(f.result());(OUT/'execution-rows.json').write_text(json.dumps(rows,indent=2))
checks=[]
for row in rows:
 p=OUT/row['suite']/'results.json'
 if not p.exists():continue
 r=json.loads(p.read_text())
 if 'checks' in r:
  for c in r['checks']:checks.append({'suite':row['suite'],'mode':row['mode'],'domain':'avatars',**c})
 else:
  for phase in r.get('runs',[]):
   for c in (phase.get('report') or {}).get('checks',[]):checks.append({'suite':row['suite'],'phase':phase['phase'],'mode':row['mode'],'domain':'avatars',**c})
(OUT/'named-checks.json').write_text(json.dumps(checks,indent=2,ensure_ascii=False))
summary={'completedAt':now(),'executions':len(rows),'allExecutionsPassed':all(r['exitCode']==0 and r['runtimeUnchanged'] for r in rows),'namedChecks':len(checks),'passedChecks':sum(c['status']=='passed' for c in checks),'failedChecks':sum(c['status']=='failed' for c in checks),'executionRows':str(OUT/'execution-rows.json'),'namedChecksPath':str(OUT/'named-checks.json')}
(OUT/'summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary),flush=True)
raise SystemExit(0 if summary['allExecutionsPassed'] and not summary['failedChecks'] else 1)
