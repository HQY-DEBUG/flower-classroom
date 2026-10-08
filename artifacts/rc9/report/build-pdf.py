import json,sys,hashlib
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,PageBreak
from reportlab.lib.pagesizes import A4
d=json.loads(Path(sys.argv[1]).read_text());out=Path(sys.argv[2]);preview='--preview' in sys.argv
assert d['finalized'] or preview
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
W,H=A4;navy=colors.HexColor('#304D68');ink=colors.HexColor('#23394C');muted=colors.HexColor('#5A6D80')
styles=getSampleStyleSheet()
for name,size,lead,color in [('TitleCN',20,27,ink),('HeadCN',12.5,18,navy),('BodyCN',10.4,15.5,ink),('SmallCN',9,13,muted),('CellCN',9.4,13,ink),('WhiteCN',9.4,13,colors.white)]:
 styles.add(ParagraphStyle(name=name,fontName='STSong-Light',fontSize=size,leading=lead,textColor=color,spaceAfter=7 if name in ['BodyCN','SmallCN'] else 10 if name=='TitleCN' else 6,spaceBefore=10 if name=='HeadCN' else 0,wordWrap='CJK'))
def P(t,style='BodyCN'):return Paragraph(escape(str(t)).replace('\n','<br/>'),styles[style])
def table(headers,rows,widths):
 t=Table([[P(x,'WhiteCN')for x in headers]]+[[P(x,'CellCN')for x in r]for r in rows],colWidths=widths,repeatRows=1,hAlign='LEFT')
 t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,colors.HexColor('#F0F4F7')]),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7)]))
 return t
def foot(c,doc):
 c.setFont('STSong-Light',8.3);c.setFillColor(muted);c.drawString(42,24,'花伴课堂 1.3.0-rc.9 / 2026-10-03 / 独立复查');c.drawRightString(W-42,24,str(doc.page))
def scenario_status(r):
 return '失败' if '失败' in [r['sourceStatus'],r['packageStatus']] else '通过' if r['sourceStatus']==r['packageStatus']=='通过' else '未验证'
def counts(scope):
 cs=[c for r in d['runs'] if r['scope']==scope for c in r['checks']]
 return len(cs),sum(c['status']=='passed' for c in cs),sum(c['status']=='failed' for c in cs)
story=[P('花伴课堂 RC9\n独立复查报告','TitleCN'),P(('最终冻结版本' if d['finalized'] else '排版预览，等待最终证据')+' / 2026-10-03','SmallCN')]
story.append(P('这次从已交付的RC8-r2包重新检查，重点追查旧确认、导出中断和异步回复。问题按四类汇总，具体触发、修复前结果、操作步骤及修复后证据逐行列在详细Excel中。'))
story.append(table(['问题类别','修复范围与边界'],[
 ['① 过期确认','毕业物种、成长和阈值变化后拒绝旧确认。替换、恢复、清空、删除、归档及空白班级操作要求确认快照仍有效。'],
 ['② 导出中断','JSON备份与名单模板、排行榜、分类汇总先写临时文件，再替换目标。部分写入失败时保留已有文件。'],
 ['③ 结果回执异常','一次回执故障通过进程内收据恢复已提交结果。双重故障保持“结果未知”，阻止盲目重复并提示核对/刷新。'],
 ['④ 旧回复干扰新编辑','异步完成时校验所属弹层，旧工具的迟到回复不能关闭或覆盖后来打开的编辑窗口。']
 ],[112,399]))
story.append(P('本次专项场景','HeadCN'))
rows=[]
for name in ['宠物与毕业','导入与导出','破坏性确认','基础弹层','异步编辑扩展','跨班级一致性','回执恢复']:
 rs=[r for r in d['scenarios']if r['suite']==name];rows.append([name,len(rs),sum(scenario_status(r)=='通过'for r in rs),sum(scenario_status(r)=='失败'for r in rs),sum(scenario_status(r)=='未验证'for r in rs)])
story.append(table(['专项','场景行数','通过','失败','未验证'],rows,[207,76,76,76,76]))
src,pkg=counts('冻结源码'),counts('最终ASAR')
startup=counts('启动专项');story.append(Spacer(1,7));story.append(P(f'最终执行断言：冻结源码 {src[1]}/{src[0]} 通过，最终ASAR {pkg[1]}/{pkg[0]} 通过，启动身份专项 {startup[1]}/{startup[0]} 通过。场景、重复断言和历史功能使用不同分母；交叉场景不能相加作为不同bug数或功能通过率。','SmallCN'))
story.append(P('磁盘故障、回执丢失和延迟释放均为可控注入。普通流程和保护控制使用合成资料。云端Linux Electron运行真实ASAR，不等于Windows EXE、PPT覆盖、物理触屏或真实音频通过。','SmallCN'))
story.append(PageBreak())
story.append(P('修复证据与原有边界','TitleCN'))
story.append(P('可复现的代表路径','HeadCN'))
story.append(table(['路径','修复前观察','修复后的判定'],[
 ['毕业确认过期','确认猫头鹰后另一窗换成狐狸；旧确认却提交狐狸毕业。成长30改为37、阈值变化也可提交旧确认。','拒绝已变化的确认内容，不产生错误毕业/荣誉，要求重新打开核对。'],
 ['旧破坏性确认','打开替换/恢复等确认后，另一窗保存新资料；旧确认仍覆盖或清空新内容。','保存版本/内容不再匹配时拒绝，不清除新资料，不额外落盘。'],
 ['已有目标部分写入','故障注入让JSON和3类工作簿写入13字节后失败；已有文件被截断。','原目标字节不变，临时文件清理；解除故障后重试生成可读取文件。'],
 ['提交成功但回复失败','真实成长已+3后注入回执错误，旧版保留可重试表单；重试成为+6和两条日志。','单次回执错误恢复成功结果，只记+3。更深双故障保留未知，不声称可跨进程恢复。'],
 ['旧工具回复迟到','提交旧设置后延迟回复，再打开新学生编辑；旧回复到达时关闭新编辑。','当前新编辑保留，旧回复只能处理自己所属的界面。']
 ],[103,204,204]))
story.append(P('历史功能与Windows待验','HeadCN'))
fp={cat:[sum(r['rc9Status']=='通过'for r in d['features']if r['category']==cat),sum(r['category']==cat for r in d['features'])]for cat in ['原片','补充','RC6新增']}
story.append(P(f'按原功能ID重绑RC9：原片{fp["原片"][0]}/{fp["原片"][1]}项通过；补充教程{fp["补充"][0]}/{fp["补充"][1]}项通过；RC6新增{fp["RC6新增"][0]}/{fp["RC6新增"][1]}项通过。RC8-r2历史状态另列。缺少本次证据不记通过，以下7项Windows要求继续未验证。','SmallCN'))
unverified=d['features'];unverified=[r for r in unverified if r['baselineStatus']=='未验证']
story.append(table(['功能ID','仍待真实Windows验证'],[[r['id'],r['title']]for r in unverified],[90,421]))
story.append(P('还需实际Windows观察窗口全屏/拖移、多屏DPI、PPT切页与焦点、物理触摸、扬声器听感及生产单实例。云端尺寸、缩放、业务状态与单次音频授权只证明对应范围。','SmallCN'))
story.append(PageBreak())
story.append(P('版本身份与验收依据','TitleCN'))
story.append(P('已交付基线保持原样','HeadCN'))
story.append(table(['基线对象','SHA256'],[['RC8-r2 EXE',d['baseline']['exeSha256']],['RC8-r2 ASAR',d['baseline']['asarSha256']],['RC8-r2源码集合',d['baseline']['sourceSha256']]],[125,386]))
story.append(P('RC9最终候选','HeadCN'))
identity=[['应用版本',d['version']],['源码冻结UTC',d['source'].get('at','尚未冻结')],['源码集合SHA256',d['source'].get('sha256',d['source'].get('revision','尚未绑定'))],['ASAR SHA256',d['package'].get('asarSha256','尚未绑定')]]
identity += [[('便携EXE' if f['name'].endswith('.exe') else '完整文件夹7z' if f['name'].endswith('.7z') else '完整文件夹ZIP'),f"{f['name']}\n{f['bytes']:,} bytes\nSHA256 {f['sha256']}"] for f in d['package'].get('files',[])]
story.append(table(['对象','身份'],identity,[160,351]))
story.append(P('证据定位与测试说明','HeadCN'))
story.append(P('详细Excel提供每个专项场景的步骤、预期、修复前状态、冻结源码结果、最终ASAR结果、具体JSON检查位置及SHA256。原始证据在源码包的artifacts/rc9目录；过程失败另表保留。','SmallCN'))
story.append(P('候选过程也保留：首个RC9包遗漏Excel传递依赖，未交付；第一次源码26套通过后，新并发探测发现重开抽宠工具可重复待回执奖励，首候选也未交付。两项修正后重新冻结、重建和完整复验，早期通过不代替最终结果。','SmallCN'))
story.append(P('旧包身份以真实入口与ASAR指纹为准，不使用调试目录当前package版本号推断被测版本。修前失败、测试脚本失败和最终候选结果分别统计。所有资料为合成名单，无原视频照片或真实学生数据。','SmallCN'))
for note in d.get('finalNotes',[]):story.append(P(note,'SmallCN'))
out.mkdir(parents=True,exist_ok=True);file=out/'花伴课堂_1.3.0-rc.9_独立复查简要报告.pdf'
doc=SimpleDocTemplate(str(file),pagesize=A4,rightMargin=42,leftMargin=42,topMargin=38,bottomMargin=42,title='花伴课堂 RC9 独立复查报告',author='Flower Classroom QA')
doc.build(story,onFirstPage=foot,onLaterPages=foot)
print(json.dumps({'name':file.name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()},ensure_ascii=False))
