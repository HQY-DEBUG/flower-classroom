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
 c.setFont('STSong-Light',8.3);c.setFillColor(muted);c.drawString(42,24,'花伴课堂 1.3.0-rc.10 / 独立复查与环境恢复复验');c.drawRightString(W-42,24,str(doc.page))
def scenario_status(r):
 return '失败' if '失败' in [r['sourceStatus'],r['packageStatus']] else '通过' if r['sourceStatus']==r['packageStatus']=='通过' else '未验证'
def counts(scope):
 cs=[c for r in d['runs'] if r['scope']==scope for c in r['checks']]
 return len(cs),sum(c['status']=='passed' for c in cs),sum(c['status']=='failed' for c in cs)
story=[P('花伴课堂 RC10\n独立复查报告','TitleCN'),P(('最终验证' if d['finalized'] else '待最终验证')+' / 2026-10-03 至 '+d['date']+' UTC','SmallCN'),P(d['releaseGate'])]
story.append(P('本次从已交付RC9真实ASAR检查存档恢复、工具草稿、事务回执，以及备份恢复与未完成操作的交叉影响。初版修复被独立再审继续发现遗漏，修复前记录和候选迭代分开列示。'))
story.append(table(['问题范围','修复要求'],[
 ['存档恢复','仅剩旧格式previous时读取完整课堂。损坏链或保留损坏文件失败时进入只读恢复，禁止静默覆盖为示例资料。'],
 ['工具草稿与关闭','保存失败和无效输入保留草稿，可修正重试。另一窗更新后保留文字但禁止旧保存；关闭入口及键盘路径保持可用。'],
 ['回执及跨恢复意图','较新写入后的旧成功收据要求核对。恢复前等待中的旧操作不得写入恢复后资料；同一成功恢复的逻辑意图仍能核对且不重复执行。'],
 ['恢复后的界面','恢复令旧抽宠缓存、回执、动画、网址与课堂视图失效。迟到启动读取重新获取当前状态；通知失败先更新可见资料再允许新操作。']
 ],[116,395]))
story.append(P('最终执行分母','HeadCN'))
rr=[]
for scope in ['冻结源码','最终ASAR','启动专项','独立再审','预览专项']:
 n,p,f=counts(scope);rr.append([scope,f'{p}/{n} ({p/n:.1%})' if n else '无当前执行记录',f,n-p-f])
story.append(table(['对象','通过 / 总断言','失败','未验证'],rr,[137,192,91,91]))
story.append(P('百分比只描述清单内断言。断言、场景、功能ID是不同分母，不能据此称全软件零bug或100%审计。云端Linux Electron执行真实ASAR不等于Windows EXE现场验收。','SmallCN'))
story.append(PageBreak());story.append(P('修复迭代与环境恢复','TitleCN'))
story.append(table(['代表路径','观察与修复要求'],[
 ['未知+1后撤销/恢复','已提交但回复丢失的+1被撤销或恢复覆盖后，旧版仍可提示成功而保存积分为0。现要求较新版本下核对当前记录，不把旧成功冒充新奖励。'],
 ['第一次自动收据恢复','独立再审停住首次自动收据快照，并在另一窗撤销，暴露首版遗漏。自动和后续恢复共用最新版本校验。'],
 ['恢复前排队操作','等待失败收据查询的旧加分或工具操作跨过恢复，可能把恢复的40分改为41。恢复代次拒绝旧意图；无关计分或失败恢复不误伤合法操作。'],
 ['相同计数器恢复','同班恢复不同内容但域计数相同的备份时，网址、签到、投票视图和确认仍可能停留旧状态。恢复事件显式刷新并作废旧会话。'],
 ['启动读取与通知缺失','旧首次读取不能把恢复后的40分初始化为0。恢复通知失败时先同步可见的权威状态，再接受下一次明确操作。'],
 ['同一恢复意图重试','成功恢复推进自己的代次后，仍应核对同笔丢失回执且不重复创建备份。该兼容性修正触发重新冻结，早期冻结不能计作最终结果。']
 ],[122,389]))
story.append(P('工作环境替换后重新取证','HeadCN'))
story.append(P('最终报告生成期间，执行环境被替换，本地最终日志和未导出的报告丢失。已保存的分发文件从Library恢复，重新核对同一ASAR与运行时代码。最终表只采用恢复后重新执行并能核验的证据；丢失的最后日志不按记忆补写。'))
story.append(P('此前已保存的RC9资料与RC10检查点继续保留。测试脚本问题单列：最初进程终止未真正截断同步保存；源码预览缺少弹层CSS；宠物切换包装脚本曾缺少历史参考JSON。它们不自动算作Windows产品缺陷。','SmallCN'))
story.append(PageBreak());story.append(P('功能分母与待验范围','TitleCN'))
fr=[]
for cat in ['原片','补充','RC6新增']:
 a=[r for r in d['features']if r['category']==cat];p=sum(r['rc10Status']=='通过'for r in a);f=sum(r['rc10Status']=='失败'for r in a);fr.append([cat,f'{p}/{len(a)} ({p/len(a):.1%})',f,len(a)-p-f])
story.append(table(['功能类别','RC10通过 / 总项','失败','未验证'],fr,[137,192,91,91]))
provision=[]
for cat in ['原片','补充','RC6新增']:
 a=[r for r in d['features']if r['category']==cat];p=sum(r.get('implementationStatus')=='已提供'for r in a);provision.append(f'{cat}{p}/{len(a)} ({p/len(a):.1%})')
story.append(P('实现提供率（已提供源码/界面入口）：'+'；'.join(provision)+'。它与上表验证通过率分开，不代表Windows效果已验证。逐项依据见Excel O/P列。','SmallCN'))
story.append(P('原片75项、补充28项、RC6新增15项分开。RC9历史68/75、28/28、15/15另列，只有本次对应执行绑定后才计RC10通过。V076排除。原视频时间/来源与用户授权下推定规则逐项分开。','SmallCN'))
story.append(P('七项Windows现场要求','HeadCN'))
wr=[r for r in d['features']if r['id']in ['V033','V035','V037','V038','V052','V054','V067']];story.append(table(['功能ID','继续未验证'],[[r['id'],r['title']]for r in wr],[90,421]))
story.append(P('被阻止的新增专项另列未知','HeadCN'))
story.append(P('新增锁/文件专项被平台网络安全风险提示中止，未提供具体被阻止工具，未绕路或重试。此范围与七项Windows要求分开；已存在的课堂锁回归只证明自身断言，不能代替新增专项。'))
story.append(P('恢复实验与资料边界','HeadCN'))
story.append(P('SIGKILL只检验应用进程突停，不证明真实断电、磁盘控制器缓存或Windows文件系统故障语义。收据仍是当前进程、原窗口内最多128条；刷新清除界面待确认意图，重启清除收据。之后需核对已保存记录，不声称持久恰好一次。全部使用合成名单，没有真实学生资料或原视频照片。','SmallCN'))
story.append(PageBreak());story.append(P('版本身份与验收依据','TitleCN'))
story.append(P('已交付RC9保持原样','HeadCN'));story.append(table(['对象','SHA256'],[['RC9便携EXE',d['baseline']['exeSha256']],['RC9 ASAR',d['baseline']['asarSha256']]],[112,399]))
story.append(P('RC10最终版本与恢复身份','HeadCN'))
identity=[['版本',d['version']],['源码冻结UTC',d['source'].get('at','待绑定')],['源码集合SHA256',d['source'].get('sha256','待绑定')],['ASAR SHA256',d['package'].get('asarSha256','待绑定')]]
identity += [[('便携EXE' if f['name'].endswith('.exe') else '完整文件夹7z' if f['name'].endswith('.7z') else '完整文件夹ZIP'),f"{f['name']}\n{f['bytes']:,} bytes\nSHA256 {f['sha256']}"]for f in d['package'].get('files',[])]
story.append(table(['对象','身份'],identity,[153,358]));story.append(Spacer(1,5));story.append(P('逐项证据与验收范围','HeadCN'))
story.append(P('详细Excel包括操作步骤、预期、实际、修前记录、修复、源码/ASAR结果、独立再审、视频依据及精确JSON位置。SHA256与环境恢复过程另列；源文件位于源码包artifacts/rc10。缺失记录标明未恢复，不伪造执行。','SmallCN'))
story.append(P('结论只限重新取证覆盖的范围内，没有尚未解决的已发现缺陷。七项Windows现场、新增被阻止专项以及进程/断电等边界仍保留。','SmallCN'))
out.mkdir(parents=True,exist_ok=True);file=out/'花伴课堂_1.3.0-rc.10_独立复查简要报告.pdf';doc=SimpleDocTemplate(str(file),pagesize=A4,rightMargin=42,leftMargin=42,topMargin=38,bottomMargin=42,title='花伴课堂 RC10 独立复查报告',author='Flower Classroom QA');doc.build(story,onFirstPage=foot,onLaterPages=foot);print(json.dumps({'name':file.name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()},ensure_ascii=False))
