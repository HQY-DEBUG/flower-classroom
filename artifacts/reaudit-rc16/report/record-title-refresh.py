"""Record the requested new PDF export and distinguish it from superseded page renders."""
import datetime,hashlib,json,zipfile
from pathlib import Path
from pypdf import PdfReader
D=Path(__file__).resolve().parent;ROOT=D.parents[2];OUT=ROOT/'outputs/flower-rc16-next-reaudit-report'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
pdf=OUT/'花伴课堂_1.3.0-rc.17_20261007_全面测试报告.pdf';xlsx=OUT/'花伴课堂_1.3.0-rc.17_20261007_全面测试表.xlsx'
before=D/'history/title-refresh/before-report.pdf';before_pages=[p.extract_text()or''for p in PdfReader(before).pages];pages=[p.extract_text()or''for p in PdfReader(pdf).pages]
assert len(pages)==32 and pages==before_pages
assert not any('RC15升级到RC16'in t for t in pages)
assert [i+1 for i,t in enumerate(pages)if'RC16升级到RC17'in t]==[31]
with zipfile.ZipFile(xlsx)as z:xml='\n'.join(z.read(n).decode('utf8')for n in z.namelist()if n.endswith('.xml'))
assert'RC15升级到RC16'not in xml and'把RC17解压到新的可写文件夹'in xml
render=OUT/('pdf-'+sha(pdf));images=sorted(render.glob('page-*.png'));assert len(images)==32
record={'id':'REPORT-R02-TITLE-RENDER-REFRESH','recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'reason':'Review referenced page-32.png from the superseded initial 33-page render. The frozen 32-page PDF already had the correct RC16-to-RC17 title on page 31. A new PDF export and a fresh SHA-named render directory were requested to eliminate ambiguity.',
 'beforePdf':str(before.relative_to(ROOT)),'beforePdfSha256':sha(before),'beforePdfOldTitleFound':False,
 'afterPdf':str(pdf.relative_to(ROOT)),'afterPdfSha256':sha(pdf),'pageCount':32,'correctUpgradeTitle':'RC16升级到RC17','upgradePage':31,
 'extractedContentUnchanged':True,'xlsxSha256':sha(xlsx),'xlsxOldTitleFound':False,'xlsxChanged':False,
 'runtimeChanged':False,'executionEvidenceChanged':False,'testCountsChanged':False,
 'supersededRenderDirectory':'artifacts/reaudit-rc16/report/history/initial-33-page-render',
 'builderNote':'Upgrade heading now derives from the current baseline and target version fields; rendered wording is unchanged.',
 'renderDirectory':str(render.relative_to(ROOT)),
 'renderedPages':[{'page':i+1,'file':str(p.relative_to(ROOT)),'sha256':sha(p)}for i,p in enumerate(images)]}
(D/'report-revisions.json').write_text(json.dumps([record],ensure_ascii=False,indent=2))
(render/'PDF-BINDING.json').write_text(json.dumps({'pdf':str(pdf.relative_to(ROOT)),'pdfSha256':sha(pdf),'pages':32,'upgradePage':31,'renderedPages':record['renderedPages']},ensure_ascii=False,indent=2))
print(json.dumps({'newPdfSha256':sha(pdf),'upgradePage':31,'contentUnchanged':True,'xlsxUnchanged':True,'renderDirectory':str(render)},ensure_ascii=False))
