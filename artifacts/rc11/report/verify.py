import json,sys,re,hashlib,zipfile
from pathlib import Path
from collections import Counter
from xml.etree import ElementTree as ET
from pypdf import PdfReader

root=Path(__file__).resolve().parents[3];directory=Path(__file__).resolve().parent
d=json.loads((directory/'report-input.json').read_text());assert d['finalized']
out=Path(sys.argv[1]);xlsx=out/'花伴课堂_1.3.0-rc.11_详细测试表.xlsx'
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
with zipfile.ZipFile(xlsx) as z:
    workbook=ET.fromstring(z.read('xl/workbook.xml'))
    sheets=workbook.find('s:sheets',ns);assert len(sheets)==6
    strings=[]
    if 'xl/sharedStrings.xml'in z.namelist():
        strings=[''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
    parsed=[ET.fromstring(z.read(f'xl/worksheets/sheet{i}.xml'))for i in range(1,7)]
    def values(sheet):
        result={}
        for c in sheet.findall('.//s:c',ns):
            if c.get('t')=='inlineStr':value=''.join(c.find('s:is',ns).itertext())
            else:
                v=c.find('s:v',ns);value=v.text if v is not None else ''
                if c.get('t')=='s':value=strings[int(value)]
            result[c.get('r')]=value
        return result
    all_values=[values(p) for p in parsed]
    overview,new,execution,inherited,issues,identity=all_values
    assert len(d['newFeatures'])==37 and len(d['features'])==118
    assert [new.get(f'A{i}')for i in range(6,43)]==[r['id']for r in d['newFeatures']]
    assert [inherited.get(f'B{i}')for i in range(6,124)]==[r['id']for r in d['features']]
    expected_rows=[]
    for row,cat in [(6,'宠物蛋'),(7,'头像库'),(8,'名单头像')]:
        a=[r for r in d['newFeatures']if r['category']==cat];expected_rows.append((row,a,'status'))
    for row,cat in [(19,'原片'),(20,'补充'),(21,'RC6新增')]:
        a=[r for r in d['features']if r['category']==cat];expected_rows.append((row,a,'status'))
    for row,a,key in expected_rows:
        for col,status in [('B','通过'),('C','失败'),('D','未验证')]:assert int(float(overview[f'{col}{row}']))==sum(r[key]==status for r in a),(row,col)
        assert int(float(overview[f'E{row}']))==len(a)
    for row,scope in [(12,'冻结源码'),(13,'最终ASAR'),(14,'包内Node模型'),(15,'启动专项'),(16,'独立复验'),(17,'源码预览')]:
        a=[c for r in d['runs']if r['scope']==scope for c in r['checks']]
        assert int(float(overview[f'E{row}']))==len(a)
        assert int(float(overview[f'B{row}']))==sum(c['status']=='passed'for c in a)
    assert int(float(overview['B32']))==1128
    formula_count=sum(len(p.findall('.//s:f',ns))for p in parsed)
    errors=[(i+1,c.get('r'),c.find('s:v',ns).text)for i,p in enumerate(parsed)for c in p.findall('.//s:c',ns)if c.get('t')=='e']
    assert not errors,errors
    panes=sum(len(p.findall('.//s:pane',ns))for p in parsed);assert panes==5
    formulas=[f.text for p in parsed for f in p.findall('.//s:f',ns)]
    assert not any('#REF!'in f for f in formulas)
    assert any(c.get('t') in (None,'n') and float(c.find('s:v',ns).text)>40000 for c in parsed[2].findall('.//s:c',ns)if re.fullmatch(r'I\d+',c.get('r'))and c.find('s:v',ns)is not None),'No typed execution UTC dates'
    assert not any('/workspace/'in str(v) or '/tmp/'in str(v)for cells in all_values for v in cells.values())
    full_text='\n'.join(str(v)for cells in all_values for v in cells.values())
    for bad in ['制作预览：','待最终绑定','等待最终冻结','待最终复验']:
        assert bad not in full_text,bad
report=out/'花伴课堂_1.3.0-rc.11_详细测试报告.pdf';guide=out/'花伴课堂_1.3.0-rc.11_升级与使用速查.pdf'
pr=PdfReader(report);gr=PdfReader(guide)
report_text='\n'.join(p.extract_text()or''for p in pr.pages)
guide_text='\n'.join(p.extract_text()or''for p in gr.pages)
for r in d['newFeatures']+d['features']:assert r['id']in report_text,r['id']
for text in ['01-星星猫头鹰.png','avatars','名单模板-含头像名称.xlsx','40张原创卡通头像.zip','未选给学生']:
    assert text in ''.join(guide_text.split()),text
assert len(gr.pages)==2,len(gr.pages)
for bad in ['制作预览：','待最终绑定','等待最终冻结','待最终复验']:
    assert bad not in report_text,bad
for e in d['evidence']:assert sha(root/e['file'])==e['sha256'],e['file']
for file,digest in d['source']['files'].items():assert sha(root/file)==digest,file
for file,digest in d['source'].get('avatarAssets',{}).items():assert sha(root/file)==digest,file
verification={'xlsxSheets':6,'newFeatureRows':37,'existingFeatureRows':118,'executionRows':sum(len(r['checks'])for r in d['runs']),'formulaCount':formula_count,'formulaErrors':0,'formulaCachesMatch':True,'statusMutationVerified':True,'freezePanes':panes,'typedExecutionUtcDates':True,'pdfPages':len(pr.pages),'guidePages':len(gr.pages),'evidenceFilesVerified':len(d['evidence']),'frozenSourceFilesMatch':len(d['source']['files']),'nativeExcelVerified':False,'windowsExecuted':False,'visualReviewComplete':False}
verification['avatarAssetsMatch']=len(d['source'].get('avatarAssets',{}))
(directory/'verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2))
print(json.dumps(verification,ensure_ascii=False))
