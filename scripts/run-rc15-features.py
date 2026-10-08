from pathlib import Path
import tempfile,os,json,subprocess,datetime,hashlib,concurrent.futures,argparse
r=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('mode',choices=['source','packaged']);a=p.parse_args();base=r/'artifacts/rc15'/('features-'+a.mode);base.mkdir(parents=True,exist_ok=True)
entry=r/('src/main.cjs' if a.mode=='source' else 'dist-rc15-final/win-unpacked/resources/app.asar/src/main.cjs')
jobs=[('egg','scripts/qa-egg-lifecycle-rc11.cjs','FLOWER_EGG_OUT'),('avatars','scripts/qa-avatars-rc11.cjs','FLOWER_AVATAR_OUT'),('avatar-import','scripts/qa-avatar-import-rc11.cjs','FLOWER_AVATAR_IMPORT_OUT'),('egg-comprehensive','scripts/qa-egg-comprehensive-audit.cjs','FLOWER_EGG_AUDIT_OUT'),('avatar-comprehensive','scripts/qa-avatar-comprehensive-rc11.cjs','FLOWER_AVATAR_AUDIT_OUT'),('pet-feedback','scripts/qa-pet-feedback-rc12.cjs','FLOWER_PET_FEEDBACK_OUT'),('keyboard','scripts/qa-keyboard-continuity-rc12.cjs','TOOLS_AUDIT_OUT')]
jobs=[j for j in jobs if j[0] not in os.environ.get('FLOWER_SKIP_SUITES','').split(',')]
def hashes():return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((r/'src').iterdir()) if p.is_file()}
before=hashes()
def run(j):
 name,script,key=j;log=base/(name+'.log');start=datetime.datetime.now(datetime.timezone.utc).isoformat();env={**os.environ,'XDG_CACHE_HOME':'/tmp/flower-rc15-cache','FLOWER_EXTERNAL_RESOURCE_DIR':tempfile.mkdtemp(prefix='flower-rc15-resources-'),'FLOWER_PACKAGE_MAIN':str(entry),key:str(base/name)}
 with log.open('w') as f:
  try:res=subprocess.run(['node',script],cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=600);code=res.returncode;error=None
  except subprocess.TimeoutExpired as e:code=124;error=str(e)
 row={'suite':name,'script':script,'exitCode':code,'harnessError':error,'log':str(log.relative_to(r)),'evidenceDirectory':str((base/name).relative_to(r)),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps(row),flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(run,jobs))
after=hashes();result={'mode':a.mode,'entry':str(entry),'asarSha256':hashlib.sha256((r/'dist-rc15-final/win-unpacked/resources/app.asar').read_bytes()).hexdigest() if a.mode=='packaged' else None,'sourceUnchanged':before==after,'sourceFiles':after,'suites':rows};(base/'runs.json').write_text(json.dumps(result,indent=2)+'\n');assert before==after and all(x['exitCode']==0 for x in rows)
