from pathlib import Path
import zipfile,json,hashlib,shutil
r=Path(__file__).resolve().parent.parent;out=r.parent.parent/'flower-rc10-deliverables';out.mkdir(exist_ok=True)
reports=r.parent.parent/'outputs/flower-recheck-rc10-20261003';manifest=reports/'RC10-REPORT-MANIFEST.json'
m=json.loads(manifest.read_text());assert m['verification']['pdfPagesVisuallyReviewed'] and m['verification']['workbookSheetsVisuallyReviewed']
f=json.loads((r/'artifacts/rc10/frozen-source.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
for p,h in {**f['files'],**f['packagedDocuments'],**f['packageFiles']}.items():assert sha((r/p).read_bytes())==h,p
reportdir=r/'artifacts/rc10-report';reportdir.mkdir(exist_ok=True)
for p in reports.iterdir():
 if p.is_file() and (p.suffix in ['.xlsx','.pdf'] or p.name==manifest.name):shutil.copy2(p,reportdir/p.name)
files=[]
for name in ['src','assets','scripts','tests','artifacts','checkpoints']:
 for p in (r/name).rglob('*'):
  if p.is_file() and '__pycache__' not in p.parts and 'lock-io-review' not in p.parts and p.suffix not in ['.pyc','.tmp']:files.append(p)
files.extend(p for p in r.iterdir() if p.is_file() and (p.suffix in ['.md','.json','.txt'] or p.name=='LICENSE'))
files=sorted(set(files));plain={'.json','.ndjson','.log','.txt','.md','.csv','.cjs','.mjs','.js','.py','.xlsx','.pdf','.html','.css','.ps1','.svg','.ico','.tap','.patch'}
prefixes=['artifacts/rc10/new-targeted-packaged/','artifacts/rc10/independent-review/recovery-20261004T0022Z/']
compact=[p for p in files if not str(p.relative_to(r)).startswith(('artifacts/','checkpoints/')) or p.suffix in plain or (p.suffix=='.png' and any(str(p.relative_to(r)).startswith(s) for s in prefixes))]
records=[]
for title,chosen in [('完整源码与本次测试证据',files),('源码与测试记录',compact)]:
 dest=out/f'花伴课堂-1.3.0-rc.10-{title}.zip';temp=dest.with_suffix('.zip.tmp')
 note='花伴课堂1.3.0-rc.10。源代码47文件来自已保存的最终ASAR，程序未重新构建。环境替换后重新执行并保存全部最终验证，原先丢失的最终日志不冒充当前记录。原始检查点内真实保存的较早失败/通过记录仍保留。\n本包含完整代码、资源、依赖锁、测试脚本、结构化证据和最终Excel/PDF；'+('包含本次恢复后完成检查的全部截图。' if chosen is files else '包含关键新增及独立复审截图，重复布局截图在完整证据包中。')+'\n未完成锁/文件专项只保留状态说明，原始中止脚本不纳入交付。所有测试为合成资料，无原片学生照片或真实名单。\n最终清单：artifacts/rc10/final-test-manifest.json；恢复说明：artifacts/rc10/recovery/executor-replacement.json。\n开发依赖未打包，可按package-lock.json安装。云端Linux Electron验证不等于Windows现场体验。\n'
 with zipfile.ZipFile(temp,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for p in chosen:z.write(p,'FlowerClassroom-source/'+str(p.relative_to(r)))
  z.writestr('源码包内容说明.txt',note)
 with zipfile.ZipFile(temp) as z:
  assert z.testzip() is None
  for p,h in f['files'].items():assert sha(z.read('FlowerClassroom-source/'+p))==h
  for p in reportdir.iterdir():assert z.read('FlowerClassroom-source/'+str(p.relative_to(r)))==p.read_bytes()
 temp.replace(dest);record={'path':str(dest),'sizeBytes':dest.stat().st_size,'sha256':sha(dest.read_bytes()),'files':len(chosen)+1,'sourceFilesVerified':47,'zipCrcPassed':True,'allCompletedAuditScreenshotsIncluded':chosen is files,'blockedSpecialistRawArtifactsExcluded':True};records.append(record);print(json.dumps(record,ensure_ascii=False),flush=True)
(out/'source-archives.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
