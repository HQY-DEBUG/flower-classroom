from pathlib import Path
import argparse,datetime,hashlib,json,os,signal,subprocess,time,uuid,shutil
repo=Path(__file__).resolve().parents[2];base=repo/'artifacts/rc18/ordinary-independent/migration';base.mkdir(parents=True,exist_ok=True)
parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['source','packaged','both'],default='both');parser.add_argument('--only');args=parser.parse_args()
all_recipes=json.loads((base/'recipes.json').read_text())['groups'];recipes=[x for x in all_recipes if (args.mode=='both' or x['mode']==args.mode) and (not args.only or any(token in x['suite'] for token in args.only.split(',')))]
assert recipes
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat();sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest();frozen_path=repo/'artifacts/rc18/frozen-source.json';frozen=json.loads(frozen_path.read_text());expected_freeze='659159e9abad256c01900dfde6ea58c0754cb88396bbb8e18dc0bdd8798e6694';assert sha(frozen_path)==expected_freeze
archive=repo/'dist-rc18-final/win-unpacked/resources/app.asar';expected_archive='a85789dd38dd2ddea662a1c5bb186d9e68ae537419c75200d73d116710c2026a';assert sha(archive)==expected_archive
source_hashes=lambda:{n:sha(repo/n) for n in frozen['files']}
def harness_hashes():
 paths=list((repo/'scripts/rc18-migration-audit').glob('*'))+[repo/'scripts/package-boundary.cjs',repo/'tests/pet-fixtures.cjs']
 return {str(p.relative_to(repo)):sha(p) for p in sorted(paths) if p.is_file()}
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')+'-'+uuid.uuid4().hex[:8];runroot=base/stamp;runroot.mkdir();snapshot=runroot/'executed-harness';snapshot.mkdir()
for p in (repo/'scripts/rc18-migration-audit').iterdir():
 if p.is_file():shutil.copy2(p,snapshot/p.name)
(base/'latest-run.txt').write_text(str(runroot.relative_to(repo))+'\n')
selections_path=base/'selections.json';selections=json.loads(selections_path.read_text()) if selections_path.exists() else {'groups':[]};by_id={g['group']:g for g in selections['groups']};runs=[]
print('MIGRATION_RUN',str(runroot.relative_to(repo)),flush=True)
for g in recipes:
 mode=g['mode'];suite=g['suite'];short=suite.split(mode+'-')[-1];directory=runroot/mode/short;directory.mkdir(parents=True,exist_ok=False);evidence_dir=directory/'processes'
 entry=repo/'src/main.cjs' if mode=='source' else archive/'src/main.cjs'
 script=repo/'scripts/rc18-migration-audit'/Path(g['historicalScriptNowAvailable']).name
 command=list(g['command']);command[-1]=str(script);command[0]=str(repo/'node_modules/electron/dist/electron') if 'electron' in command[0] else 'node'
 env={**os.environ};env.pop('FLOWER_CRASH_CASE',None);env.pop('FLOWER_CRASH_HOME',None)
 env.update({'FLOWER_PACKAGE_MAIN':str(entry),'FLOWER_HEADLESS_TEST':'1','FLOWER_MIGRATION_RUN_ID':stamp+'/'+mode+'/'+short,'FLOWER_MIGRATION_EVIDENCE':str(evidence_dir),'XDG_CACHE_HOME':'/tmp/flower-rc18-migration-cache','TMPDIR':str(repo.parent.parent/'flower-rc18-temp')})
 Path(env['TMPDIR']).mkdir(parents=True,exist_ok=True)
 raw_output=directory/'assertions'
 for key,value in g['environment'].items():
  if key.endswith('_OUT'):
   if key=='FLOWER_MIGRATION_MAIN_OUT':raw_output=runroot/mode/'main-fixture';raw_output.mkdir(parents=True,exist_ok=True)
   env[key]=str(raw_output)
  elif key not in ['FLOWER_PACKAGE_MAIN','TMPDIR']:env[key]=value
 result_name=Path(g['plannedResultFiles'][0]).name;result_path=raw_output/result_name
 before=source_hashes();assert before==frozen['files'];hbefore=harness_hashes();abefore=sha(archive);started=now();start_ns=time.time_ns()
 row={'id':stamp+'/'+mode+'/'+short,'suite':suite,'group':g['group'],'mode':mode,'domain':'migration','expectedPassed':g['expectedPassed'],'expectedObservations':0,'script':str(script),'command':command,'entry':str(entry),'startedAt':started,'evidenceFiles':[str(result_path.relative_to(repo))],'evidenceDirectory':str(directory.relative_to(repo)),'harnessAtStart':hbefore,'executionLog':str((directory/'execution.log').relative_to(repo)),'environment':{k:v for k,v in env.items() if k.startswith('FLOWER_') or k in ['TMPDIR','XDG_CACHE_HOME']}}
 (directory/'execution-plan.json').write_text(json.dumps(row,ensure_ascii=False,indent=2)+'\n')
 error=None;sig=None
 with (directory/'execution.log').open('w') as log:
  proc=subprocess.Popen(command,cwd=repo,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
  try:code=proc.wait(timeout=360)
  except subprocess.TimeoutExpired:
   error='Outer migration group exceeded 360 seconds';os.killpg(proc.pid,signal.SIGTERM)
   try:code=proc.wait(timeout=10)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);code=proc.wait()
  if code<0:sig=signal.Signals(-code).name
 row.update({'completedAt':now(),'exitCode':code,'signal':sig,'error':error,'harnessAtFinish':harness_hashes(),'logSha256':sha(directory/'execution.log')})
 after=source_hashes();aafter=sha(archive);failures=[];checks=[];report=None
 if result_path.exists():
  try:report=json.loads(result_path.read_text());checks=report.get('checks',[])
  except Exception as e:failures.append('Invalid result JSON: '+str(e))
  if result_path.stat().st_mtime_ns<start_ns:failures.append('Result was not produced by this invocation')
  if isinstance(report,dict) and report.get('error'):failures.append('Fatal report error: '+report['error'])
 else:failures.append('Missing expected assertion report')
 passed=sum(c.get('status')=='passed' for c in checks);failed=[{'name':c.get('name'),'error':c.get('error'),'status':c.get('status')} for c in checks if c.get('status')!='passed'];names=[c.get('name') for c in checks]
 if passed!=g['expectedPassed'] or len(checks)!=g['expectedPassed'] or len(set(names))!=len(names):failures.append('Expected exactly '+str(g['expectedPassed'])+' unique positive assertion leaves; got '+str(passed)+'/'+str(len(checks)))
 process_reports=[]
 for p in sorted(evidence_dir.glob('process-*.json')):
  if p.name.endswith('-start.json'):continue
  try:process_reports.append(json.loads(p.read_text()))
  except Exception as e:failures.append('Invalid process observer report '+str(p)+': '+str(e))
 if not process_reports:failures.append('Missing execution observer reports')
 starts=list(evidence_dir.glob('process-*-start.json'))
 if len(starts)!=len(process_reports):failures.append('A child started but did not finish its observer report')
 for p in process_reports:
  if not (p['sourceUnchanged'] and p['asarUnchanged'] and p['harnessUnchanged']) or p['violations']:failures.append('Process binding changed or violation: '+p['id'])
  if p['exitCode']!=p['expectedExit']:failures.append('Unexpected process exit: '+p['id'])
  if any(not child['passed'] for child in p['children']):failures.append('Child error/signal/exit mismatch: '+p['id'])
 if not any(str(Path(entry).parent/'legacy-migration.cjs') in p['runtimeLoads'] for p in process_reports):failures.append('Selected current migration module not observed')
 if 'migration-main-' in suite:
  observed=[w for p in process_reports for w in p['windows']]
  if not any(w['role']=='main' and w['preload']==str(Path(entry).parent/'preload.cjs') and w['url'].startswith((Path(entry).parent/'index.html').as_uri()) for w in observed):failures.append('Missing real selected main/preload/renderer binding')
 row.update({'actualPassed':passed,'actualFailed':len(failed),'assertionCount':len(checks),'failures':failed,'executionFailures':failures,'scriptUnchanged':row['harnessAtStart']==row['harnessAtFinish'],'processEvidenceFiles':[str(p.relative_to(repo)) for p in sorted(evidence_dir.glob('process-*.json'))]})
 proof={'frozenAt':frozen['frozenAt'],'frozenManifestSha256':expected_freeze,'sourceAtStart':before,'sourceAtFinish':after,'sourceUnchanged':before==after,'asarSha256':abefore,'asarSha256After':aafter,'asarUnchanged':abefore==aafter,'suites':[row],'syntheticOnly':True,'windowsExecuted':False}
 proof['passed']=code==0 and not sig and not error and not failed and not failures and row['scriptUnchanged'] and before==after and abefore==aafter
 proof_path=directory/'execution.json';proof_path.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n');runs.append({'group':g['group'],'mode':mode,'passed':proof['passed'],'expected':g['expectedPassed'],'actualPassed':passed,'proof':str(proof_path.relative_to(repo))})
 # Keep the latest completed run selected even if it failed; never hide a failure.
 by_id[g['group']]={'mode':mode,'group':g['group'],'suite':suite,'proof':str(proof_path.relative_to(repo)),'executionFile':str(proof_path.relative_to(repo)),'executionPointer':'/suites/0','evidenceFiles':row['evidenceFiles'],'executionEvidenceFiles':[str(proof_path.relative_to(repo)),*row['processEvidenceFiles']],'selectionReason':'RC18冻结后迁移普通独立重跑'}
 selections={'groups':list(by_id.values())};selections_path.write_text(json.dumps(selections,ensure_ascii=False,indent=2)+'\n');(runroot/'summary.json').write_text(json.dumps({'runs':runs,'passed':all(r['passed'] for r in runs)},ensure_ascii=False,indent=2)+'\n')
 print('MIGRATION_GROUP',mode,short,'PASS' if proof['passed'] else 'FAIL',str(passed)+'/'+str(g['expectedPassed']),flush=True)
 for item in failed:print('MIGRATION_CASE_FAILURE',item['name'],str(item['error'])[:1200],flush=True)
 for item in failures:print('MIGRATION_BINDING_FAILURE',item,flush=True)
print('MIGRATION_DONE',len(runs),'groups',sum(r['actualPassed'] for r in runs),'positive leaves',flush=True)
raise SystemExit(0 if all(r['passed'] for r in runs) else 1)
