from pathlib import Path
import json,re,shlex,hashlib,collections
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
omitted=json.loads((OUT/'omitted-ordinary-independent-plan.json').read_text())['groups']
def local(s):
 s=re.sub(r'/tmp/flower-classroom-workspace/[^/]+/FlowerClassroom-source',str(ROOT),s)
 return s.replace('dist-rc17-final/','dist-rc18-final/').replace('/flower-rc17-temp','/flower-rc18-temp')
def output(s):return local(s).replace('artifacts/rc17-independent-review/','artifacts/rc18/ordinary-independent-final3/')
rows=[]
for g in omitted:
 r=g['historicalExecution'];c=r['command'];domain=g['group'].split('-')[1]
 if isinstance(c,dict):cmd=[c['executable'],*c.get('args',[])];env=c.get('env',{})
 elif isinstance(c,list):cmd=c;env=r.get('environmentOverrides',{})
 else:cmd=shlex.split(c);env=r.get('environmentOverrides',{})
 cmd=[local(v) for v in cmd];env={k:output(v) for k,v in env.items()}
 if domain=='classroom':
  target=str(ROOT) if g['mode']=='source' else str(ROOT/'dist-rc18-final/win-unpacked/resources/app.asar')
  dest=output(str(ROOT/g['historicalEvidenceFiles'][0])).rsplit('/',1)[0]
  env.update(TMPDIR='/tmp/flower-classroom-workspace/flower-rc18-temp',FLOWER_QA_ROOT=str(ROOT),FLOWER_PACKAGE_MAIN=target+'/src/main.cjs',FLOWER_CLASSROOM_OUT=dest,FLOWER_DRAW_MATRIX_OUT=dest,FLOWER_SOURCE_ROOT=target,FLOWER_MODEL_SCRIPT=local(r['script']),FLOWER_HEADLESS_TEST='1')
 current_script=local(r['script']);rows.append({'mode':g['mode'],'group':g['group'],'suite':r['suite'],'domain':domain,'expectedPassed':g['definitionExpectedPassed'],'expectedObservations':0,'cwd':str(ROOT),'command':cmd,'environment':env,'historicalScriptNowAvailable':current_script,'scriptExists':Path(current_script).is_file(),'originalScriptSha256':hashlib.sha256(Path(current_script).read_bytes()).hexdigest() if Path(current_script).is_file() else None,'plannedResultFiles':[output(str(ROOT/f)) for f in g['historicalEvidenceFiles']],'requiresHarnessReviewBeforeRun':True,'reviewReason':'Review explicit current runtime/output bindings and unified configuration fixture contract; rules preceding scripts contain hardcoded old paths and local before fixtures. Preserve originals and changes. All subprocess errors/signals/required stages must be recorded.'})
summary={d:{'groups':len([r for r in rows if r['domain']==d]),'expectedPerMode':sum(r['expectedPassed'] for r in rows if r['domain']==d and r['mode']=='source')} for d in ['migration','rules','imports','classroom']}
out={'version':'1.3.0-rc.18','status':'explicit execution recipes for harness review; not run or selected','historicalPassContribution':0,'summary':summary,'allScriptPathsExist':all(r['scriptExists'] for r in rows),'groups':rows}
(OUT/'ordinary-independent-execution-plan.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'summary':summary,'allScriptPathsExist':out['allScriptPathsExist']}))
