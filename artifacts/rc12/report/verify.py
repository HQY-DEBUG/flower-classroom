import json,sys,re,hashlib,zipfile,datetime
from pathlib import Path
from collections import Counter
from xml.etree import ElementTree as ET
from pypdf import PdfReader

D=Path(__file__).resolve().parent;ROOT=D.parents[2];OUT=Path(sys.argv[1]);d=json.loads((D/'report-input.json').read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert d['finalized'],'Final report configuration is not finalized'
assert len(d['requirements'])==155
assert len(d['findings'])==11
assert all(f['status']=='已修复并复验'for f in d['findings']),[(f['id'],f['status'])for f in d['findings']]
unverified={r['id']for r in d['requirements']if r['status']=='未验证'}
assert unverified=={'V033','V035','V037','V038','V052','V054','V067'},unverified
assert sum(r['status']=='通过'for r in d['requirements'])==148
assert all(r['implementationStatus']=='已提供'for r in d['requirements'])
for f,h in {**d['source']['files'],**d['source'].get('avatarAssets',{})}.items():assert sha(ROOT/f)==h,f
for e in d['evidence']:assert sha(ROOT/e['file'])==e['sha256'],e['file']
final=[r for r in d['runs']if r['stage']=='最终冻结']
assert final and all(c['status']!='failed'for r in final for c in r['checks'])
review_path=ROOT/'artifacts/rc12/independent-review/FINAL-REVIEW.json'
review=json.loads(review_path.read_text())
assert review['status']=='passed' and not review['openFindings']
assert review['archiveSha256']==d['package']['asarSha256']
assert review['behavior']['cases']==review['behavior']['passed']==21 and review['behavior']['failed']==0
assert review['sourceCount']==52 and review['avatarCount']==40
assert all(r['sourceMatches']and r['archiveMatches']for r in review['sourceFiles'])
files=[]
for name in ['花伴课堂_1.3.0-rc.12_全面测试表.xlsx','花伴课堂_1.3.0-rc.12_全面测试报告.pdf']:
    p=OUT/name;assert p.is_file();files.append({'name':name,'bytes':p.stat().st_size,'sha256':sha(p)})
x=OUT/files[0]['name'];pdf=OUT/files[1]['name']
ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(x)as z:
    assert z.testzip()is None
    strings=[]
    if 'xl/sharedStrings.xml'in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('x:si',ns):strings.append(''.join(t.text or''for t in si.findall('.//x:t',ns)))
    contents=[];formula_errors=[];formula_count=0
    for f in z.namelist():
        if f.startswith('xl/worksheets/sheet')and f.endswith('.xml'):
            for c in ET.fromstring(z.read(f)).findall('.//x:c',ns):
                v=c.find('x:v',ns);value=v.text if v is not None else''
                if c.get('t')=='s':value=strings[int(value)]if value else''
                if c.get('t')=='inlineStr':value=''.join(t.text or''for t in c.findall('.//x:t',ns))
                contents.append(value or'')
                if c.find('x:f',ns)is not None:
                    formula_count+=1
                    if c.get('t')=='e':formula_errors.append((f,c.get('r'),value))
    assert not formula_errors,formula_errors
    joined='\n'.join(contents)
    assert not re.search(r'/(workspace|root|home|tmp)/',joined),'Environment path leaked into workbook'
    for r in d['requirements']:assert r['id']in contents,r['id']
    for f in d['findings']:assert f['id']in contents,f['id']
    assert d['package']['asarSha256']in joined
reader=PdfReader(pdf);pdftext='\n'.join(p.extract_text()or''for p in reader.pages)
for r in d['requirements']:assert r['id']in pdftext,r['id']
for f in d['findings']:assert f['id']in pdftext,f['id']
assert 'Windows'in pdftext and '前导零'in pdftext
assert not re.search(r'/(workspace|root|home|tmp)/',pdftext)
v=json.loads((OUT/'workbook-verification.json').read_text());assert v['formulaErrors']==0 and v['statusMutationVerified'] and not v['nativeExcelVerified']
verification=dict(requirements=155,effectPassed=148,windowsUnverified=sorted(unverified),issueGroupsClosed=11,sourceHashesVerified=True,evidenceHashesVerified=len(d['evidence']),independentFinalReviewVerified=True,independentFinalReviewSha256=sha(review_path),xlsxZipVerified=True,xlsxFormulaErrors=0,xlsxFormulaCells=formula_count,pdfPages=len(reader.pages),allRequirementIdsInPdf=True,allRequirementIdsInXlsx=True,environmentPathsAbsent=True,nativeExcelVerified=False,visualReviewComplete='--visual-reviewed'in sys.argv)
(D/'verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2))
scopes={scope:dict(Counter(c['status']for r in final if r['scope']==scope for c in r['checks']))for scope in sorted({r['scope']for r in final})}
base={r['id']:dict(Counter(c['status']for c in r['checks']))for r in d['runs']if r['stage']=='交付后基线审计'}
manifest=dict(version=d['version'],completedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),readyForDelivery=verification['visualReviewComplete'],baseline=d['baseline'],sourceTreeSha256=d['source']['sha256'],asarSha256=d['package']['asarSha256'],sourceFrozenUtc=d['source']['at'],reportInputSha256=sha(D/'report-input.json'),functionalRequirements={'implemented':155,'total':155,'effectPassed':148,'effectFailed':0,'effectUnverified':7,'effectPassedRate':148/155,'newRequirements':37,'inheritedRequirements':118},defectGroups={'closed':11,'total':11,'rc11BaselineGroups':10,'rc12DevelopmentGroups':1,'baselineFailedScenarios':d['baselineFailed'],'keyboardSubscenarios':d['keyboardScenarioCount']},baselineRuns=base,finalExecutionCountsByScope=scopes,totalExecutionRecords=sum(len(r['checks'])for r in d['runs']),verification=verification,limits=['Windows EXE/PPT/physical touch/audio behavior not executed','Prior platform-stopped additional lock/permission/file audit remains unverified; no reroute','Native file chooser and shell interactions controlled with synthetic fixtures','Native Microsoft Excel not executed'],upgradeCaveat=d['upgradeNote'],artifacts=files)
(D/'RC12-REPORT-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2));(OUT/'RC12-REPORT-MANIFEST.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps(manifest,ensure_ascii=False,indent=2))
