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
ink=colors.HexColor('#263648');navy=colors.HexColor('#334F69');muted=colors.HexColor('#596D7E');pale=colors.HexColor('#F2F5F8')
styles=getSampleStyleSheet()
for name,size,lead,color in [('Title',20,27,ink),('Head',12.5,18,navy),('Body',10.5,15,ink),('Small',8.7,12,muted),('Cell',9,12.5,ink),('White',9,12.5,colors.white)]:
    styles.add(ParagraphStyle(name='CN'+name,fontName='STSong-Light',fontSize=size,leading=lead,textColor=color,spaceAfter=6,spaceBefore=5 if name=='Head' else 0,wordWrap='CJK'))
styles['CNCell'].spaceAfter=0
styles['CNWhite'].spaceAfter=0
styles['CNHead'].keepWithNext=True
def P(t,style='Body'):
    t=str(t if t is not None else'')
    t=t.replace('\u2011','-').replace('\u2013','-').replace('\u2014','-').replace('\u2212','-')
    return Paragraph(escape(t).replace('\n','<br/>'),styles['CN'+style])
def T(headers,rows,widths):
    t=Table([[P(h,'White')for h in headers]]+[[P(x,'Cell')for x in r]for r in rows],colWidths=widths,repeatRows=1,hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,pale]),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7)]));return t
size=landscape(A4);W=size[0]-72
ev={e['file']:e['id']for e in d['evidence']}
def refs(t):
    for f,e in sorted(ev.items(),key=lambda p:len(p[0]),reverse=True):t=t.replace(f,e)
    t=re.sub(r'results\[(\d+)\]\.report\.checks\[(\d+)\]',r'R\1/C\2',t)
    t=re.sub(r'runs\[(\d+)\]\.report\.checks\[(\d+)\]',r'U\1/C\2',t)
    t=re.sub(r'checks\[(\d+)\]',r'C\1',t)
    return t
def evidence_ids(t):return'、'.join(dict.fromkeys(re.findall(r'E\d{3}',refs(t))))or'待绑定'
def status_counts(rows):
    c=Counter(r['status']for r in rows);return[c['通过'],c['失败'],c['未验证'],len(rows)]
story=[P('花伴课堂\nRC11全面审计与RC12修复复验','Title'),P(('最终冻结版本报告'if d.get('finalized')else'制作预览：尚无最终通过结论')+' / '+d['date']+' UTC','Small'),P(d['releaseGate'])]
story.append(P('交付后的扩展检查发现了什么','Head'))
story.append(T(['被审计范围','通过','失败','仅观察','统计说明'],[
 ['宠物成长、图鉴与反馈','11 + 1重启','7','0','18个主场景，另1个新进程重启'],
 ['头像编辑、素材与持久化','22','2','0','24个场景，含独立重启'],
 ['名单导入、事务及文本格式','46功能 + 2格式','8格式','4','46个功能/重启通过；10项格式回归2过8败；4项仅观察'],
 ['工具、恢复与键盘连续操作','23',str(d['baselineToolsFailed']),'0',str(d['baselineToolsCount'])+'个去重场景：原30项+音色焦点扩展1项；原生滚轮4项替换旧记录']
 ],[215,110,85,75,W-485]))
story.append(P(str(d['baselineFailed'])+'个基线失败场景归纳为10类问题。普通积分、宠物成长、荣誉及跨面板台账在多数受测场景中保持正确；明确的数据风险是CSV/XLSX文本导入及恢复后旧删除确认。宠物混合反馈、批量毕业展示遗漏不等于底层成长或荣誉丢失。','Small'))
story.append(P('RC12修复期间的独立复核又发现1类批量反馈生命周期问题（IR01）。它作为第11类闭环单独记录，不回填为RC11的基线失败。','Small'))
story.append(P('RC12功能验证口径','Head'))
summary=[]
for label in ['RC11新增37项','既有118项']:
    rows=[r for r in d['requirements']if r['baselineKind']==label];c=status_counts(rows);summary.append([label,*c, f'{c[0]/c[3]:.1%}'])
c=status_counts(d['requirements']);summary.append(['合计',*c,f'{c[0]/c[3]:.1%}'])
story.append(T(['功能范围','效果通过','失败','未验证','总项','效果通过率'],summary,[W-375,75,65,80,65,90]))
story.append(P('实现提供：'+str(sum(r['implementationStatus']=='已提供'for r in d['requirements']))+'/155。实现提供率和实际效果通过率分别计算；7项Windows现场效果继续保留未验证。5360次模型比较、209次提交和测试断言数均不作为功能数。','Small'))

story.append(PageBreak());story.append(P('版本、执行层与判断边界','Title'))
identity=[['基线','实际交付 1.3.0-rc.11\nASAR SHA256 '+d['baseline']['asarSha256']],['修复候选','1.3.0-rc.12\n源码冻结 '+d.get('source',{}).get('at','待绑定')+'\n源码集合 SHA256 '+d.get('source',{}).get('sha256','待绑定')+'\nASAR SHA256 '+d.get('package',{}).get('asarSha256','待绑定')]]
story.append(T(['对象','精确身份'],identity,[95,W-95]))
counts=[]
for scope in dict.fromkeys(r['scope']for r in d['runs']if r['stage']=='最终冻结'):
    cs=[c for r in d['runs']if r['stage']=='最终冻结'and r['scope']==scope for c in r['checks']];co=Counter(c['status']for c in cs);counts.append([scope,co['passed'],co['failed'],len(cs)-co['passed']-co['failed'],len(cs)])
story.append(P('只统计最终冻结证据','Head'))
story.append(T(['执行层','通过断言','失败','其他','合计'],counts or[['待最终运行清单',0,0,0,0]],[W-300,75,75,75,75]))
story.append(P('每条执行记录在Excel中标有版本、阶段、运行对象、精确检查键及证据SHA256。基线失败和开发过程轮保留；仅最终冻结且精确绑定的检查支持RC12当前结论。源码/Node模型与实际Linux Electron加载ASAR分别列示，不声称运行过Windows EXE。','Small'))
story.append(P('本报告不覆盖的现场结果','Head'))
story.append(P('原生Windows安装/便携启动、Windows桌面合成与PPT覆盖、实体触屏、真实DPI和提示音听感未执行。受控文件选择器、Linux缩放及新进程重启只证明各自范围；报告Excel已做公式与渲染验证，未运行原生Microsoft Excel。此前新增锁、权限与文件边界专项因平台提示停止，保持未验证，没有重试或绕路。'))
story.append(P('阅读与追溯','Head'))
story.append(P('PDF按问题和场景说明结果，Excel保留155项完整“功能、预期、步骤、实际、状态、版本、证据、修复复测”矩阵及逐条执行记录。E编号与Excel“版本证据”一致；C编号为从0开始的checks索引。原日志未记录精确时间或数值时明确保留缺省，不补写推测值。','Small'))

for i in range(0,len(d['findings']),2):
    story.append(PageBreak());story.append(P('发现、修复与复验 '+str(i//2+1)+'/'+str((len(d['findings'])+1)//2),'Title'))
    for f in d['findings'][i:i+2]:
        story.append(P(f['id']+'  '+f['title'],'Head'))
        outcome='最终源码：'+f['sourceStatus']+'；最终ASAR：'+f['packageStatus']+'；'+f['status']
        rows=[['预期与步骤',f['expected']+'\n'+f['steps']],['RC12早期实际'if f['id']=='IR01'else'RC11修前实际',f['before']],['RC12修复与结果',f['fix']+'\n'+outcome+'\n'+(f['sourceDetail']if f['sourceStatus']=='通过'else'开发过程观察：'+f['sourceDetail'])],['证据与版本',f['version']+'；关联 '+f['affected']+'\n修前 '+evidence_ids(f['baselineFile']+'\n'+f['baselineDetail'])+'；最终源码 '+evidence_ids(f['sourceEvidence'])+'；最终ASAR '+evidence_ids(f['packageEvidence'])]]
        story.append(T(['核验环节','记录'],rows,[100,W-100]));story.append(Spacer(1,7))

story.append(PageBreak());story.append(P('关键场景覆盖与实际含义','Title'))
scenario_rows=[
 ['宠物成长与历史','40种伙伴、三组不等门槛含总量10亿、准确边界、零成长蛋/旧档无标记、扣减与撤销。毕业旧周期撤销、再次领养、兑换、规则变化和面板复制保持永久快照。','基线底层数值多数通过；七个界面/文案失败定位至P01-P04。完整18场景及重启须在最终源码/ASAR重跑。'],
 ['头像保存与异步回复','全编辑器/快捷编辑、同字段冲突、无关字段并发、取消/清除胜过迟到选择器、写入失败重试、素材替换及刷新。','A01误保存和A02旧选框为实际问题；原24场景基础上加头像按钮Enter和个人导入选框对照。'],
 ['名单导入与原子性','旧两列、可选第三列、精确/短名/NFC/歧义匹配，300/301人数边界、追加/替换、并发容量、过期预览、保存失败及重启。','46个功能/重启原本通过；CSV保真和富文本明确失败。4项观察不记正确性通过。'],
 ['文本与模板','前导零、小数尾零、富文本表头/行、超链接文字、公式缓存0/false、错误/日期单元格、无关元数据；模板三列为文本。','只读取已存文字或缓存结果，不计算公式或导航链接；无法恢复电子表格软件此前已转成数字/日期而丢失的原文字。'],
 ['恢复与旧确认','旧学生删除确认跨同ID恢复；重新打开确认；其他学生普通加分作为有效性对照。','C01是会删除恢复后资料的真实问题。修复必须阻断旧意图，也须证明新确认仍可用。'],
 ['键盘与延迟','Space/Enter连续两次、迟到保存、Tab/鼠标新意图、Escape、新草稿、文本选区、禁用边界、短窗与高缩放。','K01包含作业勾选、作业提交、签到、加票、成员下移、计时器加量及扩展音色选择焦点。' if d['keyboardScenarioCount']==7 else 'K01包含六种连续键盘控件。'],
 ['窄窗及工具生命周期','240px积分窗、300px宠物窗，100%/125%缩放的原生滚轮及关闭重开；七类原生辅助窗幂等创建和销毁。','这证明Linux受控窗口中的可操作性，不能替代Windows/PPT覆盖、原生窗口管理或实体触屏。']]
story.append(T(['领域','具有代表性的操作','如何解读'],scenario_rows,[95,340,W-435]))

short={
 'R001':'清零范围、倒计时与取消','R002':'积分原因编辑与历史保持','R003':'多人正负成长及原子提交','R004':'按组奖励与基础分分离','R005':'小组基础分及历史','R006':'六段成长门槛配置','R007':'新旧面板门槛兼容','R008':'抽组奖励及重复提交保护','R009':'毕业确认、荣誉与幂等','R010':'学生成长/荣誉排行','R011':'小组徽章总量与均值','R012':'高级造型隐藏与同步','R013':'降级、下限与实际差额撤销','R014':'毕业后新蛋及历史保留','R015':'徽章兑换、相册及PNG卡片','R016':'普通积分奖品兑换与撤销','R017':'自定义原因加分','R018':'冒险挑战入口及窄窗','R019':'普通锁定、解锁及重启','R020':'组总分/均分/导出一致',
 'F001':'九个工具入口与窄窗可达','F002':'投票边界、同步与重试','F003':'签到、缺勤与重置','F004':'复制名单但不复制积分','F005':'小组排序、空组与取消','F006':'跨组移动保留个人资料','F007':'普通分和宠物成长隔离','F008':'换宠、非零数据及失效保护'}
rows=[[r['id'],short.get(r['id'],r['title']),r['status']]for r in d['requirements']]
for start in range(0,len(rows),32):
        story.append(PageBreak());story.append(P('155项完整功能状态 '+str(start//32+1)+'/5','Title'))
        story.append(P('N001-N037为RC11新增37项，其余为原有118项。完整预期、步骤、实际、修复复测及证据在Excel逐行展开。N023/N024为Node模型/文件边界；R001/R002/R017仅源码专项；7项Windows效果未验。','Small'))
        chunk=rows[start:start+32];split=(len(chunk)+1)//2;left=chunk[:split];right=chunk[split:]
        width=(W-14)/2
        a=T(['ID','功能及核验要点','效果'],left,[51,width-107,56])
        b=T(['ID','功能及核验要点','效果'],right,[51,width-107,56]) if right else ''
        outer=Table([[a,'',b]],colWidths=[width,14,width],hAlign='LEFT')
        outer.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)]))
        story.append(outer)

story.append(PageBreak());story.append(P('七项Windows效果与中止专项','Title'))
story.append(T(['ID','现场要求','当前结果'],[[w['id'],w['title']+'\n'+w['expected'],'未验证；实现配置和云端检查不代替现场']for w in d['windows']],[65,W-235,170]))
story.append(P('新增锁、权限与文件边界专项','Head'));story.append(P('该专项此前因平台风险提示中止。本轮没有重试或换路径执行；普通锁定回归、头像文件有效性检查以及合成保存失败测试只证明各自场景，不构成该专项完成或安全认证。'))

story.append(PageBreak());story.append(P('失败保留、测试纠正与升级核对','Title'))
story.append(T(['记录','测试问题及处理'],[[q['id']+' '+q['title'],q['actual']]for q in d['qaNotes']],[180,W-180]))
story.append(P('RC11旧导入资料需要人工核对的范围','Head'));story.append(P(d['upgradeNote']))
story.append(P('日常升级','Head'));story.append(P('升级前从旧版导出完整备份，完全退出旧进程和悬浮窗口。正常课堂资料仍使用既有资料目录；程序文件更新不应当作名单替换。打开新版后先核对班级、姓名、小组、头像、积分与荣誉。旧版已选头像为嵌入快照，删除素材不会追改它；未选中的整套avatars素材库仍需单独复制备份。'))
story.append(P('取证文件','Head'));story.append(P('原始基线、开发失败及各次复验保留在源码证据目录。Excel“执行明细”给出每条精确名称、阶段、实际值、定位和SHA256；“版本证据”给出全部E编号。以下列出本报告新审计及修复记录的主要索引。','Small'))
referenced='\n'.join(str(f[k])for f in d['findings']for k in('baselineFile','baselineDetail','sourceEvidence','packageEvidence'))
main=[e for e in d['evidence']if e['file']in referenced or'FINAL-REVIEW.json'in e['file']or'final-test-manifest.json'in e['file']]
story.append(T(['编号','主要证据文件','用途'],[[e['id'],e['file'],e['purpose']]for e in main],[55,W-215,160]))

name='花伴课堂_1.3.0-rc.12_全面测试报告'+('_制作预览'if preview else'')+'.pdf'
doc=SimpleDocTemplate(str(out/name),pagesize=size,leftMargin=36,rightMargin=36,topMargin=30,bottomMargin=34,title='花伴课堂 RC11全面审计与RC12修复复验',author='Flower Classroom QA')
def foot(c,doc):
    c.setFont('STSong-Light',8);c.setFillColor(muted);c.drawString(36,18,'花伴课堂 1.3.0-rc.12 / 交付基线、修复复验、功能效果与可追溯证据');c.drawRightString(size[0]-36,18,str(doc.page))
doc.build(story,onFirstPage=foot,onLaterPages=foot)
print(json.dumps({'file':name,'bytes':(out/name).stat().st_size,'sha256':hashlib.sha256((out/name).read_bytes()).hexdigest()},ensure_ascii=False))
