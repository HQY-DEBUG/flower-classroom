from pathlib import Path
import concurrent.futures, subprocess, os, json, sys
from rc18_evidence import Capture,regular_outputs,run_directory,now,sha,rel,harness_hashes
r=Path(__file__).resolve().parent.parent
f=json.loads((r/'artifacts/rc18/frozen-source.json').read_text())
before={n:sha(r/n) for n in f['files']};diagnostic=os.environ.get('FLOWER_QA_DIAGNOSTIC')=='1';assert diagnostic or before==f['files']
base=run_directory('pet-adapted-source');print(str(base),flush=True)
env={**os.environ,'ELECTRON_CACHE':'/tmp/flower-electron-cache','XDG_CACHE_HOME':'/tmp/flower-cache'};env.pop('FLOWER_PACKAGE_MAIN',None)
names=sys.argv[1:] or ['pets','catalog','migration']
outputs={'pets':('FLOWER_PETS_OUT','qa-pets-results.json'),'catalog':('FLOWER_CATALOG_OUT','qa-catalog-results.json'),'migration':('FLOWER_INDEPENDENT_OUT','results.json')}
commands={'pets':['node','scripts/pet-test-runner.cjs'],'catalog':['node','scripts/qa-catalog.cjs'],'migration':['node','scripts/qa-pet-care-independent.cjs']}
def run(name):
 cmd=commands[name];key,filename=outputs[name];raw=base/name/'raw';c=Capture(base/name,name,'source',cmd,[raw/filename]);h=harness_hashes(cmd);failure=None
 h.update({str(p.relative_to(r)):sha(p) for p in [r/'scripts/qa-pets.cjs',r/'scripts/qa-catalog.cjs',r/'scripts/qa-pet-care-independent.cjs',r/'scripts/qa-tool-control.cjs']})
 with c.log.open('w') as out:
  try:v=subprocess.run(cmd,cwd=r,env={**env,key:str(raw)},stdout=out,stderr=subprocess.STDOUT,timeout=720);code=v.returncode
  except subprocess.TimeoutExpired as error:code=124;failure=str(error)
 end={k:sha(r/k) for k in h};record=c.finish(code,failure,extra={'harnessAtStart':h,'harnessAtFinish':end,'scriptUnchanged':h==end});print(json.dumps(record),flush=True);return record
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(run,names))
after={n:sha(r/n) for n in f['files']};binding={'mode':'source','diagnosticOnly':diagnostic,'matchesFrozenSource':before==f['files'],'frozenAt':f['frozenAt'],'sourceAtStart':before,'sourceAtFinish':after,'sourceUnchanged':before==after,'runDirectory':rel(base),'syntheticOnly':True,'windowsExecuted':False}
(base/'runs.json').write_text(json.dumps(rows,indent=2)+'\n');(base/'binding.json').write_text(json.dumps(binding,indent=2)+'\n')
assert before==after and all(v['exitCode']==0 for v in rows)
