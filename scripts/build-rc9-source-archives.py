from pathlib import Path
import zipfile,json,hashlib,shutil
r=Path(__file__).resolve().parent.parent;out=Path('/tmp/flower-classroom-workspace/flower-rc9-deliverables');out.mkdir(exist_ok=True)
reports=Path('/tmp/flower-classroom-workspace/outputs/flower-recheck-rc9-20261003');report_manifest=reports/'RC9-REPORT-MANIFEST.json'
assert report_manifest.exists(),'Wait for final verified reports'
freeze=json.loads((r/'artifacts/rc9/frozen-source.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
for f,digest in {**freeze['files'],**freeze['packagedDocuments'],**freeze['packageFiles']}.items():assert sha((r/f).read_bytes())==digest
report_dest=r/'artifacts/rc9-report';report_dest.mkdir(exist_ok=True)
for p in reports.iterdir():
 if p.is_file() and (p.suffix in ['.xlsx','.pdf'] or p.name==report_manifest.name):shutil.copy2(p,report_dest/p.name)
files=[]
for d in ['src','assets','scripts','tests','artifacts','checkpoints/rc9-pre-pending-award-fix']:
 for p in (r/d).rglob('*'):
  if p.is_file() and '__pycache__' not in p.parts and p.suffix not in ['.pyc','.tmp']:files.append(p)
files += [p for p in r.iterdir() if p.is_file()]
files=sorted(set(files))
compact_suffix={'.json','.ndjson','.log','.txt','.md','.csv','.cjs','.mjs','.js','.py','.xlsx','.pdf','.html','.css','.ps1','.svg','.ico'}
selected_png_prefixes=['artifacts/rc9/targeted-packaged/','artifacts/rc9/pet-audit/delivered-before/','artifacts/rc9/import-audit/package-before-final/','artifacts/rc9/modal-audit/final-delivered/','artifacts/rc9/modal-audit/pet-concurrent-before/','artifacts/rc9/modal-audit/pet-concurrent-final/']
compact=[]
for p in files:
 rel=p.relative_to(r).as_posix()
 if not rel.startswith(('artifacts/','checkpoints/')) or p.suffix in compact_suffix or (p.suffix=='.png' and any(rel.startswith(x) for x in selected_png_prefixes)):compact.append(p)
records=[]
for tag,chosen in [('完整源码与本次测试证据',files),('源码与测试记录',compact)]:
 dest=out/f'花伴课堂-1.3.0-rc.9-{tag}.zip';tmp=dest.with_suffix('.zip.tmp')
 note='花伴课堂1.3.0-rc.9。运行源码、全部测试脚本、依赖锁、升级说明与结构化测试记录均包含。'+('本包包含本次复查工作目录保留的全部截图；更早版本完整证据包仍单独保留。' if chosen is files else '本包包含全部结构化记录、报告及关键/最终新增审计截图；重复的全量布局截图在同版本完整证据源码包中。')+'\n原视频仅保留文字来源证据，无原片学生照片。所有测试资料为合成数据。\n运行源码47文件指纹见artifacts/rc9/frozen-source.json；最终汇总见artifacts/rc9/final-test-manifest.json。\n此前未交付候选、构建失误与资源超时的原始记录保留，不能当作最终通过。\n报告直接引用JSON和日志，相对路径在此保留。\n开发依赖未打入源码包，可按package-lock.json安装；自动化UI验收使用Linux Electron，不能代替Windows实机。\n'
 with zipfile.ZipFile(tmp,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for p in chosen:z.write(p,'FlowerClassroom-source/'+p.relative_to(r).as_posix())
  z.writestr('源码包内容说明.txt',note)
 with zipfile.ZipFile(tmp) as z:
  assert z.testzip() is None
  for f,digest in freeze['files'].items():assert sha(z.read('FlowerClassroom-source/'+f))==digest
  for p in report_dest.iterdir():assert z.read('FlowerClassroom-source/'+p.relative_to(r).as_posix())==p.read_bytes()
 tmp.replace(dest);records.append({'path':str(dest),'sizeBytes':dest.stat().st_size,'sha256':sha(dest.read_bytes()),'files':len(chosen)+1,'sourceFilesVerified':47,'zipCrcPassed':True,'allDirectReportEvidenceIncluded':True,'allScreenshotsIncluded':chosen is files});print(json.dumps(records[-1],ensure_ascii=False),flush=True)
(out/'source-archives.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
