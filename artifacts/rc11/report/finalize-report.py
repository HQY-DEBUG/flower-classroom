import json,hashlib,datetime,sys
from pathlib import Path
from collections import Counter

directory=Path(__file__).resolve().parent;root=directory.parents[2];out=Path(sys.argv[1])
read=lambda p:json.loads(Path(p).read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
d=read(directory/'report-input.json');v=read(directory/'verification.json')
assert d['finalized'] and v['visualReviewComplete']
files=[]
for name in ['花伴课堂_1.3.0-rc.11_详细测试表.xlsx','花伴课堂_1.3.0-rc.11_详细测试报告.pdf','花伴课堂_1.3.0-rc.11_升级与使用速查.pdf','花伴课堂_1.3.0-rc.11_升级与使用速查.txt']:
    p=out/name;assert p.exists();files.append(dict(name=name,sizeBytes=p.stat().st_size,sha256=sha(p)))
scopes={scope:dict(Counter(c['status']for r in d['runs']if r['scope']==scope for c in r['checks']))for scope in sorted({r['scope']for r in d['runs']})}
manifest=dict(version=d['version'],completedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),readyForDelivery=True,
 sourceTreeSha256=d['source']['sha256'],asarSha256=d['package']['asarSha256'],sourceFrozenUtc=d['source']['at'],
 reportInputSha256=sha(directory/'report-input.json'),sourceManifest='artifacts/rc11/final-test-manifest.json',sourceManifestSha256=sha(root/'artifacts/rc11/final-test-manifest.json'),
 verification=v,featureVerification={'rc11NewPassed':37,'rc11NewTotal':37,'existingPassed':111,'existingTotal':118,'existingImplementationProvided':118,'unverifiedWindowsItems':['V033','V035','V037','V038','V052','V054','V067']},
 countsByScope=scopes,totalExecutionRecords=3279,actualProductionAsarChecks=1128,
 countDefinition='1128 = 1119 main/specialized Electron checks + 9 independent final-ASAR checks. Independent scope 51 includes those 9 and must not be added again. 441 extracted-package Node checks are separate.',
 modal317Definition='317 unique checks reconciled across preserved runs: initial 315/317, overstrict-wait iteration 309/317, affected-family final 35/35. There is no claim of a single all-green 317 run.',
 logEvidenceLocatorConvention='For .log/.tap evidence, checks[n] refers to the nth normalized test in original order (zero-based); locate it by the exact check name in the execution sheet. JSON locators retain their literal paths.',
 limits=['Windows EXE execution not performed','Native file choosers/openPath controlled with synthetic fixtures','Prior platform-stopped additional lock/permission/file audit remains unverified; no reroute','Native Excel execution not performed'],artifacts=files)
(directory/'RC11-REPORT-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
(out/'RC11-REPORT-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps(manifest,ensure_ascii=False,indent=2))
