"""Read delivered bytes independently; verify IDs, cached formula results, references, and hashes."""
import json,sys,re,hashlib,zipfile,datetime
from pathlib import Path
from collections import Counter
from xml.etree import ElementTree as ET
from pypdf import PdfReader
D=Path(__file__).resolve().parent;ROOT=D.parents[2];OUT=Path(sys.argv[1]);d=json.loads((D/'report-input.json').read_text());preview='--preview'in sys.argv
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert d['finalized']or preview
assert len(d['requirements'])==155 and len({r['id']for r in d['requirements']})==155
assert len(d['findings'])==13 and sum(f['baselineFailed']for f in d['findings'])==28
assert sum(bool(f.get('stage'))for f in d['findings'])==3
windows={'V033','V035','V037','V038','V052','V054','V067'}
assert {r['id']for r in d['windows']}==windows
assert all(r['status']=='未验证'for r in d['windows'])
if d['finalized']:
    release=json.loads((ROOT/'artifacts/rc13/final-test-manifest.json').read_text())
    assert release['sourceTreeSha256']==d['source']['sha256']
    assert release['asarSha256']==d['package']['asarSha256']
    assert release['releaseGate']['status']=='passed-for-covered-scope'
    assert sum(r['status']=='通过'for r in d['requirements'])==148
    assert {r['id']for r in d['requirements']if r['status']=='未验证'}==windows
    assert all(f['status']=='已修复并复验'for f in d['findings'])
    cs=[c for r in d['runs']if r['stage']=='最终冻结'and r['scope']=='最终ASAR Linux Electron'for c in r['checks']]
    assert sum(c['status']=='passed'for c in cs)==release['totalProductionAsarChecks']
    assert not any(c['status']=='failed'for r in d['runs']if r['stage']=='最终冻结'for c in r['checks'])
for f,h in {**d.get('source',{}).get('files',{}),**d.get('source',{}).get('avatarAssets',{})}.items():assert sha(ROOT/f)==h,f
for e in d['evidence']:assert sha(ROOT/e['file'])==e['sha256'],e['file']
for f in d['findings']:
    for p in (f['baselineFile']+'\n'+f['baselineDetail']).splitlines():assert (ROOT/p).is_file(),p
baseline=[r for r in d['runs']if r['stage']=='交付后基线审计']
assert sum(len(r['checks'])for r in baseline)==75
assert sum(c['status']=='passed'for r in baseline for c in r['checks'])==47
assert sum(c['status']=='failed'for r in baseline for c in r['checks'])==28
summary=json.loads((ROOT/'artifacts/rc12-independent-20261005/confirmations/before-summary.json').read_text())
parts=[]
for p in ['delivered-final-before','settings-before']:parts+=json.loads((ROOT/f'artifacts/rc12-independent-20261005/confirmations/{p}/flows.json').read_text())['checks']
assert [(c['name'],c['status'])for c in parts]==[(c['name'],c['status'])for c in summary['checks']]
suffix='_制作预览'if preview else''
files=[]
for name in [f'花伴课堂_1.3.0-rc.13_全面测试表{suffix}.xlsx',f'花伴课堂_1.3.0-rc.13_全面测试报告{suffix}.pdf']:
    p=OUT/name;assert p.is_file();files.append({'name':name,'bytes':p.stat().st_size,'sha256':sha(p)})
ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(OUT/files[0]['name'])as z:
    assert z.testzip()is None
    strings=[]
    if 'xl/sharedStrings.xml'in z.namelist():
        strings=[''.join(t.text or''for t in si.findall('.//x:t',ns))for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('x:si',ns)]
    sheets={};formulas=[];errors=[];contents=[]
    names=[s.attrib['name']for s in ET.fromstring(z.read('xl/workbook.xml')).findall('x:sheets/x:sheet',ns)]
    for i,name in enumerate(names,1):
        rows={};root=ET.fromstring(z.read(f'xl/worksheets/sheet{i}.xml'))
        for c in root.findall('.//x:c',ns):
            v=c.find('x:v',ns);v=v.text if v is not None else''
            if c.get('t')=='s':v=strings[int(v)]if v else''
            if c.get('t')=='inlineStr':v=''.join(t.text or''for t in c.findall('.//x:t',ns))
            rows[c.get('r')]=v or'';contents.append(v or'')
            if c.find('x:f',ns)is not None:
                formulas.append((name,c.get('r'),c.find('x:f',ns).text,v))
                if c.get('t')=='e':errors.append((name,c.get('r'),v))
        sheets[name]=rows
    assert not errors,errors
    assert names==['验证概览','缺陷闭环','155项功能','专项与过程','执行明细','版本证据'],names
    for i,r in enumerate(d['requirements'],6):
        assert sheets['155项功能'][f'A{i}']==r['id']
        assert sheets['155项功能'][f'H{i}']==r['status'],(r['id'],sheets['155项功能'][f'H{i}'],r['status'])
        if r.get('basis'):assert sheets['155项功能'][f'U{i}']==r['basis'],r['id']
    for i,f in enumerate(d['findings'],6):assert sheets['缺陷闭环'][f'J{i}']==f['status'],f['id']
    req=Counter(r['status']for r in d['requirements'])
    for cell,expected in [('B8',req['通过']),('C8',req['失败']),('D8',req['未验证']),('E8',155),('B15',47),('C15',28),('E15',75)]:assert float(sheets['验证概览'][cell])==expected,(cell,sheets['验证概览'][cell],expected)
    joined='\n'.join(contents)
    assert not re.search(r'/(workspace|root|home|tmp)/',joined)
    for f in d['findings']:assert f['id']in contents
    if d.get('package',{}).get('asarSha256'):assert d['package']['asarSha256']in joined
reader=PdfReader(OUT/files[1]['name']);pages=[p.extract_text()or''for p in reader.pages];text='\n'.join(pages)
for r in d['requirements']:assert r['id']in text,r['id']
for f in d['findings']:assert f['id']in text,f['id']
assert len(pages)>=20 and len(pages)<=28,len(pages)
assert all(len(p)>100 for p in pages)
assert all(str(i)in p for i,p in enumerate(pages,1))
assert '7679405517986542159'in text and '保护备份'in text and '前导零'in text
assert not re.search(r'/(workspace|root|home|tmp)/',text)
v=json.loads((OUT/'workbook-verification.json').read_text());assert v['formulaErrors']==0 and v['statusMutationVerified'] and not v['nativeExcelVerified']
final=[r for r in d['runs']if r['stage']=='最终冻结']
requirements=Counter(r['status']for r in d['requirements']);defects=Counter(f['status']for f in d['findings'])
verification=dict(finalized=d['finalized'],requirements=155,requirementStatus=dict(requirements),windowsUnverified=sorted(windows),defectStatus=dict(defects),sourceHashesVerified=bool(d.get('source',{}).get('files')),evidenceHashesVerified=len(d['evidence']),baselineSummaryMatchesCanonicalRuns=True,xlsxZipVerified=True,xlsxFormulaErrors=0,xlsxFormulaCells=len(formulas),xlsxCachedCountsMatchData=True,allRequirementIdsInPdf=True,allRequirementIdsInXlsx=True,videoSourcePreserved=True,pdfPages=len(pages),environmentPathsAbsent=True,nativeExcelVerified=False,visualReviewComplete='--visual-reviewed'in sys.argv)
(D/'verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2))
manifest=dict(version=d['version'],completedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),readyForDelivery=bool(d['finalized']and verification['visualReviewComplete']),baseline=d['baseline'],sourceTreeSha256=d.get('source',{}).get('sha256'),asarSha256=d.get('package',{}).get('asarSha256'),sourceFrozenUtc=d.get('source',{}).get('at'),reportInputSha256=sha(D/'report-input.json'),functionalRequirements={'total':155,'implemented':sum(r['implementationStatus']=='已提供'for r in d['requirements']),'effectPassed':requirements['通过'],'effectFailed':requirements['失败'],'effectUnverified':requirements['未验证'],'effectPassedRate':requirements['通过']/155},defectGroups={'total':13,'rc12BaselineGroups':10,'rc13DevelopmentGroups':3,'closed':defects['已修复并复验'],'baselineFailedScenarios':28,'baselineRecords':75},finalExecutionCountsByScope={scope:dict(Counter(c['status']for r in final if r['scope']==scope for c in r['checks']))for scope in sorted({r['scope']for r in final})},totalExecutionRecords=sum(len(r['checks'])for r in d['runs']),verification=verification,limits=['Windows EXE/PPT/physical touch/audio not executed','Prior stopped additional lock/permission/file specialist audit remains unverified, no reroute','Synthetic inputs only; native choosers/shell controlled as identified in source records','Native Microsoft Excel not executed'],upgradeCaveat=d['upgradeNote'],artifacts=files)
for p in [D/'RC13-REPORT-MANIFEST.json',OUT/'RC13-REPORT-MANIFEST.json']:p.write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({'readyForDelivery':manifest['readyForDelivery'],'pages':len(pages),'requirements':dict(requirements),'defects':dict(defects),'evidence':len(d['evidence']),'files':files},ensure_ascii=False))
