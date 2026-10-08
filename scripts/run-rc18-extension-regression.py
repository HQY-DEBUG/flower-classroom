from pathlib import Path
from rc18_evidence import harness_hashes
import tempfile,os,json,subprocess,datetime,hashlib,concurrent.futures,argparse
r=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('mode',choices=['source','packaged']);a=p.parse_args();base=Path(os.environ.get('FLOWER_EXTENSION_OUT',r/'artifacts/rc18'/('extension-'+a.mode)));base.mkdir(parents=True,exist_ok=True)
entry=r/('src/main.cjs' if a.mode=='source' else 'dist-rc18-final/win-unpacked/resources/app.asar/src/main.cjs')
jobs=[('rc12-review','artifacts/rc12/independent-review/review.cjs','REVIEW_OUT'),('rc12-tools','artifacts/comprehensive-rc11-20261005/tools-audit/audit.cjs','TOOLS_AUDIT_OUT'),('rc12-import','artifacts/comprehensive-rc11-20261005/import-audit/audit.cjs','IMPORT_AUDIT_OUT'),('rc12-format','artifacts/comprehensive-rc11-20261005/import-audit/format-regressions.cjs','IMPORT_FORMAT_OUT'),('rc12-text','artifacts/comprehensive-rc11-20261005/import-audit/text-controls.cjs','IMPORT_TEXT_OUT'),('target-confirmations','scripts/qa-target-confirmations-rc13.cjs','FLOWER_CONFIRM_OUT'),('album-refresh','scripts/qa-album-refresh-rc13.cjs','ALBUM_AUDIT_OUT')]
jobs=[j for j in jobs if not os.environ.get('FLOWER_ONLY_SUITES') or j[0] in os.environ['FLOWER_ONLY_SUITES'].split(',')]
def hashes():return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((r/'src').iterdir()) if p.is_file()}
before=hashes()
def validate_child_evidence(name,directory):
 filename='run.json' if name=='target-confirmations' else 'results.json' if name=='rc12-import' else 'execution.json'
 try:record=json.loads((directory/filename).read_text())
 except (OSError,ValueError) as error:return {'executionEvidence':str(directory/filename),'evidenceErrors':['Missing/invalid execution evidence: '+str(error)],'verifiedCaseCount':0}
 errors=[];count=0
 if record.get('requiredPhases')!=record.get('actualPhases'):errors.append('Required phase set was not completed')
 if record.get('sourceChanged') or record.get('phaseErrors'):errors.append('Runtime or expected phase/case mismatch')
 rows=([record.get('flows')]+record.get('restarts',[])) if name=='target-confirmations' else record.get('runs',[record])
 for row in rows:
  if not isinstance(row,dict):errors.append('Missing child phase record');continue
  if row.get('error') or row.get('signal') or row.get('exitCode')!=0 or row.get('evidenceErrors'):errors.append('Child failed or has incomplete evidence: '+str(row.get('phase')))
  report=row.get('report')
  if not isinstance(report,dict):errors.append('Missing phase report');continue
  checks=report.get('checks')
  if not isinstance(checks,list) or not checks:errors.append('Zero cases');continue
  count+=len(checks)
  if any(case.get('status')!='passed' for case in checks):errors.append('A business case did not pass')
  if name!='target-confirmations' and report.get('completed') is not True:errors.append('No terminal completion marker')
  if report.get('fatal') or any(report.get(key) for key in ['errors','runtimeErrors','rendererErrors']):errors.append('Fatal/renderer errors')
  expected=row.get('requiredCaseNames')
  if expected is not None and sorted(expected)!=sorted(case.get('name','') for case in checks):errors.append('Case set mismatch')
 return {'executionEvidence':str(directory/filename),'evidenceErrors':errors,'verifiedCaseCount':count}
def run(j):
 name,script,key=j;log=base/(name+'.log');start=datetime.datetime.now(datetime.timezone.utc).isoformat();env={**os.environ,'XDG_CACHE_HOME':'/tmp/flower-rc18-cache','FLOWER_PACKAGE_MAIN':str(entry),key:str(base/name)}
 harness_before=harness_hashes(['node',script,'scripts/qa-feature-child.cjs']);harness_before['scripts/qa-extension-cases.json']=hashlib.sha256((r/'scripts/qa-extension-cases.json').read_bytes()).hexdigest()
 evidence_dir=base/name;evidence_dir.mkdir(parents=True,exist_ok=True)
 for filename in ['execution.json','results.json','run.json']:
  previous=evidence_dir/filename
  if previous.exists():previous.rename(evidence_dir/(filename+'.prior-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')))
 with log.open('w') as f:
  try:res=subprocess.run(['node',script],cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=600);code=res.returncode;error=None
  except subprocess.TimeoutExpired as e:code=124;error=str(e)
 harness_after=harness_hashes(['node',script,'scripts/qa-feature-child.cjs']);harness_after['scripts/qa-extension-cases.json']=hashlib.sha256((r/'scripts/qa-extension-cases.json').read_bytes()).hexdigest()
 validation=validate_child_evidence(name,evidence_dir)
 if validation['evidenceErrors'] and code==0:code=1;error='Child execution evidence failed validation'
 if harness_before!=harness_after:code=1;error='Harness changed during execution'
 row={'suite':name,**validation,'harnessAtStart':harness_before,'harnessAtFinish':harness_after,'script':script,'exitCode':code,'harnessError':error,'log':str(log.relative_to(r)),'evidenceDirectory':str((base/name).relative_to(r)),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps(row),flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("FLOWER_QA_WORKERS","2"))) as pool:rows=list(pool.map(run,jobs))
after=hashes();result={'mode':a.mode,'entry':str(entry),'asarSha256':hashlib.sha256((r/'dist-rc18-final/win-unpacked/resources/app.asar').read_bytes()).hexdigest() if a.mode=='packaged' else None,'sourceUnchanged':before==after,'sourceFiles':after,'suites':rows};(base/'runs.json').write_text(json.dumps(result,indent=2)+'\n');assert before==after and all(x['exitCode']==0 for x in rows)
