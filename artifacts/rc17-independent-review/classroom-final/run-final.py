import os,json,pathlib,hashlib,subprocess,datetime,sys
root=pathlib.Path('/tmp/flower-classroom-workspace/flower-rc17-work/FlowerClassroom-source')
out=root/'artifacts/rc17-independent-review/classroom-final';scripts=out/'scripts';archive=root/'dist-rc17-final/win-unpacked/resources/app.asar'
expected_archive='02d81b32d623225861231181c0285ef9e0683b99dbdb0c2a4b349e866fd66b08'
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def identity():
 files=[root/'package.json']
 for part in ['src','assets']:files.extend(p for p in (root/part).rglob('*') if p.is_file())
 hashes={str(p.relative_to(root)):sha(p) for p in sorted(files)}
 return {'capturedAt':now(),'sourceRoot':str(root),'sourceSha256':hashlib.sha256(json.dumps(hashes,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'sourceFiles':hashes,'asarPath':str(archive),'asarSha256':sha(archive)}
baseline=identity();assert baseline['asarSha256']==expected_archive
(out/'before.json').write_text(json.dumps(baseline,indent=2));runs=[]
def report():
 (out/'results.json').write_text(json.dumps({'freezeAt':'2026-10-07T03:58:53.260811Z','startedAt':baseline['capturedAt'],'updatedAt':now(),'sourceRoot':str(root),'expectedAsarSha256':expected_archive,'runnerSha256':sha(__file__),'runs':runs,'syntheticOnly':True,'windowsExecuted':False},indent=2))
plan=[('aba','D01-new-draw-ABA','classroom-draw-aba-transactions.cjs'),('strict-pet','D01-new-pet-boundaries','classroom-pet-draw-strict-boundaries.cjs'),('identical-ui','D01-new-remote-redraw-UI','classroom-draw-identical-ui.cjs'),('drafts','D01-new-draft-controls','classroom-candidate-draft-boundaries.cjs'),('model','D01-identity-model','classroom-event-identity-model.cjs'),('preceding-ordinary','preceding-RC16-ordinary-draw-regression','draw-transaction-matrix.cjs')]
for mode in ['source','asar']:
 for name,group,filename in plan:
  destination=out/mode/name;destination.mkdir(parents=True,exist_ok=True);script=scripts/filename
  before=identity();assert before['sourceSha256']==baseline['sourceSha256'] and before['asarSha256']==expected_archive,'Frozen runtime changed before '+mode+'/'+name
  (destination/'identity-before.json').write_text(json.dumps(before,indent=2))
  target=root if mode=='source' else archive
  env=dict(os.environ,TMPDIR='/tmp/flower-classroom-workspace/flower-rc17-temp',FLOWER_QA_ROOT=str(root),FLOWER_PACKAGE_MAIN=str(target/'src/main.cjs'),FLOWER_CLASSROOM_OUT=str(destination),FLOWER_DRAW_MATRIX_OUT=str(destination),FLOWER_SOURCE_ROOT=str(target),FLOWER_MODEL_SCRIPT=str(script),FLOWER_HEADLESS_TEST='1')
  command=['node',str(script)]
  if name=='model' and mode=='asar':command=[str(root/'node_modules/electron/dist/electron'),'--no-sandbox','--ozone-platform=headless','--disable-gpu',str(scripts/'model-electron-wrapper.cjs')]
  started=now();p=subprocess.run(command,cwd=root,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=210);completed=now();(destination/'execution.log').write_text(p.stdout)
  after=identity();(destination/'identity-after.json').write_text(json.dumps(after,indent=2))
  result_paths=[destination/'results.json'] if name=='model' else [destination/'audit-results.json',destination/'restart-results.json']
  cases=[];errors=[]
  for rp in result_paths:
   if rp.exists():
    payload=json.loads(rp.read_text());cases.extend(payload.get('checks',[]));errors.extend(payload.get('errors',[]))
   else:errors.append('Missing result file '+str(rp))
  row={'id':mode+'/'+name,'group':group,'layer':'native Electron actual ASAR' if mode=='asar' and name!='model' else 'ASAR reducer under Electron' if mode=='asar' else 'source reducer' if name=='model' else 'native Electron frozen source','startedAt':started,'completedAt':completed,'exitCode':p.returncode,'script':str(script),'scriptSha256':sha(script),'wrapperSha256':sha(scripts/'model-electron-wrapper.cjs') if name=='model' and mode=='asar' else None,'command':command,'target':str(target),'sourceSha256Before':before['sourceSha256'],'sourceSha256After':after['sourceSha256'],'asarSha256Before':before['asarSha256'],'asarSha256After':after['asarSha256'],'sourceUnchanged':before['sourceSha256']==after['sourceSha256'],'asarUnchanged':before['asarSha256']==after['asarSha256'],'identityBefore':str(destination/'identity-before.json'),'identityAfter':str(destination/'identity-after.json'),'resultPaths':[str(x) for x in result_paths],'phaseManifest':str(destination/'run-manifest.json') if name!='model' else None,'executionLog':str(destination/'execution.log'),'passed':sum(x['status']=='passed' for x in cases),'failed':sum(x['status']=='failed' for x in cases),'errors':errors}
  runs.append(row);report();print(mode,name,'exit',p.returncode,'pass',row['passed'],'fail',row['failed'],'errors',len(errors),flush=True)
  if not row['sourceUnchanged'] or not row['asarUnchanged']:raise RuntimeError('Frozen runtime changed during '+mode+'/'+name)
final=identity();(out/'after.json').write_text(json.dumps(final,indent=2));report();sys.exit(1 if any(r['exitCode'] or r['failed'] or r['errors'] for r in runs) else 0)
