"""Bind a completed visual review to the exact final PDF, XLSX and rendered images.

Run only after a human/agent has visually inspected every named final image.
This script validates that the reviewed pixels still belong to current bytes;
it does not perform or substitute for visual inspection.
"""
from pathlib import Path
import argparse
import datetime as dt
import hashlib
import json
import zipfile
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[2]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output',default=str(ROOT/'outputs/flower-rc18-report'))
    ap.add_argument('--pdf-pages',required=True,help='Comma-separated exact page numbers visually inspected')
    ap.add_argument('--xlsx-views',required=True,help='Comma-separated PNG names visually inspected')
    ap.add_argument('--confirm-visual-inspection',action='store_true')
    a=ap.parse_args();assert a.confirm_visual_inspection,'No visual review attestation supplied'
    out=Path(a.output)
    inp=ROOT/'artifacts/rc18-report/report-input.json';data=read(inp)
    assert data.get('finalized') is True
    pmeta=read(out/'pdf-verification.json');xmeta=read(out/'workbook-verification.json')
    assert pmeta['finalized'] is True and xmeta['finalized'] is True
    pdf=out/pmeta['pdf'];xlsx=out/xmeta['xlsx']
    assert sha(pdf)==pmeta['pdfSha256'] and sha(xlsx)==xmeta['xlsxSha256']
    assert pmeta['renderDirectory']=='pdf-'+sha(pdf) and xmeta['renderDirectory']=='xlsx-'+sha(xlsx)
    pdf_pages={int(v) for v in a.pdf_pages.split(',')}
    assert pdf_pages==set(range(1,pmeta['pages']+1)),'Every final PDF page must be reviewed'
    xviews=set(a.xlsx_views.split(','));assert xviews=={v['file'] for v in xmeta['images']},'Every final workbook view must be reviewed'
    for row in pmeta['renderedPages']:
        assert sha(out/pmeta['renderDirectory']/row['file'])==row['sha256']
    for row in xmeta['images']:
        assert sha(out/xmeta['renderDirectory']/row['file'])==row['sha256']
    reader=PdfReader(pdf);assert len(reader.pages)==pmeta['pages']
    alltext='\n'.join(page.extract_text() or '' for page in reader.pages)
    assert 'RC18' in alltext and all(r['id'] in alltext for r in data['requirements'])
    assert 'SmartScreen' in alltext and '未知发布者' in alltext
    with zipfile.ZipFile(xlsx) as archive:
        xml=archive.read('xl/workbook.xml').decode()
        assert all(s in xml for s in ['验证概览','功能验收','缺陷与修复','最终断言','开发过程','范围与迁移','证据索引'])
        text='\n'.join(archive.read(name).decode() for name in archive.namelist() if name.endswith('.xml'))
        assert 'rc18-private-roster-qa' not in text
    now=dt.datetime.now(dt.timezone.utc).isoformat()
    for meta,filename,binding in [(pmeta,'pdf-verification.json','PDF-BINDING.json'),(xmeta,'workbook-verification.json','XLSX-BINDING.json')]:
        meta['visualInspectionCompleted']=True;meta['visuallyInspectedAt']=now;meta['visualResult']='No clipping, overlap, missing glyphs or unreadable selected report views'
        write(out/filename,meta)
        bind=read(out/meta['renderDirectory']/binding);bind.update({k:meta[k] for k in ['visualInspectionCompleted','visuallyInspectedAt','visualResult']});write(out/meta['renderDirectory']/binding,bind)
    manifest={
      'version':data['version'],'reportCreatedAt':now,'reportInputSha256':sha(inp),
      'requirements':len(data['requirements']),'requirementCounts':data['requirementCounts'],
      'finalAssertionCounts':data['finalAssertionCounts'],'finalExecutionRecords':data['finalExecutionRecords'],
      'sourceTreeSha256':data['source']['sha256'],'asarSha256':data['package']['asarSha256'],
      'files':[{'name':p.name,'sizeBytes':p.stat().st_size,'sha256':sha(p)} for p in [pdf,xlsx]],
      'pdfPages':pmeta['pages'],'xlsxSheets':7,
      'exactExportBytesVisuallyInspected':True,'allPdfPagesReviewed':True,'allWorkbookSheetsReviewed':True,
      'nativeExcelWpsVerified':False,'nativeWindowsVerified':False,
      'smartScreenSigningOrReputationFixed':False,
      'realRosterRawInputsIncluded':False,
      'pdfRenderDirectory':pmeta['renderDirectory'],'xlsxRenderDirectory':xmeta['renderDirectory'],
    }
    destination=out/'RC18-REPORT-MANIFEST.json';assert not destination.exists(),'Do not silently overwrite a finalized report manifest'
    write(destination,manifest)
    print(json.dumps(manifest,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
