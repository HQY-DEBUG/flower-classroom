"""Independently verify delivered XLSX/PDF bytes and all selected evidence hashes."""
import datetime,hashlib,json,re,sys,zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET
from pypdf import PdfReader
from bindings import validate_index

D=Path(__file__).resolve().parent;ROOT=D.parents[2];OUT=Path(sys.argv[1]);d=json.loads((D/'report-input.json').read_text());preview='--preview'in sys.argv
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
assert d.get('finalized')or preview
assert len(d['requirements'])==190 and len({r['id']for r in d['requirements']})==190
old=json.loads((D/'baseline-report-input.json').read_text())
assert {r['id']for r in old['requirements']}.issubset({r['id']for r in d['requirements']})
baseline_by_id={r['id']:r for r in old['requirements']}
for row in d['requirements']:
    prior=baseline_by_id[row['id']]
    for field in ('basis','sourceKind','baselineKind'):
        assert row.get(field)==prior.get(field),('requirement source changed',row['id'],field)
    assert row['historicalStatus']==prior['status'],('historical status changed',row['id'])
assert d['baselineArchiveSha256']=='45aa76715e4e85921aca2d52d920274d2884ca0e1077575b9f9b7d447c3c33cd'
assert d['baselineAsarSha256']=='193ae2b1be926229478b41dad5abf6222e6c7ca2df5e7d53e04b34aa85ee064a'
win={'V033','V035','V037','V038','V052','V054','V067','R14-W01','R14-W02'}
assert {r['id']for r in d['windows']}==win and all(r['status']=='未验证'for r in d['windows'])
if d['finalized']:
    assert d.get('coordinatorFinalIdentityConfirmed') is True
    assert all(r['status']=='通过' for r in d['requirements'] if r['id'] not in win), 'Current requirement coverage is incomplete'
    assert all(f['status']=='已修复并复验' for f in d['findings']), 'A confirmed new finding remains open'
    release=json.loads((ROOT/d['releaseManifest']).read_text())
    assert release['sourceTreeSha256']==d['source']['sha256']and release['asarSha256']==d['package']['asarSha256']
    assert release['sourceAndPackageSame']and release['archiveVerificationPassed']
    assert all(r.get('bindingProof')for r in d['runs']if r['stage']=='最终冻结')
    validate_index(ROOT,d)
for f,h in {**d.get('source',{}).get('files',{}),**d.get('source',{}).get('avatarAssets',{})}.items():assert sha(ROOT/f)==h,f
for e in d['evidence']:assert sha(ROOT/e['file'])==e['sha256'],e['file']
suffix='_制作预览'if preview else'';files=[]
for name in [f'花伴课堂_{d["reportSlug"]}_全面测试表{suffix}.xlsx',f'花伴课堂_{d["reportSlug"]}_全面测试报告{suffix}.pdf']:
    p=OUT/name;assert p.is_file();files.append(dict(name=name,bytes=p.stat().st_size,sha256=sha(p)))
ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(OUT/files[0]['name'])as z:
    assert z.testzip()is None;strings=[]
    if 'xl/sharedStrings.xml'in z.namelist():strings=[''.join(t.text or''for t in si.findall('.//x:t',ns))for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('x:si',ns)]
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
    assert names==['验证概览','190项功能','缺陷复验','原始执行','过程与限制','版本证据']
    for i,r in enumerate(d['requirements'],6):
        assert sheets['190项功能'][f'A{i}']==r['id']
        assert sheets['190项功能'][f'H{i}']==r['status'],(r['id'],sheets['190项功能'][f'H{i}'],r['status'])
        if r.get('basis'):assert sheets['190项功能'][f'P{i}']==r['basis'],r['id']
    for i,f in enumerate(d['findings'],6):assert sheets['缺陷复验'][f'J{i}']==f['status']
    req=Counter(r['status']for r in d['requirements'])
    for cell,expected in [('B10',req['通过']),('C10',req['部分验证']),('D10',req['失败']),('E10',req['未验证']),('F10',190)]:assert float(sheets['验证概览'][cell])==expected,(cell,sheets['验证概览'][cell],expected)
    joined='\n'.join(contents);assert not re.search(r'/(workspace|root|home|tmp)/',joined)
    if d.get('package',{}).get('asarSha256'):assert d['package']['asarSha256']in joined
    assert d['baselineArchiveSha256']in joined
reader=PdfReader(OUT/files[1]['name']);pages=[p.extract_text()or''for p in reader.pages];text='\n'.join(pages)
for r in d['requirements']:assert r['id']in text,r['id']
for f in d['findings']:assert f['id']in text,f['id']
assert all(len(p)>60 for p in pages)
assert '7679405517986542159'in text and '109'in text and '补充教程'in text and 'R14-W01'in text and 'R14-W02'in text
assert not re.search(r'/(workspace|root|home|tmp)/',text)
v=json.loads((OUT/'workbook-verification.json').read_text());assert v['formulaErrors']==0 and v['statusMutationVerified']and not v['nativeExcelVerified']
final=[r for r in d['runs']if r['stage']=='最终冻结'];counts=Counter(r['status']for r in d['requirements'])
verification=dict(finalized=d['finalized'],requirements=190,requirementStatus=dict(counts),originalWindowsUnverified=sorted(win-{'R14-W01','R14-W02'}),additionalWindowsUnverified=['R14-W01','R14-W02'],sourceHashesVerified=bool(d.get('source',{}).get('files')),evidenceHashesVerified=len(d['evidence']),xlsxZipVerified=True,xlsxFormulaErrors=0,xlsxFormulaCells=len(formulas),xlsxCachedCountsMatchData=True,allRequirementIdsInPdf=True,allRequirementIdsInXlsx=True,sourceProvenancePreserved=True,pdfPages=len(pages),environmentPathsAbsentFromExtractedText=True,nativeExcelVerified=False,visualReviewComplete='--visual-reviewed'in sys.argv)
(D/'verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2))
manifest=dict(version=d['version'],completedUtc=datetime.datetime.now(datetime.timezone.utc).isoformat(),readyForDelivery=bool(d['finalized']and verification['visualReviewComplete']),baselineArchiveSha256=d['baselineArchiveSha256'],sourceTreeSha256=d.get('source',{}).get('sha256'),asarSha256=d.get('package',{}).get('asarSha256'),sourceFrozenUtc=d.get('source',{}).get('at'),reportInputSha256=sha(D/'report-input.json'),functionalRequirements={'total':190,'effectPassed':counts['通过'],'effectPartial':counts['部分验证'],'effectFailed':counts['失败'],'effectUnverified':counts['未验证'],'effectPassedRate':counts['通过']/190},finalExecutionCountsByScope=d['finalExecutionCountsByScope'],totalExecutionRecords=sum(len(r['checks'])for r in d['runs']),verification=verification,limits=['Original seven Windows effects unverified','Windows native folder path, relocation, copy isolation and read-only startup unverified','Explorer/Excel/WPS native GUI and file occupancy unverified','Prior stopped additional lock/permission/file specialist audit remains unverified; not retried or rerouted','Synthetic inputs only; controlled chooser/shell as stated','Report not opened in native Microsoft Excel'],artifacts=files)
manifest['finalExecutionRecords']=sum(len(r['checks'])for r in final)
manifest['developmentExecutionRecords']=manifest['totalExecutionRecords']-manifest['finalExecutionRecords']
manifest['baselineAsarSha256']=d['baselineAsarSha256']
manifest['historicalBaseline']=d['historicalBaseline']
manifest['auditNotBefore']=d['auditNotBefore']
manifest['confirmedNewFindings']=[{'id':f['id'],'title':f['title'],'status':f['status'],'requirementIds':f.get('requirementIds',[])}for f in d['findings']]
manifest['independentReviews']=[{'id':r['id'],'title':r['title'],'evidence':r.get('evidence','')}for r in d.get('independentReviews',[])]
for p in[D/'RC16-REPORT-MANIFEST.json',OUT/'RC16-REPORT-MANIFEST.json']:p.write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({'readyForDelivery':manifest['readyForDelivery'],'pages':len(pages),'requirements':dict(counts),'files':files},ensure_ascii=False))
