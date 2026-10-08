"""Create the RC19 user-journey acceptance report from verified report data."""
from pathlib import Path
from collections import Counter
from xml.sax.saxutils import escape
import argparse
import hashlib
import json
import subprocess
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
W,H=A4;M=43;CW=W-2*M
styles=getSampleStyleSheet()
for name,size,leading,space in [('TitleCN',22,30,14),('HeadCN',13,19,7),('BodyCN',10.2,16,8),('SmallCN',9,13.5,6),('CellCN',9,13.4,0)]:
    styles.add(ParagraphStyle(name=name,fontName=FONT,fontSize=size,leading=leading,spaceAfter=space,textColor=colors.black,wordWrap='CJK',keepWithNext=name in ['TitleCN','HeadCN']))
styles.add(ParagraphStyle(name='HeaderCN',parent=styles['CellCN'],textColor=colors.white))

def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def clean(value):
    text=str(value if value is not None else '')
    assert not any(p in text for p in ['/workspace/','/root/','/home/','/tmp/','private-roster'])
    return escape(text).replace('\n','<br/>')
def p(value,style='BodyCN'): return Paragraph(clean(value),styles[style])
def table(headers,rows,widths):
    data=[[p(v,'HeaderCN') for v in headers]]+[[p(v,'CellCN') for v in row] for row in rows]
    result=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
    result.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#354D63')),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F1F4F6')]),('GRID',(0,0),(-1,-1),0.4,colors.HexColor('#D9D9D9')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]))
    return result

def main():
    ap=argparse.ArgumentParser();ap.add_argument('input');ap.add_argument('output');ap.add_argument('--preview',action='store_true');args=ap.parse_args()
    d=json.loads(Path(args.input).read_text());assert d.get('finalized') or args.preview
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    file=out/('花伴课堂_RC19_验收报告'+('_制作预览' if args.preview else '')+'.pdf')
    story=[];requirements=d['requirements'];status=Counter(r['status'] for r in requirements)
    final=[r for r in d.get('runs',[]) if r.get('stage')=='最终冻结'];development=[r for r in d.get('runs',[]) if r.get('stage')!='最终冻结']
    counts=Counter(c['status'] for r in final for c in r['checks']);evidence={e['file']:e['id'] for e in d.get('evidence',[])}
    def refs(value): return '、'.join(dict.fromkeys(evidence.get(s.split('#')[0],s.split('#')[0]) for s in str(value).splitlines() if s)) or '未绑定'
    def page(title):
        if story:story.append(PageBreak())
        story.append(p(title,'TitleCN'))
    def head(title):story.append(p(title,'HeadCN'))
    def para(value,small=False):story.append(p(value,'SmallCN' if small else 'BodyCN'))

    page('花伴课堂 RC19 验收报告')
    para('当前积分成长规则与真实操作流程')
    para(('最终冻结验收' if d.get('finalized') else '制作预览，不能作为交付结论')+' / '+d['version']+' / '+d.get('date','2026-10-07')+' UTC',True)
    head('本轮结果')
    para(d.get('releaseGate','等待冻结源码和最终ASAR运行完成，当前不作通过结论。'))
    para('本报告先列完整用户操作，再列功能覆盖和断言统计。修前故障、测试脚本修正、无效运行与环境限制分别记录。')
    story.append(table(['功能总数','完整通过','部分验证','失败','未验证'],[[len(requirements),status['通过'],status['部分验证'],status['失败'],status['未验证']]],[CW/5]*5))
    head('必须保留的限制')
    para('9项Windows实机验收仍未验证。此前停止的额外锁、权限及文件安全专项没有重新启动，普通回归不能替代。')
    para('用户截图确认Microsoft Defender SmartScreen系统阻止。已交付RC18的PE证书表为空，未做签名或信誉修复；RC19应用运行通过不能证明系统警告已解决。')
    para('193项功能包括192个稳定要求ID和1项可选性别持久化/导入要求。6,003条RC18通过断言和8条观察仅作历史追溯，无一条自动进入RC19通过数。',True)
    if d.get('evidenceLoss'):
        para('证据恢复说明：执行环境重置使此前RC19原始运行记录丢失。最终统计只采用恢复后重新执行并完整绑定的结果；原始修前日志仍记丢失，使用真实修前代码进行的新复现按新日期单列。',True)

    page('用户反馈逐项对照')
    for complaint in d.get('complaints',[]):
        head(complaint['id']+' '+complaint['topic'])
        para(complaint['observation'])
        para('处理结果：'+complaint['status']+'；相关旅程 '+('、'.join(complaint.get('journeyIds',[])) or '系统发布限制单列'),True)
        if complaint.get('limit'):para(complaint['limit'],True)
    para('截图来源仅作问题背景，不嵌入原图、真实学生姓名或私有路径；实际功能结论来自后续受控执行和明确的证据绑定。',True)

    page('当前规则与可核对示例')
    para('全部40种伙伴按学生当前积分计算等级。旧成长字段和旧记录保留，但不再控制当前等级。默认每级费用为5、10、15，然后每级20；数值等级持续增长，视觉只有原有七种造型。')
    story.append(table(['当前积分','数值等级','视觉'],[['负数、0至4','LV0','蛋'],['5 / 15 / 30','LV1 / LV2 / LV3','对应第1 / 2 / 3种'],['50 / 70 / 90 / 110','LV4 / LV5 / LV6 / LV7','对应第4 / 5 / 6 / 7种'],['130','LV8','仍为第7种'],['469 / 470 / 489 / 490','LV24 / LV25 / LV25 / LV26','仍为第7种']],[150,180,CW-330]))
    head('共享配置与资料')
    para(d.get('configurationScope','根目录配置.xlsx管理共享计分卡和全局宠物进阶；系统ID列隐藏，新有效行空ID自动生成。进阶工作表显示25级费用及累计表和尾段重复规则，面板选择清楚可见。'))
    para('姓名、性别、组号、头像支持标准表头和兼容别名。性别可选，只记录明确提供的值；120张原有头像保留。批量分组可在同一操作内新建组并原子分配。')
    para('Excel的范围与迁移附录列出41项字段：37项配置、3项系统管理ID和1项隐藏的历史成长保留字段。25级及尾行属于26行派生展示，不重复计入参数或功能数量。',True)
    head('本轮不启用新毕业')
    para('本轮不设置新的毕业操作，不产生毕业奖励，也不因毕业重置积分。已有毕业记录、快照和永久荣誉继续保留；旧独立成长与新毕业接口按当前要求拒绝。经过验证的既有徽章余额仍可兑换和撤销；未知的历史余额不会自动变为可用余额。')

    for j in d.get('journeys',[]):
        page(j['id']+' '+j['title'])
        para('本轮结果：'+j.get('status','未验证')+'；关联功能 '+ '、'.join(j.get('requirementIds',[])),True)
        for label,key in [('用户问题或要求','complaint'),('预期行为','expected'),('实际操作','steps'),('修前与开发发现','before'),('最终实际结果','after')]:
            value=j.get(key)
            if value:head(label);para(value,small=key=='after')
        story.append(table(['源码','最终ASAR'],[[j.get('sourceStatus','未验证'),j.get('packageStatus','未验证')]],[CW/2]*2))
        para('源码证据 '+refs(j.get('sourceEvidence',''))+'；ASAR证据 '+refs(j.get('packageEvidence',''))+'。',True)
        if j.get('limits'):para(j['limits'],True)

    page('版本与执行证据')
    story.append(table(['对象','身份'],[['版本',d['version']],['源码冻结UTC',d.get('source',{}).get('at','待冻结')],['源码集合SHA256',d.get('source',{}).get('sha256','待绑定')],['最终ASAR SHA256',d.get('package',{}).get('asarSha256','待绑定')]],[120,CW-120]))
    for package in d.get('package',{}).get('files',[]):
        para(package.get('fileName',package.get('name','交付文件'))+'\n'+str(package.get('sizeBytes',package.get('bytes','')))+' bytes\nSHA256 '+package['sha256'],True)
    para('本轮交付完整文件夹7z；标准ZIP不属于交付要求。证据文件路径相对源码包根目录，逐文件SHA256和原始断言定位见Excel。',True)
    head('执行计数')
    rows=[]
    for scope in sorted({r['scope'] for r in final}):
        c=Counter(c['status'] for r in final if r['scope']==scope for c in r['checks']);rows.append([scope,c['passed'],c['failed'],c['observed'],sum(c.values())])
    story.append(table(['执行对象和层','通过','失败','观察','总计'],rows or [['等待最终执行',0,0,0,0]],[CW-220,60,50,50,60]))
    para(f'本轮最终显式选定 {counts["passed"]:,} 条通过、{counts["failed"]} 条失败、{counts["observed"]} 条观察。另保留 {sum(len(r["checks"]) for r in development):,} 条开发或诊断记录，均不加入最终断言或功能通过率。',True)
    para('完整通过要求每个必需执行层都具有匹配的精确断言。退出码0、无案例、缺完成信号、来源改变或不匹配ASAR均不能视为通过。源码、资源和QA文件执行前后哈希必须相同。',True)

    for f in d.get('findings',[]):
        page(f['id']+' '+f['title'])
        para(f.get('status','等待完整复验'))
        for label,key in [('预期和步骤','expected'),('复现操作','steps'),('修前结果','before'),('原因','rootCause'),('修复','fix')]:
            if f.get(key):head(label);para(f[key])
        story.append(table(['源码复验','ASAR复验'],[[f.get('sourceStatus','未验证'),f.get('packageStatus','未验证')]],[CW/2]*2))
        para('修前 '+refs(f.get('beforeEvidence',''))+'；源码 '+refs(f.get('sourceEvidence',''))+'；ASAR '+refs(f.get('packageEvidence',''))+'。',True)
    if d.get('qaNotes'):
        page('保留的开发与无效运行')
        for q in d['qaNotes']:
            story.append(KeepTogether([p(q['id']+' '+q['title'],'HeadCN'),p(q['actual']),p('证据 '+refs(q.get('evidence','')),'SmallCN')]))
    if d.get('retiredContracts'):
        page('按当前要求替换的旧契约')
        para('下列旧行为由用户本轮要求明确替换。旧通过仅保留为历史，不能反向要求新版本恢复旧语义，也不能将退休接口的正确拒绝记为缺陷。')
        for q in d['retiredContracts']:
            head('、'.join(q.get('ids',[])))
            para('旧契约：'+q['old']+'\n当前契约：'+q['new'])

    for correction in d.get('inputDeliverableCorrections',[]):
        page(correction['id']+' '+correction['title'])
        para('分类：名单副本兼容性修正；不修改本轮应用运行时。',True)
        para('状态：'+correction['status'])
        head('v1限制');para(correction['before'])
        head('v2修订');para(correction['repair'])
        head('兼容边界与实际核对');para(correction.get('actual',correction['expected']))
        para('证据 '+refs(correction.get('finalEvidence',''))+'。此项属于已有导入要求，不增加193项分母，也不加入合成断言总数。',True)
    page('两班名单的隔离验证')
    roster=d.get('privateRosterQa',{})
    rows=[[c['alias'],c['expectedCount'],c.get('parsedCount','未验证'),c.get('importedCount','未验证'),'通过' if c.get('status')=='passed' else c.get('status','未验证')] for c in roster.get('classes',[])]
    story.append(table(['匿名班级','期望人数','解析人数','导入人数','状态'],rows or [['待脱敏汇总',105,'未验证','未验证','未验证']],[CW-280,70,70,70,70]))
    if roster.get('genderSummary'):
        gender=roster['genderSummary'];para(f'性别仅按源文件提供值保留：男{gender["male"]}人、女{gender["female"]}人、未提供{gender["blank"]}人，合计{gender["total"]}人。不按姓名推断。')
    roster_scopes=Counter(c.get('scope') for c in roster.get('checks',[]))
    if roster_scopes:para(f'两班真实名单场景单独验证：源码{roster_scopes["source"]}项、ASAR {roster_scopes["packaged"]}项。逐项脱敏结果见Excel范围与迁移，不进入合成最终断言总数。',True)
    para('报告仅接收协调者提供的53人和52人聚合结果；性别统计仅在被明确提供时列出。真实姓名、原始文件、原始截图及私有路径不会进入报告或软件包，此场景不增加公开合成断言总数。')

    for shot in d.get('screenshots',[]):
        page(shot['title'])
        para(shot.get('caption','最终ASAR在Linux Electron中实际运行，画面资料均为合成测试数据。截图不替代Windows实机验收。'),True)
        image_file=ROOT/shot['path'];assert shot.get('syntheticOnly') is True and sha(image_file)==shot['sha256']
        ratio=min(CW/shot['width'],590/shot['height']);story.append(Image(str(image_file),width=shot['width']*ratio,height=shot['height']*ratio))
        para('证据 '+refs(shot['path']),True)

    windows=[r for r in requirements if r.get('platformUnverified')]
    for start in range(0,len(windows),5):
        page('Windows现场仍未验证'+(' 续' if start else ''))
        for r in windows[start:start+5]:head(r['id']+' '+r['title']);para(r['expected'],True)
        para('Linux Electron、模型、故障注入不能证明Windows窗口、资源管理器、Excel/WPS占用、音频、触摸或全屏课件行为。',True)
    changed=[r for r in requirements if r.get('definitionChangedIn')=='RC19']
    for start in range(0,len(changed),3):
        page('本轮定义与验收 '+str(start//3+1))
        for r in changed[start:start+3]:
            head(r['id']+' '+r['title']+' / '+r['status']);para('预期：'+r['expected'],True)
            para('源码 '+r['sourceStatus']+'；ASAR '+r['packageStatus']+'。证据 '+refs(r.get('sourceEvidence',''))+' / '+refs(r.get('packageEvidence',''))+'。',True)
    for start in range(0,len(requirements),18):
        page('完整功能索引 '+str(start//18+1))
        story.append(table(['要求ID','功能','结果'],[[r['id'],r['title'] if len(r['title'])<=68 else r['title'][:68]+'…',r['status']] for r in requirements[start:start+18]],[70,CW-135,65]))
        para('完整步骤、预期、实际结果、修复、复验时间和逐项证据见Excel相同ID。',True)
    page('升级和报告核对')
    para(d.get('upgradeNote','待最终迁移证据确认后列出升级操作。'))
    head('报告文件验证')
    para('Excel通过Artifact Tool重算和状态改变检查，使用导出的精确原字节重新导入核对，再渲染各工作表。PDF按最终字节SHA256绑定全部页面渲染。报告自身检查与应用功能验证分开记录。')
    para('尚未以Microsoft Excel或WPS原生图形界面验证报告工作簿；这项限制不由公式重算或预览替代。',True)
    def footer(canvas,doc):
        canvas.setFont(FONT,8);canvas.setFillColor(colors.HexColor('#647383'));canvas.drawString(M,24,'花伴课堂 RC19 | '+('制作预览' if args.preview else '冻结证据报告'));canvas.drawRightString(W-M,24,str(doc.page))
    SimpleDocTemplate(str(file),pagesize=A4,rightMargin=M,leftMargin=M,topMargin=40,bottomMargin=42,title='花伴课堂 RC19 验收报告',author='FlowerClassroom',pageCompression=1).build(story,onFirstPage=footer,onLaterPages=footer)
    digest=sha(file);render=out/('pdf-'+digest);render.mkdir(exist_ok=True)
    subprocess.run(['pdftoppm','-r','110','-png',str(file),str(render/'page')],check=True,capture_output=True)
    images=sorted(render.glob('page-*.png'));reader=PdfReader(file);assert len(images)==len(reader.pages)>0
    binding={'pdf':file.name,'pdfSha256':digest,'pages':len(images),'finalized':d.get('finalized',False),'visualInspectionCompleted':False,'renderedPages':[{'page':i+1,'file':image.name,'sha256':sha(image)} for i,image in enumerate(images)]}
    (render/'PDF-BINDING.json').write_text(json.dumps(binding,ensure_ascii=False,indent=2)+'\n');(out/'pdf-verification.json').write_text(json.dumps({**binding,'renderDirectory':render.name},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'pdf':str(file),'sha256':digest,'pages':len(images),'renderDirectory':str(render)},ensure_ascii=False))

if __name__=='__main__':main()
