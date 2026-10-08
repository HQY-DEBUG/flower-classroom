"""Retain reported candidate failures and harness corrections without promoting them."""
from pathlib import Path
import hashlib
import json

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
def sha(p):return hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
def read(p):return json.loads((ROOT/p).read_text())
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')

def main():
    runs=[]
    definitions=[
      ('CANDIDATE-U13-BEFORE','统一配置候选切板指纹缺陷修前','artifacts/rc18-independent/unified-development-2/results.json',{}),
      ('CANDIDATE-U13-AFTER','面板顺序修正后的开发复查','artifacts/rc18-independent/unified-development-3/results.json',{}),
      ('CANDIDATE-U14-BEFORE','未绑定模板占位班名缺陷修前','artifacts/rc18-independent/unified-development-4/results.json',{}),
      ('CANDIDATE-U14-AFTER','占位班名与明确改名分别复查','artifacts/rc18-independent/unified-development-5/results.json',{}),
      ('HARNESS-DOMAIN','初始领域脚本预期与旧格式样本修正','artifacts/rc18-independent/domain-initial-harness-corrections.json',{
        'different legacy variants require explicit consent and preserve the input':'harness',
        'generated migration IDs avoid existing IDs and preserve absent versus zero growth':'harness'}),
      ('HARNESS-GROWTH','旧关联模式实际成长计算的预期修正','artifacts/rc18-independent/source-workbook-attempt1/results.json',{
        'refresh commits card and progression changes together and preserves every prior history':'harness'}),
      ('HARNESS-LEDGER-BASELINE','账本启用的比较基线修正','artifacts/rc18-independent/unified-electron-development-3/results.json',{
        'every additional configuration action reaches the unified workbook through real preload':'harness'}),
      ('HARNESS-HEADLESS-BOUNDS','无头窗口尺寸预期修正','artifacts/rc18-independent/unified-electron-development-4/results.json',{
        'fresh process retains exact final shared JSON, thresholds and workbook':'environment'}),
      ('CANDIDATE-ELECTRON-AFTER','统一配置真实主进程开发复查','artifacts/rc18-independent/unified-electron-development-5/results.json',{}),
      ('CANDIDATE-BOOTSTRAP-AFTER','首次设置持久化与第二进程复查','artifacts/rc18-independent/unified-electron-development-6/results.json',{}),
    ]
    for rid,title,file,classifications in definitions:
        obj=read(file)
        assert obj.get('syntheticOnly') is True
        runs.append({'id':rid,'title':title,'file':file,'sha256':sha(file),'classification':'product','checkClassifications':classifications,
          'version':'1.3.0-rc.18 未冻结候选；代码身份见原记录','scope':'开发/独立诊断','outcome':'failed' if obj.get('failed') else 'passed',
          'startedAt':obj.get('startedAt'),'completedAt':obj.get('completedAt',obj.get('finishedAt'))})
    log='artifacts/rc18-report/history/unified-electron-initial-layout.log'
    if (ROOT/log).is_file():
        runs.append({'id':'HARNESS-LAYOUT','title':'统一Electron首轮夹具目录布局修正','file':log,'sha256':sha(log),'classification':'harness',
          'version':'1.3.0-rc.18 未冻结候选','scope':'开发/启动夹具','outcome':'failed',
          'actual':'旧脚本把synthetic-data放在程序目录旁；新契约要求程序目录内的数据子目录。此为测试夹具布局错误，尚未产生功能通过断言。'})
    preflight='artifacts/rc18-independent/final-asar-harness-binding-attempt/preflight-result.json'
    if (ROOT/preflight).is_file():
        runs.append({'id':'HARNESS-ASAR-METADATA','title':'ASAR部署元数据预检范围修正','file':preflight,'sha256':sha(preflight),'classification':'harness',
          'version':'1.3.0-rc.18 未发布候选1 ASAR预检','scope':'测试脚本/打包元数据','outcome':'failed',
          'actual':'首轮预检错误要求源码package.json与部署包逐字节相同。electron-builder正常剥除scripts、devDependencies和build并改变换行；修正为源/资源字节一致，加部署元数据去这三字段后的严格结构一致。最终ASAR另有完整通过证据，不把预检脚本问题算作产品缺陷。'})
    restore_before='artifacts/rc18/restore-workbook-reproduction/before.json'
    if (ROOT/restore_before).is_file():
        assert read(restore_before).get('syntheticOnly') is True
        runs.append({'id':'CANDIDATE-RESTORE-BEFORE','title':'正常备份还原后工作簿留旧的确认复现','file':restore_before,'sha256':sha(restore_before),'classification':'product',
          'version':'1.3.0-rc.18 未发布候选1','scope':'真实Electron主进程/预加载/文件对话框流程','outcome':'confirmed-defect',
          'actual':'正常导出备份，修改班名及成长阶段，再从正常文件选择/预览还原。JSON恢复旧成长模式，但工作簿字节仍是修改后版本，随后普通改班名因成长模式冲突被拒绝。此为成功复现产品缺陷，不是功能通过。'})
    repair_files=[
      ('RESTORE-PREVIOUS','原子还原修复迭代：失败时旧恢复点被轮转','artifacts/rc18/restore-independent-review/previous-file-failure-reproduction.json','JSON与配置表原字节未变，但.previous从旧0分恢复点变为3分；修复必须回滚完整五文件链。'),
      ('RESTORE-SAME-CONFIG','原子还原修复迭代：相同参数不同课堂状态误识别提交','artifacts/rc18/restore-independent-review/student-only-receipt-baseline.json','仅配置签名相同不足以确认课堂恢复成功；回执改为绑定完整课堂状态，保留学生分数、历史和版本差异。'),
      ('RESTORE-V1','候选2暂停：旧v1首次还原中断后的等价状态识别','artifacts/rc18/restore-workbook-reproduction/v1-first-restore-before/observation.json','主存档尚未替换，storage将旧完整v1状态以校验后的v2写入.previous；过严原字节哈希拒绝安全回滚。修复只接受精确校验后的等价表示并重载存储。')]
    for rid,title,file,actual in repair_files:
        assert read(file).get('syntheticOnly') is True
        runs.append({'id':rid,'title':title,'file':file,'sha256':sha(file),'classification':'product','version':'1.3.0-rc.18 未发布修复候选','scope':'RC18-I03修复迭代','outcome':'confirmed-defect','actual':actual})
    false_green_dir='artifacts/rc18/harness-history/feature-child-contract-20261007T091259.985685Z'
    for suite in ['avatars','avatar-import']:
        file=false_green_dir+'/'+suite+'/results.json'
        if (ROOT/file).is_file():
            runs.append({'id':'HARNESS-EMPTY-'+suite,'title':'零退出但无真实报告的QA假绿：'+suite,'file':file,'sha256':sha(file),'classification':'harness','version':'1.3.0-rc.18 候选3继承脚本','scope':'QA执行完整性','outcome':'invalid-execution','actual':'外层exit0没有证明完成；两个子阶段未产生有效报告和正数案例，原运行无效且保留。已要求完整子进程error/signal、必需阶段和实际叶子校验，最终仅选修正后的新执行。'})
    for rid,title,file,classification,actual in [
      ('PREVIEW-ASSET-BEFORE','源码预览公开配置脚本404修前','artifacts/rc18/supplemental-folder-preview-diagnosis/preview-results-original.json','product','源码预览44断言中1项公开脚本路由404；修复只涉及未打包的预览服务，不改Windows运行代码。'),
      ('HARNESS-TEMPLATE-HASH','包模板哈希符号匹配修正','artifacts/rc18/supplemental-folder-preview-diagnosis/package-results-original.json','harness','旧正则把LEGACY_INITIAL_SHA256后缀误当INITIAL_SHA256，原模板字节正确。修正精确符号匹配，保留6通过/1失败原记录。')]:
        if (ROOT/file).is_file():runs.append({'id':rid,'title':title,'file':file,'sha256':sha(file),'classification':classification,'version':'1.3.0-rc.18 候选3','scope':'开发诊断与修复','outcome':'failed','actual':actual})
    access_invalid='artifacts/rc18-report/history/avatar-access-invalid-20261007T0952/index.json'
    if (ROOT/access_invalid).is_file():
        runs.append({'id':'HARNESS-EMPTY-AVATAR-ACCESS','title':'头像入口focused QA零退出但缺报告','file':access_invalid,'sha256':sha(access_invalid),'classification':'harness','version':'1.3.0-rc.18 候选3','scope':'QA执行完整性','outcome':'invalid-execution','actual':'源码与ASAR两层旧wrapper均返回exit0，但未产results.json和任何案例。全量门槛识别并拒绝选入，旧夹具并列目录及只检查status的实现被复核；原脚本、执行行和日志保留。'})
    notes=[
      {'id':'HARNESS-UNIFIED-CONTRACT','title':'继承脚本按唯一配置表的新契约调整','actual':'原TXT即时启动、分面板规则表及恢复只带JSON的旧预期被统一配置与原子还原要求替代。合成夹具按明确程序根目录布局，首次配置产生的有效缓存纳入比较基线；直接恢复须先取得审阅令牌，丢回复注入定位实际提交阶段。保留精确课堂记录、历史、旧原件、整本表格与JSON一致性的强断言，原脚本和失败记录均保留。','evidence':'artifacts/rc18/folder-harness-contract/changes.json\nartifacts/rc18/rule-harness-contract/changes.json\nartifacts/rc18/classroom-harness-adaptation.json\nartifacts/rc18/inherited-storage-transactions-adaptation/adaptation.json'},
      {'id':'HARNESS-DRAFT-CONTRACT','title':'名称、默认值与恢复意图的继承预期修正','actual':'卡片和还原弹窗采用当前明确标题；挑战和倒计时只持久化已选择的未来默认值，评分及其他记录仍精确保持。失败还原的旧确认已消费，须新预览后重试；原几何、可访问性、焦点、双击和历史保护断言继续保留。导入预览现在必带事务元数据，但原payload仍精确校验；旧过大输入仍拒绝且加强零内容读取证明。','evidence':'artifacts/rc18/harness-history/modal-adversarial-contract/adaptation.json\nartifacts/rc18/restore-independent-review/inherited-tools-adaptation.json\nartifacts/rc18-independent/legacy-receipts-qa-adjustment/adjustment.json\nartifacts/rc18-independent/legacy-cross-imports-qa-adjustment/adjustment.json\nartifacts/rc18/qa-adaptation-independent-review/review.json'},
      {'id':'HARNESS-WHEEL-GESTURE','title':'合成原生滚轮手势顺序修正','actual':'测试在已到顶部时先发向上滚轮，随后下滚没有移动；在显示并聚焦的实际窗口内先移入鼠标、核对可下滚余量后直接下滚，两种缩放均实际移动。修正只涉及测试手势顺序，保留after>before及关闭重开断言，不直接修改scrollTop。事件对照支持测试手势解释，未确认为运行产品缺陷。','evidence':'artifacts/rc18/utility-wheel-diagnosis/diagnosis.json'},
      {'id':'PLAN-COMPLETENESS','title':'逐组补齐历史普通独立回归','actual':'发布前将RC17最终188组与RC18新计划逐项比对，补齐一度未列入执行计划的普通迁移、规则、导入和课堂独立复核42组。最终计划210组包括所有188个继承组及22个新增组，重复ui-lifecycle只选一次。新增回归组不改变192项功能分母，全部必须绑定本轮冻结源码或精确ASAR。','evidence':'artifacts/rc18-report/required-run-plan.json\nartifacts/rc18-report/omitted-ordinary-independent-plan.json'},
      {'id':'HARNESS-VERSION','title':'执行过的QA辅助件保留精确版本','actual':'一份共用QA helper在部分完成运行后增加了更严格的场景名检查。12个已完成组的原始before/after哈希完全相同，且与已保存原字节快照一致；明确绑定该执行版本、核完整场景名和子进程结果后保留这些执行。另1组在运行中helper发生变化，必须单独新跑，旧结果不选。原执行元数据未补写，当前运行代码与ASAR未变化。','evidence':'artifacts/rc18-report/qa-helper-hash-review.json\nartifacts/rc18/harness-history/extension-child-contract-20261007T093110.234580Z/qa-feature-child.cjs'},
      {'id':'HARNESS-FALSE-GREEN-ACCESS','title':'同类空结果检查覆盖到focused头像入口','actual':'全210组执行证据检查进一步拦截focused/avatar-access源码与ASAR两组：外层exit0而结果目录仅有日志、无报告。其旧包装脚本沿用并列数据/资源夹具且丢弃子进程错误。归入同一QA执行完整性修复家族；不作为产品功能通过或新的运行产品缺陷，必须另选修正后的完整新结果。','evidence':access_invalid},
      {'id':'HISTORICAL-COUNT-REVIEW','title':'已发布RC17计数的只读核查','actual':'针对本轮暴露的零退出/缺报告问题，独立只读检查RC17原选中188组、280结果文件及43绑定证明，未发现所选记录受该失效模式影响；原5515通过及8观察获原始证据支持。没有运行旧软件或恢复停止专项，也不据此宣称RC17不存在其他缺陷；旧执行不进入RC18计数。','evidence':'artifacts/rc18-independent/rc17-published-evidence-validation.json'},
      {'id':'PREVIEW-I04','title':'源码预览资源路由404','actual':'新增configuration-model.js已被HTML引用，但本地源码预览白名单漏加该公开路由，实际返回404。按明确授权修复预览脚本并加精确字节/MIME/浏览器模型/404边界测试；源码Node与完整预览须重新运行。Windows ASAR与63个冻结运行文件保持原字节。','evidence':'artifacts/rc18/supplemental-folder-preview-diagnosis/diagnosis.json\nartifacts/rc18/supplemental-folder-preview-diagnosis/preview-results-original.json'},
      {'id':'HARNESS-FALSE-GREEN','title':'外层零退出不能证明子阶段完成','actual':'全量复核发现头像与头像导入旧包装脚本外层exit0，但两子阶段report为null、0案例；子进程启动超时信息未参与成功判定。该运行无效，发布账本硬阻断。修复QA保留error/signal和必需阶段，所有选中批次递归检查空报告、0叶子、遗留失败与完成数量；旧无效结果保留，替代运行单独选择。没有据此认定新的运行产品缺陷。','evidence':false_green_dir+'/avatars/results.json\n'+false_green_dir+'/avatar-import/results.json'},
      {'id':'CANDIDATE-I03-ITERATIONS','title':'原子还原的恢复点与旧格式中断边界','actual':'I03修复复核进一步发现旧.previous恢复点回滚不全、同配置但课堂状态不同的回执误清，以及旧v1首次还原中断后的等价状态误拒绝。这些均纳入同一原子恢复修复家族；候选2也停止发布，相关中断和开发复验不计入最终。候选3增加完整存档链、全状态回执及严格等价v2识别，最终仍需源码和精确ASAR全量复验。','evidence':'\n'.join(x[2] for x in repair_files)},
      {'id':'CANDIDATE-I03','title':'未发布候选1暂停：还原JSON未同步配置工作簿',
       'actual':'完整继承回归暴露正常备份还原衔接问题，真实Electron/预加载和文件对话框流程复现：JSON还原成功，配置表仍留旧值，后续普通参数操作被冲突阻止。候选1发布被暂停，两套广泛回归以exit130中断，不算通过；修复后必须重新冻结、构建ASAR并重新执行。候选1已通过的子集仅留作历史。',
       'evidence':'artifacts/rc18/restore-workbook-reproduction/before.json\nartifacts/rc18/regression-hold-restore-review.json\nartifacts/rc18-report/history/unpublished-candidate-1/candidate-status.json'},
      {'id':'HARNESS-ASAR','title':'部署元数据的正常构建差异单独验证',
       'actual':'ASAR首轮预检把源package.json也按字节比较，误拒绝electron-builder正常剥除的scripts、devDependencies、build及换行。原始预检失败与diff保留；最终只对这三项允许构建差异，且从实际ASAR提取元数据严格比较其余结构。源码与资源仍逐字节匹配，不能用元数据例外容许运行代码变化。',
       'evidence':preflight+'\nartifacts/rc18-independent/final-asar-harness-binding-attempt/package-json-diff.patch'},
      {'id':'CANDIDATE-I02','title':'未发布RC18集成缺陷：未绑定模板占位班名覆盖',
       'actual':'只编辑未绑定初始模板的缩放时，候选版本将当前班名替换为模板占位符，且与保留当前班名的提示矛盾。修复为仅在模板面板ID及原占位名均未被改动时绑定当前班名；用户明确改写的班名仍应用。修前U14.placeholder失败，开发复查U14.placeholder及U14.edited通过；最终源码/ASAR仍须重新绑定。RC17无该统一模板工作表，此问题不归为已发布RC17缺陷。',
       'evidence':'artifacts/rc18-independent/unified-development-4/results.json\nartifacts/rc18-independent/unified-development-4/U14-false/preview.json\nartifacts/rc18-independent/unified-development-5/results.json'},
      {'id':'INTEGRATION-BOOTSTRAP','title':'首次统一配置必须真实保存已确认缓存',
       'actual':'集成复查确认首次设置新增appConfig及未来工具默认，需要真实同步保存JSON；不能沿用只返回输入的旧保存回调。已有首次与第二进程开发验证，最终结论仅使用冻结后的对应断言。此项列为已检查的集成风险，不额外制造一个已发布版本缺陷。',
       'evidence':'artifacts/rc18-independent/unified-electron-development-6/results.json'},
      {'id':'CANDIDATE-I01','title':'未发布RC18集成缺陷：切换面板改变配置指纹',
       'actual':'统一配置开发候选把当前面板放在快照首位，切板因此改变配置数组顺序及指纹，并可能误判配置变化。修复为按稳定面板ID排序外层，保留各面板内部列表顺序。修前独立U13失败，开发复查U13通过；最终状态仍须绑定冻结源码及精确ASAR。该问题不属于已发布RC17缺陷。',
       'evidence':'artifacts/rc18-independent/unified-development-2/results.json\nartifacts/rc18-independent/unified-development-2/U13/panel-switch-fingerprints.json\nartifacts/rc18-independent/unified-development-3/results.json'},
      {'id':'HARNESS-01','title':'错误提示正则与合成旧格式样本修正',
       'actual':'首轮领域脚本的错误提示正则只接受另一种等价措辞；另一个合成v1样本误装新版growthDelta字段。两项按脚本/夹具问题保留原始失败，不作为软件缺陷或功能失败。',
       'evidence':'artifacts/rc18-independent/domain-initial-harness-corrections.json'},
      {'id':'HARNESS-02','title':'旧关联成长模式的期望计算修正',
       'actual':'首轮工作簿W02漏计旧关联模式下普通评分已带来的3点成长，错误期望等级1，实际应按保留成长计算为等级2。修正测试预期并保留原始失败；不把正确兼容行为误报产品缺陷。',
       'evidence':'artifacts/rc18-independent/source-workbook-attempt1/results.json'},
      {'id':'HARNESS-03','title':'统一配置Electron夹具目录布局修正',
       'actual':'首轮脚本沿用旧夹具目录布局，与新程序/数据布局不符，启动准备失败。修正的是合成测试环境布局；不会把这一轮误计为功能通过。',
       'evidence':log},
      {'id':'INPUT-FORMAT','title':'名单标准副本与软件范围分开',
       'actual':'用户明确选择整理输入文件，不要求软件适配打印版模板。原件保留，标准副本另行直接交付；报告只引用协调者提供的两班匿名人数和验证结果。未把原打印版拒绝列为待修软件缺陷。',
       'evidence':'协调者授权与脱敏场景结果'},
      {'id':'HARNESS-04','title':'先启用成长账本，再建立比较基线',
       'actual':'统一Electron开发第3轮E12在比较前才启用成长账本，正常迁移为旧历史补充petEffect字段，导致测试把合法迁移误判为配置动作改了记录。修正为先启用再建立基线；原始失败保留，不能据此报已发布版本缺陷。',
       'evidence':'artifacts/rc18-independent/unified-electron-development-3/results.json'},
      {'id':'LIMIT-HEADLESS','title':'启动参数与无头窗口实际边界分开',
       'actual':'第4轮E11把Linux无头合成器实际窗口边界误当作启动构造参数，发生尺寸断言失败。第5轮分别记录构造请求1360×900、实际无头900×640及真实缩放1.25。无头环境不展示或最小化原生窗口，这些效果继续留在Windows实机未验证范围，不能宣称实际窗口已达到1360×900。',
       'evidence':'artifacts/rc18-independent/unified-electron-development-4/results.json\nartifacts/rc18-independent/unified-electron-development-5/results.json'},
    ]
    ctx={'version':'1.3.0-rc.18','developmentRuns':runs,'qaNotes':notes,'excludedFromFinalAssertions':True,'source':'独立审计与协调者明确报告的开发过程'}
    write(OUT/'development-context.json',ctx)
    before='artifacts/rc18-independent/unified-development-2/results.json'
    closure={'schemaVersion':1,'version':'1.3.0-rc.18','coordinatorReviewed':False,'sourceManifestSha256':None,'asarSha256':None,'expectedFindingIds':['RC18-I01'],'unresolvedCoveredProductDefects':None,
      'findings':[{'id':'RC18-I01','title':'切换面板误改变统一配置指纹','module':'配置与多面板','introducedIn':'unpublished RC18 integration candidate','notPresentInReleasedBaseline':True,
        'requirementIds':['V010','R14-07','R14-08'],'expected':'只切换活动面板不改变任何配置值或整本配置指纹，随后正常编辑仍可提交。',
        'steps':'准备多个配置不同的合成面板，保存配置指纹，切换活动板，逐字段比较配置并尝试下一次编辑。',
        'beforeSummary':'开发候选U13失败：切换活动面板导致配置指纹不同，违反“活动选择不属于配置变化”的预期。',
        'rootCause':'配置快照采用活动面板优先顺序，活动板切换使同一组面板配置的外层数组顺序发生变化。',
        'fix':'外层快照按稳定面板ID排序，同时保留每个面板内部卡片、网址、科目等列表的语义顺序。',
        'before':[{'file':before,'sha256':sha(before),'pointer':'/results/16/status','equals':'failed'}],
        'repairIterations':[{'file':'artifacts/rc18-independent/unified-development-3/results.json','sha256':sha('artifacts/rc18-independent/unified-development-3/results.json'),'pointer':'/results/16/status','equals':'passed'}],
        'afterAssertions':{mode:['switching active panel leaves the configuration fingerprint stable and permits the next edit'] for mode in ['source','packaged']},
        'limits':'修前与开发复查是未发布RC18候选过程；仅最终冻结source和精确ASAR都通过后才关闭。'}]}
    before2='artifacts/rc18-independent/unified-development-4/results.json'
    after2='artifacts/rc18-independent/unified-development-5/results.json'
    closure['expectedFindingIds'].append('RC18-I02')
    closure['findings'].append({'id':'RC18-I02','title':'未绑定模板占位班名覆盖当前班名','module':'统一配置首次绑定','introducedIn':'unpublished RC18 integration candidate','notPresentInReleasedBaseline':True,
      'requirementIds':['V009','R15-13'],'expected':'只改初始模板的缩放应保留当前真实班名；明确改写班名则按审阅内容应用。',
      'steps':'分别只编辑未绑定模板缩放、以及同时明确改写模板班名，打开整本迁移预览后核对班名及提示，确认并重启验证。',
      'beforeSummary':'开发候选U14.placeholder失败：当前班名被模板占位符替换，而预览提示声称保留当前班名。明确改名情形在修前已通过，修复须保留这一行为。',
      'rootCause':'首次绑定只映射模板面板ID，未区分原占位班名和用户明确编辑后的班名。',
      'fix':'仅在未绑定模板面板ID和原占位名都不变时替换为当前班名；已明确编辑的名称继续按预览应用。',
      'before':[{'file':before2,'sha256':sha(before2),'pointer':'/results/17/status','equals':'failed'}],
      'repairIterations':[{'file':after2,'sha256':sha(after2),'pointer':'/results/17/status','equals':'passed'},{'file':after2,'sha256':sha(after2),'pointer':'/results/18/status','equals':'passed'}],
      'afterAssertions':{mode:['edited unbound template preserves current class name when only startup zoom was edited','edited unbound template honors explicitly edited class name'] for mode in ['source','packaged']},
      'limits':'仅未发布RC18统一模板新增路径；修前和开发通过不计最终，等待源码/ASAR两层冻结复验。'})
    if (ROOT/restore_before).is_file():
        closure['expectedFindingIds'].append('RC18-I03')
        closure['findings'].append({'id':'RC18-I03','title':'备份还原后的JSON与配置表不一致','module':'还原与统一配置事务','introducedIn':'unpublished RC18 candidate 1','notAttributedToReleasedBaseline':True,'baselineAssessment':'本轮未将恢复链修复子问题追溯归为已发布RC17缺陷，也不宣称已独立证明旧版不存在这些边界。',
          'requirementIds':['V013','R14-11','R15-14'],'expected':'正常确认还原应使课堂JSON和配置工作簿同步且可继续普通编辑；外部未确认修改不得被覆盖，失败须回滚整笔还原。',
          'steps':'正常保存备份文件，改班名和六段成长配置，再通过文件选择/还原预览/确认恢复；比对JSON与工作簿，继续普通改班名和成长设置。',
          'beforeSummary':'JSON还原为legacy-step，工作簿字节却仍是修改后版本；接着正常改班名被“成长模式不能在表格中切换”错误阻止。',
          'rootCause':'候选restore-apply只提交JSON，没有把相应配置工作簿纳入同一持久事务。',
          'fix':'还原预览绑定课堂版本、还原代数及确切工作簿哈希；JSON与整本配置通过持久回执原子提交，任何写失败回滚包括.previous在内的五文件链。回执绑定完整课堂状态，旧v1仅接受经校验的精确等价v2表示；中断回滚后重载存储。外部未确认编辑或坏表受保护，需重新审阅后显式重试。',
          'before':[{'file':restore_before,'sha256':sha(restore_before),'pointer':'/productGapReproduced','equals':True}],
          'repairIterations':[
            {'file':repair_files[0][2],'sha256':sha(repair_files[0][2]),'pointer':'/previousUnchanged','equals':False},
            {'file':repair_files[1][2],'sha256':sha(repair_files[1][2]),'pointer':'/recovered/committed','equals':True},
            {'file':repair_files[2][2],'sha256':sha(repair_files[2][2]),'pointer':'/activePrimaryNeverReplaced','equals':True}],
          'afterAssertions':{mode:[
            'ordinary restore synchronizes classroom and all configuration then permits rename/create/progression edits',
            'normal restore refuses unapplied external card/settings/format changes and malformed files without changing either store',
            'restore EPERM and JSON-save failure preserve original workbook/classroom and allow a newly reviewed retry',
            'JSON rename failure restores all five state files including the older previous point byte-for-byte',
            'student-only restore uses canonical whole-state receipts and cannot mistake old or third states for a commit',
            'a denied previous-file rollback retains whole recovery evidence and blocks later writes until release',
            'restore crash before JSON, after previous rotation and after JSON resolves all five files by full classroom state',
            'uncleared committed restore receipt blocks ordinary scoring until it is safely cleared',
            'first v1 restore crash recognizes the exact validated v2 before-state and requests storage reload after chain rollback',
            'stale valid raw revision cannot be replaced by a newly prepared restore revision',
            'two reviewed windows and two simultaneous confirms commit only one restore and invalidate all older intentions',
            'lost restore response plus unavailable first receipt resolves by exact-intent retry without a second restore'] for mode in ['source','packaged']},
          'limits':'候选1和候选2均未发布，修前复现和中断运行不算通过。上述恢复子问题合并为I03修复迭代，不增加192项需求分母；只有候选3源码及精确ASAR的选中断言全部通过才关闭。'})
    preview_before='artifacts/rc18/supplemental-folder-preview-diagnosis/preview-results-original.json'
    if (ROOT/preview_before).is_file():
        closure['expectedFindingIds'].append('RC18-I04')
        closure['findings'].append({'id':'RC18-I04','title':'源码预览服务遗漏统一配置脚本路由','module':'源码预览服务','scope':'source-preview-only','affectedFiles':['scripts/preview.cjs'],
          'introducedIn':'unpublished RC18 source-preview tooling','notPresentInReleasedBaseline':True,'requirementIds':[],
          'expected':'源码网页预览应提供index.html引用的每个公开脚本，配置模型初始化成功；未列入白名单的路径仍返回404。',
          'steps':'启动本地预览，逐一请求HTML引用的资源，核对配置脚本的状态码、精确字节及MIME，并在浏览器模型环境验证默认值和原404边界。',
          'beforeSummary':'配置模型脚本已加入HTML，但GET configuration-model.js返回404。原44条预览断言中43通过、1失败，不能选为最终通过。',
          'rootCause':'源码预览服务器的静态资源白名单未同步增加configuration-model.js。',
          'fix':'仅将该公开前端脚本加入明确白名单，并增加精确字节/MIME/浏览器初始化和未列入路径404的源码回归。',
          'before':[{'file':preview_before,'sha256':sha(preview_before),'pointer':'/checks/40/httpStatus','equals':404}],
          'repairIterations':[],
          'afterAssertions':{'source':['Linked asset configuration-model.js','RC18 source preview serves the exact configuration module and its dependencies for browser startup'],'packaged':[]},
          'packagedNotApplicableReason':'scripts/preview.cjs仅为源码本地预览服务，未打入Windows应用。最终ASAR身份及63个运行文件保持不变；这里由最终源码Node和完整预览服务两组验证。',
          'limits':'属于未发布源码预览工具缺陷；不据此宣称Windows应用存在同一404，也不为此增加稳定功能需求分母。'})
    write(OUT/'findings-closure-draft.json',closure)
    print(json.dumps({'developmentFiles':len(runs),'candidateIntegrationFindings':len(closure['findings']),'finalAssertionContribution':0},ensure_ascii=False))

if __name__=='__main__':main()
