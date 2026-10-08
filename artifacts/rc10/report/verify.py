import json,sys,hashlib,zipfile,xml.etree.ElementTree as E,re
from pathlib import Path
from pypdf import PdfReader
root=Path(__file__).resolve().parents[3];out=Path(sys.argv[1]);d=json.loads((root/'artifacts/rc10/report/report-input.json').read_text());assert d['finalized']
xlsx=out/'花伴课堂_1.3.0-rc.10_独立复查详细测试表.xlsx';pdf=out/'花伴课堂_1.3.0-rc.10_独立复查简要报告.pdf';ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(xlsx)as z:
 assert z.testzip()is None
 names=[s.attrib['name']for s in E.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns)];assert names==['复查概览','专项复验','执行记录','视频与功能','过程与未验证','版本证据']
 strings=[''.join(e.itertext())for e in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]if'xl/sharedStrings.xml'in z.namelist()else[]
 def value(c):
  v=c.find('s:v',ns)
  if v is None:return ''.join(c.find('s:is',ns).itertext())if c.find('s:is',ns)is not None else None
  return strings[int(v.text)]if c.attrib.get('t')=='s'else v.text
 sheets={};formulas=panes=validations=0;errors=[]
 for i,name in enumerate(names,1):
  t=E.fromstring(z.read(f'xl/worksheets/sheet{i}.xml'));sheets[name]={c.attrib['r']:value(c)for c in t.findall('.//s:c',ns)};formulas+=len(t.findall('.//s:f',ns));panes+=len(t.findall('.//s:pane',ns));validations+=len(t.findall('.//s:dataValidation',ns));errors.extend((name,c.attrib.get('r'))for c in t.findall('.//s:c',ns)if c.attrib.get('t')=='e')
 assert not errors;assert panes==5;assert validations==1
 for row,g in enumerate(['存档恢复','事务回执','工具草稿与恢复','进程中断恢复'],6):
  rr=[r for r in d['scenarios']if r['suite']==g];p=sum(r['sourceStatus']==r['packageStatus']=='通过'for r in rr);f=sum('失败'in[r['sourceStatus'],r['packageStatus']]for r in rr)
  for col,val in zip('BCDE',[p,f,len(rr)-p-f,len(rr)]):assert float(sheets['复查概览'][f'{col}{row}'])==val
 for row,scope in enumerate(['冻结源码','最终ASAR','启动专项','独立再审','预览专项'],12):
  cs=[c for r in d['runs']if r['scope']==scope for c in r['checks']]
  for col,val in zip('BCDE',[sum(c['status']=='passed'for c in cs),sum(c['status']=='failed'for c in cs),sum(c['status']not in['passed','failed']for c in cs),len(cs)]):assert float(sheets['复查概览'][f'{col}{row}'])==val
 for row,cat in enumerate(['原片','补充','RC6新增'],19):
  rr=[r for r in d['features']if r['category']==cat]
  for col,val in zip('BCDE',[sum(r['rc10Status']=='通过'for r in rr),sum(r['rc10Status']=='失败'for r in rr),sum(r['rc10Status']=='未验证'for r in rr),len(rr)]):assert float(sheets['复查概览'][f'{col}{row}'])==val
  impl=sum(r['implementationStatus']=='已提供'for r in rr);assert f'{impl}/{len(rr)}'in sheets['复查概览'][f'H{row}'];assert f'{impl/len(rr):.1%}'in sheets['复查概览'][f'H{row}']
 for row,f in enumerate(d['features'],6):assert sheets['视频与功能'][f'O{row}']==f['implementationStatus'] and sheets['视频与功能'][f'P{row}']==f['implementationEvidence']
 for row,r in enumerate(d['scenarios'],6):
  assert sheets['专项复验'][f'F{row}']==r['sourceStatus'];assert sheets['专项复验'][f'G{row}']==r['packageStatus'];assert sheets['专项复验'][f'I{row}']==r['independentStatus']
 assert not any(re.search(r'/(workspace|root|home|tmp)/',s)for s in strings)
r=PdfReader(pdf);assert 3<=len(r.pages)<=4,len(r.pages);text='\n'.join(p.extract_text()for p in r.pages);tight=re.sub(r'\s+','',text)
for h in [d['version'],d['source']['sha256'],d['package']['asarSha256'],d['baseline']['asarSha256'],d['baseline']['exeSha256']]+[f['sha256']for f in d['package']['files']]:assert h in tight,h
assert not re.search(r'/(workspace|root|home|tmp)/',text)
for e in d['evidence']:assert hashlib.sha256((root/e['file']).read_bytes()).hexdigest()==e['sha256'],e['file']
for f,h in d['source']['files'].items():assert hashlib.sha256((root/f).read_bytes()).hexdigest()==h,f
v=json.loads((out/'workbook-verification.json').read_text());assert v['finalized']and not v['preview']and v['formulaErrors']==0 and v['statusMutationVerified'];assert sorted(f['id']for f in d['features']if f['rc10Status']=='未验证')==['V033','V035','V037','V038','V052','V054','V067']
m={'version':d['version'],'frozenAt':d['source']['at'],'sourceTreeSha256':d['source']['sha256'],'asarSha256':d['package']['asarSha256'],'files':[{'name':f.name,'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}for f in[xlsx,pdf]],'releaseGate':d['releaseGate'],'counts':{'scenarioRows':len(d['scenarios']),**{s:sum(len(r['checks'])for r in d['runs']if r['scope']==s)for s in ['冻结源码','最终ASAR','启动专项','独立再审','预览专项']},'features':{cat:{'passed':sum(f['category']==cat and f['rc10Status']=='通过'for f in d['features']),'total':sum(f['category']==cat for f in d['features'])}for cat in ['原片','补充','RC6新增']}},'verification':{'xlsxSheets':len(names),'formulaCount':formulas,'formulaErrors':0,'freezePanes':panes,'dataValidations':validations,'formulaCachesMatch':True,'statusMutationVerified':True,'pdfPages':len(r.pages),'sourceReferencesVerified':len(d['evidence']),'frozenSourceFilesMatch':len(d['source']['files']),'nativeExcelVerified':False,'windowsExecuted':False,'pdfPagesVisuallyReviewed':False,'workbookSheetsVisuallyReviewed':False},'limits':['7项Windows现场未验证','新增锁/文件专项被风险拦截，未绕路或重试','环境替换后使用新取证，不重构丢失的原始日志','进程突停不证明真实断电耐久','收据为进程/原窗口128条有界范围']}
m['counts']['implementationProvided']={cat:{'provided':sum(f['category']==cat and f['implementationStatus']=='已提供' for f in d['features']),'total':sum(f['category']==cat for f in d['features'])}for cat in ['原片','补充','RC6新增']}
m['verification']['implementationAndValidationDistinct']=True
(out/'RC10-REPORT-MANIFEST.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n');print(json.dumps(m,ensure_ascii=False,indent=2))
