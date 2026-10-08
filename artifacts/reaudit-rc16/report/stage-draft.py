"""Draft the report data model from explicitly selected new diagnostic evidence."""
import datetime, json
from pathlib import Path
D=Path(__file__).resolve().parent;ROOT=D.parents[2]
identity=json.loads((D/'baseline-delivery-identity.json').read_text())
context={
 'finalized':False,'version':'1.3.0-rc.17',
 'reportLabel':'RC17 再次全面复核','reportSlug':'1.3.0-rc.17_20261007',
 'reportManifestName':'RC17-REPORT-MANIFEST.json',
 'auditNotBefore':identity['auditNotBefore'],
 'baselineArchiveSha256':identity['archiveSha256'],'baselineAsarSha256':identity['asarSha256'],
 'baselineSourceProvenance':'从用户实际已交付RC16目录7z重新提取app.asar，核对SHA256。源码采用与该ASAR逐文件一致的RC16审查副本。本轮仅使用03:12 UTC之后的新运行证据。',
 'coordinatorFinalIdentityConfirmed':False,'runs':[],'findings':[],
 'independentReviews':[],'developmentRuns':[],
 'releaseGate':'复核进行中：已确认新边界问题；等待修复、最终冻结回归和独立复核，当前不能作为交付通过结论。',
 'auditSummary':'保留190项既有要求，重新执行标准回归，并独立检查计分卡事务、迁移预览、导入快照及课堂跨窗口操作。修前实际失败、脚本问题、环境失败与最终通过分别保存。',
 'upgradeNote':'先关闭旧版并备份整个旧程序文件夹。新版须解压到新的可写文件夹，勿以空白发行包覆盖旧资料。显式迁移复制课堂资料、相关头像和计分卡工作簿；不会自动复制旧根目录配置.txt或整个备份文件夹。若修改过配置，完全关闭新版后另行复制配置.txt；旧备份留在原目录。核对并重启后仍保留旧目录和整目录备份。',
 'requirementOverrides':{},'qaNotes':[],'screenshots':[],'evidenceFiles':[
  'artifacts/reaudit-rc16/report/coverage-matrix-draft.json',
  'artifacts/reaudit-rc16/baseline.json',
  'artifacts/reaudit-rc16/baseline-source-fingerprint.json'],
}
def add(id,title,file,scope,classification='product',**other):
 if not(ROOT/file).is_file():return
 context['developmentRuns'].append(dict(id=id,title=title,file=file,scope=scope,
  version='1.3.0-rc.16 已交付原ASAR诊断',frozenEvidence=False,
  classification=classification,**other))
add('RC16-DIAG-RULES','计分卡跨操作事务新边界','artifacts/reaudit-rc16/rules/module-results.json','RC16精确ASAR模块')
add('RC16-DIAG-CLASSROOM','宠物抽取奖励与跨窗口边界','artifacts/reaudit-rc16/classroom/pet-draw-boundaries/audit-results.json','RC16精确ASAR Linux Electron',checkClassifications={'Escape cancels pending graduation confirmation without mutation':'harness'})
add('RC16-DIAG-CLASSROOM-RESTART','宠物奖励重启状态','artifacts/reaudit-rc16/classroom/pet-draw-boundaries/restart-results.json','RC16精确ASAR Linux Electron重启')
add('RC16-DIAG-MIGRATION','迁移预览和完整文件夹副本','artifacts/reaudit-rc16/migration/interactions/results.json','RC16精确ASAR Electron模块')
add('RC16-DIAG-IMPORTS','导入、备份及头像快照跨操作','artifacts/reaudit-rc16/imports/original/results.json','RC16精确ASAR Linux Electron')
add('RC16-DIAG-MIGRATION-IPC','实际迁移IPC确认快照不一致','artifacts/reaudit-rc16/migration/preview-main/preview-result.json','RC16精确ASAR Linux Electron')
add('RC16-DIAG-MIGRATION-RESTART','实际迁移后重启确认工作簿不一致','artifacts/reaudit-rc16/migration/preview-main/restart-result.json','RC16精确ASAR Linux Electron重启')
add('RC16-DIAG-MIGRATION-V1','真实旧版迁移日志继续搬移恢复','artifacts/reaudit-rc16/migration/authentic-journals/results.json','RC16精确ASAR Electron模块')
add('RC16-DIAG-CLASSROOM-ABA','抽取结果重复后的旧请求和丢失响应','artifacts/reaudit-rc16/classroom/draw-aba-boundaries/audit-results.json','RC16精确ASAR Linux Electron',checkClassifications={'Pet students identical remote redraw offers a fresh reward after reopening':'harness','Pet groups identical remote redraw offers a fresh reward after reopening':'harness'})
add('RC16-DIAG-CLASSROOM-ABA-RESTART','相同抽取结果边界后的真实重启','artifacts/reaudit-rc16/classroom/draw-aba-boundaries/restart-results.json','RC16精确ASAR Linux Electron重启')
add('RC16-DIAG-CLASSROOM-STRICT','旧宠物奖励在任何抽取重置后的严格边界','artifacts/reaudit-rc16/classroom/pet-draw-strict-boundaries/audit-results.json','RC16精确ASAR Linux Electron')
add('RC16-DIAG-CLASSROOM-STRICT-RESTART','严格宠物奖励矩阵后的重启','artifacts/reaudit-rc16/classroom/pet-draw-strict-boundaries/restart-results.json','RC16精确ASAR Linux Electron重启')
add('RC16-DIAG-CLASSROOM-IDENTICAL-UI','跨窗口同结果新抽取的奖励入口','artifacts/reaudit-rc16/classroom/draw-identical-ui/audit-results.json','RC16精确ASAR Linux Electron')
add('RC16-DIAG-CLASSROOM-IDENTICAL-RESTART','跨窗口相同抽取结果后的重启','artifacts/reaudit-rc16/classroom/draw-identical-ui/restart-results.json','RC16精确ASAR Linux Electron重启')
add('RC16-DIAG-MIGRATION-SNAPSHOTS','迁移快照在六种保存交错下的原版表现','artifacts/reaudit-rc16/migration/baseline-snapshot-cases/results.json','RC16原版源码 Node模块')
context['qaNotes'].extend([
 dict(id='HARNESS-RULES',title='计分卡测试初始准备错误',actual='初始辅助函数错误假定全部状态都含panels，准备阶段退出。仅修正测试辅助函数后10个实际模块场景通过。此错误不是产品缺陷，也不计最终通过。',evidence='artifacts/reaudit-rc16/rules/module-harness-setup-error.log'),
 dict(id='HARNESS-CLASSROOM',title='退出键测试原始预期错误',actual='原始22条课堂检查中，一条退出键用例失败是脚本预期错误：第一个Escape正确关闭尚未消失的升级反馈，第二个才关闭毕业确认。原始失败保留，后续独立矩阵的双Escape取消已通过。其余5条初始失败属于过期宠物抽取奖励问题。',evidence='artifacts/reaudit-rc16/classroom/pet-draw-boundaries/audit-results.json\nartifacts/reaudit-rc16/classroom/draw-aba-boundaries/audit-results.json'),
 dict(id='HARNESS-CLASSROOM-ABA',title='跨窗口抽取测试导航遮挡',actual='重复抽取矩阵有两条界面用例因升级反馈遮住入口而导航失败，属于测试准备问题。修正导航后，独立界面矩阵确认同结果新抽取确有两个产品界面失败，作为D01证据另列。24条事务断言、双Escape取消及重启检查分别保留。',evidence='artifacts/reaudit-rc16/classroom/draw-aba-boundaries/audit-results.json\nartifacts/reaudit-rc16/classroom/draw-identical-ui/audit-results.json'),
])
(D/'working-context.json').write_text(json.dumps(context,ensure_ascii=False,indent=2))
print(json.dumps({'diagnosticRuns':len(context['developmentRuns']),'finalRuns':0,'context':str(D/'working-context.json')}))
