"""Build a recoverable source checkpoint. Excludes runtimes, caches and execution profiles."""
from pathlib import Path
import argparse,hashlib,json,zipfile,datetime
p=argparse.ArgumentParser();p.add_argument('--sheet',required=True);p.add_argument('--out',required=True);p.add_argument('--report',action='append',default=[]);a=p.parse_args()
root=Path(__file__).resolve().parent.parent; out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True)
version=json.loads((root/'package.json').read_text())['version'];frozen=json.loads((root/'artifacts/rc8/frozen-source.json').read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
assert frozen['candidateVersion']==version
assert {str(p.relative_to(root)):sha(p.read_bytes()) for p in sorted((root/'src').iterdir()) if p.is_file()}==frozen['files']
sheet=Path(a.sheet).resolve();assert sheet.is_file()
files=[]
for name in ['src','assets','scripts','tests','artifacts']:
 for file in sorted((root/name).rglob('*')):
  if not file.is_file() or file.is_symlink():continue
  rel=file.relative_to(root)
  if any(part.lower() in {'cache','synthetic-data','synthetic-electron-profile','node_modules','gpucache','crashpad','code cache','fontconfig','__pycache__','local storage','session storage','network','dawncache','dawnwebgpucache','dawngraphitecache'} for part in rel.parts):continue
  if file.suffix.lower() in {'.exe','.zip','.asar','.7z','.mp4','.webm','.mp3'}:continue
  assert 'video-audit-' not in str(rel) and not file.name.startswith('frame-'),str(rel)
  files.append((file,str(rel)))
for name in ['README.md','TEST-REPORT.md','RELEASE-VERIFICATION.md','UPGRADE-1.3-CANDIDATE.md','LICENSE','package.json','package-lock.json','.gitignore','RC8-RELEASE-NOTES.md','START-HERE.txt']:
 file=root/name
 if file.is_file():files.append((file,name))
files.append((sheet,'RC8完整测试矩阵.xlsx'))
for report in a.report:
 report=Path(report).resolve();assert report.is_file();files.append((report,report.name))
archive=out/f'花伴课堂-{version}-独立窗体与档案保护-源码.zip'
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for file,name in files:z.write(file,'FlowerClassroom-source/'+name)
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 for name,digest in frozen['files'].items():assert sha(z.read('FlowerClassroom-source/'+name))==digest
 assert sha(z.read('FlowerClassroom-source/RC8完整测试矩阵.xlsx'))==sha(sheet.read_bytes())
 manifest={'version':version,'distributedCandidate':True,'windowsFullyValidated':False,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceArchive':str(archive),'sourceSizeBytes':archive.stat().st_size,'sourceSha256':sha(archive.read_bytes()),'entries':len(z.namelist()),'allSourceFilesVerified':len(frozen['files']),'archiveCrcPassed':True,'realStudentDataIncluded':False,'originalVideoImagesIncluded':False,'sourceTreeSha256':json.loads((root/'artifacts/rc8/package-summary.json').read_text())['sourceTreeSha256'],'reports':[{'path':str(Path(r).resolve()),'sha256':sha(Path(r).read_bytes())} for r in a.report],'sheetPath':str(sheet),'sheetSizeBytes':sheet.stat().st_size,'sheetSha256':sha(sheet.read_bytes())}
(out/'rc8-source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps(manifest,ensure_ascii=False,indent=2))
