from pathlib import Path
import concurrent.futures,subprocess,os,json,hashlib,datetime
r=Path(__file__).resolve().parent.parent;o=r/'artifacts/rc15';f=json.loads((o/'frozen-source.json').read_text());a=r/'dist-rc15-final/win-unpacked/resources/app.asar';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def hashes():return {n:sha(r/n) for n in f['files']}
def run(job):
 name,cmd,result=job;before=hashes();assert before==f['files'];started=datetime.datetime.now(datetime.timezone.utc).isoformat();log=o/(name+'-bound.log');ash=sha(a)
 with log.open('w') as stream:run=subprocess.run(cmd,cwd=r,stdout=stream,stderr=subprocess.STDOUT,timeout=300)
 after=hashes();record={'suite':name,'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':run.returncode,'command':cmd,'log':str(log.relative_to(r)),'result':result,'frozenAt':f['frozenAt'],'sourceManifestSha256':sha(o/'frozen-source.json'),'sourceAtStart':before,'sourceAtFinish':after,'sourceUnchanged':before==after,'asarSha256':ash if name=='startup' else None,'asarUnchanged':sha(a)==ash,'windowsExecuted':False};(o/(name+'-binding.json')).write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({k:record[k] for k in ['suite','exitCode','startedAt','completedAt']}),flush=True);assert run.returncode==0 and before==after and sha(a)==ash
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(run,[job for job in [('preview',['python','scripts/qa-preview-lifecycle-rc15.py'],'artifacts/rc15/ui-review/preview/results.json'),('startup',['node','scripts/qa-startup-identity-rc15.cjs'],'artifacts/rc15/startup-identity/results.json')] if not os.environ.get('FLOWER_SUPPLEMENT_ONLY') or job[0]==os.environ['FLOWER_SUPPLEMENT_ONLY']]))
