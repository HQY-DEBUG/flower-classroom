from pathlib import Path
import hashlib,json,datetime
r=Path(__file__).resolve().parent.parent
sha=lambda b:hashlib.sha256(b).hexdigest()
files={p.relative_to(r).as_posix():sha(p.read_bytes()) for p in sorted((r/'src').iterdir()) if p.is_file()}
version=json.loads((r/'package.json').read_text())['version']
assert version=='1.3.0-rc.16' and len(files)>=60
assert files['src/classroom-lock.cjs']=='298b4688eb1a78ad767b7eaf1ff38fecbf735d2be14af6e898bb9ce2cf35d8c7'
assets={p.relative_to(r).as_posix():sha(p.read_bytes()) for p in sorted((r/'assets/avatar-defaults').glob('*.png'))}
assert len(assets)==120
record={'candidateVersion':version,'frozenAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'files':files,'avatarAssets':assets,'assetFiles':{p.relative_to(r).as_posix():sha(p.read_bytes()) for p in sorted((r/'assets').rglob('*')) if p.is_file()},'packagedDocuments':{e['from']:sha((r/e['from']).read_bytes()) for e in json.loads((r/'package.json').read_text())['build']['extraFiles']},'packageFiles':{n:sha((r/n).read_bytes()) for n in ['package.json','package-lock.json']}}
for name in ['rc16','rc9']:
 out=r/'artifacts'/name;out.mkdir(parents=True,exist_ok=True);(out/'frozen-source.json').write_text(json.dumps(record,indent=2)+'\n')
(r/'artifacts/qa').mkdir(parents=True,exist_ok=True);(r/'artifacts/qa/tested-source-sha256.json').write_text(json.dumps(files,indent=2)+'\n')
(r/'artifacts/parity').mkdir(parents=True,exist_ok=True);(r/'artifacts/parity/candidate-frozen-source-sha256.txt').write_text(''.join(f'{v}  {k}\n' for k,v in files.items()))
print(json.dumps({'version':version,'files':len(files),'avatars':len(assets),'frozenAt':record['frozenAt']}))
