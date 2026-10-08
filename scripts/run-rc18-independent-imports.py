from pathlib import Path
import datetime,json,hashlib,subprocess,os,sys
r=Path(__file__).resolve().parent.parent
base=r/'artifacts/rc18/ordinary-independent/imports';base.mkdir(parents=True,exist_ok=True)
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
rel=lambda p:str(Path(p).resolve().relative_to(r))
freeze=r/'artifacts/rc18/frozen-source.json';f=json.loads(freeze.read_text());asar=r/'dist-rc18-final/win-unpacked/resources/app.asar'
assert sha(freeze)=='659159e9abad256c01900dfde6ea58c0754cb88396bbb8e18dc0bdd8798e6694'
assert sha(asar)=='a85789dd38dd2ddea662a1c5bb186d9e68ae537419c75200d73d116710c2026a'
binding=lambda:{k:sha(r/k) for k in f['files']}
before=binding();assert before==f['files'];asar_before=sha(asar)
recipes=[g for g in json.loads((r/'artifacts/rc18-report/ordinary-independent-execution-plan.json').read_text())['groups'] if g['domain']=='imports']
if len(sys.argv)>1:recipes=[g for g in recipes if (g['mode']+'-'+('snapshot' if 'snapshot' in g['suite'] else 'focused')) in sys.argv[1:]]
rows=[];started=now();manifest=base/'run-manifest.json'
if manifest.exists():manifest.rename(base/('run-manifest.prior-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')+'.json'))
def save():
 record={'domain':'imports','startedAt':started,'completedAt':now(),'sourceAtStart':before,'sourceAtFinish':binding(),'sourceUnchanged':before==binding(),'sourceManifestSha256':sha(freeze),'asarSha256':asar_before,'asarSha256After':sha(asar),'asarUnchanged':asar_before==sha(asar),'syntheticOnly':True,'windowsExecuted':False,'suites':rows}
 manifest.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
for recipe in recipes:
 mode=recipe['mode'];kind='snapshot' if 'snapshot' in recipe['suite'] else 'focused';directory=base/mode/kind;directory.mkdir(parents=True,exist_ok=True)
 script=Path(recipe['historicalScriptNowAvailable']);entry=r/('src/main.cjs' if mode=='source' else 'dist-rc18-final/win-unpacked/resources/app.asar/src/main.cjs')
 deps=[script,r/'scripts/qa-feature-child.cjs',r/'scripts/qa-rc18-import-cases.json',r/'scripts/package-boundary.cjs',Path(__file__)]
 harness=lambda:{rel(p):sha(p) for p in deps};hb=harness();source_start=binding();archive_start=sha(asar);start=now();log=directory/'outer-run.log'
 for name in ['results.json','process.json','execution.json','outer-run.log']:
  old=directory/name
  if old.exists():old.rename(directory/(name+'.prior-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')))
 env={**os.environ,**recipe['environment'],'AUDIT_OUT':str(directory),'AUDIT_PAYLOAD':str(r/'dist-rc18-final/win-unpacked'),'AUDIT_ASAR':str(asar),'AUDIT_MAIN':str(entry),'FLOWER_PACKAGE_MAIN':str(entry)}
 command=['node',str(script)];errors=[];code=None;signal=None
 (directory/'execution-plan.json').write_text(json.dumps({'mode':mode,'group':recipe['group'],'command':command,'entry':str(entry),'expectedLeaves':recipe['expectedPassed'],'startedAt':start,'harnessAtStart':hb},indent=2)+'\n')
 with log.open('w') as stream:
  try:result=subprocess.run(command,cwd=r,env=env,stdout=stream,stderr=subprocess.STDOUT,timeout=300);code=result.returncode;signal=-code if code<0 else None
  except subprocess.TimeoutExpired as e:code=124;errors.append(str(e))
 report=None;process=None
 for name in ['results.json','process.json']:
  try:value=json.loads((directory/name).read_text())
  except (OSError,ValueError) as e:errors.append(name+': '+str(e));continue
  if name=='results.json':report=value
  else:process=value
 cases=(report or {}).get('leaves' if kind=='snapshot' else 'checks',[])
 expected=json.loads((r/'scripts/qa-rc18-import-cases.json').read_text())[kind]['expectedCaseNames']
 if not report or report.get('completed') is not True or not cases or len(cases)!=recipe['expectedPassed'] or any(c.get('status')!='passed' for c in cases):errors.append('Missing/incomplete/wrong-count/failed assertion evidence')
 if report and sorted(c['name'] for c in report.get('checks',[]))!=sorted(expected):errors.append('Required case set mismatch')
 if not process or process.get('exitCode')!=0 or process.get('error') or process.get('signal') or process.get('status')!=0 or process.get('evidenceErrors'):errors.append('Child process did not complete cleanly')
 ha=harness();source_end=binding();archive_end=sha(asar)
 if hb!=ha or source_start!=source_end or archive_start!=archive_end:errors.append('Harness/runtime binding changed during execution')
 row={'mode':mode,'group':recipe['group'],'suite':recipe['suite'],'script':rel(script),'command':command,'entry':str(entry),'startedAt':start,'completedAt':now(),'exitCode':code if code else (1 if errors else 0),'outerExitCode':code,'signal':signal,'error':None,'harnessError':'; '.join(errors) or None,'evidenceErrors':errors,'harnessAtStart':hb,'harnessAtFinish':ha,'scriptUnchanged':hb==ha,'sourceAtStart':source_start,'sourceAtFinish':source_end,'asarSha256Before':archive_start,'asarSha256After':archive_end,'evidenceFiles':[rel(directory/'results.json')],'executionEvidenceFiles':[rel(directory/'process.json'),rel(directory/'execution.json')],'evidenceDirectory':rel(directory),'log':rel(log),'expectedPassed':recipe['expectedPassed'],'verifiedPassed':sum(c.get('status')=='passed' for c in cases),'evidenceSha256':sha(directory/'results.json') if (directory/'results.json').exists() else None}
 (directory/'execution.json').write_text(json.dumps(row,ensure_ascii=False,indent=2)+'\n');rows.append(row);save();print(json.dumps({'mode':mode,'kind':kind,'exitCode':row['exitCode'],'passed':row['verifiedPassed'],'errors':errors}),flush=True)
 if row['exitCode']!=0:break
save()
assert len(rows)==len(recipes) and all(row['exitCode']==0 for row in rows)
