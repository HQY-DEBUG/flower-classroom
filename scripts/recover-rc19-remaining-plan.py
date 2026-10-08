from pathlib import Path
import json,re,collections,sys
ROOT=Path(__file__).resolve().parent.parent;BASE=ROOT.parent.parent/'flower-rc18-work/FlowerClassroom-source'
sys.path.insert(0,str(ROOT/'scripts'));from rc19_evidence import regular_outputs
m=json.load(open(BASE/'artifacts/rc18/final-test-manifest.json'));ordinary={g['group']:g for g in json.load(open(BASE/'artifacts/rc18-report/ordinary-independent-execution-plan.json'))['groups']};groups=[]
def family(name):
 for prefix in ['legacy-targeted','new-targeted','features','extension','rc13-inherited','rc14-inherited','rc18-ui']:
  if name.startswith(prefix+'-'):return prefix
 if name.startswith('rc14-'):return 'focused'
 if name.startswith('rc15-independent-'):return 'inherited-folder'
 if name=='rc15-folder-ui':return 'supplemental'
 if name=='rc18-independent-folder-configuration':return 'rc18-independent-folder'
 if name=='rc18-independent-restore':return 'independent-restore'
 if name.startswith('rc18-independent-'):return 'rc18-independent'
 if name.startswith('reaudit-'):return 'ordinary-independent'
 if name in ['package-unit','startup-identity','preview']:return 'standalone'
 return 'regular'
def remap(value):
 return value.replace(str(BASE),'{ROOT}').replace('dist-rc18-final/win-unpacked/resources/app.asar','{ASAR_RELATIVE}')
for g in m['groups']:
 mode,name=g['mode'],g['group']
 if mode=='source' and name.startswith('source-'):continue
 e=g['execution'];fam=family(name);dest='{ROOT}/artifacts/rc19/remaining/{RUN_ID}/'+fam+'/'+mode+'/'+name;main='{ROOT}/src/main.cjs' if mode=='source' else '{ASAR}/src/main.cjs'
 env={'FLOWER_PACKAGE_MAIN':main,'FLOWER_FREEZE_DIR':'artifacts/rc19','FLOWER_QA_FREEZE_FILE':'{ROOT}/artifacts/rc19/frozen-source.json'}
 script=e.get('script') or e.get('harnessPath');command=e.get('command');proof=[]
 if script:script=remap(script).replace('{ROOT}/','')
 if not script and command:
  script=next((remap(s).replace('{ROOT}/','') for s in command if s.endswith(('.cjs','.py')) and 'qa-package-isolated' not in s),None)
 if fam=='rc18-independent':script='scripts/rc18-independent/audit-'+g['suite']+'.cjs'
 if name=='package-unit':script='scripts/qa-extracted-unit-rc18.cjs'
 if name=='startup-identity':script='scripts/qa-startup-identity-rc18.cjs'
 if name=='preview':script='scripts/qa-preview-lifecycle-rc18.py'
 assert script,(name,e.keys())
 code=(ROOT/script).read_text() if (ROOT/script).exists() else ''
 for key in set(re.findall(r'process\.env\.([A-Z0-9_]+)',code)):
  if key.endswith('_OUT'):env[key]=dest
  if key.endswith('_MAIN'):env[key]=main
 if fam=='regular':
  command=[remap(s) for s in command];command[0]='{ROOT}/node_modules/electron/dist/electron' if 'electron' in command[0] else 'node';raw=['{ROOT}/'+p for p in regular_outputs('packaged',g['suite'])]
  if name=='primary':env.update(FLOWER_PARITY_OUT='{ROOT}/artifacts/rc9-packaged',FLOWER_PARITY_DATA='{ROOT}/.qa-parity-packaged')
  if name=='lazy-excel':env['FLOWER_LAZY_EXCEL_OUT']='{ROOT}/artifacts/rc9/lazy-excel-packaged'
  if name=='adversarial':env['FLOWER_ADVERSARIAL_OUT']='{ROOT}/artifacts/rc9/adversarial-packaged'
  # Keep the exact inherited fixed output contract rather than redirecting unsupported environment keys.
  env={k:v for k,v in env.items() if not k.endswith('_OUT') or name in ['primary','lazy-excel','adversarial']}
 else:
  command=['python' if script.endswith('.py') else 'node',script]
  captures={x['file']:x['rawFile'] for x in e.get('evidenceCapture',[])}
  raw=[dest+'/'+re.sub(r'^\d+-','',Path(captures.get(f,f)).name) for f in g['evidenceFiles']]
 if fam in ['inherited-folder','supplemental']:env['FLOWER_FOLDER_PAYLOAD']='{PAYLOAD}'
 if fam.startswith('rc18-independent'):
  env.update(RC18_AUDIT_MAIN=main,RC18_AUDIT_RUNTIME='{ROOT}' if mode=='source' else '{EXTRACTED_RUNTIME}',RC18_AUDIT_OUT=dest)
 if fam=='rc18-ui' or fam=='independent-restore':
  proof=[dest+'/run-envelope.json']
  if 'restore-normal' in name or 'restore-protected' in name:
   shared='{ROOT}/artifacts/rc19/remaining/{RUN_ID}/rc18-ui/'+mode+'/restore';env['FLOWER_RC18_RESTORE_OUT']=shared;phase=name.split('-')[-1];raw=[shared+'/'+phase+'/results.json'];proof=[shared+'/'+phase+'/run-envelope.json']
 if name=='rc14-inherited-crash-recovery':env['FLOWER_REVIEW_OUT']='{ROOT}/artifacts/rc19/remaining/{RUN_ID}/rc14-inherited/'+mode
 if name=='rc14-inherited-feature':env['FLOWER_REVIEW_OUT']='{ROOT}/artifacts/rc19/remaining/{RUN_ID}/rc14-inherited/'+mode
 if name=='rc14-inherited-crash-recovery':raw=[env['FLOWER_REVIEW_OUT']+'/restart-results.json']
 if name=='rc14-inherited-feature':raw=[env['FLOWER_REVIEW_OUT']+'/results.json']
 if fam=='features':proof=list(raw)
 if fam=='extension':
  extra={'rc12-review':'execution.json','rc12-tools':'execution.json','rc12-import':'results.json','rc12-format':'execution.json','rc12-text':'execution.json','target-confirmations':'run.json','album-refresh':'execution.json'}[g['suite']];proof=[dest+'/'+extra]
 if name=='package-unit':raw=['{ROOT}/artifacts/rc19/package-unit/run.log','{ROOT}/artifacts/rc19/package-unit/results.json']
 if name=='startup-identity':env['FLOWER_STARTUP_ARCHIVE']='{ASAR}';raw=['{ROOT}/artifacts/rc19/startup-identity/results.json']
 if name=='preview':env['FLOWER_PREVIEW_OUT']=dest
 if fam=='ordinary-independent':
  recipe=ordinary[name];env.update({k:remap(v) for k,v in recipe['environment'].items()});env['TMPDIR']='{ROOT}/artifacts/rc19/remaining/{RUN_ID}/tmp';env['FLOWER_PACKAGE_MAIN']=main
  for key in list(env):
   if key.endswith('_OUT'):env[key]=dest
  if name.startswith('reaudit-migration-'):
   command=[remap(s) for s in e['command']];command[0]='{ROOT}/node_modules/electron/dist/electron' if 'electron' in command[0] else 'node';command[-1]='{ROOT}/'+script
   env.update(FLOWER_MIGRATION_EVIDENCE=dest+'/processes',FLOWER_MIGRATION_RUN_ID='{RUN_ID}/'+mode+'/'+g['suite'])
   if 'migration-main-' in name:
    phase='restart' if name.endswith('restart') else 'preview';env.update(FLOWER_MIGRATION_MAIN_OUT='{ROOT}/artifacts/rc19/remaining/{RUN_ID}/ordinary-independent/'+mode+'/migration-shared-main-fixture',FLOWER_MIGRATION_EXPECT_COHERENT='1',FLOWER_MIGRATION_MAIN_PHASE=phase);raw=[env['FLOWER_MIGRATION_MAIN_OUT']+'/'+phase+'-result.json']
  elif name.startswith('reaudit-rules-'):
   runtime='{ROOT}' if mode=='source' else '{EXTRACTED_RUNTIME}';entryroot='{ROOT}' if mode=='source' else '{ASAR}'
   env.update(RULE_AUDIT_REPO='{ROOT}',RULE_AUDIT_RUNTIME=runtime,RULE_AUDIT_ENTRY_ROOT=entryroot,RULE_AUDIT_ASAR='{ASAR}',RULE_AUDIT_ASAR_SHA='{ASAR_SHA256}',RULE_AUDIT_OBSERVER_OUT=dest+'/process-evidence',FLOWER_RULE_MODE=mode,FLOWER_RULE_SOURCE=runtime,FLOWER_RULE_MAIN=main,FLOWER_RULE_OUT=dest,FLOWER_RULE_ARCHIVE='' if mode=='source' else '{ASAR}',FLOWER_RULE_EXPECTED_SHA='{ASAR_SHA256}',NODE_OPTIONS='--require={ROOT}/scripts/rc18-independent/ordinary-rules/observe.cjs')
   raw=[dest+'/'+Path(e.get('report') or e['plannedEvidence']).name]
  elif name.startswith('reaudit-imports-'):
   env.update(AUDIT_OUT=dest,AUDIT_PAYLOAD='{PAYLOAD}',AUDIT_ASAR='{ASAR}',AUDIT_MAIN=main)
  elif name.startswith('reaudit-classroom-'):
   runtime='{ROOT}' if mode=='source' else '{ASAR}';env.update(FLOWER_QA_ROOT='{ROOT}',FLOWER_CLASSROOM_OUT=dest,FLOWER_DRAW_MATRIX_OUT=dest,FLOWER_SOURCE_ROOT=runtime,FLOWER_MODEL_SCRIPT='{ROOT}/'+script,FLOWER_HEADLESS_TEST='1',CLASSROOM_RUNTIME_ROOT=runtime,CLASSROOM_OBSERVER_OUT=dest+'/observer',NODE_OPTIONS='--require={ROOT}/scripts/rc18-independent/ordinary-classroom/observe.cjs')
   if 'identity-model' in name and mode=='packaged':command=['{ROOT}/node_modules/electron/dist/electron','--no-sandbox','--ozone-platform=headless','--disable-gpu','{ROOT}/scripts/rc18-independent/ordinary-classroom/model-electron-wrapper.cjs']
 invocation=mode+'/'+name
 if 'rc18-ui-restore-' in name:invocation=mode+'/rc18-restore-two-phases'
 groups.append({'mode':mode,'group':name,'suite':g['suite'],'family':fam,'category':g['category'],'invocationKey':invocation,'command':command,'environment':env,'rawAssertionReports':raw,'executionProofReports':proof,'baselinePositiveCaseCount':g['passed'],'baselineEvidenceFiles':g['evidenceFiles'],'baselineExecutionFile':e['originalExecutionFile'],'baselineExecutionPointer':e.get('originalExecutionPointer',''),'prerequisites':[],'notes':['Reconstructed after executor reset from exact RC18 final selected identity, current script output environment declarations and preserved ordinary launch recipes. Historical cases define names only, not current passes.'],'status':'planned_only_not_executed'})
assert len(groups)==184 and len(set(g['invocationKey'] for g in groups))==182
out={'schema':'rc19-inherited-remaining-run-plan-v1','scope':'Exactly184 inherited groups outside26 regular source groups','counts':dict(collections.Counter(g['family'] for g in groups)),'groups':groups}
p=ROOT/'artifacts/rc19/inherited-remaining-run-plan.json';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n');print(len(groups),'groups',len(set(g['invocationKey'] for g in groups)),'launches')
