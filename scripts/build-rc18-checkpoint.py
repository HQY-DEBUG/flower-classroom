"""Preserve the current frozen RC18 implementation without private QA inputs or generated profiles."""
from pathlib import Path
import argparse,json,hashlib,zipfile,datetime,os
r=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--name',default='花伴课堂-RC18-最终验证前源码检查点');a=p.parse_args()
f=json.loads((r/'artifacts/rc18/frozen-source.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
expected={**f['files'],**f['assetFiles'],**f['packageFiles'],**f['packagedDocuments']}
for n,h in expected.items():assert sha((r/n).read_bytes())==h,n
chosen={r/n for n in expected}
for top in ['src','assets','scripts','tests']:
 for current,dirs,names in os.walk(r/top):
  dirs[:]=[d for d in dirs if d not in ['__pycache__','node_modules','lock-io-review']]
  for n in names:
   file=Path(current)/n
   if file.is_file() and file.suffix not in ['.pyc','.tmp']:chosen.add(file)
for current,dirs,names in os.walk(r/'artifacts'):
 dirs[:]=[d for d in dirs if d not in ['lock-io-review','node_modules','extracted-runtime','cloud-pristine-extraction','__pycache__']]
 for n in names:
  if n.endswith(('.cjs','.py','.mjs')):chosen.add(Path(current)/n)
for n in ['package.json','package-lock.json','LICENSE','artifacts/rc18/frozen-source.json']:
 chosen.add(r/n)
out=r.parent.parent/'flower-rc18-deliverables';out.mkdir(exist_ok=True);dest=out/(a.name+'.zip')
assert not dest.exists(),'Preserve earlier checkpoints; choose a new explicit name'
status={'version':f['candidateVersion'],'frozenAt':f['frozenAt'],'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'unpublished':True,'finalRegressionComplete':False,'purpose':'Recover frozen code, original assets, dependency lock and QA scripts; final evidence/reports are separate pending artifacts','privateRosterInputsIncluded':False,'stoppedSpecialistExcluded':True}
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for file in sorted(chosen):z.write(file,'FlowerClassroom-source/'+file.relative_to(r).as_posix())
 z.writestr('CHECKPOINT.json',json.dumps(status,ensure_ascii=False,indent=2)+'\n')
with zipfile.ZipFile(dest) as z:
 assert z.testzip() is None
 for n,h in expected.items():assert sha(z.read('FlowerClassroom-source/'+n))==h
 for file in chosen:assert z.read('FlowerClassroom-source/'+file.relative_to(r).as_posix())==file.read_bytes()
status.update(path=str(dest),sizeBytes=dest.stat().st_size,sha256=sha(dest.read_bytes()),entries=len(chosen)+1,verified=True)
(dest.with_suffix('.json')).write_text(json.dumps(status,ensure_ascii=False,indent=2)+'\n');print(json.dumps(status,ensure_ascii=False))
