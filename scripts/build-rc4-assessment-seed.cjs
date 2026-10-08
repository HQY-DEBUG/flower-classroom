'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const stage=process.env.FLOWER_FREEZE_DIR||'artifacts/rc4';
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),freeze=read(stage+'/frozen-source.json'),known=read('artifacts/parity/known-flows-results.json'),primary=read('artifacts/reference/primary-video-features.json'),refs=read('artifacts/reference/supplemental-tutorial-evidence.json');
const care=read(stage+'/frozen-care-results.json'),lock=read(stage+'/frozen-lock-results.json'),indep=read('artifacts/qa-pet-care-independent/results.json'),wheel=read('artifacts/qa-wheels/results.json');
const followup=read('artifacts/reference/supplemental-followup-evidence.json'),groups=read('artifacts/qa-group-tools/results.json'),classroom=read('artifacts/qa-classroom-tools-native/results.json'),petSwitch=read('artifacts/qa-pet-switch/source/results.json');
const G=i=>bind('source-groups',groups,'flows',groups.results[0].report.checks[i].name),T=i=>bind('source-classroom',classroom,'flows',classroom.results[0].report.checks[i].name),S=i=>bind('source-pet-switch',petSwitch,'flows',petSwitch.results[0].report.checks[i].name);
const narrowRaw=read('artifacts/qa-classroom-tools-240/results.json');
const narrow={createdAt:narrowRaw.createdAt,syntheticOnly:true,sourceAtStart:narrowRaw.sourceAtStart,sourceAtFinish:narrowRaw.sourceAtFinish,sourceChanged:narrowRaw.sourceChanged,results:[{phase:'narrow',exitCode:narrowRaw.exitCode,report:{checks:narrowRaw.checks}}]};
fs.writeFileSync(path.join(root,stage+'/frozen-narrow-results.json'),JSON.stringify(narrow,null,2));
const N=i=>bind('source-narrow',narrow,'narrow',narrowRaw.checks[i].name);
const revision=crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(freeze.files).sort(([a],[b])=>a.localeCompare(b))))).digest('hex');
const bindKnown=id=>({runId:'source-known-flows',checkId:id});
const bind=(runId,raw,phase,name)=>{const c=raw.results.find(r=>r.phase===phase)?.report.checks.find(c=>c.name===name);if(!c)throw Error('Missing '+phase+' '+name);return {runId,phase,name};};
const C=i=>bind('source-pet-care',care,'care',care.results[0].report.checks[i].name),L=i=>bind('source-lock',lock,'lock',lock.results[0].report.checks[i].name),W=i=>bind('source-wheels',wheel,'flows',wheel.results[0].report.checks[i].name),I=(phase,index)=>bind('source-migration',indep,phase,indep.results.find(r=>r.phase===phase).report.checks[index].name);
const special={
 V008:['待澄清','部分实现','姓名/组复制、默认头像、学生分与组基础分归零及原板保留已验；2025补证支持普通分清零，宠物/历史仍待核定','2025教程不能证明原片同版；成长/徽章/日志及规则继承未展示'],
 V012:['待澄清','部分实现','清空与清零分开；普通分及基础分7秒确认归零已验；本应用明确保留宠物资料并将旧普通日志存入保护副本','原版清零/清空对宠物成长、徽章、历史的影响仍未知'],
 V014:['待澄清','部分实现','面板完整汇总及当前排行榜Excel可实际导出读取','原片Excel下拉的完整报表清单和字段尚未展示'],
 V032:['待澄清','未实现','当前可筛选姓名和小组；没有声称已复刻未知成员排序子菜单','需原版成员排序菜单完整展开及选择后效果'],
 V033:['未验证','已实现','原生显示菜单、10%缩放和复位已验；提供刷新、强制刷新和全屏快捷键','Windows全屏切换及实体快捷键尚未实测'],
 V035:['未验证','已实现','已实现原生透明、置顶红花与独立工具窗','需要Windows环境验证PowerPoint全屏的真实z-order'],
 V037:['未验证','已实现','240px/320px窄积分窗名单可读、滚动和计分通过','Windows物理拖动、收窄手势及多屏边界尚未验'],
 V038:['未验证','已实现','独立侧栏有置顶配置及共享数据','需要Windows全屏课件实际切页、焦点和遮挡验证'],
 V040:['待澄清','未实现','传送门未实现；没有用猜测链接或空按钮代替','需展开全部子菜单并演示对应动作'],
 V052:['未验证','已实现','Linux真实Electron圆形透明窗、等宽高边界与透明像素已验','Windows原生透明合成和拖动效果尚未实机验证'],
 V054:['未验证','已实现','滴答/鼓掌/飞弹三种本地音色、选项持久化及唯一播放授权通过','Windows实际扬声器、音量和三种可辨识听感尚未实测'],
 V062:['待澄清','部分实现','宠物多人选择、统一原因成长和点名按组奖励已验','原版批量操作菜单是否还包含领养、毕业或其他动作未知'],
 V063:['待澄清','部分实现','已提供已证实的成长规则、图鉴、点名、榜单和毕业相册入口','原片所有工具图标对应动作未打开，不能仅按图标猜测'],
 V066:['待澄清','部分实现','独立扣成长跨级时有降级反馈；下限拒绝并可撤销','原版扣分公式、下限、跨级余值及奖章影响没有完整前后闭环'],
 V067:['未验证','已实现','300px独立宠物窄窗列表、原因计分、升级反馈及多窗同步已验','Windows覆盖全屏PPT、触摸操作及多屏DPI尚未验证'],
 V074:['待澄清','部分实现','百宝箱可进入计时、点名、惩罚转盘、投票和签到；已证实流程有实测','课堂作业消及裁切项目未打开，百宝箱完整清单与动作未核定'],
 V075:['待澄清','部分实现','六段到LV7、手动毕业+1永久徽章、返回蛋和按品种相册已验','可兑换徽章的扣减、可用/总数关系及相机按钮动作尚未证明'],
 V076:['待澄清','待核定','原片76项与补充28条证据分别核对，所有未证规则明确保留','需要原版使用说明、可访问版本或完整补录；精确软件版本未知']
};
const results=primary.map(m=>{const row=known.videoFeatures.find(r=>r.videoId===m.编号),b=(row?.checks||[]).map(bindKnown);let status=b.length?'通过':'未验证',implementation=b.length?'已实现':'待核定',actual=row?.actual||'未形成完整实测',blocker='';if(special[m.编号])[status,implementation,actual,blocker]=special[m.编号];if(m.编号==='V041'){status='通过';implementation='已实现';actual='红花与工具菜单的一键锁屏进入应用密码保护；八窗口同步、解锁、重锁键盘重排及新进程持久保护已验。应用锁种类有2025同系列补充证据，非Windows系统锁';b.push(L(6),L(8),L(9),L(16));}if(m.编号==='V044'){status='待澄清';implementation='部分实现';actual='独立点名窗仅有原片可见的抽学生选项，普通抽学生闭环通过；完整对象范围待核定';blocker='需展开对象下拉并演示其他选项；本轮收紧范围，未删除功能';}if(m.编号==='V059')b.push(C(3),C(4));if(m.编号==='V064')b.push(C(8));if(m.编号==='V068'||m.编号==='V069')b.push(C(6));if(m.编号==='V073')b.push(C(10));if(m.编号==='V030')b.push(W(8));if(m.编号==='V016')b.push(I('migrate-cycles',4));if(m.编号==='V012')b.push(I('clear-points-confirmation',0),I('clear-points-confirmation',2));if(m.编号==='V075')b.push(C(3),C(4),I('migrate-cycles',3));return {videoId:m.编号,status,implementation,acceptedScope:m.编号==='V041'?'锁屏入口及R019所示应用内遮罩、随机键盘锁定/解锁；不认定系统锁或原片同版':m.对齐验收要求,steps:(row?.checks||[]).map(id=>known.checks.find(c=>c.id===id)?.name).filter(Boolean).join('；')||'按补充教程对应专项操作逐步核验',actual,sourceRef:['src/app.js','src/core.cjs','src/main.cjs'],sourceRevision:revision,checkBindings:b,evidence:[],issue:blocker,fix:'已知缺陷修复见迭代记录；未知规则不以自定义行为冒充',retest:status==='通过'?'冻结源码对应检查通过':b.length?'已实现部分有冻结回归通过，所列阻塞仍保留':'缺少可完整执行的核定预期',blocker,testedAt:known.completedAt};});
const rSpecs={
R001:['通过','已实现',[I('clear-points-confirmation',0),I('clear-points-confirmation',2)],'仅核定普通学生分/组基础分归零、7秒确认和取消；宠物/历史语义未纳入此通过范围'],
R002:['通过','已实现',[I('migrate-cycles',4)],'修改已有原因名称/分值，实际+50入账，历史保留当时原因'],
R003:['通过','已实现',[I('migrate-cycles',4),W(10)],'普通多人记分支持方向/签名数值；灵活原因正负方向有真实验证'],
R004:['通过','已实现',[bindKnown('GROUPS-01')],'小组全体操作逐个成员入普通积分及记录'],
R005:['通过','已实现',[bindKnown('GROUPS-01'),C(12)],'独立基础分不改成员，组总分为成员和加基础分'],
R006:['通过','已实现',[C(0),C(1),I('migrate-cycles',2)],'六段5/10/15/20/25/30可分别编辑保存，并按累计门槛分级'],
R007:['通过','已实现',[C(1),C(11)],'全5为可选配置并能保存，不声称所有版本默认'],
R008:['通过','已实现',[C(10)],'宠物抽组为组内已领养成员各自奖励成长，普通分不改变；不推断反方向'],
R009:['通过','已实现',[C(3),I('migrate-cycles',3)],'LV7出现毕业入口，明确操作后增加1永久徽章并留原周期'],
R010:['待澄清','部分实现',[C(9)],'学生榜显示姓名/当前伙伴/等级/总徽章，现支持按徽章或等级查看；原版联合排序优先级和并列细则仍未知'],
R011:['通过','已实现',[C(9)],'宠物组榜按成员平均徽章，显示成员人数/总数/均值，零徽章并列'],
R012:['通过','已实现',[C(8)],'老师可隐藏图鉴最后两级，已打开图鉴跨窗同步；不改变实际伙伴等级'],
R013:['通过','已实现',[C(2)],'成长跨级下降有降级反馈；只核定可见反馈能力，不声明原版未知负成长公式'],
R014:['通过','已实现',[C(3),C(5),I('migrate-cycles',3)],'显式毕业后同学生回未领养蛋，已有永久徽章保留；旧周期记录不丢'],
R015:['待澄清','部分实现',[C(4)],'按20品种显示毕业次数/未毕业与快照；总徽章可算，但可兑换余额来源与相机动作未知，不伪造余额'],
R016:['通过','已实现',[W(0),W(1),W(4)],'普通16分抽200奖品，确认负余额兑换到-184，再确认撤销回16；取消/重复点击/写失败有验证'],
R017:['通过','已实现',[I('migrate-cycles',5)],'真实界面42→必填原因+88→130，宠物成长不被本次普通分操作改变'],
R018:['通过','已实现',[W(5),W(6),N(9),N(10)],'仅核定惩罚转盘可见三入口、随机锁定学生与配置增删/重置/保存；默认挑战为本应用原创，完整百宝箱未知'],
R019:['通过','已实现',[L(3),L(5),L(6),L(8),L(12),L(16)],'应用内密码遮罩、点状输入、随机数字键盘、解锁回面板和再次重锁；密码规格/恢复策略是本应用选择'],
R020:['通过','已实现',[W(8)],'成员36/30/12合计78，3人平均26不含基础6；三种排序、成员明细、复制和Excel列实际核验']};
Object.assign(rSpecs,{
 F001:['待澄清','部分实现',[T(0),T(4),W(5),N(0),N(1)],'百宝箱已有计时器、随机点名、惩罚转盘、投票、签到；课堂作业消和裁切项动作未知，不算完整菜单'],
 F002:['通过','已实现',[T(0),T(1),T(2),T(3),N(2),N(3),N(5)],'选2–4名候选、逐人±1、1/6/0对应第二/第一/第三；同票排名、下限0及重选清票是明示本应用规则'],
 F003:['通过','已实现',[T(4),T(5),T(7),N(6),N(7),N(8)],'分组显示并逐人签到红勾，缺勤名单及人数实时更新；手动重置和跨重启保留属本应用策略，无日期自动清零证据'],
 F004:['通过','已实现',[bindKnown('PANELS-01'),bindKnown('PANELS-02')],'只核2025教程所示复制姓名/组，学生普通分及基础分归零，原板非零分保留；精确目标版未知，宠物/历史继承仍待核定'],
 F005:['通过','已实现',[G(1),G(2),G(5),G(13)],'新增空组、左右调整小组布局顺序、全选/取消/勾选学生后分配到现有组；不证明成员排序或删除组语义'],
 F006:['通过','已实现',[G(5),G(8)],'20分组长由120分组移到50分组，两组变100/70，个人20分与组长标志保留；不声明组长自动置顶'],
 F007:['待澄清','部分实现',[C(10)],'晚于目标的字幕称两套评分，但无同一宠物成长数字闭环；独立宠物奖励与旧档兼容关联分别保留，不推断反方向'],
 F008:['通过','已实现',[S(0),S(1),S(4),S(5),S(9)],'黄色换宠入口→选择确认→同学生形象改变且仍LV1/徽章0；新形象用原创动物，非零成长/徽章保留是本应用兼容策略，教程晚于目标']
});
const supplementalResults=[...refs.evidence,...followup.evidence].map(r=>{const [status,implementation,bindings,scope]=rSpecs[r.id];return {referenceId:r.id,status,implementation,acceptedScope:scope,steps:scope,actual:scope,sourceRef:['src/app.js','src/core.cjs','src/main.cjs','src/pet-ledger.cjs','src/pet-progress.js','src/classroom-wheels-ui.js','src/classroom-rankings.js'],sourceRevision:revision,checkBindings:bindings,evidence:[],issue:status==='待澄清'?r.limit||scope:'',fix:'见迭代记录',retest:status==='通过'?'冻结源码相应专项通过':'已实现部分通过，仍需原版资料',blocker:status==='待澄清'?scope:'',testedAt:known.completedAt};});
const defects=read('artifacts/parity/defect-history.json');
const firstNarrow=defects.find(d=>d.issueId==='PARITY-NARROW-002')?.fixHistory?.[0];
const historical=defects.map((d,i)=>({iterationId:d.issueId||'HIST-'+i,videoIds:d.videoIds||[],beforeStatus:'失败',issue:d.reproduction?.join('；')||d.observed,fix:d.fix,retestResult:d.retest?.status==='passed'?'通过':'未验证',evidence:d.retest?.evidence?.map(p=>'artifacts/parity/'+p)||[],testedAt:d.retest?.time,sourceRevision:revision,platform:'Linux真实Electron',remainingBlocker:''}));
if(firstNarrow)historical.unshift({iterationId:'PARITY-NARROW-002-first-attempt',videoIds:['V001','V037'],beforeStatus:'失败',issue:'首轮单列修改后无横向溢出，但头像仍伸展，新增姓名可读宽度断言失败',fix:'改为单列但尚未固定头像flex宽度',retestResult:'失败',evidence:['artifacts/parity/defect-history.json'],testedAt:firstNarrow.at||firstNarrow.time||null,sourceRevision:'历史候选，见原始缺陷记录',platform:'Linux Electron / 人工视觉复核',remainingBlocker:'姓名可读宽度不足；后续固定头像尺寸后再复测通过'});
const newly=[
 ['RC2-EXCEL-PROFILE',['V014','V059'],'Excel仍按普通兼容growth计算独立宠物等级','统一使用PetProgress，补当前/生涯成长与真实等级字段','migrate-cycles'],
 ['RC2-RECOVERY-CHAIN',['V013'],'恢复健康previous后若下次rename失败，会把坏主覆盖唯一健康恢复副本','保存时保留已验证previous；首迁失败也留下健康v2链','restart-after-recovery-save-failure'],
 ['RC2-READONLY-LAYOUT',['V037','V067'],'240/300px恢复警告换行遮住标题和关闭按钮','按ResizeObserver实际高度占位，恢复后清空占位','broken-chain-restore'],
 ['RC2-LOCK-RACE',['V041'],'旧解锁IPC响应可能晚于新锁定广播而覆盖界面状态','依据事件版本重新读取状态，保持新锁定广播有效','lock'],
 ['RC2-CLIPBOARD-ASYNC',['V030','V014'],'Electron原生剪贴板为异步接口，初稿和测试未正确await','等待写入完成后提示成功，测试await读取与比对原生文本','flows'],
 ['RC2-SIGNED-BATCH',['R003','V029'],'批量普通分输入框只接正数配减分键，不能直接输入视频所示负数','增加非零签名输入和确认加/减分，重复点击防重，真实多人−5及零值拒绝已验','flows'],
 ['RC2-TOOLBOX-ENTRY',['V074','R018'],'已实现挑战转盘但缺少原片可见的百宝箱顶层入口','补可实际进入挑战转盘的百宝箱入口；完整工具清单仍待补证','flows'],
 ['RC2-TEST-EXPORT-AWAIT',[],'QA仅等待Excel文件出现就读取，遇到尚未写完的ZIP并造成后续夹具污染','等待界面导出完成提示后读取，并清除旧输出；失败时finally恢复合成夹具','test harness'],
 ['RC2-TEST-CONTRACT',[],'原片套件4项RC1断言与schema2、徽章文案、原因编辑及7秒确认的新契约不同','保留旧失败日志；修正精确预期、选择器与真实等待后整套重跑','test harness']
].map(([id,videoIds,issue,fix,phase])=>({iterationId:id,videoIds,beforeStatus:['RC2-SIGNED-BATCH','RC2-TOOLBOX-ENTRY'].includes(id)?'缺项':'失败',scope:id.startsWith('RC2-TEST-')?'测试运行':'应用功能',issue,fix,retestResult:'通过',evidence:phase==='flows'?['artifacts/qa-wheels/results.json']:phase==='lock'?[stage+'/frozen-lock-results.json']:phase==='test harness'?['artifacts/parity/run-history.json']:['artifacts/qa-pet-care-independent/results.json'],testedAt:known.completedAt,sourceRevision:revision,platform:'Linux真实Electron',remainingBlocker:''}));
const testRuns=[['source-known-flows','artifacts/parity/known-flows-results.json','known-flows'],['source-migration','artifacts/qa-pet-care-independent/results.json','phase-checks'],['source-pet-care',stage+'/frozen-care-results.json','phase-checks'],['source-wheels','artifacts/qa-wheels/results.json','phase-checks'],['source-lock',stage+'/frozen-lock-results.json','phase-checks'],['source-groups','artifacts/qa-group-tools/results.json','phase-checks'],['source-classroom','artifacts/qa-classroom-tools-native/results.json','phase-checks'],['source-pet-switch','artifacts/qa-pet-switch/source/results.json','phase-checks'],['source-narrow',stage+'/frozen-narrow-results.json','phase-checks']].map(([runId,artifact,format])=>({runId,artifact,format,scope:'source',platform:'Linux Electron headless；真实main/preload/renderer，合成数据',acceptedForCandidate:true}));
const contract={schemaVersion:2,metadata:{candidateVersion:freeze.candidateVersion,assessmentFinalized:true,scopeChanges:['V044仅见抽学生单选项，其他对象原片未展开；本轮收紧为部分实现／待澄清，指标变化来自核定范围收紧，功能未删除'],frozenAt:freeze.frozenAt,testedAt:known.completedAt,sourceRevision:revision,frozenSourceManifest:freeze.files,platform:'Linux Electron headless',windowsValidated:false,referenceRulesComplete:false,additionalBlockers:['未获精确软件版本及完整隐藏规则/菜单','Windows/PPT/触屏/多屏DPI/实际扬声器未实测','既有迁移保护策略不能冒充未展示的原版细节'],packagedApplication:null},testRuns,results,supplementalResults,iterations:[...historical,...newly],sourceOverrides:[]};
for(const row of contract.results){const n=Number(row.videoId.slice(1));if(n===41)row.sourceRef=['src/classroom-lock.cjs','src/classroom-lock-ui.js','src/classroom-lock.css','src/main.cjs','src/preload.cjs'];else if(n===74)row.sourceRef=['src/panel-tools.js','src/classroom-wheels-ui.js'];else if(n>=58)row.sourceRef=['src/pet-progress.js','src/pet-ledger.cjs','src/app.js','src/pet-art.js'];else if(n>=52)row.sourceRef=['src/timer-tools.js','src/timer-tools.css','src/main.cjs','src/core.cjs'];else if(n>=43)row.sourceRef=['src/draw-tools.js','src/app.js','src/main.cjs','src/core.cjs'];else if(n>=33)row.sourceRef=['src/main.cjs','src/app.js'];else if(n>=30)row.sourceRef=['src/classroom-rankings.js','src/app.js','src/main.cjs'];else if(n>=19&&n<=24)row.sourceRef=['src/photo-batch.cjs','src/io.cjs','src/main.cjs','src/app.js'];}
for(const row of contract.supplementalResults){const n=Number(row.referenceId.slice(1));row.sourceRef=n===19?['src/classroom-lock.cjs','src/classroom-lock-ui.js','src/main.cjs','src/preload.cjs']:n===20?['src/classroom-rankings.js','src/main.cjs','src/app.js']:n===16||n===18?['src/classroom-wheels.js','src/classroom-wheels-ui.js','src/core.cjs','src/app.js']:n>=6&&n<=15?['src/pet-progress.js','src/pet-ledger.cjs','src/app.js']:['src/core.cjs','src/app.js','src/score-rules-ui.js','src/panel-tools.js'];}
for(const row of contract.supplementalResults){if(['F001','F002','F003'].includes(row.referenceId))row.sourceRef=['src/classroom-tools.js','src/classroom-tools-ui.js','src/classroom-tools.css','src/core.cjs'];if(['F005','F006'].includes(row.referenceId))row.sourceRef=['src/group-tools.js','src/group-tools-ui.js','src/group-tools.css','src/core.cjs'];if(row.referenceId==='F008')row.sourceRef=['src/app.js','src/core.cjs','src/pet-ledger.cjs'];}
contract.iterations.push(...[
 ['RC3-SWITCH-CHOICE',['F008'],'选择新宠物后radio值已更新，但已选摘要和高亮边框未同步','把换宠表单加入选择变更处理，20种卡片逐一复验','artifacts/qa-pet-switch/source/results.json'],
 ['RC3-MODAL-FOCUS',['F005'],'弹窗50ms延迟聚焦会抢走用户刚选择的排序箭头焦点','仅当前弹窗且尚未已有焦点时聚焦；100ms留焦断言通过','artifacts/qa-group-tools/results.json'],
 ['RC3-GROUP-240',['F005','V037'],'240px窄窗的内层摘要115/180、排序列表115/140横向溢出，外层检查漏报','缩小边距、工具单列、排序箭头另起一行；四弹窗内外和实际保存全测','artifacts/qa-group-tools/results.json'],
 ['RC3-CLASSROOM-240',['F001','F002','F003','V037'],'240px候选/签到两列网格100→110、投票按钮行81→125横向溢出，外框检测漏报','仅≤360px缩边距，成员单列、加减票按钮纵排；12项真实指针与内层检查复测','artifacts/qa-classroom-tools-240/results.json'],
 ['RC3-WHEEL-240',['R018','F001','V037'],'240px轮盘模式切换94→106、配置容器96→130横向溢出','仅≤360px模式换行、取消输入130px最小宽、操作纵排；输入与首末删除可达','artifacts/qa-classroom-tools-240/results.json'],
 ['RC3-TEST-TIMER-CLOSE',['V055','V056'],'包内点击计时器返回已关闭窗口，但等待其渲染JS返回导致超时，后续复用窗口两项连带失败','点击改异步调度后立即返回；仍断言仅计时器关闭、主窗存活与计时器重新打开，源码/包均全量复验','artifacts/parity-rc3-packaged/known-flows-results.json'],
 ['RC3-TEST-FOCUS-WAIT',[],'并行运行中原UI固定30ms后读取Tab焦点过早，焦点断言失败','等待精确焦点包裹及Escape关闭条件，不改变断言；原UI26与恢复/网络全量复测通过','artifacts/qa/qa-electron-results.json'],
 ['RC3-TEST-RESIZE',[],'700px尺寸断言未等待渲染层完成缩放，读取到原900px','等待真实渲染宽度后检查，保留原失败日志','artifacts/qa-group-tools/results.json']
 ].map(([iterationId,videoIds,issue,fix,evidence])=>({iterationId,videoIds,beforeStatus:'失败',scope:iterationId.startsWith('RC3-TEST-')?'测试运行':'应用功能',issue,fix,retestResult:'通过',evidence:[evidence],testedAt:known.completedAt,sourceRevision:revision,platform:'Linux真实Electron',remainingBlocker:''})));
const priorFailures={
 'RC3-SWITCH-CHOICE':'artifacts/qa-pet-switch/source/defect-before-fix/defect.json',
 'RC3-MODAL-FOCUS':'artifacts/qa-group-tools-failure-20261002-101446/delayed-focus-before-fix.json',
 'RC3-GROUP-240':'artifacts/qa-group-tools-240-before-fix-20261002/240px-layout.json',
 'RC3-CLASSROOM-240':'artifacts/qa-classroom-tools-240/before-fix/results.json',
 'RC3-WHEEL-240':'artifacts/qa-classroom-tools-240/before-wheel-fix/results.json',
 'RC3-TEST-TIMER-CLOSE':'artifacts/parity-rc3/packaged-before-timer-return-harness-fix/primary-video-flows/known-flows-results.json',
 'RC3-TEST-FOCUS-WAIT':'artifacts/parity-rc3/source-ui-focus-wait-before/qa-electron-results.json',
 'RC3-TEST-RESIZE':'artifacts/qa-group-tools-failure-20261002-101446/results.json'
};
for(const item of contract.iterations){const file=priorFailures[item.iterationId];if(file){if(!fs.existsSync(path.join(root,file)))throw Error('Missing prior failure '+file);item.evidence.unshift(file);}}
const packageFile=path.join(root,stage+'/package-summary.json');if(fs.existsSync(packageFile)){const summary=JSON.parse(fs.readFileSync(packageFile));if(JSON.stringify(summary.sourceManifest)!==JSON.stringify(freeze.files))throw Error('Package summary has stale source');contract.metadata.packagedApplication=summary;contract.testRuns.push({runId:'packaged-known-flows',artifact:stage+'-packaged/known-flows-results.json',format:'known-flows',scope:'asar',platform:'Linux Electron 实际执行隔离ASAR；未运行Windows EXE',acceptedForCandidate:true});for(const row of contract.results)for(const binding of [...row.checkBindings])if(binding.runId==='source-known-flows')row.checkBindings.push({runId:'packaged-known-flows',checkId:binding.checkId});}
fs.writeFileSync(path.join(root,stage+'/assessment-legacy-seed.json'),JSON.stringify(contract,null,2));console.log('Assessment',results.reduce((r,x)=>(r[x.status]=(r[x.status]||0)+1,r),{}),supplementalResults.reduce((r,x)=>(r[x.status]=(r[x.status]||0)+1,r),{}));
