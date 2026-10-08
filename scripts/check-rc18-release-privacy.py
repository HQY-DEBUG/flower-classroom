"""Check release files against private input names without recording the names."""
from pathlib import Path
import argparse,io,json,hashlib,zipfile,datetime
import openpyxl
from pypdf import PdfReader
ap=argparse.ArgumentParser();ap.add_argument('--private-summary',required=True);ap.add_argument('--source',required=True);ap.add_argument('--pdf',required=True);ap.add_argument('--xlsx',required=True);ap.add_argument('--output',required=True);a=ap.parse_args()
inputs=json.loads(Path(a.private_summary).read_text())['classes'];names=set();counts=[]
for row in inputs:
 w=openpyxl.load_workbook(row['outputPath'],read_only=True,data_only=True)
 rows=list(w.active.values);head=list(rows[0]);col=head.index('姓名');found=[str(row[col]).strip() for row in rows[1:] if row[col] is not None];counts.append(len(found));names.update(found);w.close()
assert counts==[53,52]
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
hits=[];checked=0
patterns=[v for n in names for v in [n.encode(),json.dumps(n,ensure_ascii=True)[1:-1].encode()]]
def scan_bytes(label,b):
 global checked
 checked+=1
 if any(n in b for n in patterns):hits.append(label)
def scan_zip(label,b):
 with zipfile.ZipFile(io.BytesIO(b)) as z:
  for info in z.infolist():
   if info.is_dir():continue
   low=info.filename.lower()
   assert 'private-roster' not in low and 'video-reference/' not in low and 'lock-io-review' not in low,low
   data=z.read(info.filename)
   if low.endswith(('.xlsx','.docx')):scan_zip(label+'!'+info.filename,data)
   elif low.endswith(('.json','.js','.cjs','.mjs','.py','.txt','.xml','.csv','.log','.md','.html','.css','.ndjson','.diff')):scan_bytes(label+'!'+info.filename,data)
scan_zip('source-recovery',Path(a.source).read_bytes())
scan_zip('test-workbook',Path(a.xlsx).read_bytes())
scan_bytes('test-pdf','\n'.join(p.extract_text() for p in PdfReader(a.pdf).pages).encode())
result={'checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'inputClassCounts':counts,'rawNamesRecorded':False,'sourceArchiveSha256':sha(a.source),'reportPdfSha256':sha(a.pdf),'reportXlsxSha256':sha(a.xlsx),'textEntriesChecked':checked,'privateNameMatches':len(hits),'matchedFileLabelsOnly':hits,'passed':not hits,'rasterLimit':'Only approved synthetic screenshots and original cartoon assets are archived; this text check is supplementary to their visual review'}
Path(a.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False));assert not hits,'Private-name matches need review before release'
