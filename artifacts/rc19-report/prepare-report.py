"""Prepare RC19 definitions without inheriting any RC18 execution result."""
from pathlib import Path
from collections import defaultdict
import copy
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
BASE = ROOT.parent.parent / 'flower-rc18-work/FlowerClassroom-source'
VERSION = '1.3.0-rc.19'

def read(path): return json.loads(path.read_text())
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def write(name, value): (OUT/name).write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')

# Stable feature IDs are reused; the changed product contract is explicit.
DEFINITIONS = {
 'N001': ('40种伙伴按当前积分显示蛋与等级', '40种伙伴统一按当前学生积分和全局进阶计算；积分低于5（含0和负数）为蛋、LV0。旧成长字段不决定当前等级。'),
 'N002': ('累计达到5分首次孵化', '从0连续点击真实加分入口，1至4分仍为蛋；达到5分为LV1。新领养不清零已有积分。'),
 'N003': ('累计门槛与25级以后持续升级', '默认逐级费用为5、10、15，其后每级20；LV1至LV25累计门槛为5、15、30、50、70、90、110至470，LV26为490，以后持续每20分升级。数值等级不限制为七级。'),
 'N004': ('扣分撤销与清零同步当前等级', '普通和宠物入口均改变当前积分；跨门槛扣分及时降级，低于5回蛋，撤销恢复正确积分和等级。旧成长、毕业快照及永久荣誉不被新操作改写。'),
 'N005': ('旧成长保留而等级按当前积分计算', '旧档成长字段及历史记录保留原值；无论是否有旧标记，当前等级只由当前积分和全局规则决定，不能因旧成长显示更高等级。'),
 'N006': ('图鉴保留七种视觉造型', '每种伙伴仍保留七种原有造型；数值等级可以超过7，视觉造型最高保持第七种，不新增第八种或更多图片。'),
 'N008': ('旧毕业快照只读保留', '保留并可浏览已有毕业记录、奖章及永久快照。按用户要求暂不启用新毕业，不新授毕业奖励、不重置积分或新建毕业周期，旧接口调用原子拒绝。'),
 'N011': ('40种孵化与280造型完整保留', '40种伙伴在当前积分5分时正确显示各自第一造型；40×7共280种已有造型完整保留，高数值等级复用第七造型。'),
 'N025': ('名单支持姓名性别组号头像列', 'CSV/XLSX识别姓名、性别、组号、头像及既有兼容别名；姓名必填，性别可选且仅记录文件提供的值，头像可选；旧两列格式继续可用。'),
 'N030': ('名单模板含可选性别与填写说明', '标准名单模板明确姓名、性别、组号、头像字段及兼容说明；性别可留空，不根据姓名推断性别；用户原文件保留。'),
 'N031': ('旧名单与新表头均实际导入', '旧姓名/小组两列及新姓名/性别/组号/头像格式均经过真实预览和确认路径；空性别保持空值，已有头像和非名单历史按导入模式正确保留。'),
 'V010': ('当前面板选择清楚可见', '面板选择器明确显示当前面板与选中状态，切换后使用对应名单和积分；共享卡片与全局进阶一致，原板资料保持隔离。'),
 'V028': ('批量分组内直接新建组并分配', '批量分组对话框内可输入新组名，一次确认原子创建新组并分配选中的学生；取消、无效输入、过期选择及写失败不留空组或部分分配。'),
 'V059': ('宠物卡显示当前积分与实际等级', '宠物卡显示当前学生积分、对应数值等级和正确造型；0及负分为LV0，超过七级继续显示真实等级，历史成长不再作为当前进度。'),
 'V064': ('七种造型与无限数值等级分离', '图鉴展示七种已有视觉造型，不能将其解释为最高数值等级；高等级保持第七造型，未达5分为蛋。'),
 'V065': ('阶段名称与数值等级不混淆', '视觉阶段名称对应七种造型；卡片和明细标注真实当前积分等级，25级以后仍按全局尾段费用继续升级。'),
 'V066': ('扣减积分可降级', '扣减当前积分使数值等级按全局门槛下降；旧成长与永久荣誉保留，撤销按实际积分差额恢复。'),
 'V068': ('普通与宠物入口共用计分卡', '所有面板的普通计分与宠物计分入口使用同一组共享名称和分值；卡片统一改变当前学生积分，旧隐藏成长参数不能另行决定等级。'),
 'V069': ('计分理由与当前积分变化可见', '可见卡片显示理由及分值；确认与历史显示实际积分变化，宠物等级按同一当前积分更新。'),
 'V070': ('0至5分破壳闭环', '从0分按真实加1按钮依次到1、2、3、4仍为蛋LV0；到5分显示LV1，扣1回蛋，撤销回LV1，主窗和悬浮窗同步。'),
 'V072': ('升级不新增毕业奖章', '普通升级只改变当前积分与派生等级，不产生毕业记录或新奖章；既有荣誉与快照保持。'),
 'V073': ('批量计分与课后操作一致', '批量宠物操作使用当前积分口径，并包括有效选中学生；原子保存、重复保护、取消和历史保持仍适用，不另写旧成长。'),
 'V075': ('新毕业停用而旧荣誉只读保留', '新毕业与新毕业奖励停用，原毕业记录和永久总荣誉可见并保留；已有徽章余额兑换及撤销仍可用；旧的授奖或重置接口不得悄悄改变资料。'),
 'R006': ('25行全局逐级费用与尾段规则', '所有面板共享同一进阶配置；工作表列出1至25级逐级费用与累计门槛，尾段重复费用控制26级以后。默认费用5、10、15，其后20，既有学生积分和历史不被规则编辑改写。'),
 'R007': ('全局进阶工作表预览确认', '根目录配置.xlsx提供全局宠物进阶，所有面板一致生效；整本预览显示25级累计表及尾段，不再按面板编辑旧成长模式，取消/冲突/失败保留资料和草稿。'),
 'R008': ('宠物抽取奖励记入当前积分', '抽组或多人抽取后按明确选中的有效对象记入当前积分，等级同步；重复提交不重复奖励，旧成长和永久历史不改写。'),
 'R009': ('新毕业接口按要求拒绝', '按用户当前决定不启用新毕业；可见界面不提交新毕业，旧或直接接口明确拒绝，取消和重复调用均不新建记录、荣誉或积分重置。'),
 'R012': ('隐藏高阶造型不改变真实等级', '隐藏高阶造型的设置只控制图鉴展示；真实当前积分等级和七种原有造型资产保持，多窗口一致。'),
 'R013': ('扣分与撤销按实际积分差额更新', '扣分、允许负值或适用下限处理按当前积分计算实际差额；等级随分值下降，撤销仅恢复该笔差额，后续记录和旧成长/荣誉保持。'),
 'R014': ('旧毕业后的资料不被新机制重置', '已有毕业快照、永久徽章及学生当前资料保持可见；本轮不新建毕业周期，不因旧毕业或换宠自动清零当前积分。'),
 'R016': ('积分兑换与撤销同步等级', '普通积分兑换可按既有规则从16减200到负184，撤销回16；派生宠物等级随当前分值变化，旧成长和荣誉保持，取消/重复/写失败不误写。'),
 'R017': ('自定义计分使用统一当前积分', '42分输入理由并加88后为130，对应默认LV8且复用第七造型；必填校验、方向、旧成长和历史保护正确。'),
 'F005': ('分组排序与内联新建原子分配', '分组排序仍可预览、取消和保存；批量分组内直接创建新组并分配所选学生，组创建和身份分配作为一个原子操作，窄窗控件可达。'),
 'F007': ('旧独立成长操作退休', '普通与宠物操作统一计入当前学生积分；旧成长字段保留但不再驱动等级，旧联动或独立模式动作不能重新启用旧语义。'),
 'F008': ('换宠保持积分等级和旧快照', '可见换宠入口改变物种而保留当前积分、派生等级、旧成长和永久快照；取消、重复、磁盘失败与过期对象处理正确。'),
 'RC6-13': ('40种领养换宠与旧毕业记录', '全部新增伙伴可领养、换宠并按当前积分显示等级；原毕业记录保留，新毕业按用户要求停用。'),
 'R14-02': ('计分卡只编辑名称与积分', '计分卡编辑界面仅要求名称和分值并正确校验；旧隐藏成长元数据保留以维护历史，但不能从可见编辑入口新增独立成长奖励。'),
 'R14-03': ('所选卡片改变统一当前积分', '普通和宠物入口应用同一共享卡片分值至当前积分，等级同步；旧成长元数据不驱动当前等级，新记录不追加旧成长奖励。'),
 'R14-10': ('隐藏系统ID与空ID自动生成', '配置工作簿的系统ID列隐藏；用户在新行填写有效内容而留空ID时自动生成稳定唯一ID，重复或非法ID仍整本拒绝；全局进阶和各面板参数共同校验。'),
}

baseline = read(BASE/'artifacts/rc18-report/report-input.json')
manifest = read(BASE/'artifacts/rc18/final-test-manifest.json')
rename = defaultdict(set)
node_map=ROOT/'artifacts/rc19/inherited-regression-contract-map.json'
application_map=ROOT/'artifacts/rc19/inherited-application-case-migrations.json'
for mapping in (read(node_map)['mappings'] if node_map.is_file() else []):
    rename[mapping['original']].add(mapping.get('replacement',mapping['original']))
for file in (read(application_map) if application_map.is_file() else []):
    for mapping in file['changedCases']:
        rename[mapping['original']].add(mapping['replacement'])

requirements=[]
for old in baseline['requirements']:
    item={key:copy.deepcopy(old[key]) for key in ['id','module','category','title','expected','steps','requiredScopes','platformUnverified','limits','basis','sourceKind','implementationEvidence'] if key in old}
    item.update(version=VERSION,status='未验证',sourceStatus='未验证',packageStatus='未验证',sourceEvidence='',packageEvidence='',actual='等待本轮冻结源码及最终ASAR证据',implementationStatus='待本轮实现与证据核对',fix='本轮重新验证；不继承历史通过',testTime='未执行',historicalVersion=baseline['version'],historicalStatus=old['status'],historicalExpected=old['expected'],historicalTitle=old['title'],historicalEvidence=old.get('sourceEvidence','')+'\n'+old.get('packageEvidence',''))
    item['expectedExactAssertions']={mode:list(dict.fromkeys(replacement for name in old.get('exactBindings',old.get('expectedExactAssertions',{})).get(mode,[]) for replacement in sorted(rename.get(name,{name})))) for mode in ['source','package']}
    if item['id'] in DEFINITIONS:
        item['title'],item['expected']=DEFINITIONS[item['id']]
        item['definitionChangedIn']='RC19'
        item['bindingRevisionReason']='按用户RC19新语义修订；原定义与证据仅留作历史。当前绑定候选必须由冻结执行逐条确认。'
        item['steps']='通过真实可见入口按本项预期操作；保留取消、冲突、重复、失败及恢复等适用路径，并对源码与最终ASAR分别执行。'
    else:
        item['bindingRevisionReason']='沿用功能目的；凡涉及当前积分等级、全局配置及新毕业停用的步骤按RC19定义迁移后重新执行。'
    requirements.append(item)

requirements.append(dict(id='R19-01',module='学生资料与名单',category='学生资料与名单',title='可选性别只按提供值保存',expected='学生编辑器及名单导入支持空、男、女；性别可选且仅来自用户或文件明确提供，不根据姓名推断。取消、过期并发、失败、重开和保存恢复不丢字段或覆盖较新资料。',steps='依次保存空/男/女并重新打开；编辑未保存性别时触发其他字段/他人更新，核对草稿与冲突；从姓名/性别/组号/头像表头及兼容旧表头导入，核对空值和持久保存。',requiredScopes=['source','package'],platformUnverified=False,version=VERSION,status='未验证',sourceStatus='未验证',packageStatus='未验证',sourceEvidence='',packageEvidence='',actual='等待本轮冻结证据',implementationStatus='待本轮实现与证据核对',fix='按明确性别输入保存与导入；修复草稿丢失需最终复验',testTime='未执行',historicalVersion='无',historicalStatus='本轮新增',historicalExpected='无',historicalTitle='无',historicalEvidence='',definitionChangedIn='RC19',bindingRevisionReason='本轮新增的独立资料字段和持久化要求，不重复扩大已有导入功能分母。',limits='仅公开合成数据；真实两班名单只纳入隔离脱敏聚合，不纳入合成断言总数。',expectedExactAssertions={'source':[],'package':[]}))

journeys=[
 ('J19-01','教师从0分逐次加到5分再扣分和撤销','N001,N002,N004,V070','真实加1按钮：1/2/3/4为蛋LV0，5为LV1，扣1回蛋，撤销回LV1；主窗与悬浮窗同步'),
 ('J19-02','旧成长与负积分打开后显示正确等级','N005,V059','负分且旧成长非零仍为蛋LV0，详情显示到5分的完整差值，旧数据不改写'),
 ('J19-03','累计跨级到8级及25级以后的尾段','N003,N006,V064,V065','累计5/15/30/50/70/90/110；469为LV24、470/489为LV25、490为LV26，七造型封顶'),
 ('J19-04','普通和宠物入口交替加减分','V068,V069,R14-03,F007','两个入口操作相同当前积分，主窗、悬浮窗及历史一致，旧成长不再增加'),
 ('J19-05','一个面板编辑全局进阶后切到另一个','R006,R007,V010','所有面板同一进阶；配置.xlsx显示25行及尾段，规则编辑不改积分和历史，取消/冲突/写失败可恢复草稿'),
 ('J19-06','编辑共享卡片并从各面板使用','R14-02,R14-03,R14-10','只编辑名称与分值，ID列隐藏且新行空ID自动生成，外部整本预览明确，历史成长元数据只保留'),
 ('J19-07','在批量分组中直接新建组并分配','V028,F005','一次确认原子建组并分配，取消/非法值/过期/写失败均不部分写入，姓名积分头像身份保持'),
 ('J19-08','标准表头导入和性别编辑保存','N025,N030,N031,R19-01','姓名/性别/组号/头像及旧别名，空性别保持空，120原有头像保留，未保存性别草稿不丢'),
 ('J19-09','查看既有毕业记录并拒绝新毕业','N008,R009,R014,V075','旧记录和奖章只读，新毕业无授奖或清零，退休接口明确原子拒绝'),
 ('J19-10','从精确RC18配置收据恢复并重启','R14-11,R15-14','用真实保存的RC18收据/配置布局模拟中断后升级恢复，旧原件保留，确认全局规则和原学生资料')
]
matrix={'schemaVersion':1,'version':VERSION,'finalized':False,'denominatorFinalized':False,'proposedRequirementCount':len(requirements),'definitionStage':'待协调者确认分母及冻结证据；无继承通过','historicalBaseline':{'version':'1.3.0-rc.18','requirements':192,'passedRequirements':183,'windowsUnverified':9,'selectedGroups':210,'passedAssertions':6003,'observations':8,'manifestSha256':sha(BASE/'artifacts/rc18/final-test-manifest.json'),'inheritedPassesCounted':0},'requirements':requirements,'windowsIds':[r['id'] for r in requirements if r.get('platformUnverified')],'journeys':[dict(id=i,title=t,requirementIds=ids.split(','),expected=e,status='未验证',sourceEvidence='',packageEvidence='') for i,t,ids,e in journeys],'privacy':{'rawRosterFilesAllowed':False,'rawRosterNamesAllowed':False,'rawRosterScreenshotsAllowed':False,'allowedAggregateCounts':[53,52],'genderCountsOnlyIfCoordinatorSupplied':True},'limits':['9项Windows现场验收保留未验证','用户SmartScreen截图确认系统阻止；已交付RC18未含嵌入签名，签名/信誉问题未解决','已停止的额外锁、权限和文件安全专项保持未验证，不重启'],'graduationDecision':'用户明确暂不启用新毕业；拒绝新接口是当前要求，不是待澄清缺口。'}
matrix['denominatorFinalized']=True
matrix['historicalBaseline']['sourceFileCount']=len(baseline['source']['files'])
matrix['recovery']={'status':'Report definitions rebuilt from preserved scripts and immutable RC18 baseline after environment reset','previousRc19RawResultsRecovered':False,'previousRc19PassesCounted':0,'missingDefinitionMaps':[str(p.relative_to(ROOT)) for p in [node_map,application_map] if not p.is_file()]}
matrix['denominatorApproval']='协调者2026-10-07明确同意193项：192稳定ID加1项性别持久化/导入。'
matrix['definitionStage']='193项要求分母已确认；等待逐项冻结源码和最终ASAR执行绑定，无继承通过。'
write('coverage-matrix-draft.json',matrix)
write('retired-contracts.json',{'version':VERSION,'policy':'退休的是旧契约；功能保留的部分按当前定义验收。退休本身不记失败或通过。','contracts':[{'old':'旧成长控制当前等级或独立奖励成长','new':'当前学生积分与全局进阶决定等级；旧字段历史保留','ids':['N003','N005','F007','R14-03']},{'old':'每面板旧六段/七段阈值或成长模式','new':'根级统一25级费用和尾段重复规则','ids':['R006','R007']},{'old':'首次正成长即孵化或零分为LV1','new':'低于5分为蛋LV0，累计5分为LV1','ids':['N001','N002','V070']},{'old':'满级触发新毕业授章并重置新周期','new':'新毕业停用，旧毕业记录与永久荣誉保留；已有余额兑换及撤销仍可用，旧接口拒绝','ids':['N008','R009','R014','V075']},{'old':'可见卡片编辑独立成长数值','new':'只编辑名称和积分，历史隐藏字段保留','ids':['R14-02','R14-03']}]})
write('evidence-gate-plan.json',{'version':VERSION,'finalCountsReady':False,'allowedFinalInputs':['coordinator-selected frozen source runs','coordinator-selected exact final ASAR runs'],'mustReject':['historical RC18 passes relabeled RC19','development runs or pre-freeze evidence counted final','exit code 0 with zero or incomplete cases','missing completion marker, signal, renderer errors, runner error','missing or unequal expected exact case set','source/assets/QA hashes changed before versus after','missing or mismatching ASAR/runtime/dependency boundary proof','duplicate selected assertion leaf','private raw roster data'],'requiredRunFields':['runId','mode','startedAt','completedAt','expectedCases','selectedAssertions','exitCode','signal','completionMarker','sourceBefore','sourceAfter','harnessHashes','evidenceSha256','asarSha256 for package'],'retainedOutcomeTypes':['passed','failed','observed','unverified','invalid-execution','retired-contract','development-only'],'reportStructure':['验证概览','用户操作旅程','功能验收','缺陷与修复','最终断言','开发过程','范围与迁移','证据索引'],'verification':['Artifact Tool formula recalculation and exact exported XLSX reimport','formula status mutation check and every formula error scan','every worksheet representative visual review','all PDF pages rendered and visually reviewed','report content excludes raw student data and machine paths'],'releaseFormat':'full folder 7z only; no optional ZIP required'})
write('historical-group-reconciliation-draft.json',{'version':VERSION,'baselineManifestSha256':sha(BASE/'artifacts/rc18/final-test-manifest.json'),'baselineGroupCount':len(manifest['groups']),'groups':[{'baselineMode':g['mode'],'baselineGroup':g['group'],'category':g['category'],'oldPassesForReferenceOnly':g['passed'],'currentDisposition':'待冻结运行或有理由退休','currentEvidence':None} for g in manifest['groups']]})
print(json.dumps({'requirementsProposed':len(requirements),'rewrittenDefinitions':len(DEFINITIONS),'journeys':len(journeys),'windowsUnverified':len(matrix['windowsIds']),'historicalGroups':len(manifest['groups']),'finalPasses':0}))
