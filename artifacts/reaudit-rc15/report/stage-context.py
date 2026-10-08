"""Prepare final report context from verified fresh reviews; release readiness is explicit."""
import hashlib,json,sys
from pathlib import Path
D=Path(__file__).resolve().parent;ROOT=D.parents[2]
read=lambda p:json.loads(Path(p).read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
ctx=read(D/'working-context.json');findings=read(D/'findings-draft.json');audit=read(ROOT/'artifacts/rc16/reaudit-final-runs.json')
ctx.update(coordinatorFinalIdentityConfirmed='--final-ready'in sys.argv,confirmedAsarSha256=sha(ROOT/'dist-rc16-final/win-unpacked/resources/app.asar'),asarPath='dist-rc16-final/win-unpacked/resources/app.asar',findings=findings)
ctx['releaseGate']='本轮确认的六类产品缺陷已修复，并在最终源码和精确RC16 ASAR重新验证。190项既有要求按新证据重算；9项Windows现场效果仍未验证。覆盖范围内没有未关闭的已确认产品缺陷，不能据此承诺未测试平台或所有可能组合均无缺陷。'
ctx['upgradeNote']='关闭全部旧版窗口，先复制整个RC15程序文件夹留作备份。把RC16解压到新的可写文件夹，勿以空白发行包覆盖旧资料。启动新版，在班级设置中依次点击“查看文件夹与迁移旧版数据”→“从旧版数据文件夹迁移”，选择旧RC15目录中的“数据”子目录，核对预览及关联资源后确认。迁移复制课堂资料、已保存头像及关联头像目录和计分卡片表格；核对名单、积分、宠物、历史和头像后重启。迁移不会自动复制旧根目录的配置.txt或整个备份文件夹。若修改过启动配置，完全关闭新版后再复制旧配置.txt；旧备份继续留在原目录，无需合并。完成核验后仍保留旧目录及整目录备份。'
ctx['requirementOverrides']={}
closure=read(ROOT/'artifacts/rc16/reaudit-findings-closure.json')
for finding in closure['findings']:
    for id in finding['requirementIds']:
        addition=ctx['requirementOverrides'].setdefault(id,{'additionalExactBindings':{'source':[],'package':[]}})['additionalExactBindings']
        for scope,mode in [('source','source'),('package','packaged')]:
            addition[scope]=list(dict.fromkeys(addition[scope]+finding['afterAssertions'][mode]))
reviews=[
 ('REVIEW-AVATAR','头像、名单与批量照片','avatars','对最终源码执行10项集中验证；精确ASAR执行同10项和37项广泛头像/名单流程，共57项通过。覆盖三种同ID恢复竞态、并发照片和计分、保存失败重试、300/301人边界、120张素材、模板和跨进程搬移。','artifacts/rc16-independent-review/avatars-final/REPORT.md'),
 ('REVIEW-WORKBOOK','计分卡、配置及旧回执恢复','workbook','源码和精确ASAR各27项，共54项通过。覆盖启动11项、事务回执6项、原生编辑冲突6项、显式重建4项；旧歧义回执保留并可审阅后重建。','artifacts/rc16-independent-review/workbook-final/FINAL-REPORT.md'),
 ('REVIEW-MIGRATION','迁移中断、日志和完整目录搬移','migration','源码和精确ASAR各36项，共72项通过。覆盖18项组合、14项设置失败与旧日志兼容，以及4项真实主进程启动。二次发现的目录准备重试遗漏已保留失败记录并复验。','artifacts/rc16-independent-review/migration-final/final-rerun-envelope.json'),
 ('REVIEW-INTERACTIONS','点名、宠物与跨窗口交互','interactions','源码和精确ASAR各126项，共252项通过。每层含22项集中点名及1项重启、40种伙伴独立断言与14项UI边界及1项重启、48项下限/撤销组合。','artifacts/rc16-independent-review/interactions-final/REPORT.md'),
]
ctx['independentReviews']=[dict(id=id,title=title,actual=actual,evidence=evidence,limits='仅合成资料。真实Linux Electron及包内模块证据按各测试层解释；原生Windows、实体显示/触控、真实Excel/WPS占用和断电行为未验证。')for id,title,domain,actual,evidence in reviews]
ctx['qaNotes']=[
 dict(id='QA-BASELINE-24',title='已交付RC15标准回归仍可通过',actual='本轮对重新提取的原RC15 ASAR执行24组标准打包回归，执行退出均成功；独立编写的新边界组合仍发现六类缺陷。这24组是本轮诊断，不代表RC16最终通过，也不排除未覆盖的组合。',evidence='artifacts/reaudit-rc15/packaged-runs.json'),
 dict(id='QA-DIAGNOSTIC',title='成功复现缺陷不算产品通过',actual='部分原RC15模块诊断用断言确认错误行为，因此检查断言可显示通过。所有修前/修中记录列在诊断阶段，均从最终通过计数排除。启动和回执原始观察没有自带断言状态，报告保留为仅观察。',evidence='artifacts/reaudit-rc15/workbook/REPORT.md'),
 dict(id='QA-D03-ITERATION',title='D03二次复核发现额外重试遗漏',actual=next(f['repairIterationNote']for f in findings if f['id']=='RC16-D03'),evidence='artifacts/rc16-independent-review/migration-supplement/results.json'),
 dict(id='QA-ATTEMPTS',title='未完成执行与脚本错误保留',actual='初始源码标准回归部分原生测试停滞后中止，保留原结果并完整重跑26组；不采用部分初始结果补齐通过。继承目录专项也保留未完成初始执行，之后隔离重跑。工作簿首次打包专项因纯Node读取ASAR内部路径的ENOTDIR元数据错误停止，零断言未计入通过。交互首次打包矩阵超时且重启缺少夹具，后续相同测试通过；没有确定超时根因。另保留包内Node子进程超时与7z空间不足后的重试记录，不把这些执行问题当作运行时数据丢失或新产品缺陷。',evidence='artifacts/rc16/harness-history/source-initial\nartifacts/rc16/harness-history/resource-pressure\nartifacts/rc16-independent-review/workbook-final/execution-envelope.json\nartifacts/rc16-independent-review/interactions-final/initial-execution-envelope.json'),
 dict(id='QA-TIMES',title='基线未记时间不重建',actual='部分原RC15独立基线未记录精确开始和完成时间，表中标记原日志未记录；不使用文件时间冒充。最终证据使用各执行原本记录的时间，汇总创建时间单独保存。',evidence='artifacts/rc16/reaudit-final-runs.json')]
dev=[
 ('baseline-avatar-focused','avatars/batch-boundaries-baseline/results.json','批量照片恢复竞态',False),
 ('baseline-avatar-wide','avatars/verified-baseline/results.json','头像名单广泛流程',False),
 ('baseline-draw-focused','interactions/draw-matrix-rc15/audit-results.json','点名奖励集中复现',False),
 ('baseline-interactions','interactions/audit-results.json','跨功能广泛流程',False),
 ('baseline-floors','interactions/floor-model-results.json','成长下限撤销组合',False),
 ('baseline-migration','migration/validated-baseline/results.json','迁移及搬移组合',False),
 ('baseline-workbook-modules','workbook/module-results.json','计分卡模块诊断',False),
 ('baseline-workbook-ui','workbook/interaction-results.json','计分卡实际界面交互',False),
 ('baseline-workbook-boot','workbook/boot-results.json','启动原始观察',True),
 ('baseline-workbook-receipts','workbook/receipt-integration-results.json','回执及重启原始观察',True),
]
ctx['developmentRuns']=[dict(id=id,title=title,file='artifacts/reaudit-rc15/'+file,scope='原RC15 ASAR 本轮诊断',bindingScope='package',frozenEvidence=False,version='1.3.0-rc.15',observationRows=observe)for id,file,title,observe in dev]
ctx['developmentRuns'].append(dict(id='d03-repair-iteration',title='D03首轮修复后二次复核',file='artifacts/rc16-independent-review/migration-supplement/results.json',scope='RC16修中源码诊断',bindingScope='source',frozenEvidence=False,version='RC16修中，最终冻结前'))
ctx['screenshots']=[
 dict(title='计分卡异常持续提示',caption='最终ASAR合成课堂：旧回执仍待处理时，课堂可以使用并持续显示计分卡问题；普通计分与历史保存继续有效。',file='artifacts/rc16-independent-review/workbook-final/packaged/explicit-rebuild-ui/fixtures/rebuild-old-restore/01-persistent-warning.png',syntheticOnly=True),
]
ctx['evidenceFiles']=['artifacts/rc16/reaudit-final-runs.json','artifacts/rc16/reaudit-findings-closure.json','artifacts/rc16/upgrade-notes.txt']+[r['evidence']for r in ctx['independentReviews']]
assert all((ROOT/r['file']).is_file()for r in ctx['developmentRuns'])
assert all((ROOT/r['file']).is_file()for r in ctx['screenshots'])
(D/'final-context.json').write_text(json.dumps(ctx,ensure_ascii=False,indent=2))
print(json.dumps({'ready':ctx['coordinatorFinalIdentityConfirmed'],'findings':len(findings),'diagnosticRuns':len(ctx['developmentRuns']),'independentDomains':len(ctx['independentReviews'])}))
