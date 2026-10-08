from pathlib import Path
from rc18_evidence import harness_hashes
import tempfile,os,json,subprocess,datetime,hashlib,concurrent.futures,argparse
r=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('mode',choices=['source','packaged']);a=p.parse_args();base=Path(os.environ.get('FLOWER_FEATURE_OUT',str(r/'artifacts/rc18'/('features-'+a.mode))));base.mkdir(parents=True,exist_ok=True)
entry=r/('src/main.cjs' if a.mode=='source' else 'dist-rc18-final/win-unpacked/resources/app.asar/src/main.cjs')
jobs=[('egg','scripts/qa-egg-lifecycle-rc11.cjs','FLOWER_EGG_OUT'),('avatars','scripts/qa-avatars-rc11.cjs','FLOWER_AVATAR_OUT'),('avatar-import','scripts/qa-avatar-import-rc11.cjs','FLOWER_AVATAR_IMPORT_OUT'),('egg-comprehensive','scripts/qa-egg-comprehensive-audit.cjs','FLOWER_EGG_AUDIT_OUT'),('avatar-comprehensive','scripts/qa-avatar-comprehensive-rc11.cjs','FLOWER_AVATAR_AUDIT_OUT'),('pet-feedback','scripts/qa-pet-feedback-rc12.cjs','FLOWER_PET_FEEDBACK_OUT'),('keyboard','scripts/qa-keyboard-continuity-rc12.cjs','TOOLS_AUDIT_OUT')]
jobs=[j for j in jobs if j[0] not in os.environ.get('FLOWER_SKIP_SUITES','').split(',')]
def hashes():return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((r/'src').iterdir()) if p.is_file()}
before=hashes()
def validate_evidence(name,directory):
 errors=[];cases=[]
 def inspect(document,label):
  if not isinstance(document,dict):errors.append(label+': missing report');return
  if document.get('fatal') or document.get('completed') is False:errors.append(label+': incomplete/fatal report')
  if document.get('sourceChanged') is True or document.get('archiveUnchanged') is False:errors.append(label+': runtime changed')
  for key in ['errors','runtimeErrors']:
   if document.get(key):errors.append(label+': unexpected '+key)
  if 'checks' in document:
   checks=document['checks']
   if not isinstance(checks,list) or not checks:errors.append(label+': zero cases');return
   cases.extend(checks)
   if any(not isinstance(c,dict) or c.get('status')!='passed' for c in checks):errors.append(label+': a case did not pass')
   return
  children=document.get('results',document.get('runs'))
  if not isinstance(children,list) or not children:errors.append(label+': no child results');return
  if name in ['avatars','avatar-import','avatar-comprehensive'] and len(children)!=2:errors.append(label+': both phases required')
  for child in children:
   if not isinstance(child,dict):errors.append(label+': invalid child result');continue
   if child.get('error') or child.get('signal') or child.get('evidenceErrors') or child.get('exitCode',child.get('status'))!=0:errors.append(label+': child failed or unverified')
   inspect(child.get('report'),label+'/'+str(child.get('phase','unknown')))
 def read(filename):
  try:inspect(json.loads((directory/filename).read_text()),filename)
  except (OSError,ValueError) as e:errors.append(filename+': '+str(e))
 read('results.json')
 if name=='egg-comprehensive':read('restart-result.json')
 if not cases:errors.append('No verified feature cases')
 return {'verifiedCaseCount':len(cases),'evidenceErrors':errors}
def run(j):
 name,script,key=j;log=base/(name+'.log');start=datetime.datetime.now(datetime.timezone.utc).isoformat();env={**os.environ,'XDG_CACHE_HOME':'/tmp/flower-rc18-cache','FLOWER_PACKAGE_MAIN':str(entry),key:str(base/name)}
 harness_before=harness_hashes(['node',script,'scripts/qa-feature-child.cjs'])
 evidence_dir=base/name;evidence_dir.mkdir(parents=True,exist_ok=True)
 for filename in ['results.json','restart-result.json']:
  prior=evidence_dir/filename
  if prior.exists():prior.rename(evidence_dir/(filename+'.prior-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')))
 with log.open('w') as f:
  try:res=subprocess.run(['node',script],cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=600);code=res.returncode;error=None
  except subprocess.TimeoutExpired as e:code=124;error=str(e)
 harness_after=harness_hashes(['node',script,'scripts/qa-feature-child.cjs'])
 validation=validate_evidence(name,evidence_dir)
 if validation['evidenceErrors'] and code==0:code=1;error='Child evidence failed validation'
 if harness_before!=harness_after:code=1;error='Harness changed during execution'
 row={'suite':name,**validation,'harnessAtStart':harness_before,'harnessAtFinish':harness_after,'script':script,'exitCode':code,'harnessError':error,'log':str(log.relative_to(r)),'evidenceDirectory':str((base/name).relative_to(r)),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps(row),flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get("FLOWER_QA_WORKERS","2"))) as pool:rows=list(pool.map(run,jobs))
after=hashes();result={'mode':a.mode,'entry':str(entry),'asarSha256':hashlib.sha256((r/'dist-rc18-final/win-unpacked/resources/app.asar').read_bytes()).hexdigest() if a.mode=='packaged' else None,'sourceUnchanged':before==after,'sourceFiles':after,'suites':rows};(base/'runs.json').write_text(json.dumps(result,indent=2)+'\n');assert before==after and all(x['exitCode']==0 for x in rows)
