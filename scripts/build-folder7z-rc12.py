"""Expose the verified portable runtime payload as a genuine once-extracted folder archive."""
from pathlib import Path
import argparse,hashlib,json,subprocess,tempfile,zipfile,shutil
p=argparse.ArgumentParser();p.add_argument('--seven-zip',required=True);p.add_argument('--dist-dir',default='dist-rc12-final');p.add_argument('--out',required=True);a=p.parse_args()
r=Path(__file__).resolve().parent.parent;dist=r/a.dist_dir;out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True);version=json.loads((r/'package.json').read_text())['version'];qa=r/'artifacts/rc12/package';qa.mkdir(parents=True,exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
portable=dist/f'FlowerClassroom-{version}-portable.exe';target=out/f'FlowerClassroom-{version}-folder.7z'
with tempfile.TemporaryDirectory(prefix='flower-rc12-folder-') as tmp:
 tmp=Path(tmp);log=[]
 def run(*args):
  s=subprocess.run([a.seven_zip,*map(str,args)],check=True,capture_output=True,text=True);log.append(s.stdout+s.stderr)
 run('x','-y',f'-o{tmp}/outer',portable)
 found=list((tmp/'outer').rglob('app-64.7z'));assert len(found)==1
 shutil.copy2(found[0],target);assert sha(target)==sha(found[0]);run('t',target);run('x','-y',f'-o{tmp}/runtime',target)
 payload={p.relative_to(tmp/'runtime').as_posix():p for p in (tmp/'runtime').rglob('*') if p.is_file()}
 unpacked={p.relative_to(dist/'win-unpacked').as_posix():p for p in (dist/'win-unpacked').rglob('*') if p.is_file()}
 assert set(payload)==set(unpacked),(set(payload)-set(unpacked),set(unpacked)-set(payload))
 for n,f in payload.items():assert sha(f)==sha(unpacked[n]),n
 with zipfile.ZipFile(dist/f'FlowerClassroom-{version}-x64.zip') as z:
  assert z.testzip() is None
  znames={i.filename for i in z.infolist() if not i.is_dir()};common=sorted(set(payload)&znames)
  for n in common:assert hashlib.sha256(z.read(n)).hexdigest()==sha(payload[n]),n
  assert sorted(set(payload)-znames)==['resources/elevate.exe'] and not znames-set(payload)
 assert target.stat().st_size<104857600,'The supported Drive upload limit is 100 MiB'
 assert payload['先读我-启动说明.txt'].read_bytes()==(r/'START-HERE.txt').read_bytes()
 result={'version':version,'status':'passed','file':str(target),'sizeBytes':target.stat().st_size,'sha256':sha(target),'true7z':True,'embeddedPortablePayloadByteIdentical':True,'crcPassed':True,'unpackedFilesExactlyMatched':len(payload),'zipCommonFilesExactlyMatched':len(common),'onlyPortable':['resources/elevate.exe'],'asarSha256':sha(payload['resources/app.asar']),'runtimeExeSha256':sha(payload['花伴课堂.exe']),'instructionsMatched':True,'under100MiB':True,'windowsExecuted':False}
 (qa/'folder7z-integrity.txt').write_text(''.join(log));(qa/'folder7z-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False,indent=2))
