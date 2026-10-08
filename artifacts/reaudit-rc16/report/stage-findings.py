"""Capture confirmed defects; final closure depends only on later frozen reruns."""
import json,re
from pathlib import Path
D=Path(__file__).resolve().parent;ROOT=D.parents[2]
exact=lambda s:'^'+re.escape(s)+'$'
rows=[
 dict(id='RC17-D01',module='普通及宠物抽取与跨窗口奖励',title='抽取已重置或替换后，旧奖励仍可能提交',
  requirementIds=['V047','R008','V073'],severity='中',
  expected='随机奖励只作用于仍然有效的本轮抽取。重置、替换抽取或改变相关小组成员后，旧请求须拒绝且不改成长和历史。已完成请求重试不重复奖励。',
  steps='窗口A准备宠物随机奖励并延迟提交；窗口B重置抽取、开始新抽取或改变分组；再释放A的旧请求，核对成长、日志、重复响应和重启结果。',
  before='RC16严格宠物矩阵确认6条过期奖励失败、15条对照通过；重复结果事务矩阵确认3条普通点名和8条宠物错误接受旧奖励、13条对照通过；独立界面矩阵另确认学生和小组在远端重新抽到相同结果后仍显示已奖励。各轮真实重启通过。矩阵存在重叠，不相加为独立功能或缺陷数。初始脚本预期及导航错误另列并保留原始结果。',
  beforeEvidence='artifacts/reaudit-rc16/classroom/pet-draw-boundaries/audit-results.json\nartifacts/reaudit-rc16/classroom/draw-aba-boundaries/audit-results.json\nartifacts/reaudit-rc16/classroom/pet-draw-strict-boundaries/audit-results.json\nartifacts/reaudit-rc16/classroom/draw-identical-ui/audit-results.json',
  rootCause='最终原因及普通点名ABA影响等待修复后独立复核确认。',fix='等待RC17修复说明与冻结版本复验。',
  patterns=[exact(s)for s in ['students pet reward queued before pet-reset','students pet reward queued before overlapping-new-pet-draw','groups pet reward queued before pet-reset','groups pet reward queued before overlapping-new-pet-draw','groups pet reward queued before group-assignment']],
  limits='合成学生、两窗口Linux Electron和真实ASAR；不代表Windows实机。首轮Escape原始失败按测试预期问题分类，未计为第六项产品缺陷。'),
 dict(id='RC17-D02',module='明确迁移旧资料',title='旧版保存恰逢迁移预览时，课堂快照和生成工作簿不一致',
  requirementIds=['R15-14'],severity='中',
  expected='预览摘要、待迁移课堂文件和生成工作簿必须来自同一份已核验快照。来源在准备过程中改变应安全拒绝或重读为完整一致的预览。',
  steps='在读取旧课堂JSON后、生成来源清单前模拟旧版保存增加面板；确认迁移并核对预览面板、迁入课堂、工作簿面板及解析结果。',
  before='实际RC16 ASAR模块接受迁移，预览和生成工作簿仍为旧的一面板，迁入课堂已为新的两面板，工作簿校验失败。9个模块场景中8通过、1失败；随后真实主进程、预加载与渲染端IPC重现同一问题，实际重启后工作簿刷新仍拒绝新增面板。',
  beforeEvidence='artifacts/reaudit-rc16/migration/interactions/results.json\nartifacts/reaudit-rc16/migration/interactions/fixtures/source-preview-coherence/observed.json\nartifacts/reaudit-rc16/migration/preview-main/preview-result.json\nartifacts/reaudit-rc16/migration/preview-main/restart-result.json',
  rootCause='课堂解析快照与后续文件清单读取跨越旧版保存，二者可能引用不同内容。',fix='等待RC17一致快照修复与冻结复验。',
  patterns=[exact('source changes between classroom validation and preview inventory cannot create a stale confirmed workbook')],
  limits='实际ASAR模块及完整Linux Electron IPC/真实重启，合成旧资料与确定性保存交错；Windows未验证。显式迁移不复制旧根配置.txt或整份备份文件夹，旧目录保留。'),
 dict(id='RC17-D03',module='计分卡事务恢复提示',title='事务已成功清理，启动时的待清理提示仍然显示',
  requirementIds=['R14-11'],severity='低',
  expected='后续成功操作完成事务回执核对与清理后，界面应清除旧的临时恢复警告，准确显示当前状态。',
  steps='启动时注入一次事务记录清理失败，打开计分卡得到临时警告；恢复I/O并成功修改班级名；重新取得计分卡状态，核对回执不存在且警告为空。',
  before='RC16原生主进程和预加载IPC共10条断言中9通过、1失败。改名已成功保存且回执已删除，但仍返回“规则已保存，事务记录暂未清理…”旧提示。没有发现由此引起的数据修改或丢失。',
  beforeEvidence='artifacts/reaudit-rc16/rules/native-results.json\nartifacts/reaudit-rc16/rules/native-warning-recovery-evidence.json\nartifacts/reaudit-rc16/rules/native-warning-recovery.log',
  rootCause='启动期间缓存的临时清理警告在后续成功核对后没有同步清除。',fix='等待清理缓存警告的RC17修复和独立冻结复验。',
  patterns=[exact('Successful native class rename clears a startup cleanup warning after that receipt has been reconciled')],
  limits='低严重度状态提示问题；原始数据和事务恢复另有通过记录。只覆盖合成文件故障与Linux Electron，不是Excel/WPS原生占用测试。'),
]
selected=[]
for path in ['artifacts/reaudit-rc16/classroom/pet-draw-strict-boundaries/audit-results.json','artifacts/reaudit-rc16/classroom/draw-aba-boundaries/audit-results.json','artifacts/reaudit-rc16/classroom/draw-identical-ui/audit-results.json']:
    p=ROOT/path
    if p.is_file():
        for c in json.loads(p.read_text())['checks']:
            if c['status']=='failed' and not(path.endswith('draw-aba-boundaries/audit-results.json')and c['name'].startswith('Pet ')):
                selected.append(c['name'])
if selected:rows[0]['patterns']=[exact(s)for s in dict.fromkeys(selected)]
(D/'findings-draft.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
ctx=json.loads((D/'working-context.json').read_text());ctx['findings']=rows
ctx['developmentRuns'].append(dict(id='RC16-DIAG-RULES-NATIVE',title='原生计分卡IPC与真实重启',file='artifacts/reaudit-rc16/rules/native-results.json',scope='RC16精确ASAR Linux Electron',version='1.3.0-rc.16 已交付原ASAR诊断',frozenEvidence=False,classification='product'))
ctx['qaNotes'].append(dict(id='HARNESS-RULES-NATIVE',title='原生审查脚本文件接口调整',actual='最初重启准备脚本把Electron虚拟ASAR路径当作普通文件读取，脚本失败。改用原始文件接口并在新建合成目录重跑；原始脚本错误单列，不算产品缺陷。',evidence='artifacts/reaudit-rc16/rules/native-initial-harness-error.json'))
(D/'working-context.json').write_text(json.dumps(ctx,ensure_ascii=False,indent=2))
print(json.dumps({'confirmedFindingGroups':len(rows),'status':'Awaiting final fix and reruns'}))
