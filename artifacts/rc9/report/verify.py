import json,sys,hashlib,zipfile,xml.etree.ElementTree as E,re
from pathlib import Path
from pypdf import PdfReader
root=Path('/tmp/flower-classroom-workspace/flower-rc9-audit-work/FlowerClassroom-source');out=Path(sys.argv[1]);d=json.loads((root/'artifacts/rc9/report/report-input.json').read_text());assert d['finalized']
xlsx=out/'花伴课堂_1.3.0-rc.9_独立复查详细测试表.xlsx';pdf=out/'花伴课堂_1.3.0-rc.9_独立复查简要报告.pdf'
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(xlsx)as z:
 assert z.testzip()is None
 names=[s.attrib['name']for s in E.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns)]
 assert names==['复查概览','重点复查','执行记录','功能逐项复验','过程与平台边界','版本证据']
 strings=[''.join(e.itertext())for e in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]if'xl/sharedStrings.xml'in z.namelist()else[]
 def value(c):
  v=c.find('s:v',ns)
  if v is None:return ''.join(c.find('s:is',ns).itertext())if c.find('s:is',ns)is not None else None
  if c.attrib.get('t')=='s':return strings[int(v.text)]
  return v.text
 sheets={};formulas=panes=validations=0;errors=[]
 for i,name in enumerate(names,1):
  t=E.fromstring(z.read(f'xl/worksheets/sheet{i}.xml'));sheets[name]={c.attrib['r']:value(c)for c in t.findall('.//s:c',ns)}
  formulas+=len(t.findall('.//s:f',ns));panes+=len(t.findall('.//s:pane',ns));validations+=len(t.findall('.//s:dataValidation',ns));errors.extend((name,c.attrib.get('r'))for c in t.findall('.//s:c',ns)if c.attrib.get('t')=='e')
 assert not errors;assert panes==5;assert validations==1
 expected_groups=['宠物与毕业','导入与导出','破坏性确认','基础弹层','异步编辑扩展','跨班级一致性','回执恢复']
 for row,group in enumerate(expected_groups,6):
  records=[r for r in d['scenarios']if r['suite']==group]
  counts=[sum(r['sourceStatus']==r['packageStatus']=='通过'for r in records),sum('失败'in[r['sourceStatus'],r['packageStatus']]for r in records),sum('未验证'in[r['sourceStatus'],r['packageStatus']]and'失败'not in[r['sourceStatus'],r['packageStatus']]for r in records),len(records)]
  for col,val in zip('BCDE',counts):assert float(sheets['复查概览'][f'{col}{row}'])==val,(row,col,val,sheets['复查概览'].get(f'{col}{row}'))
 for row,scope in [(14,'冻结源码'),(15,'最终ASAR'),(16,'启动专项')]:
  cs=[c for r in d['runs']if r['scope']==scope for c in r['checks']]
  for col,val in zip('BCDE',[sum(c['status']=='passed'for c in cs),sum(c['status']=='failed'for c in cs),sum(c['status']not in['passed','failed']for c in cs),len(cs)]):assert float(sheets['复查概览'][f'{col}{row}'])==val
 for row,r in enumerate(d['scenarios'],6):
  assert sheets['重点复查'][f'F{row}']==r['sourceStatus'];assert sheets['重点复查'][f'G{row}']==r['packageStatus'];assert sheets['重点复查'][f'H{row}']=='通过'
 assert not any(re.search(r'/(workspace|root|home|tmp)/',s)for s in strings)
reader=PdfReader(pdf);assert len(reader.pages)==3,len(reader.pages)
txt='\n'.join(p.extract_text()for p in reader.pages);tight=re.sub(r'\s+','',txt)
for required in [d['version'],d['source']['sha256'],d['package']['asarSha256'],d['baseline']['asarSha256'],d['baseline']['exeSha256']]+[f['sha256']for f in d['package']['files']]:assert required in tight,required
assert not re.search(r'/(workspace|root|home|tmp)/',txt)
for e in d['evidence']:assert hashlib.sha256((root/e['file']).read_bytes()).hexdigest()==e['sha256'],e['file']
for f,sha in d['source']['files'].items():assert hashlib.sha256((root/f).read_bytes()).hexdigest()==sha,f
for r in d['processNotes']:assert (root/r['file']).exists(),r['file']
v=json.loads((out/'workbook-verification.json').read_text());assert v['finalized']and not v['preview']and v['formulaErrors']==0 and v['statusMutationVerified']
assert {c:sum(r['category']==c and r['rc9Status']=='通过'for r in d['features'])for c in ['原片','补充','RC6新增']}=={'原片':68,'补充':28,'RC6新增':15}
assert sorted(r['id']for r in d['features']if r['rc9Status']=='未验证')==['V033','V035','V037','V038','V052','V054','V067']
manifest={'version':d['version'],'frozenAt':d['source']['at'],'sourceTreeSha256':d['source']['sha256'],'asarSha256':d['package']['asarSha256'],'files':[{'name':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}for f in[xlsx,pdf]],'counts':{'targetedScenarioRows':len(d['scenarios']),'sourceChecks':sum(len(r['checks'])for r in d['runs']if r['scope']=='冻结源码'),'asarChecks':sum(len(r['checks'])for r in d['runs']if r['scope']=='最终ASAR'),'originalPassed':68,'originalUnverified':7,'supplementPassed':28,'rc6AddedPassed':15},'verification':{'xlsxSheets':len(names),'formulaCount':formulas,'formulaErrors':0,'freezePanes':panes,'dataValidations':validations,'formulaCachesMatch':True,'statusMutationVerified':True,'pdfPages':len(reader.pages),'sourceReferencesVerified':len(d['evidence']),'frozenSourceFilesMatch':len(d['source']['files']),'nativeExcelVerified':False,'windowsExecuted':False,'pdfPagesVisuallyReviewed':False,'workbookSheetsVisuallyReviewed':False},'limits':['云端Linux Electron与真实ASAR，不替代Windows现场','故障注入与正常生产路径分开','收据为当前进程/原窗口内有界保留','未交付候选纠正与RC8-r2缺陷分开']}
(out/'RC9-REPORT-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n');print(json.dumps(manifest,ensure_ascii=False,indent=2))
