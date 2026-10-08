from pathlib import Path
import zipfile,json,hashlib,shutil
r=Path(__file__).resolve().parent.parent;out=r.parent.parent/'flower-rc13-deliverables';out.mkdir(exist_ok=True)
reports=r/'outputs/flower-rc13-report';verification=reports/'RC13-REPORT-MANIFEST.json'
v=json.loads(verification.read_text())['verification'];assert v['visualReviewComplete'] and v['xlsxFormulaErrors']==0 and v['evidenceHashesVerified']>0
evidence=json.loads((r/'artifacts/rc13/report/report-input.json').read_text())['evidence'];
f=json.loads((r/'artifacts/rc13/frozen-source.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
for p,h in {**f['files'],**f['avatarAssets'],**f['packagedDocuments'],**f['packageFiles']}.items():assert sha((r/p).read_bytes())==h,p
reportdir=r/'artifacts/rc13-report';reportdir.mkdir(exist_ok=True)
for p in reports.iterdir():
 if p.is_file() and (p.suffix in ['.xlsx','.pdf','.txt'] or p.name in ['verification.json','RC13-REPORT-MANIFEST.json']):shutil.copy2(p,reportdir/p.name)
files=[]
for name in ['src','assets','scripts','tests','artifacts']:
 for p in (r/name).rglob('*'):
  if not p.is_file() or '__pycache__' in p.parts or 'lock-io-review' in p.parts or p.suffix in ['.pyc','.tmp','.asar','.exe','.zip','.7z']:continue
  # Negative tests generate large/sparse fixtures; scripts reproduce them.
  if p.stat().st_size>8*1024*1024 and ('oversized' in p.name.lower() or p.suffix in ['.png','.jpg','.webp','.bin']):continue
  files.append(p)
files.extend(p for p in r.iterdir() if p.is_file() and (p.suffix in ['.md','.json','.txt'] or p.name=='LICENSE'))
files=sorted(set(files));plain={'.json','.ndjson','.log','.txt','.md','.csv','.cjs','.mjs','.js','.py','.xlsx','.pdf','.html','.css','.ps1','.svg','.ico','.tap','.patch'}
important=['artifacts/rc13/features-packaged/','artifacts/rc13/independent-review/packaged-final/','artifacts/rc13/features-source/keyboard-close-retest/','artifacts/avatar-defaults/']
requiredEvidence={e['file'] for e in evidence}
compact=[p for p in files if str(p.relative_to(r)) in requiredEvidence or not str(p.relative_to(r)).startswith('artifacts/') or p.suffix in plain or (p.suffix=='.png' and any(str(p.relative_to(r)).startswith(x) for x in important))]
records=[]
for title,chosen in [('源码与测试记录',compact),('完整源码与测试证据',files)]:
 dest=out/f'花伴课堂-1.3.0-rc.13-{title}.zip';temp=dest.with_suffix('.zip.tmp')
 note='花伴课堂1.3.0-rc.13。52个运行源文件与40张默认头像对应最终生产ASAR；全部40种宠物280形态保持原样。\n包括完整代码、资源、依赖锁、测试脚本、结构化证据、Excel/PDF及使用指南。'+('包含所有保留截图。' if chosen is files else '包含主要新增功能及头像总览截图；重复布局截图在完整证据包中。')+'\n正式冻结源码26套与最终生产包24套全部通过，含317弹层检查；首次中断冻结、修复过程新发现和harness适配均保留。所有原独立缺陷在同一最终ASAR复测闭环，详见报告。不存在全软件零缺陷的保证。\n原先中止的专项保持未验证，原始中止脚本不纳入。测试均为合成资料，不含原片学生照片或真实名单。\n最终清单：artifacts/rc13/final-test-manifest.json。未包含node_modules、发行二进制或大型/稀疏负向测试临时文件；可从锁文件安装依赖，测试脚本会生成这些合成临时输入。\nWindows现场项目与云端Linux Electron结果分开说明。\n'
 with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for p in chosen:z.write(p,'FlowerClassroom-source/'+str(p.relative_to(r)))
  z.writestr('源码包内容说明.txt',note)
 with zipfile.ZipFile(temp) as z:
  assert z.testzip() is None
  for p,h in {**f['files'],**f['avatarAssets']}.items():assert sha(z.read('FlowerClassroom-source/'+p))==h,p
  for p in reportdir.iterdir():assert z.read('FlowerClassroom-source/'+str(p.relative_to(r)))==p.read_bytes()
  for item in evidence:assert sha(z.read('FlowerClassroom-source/'+item['file']))==item['sha256'],item['file']
 temp.replace(dest);record={'path':str(dest),'sizeBytes':dest.stat().st_size,'sha256':sha(dest.read_bytes()),'entries':len(chosen)+1,'sourceFilesVerified':52,'avatarAssetsVerified':40,'zipCrcPassed':True,'reportEvidenceFilesVerified':len(evidence),'allRetainedScreenshotsIncluded':chosen is files,'blockedSpecialistRawArtifactsExcluded':True};records.append(record);print(json.dumps(record,ensure_ascii=False),flush=True)
(out/'source-archives.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
