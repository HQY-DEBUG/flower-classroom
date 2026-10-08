"""Chinese, bounded 20-page narrative companion to the complete workbook."""
import json,sys,re,hashlib
from pathlib import Path
from collections import Counter
from xml.sax.saxutils import escape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak,KeepTogether
from reportlab.lib.pagesizes import A4,landscape
d=json.loads(Path(sys.argv[1]).read_text());out=Path(sys.argv[2]);preview='--preview'in sys.argv
assert d.get('finalized')or preview
out.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
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
size=landscape(A4);W=size[0]-76
ev={e['file']:e['id']for e in d['evidence']}
def ids(t):return'、'.join(dict.fromkeys(ev[f]for f in ev if f in t))or'待绑定'
def counts(rows):
    c=Counter(r['status']for r in rows);return[c['通过'],c['失败'],c['未验证'],len(rows)]
story=[];sections=[]
def page(title):
    if story:story.append(PageBreak())
    story.append(P(title,'Title'));sections.append(title)
def head(t):story.append(P(t,'Head'))
def para(t,style='Body'):story.append(P(t,style))

page('花伴课堂 RC12独立审计与RC13修复复验')
para(('最终冻结版本报告'if d.get('finalized')else'制作预览  尚不能作为交付通过结论')+' / '+d['date']+' UTC','Small')
para(d['releaseGate'])
head('RC12正式基线')
story.append(T(['受测范围','通过','失败','记录数','说明'],[
['旧确认、同ID恢复、班名编辑',21,15,36,'另有21次新进程快照核对，不加进这36场景'],
['名单、头像匹配及导出重导',13,8,21,'含1次新进程重启；独立openpyxl复现另列'],
['图鉴键盘和荣誉实时展示',13,5,18,'另有新进程重启；3类焦点情境归为同一根因'],
['正式记录合计',47,28,75,'28个失败归纳为10类根因，不能等同28个独立缺陷']],[250,55,55,65,W-425]))
para('旧删除/轮盘确认、恢复后旧表单和导入漏行/错图可改变真实保存的资料。荣誉相册不更新时，受测磁盘中的毕业及兑换账本仍正确。新进程成功重载错误状态，只证明持久化一致，不能证明错误行为正确。','Small')
para('RC13整合复审另发现3类过程问题IR1-IR3，单独记录其修前、修复与最终复验。班名迟到回复丢草稿已用RC12对照确认是修复引入的回归；这些过程问题不加入RC12的75条或28个失败。','Small')
head('155项功能仍逐项判断')
sr=[]
for label in ['RC11新增37项','既有118项']:
    rows=[r for r in d['requirements']if r['baselineKind']==label];c=counts(rows);sr.append([label,*c,f'{c[0]/c[3]:.1%}'])
c=counts(d['requirements']);sr.append(['合计',*c,f'{c[0]/c[3]:.1%}'])
story.append(T(['需求范围','通过','失败','未验证','总数','效果通过率'],sr,[W-340,60,60,75,65,80]))
para('效果通过率以全部155项为分母。实现提供、功能效果、执行检查数分别记录。7项Windows现场效果继续未验证；此前中止的新增锁/权限/文件专项单列未完成。完整Excel保留每项需求来源、预期、操作步骤、实际、修复、测试时间、版本和证据。','Small')

page('版本身份和证据判断')
identity=[['交付RC12','ASAR SHA256 '+d['baseline']['asarSha256']+'\n便携EXE SHA256 '+d['baseline']['portableSha256']],['修复RC13','源码冻结UTC '+d.get('source',{}).get('at','待最终冻结')+'\n源码集合SHA256 '+d.get('source',{}).get('sha256','待绑定')+'\nASAR SHA256 '+d.get('package',{}).get('asarSha256','待绑定')]]
story.append(T(['对象','精确身份'],identity,[90,W-90]))
head('最终冻结执行层')
scope_rows=[]
for scope in dict.fromkeys(r['scope']for r in d['runs']if r['stage']=='最终冻结'):
    cs=[c for r in d['runs']if r['stage']=='最终冻结'and r['scope']==scope for c in r['checks']];c=Counter(c['status']for c in cs)
    scope_rows.append([scope,c['passed'],c['failed'],len(cs)-c['passed']-c['failed'],len(cs)])
story.append(T(['执行层','通过检查','失败','其他','总数'],scope_rows or[['等待最终运行清单','未验证','未验证','未验证','未验证']],[W-280,75,65,65,75]))
para('源码、Node模型、Linux Electron实际ASAR和Windows实机是不同证据层。只有本轮最终清单选定且哈希一致的运行才能支持当前效果；开发成功、旧报告通过和包内文件存在均不自动转成当前通过。Excel记录每条检查的原始名称和定位。','Small')
head('需求来源')
para('既有原片需求保留原始109秒视频的时间定位与“视频确认/合理推导”区别。来源：https://www.douyin.com/jingxuan?modal_id=7679405517986542159 。本报告没有重新声称观看原片，也不附原视频、真实学生资料或用户照片。37项后续功能及118项已有要求保持原ID，新增失败作为关联审计问题。','Small')
para('证据路径均相对源码包根目录；E编号对应Excel“版本证据”。运行未记精确时间时明确标为未记录，不使用文件修改时间冒充执行时间。所有课堂、名单、图片及恢复档案均为合成夹具。','Small')

for f in d['findings']:
    page(f['id']+'  '+f['title'])
    para(f['module']+' / '+('RC13过程失败 '+str(f['processFailed'])if f.get('stage')else'RC12原失败 '+str(f['baselineFailed']))+' 项 / 关联功能 '+f['affected'],'Small')
    head('预期和复现步骤');para(f['expected']);para(f['steps'])
    head('RC13早期候选实际'if f.get('stage')else'RC12实际结果');para(f['before'])
    head('RC13修复与复验');para(f['fix'])
    story.append(T(['开发过程证据','最终源码','最终ASAR','当前结论'],[[f['sourceDetail'],f['sourceStatus'],f['packageStatus'],f['status']]],[W-285,80,85,120]))
    head('旧版临时措施与升级后行为');para(f['workaround'])
    head('证据定位')
    refs=('RC13过程修前 'if f.get('stage')else'RC12修前 ')+ids(f['baselineFile']+'\n'+f['baselineDetail'])+'；最终源码 '+ids(f['sourceEvidence'])+'；最终ASAR '+ids(f['packageEvidence'])
    para(refs+'\n'+f['baselineFile']+'\n'+f['baselineDetail'],'Small')

short={'R001':'清零范围、倒计时与取消','R002':'积分原因编辑与历史保持','R003':'多人正负成长及原子提交','R004':'按组奖励与基础分分离','R005':'小组基础分及历史','R006':'六段成长门槛配置','R007':'新旧面板门槛兼容','R008':'抽组奖励及重复保护','R009':'毕业确认、荣誉与幂等','R010':'学生成长/荣誉排行','R011':'小组徽章总量与均值','R012':'高级造型隐藏与同步','R013':'降级、下限与实际撤销','R014':'毕业后新蛋及历史保留','R015':'徽章兑换、相册及PNG卡片','R016':'普通积分奖品兑换与撤销','R017':'自定义原因加分','R018':'冒险挑战入口及窄窗','R019':'普通锁定、解锁及重启','R020':'组总分/均分/导出一致','F001':'九个工具入口与窄窗可达','F002':'投票边界、同步与重试','F003':'签到、缺勤与重置','F004':'复制名单但不复制积分','F005':'小组排序、空组与取消','F006':'跨组移动保留资料','F007':'普通分和宠物成长隔离','F008':'换宠、非零数据及失效保护'}
rows=[[r['id'],short.get(r['id'],r['title']),r['status']]for r in d['requirements']]
for start in range(0,len(rows),32):
    page('155项功能状态 '+str(start//32+1)+' / 5')
    para('完整需求、预期步骤、具体实际、来源时间及逐项证据见Excel。N001-N037为37项后续功能；其余118项保持原始需求ID。历史状态不自动沿用。','Small')
    chunk=rows[start:start+32];mid=(len(chunk)+1)//2;w=(W-16)/2
    a=T(['ID','功能及核验要点','效果'],chunk[:mid],[53,w-114,61]);b=T(['ID','功能及核验要点','效果'],chunk[mid:],[53,w-114,61])if chunk[mid:]else''
    outer=Table([[a,'',b]],colWidths=[w,16,w]);outer.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)]));story.append(outer)

page('关键覆盖和证据的实际含义')
story.append(T(['领域','已设计的代表性操作','判断边界'],[
['旧意图与恢复','同ID、同名称、同组、同分恢复；目标改名/毕业；延迟提交；失败重试、双击和重开确认；无关学生变更对照。','拒绝时核对完整内存和磁盘；可用对照避免把所有旧窗口都禁用当作修复。'],
['公式与空行','ExcelJS和独立openpyxl原始夹具；无缓存姓名/小组/头像；缓存空字符串/0/false；未知元数据；稀疏、格式和CSV空行。','不计算公式，不访问链接；缓存与显示值区别保留；301实际学生仍整批拒绝。'],
['文件名与图片','中文、emoji、标点、引号、括号、百分号等合法名字；前导空白冲突；185/255字符；实际照片哈希。','先匹配原始完整名称；预览后快照保存、JSON恢复和重启一致；路径/URL仍不允许。'],
['导出与导入','学生、宠物、全部、汇总、学生排行五种报表重导；重名不同身份；领先零文字和分组；迟到预览及取消。','CSV/XLSX是姓名/小组往返；完整ID、积分、快照和账本用JSON备份，不把报表称完整备份。'],
['反馈与图鉴','连续原生Tab/Enter、嵌套Escape、200%三窗口反馈、同等级成长、毕业后重新领养、延迟提交后的新草稿。','焦点、语义控制、滚动、选中预览与账本分别检查；受控Linux缩放不是实体触屏。'],
['荣誉与范围','全班两人毕业、单人兑换/改名、同ID恢复、目标删除；关闭状态与其他草稿；历史快照名称保留。','只读更新没有新增写入；显式相册对象不会跟随另窗悬浮选择漂移。']],[85,350,W-435]))
head('计数规则');para('本轮75条正式基线、最终检查条数和155项功能是三种不同分母。相同场景在源码、ASAR和重启重复执行时分别保留，不称为更多功能。独立复现坏行为记“观察/确认缺陷”，不因复现脚本成功就计软件通过。','Small')

page('七项Windows现场效果和中止专项')
win_short={'V033':'Windows实机缩放、默认大小与全屏行为；真实DPI与实体触控','V035':'红花悬浮窗口覆盖全屏PPT，课件仍能正常操作','V037':'Windows拖动、收窄及窗口边界行为','V038':'全屏课件切页时侧栏持续可见且可操作','V052':'Windows透明圆形计时器的桌面合成效果','V054':'Windows三种提示音的实际播放与听感','V067':'独立窄宠物窗口覆盖全屏PPT的实机效果'}
story.append(T(['ID','要求及现场预期','状态'],[[w['id'],w['title']+'\n'+win_short[w['id']],'未验证']for w in d['windows']],[60,W-140,80]))
head('此前停止的新增锁和文件专项');para('该新增锁、权限及文件边界专项此前因平台风险提示停止。本轮没有重试或换路径执行，保持独立未验证。普通课堂锁定回归、头像有效性、合成保存失败等检查只支持各自场景，不构成该专项完成或安全认证。')
para('Windows便携/安装启动、PPT覆盖和切页、桌面合成、真实DPI、实体触屏和提示音听感需要对应实机。Linux Electron实际加载包内代码并不等于运行Windows EXE；报告Excel已做公式和渲染检查，未声称在Microsoft Excel原生应用验证。','Small')

page('过程失败保留与升级核对')
story.append(T(['记录','处理和保留情况'],[[q['id']+' '+q['title'],q['actual']]for q in d['qaNotes']],[165,W-165]))
head('已损失的资料需要核对');para(d['upgradeNote'],'Small')
head('升级步骤');para('先在旧版导出完整JSON备份，完全退出旧进程及悬浮窗口，再替换程序文件。打开新版先核对班级、姓名、小组、头像、积分和荣誉。头像已选快照在存档中，未选中的avatars素材库仍需单独备份。升级后若恢复备份，应重新核对操作对象并打开新的确认；软件不会自动覆盖真实班级。','Small')

name='花伴课堂_1.3.0-rc.13_全面测试报告'+('_制作预览'if preview else'')+'.pdf'
doc=SimpleDocTemplate(str(out/name),pagesize=size,leftMargin=38,rightMargin=38,topMargin=30,bottomMargin=35,title='花伴课堂 RC12独立审计与RC13修复复验',author='Flower Classroom QA')
def footer(c,doc):
    c.setFont('STSong-Light',8);c.setFillColor(muted);c.drawString(38,18,'花伴课堂 1.3.0-rc.13 / RC12基线、修复过程、冻结源码和精确ASAR');c.drawRightString(size[0]-38,18,str(doc.page))
doc.build(story,onFirstPage=footer,onLaterPages=footer)
(out/'pdf-sections.json').write_text(json.dumps(sections,ensure_ascii=False,indent=2))
print(json.dumps({'file':name,'sections':len(sections),'bytes':(out/name).stat().st_size,'sha256':hashlib.sha256((out/name).read_bytes()).hexdigest()},ensure_ascii=False))
