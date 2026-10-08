from pathlib import Path
import os,sys,json,datetime,hashlib,subprocess,signal

ROOT=Path(__file__).resolve().parents[3]
BASE=ROOT/'artifacts/rc18/ordinary-independent/classroom'
HERE=Path(__file__).resolve().parent
FREEZE=ROOT/'artifacts/rc18/frozen-source.json'
ARCHIVE=ROOT/'dist-rc18-final/win-unpacked/resources/app.asar'
EXPECTED_FREEZE='659159e9abad256c01900dfde6ea58c0754cb88396bbb8e18dc0bdd8798e6694'
EXPECTED_ASAR='a85789dd38dd2ddea662a1c5bb186d9e68ae537419c75200d73d116710c2026a'
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
frozen=json.loads(FREEZE.read_text())
source=lambda:{p:sha(ROOT/p) for p in sorted(frozen['files'])}
harness=lambda:{str(p.relative_to(ROOT)):sha(p) for p in sorted([*HERE.glob('*.cjs'),HERE/'run.py',ROOT/'scripts/qa-tool-control.cjs',ROOT/'scripts/package-boundary.cjs'])}
assert sha(FREEZE)==EXPECTED_FREEZE and sha(ARCHIVE)==EXPECTED_ASAR
assert source()==dict(sorted(frozen['files'].items()))
original=json.loads((ROOT/'artifacts/rc18-report/ordinary-independent-execution-plan.json').read_text())['groups']
plans=[]
for g in original:
 if g['domain']!='classroom':continue
 mode=g['mode'];script=HERE/Path(g['historicalScriptNowAvailable']).name
 label=Path(g['environment']['FLOWER_CLASSROOM_OUT']).name
 dest=BASE/mode/label
 runtime=ROOT if mode=='source' else ARCHIVE
 env={**g['environment'],'FLOWER_QA_ROOT':str(ROOT),'FLOWER_SOURCE_ROOT':str(runtime),'FLOWER_PACKAGE_MAIN':str(runtime/'src/main.cjs'),'FLOWER_CLASSROOM_OUT':str(dest),'FLOWER_DRAW_MATRIX_OUT':str(dest),'FLOWER_MODEL_SCRIPT':str(script),'CLASSROOM_RUNTIME_ROOT':str(runtime),'CLASSROOM_OBSERVER_OUT':str(dest/'observer'),'NODE_OPTIONS':'--require='+str(HERE/'observe.cjs')}
 if script.name=='classroom-event-identity-model.cjs':
  cmd=['node',str(script)] if mode=='source' else [str(ROOT/'node_modules/electron/dist/electron'),'--no-sandbox','--ozone-platform=headless','--disable-gpu',str(HERE/'model-electron-wrapper.cjs')]
  reports=[str(dest/'results.json')]
 else:
  cmd=['node',str(script)];reports=[str(dest/'audit-results.json'),str(dest/'restart-results.json')]
 plans.append({'mode':mode,'group':g['group'],'suite':g['suite'],'expectedPassed':g['expectedPassed'],'script':str(script),'command':cmd,'environment':env,'evidenceDirectory':str(dest),'evidenceFiles':reports})
planfile=BASE/'execution-plan.json'
if not planfile.exists():planfile.write_text(json.dumps({'createdAt':now(),'freezeSha256':EXPECTED_FREEZE,'asarSha256':EXPECTED_ASAR,'sourceAtPlan':source(),'harnessAtPlan':harness(),'plannedBeforeExecution':True,'groups':plans},ensure_ascii=False,indent=2)+'\n')
selected=[p for p in plans if (len(sys.argv)<2 or p['mode']==sys.argv[1]) and (len(sys.argv)<3 or Path(p['evidenceDirectory']).name==sys.argv[2])]
for p in selected:
 dest=Path(p['evidenceDirectory']);dest.mkdir(parents=True,exist_ok=True)
 if (dest/'execution.json').exists():raise RuntimeError('Refusing to overwrite completed attempt: '+str(dest))
 before=source();hbefore=harness();astart=sha(ARCHIVE);started=now();errors=[]
 row={**{k:p[k] for k in ['suite','group','mode','script','command','evidenceDirectory','evidenceFiles','expectedPassed']},'startedAt':started,'harnessAtStart':hbefore,'plannedBeforeExecution':True}
 (dest/'execution-start.json').write_text(json.dumps(row,ensure_ascii=False,indent=2)+'\n')
 env={**os.environ,**p['environment']};Path(env['TMPDIR']).mkdir(parents=True,exist_ok=True)
 env.pop('FLOWER_QA_ALLOW_UNFROZEN',None)
 with (dest/'run.log').open('w') as log:
  proc=subprocess.Popen(p['command'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=proc.wait(timeout=430)
  except subprocess.TimeoutExpired:
   errors.append('Outer subprocess timeout');os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=5)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
   code=124
 completed=now();count=passed=0
 for name in p['evidenceFiles']:
  file=Path(name)
  if not file.exists():errors.append('Missing planned report: '+name);continue
  try:r=json.loads(file.read_text())
  except Exception as e:errors.append('Invalid report '+name+': '+str(e));continue
  checks=r.get('checks',[]);count+=len(checks);passed+=sum(c.get('status')=='passed' for c in checks)
  if not checks:errors.append('Zero-case report: '+name)
  if r.get('errors'):errors.append('Report errors: '+name)
  if r.get('runtimeUnchanged') is not True:errors.append('Runtime mismatch in report: '+name)
  if r.get('archiveUnchanged') is False:errors.append('Archive mismatch in report: '+name)
 if count!=p['expectedPassed'] or passed!=count:errors.append(f'Expected {p["expectedPassed"]} passed leaves, got {passed}/{count}')
 manifest=dest/'run-manifest.json'
 if len(p['evidenceFiles'])==2:
  if not manifest.exists():errors.append('Missing child run manifest')
  else:
   runs=json.loads(manifest.read_text()).get('runs',[])
   if [r['phase'] for r in runs]!=['audit','restart']:errors.append('Missing/reordered audit+restart phases')
   for r in runs:
    if r.get('exitCode')!=0 or r.get('signal') or r.get('error'):errors.append('Child failed: '+json.dumps(r,ensure_ascii=False))
 observations=list((dest/'observer').glob('*-runtime.json'));observed=[]
 if not observations:errors.append('Missing dependency/runtime observations')
 for obs in observations:
  o=json.loads(obs.read_text());observed.append(o)
  if o.get('violations') or not o.get('dependenciesUnchanged') or not o.get('runtimeUnchanged'):errors.append('Observer mismatch: '+str(obs))
  for r in o.get('spawns',[]):
   if r.get('exitCode')!=0 or r.get('signal') or r.get('error'):errors.append('Observed child failed: '+str(obs))
  if o.get('electron') and Path(p['script']).name!='classroom-event-identity-model.cjs':
   if not o.get('windows'):errors.append('Native run has no renderer: '+str(obs))
   for w in o.get('windows',[]):
    if '/src/index.html' not in w['url'] or not w['url'].startswith('file://'+str(Path(p['environment']['CLASSROOM_RUNTIME_ROOT']))) or w['preload']!=str(Path(p['environment']['CLASSROOM_RUNTIME_ROOT'])/'src/preload.cjs'):errors.append('Wrong native renderer/preload: '+str(obs))
 if len(p['evidenceFiles'])==2 and sum(bool(o.get('electron')) for o in observed)!=2:errors.append('Expected exactly two observed native phases')
 after=source();hafter=harness();aend=sha(ARCHIVE)
 if code!=0:errors.append('Top-level exit '+str(code))
 if before!=after or after!=dict(sorted(frozen['files'].items())):errors.append('Frozen source changed')
 if hbefore!=hafter:errors.append('Harness/dependency changed during execution')
 if astart!=aend or aend!=EXPECTED_ASAR:errors.append('Formal ASAR changed')
 row.update({'completedAt':completed,'exitCode':code,'signal':-code if code<0 else None,'harnessError':None,'harnessAtFinish':hafter,'checkCount':count,'passedCheckCount':passed,'validationErrors':errors,'passed':not errors,'executionEvidenceFiles':[str(manifest)] if manifest.exists() else []})
 row['executionEvidenceFiles'] += [str(f) for f in observations]
 proof={'createdAt':completed,'sourceAtStart':before,'sourceAtFinish':after,'sourceUnchanged':before==after,'frozenSourceManifestSha256':EXPECTED_FREEZE,'asarSha256':astart,'asarSha256After':aend,'asarUnchanged':astart==aend,'syntheticOnly':True,'windowsExecuted':False,'suites':[row]}
 (dest/'execution.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'group':p['group'],'passed':not errors,'leaves':f'{passed}/{count}','errors':errors,'execution':str(dest/'execution.json')},ensure_ascii=False),flush=True)
 if errors:sys.exit(1)
