from pathlib import Path
import os,json,hashlib,subprocess,tempfile,datetime,concurrent.futures
r=Path(__file__).resolve().parent.parent;stage=r/'artifacts/rc14/care-exact-final';stage.mkdir(exist_ok=True);f=json.loads((r/'artifacts/rc14/frozen-source.json').read_text());archive=r/'dist-rc14-final/win-unpacked/resources/app.asar';sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();ash=sha(archive)
def snapshot():
 files={n:sha(r/n) for n in f['files']};assert files==f['files'];assert sha(archive)==ash;return files
before=snapshot()
def run(pair):
 kind,mode=pair;out=stage/(kind+'-'+mode);out.mkdir(exist_ok=True);entry=r/'src/main.cjs' if mode=='source' else archive/'src/main.cjs';env={**os.environ,'XDG_CACHE_HOME':'/tmp/flower-rc14-cache','FLOWER_FREEZE_DIR':'artifacts/rc14','FLOWER_EXTERNAL_RESOURCE_DIR':tempfile.mkdtemp(prefix='flower-rc14-exactgate-')};start=datetime.datetime.now(datetime.timezone.utc).isoformat();first=snapshot()
 if mode=='packaged':env['FLOWER_PACKAGE_MAIN']=str(entry)
 if kind=='care':cmd=[str(r/'node_modules/electron/dist/electron'),'--no-sandbox','--ozone-platform=headless','--disable-gpu','scripts/qa-pet-care.cjs'];resultFile='artifacts/qa-pet-care'+('-packaged' if mode=='packaged' else '')+'/results.json'
 else:env['FLOWER_PACKAGE_MAIN']=str(entry);env['ROSTER_AUDIT_OUT']=str(out);cmd=['node','scripts/qa-inherited-roster-exact-rc14.cjs'];resultFile=str((out/'results.json').relative_to(r))
 log=out/'run.log'
 with log.open('w') as fp:res=subprocess.run(cmd,cwd=r,env=env,stdout=fp,stderr=subprocess.STDOUT,timeout=240)
 after=snapshot();row={'suite':kind,'mode':mode,'entry':str(entry),'command':cmd,'exitCode':res.returncode,'result':resultFile,'log':str(log.relative_to(r)),'sourceBefore':first,'sourceAfter':after,'sourceUnchanged':first==after,'asarSha256':ash if mode=='packaged' else None,'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps({k:v for k,v in row.items() if k not in ['sourceBefore','sourceAfter']}),flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(run,[('care','source'),('care','packaged'),('exact','source'),('exact','packaged')]))
(stage/'runs.json').write_text(json.dumps({'frozenAt':f['frozenAt'],'sourceUnchanged':snapshot()==before,'asarSha256':ash,'suites':rows},indent=2));assert all(x['exitCode']==0 for x in rows)
