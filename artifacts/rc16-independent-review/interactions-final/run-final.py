from pathlib import Path
import datetime,hashlib,json,os,shlex,subprocess
root=Path('/tmp/flower-classroom-workspace/flower-rc16-work/FlowerClassroom-source')
out=root/'artifacts/rc16-independent-review/interactions-final'
scripts=out/'scripts'
asar=root/'dist-rc16-final/win-unpacked/resources/app.asar'
expected='3b5d3b873b2f645409f3e503f41407b20b99ff2972379c84e77906a738a43587'
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def src_hashes():return {p.relative_to(root/'src').as_posix():sha(p) for p in sorted((root/'src').rglob('*')) if p.is_file()}
def identity():return {'source':src_hashes(),'asar':{'path':str(asar),'sha256':sha(asar)}}
start=now();before=identity();assert before['asar']['sha256']==expected
rows=[]
def save():
 after=identity()
 record={'domain':'interactions','sourceFreezeAt':'2026-10-07T02:29:32.407625+00:00','startedAt':start,'completedAt':now(),'syntheticOnly':True,'windowsExecuted':False,'before':before,'after':after,'sourceUnchanged':before['source']==after['source'],'asarUnchanged':before['asar']==after['asar'],'expectedAsarSha256':expected,'suites':rows,'stoppedSpecialtyResumed':False}
 (out/'execution-envelope.json').write_text(json.dumps(record,indent=2)+'\n')
for mode in ['source','packaged']:
 main=root/'src/main.cjs' if mode=='source' else Path(str(asar)+'/src/main.cjs')
 for suite,filename in [('draw-transaction-matrix','draw-transaction-matrix.cjs'),('full-interactions','full-interactions.cjs'),('floor-model','floor-model.cjs')]:
  dest=out/mode/suite;dest.mkdir(parents=True,exist_ok=True)
  script=scripts/filename
  env={**os.environ,'FLOWER_PACKAGE_MAIN':str(main),'FLOWER_DRAW_MATRIX_OUT':str(dest),'FLOWER_INTERACTIONS_OUT':str(dest)}
  command=' '.join(shlex.quote(k+'='+env[k]) for k in ['FLOWER_PACKAGE_MAIN','FLOWER_DRAW_MATRIX_OUT','FLOWER_INTERACTIONS_OUT'])+' node '+shlex.quote(str(script))
  log=out/(mode+'-'+suite+'.log');job_start=now();before_job=identity();script_before=sha(script)
  with log.open('w') as f:
   try:r=subprocess.run(['node',str(script)],cwd=root,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=300);code=r.returncode
   except subprocess.TimeoutExpired:code=124
  completed=now();after_job=identity()
  evidence_files=[str(p) for p in sorted(dest.rglob('*')) if p.is_file()]
  assertion_files=[dest/'floor-model-results.json'] if suite=='floor-model' else [dest/'audit-results.json',dest/'restart-results.json']
  leaves=[]
  for p in assertion_files:
   if p.exists():
    data=json.loads(p.read_text());leaves += [{'name':c['name'],'status':c['status'],'phase':'restart' if p.name=='restart-results.json' else 'audit','evidenceFile':str(p)} for c in data.get('checks',[])]
  row={'suite':suite,'mode':mode,'domain':'interactions','startedAt':job_start,'completedAt':completed,'exitCode':code,'command':command,'log':str(log),'evidenceFiles':evidence_files,'script':str(script),'scriptSha256':script_before,'scriptUnchanged':script_before==sha(script),'before':before_job,'after':after_job,'runtimeUnchanged':before_job==after_job,'assertionLeaves':leaves,'passed':sum(c['status']=='passed'for c in leaves),'failed':sum(c['status']=='failed'for c in leaves)}
  rows.append(row);save();print(json.dumps({k:row[k]for k in ['suite','mode','startedAt','completedAt','exitCode','passed','failed','runtimeUnchanged','log']}),flush=True)
save();final=json.loads((out/'execution-envelope.json').read_text());assert final['sourceUnchanged'] and final['asarUnchanged'];assert all(r['exitCode']==0 and r['failed']==0 and r['runtimeUnchanged'] and r['scriptUnchanged'] for r in rows)
print('FINAL_ASSERTION_LEAVES',sum(r['passed'] for r in rows),'passed',sum(r['failed'] for r in rows),'failed',flush=True)
