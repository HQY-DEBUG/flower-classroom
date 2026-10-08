"""Add confirmed unpublished-candidate defects without assigning final passes."""
from pathlib import Path
import hashlib
import json
import re
import ast
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
def read(p):return json.loads(p.read_text())
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def both(names):return {'source':names,'package':names}
matrix=read(OUT/'coverage-matrix-draft.json');context=read(OUT/'final-context-draft.json')
live_all=ast.literal_eval(re.search(r'const expectedCases\s*=\s*(\[[\s\S]*?\]);',(ROOT/'scripts/qa-rc19-pet-draw-live.cjs').read_text()).group(1))
live_names=live_all[:4]
adopt_names=live_all[4:]
badge_names=re.findall(r"test\('([^']+)'",(ROOT/'tests/pet-badge-verification-rc19.test.cjs').read_text())
assert len(live_names)==4 and len(adopt_names)==3 and len(badge_names)==7
journey={'id':'J19-11','title':'宠物抽取结果实时同步等级并保留输入','requirementIds':['R008','N009','V059','R18-02'],'expected':'宠物抽取结果打开后，在另一真实窗口加减积分或修改全局进阶，抽取结果中的等级和造型立即更新；输入框、尚未提交分值、焦点、滚动和已经奖励状态保持，不重新抽取或重复奖励。','status':'未验证','sourceEvidence':'','packageEvidence':''}
matrix['journeys']=[j for j in matrix['journeys'] if j['id']!='J19-11']+[journey]
context['journeyBindings']['J19-11']={'exactAssertions':both(live_names),'complaint':'独立完整操作发现RC19-DRAW-02：打开的抽取结果在其他窗口计分后保留旧等级与造型。','steps':'抽取并保留待提交分值；通过另一真实窗口加1、改变全局阈值和扣分/撤销，核对结果卡，同时检查焦点、滚动和已奖励状态；提交剩余草稿一次，重新打开核对。','before':'重置前曾观察到未发布ASAR的抽取结果未同步当前等级；原始失败日志和截图已丢失。已恢复真实修前代码，若重新复现，必须记录恢复后的实际新执行时间。','limits':'此前通过均不进入最终数；所有最终源码与ASAR结果必须恢复后重新执行。Windows实机仍未执行。'}
for mode in ['source','package']:context['journeyBindings']['J19-09']['exactAssertions'][mode]=list(dict.fromkeys(context['journeyBindings']['J19-09']['exactAssertions'][mode]+adopt_names))
context['journeyBindings']['J19-09']['before']='原始新毕业停用和旧记录保留要求继续有效。独立发现RC19-ADOPT-03：未领养详情按钮事件名与分发器不一致，点击没有反应；原始点击失败记录已丢失，恢复后将用真实修前快照重新复现。'
for row in matrix['requirements']:
    if row['id']=='R015':
        row.update(title='已核实徽章余额兑换与旧荣誉保护',expected='已有可验证余额继续支持兑换和撤销，总荣誉及毕业快照保持；未知历史余额不能因自动启用、领养、换宠、抽取、分组、积分操作或重启而变成可兑换余额。未知余额直接兑换/撤销必须原子拒绝。历史相册、荣誉卡导出及原有取消/重复/超额保护保留。',definitionChangedIn='RC19',bindingRevisionReason='RC19-BADGE-01修复未知历史奖章被自动转换成可兑换余额；原有已验证钱包及其兑换/撤销仍保留。')
        context['requirementBindings']['R015']={'reason':row['bindingRevisionReason'],'exactAssertions':both(list(dict.fromkeys(row['expectedExactAssertions']['source']+badge_names)))}
for rid in ['N009','R008','V059','R18-02']:
    context.setdefault('additionalRequirementAssertions',{}).setdefault(rid,{})
    for mode in ['source','package']:context['additionalRequirementAssertions'][rid][mode]=live_names
for file,rid,title in [('artifacts/rc19/review-badge-balance-before.json','D19-BADGE','未知历史徽章错误变为已知可兑换余额'),('artifacts/rc19/pet-draw-live-before-clean/results.json','D19-DRAW','精确未发布ASAR抽取结果等级未实时更新')]:
    context['developmentRuns']=[r for r in context['developmentRuns'] if r['id']!=rid]
    if (ROOT/file).is_file():context['developmentRuns'].append({'id':rid,'file':file,'sha256':sha(ROOT/file),'title':title,'classification':'product','version':'1.3.0-rc.19 未发布候选','scope':'独立修前复现，不计最终','outcome':'confirmed-defect','actual':'保留修前真实失败或错误状态；最终闭环须独立绑定源码和ASAR。'})
def before(file,pointer,equals):
    if not (ROOT/file).is_file():return None
    return {'file':file,'sha256':sha(ROOT/file),'pointer':pointer,'equals':equals}
badge_file='artifacts/rc19/review-badge-balance-before.json';draw_file='artifacts/rc19/pet-draw-live-before-clean/results.json'
findings=[
 {'id':'RC19-BADGE-01','title':'未知历史徽章不能自动成为可兑换余额','expected':'旧荣誉保持；未经证实的余额继续未知并拒绝兑换。已有明确余额钱包仍能兑换/撤销。','steps':'合成档案带5枚历史奖章且余额未知，执行宠物抽取，再尝试兑换5枚。','beforeSummary':'修前未知余额在自动建账后变为已知5枚，随后成功兑换；这一状态转换没有余额证据。','rootCause':'自动建立旧宠物账户时缺少余额验证状态，显示与兑换逻辑将历史荣誉当成已核实余额。','fix':'保留可选badgeBalanceVerified=false标记，未知余额经各入口和持久化均保持未知，并拒绝兑换/撤销；已验证钱包行为保留。','before':[before(badge_file,'/profiles/before/known',False),before(badge_file,'/profiles/afterDraw/known',True),before(badge_file,'/profiles/afterRedeem/available',0)],'afterAssertions':{'source':badge_names,'packaged':badge_names},'status':'等待最终源码及ASAR复验'},
 {'id':'RC19-DRAW-02','title':'打开的宠物抽取结果未同步当前等级','expected':journey['expected'],'steps':context['journeyBindings']['J19-11']['steps'],'beforeSummary':'精确未发布ASAR修前4条界面旅程中3条失败；外部加分、规则编辑、扣分撤销后，打开的抽取结果仍显示旧等级和造型。','rootCause':'已打开抽取结果的界面保留旧宠物展示事实，没有在状态通知时更新等级和图片。','fix':'仅刷新宠物结果的当前事实，保留输入控件、分值草稿、焦点、滚动、抽取事件身份和已奖励状态。','before':[before(draw_file,'/checks/'+str(i)+'/status','failed') for i in range(3)],'afterAssertions':{'source':live_names,'packaged':live_names},'status':'等待最终源码及ASAR复验'}
]
findings.append({'id':'RC19-ADOPT-03','title':'未领养详情中的领养按钮无响应','expected':'点击可见领养伙伴按钮后打开选择器；取消不写，提交按已有当前积分显示等级，历史毕业快照与徽章保留。','steps':'打开未领养学生的宠物详情，真实点击领养伙伴；取消和提交分别检查当前积分、历史记录与显示。','beforeSummary':'重置前在未发布ASAR中观察到真实原生点击后无响应；原始失败记录已丢失，尚未绑定恢复后的新复现。','rootCause':'未领养分支发出的pet-adopt事件名与分发器接受的adopt-pet不一致。','fix':'统一可见按钮与事件分发名称，保留领养、取消、已毕业档案再领养和数值等级/视觉造型边界。','before':[],'afterAssertions':{'source':adopt_names,'packaged':adopt_names},'status':'等待恢复后修前复现及最终源码/ASAR复验'})
for finding in findings:
    finding['before']=[v for v in finding['before'] if v is not None]
    finding['originalBeforeEvidenceStatus']='lost-after-environment-reset'
    finding['beforeEvidenceRule']='原始日志未恢复。新的修前复现只能来自已恢复的真实修前代码，必须使用恢复后的实际执行时间，不冒充原始日志。'
    finding['status']='等待恢复后修前复现及最终源码/ASAR复验'
context['evidenceFiles']=[f for f in context['evidenceFiles'] if (ROOT/f).is_file()]
context['evidenceLoss']={'originalRc19ExecutionArtifacts':'lost','previousRc19PassesCounted':0,'finalValidationRule':'All final source and ASAR runs must be freshly executed after recovery','preFixCodeRecovered':True,'originalRawFailureLogsRecovered':False}
context['qaNotes']=[q for q in context['qaNotes'] if q['id']!='Q19-RECOVERY']+[{'id':'Q19-RECOVERY','title':'执行环境重置造成原始证据丢失','actual':'执行环境重置后，真实代码检查点及RC18基线已恢复，但此前RC19运行日志、失败截图和报告JSON未恢复。此前报告的通过不计最终；本轮最终通过须全部重新执行。真实修前代码可用于新复现，新记录采用恢复后的实际时间，不能冒充原始证据。','evidence':'协调者核对的恢复记录；原始RC19失败文件仍记丢失'}]
for q in context['qaNotes']:
    if q.get('evidence','').startswith('artifacts/') and not (ROOT/q['evidence']).is_file():q['evidence']='原始说明文件未恢复；仅保留此前已确认的过程事实，等待新执行证据'
write(OUT/'coverage-matrix-draft.json',matrix);write(OUT/'final-context-draft.json',context)
write(OUT/'independent-findings-draft.json',{'version':'1.3.0-rc.19','finalized':False,'findings':findings,'scope':'Coordinator-confirmed unpublished-candidate defects; exact after-assertion names are expected bindings only, not final results.'})
print(json.dumps({'requirements':len(matrix['requirements']),'journeys':len(matrix['journeys']),'newConfirmedDefects':len(findings),'finalPassesAssigned':0}))
