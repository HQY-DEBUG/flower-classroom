"""Chinese PDF companion: scoped conclusions, RC14 details and every requirement ID."""
import hashlib,json,math,sys
from collections import Counter
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,Image,KeepTogether
from reportlab.lib.pagesizes import A4,landscape

D=Path(__file__).resolve().parent;ROOT=D.parents[2]
d=json.loads(Path(sys.argv[1]).read_text());out=Path(sys.argv[2]);preview='--preview'in sys.argv
assert d.get('finalized')or preview
out.mkdir(parents=True,exist_ok=True);pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
ink=colors.HexColor('#253648');navy=colors.HexColor('#344E67');muted=colors.HexColor('#526778');pale=colors.HexColor('#F3F6F9')
styles=getSampleStyleSheet()
for name,size,lead,color in [('Title',20,27,colors.black),('Head',12.5,18,colors.black),('Body',11,16,ink),('Small',9,12.7,muted),('Cell',9.5,13.5,ink),('White',9.5,13.5,colors.white)]:
    styles.add(ParagraphStyle(name='CN'+name,fontName='STSong-Light',fontSize=size,leading=lead,textColor=color,spaceAfter=6,spaceBefore=5 if name=='Head'else 0,wordWrap='CJK'))
styles['CNCell'].spaceAfter=0;styles['CNWhite'].spaceAfter=0;styles['CNHead'].keepWithNext=True
def P(t,style='Body'):
    t=str(t if t is not None else'')
    for c in ('\u2011','\u2013','\u2014','\u2212'):t=t.replace(c,'-')
    return Paragraph(escape(t).replace('\n','<br/>'),styles['CN'+style])
def T(headers,rows,widths):
    tab=Table([[P(h,'White')for h in headers]]+[[P(x,'Cell')for x in r]for r in rows],colWidths=widths,repeatRows=1,hAlign='LEFT')
    tab.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,pale]),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('GRID',(0,0),(-1,-1),0.3,colors.HexColor('#D9D9D9'))]));return tab
size=landscape(A4);W=size[0]-76;story=[];sections=[]
ev={e['file']:e['id']for e in d['evidence']}
def refs(t):return'、'.join(dict.fromkeys(ev[f]for f in ev if f in t))or'未绑定最终证据'
def page(title):
    if story:story.append(PageBreak())
    story.append(P(title,'Title'));sections.append(title)
def head(t):story.append(P(t,'Head'))
def para(t,style='Body'):story.append(P(t,style))
def counts(rows):
    c=Counter(r['status']for r in rows);return[c['通过'],c['部分验证'],c['失败'],c['未验证'],len(rows)]

page('花伴课堂 RC14 全面测试报告')
para(('最终冻结版本报告'if d.get('finalized')else'制作预览  尚不能作为交付通过结论')+' / '+d['date']+' UTC','Small')
para(d['releaseGate'])
head('按要求计算的效果结果')
sr=[]
for label in ['既有118项','RC11新增37项','RC14新增21项']:
    rows=[r for r in d['requirements']if r['baselineKind']==label];c=counts(rows);sr.append([label,*c,f'{c[0]/c[4]:.1%}'])
c=counts(d['requirements']);sr.append(['全部要求',*c,f'{c[0]/c[4]:.1%}'])
story.append(T(['来源范围','通过','部分验证','失败','未验证','总数','完整通过率'],sr,[W-415,60,75,55,70,65,90]))
para('总数176 = 原有155项 + RC14功能19项 + 新增Windows平台验收2项。完整通过率以176为分母。部分验证表示已有有效结果，但仍缺少该要求所需的场景或测试层；未验证表示没有足够的最终效果证据。','Small')
head('本轮新增内容')
para('计分选卡处可直接编辑名称、分值和成长；程序同级头像目录提供实际路径、打开及刷新入口；原40张头像保留并新增80张，总数120；程序同级计分卡片.xlsx支持界面保存、显式校验后刷新、按面板ID隔离、原子回滚与重启恢复。')
head('现场限制仍然保留')
para('原7项Windows效果继续未验证。本轮另外列出R14-W01便携EXE真实资源目录和R14-W02资源管理器及Excel/WPS原生行为，二者也未验证。此前停止的新增锁、权限及文件边界专项单独保留未完成，不以普通回归替代。','Small')

page('版本身份和本轮执行结果')
identity=[['RC13开发基线','已验证交付源码ZIP SHA256\n'+d['baselineSourceZipSha256']],['RC14冻结源码','冻结UTC '+d.get('source',{}).get('at','待冻结')+'\n源码集合SHA256 '+d.get('source',{}).get('sha256','待绑定')],['RC14最终包','ASAR SHA256 '+d.get('package',{}).get('asarSha256','待绑定')]]
story.append(T(['对象','精确身份'],identity,[100,W-100]))
head('最终冻结原始检查数')
rows=[]
for scope in dict.fromkeys(r['scope']for r in d['runs']if r['stage']=='最终冻结'):
    cs=[c for r in d['runs']if r['stage']=='最终冻结'and r['scope']==scope for c in r['checks']];c=Counter(x['status']for x in cs)
    rows.append([scope,c['passed'],c['failed'],len(cs)-c['passed']-c['failed'],len(cs)])
story.append(T(['执行对象和层','通过检查','失败','观察或未验','检查总数'],rows or[['尚未绑定最终证据','未验证','未验证','未验证','未验证']],[W-310,85,60,90,75]))
para('执行检查数不是功能数。源码、包内Node模型、Linux Electron精确ASAR及重启在各自测试层分别统计。同一功能重复执行、内部循环、开发轮、观察项和成功复现坏行为均不增加176项分母。旧版1508等历史总数不作为当前统计输入。','Small')
final_records=sum(len(r['checks'])for r in d['runs']if r['stage']=='最终冻结');all_records=sum(len(r['checks'])for r in d['runs'])
para(f'完整执行明细共{all_records}条，其中最终冻结{final_records}条，另有{all_records-final_records}条开发过程记录。开发记录用于保留初始失败和修复过程，不计最终通过。','Small')
para('每条结果只在本轮明确选择、冻结绑定依据存在且相关代码或ASAR哈希一致时支持当前结论。工作簿“原始执行”保存原名称、实际值、版本和定位。未记录执行时间时不使用文件修改时间冒充。','Small')

page('需求来源和历史证据的边界')
story.append(T(['来源','要求数','使用方式'],[
 ['原始109秒视频',75,'V系列；保留原片时间点、视频确认或合理推导'],
 ['补充教程',28,'R系列20项和F系列8项；各行保留其教程URL与时间点'],
 ['此前界面和伙伴扩展',15,'RC6系列；按此前用户扩展要求及回归定义'],
 ['此前用户新增功能',37,'N系列；RC11新增，RC14重新核验'],
 ['本轮用户新增功能与平台验收',21,'R14功能19项，R14-W平台验收2项']],[205,70,W-275]))
head('原始109秒视频')
para('继承要求保留原始109秒视频的时间点及“视频确认”“合理推导”区别。原片来源：https://www.douyin.com/jingxuan?modal_id=7679405517986542159 。本报告没有重新声称观看原片，不附原视频、学生照片或用户真实图片。')
head('补充教程')
para('补充教程用于解释后续场景。R和F系列各行保留旧版核实的不同教程链接及精确时间点；这些内容不自动变成原始109秒视频可见的功能。')
if d.get('supplementarySource'):para(d['supplementarySource'],'Small')
head('用户RC14新要求')
para('本轮21项独立列示：19项功能验收覆盖就地编辑、同级头像、120张默认素材和同级Excel配置；2项记录Windows现场依赖。Excel中每行保留来源、预期、测试步骤、实际结果、状态、精确版本、证据、修复复验及限制。')
head('RC13历史结果')
para('RC13已交付报告为155项，其中148通过、7未验证，13类先前问题已在当时复验。它们是历史事实，不能直接证明RC14。RC14继承行按旧报告绑定的检查精确名称重新寻找本轮冻结证据；当前缺少的检查会显示部分验证或未验证。')
para('所有测试输入及截图仅含合成资料，不复制用户照片或原视频学生照片。','Small')

new=[r for r in d['requirements']if r['id'].startswith('R14-')and not r['id'].startswith('R14-W')]
for start in range(0,len(new),4):
    page('RC14新增功能验收 '+str(start//4+1)+' / '+str(math.ceil(len(new)/4)))
    for r in new[start:start+4]:
        head(r['id']+' '+r['title']+'  '+r['status'])
        para('预期：'+r['expected'],'Small')
        para('步骤：'+r['steps'],'Small')
        para('源码 '+r['sourceStatus']+'；ASAR '+r['packageStatus']+'。证据 '+refs(r['sourceEvidence']+'\n'+r['packageEvidence'])+'。完整实际值和逐条断言见Excel同ID。','Small')

for f in d.get('findings',[]):
    page(f['id']+' '+f['title'])
    para(f.get('module','RC14过程问题')+' / '+f['status'],'Small')
    head('预期和复现');para(f['expected']);para(f['steps'])
    head('修前实际');para(f['before'])
    head('修复与最终复验');para(f['fix'])
    story.append(T(['最终源码','最终ASAR','闭环结果'],[[f['sourceStatus'],f['packageStatus'],f['status']]],[W/3]*3))
    para('原始失败 '+refs(f.get('beforeEvidence',''))+'；源码 '+refs(f['sourceEvidence'])+'；ASAR '+refs(f['packageEvidence'])+'。开发过程通过和最终通过分别保存。','Small')
    if f.get('limits'):para(f['limits'],'Small')

for shot in d.get('screenshots',[]):
    assert shot.get('syntheticOnly')is True,'Screenshot needs synthetic-only provenance'
    p=ROOT/shot['file'];assert p.is_file()
    page(shot['title']);para(shot['caption'],'Small')
    img=Image(str(p));img._restrictSize(W,360);story.append(img)
    para('合成测试截图。证据 '+shot['file'],'Small')

short={'R001':'清零范围、倒计时与取消','R006':'六段成长门槛配置','R008':'抽组奖励及重复保护','R010':'学生成长和荣誉排行','R011':'小组徽章总量与均值','R012':'高级造型隐藏与同步','R013':'降级、下限与实际撤销','R015':'徽章兑换、相册及PNG卡片','R016':'普通积分奖品兑换与撤销','R018':'冒险挑战入口及窄窗','R019':'普通锁定、解锁及重启','R020':'组总分、均分和导出一致','F001':'九个工具入口与窄窗可达','F002':'投票边界、同步与重试','F003':'签到、缺勤与重置','F004':'复制名单但不复制积分','F005':'小组排序、空组与取消','F006':'跨组移动保留资料','F007':'普通分和宠物成长隔离','F008':'换宠、非零数据及失效保护'}
allrows=[[r['id'],short.get(r['id'],r['title']),r['status']]for r in d['requirements']]
chunks=[];start=0;w=(W-16)/2
while start<len(allrows):
    n=min(28,len(allrows)-start)
    while True:
        chunk=allrows[start:start+n];mid=(len(chunk)+1)//2
        a=T(['ID','要求及核验要点','效果'],chunk[:mid],[61,w-125,64]);b=T(['ID','要求及核验要点','效果'],chunk[mid:],[61,w-125,64])if chunk[mid:]else None
        h=max(a.wrap(w,10000)[1],b.wrap(w,10000)[1]if b else 0)
        if h<=414 or n<=2:break
        n-=2
    chunks.append((a,b));start+=n
for number,(a,b)in enumerate(chunks,1):
    page('176项要求状态 '+str(number)+' / '+str(len(chunks)))
    para('详细预期、步骤、实际值、版本和复验定位见Excel同一要求ID。原7项Windows和新增2项Windows均保留在分母。','Small')
    outer=Table([[a,'',b or'']],colWidths=[w,16,w]);outer.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)]));story.append(outer)

page('原7项Windows效果继续未验证')
short={'V033':'Windows实机缩放、默认大小、全屏、真实DPI及实体触控','V035':'红花悬浮窗口覆盖全屏PPT且课件可操作','V037':'Windows拖动、收窄及窗口边界','V038':'全屏课件切页时侧栏持续可见可操作','V052':'Windows透明圆形计时器桌面合成','V054':'Windows三种提示音的真实播放与听感','V067':'独立窄宠物窗口覆盖全屏PPT'}
story.append(T(['ID','现场要求','当前结论'],[[r['id'],short[r['id']],'未验证']for r in d['windows']if r['id']in short],[70,W-170,100]))
para('Linux Electron、受控缩放、配置存在和包内代码运行均不能替代上述Windows、PPT、实体触屏或听感证据。','Small')

page('新增Windows验收和停止的专项')
for r in d['windows']:
    if not r['id'].startswith('R14-W'):continue
    head(r['id']+' '+r['title']+'  未验证')
    para(r['expected']);para('建议实机步骤：'+r['steps'],'Small')
para('已取得的云端证据包括官方NSIS代码及Windows路径模型、真实Linux主进程/预加载、shell.openPath受控替身、失败注入和ExcelJS读写；它们不能证明Windows外层EXE实际启动或原生Excel/WPS占用效果。','Small')
head('此前新增锁和文件专项保持停止')
para('该新增锁、权限及文件边界专项此前因平台风险提示中止。没有重试或换路径执行。它不计本轮通过，也不据此推断产品缺陷。普通锁定回归、头像有效性和合成文件故障只支持各自明确的测试场景。')
para('记录依据：artifacts/rc10/specialized-audit-status.json。平台未提供具体被阻止工具或动作；报告不猜测。','Small')

page('过程记录与测试脚本修正')
if d.get('qaNotes'):story.append(T(['记录','实际情况与处理'],[[q['id']+' '+q['title'],q['actual']]for q in d['qaNotes']],[170,W-170]))
page('升级和报告使用')
head('升级时保留文件');para('先在旧版保存完整JSON备份，再完全退出程序及悬浮窗口，替换程序文件。程序同级“头像”目录和计分卡片.xlsx分别保留。打开新版核对班级、名单、头像、积分、宠物和历史；修改外部Excel后使用程序内“刷新”并审阅确认。')
head('历史导入核对');para(d['upgradeNote'],'Small')
head('报告文件如何查证');para('Excel是完整测试表，包含176项要求、全部当前执行明细、问题修复复验和证据索引。PDF概述结果及边界。报告Excel已重算和视觉检查，未声称在Microsoft Excel原生应用打开验证。原始证据路径相对交付源码包根目录。','Small')

page('交付文件身份')
files=d.get('package',{}).get('files',[])
story.append(T(['交付文件','字节数及SHA256'],[[f['name'],str(f.get('bytes',f.get('sizeBytes','未记录')))+' bytes\n'+f['sha256']]for f in files]or[['待最终发布文件','未验证']],[280,W-280]))
para('各文件的名称、字节数和哈希用于确认报告关联的版本。源码和运行ASAR身份见前文；报告文件自己的最终哈希另保存在RC14-REPORT-MANIFEST.json。','Small')

name='花伴课堂_1.3.0-rc.14_全面测试报告'+('_制作预览'if preview else'')+'.pdf'
doc=SimpleDocTemplate(str(out/name),pagesize=size,leftMargin=38,rightMargin=38,topMargin=30,bottomMargin=35,title='花伴课堂 RC14 全面测试报告',author='Flower Classroom QA')
def footer(c,doc):
    c.setFont('STSong-Light',8);c.setFillColor(muted);c.drawString(38,18,'花伴课堂 1.3.0-rc.14 / 冻结源码、精确ASAR、历史追溯和未验证范围');c.drawRightString(size[0]-38,18,str(doc.page))
doc.build(story,onFirstPage=footer,onLaterPages=footer)
(out/'pdf-sections.json').write_text(json.dumps(sections,ensure_ascii=False,indent=2))
print(json.dumps({'file':name,'sections':len(sections),'bytes':(out/name).stat().st_size,'sha256':hashlib.sha256((out/name).read_bytes()).hexdigest()},ensure_ascii=False))
