from pathlib import Path
import os,json,subprocess,datetime,hashlib,concurrent.futures,argparse
r=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('mode',choices=['source','packaged']);a=p.parse_args();base=r/'artifacts/rc13'/('extension-'+a.mode);base.mkdir(parents=True,exist_ok=True)
entry=r/('src/main.cjs' if a.mode=='source' else 'dist-rc13-final/win-unpacked/resources/app.asar/src/main.cjs')
jobs=[('rc12-review','artifacts/rc12/independent-review/review.cjs','REVIEW_OUT'),('rc12-tools','artifacts/comprehensive-rc11-20261005/tools-audit/audit.cjs','TOOLS_AUDIT_OUT'),('rc12-import','artifacts/comprehensive-rc11-20261005/import-audit/audit.cjs','IMPORT_AUDIT_OUT'),('rc12-format','artifacts/comprehensive-rc11-20261005/import-audit/format-regressions.cjs','IMPORT_FORMAT_OUT'),('rc12-text','artifacts/comprehensive-rc11-20261005/import-audit/text-controls.cjs','IMPORT_TEXT_OUT'),('target-confirmations','scripts/qa-target-confirmations-rc13.cjs','FLOWER_CONFIRM_OUT'),('album-refresh','scripts/qa-album-refresh-rc13.cjs','ALBUM_AUDIT_OUT')]
def hashes():return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((r/'src').iterdir()) if p.is_file()}
before=hashes()
def run(j):
 name,script,key=j;log=base/(name+'.log');start=datetime.datetime.now(datetime.timezone.utc).isoformat();env={**os.environ,'FLOWER_PACKAGE_MAIN':str(entry),key:str(base/name)}
 with log.open('w') as f:
  try:res=subprocess.run(['node',script],cwd=r,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=600);code=res.returncode;error=None
  except subprocess.TimeoutExpired as e:code=124;error=str(e)
 row={'suite':name,'script':script,'exitCode':code,'harnessError':error,'log':str(log.relative_to(r)),'evidenceDirectory':str((base/name).relative_to(r)),'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()};print(json.dumps(row),flush=True);return row
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(run,jobs))
after=hashes();result={'mode':a.mode,'entry':str(entry),'asarSha256':hashlib.sha256((r/'dist-rc13-final/win-unpacked/resources/app.asar').read_bytes()).hexdigest() if a.mode=='packaged' else None,'sourceUnchanged':before==after,'sourceFiles':after,'suites':rows};(base/'runs.json').write_text(json.dumps(result,indent=2)+'\n');assert before==after and all(x['exitCode']==0 for x in rows)
