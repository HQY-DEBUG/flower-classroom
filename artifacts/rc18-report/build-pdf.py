"""Author the RC18 report and rasterize its exact exported PDF bytes."""
from pathlib import Path
from collections import Counter
import argparse
import hashlib
import json
import math
import subprocess
from xml.sax.saxutils import escape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, Image
from pypdf import PdfReader

ROOT=Path(__file__).resolve().parents[2]
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
FONT='STSong-Light'
W,H=A4
M=43
CW=W-2*M
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='CnTitle',fontName=FONT,fontSize=23,leading=31,textColor=colors.HexColor('#263F55'),spaceAfter=15,wordWrap='CJK'))
styles.add(ParagraphStyle(name='CnH',fontName=FONT,fontSize=13,leading=19,textColor=colors.HexColor('#314F69'),spaceBefore=10,spaceAfter=6,wordWrap='CJK',keepWithNext=True))
styles.add(ParagraphStyle(name='CnBody',fontName=FONT,fontSize=10.2,leading=16,spaceAfter=8,wordWrap='CJK'))
styles.add(ParagraphStyle(name='CnSmall',fontName=FONT,fontSize=9,leading=13.4,spaceAfter=6,wordWrap='CJK'))
styles.add(ParagraphStyle(name='CnTable',fontName=FONT,fontSize=9,leading=13,wordWrap='CJK'))
styles.add(ParagraphStyle(name='CnTH',parent=styles['CnTable'],textColor=colors.white))

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def text(v):
    s=str(v if v is not None else '')
    assert 'rc18-private-roster-qa' not in s
    assert not any(p in s for p in ['/workspace/','/root/','/home/','/tmp/'])
    return escape(s).replace('\n','<br/>')
def p(v,style='CnBody'):return Paragraph(text(v),styles[style])
def table(headers,rows,widths):
    body=[[p(v,'CnTH') for v in headers]]+[[p(v,'CnTable') for v in row] for row in rows]
    t=Table(body,colWidths=widths,repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#3B536E')),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F0F3F6')]),('LINEBELOW',(0,0),(-1,0),0.4,colors.white)]))
    return t

def main():
    ap=argparse.ArgumentParser();ap.add_argument('input');ap.add_argument('output');ap.add_argument('--preview',action='store_true');a=ap.parse_args()
    d=json.loads(Path(a.input).read_text());assert d.get('finalized') or a.preview
    out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
    file=out/('花伴课堂_RC18_测试报告'+('_制作预览' if a.preview else '')+'.pdf')
    story=[];req=d['requirements'];n=len(req)
    final=[r for r in d.get('runs',[]) if r.get('stage')=='最终冻结']
    dev=[r for r in d.get('runs',[]) if r.get('stage')!='最终冻结']
    counts=Counter(c['status'] for r in final for c in r['checks'])
    status=Counter(r['status'] for r in req)
    ev={e['file']:e['id'] for e in d.get('evidence',[])}
    def refs(value):
        files=[s.split('#')[0].strip() for s in str(value).splitlines() if s.strip()]
        return '、'.join(dict.fromkeys(ev.get(s,s) for s in files)) or '未绑定'
    def title(v):story.append(p(v,'CnTitle'))
    def head(v):story.append(p(v,'CnH'))
    def para(v,small=False):story.append(p(v,'CnSmall' if small else 'CnBody'))
    def page(v):
        if story:story.append(PageBreak())
        title(v)
    page('花伴课堂 RC18\n功能与测试报告')
    para(d.get('reportLabel','统一配置与课堂交互复核'))
    para(('最终冻结结果' if d.get('finalized') else '制作预览，不能作为交付结论')+' / '+d['version']+' / '+d.get('date',d.get('createdAt','')[:10])+' UTC',True)
    story.append(Spacer(1,10))
    story.append(table(['功能总数','完整通过','部分验证','失败','未验证'],[[n,status['通过'],status['部分验证'],status['失败'],status['未验证']]],[CW/5]*5))
    head('本轮结论')
    para(d.get('releaseGate','等待最终证据。'))
    para(f'最终显式选定的断言：{counts["passed"]:,}条通过、{counts["failed"]}条失败、{counts["observed"]}条观察。观察、开发过程、独立重复子集与隔离真实名单场景均不增加最终通过断言数。')
    head('仍未完成的验收')
    para('9项Windows实机验收保持未验证。此前停止的额外锁、权限及文件边界专项另行保留未验证，未检查、未重启。')
    para('用户SmartScreen截图中的未知发布者提示仍是未解决的签名/信誉问题。本报告不宣称已经修复，也不提供安全绕过方法。')
    para('Excel逐项保存功能、测试步骤、预期、实际、验证状态、修复、复验时间、证据与版本；功能已提供和效果已验证分别记录。',True)

    page('版本与证据身份')
    identity=[['当前版本',d['version']],['源码冻结UTC',d.get('source',{}).get('at','等待冻结')],['源码集合SHA256',d.get('source',{}).get('sha256','待绑定')],['最终ASAR SHA256',d.get('package',{}).get('asarSha256','待绑定')]]
    story.append(table(['对象','身份'],identity,[125,CW-125]))
    for f in d.get('package',{}).get('files',[]):
        para(f.get('fileName',f.get('name','发行包'))+'\n'+str(f.get('sizeBytes',f.get('bytes','')))+' bytes\nSHA256 '+f['sha256'],True)
    para('本次只交付目录7z。内部可选ZIP曾验证为同一组文件，已按交付选择清理，不作为交付文件；原验证SHA和清理记录保留。',True)
    head('采用的历史基线')
    para('RC17报告保留190项要求，其中181项通过、9项未验证；历史5,515条通过断言与8条观察仅用于追溯，无一条自动计入RC18结果。')
    head('每次运行的真实身份')
    para('最终结果必须匹配冻结源码与精确ASAR、执行开始/完成UTC和原始文件SHA256。修前失败、未冻结结果、脚本修正与独立重复子集分别保留；不能把某个旧结果换上新版本标签作为通过。')
    para('证据路径相对源码包根目录，Excel“证据索引”列出逐文件SHA256；“最终断言”和“开发过程”分别保存对应原始位置。',True)

    page('执行结果与计数口径')
    rows=[]
    for scope in sorted({r['scope'] for r in final}):
        c=Counter(c['status'] for r in final if r['scope']==scope for c in r['checks'])
        rows.append([scope,c['passed'],c['failed'],c['observed'],sum(c.values())])
    story.append(table(['执行对象/层','通过','失败','观察','合计'],rows or [['尚未绑定',0,0,0,0]],[CW-220,65,45,45,65]))
    head('功能与断言分开统计')
    para(f'{n}项是功能需求总数。每项可能由多个平台、边界、重复点击和重启检查支持；这些检查不能重复扩大功能分母。通过率只以完整通过项除以全部{n}项计算。')
    para(f'另外保留{sum(len(r["checks"]) for r in dev)}条开发与诊断记录，不进入最终通过数。成功复现故障属于诊断证据，不能视作功能成功。')
    for q in d.get('supplementalVerifications',[]):para((q.get('title') or '独立补充复核')+'：'+q['reason']+'；不叠加最终断言数。',True)

    page('统一配置与资料边界')
    para(d.get('configurationScope') or d.get('pendingScope') or '见本轮配置工作簿需求定义。')
    if d.get('parameterInventorySummary'):para(d['parameterInventorySummary'])
    head('当前活动配置与旧文件')
    para(d.get('configurationMigrationNote','等待最终实现和精确配置迁移证据，不对未完成迁移作通过承诺。'))
    head('范围内保留的独立语义')
    para('共享计分卡由所有面板使用；学生名单、普通积分、成长和历史仍按所属面板隔离。宠物进阶使用明确累计阈值，各面板legacy与sixstage的既有语义必须保留。')
    head('不属于配置的资料')
    para('学生名单、真实积分记录、图片和凭据不放进配置工作簿。配置迁移不得被解释为搬移或公开这些资料。')
    if d.get('parameterInventory'):
        for i in range(0,len(d['parameterInventory']),12):
            page('配置参数清单'+('（续）' if i else ''))
            rows=[[x.get('sheet',''),x.get('name',x.get('key','')),x.get('scope',''),x.get('note','')] for x in d['parameterInventory'][i:i+12]]
            story.append(table(['工作表','参数','作用域','约束/说明'],rows,[95,145,75,CW-315]))

    changed=[r for r in req if r.get('definitionChangedIn')=='RC18' or r['id'].startswith('R18-')]
    for i in range(0,len(changed),3):
        page('本轮更新要求'+('（续）' if i else ''))
        for r in changed[i:i+3]:
            head(r['id']+' '+r['title']+' / '+r['status'])
            para('预期：'+r['expected'],True)
            para('步骤：'+r['steps'],True)
            para('源码 '+r['sourceStatus']+'；ASAR '+r['packageStatus']+'。证据 '+refs(r.get('sourceEvidence','')+'\n'+r.get('packageEvidence',''))+'。',True)
            if r.get('replaces'):para('定义修订：'+r['replaces'],True)

    page('两班名单的隔离场景')
    para('按用户最新选择，整理两份标准名单副本后验证；原打印版文件保留。未将打印布局适配作为本轮软件新功能或待修缺陷。标准副本另行直接交付，不进入程序、源码或公开测试材料。')
    roster=d.get('privateRosterQa',{})
    rows=[[c['alias'],c['expectedCount'],c['parsedCount'],c['importedCount'],'通过' if c['status']=='passed' else c['status']] for c in roster.get('classes',[])]
    story.append(table(['匿名班级','期望人数','解析人数','导入人数','结果'],rows or [['等待脱敏汇总','未验证','未验证','未验证','未验证']],[CW-280,70,70,70,70]))
    for c in roster.get('checks',[]):para(c.get('name',c.get('id','检查'))+'：'+('通过' if c.get('status')=='passed' else c.get('status','未验证')),True)
    para('这里只显示别名、人数与结果。真实姓名、原始表格、原始截图以及私有文件路径均不进入报告。该场景单独记录，不加入合成最终断言总数。',True)

    for shot in d.get('screenshots',[]):
        page(shot['title'])
        para('最终候选3 ASAR在Linux Electron中实际加载；画面中的学生和班级均为合成测试数据。此截图不代表Windows实机验收。',True)
        image_file=ROOT/shot['path'];assert sha(image_file)==shot['sha256'] and shot.get('syntheticOnly') is True
        scale=min(CW/shot['width'],580/shot['height'])
        story.append(Image(str(image_file),width=shot['width']*scale,height=shot['height']*scale))
        para('证据：'+refs(shot['path']),True)

    for f in d.get('findings',[]):
        page(f['id']+' '+f['title'])
        para(f.get('status','等待完整复验'))
        for label,key in [('预期与复现','expected'),('测试步骤','steps'),('修前实际','before'),('原因','rootCause'),('修复','fix')]:
            if f.get(key):head(label);para(f[key])
        story.append(table(['最终源码','最终ASAR','闭环结果'],[[f.get('sourceStatus','未验证'),f.get('packageStatus','未验证'),f.get('status','待完整复验')]],[CW/3]*3))
        para('原始失败 '+refs(f.get('beforeEvidence',''))+'；源码复验 '+refs(f.get('sourceEvidence',''))+'；ASAR复验 '+refs(f.get('packageEvidence',''))+'。',True)

    if d.get('qaNotes'):
        page('保留的过程与脚本修正')
        for q in d['qaNotes']:
            story.append(KeepTogether([p(q['id']+' '+q['title'],'CnH'),p(q['actual']),p('证据 '+refs(q.get('evidence','')),'CnSmall')]))

    windows=d.get('windows') or [r for r in req if r.get('platformUnverified')]
    for i in range(0,len(windows),5):
        page('Windows实机未验证'+('（续）' if i else ''))
        for r in windows[i:i+5]:head(r['id']+' '+r['title']);para(r['expected'],True)
        para('上述项目始终保留未验证。Linux Electron、模拟错误与模型测试不能证明Windows原生窗口、资源管理器、Excel/WPS占用、声音、触摸或全屏课件行为。',True)

    # The complete stable-ID list is included, while each long requirement's
    # full steps, expectation, actual, repair and evidence remain in the XLSX.
    for i in range(0,len(req),18):
        page(f'完整功能索引 {i//18+1} / {math.ceil(len(req)/18)}')
        rows=[]
        for r in req[i:i+18]:
            name=r['title'];name=name if len(name)<=66 else name[:66]+'…'
            rows.append([r['id'],name,r['status']])
        story.append(table(['要求ID','功能','验证状态'],rows,[70,CW-135,65]))
        para('长功能名只在本索引缩略；完整定义、来源、步骤、实际结果和精确证据见Excel相同ID。',True)

    page('升级与复核')
    para(d.get('upgradeNote','等待最终实现及测试完成后生成升级说明。'))
    head('最终文件与报告的核对')
    para('先按发布包和报告的SHA256核对文件。报告PDF在导出后才生成以PDF SHA256命名的页面目录；Excel以导出后的原字节重新导入再渲染。视觉核验与应用功能验证是不同检查。')
    para('报告Excel经过公式重算与回填状态变化检查，尚未在Microsoft Excel/WPS原生GUI中验收；此限制不隐去。',True)
    def footer(canvas,doc):
        canvas.setFont(FONT,8);canvas.setFillColor(colors.HexColor('#718091'))
        canvas.drawString(M,24,'花伴课堂 RC18 | '+('制作预览' if a.preview else '冻结证据报告'))
        canvas.drawRightString(W-M,24,str(doc.page))
    doc=SimpleDocTemplate(str(file),pagesize=A4,rightMargin=M,leftMargin=M,topMargin=40,bottomMargin=42,title='花伴课堂 RC18 测试报告',author='FlowerClassroom',pageCompression=1)
    doc.build(story,onFirstPage=footer,onLaterPages=footer)
    digest=sha(file);render=out/('pdf-'+digest);render.mkdir(exist_ok=True)
    subprocess.run(['pdftoppm','-r','110','-png',str(file),str(render/'page')],check=True,capture_output=True)
    images=sorted(render.glob('page-*.png'));reader=PdfReader(file)
    assert len(images)==len(reader.pages)>0
    binding={'pdf':file.name,'pdfSha256':digest,'pages':len(images),'finalized':d.get('finalized',False),'visualInspectionCompleted':False,'renderedPages':[{'page':i+1,'file':x.name,'sha256':sha(x)} for i,x in enumerate(images)]}
    (render/'PDF-BINDING.json').write_text(json.dumps(binding,ensure_ascii=False,indent=2)+'\n')
    (out/'pdf-verification.json').write_text(json.dumps({**binding,'renderDirectory':render.name},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'pdf':str(file),'sha256':digest,'pages':len(images),'renderDirectory':str(render)},ensure_ascii=False))

if __name__=='__main__':main()
