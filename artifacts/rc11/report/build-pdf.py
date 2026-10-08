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

d=json.loads(Path(sys.argv[1]).read_text());out=Path(sys.argv[2]);preview='--preview' in sys.argv
assert d.get('finalized') or preview
out.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
ink=colors.HexColor('#263648');navy=colors.HexColor('#334F69');muted=colors.HexColor('#596D7E');pale=colors.HexColor('#F2F5F8')
styles=getSampleStyleSheet()
for name,size,lead,color in [('TitleCN',21,28,ink),('HeadCN',12.5,18,navy),('BodyCN',10.5,15,ink),('SmallCN',8.5,12,muted),('CellCN',8.6,11.7,ink),('WhiteCN',8.6,11.7,colors.white),('GuideCN',11,16,ink)]:
    styles.add(ParagraphStyle(name=name,fontName='STSong-Light',fontSize=size,leading=lead,textColor=color,spaceAfter=7,spaceBefore=8 if name=='HeadCN' else 0,wordWrap='CJK'))
styles['HeadCN'].keepWithNext=False
def P(text,style='BodyCN'):
    text='' if text is None else str(text)
    text=text.replace('\u2212','-').replace('\u2011','-').replace('\u2013','-').replace('\u2014','-')
    return Paragraph(escape(text).replace('\n','<br/>'),styles[style])
def table(headers,rows,widths,section=None):
    headrows=([[P(section,'WhiteCN')]+['']*(len(headers)-1)] if section else [])+[[P(x,'WhiteCN') for x in headers]]
    t=Table(headrows+[[P(x,'CellCN') for x in r] for r in rows],colWidths=widths,repeatRows=len(headrows),hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),navy),('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.white,pale]),('VALIGN',(0,0),(-1,-1),'TOP'),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7)]))
    if section:t.setStyle(TableStyle([('SPAN',(0,0),(-1,0)),('BACKGROUND',(0,1),(-1,1),navy),('ROWBACKGROUNDS',(0,2),(-1,-1),[colors.white,pale])]))
    return t
def footer(label,size):
    def draw(c,doc):
        c.setFont('STSong-Light',8);c.setFillColor(muted);c.drawString(35,21,label);c.drawRightString(size[0]-35,21,str(doc.page))
    return draw
def counts(items,key='status'):
    c=Counter(r[key] for r in items);return [c['通过'],c['失败'],c['未验证'],len(items)]
def rc(scope):
    cs=[c for r in d['runs'] if r['scope']==scope for c in r['checks']]
    return [sum(c['status']=='passed' for c in cs),sum(c['status']=='failed' for c in cs),sum(c['status'] not in ('passed','failed') for c in cs),len(cs)]
evidence={x['file']:'E'+str(i+1).zfill(3) for i,x in enumerate(d['evidence'])}
def ref(text):
    for file,id in sorted(evidence.items(),key=lambda v:len(v[0]),reverse=True):text=text.replace(file,id)
    text=re.sub(r'results\[(\d+)\]\.report\.checks\[(\d+)\]',r'R\1/C\2',text)
    text=re.sub(r'runs\[(\d+)\]\.report\.checks\[(\d+)\]',r'U\1/C\2',text)
    text=re.sub(r'results\[(\d+)\]\.checks\[(\d+)\]',r'D\1/C\2',text)
    text=re.sub(r'report\.checks\[(\d+)\]',r'P/C\1',text)
    text=re.sub(r'checks\[(\d+)\]',r'C\1',text)
    return text

size=landscape(A4);width=size[0]-70
story=[P('花伴课堂 RC11 详细测试报告','TitleCN'),P(('冻结后最终证据' if d.get('finalized') else '制作预览：等待最终复验')+' / '+d['date']+' UTC','SmallCN'),P(d['releaseGate'])]
story.append(P('本次改动','HeadCN'))
story.append(table(['范围','行为'],[
    ['宠物蛋起步','新领养及新建零成长伙伴使用统一蛋造型。首次正成长孵化，继续使用原七阶段门槛。旧存档未标记伙伴保持原样。原40物种、280幅造型保留。'],
    ['40张原创头像与单一素材库','头像在既有资料目录中的avatars文件夹统一管理。首次明确使用时准备默认图，后续手动增删、刷新。学生卡片可快捷选择头像或导入照片，选中后保存嵌入快照。'],
    ['可选名单头像列','XLSX/CSV的可选第三列“头像名称”匹配文件夹图片。预览逐行显示匹配及警告，确认保存预览快照；旧两列模板继续兼容。']
],[125,width-125]))
story.append(P('当前功能统计','HeadCN'))
summary=[]
for cat in ['宠物蛋','头像库','名单头像']:
    cs=counts([r for r in d['newFeatures'] if r['category']==cat]);summary.append([cat,*cs])
for cat in ['原片','补充','RC6新增']:
    cs=counts([r for r in d['features'] if r['category']==cat]);summary.append([cat+'（已有功能）',*cs])
story.append(table(['功能范围','通过','失败','未验证','总项'],summary,[width-320,80,80,80,80]))
story.append(P('通过率只描述本报告列出的要求或断言。实现提供、模型测试、Linux Electron界面效果、Windows现场效果分别记录，不把功能数、测试次数、缺陷数混加。原有118项在RC10的111项通过为历史事实；RC11状态须有本次证据。','SmallCN'))
story.append(P('共享弹层317个检查采用已保留的完整运行与定向复验逐项调和。它不是某一单轮317项全绿；首轮315/317、过严等待条件轮及后续复验分别见问题H005和原始证据。','SmallCN'))

story.append(PageBreak());story.append(P('执行范围与未验证项','TitleCN'))
story.append(table(['执行对象','通过断言','失败','未验证','断言合计'],[[scope,*rc(scope)]for scope in ['冻结源码','最终ASAR','包内Node模型','启动专项','独立复验','源码预览']],[width-320,80,80,80,80]))
story.append(P('生产ASAR的实际Electron覆盖合计1128项：主回归/专项1119项，加独立包复验9项。独立复验51项包含上述9项、源码9项、差异模型12项与焦点测试21项，不能把重叠统计重复相加。冻结源码1610项包括441项Node模型及1169项Electron检查。','SmallCN'))
story.append(P('测试环境','HeadCN'))
story.append(P('所有资料与图片均为合成样本，没有真实学生数据、真实学生照片或参考视频帧。界面测试运行于Linux Electron。使用实际main/preload与可见界面流程；选择器和打开文件夹使用受控输入/替身。包内Node模型为最终ASAR提取模块的441项模型检查，单列且不混入Electron效果数。缩放不等同Windows DPI或实体触屏验收。'))
story.append(table(['功能ID','继续未验证的Windows效果'],[[r['id'],r['title']] for r in d['windows']],[92,width-92]))
story.append(P('此前新增锁、权限与文件边界专项因平台风险提示中止，未重试、未绕路。该专项与上表七项Windows要求分别保留未知；既有普通锁回归及本版头像库测试不能代替未完成的专项。','SmallCN'))

story.append(PageBreak());story.append(P('发现的问题与修复复验','TitleCN'))
if d['defects']:
    story.append(table(['记录 / 类别','修前实际','修复与复验','状态 / 证据'],[[r['id']+'\n'+r['type']+'\n'+r['title'],r['before'],r['fix']+'\n复验：'+r['retest'],r['status']+'\n'+ref(r['evidence'])]for r in d['defects']],[125,210,255,width-590]))
else: story.append(P('等待最终问题清单及复验绑定。尚未发布最终通过结论。'))
story.append(P('产品缺陷、测试脚本问题和环境限制分别标注。修前失败保留为过程证据，最终通过仅计修复并重新冻结后的结果。所有早期候选轮均不自动算入最终包通过数。','SmallCN'))

story.append(PageBreak());story.append(P('RC11新增功能逐项矩阵','TitleCN'))
story.append(P('每项包含预期、步骤、实际、状态、版本与证据。N023、N024两侧均为Node模型/文件边界测试，不宣称Electron界面效果。其余项按所列模型与实际界面证据绑定。源码及最终包对应检查齐备后才记综合通过。E编号在“证据索引”中给出文件与SHA256。','SmallCN'))
story.append(P('证据缩写：Cn=checks[n]；Rn/Cm=results[n].report.checks[m]；Un/Cm=runs[n].report.checks[m]；Dn/Cm=results[n].checks[m]；P/Cn=report.checks[n]。索引从0起；Excel保留完整JSON定位。','SmallCN'))
for cat in ['宠物蛋','头像库','名单头像']:
    story.append(Spacer(1,8))
    rows=[]
    for r in [r for r in d['newFeatures'] if r['category']==cat]:
        result=f"{r['status']}\n源码：{r['sourceStatus']}\nASAR：{r['packageStatus']}\n{r['actual']}"
        rows.append([r['id']+' '+r['title']+'\n版本 '+r['version']+'\n实现：'+r['implementationStatus'],r['expected'],r['steps'],result,r['fix']+'\n源码：'+ref(r['sourceEvidence'])+'\nASAR：'+ref(r['packageEvidence'])])
    story.append(table(['功能 / 版本','预期结果','测试步骤','实际 / 状态','修复、复验与证据'],rows,[120,150,165,132,width-567],section=cat))

story.append(PageBreak());story.append(P('原有118项功能逐项复验','TitleCN'))
story.append(P('RC10历史状态与RC11状态分别列出。既有功能的本次处理为保留实现并重新核对对应检查，不把历史结果直接承接。操作步骤、预期与原始依据沿用原需求矩阵；完整原始依据、规则说明、实现依据及历史证据另见Excel“已有118功能”。','SmallCN'))
for cat in ['原片','补充','RC6新增']:
    story.append(Spacer(1,8));rows=[]
    for r in [r for r in d['features'] if r['category']==cat]:
        rows.append([r['id']+' '+r['title']+'\nRC11：'+r['status']+'\nRC10历史：'+r['historyStatus'],r['expected'],r['steps'],r['actual']+'\n实现：'+r['implementationStatus'], '版本1.3.0-rc.11\n复验：重新绑定本次检查\n'+ref(r['evidence'])])
    story.append(table(['功能 / 状态','预期结果','测试步骤','本次实际','版本、复验与证据'],rows,[120,170,170,125,width-585],section=cat))

story.append(PageBreak());story.append(P('版本身份','TitleCN'))
identity=[['版本',d['version']],['冻结UTC',d.get('source',{}).get('at','待绑定')],['源码集合SHA256',d.get('source',{}).get('sha256','待绑定')],['最终ASAR SHA256',d.get('package',{}).get('asarSha256','待绑定')]]
identity += [[f['name'],str(f.get('bytes',f.get('sizeBytes')))+' bytes\nSHA256 '+f['sha256']]for f in d.get('package',{}).get('files',[])]
story.append(table(['对象','身份'],identity,[220,width-220]))
story.append(P('历史RC10 ASAR SHA256：'+d['history']['asarSha256']+'。该历史身份只用于核对既有交付，不构成本版通过证据。','SmallCN'))
story.append(P('正常资料仍使用%APPDATA%\\FlowerClassroom，appId保持org.flowerclassroom.desktop。旧资料不批量变蛋。已选头像独立保存，完整备份包含已选快照；未选中的整库素材需自行复制备份。进程突停与受控异常测试不证明实际断电或所有Windows文件系统行为。','SmallCN'))
story.append(PageBreak());story.append(P('证据索引','TitleCN'))
story.append(P('路径相对源码包根目录。E编号加checks/results定位可在原始JSON中查到对应断言；完整逐断言实际值及执行时间见Excel“本次执行记录”。','SmallCN'))
story.append(table(['编号','文件与用途','SHA256'],[[evidence[r['file']],r['file']+'\n'+r['purpose'],r['sha256']]for r in d['evidence']],[55,width-340,285]))
report=out/'花伴课堂_1.3.0-rc.11_详细测试报告.pdf'
doc=SimpleDocTemplate(str(report),pagesize=size,leftMargin=35,rightMargin=35,topMargin=32,bottomMargin=36,title='花伴课堂 RC11 详细测试报告',author='Flower Classroom QA')
foot=footer('花伴课堂 1.3.0-rc.11 / 功能、预期、步骤、实际与可追溯证据',size);doc.build(story,onFirstPage=foot,onLaterPages=foot)

files=d.get('package',{}).get('files',[])
folder=next((f['name']for f in files if f['name'].endswith('-folder.7z')),'FlowerClassroom-1.3.0-rc.11-folder.7z')
zipname=next((f['name']for f in files if f['name'].endswith('-x64.zip')),'FlowerClassroom-1.3.0-rc.11-x64.zip')
portable=next((f['name']for f in files if f['name'].endswith('-portable.exe')),'FlowerClassroom-1.3.0-rc.11-portable.exe')
guide_sections=[
('升级与日常启动',[
    '1. 先在旧版导出一份完整备份，再完全退出旧版及其悬浮窗口。不要让新旧版本同时编辑同一份资料。',
    f'2. 日常使用可选择完整目录包{folder}，或{zipname}。将整个压缩包一次性解压到固定文件夹，双击其中的“花伴课堂.exe”。保留旁边的resources等全部文件，不要只拷贝EXE，也不要直接在压缩包内运行。',
    f'3. 单文件便携版为{portable}。它启动时会展开运行文件；完整目录包只需首次整体解压。',
    '4. 正常资料目录仍是%APPDATA%\\FlowerClassroom。更换程序文件夹不会新建另一套正常课堂资料。打开后先核对班级、名单、积分和照片，再开始日常使用。旧档升级到RC11已测；新蛋标记是旧版不认识的附加字段，升级后请持续用新版保存，避免来回用旧版改同一存档。已选头像仍使用原photo快照格式。']),
('宠物蛋怎么成长',[
    '新建或新领养的40种伙伴，在成长为0时显示同一枚蛋。第一次获得正成长就会破壳，之后沿用原来的七阶段门槛。撤销、扣减或成长重置回到0后，新周期会再次显示蛋。',
    '旧存档里未带蛋起始标记的伙伴保持原来的造型和成长。原40种伙伴及280幅成长造型都保留；毕业快照和荣誉继续保留。']),
('头像文件夹的增删与刷新',[
    '学生页点击卡片头像即可“快捷导入照片”或选择卡通头像。选好后点击“保存头像”；取消不会改档案。学生编辑表也可点击“使用头像库”。',
    '班级设置 → 打开头像库 → 打开头像文件夹。所有头像素材集中放在这个文件夹的一层内，默认位置为%APPDATA%\\FlowerClassroom\\avatars。首次打开会准备40张原创PNG头像。',
    '添加自己的PNG/JPG/JPEG/WebP静态图片，或删除不需要的素材，然后回到程序点击“刷新头像库”。子文件夹中的图片不会加入。图片损坏、过大或不支持时会提示并跳过。',
    '素材库只首次准备默认图。删除的默认图片不会在刷新、重启或升级后自动补回来。已选头像会作为快照随学生保存；删除或替换原图，不会改变学生已经保存的头像。']),
('名单第三列如何填写',[
    '首行为“姓名”“小组”，可以增加第三列“头像名称”。可使用随附的“花伴课堂-名单模板-含头像名称.xlsx”，也可在软件中“下载模板”。原来只有姓名、小组的两列模板继续可用。',
    '示例：姓名=示例同学，小组=向日葵组，头像名称=01-星星猫头鹰.png。请填写头像文件夹内的图片文件名，不填写完整路径或网址。',
    '建议保留扩展名；省略扩展名仅在唯一匹配时可用。头像名称留空使用默认姓名头像。找不到、名称冲突或格式无效时，预览会逐行提示并显示默认头像。',
    '先检查导入预览中的姓名、分组、头像与警告，再确认。需要改图或文件名时取消，修改素材/模板并刷新后重新导入。确认保存的是预览时的头像，即使预览后源图被删除或替换，也不会换成另一张图。']),
('备份与遇到提示时',[
    '完整备份包含学生已选头像。若希望保留整套素材库，包括还未选给学生的图片，请另外复制avatars文件夹。只备份课堂数据不会自动打包所有未使用素材。',
    '随附“花伴课堂-40张原创卡通头像.zip”可单独保存这40张默认素材。要加入现有头像库，请解压后把avatars里的图片直接放入软件打开的头像文件夹，再刷新；不要多套一层avatars子文件夹。',
    '出现“档案或备份已变化”等提示时，关闭旧草稿或预览，重新打开核对后再操作。替换名单会重建名单与积分，请认真查看确认范围；追加用于保留现有同学。',
    '本版报告完成的是云端Linux Electron及模型验证。Windows实机、PPT覆盖、实体触屏和音频听感等七项现场效果仍未验，见详细报告。'])
]
gst=[P('花伴课堂 RC11\n升级与使用速查','TitleCN'),P('版本1.3.0-rc.11','SmallCN')]
for i,(title,paragraphs) in enumerate(guide_sections):
    if i==3:gst.append(PageBreak())
    gst.append(P(title,'HeadCN'));gst.extend(P(p,'GuideCN')for p in paragraphs)
guide=out/'花伴课堂_1.3.0-rc.11_升级与使用速查.pdf'
gdoc=SimpleDocTemplate(str(guide),pagesize=A4,leftMargin=40,rightMargin=40,topMargin=35,bottomMargin=36,title='花伴课堂 RC11 升级与使用速查',author='Flower Classroom')
gfoot=footer('花伴课堂 1.3.0-rc.11 / 升级、宠物蛋、头像文件夹与名单导入',A4);gdoc.build(gst,onFirstPage=gfoot,onLaterPages=gfoot)
txt='花伴课堂 RC11 升级与使用速查\n版本1.3.0-rc.11\n\n'+'\n\n'.join(title+'\n'+'\n'.join(ps)for title,ps in guide_sections)
(out/'花伴课堂_1.3.0-rc.11_升级与使用速查.txt').write_text(txt,encoding='utf-8-sig')
print(json.dumps([dict(name=p.name,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())for p in [report,guide]],ensure_ascii=False))
