#!/usr/bin/env python3
"""Verify completed Windows archives by CRC, source identity and matching bytes. Does not run Windows."""
import argparse, hashlib, json, subprocess, tempfile, zipfile
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--seven-zip',required=True);parser.add_argument('--dist-dir',default='dist');parser.add_argument('--out-dir',default='artifacts/qa');args=parser.parse_args()
root=Path(__file__).resolve().parent.parent;dist=root/args.dist_dir;out=root/args.out_dir;out.mkdir(parents=True,exist_ok=True)
version=json.loads((root/'package.json').read_text())['version'];portable=dist/f'FlowerClassroom-{version}-portable.exe';archive=dist/f'FlowerClassroom-{version}-x64.zip'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
with tempfile.TemporaryDirectory(prefix='flower-release-verify-') as td:
 temp=Path(td);outer=temp/'outer';inner=temp/'runtime';outer.mkdir();inner.mkdir()
 def run(*argv):
  r=subprocess.run([args.seven_zip,*map(str,argv)],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,check=True,text=True);return r.stdout
 log=run('t',portable);log+=run('x','-y',f'-o{outer}',portable)
 embedded=list(outer.rglob('app-64.7z'));assert len(embedded)==1,'Portable must contain one x64 runtime archive'
 log+=run('t',embedded[0]);log+=run('x','-y',f'-o{inner}',embedded[0]);(out/'portable-archive-test.txt').write_text(log)
 files={p.relative_to(inner).as_posix():p for p in inner.rglob('*') if p.is_file()}
 assert files['resources/app.asar'].read_bytes()==(dist/'win-unpacked/resources/app.asar').read_bytes()
 assert files['花伴课堂.exe'].read_bytes()==(dist/'win-unpacked/花伴课堂.exe').read_bytes()
 with zipfile.ZipFile(archive) as z:
  assert z.testzip() is None,'ZIP CRC failure'
  zfiles={i.filename:i for i in z.infolist() if not i.is_dir()}
  assert z.read('resources/app.asar')==files['resources/app.asar'].read_bytes()
  assert z.read('花伴课堂.exe')==files['花伴课堂.exe'].read_bytes()
  docs={item['to']:item['from'] for item in json.loads((root/'package.json').read_text())['build']['extraFiles']}
  assert set(docs)=={'使用说明.md','测试报告.md','升级指南.md','LICENSE-FlowerClassroom.txt','先读我-启动说明.txt'},'Unexpected documentation set'
  for target,source in docs.items():
   assert z.read(target)==(root/source).read_bytes(),target+' not final documentation'
   assert files[target].read_bytes()==(root/source).read_bytes()
  common=sorted(set(files)&set(zfiles))
  for name in common:
   p=files[name];info=zfiles[name];assert p.stat().st_size==info.file_size,name+' size mismatch'
   assert hashlib.sha256(p.read_bytes()).digest()==hashlib.sha256(z.read(name)).digest(),name+' bytes mismatch'
  assert not any('.qa-' in p or 'classroom.json' in p or 'qa-backup' in p or 'student-import' in p for p in zfiles)
  zresult={'status':'passed','crcPassed':True,'asarMatched':True,'exeMatched':True,'entries':len(zfiles),'docsPresent':list(docs),'sha256':sha(archive),'sizeBytes':archive.stat().st_size}
  (out/'zip-verification.json').write_text(json.dumps(zresult,ensure_ascii=False,indent=2))
  result={'status':'passed','portableEmbeddedArchiveIntegrity':'passed','commonFileCount':len(common),'commonFilesByteIdentical':True,'onlyPortable':sorted(set(files)-set(zfiles)),'onlyZip':sorted(set(zfiles)-set(files)),'sha256':{portable.name:sha(portable),archive.name:sha(archive)},'sizes':{portable.name:portable.stat().st_size,archive.name:archive.stat().st_size},'asarSha256':sha(files['resources/app.asar']),'runtimeExeSha256':sha(files['花伴课堂.exe']),'windowsExecution':False,'notes':['Archive/PE validation only; no Windows execution or digital signature','No installer delivered']}
  (out/'portable-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
