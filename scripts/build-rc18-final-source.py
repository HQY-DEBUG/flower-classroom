"""Create the reviewed source and selected proof recovery archive, excluding private inputs."""
from pathlib import Path
import os,json,hashlib,zipfile,datetime
r=Path(__file__).resolve().parent.parent
sha=lambda b:hashlib.sha256(b).hexdigest()
f=json.loads((r/'artifacts/rc18/frozen-source.json').read_text())
m=json.loads((r/'artifacts/rc18/final-test-manifest.json').read_text())
expected={**f['files'],**f['assetFiles'],**f['packageFiles'],**f['packagedDocuments']}
chosen={}
def add(p):
 p=Path(p);p=p if p.is_absolute() else r/p;p=p.resolve()
 assert p.is_relative_to(r),str(p)
 assert not any(x in p.parts for x in ['lock-io-review','node_modules','rc18-private-roster-qa']),str(p)
 assert p.is_file(),str(p)
 name=p.relative_to(r).as_posix();chosen[name]=p
for n,h in expected.items():
 assert sha((r/n).read_bytes())==h,n
 add(n)
for top in ['src','assets','scripts','tests']:
 for current,dirs,names in os.walk(r/top):
  dirs[:]=[d for d in dirs if d not in ['__pycache__','node_modules','lock-io-review']]
  for name in names:
   if not name.endswith(('.pyc','.tmp')):add(Path(current)/name)
for field in ['evidenceSha256','executionManifestSha256']:
 for name,h in m[field].items():
  assert sha((r/name).read_bytes())==h,(field,name)
  add(name)
for name in ['artifacts/rc18/final-test-manifest.json','artifacts/rc18/package-summary.json','artifacts/rc18/frozen-source.json','artifacts/rc17/final-test-manifest.json','artifacts/rc14/frozen-source.json']:
 add(name)
# Preserve the exact synthetic legacy migration inputs required by the current QA.
for p in (r/'artifacts/rc18/ordinary-independent/migration/legacy-inputs-complete-20261007T1006').rglob('*'):
 if p.is_file():add(p)
for top in ['artifacts/rc18-report','artifacts/rc18/harness-history','artifacts/rc18/ordinary-independent/migration']:
 for current,dirs,names in os.walk(r/top):
  dirs[:]=[d for d in dirs if d not in ['__pycache__','node_modules','lock-io-review','fixtures','data','profile','user-data','数据','头像','resources','dist']]
  for name in names:
   p=Path(current)/name
   if p.suffix in ['.py','.cjs','.mjs','.json','.diff','.log'] and p.stat().st_size<16000000:add(p)
for name in ['artifacts/rc18/provided-rosters-final3/source-results.json','artifacts/rc18/provided-rosters-final3/asar-results.json','artifacts/rc18/provided-rosters-final3/sanitized-summary.json','artifacts/rc18/ordinary-independent/migration/historical-harness-binding.json']:
 add(name)
for p in (r/'outputs/flower-rc18-report').glob('*'):
 if p.is_file() and p.suffix in ['.pdf','.xlsx','.json']:add(p)
for n in ['artifacts/rc18/ui-final3-retry1-asar/01-pet-grid.png','artifacts/rc18/ui-final3-retry1-asar/03-quick-score-bottom-tray.png','artifacts/rc18/configuration-ui-final3-retry1-asar/05-unified-all-sheets-preview.png']:
 add(n)
# No private source rosters or original reference-video/user photos are copied.
for n in chosen:
 assert not any(x in n.lower() for x in ['private-roster','video-reference/','video-audit-','user-error/','latest-ui-feedback/']),n
out=r.parent.parent/'flower-rc18-deliverables';out.mkdir(exist_ok=True)
dest=out/'FlowerClassroom-1.3.0-rc.18-source-recovery.zip';assert not dest.exists(),str(dest)
index={n:{'sha256':sha(p.read_bytes()),'sizeBytes':p.stat().st_size} for n,p in sorted(chosen.items())}
status={'version':f['candidateVersion'],'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'purpose':'Frozen runtime, final source preview and QA scripts, selected case-level evidence and explicit execution-version harness snapshots','sourceManifestSha256':sha((r/'artifacts/rc18/frozen-source.json').read_bytes()),'asarSha256':sha((r/'dist-rc18-final/win-unpacked/resources/app.asar').read_bytes()),'finalTestManifestSha256':sha((r/'artifacts/rc18/final-test-manifest.json').read_bytes()),'privateRosterInputsIncluded':False,'stoppedSpecialistExcluded':True,'originalFailedEvidenceRetained':True,'binaryRuntimeAndDependencyCacheExcluded':True,'files':index}
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for n,p in sorted(chosen.items()):z.write(p,'FlowerClassroom-source/'+n)
 z.writestr('RECOVERY-INDEX.json',json.dumps(status,ensure_ascii=False,indent=2)+'\n')
with zipfile.ZipFile(dest) as z:
 assert z.testzip() is None
 for n,info in index.items():assert sha(z.read('FlowerClassroom-source/'+n))==info['sha256'],n
summary={k:v for k,v in status.items() if k!='files'}
summary.update(path=str(dest),sizeBytes=dest.stat().st_size,sha256=sha(dest.read_bytes()),entries=len(index)+1,verified=True)
dest.with_suffix('.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n');print(json.dumps(summary,ensure_ascii=False))
