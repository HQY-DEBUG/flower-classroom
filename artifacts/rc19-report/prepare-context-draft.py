"""Prepare narrative and exact expected bindings, never final execution claims."""
from pathlib import Path
import hashlib
import json

ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
bindings=read(OUT/'proposed-current-bindings.json');matrix=read(OUT/'coverage-matrix-draft.json')
complaints=[
 {'id':'C19-01','topic':'当前积分与显示等级','sourceLibraryId':'libfile_d43a4afc7f84819194e7ddd1e7763dd2','observation':'用户指出截图中的当前积分与显示等级不符合希望的规则','journeyIds':['J19-01','J19-02','J19-03'],'kind':'用户要求的规则变更','status':'待最终旅程复验'},
 {'id':'C19-02','topic':'旧版模式字样','sourceLibraryId':'libfile_5131e1f449448191950f2a714abbca07','observation':'用户希望界面与配置统一使用当前积分进阶，不再混用旧成长模式说明','journeyIds':['J19-04','J19-05'],'kind':'用户要求的统一语义','status':'待最终旅程复验'},
 {'id':'C19-03','topic':'配置中的系统ID列','sourceLibraryId':'libfile_b238d6c3e44c8191a5614fd62bc6746a','observation':'用户希望填写配置时隐藏系统ID并自动处理新行ID','journeyIds':['J19-06'],'kind':'配置易用性要求','status':'待最终旅程复验'},
 {'id':'C19-04','topic':'批量分组缺少直接新建','sourceLibraryId':'libfile_cbbfedbdfc5481919866489e99af7fc4','observation':'用户希望选中学生批量分组时直接新建组并一次分配','journeyIds':['J19-07'],'kind':'用户要求新增操作路径','status':'待最终旅程复验'},
 {'id':'C19-05','topic':'Microsoft Defender SmartScreen阻止','sourceLibraryId':'libfile_4456ba1a10548191a7a089281186d6a7','observation':'截图确认系统阻止未识别应用，但未显示可核对的EXE名称、发布者或版本；已交付RC18的PE证书表为空','journeyIds':[],'kind':'系统发布限制','status':'未解决','limit':'本轮未做签名或信誉修复。应用通过运行检查不能证明系统警告解决。'}
]
journeys=bindings['journeyBindings']
byid={j['id']:j for j in matrix['journeys']}
for rid,j in journeys.items():
    related=[c for c in complaints if rid in c['journeyIds']]
    j['complaint']='；'.join(c['id']+' '+c['observation'] for c in related) or '本轮用户要求及其完整保存、取消、恢复路径'
    j['steps']=byid[rid]['expected']
    j['before']='用户截图仅证明对应的界面反馈或问题背景；不将截图直接当作本次受控修前复现。'
    j['limits']='公开画面和流程使用合成资料；本项实际源码及最终ASAR证据独立绑定，Windows实机仍未验证。'
journeys['J19-08']['before']='开发运行确实出现性别已选男而保存后为空，且保留了renderer错误；原始失败结果和修前app.js已保留，最终复验尚待绑定。'
journeys['J19-10']['before']='开发过程发现旧RC18待处理配置收据的升级恢复和清空课堂旧API调用问题；保留原始失败、合成旧版收据与修复过程，最终源码/ASAR须分别复验。'
ctx={'version':'1.3.0-rc.19','coordinatorFinalIdentityConfirmed':False,'confirmedAsarSha256':None,'reportLabel':'RC19 当前积分、配置和用户旅程完整复核','releaseGate':'等待协调者完成并明确选定冻结源码与最终ASAR证据；当前不作最终通过结论。','configurationScope':'根目录配置.xlsx是唯一活动配置工作簿。所有面板共享计分卡和全局当前积分进阶；系统ID隐藏，新有效行留空ID时自动生成。宠物进阶显示25行费用及累计门槛和尾段重复规则，各面板其他设置清楚选择、独立保存。','configurationMigrationNote':'旧RC18分面板成长配置与精确待处理收据必须经当前兼容流程校验、整本预览和明确确认。旧原文件、学生积分、成长历史、毕业快照和永久荣誉保留；旧配置不静默成为新的活动规则。','upgradeNote':'等待最终迁移路径与精确ASAR验证完成后定稿。','requirementBindings':bindings['requirementBindings'],'journeyBindings':journeys,'complaints':complaints,'evidenceFiles':['artifacts/rc19/smartscreen-diagnosis.json','artifacts/rc19/inherited-regression-contract-map.json','artifacts/rc19/inherited-application-case-migrations.json','artifacts/rc19-report/exact-binding-replacements.json'],'screenshots':[],'developmentRuns':[],'qaNotes':[{'id':'Q19-01','title':'分组和侧栏测试入口修正','actual':'早期px-batch侧栏选择器失败不是缺失renderer的证据，因为该侧栏本来没有此入口。之后使用可见pet-reward和pet-manage-reasons操作。另一次源文件中缺少petFloatingView的回归被独立发现并恢复，不能混为同一个复现。','evidence':'artifacts/rc19/secondary-pet-ui/implementation-findings.json'},{'id':'Q19-02','title':'低于产品最小宽度的显示窗测试','actual':'将独立课堂显示窗强制设为280px超出产品支持的700×580最小尺寸，该结果不作为受支持界面的产品失败。实际300px最小悬浮侧栏和支持的200%缩放另行验证，旧无效结果保留。','evidence':'artifacts/rc19/secondary-pet-ui/implementation-findings.json'},{'id':'Q19-03','title':'毕业和徽章边界','actual':'本轮明确不启用新毕业，旧毕业快照和永久荣誉保留。原来已验证的徽章余额兑换及其撤销仍可用，不能把全部钱包描述成只读。','evidence':'artifacts/rc19-report/retired-contracts.json'}]}
devpaths=[
 ('artifacts/rc19/node-current-closure-20261007T123942Z.json','D19-NODE','冻结前827条Node开发闭环','product','observed','冻结前开发结果，只作过程；不计最终通过'),
 ('artifacts/rc19/current-score-journeys/previous-1791375545664/results.json','D19-GENDER','修前性别保存与空输入事件失败','product','failed','真实开发失败；等待最终源码及ASAR复验'),
 ('artifacts/rc19/current-score-journeys/previous-1791376438848/results.json','D19-PALETTE','高等级用例未先关闭升级提示','harness','invalid-execution','工具入口被未关闭的反馈层影响；修正操作顺序后重跑，不视为新产品缺陷'),
 ('artifacts/rc19/secondary-pet-ui/previous-1791374503356/results.json','D19-SIDEBAR','错误侧栏入口与低于支持尺寸的运行','harness','invalid-execution','选择器和产品窗口种类不匹配；此运行不证明renderer功能缺失'),
]
for file,rid,title,classification,outcome,actual in devpaths:
    path=ROOT/file
    if path.is_file():ctx['developmentRuns'].append({'id':rid,'file':file,'sha256':sha(path),'title':title,'classification':classification,'version':'1.3.0-rc.19 未发布开发过程','scope':'冻结前开发/诊断，不计最终','outcome':outcome,'actual':actual})
(OUT/'final-context-draft.json').write_text(json.dumps(ctx,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'journeys':len(journeys),'complaints':len(complaints),'developmentReferences':len(ctx['developmentRuns']),'finalIdentityConfirmed':False}))
