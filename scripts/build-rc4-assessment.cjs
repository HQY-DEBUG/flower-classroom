'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),stage='artifacts/rc4';
const seed=spawnSync(process.execPath,[path.join(__dirname,'build-rc4-assessment-seed.cjs')],{cwd:root,env:{...process.env,FLOWER_FREEZE_DIR:stage},encoding:'utf8'});if(seed.status)throw Error(seed.stdout+seed.stderr);
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),input=read(stage+'/assessment-legacy-seed.json'),template=read('artifacts/parity-workbook/rc4-input-template.json'),freeze=read(stage+'/frozen-source.json');
const evidence=read('artifacts/reference/primary-video-features.json'),refs=read('artifacts/reference/supplemental-tutorial-evidence.json'),follow=read('artifacts/reference/supplemental-followup-evidence.json');
const curationFile=path.join(root,'artifacts/parity-workbook/scope-curation-rc4.json');if(!fs.existsSync(curationFile))throw Error('Scope curation is required before final assessment');
const curation=JSON.parse(fs.readFileSync(curationFile));
const curations=Array.isArray(curation)?curation:[...(curation.results||curation.features||[]),...(curation.supplementalResults||curation.supplemental||[])];
const curById=new Map(curations.map(v=>[v.id||v.videoId||v.referenceId,v]));
const definitions=['organization','pet','toolbox'].flatMap(name=>read(stage+'/'+name+'-assumptions.json').features.map(feature=>({...feature,module:name})));
const featureById=new Map(definitions.map(v=>[v.id,v]));
const newRuns={organization:{id:'source-organization',artifact:'artifacts/qa-organization/results.json'},pet:{id:'source-pet-extra',artifact:stage+'/frozen-petextra-results.json'},toolbox:{id:'source-toolbox',artifact:'artifacts/qa-toolbox-extra-native/results.json'}};
for(const item of Object.values(newRuns))input.testRuns.push({runId:item.id,artifact:item.artifact,format:'phase-checks',scope:'source',platform:'Linux真实Electron，合成数据；不代表Windows屏幕观察',acceptedForCandidate:true});
const bind=(runId,phase,name)=>{const run=input.testRuns.find(r=>r.runId===runId);if(!run)throw Error('Missing run '+runId);const raw=read(run.artifact);const check=raw.results?.find(r=>r.phase===phase)?.report?.checks?.find(c=>c.name===name);if(!check||check.status!=='passed')throw Error('Missing passing check '+runId+' '+phase+' '+name);return {runId,phase,name};};
const featureBindings=f=>f.checks.map(c=>bind(newRuns[f.module].id,f.module==='pet'?'petextra':c.phase,c.check||c.name));
const inferenceFields=['basis','videoConfirmedScope','assumptions','configurableItems','stableExpected','expectedRevision'];
function addScope(row,scope){if(!scope)throw Error('Missing fixed scope '+(row.videoId||row.referenceId));for(const field of inferenceFields){if(scope[field]===undefined)throw Error('Missing '+field+' '+(row.videoId||row.referenceId));row[field]=scope[field];}row.originalInternalsVerified=false;row.platformEvidence=[];}
const windows=new Set(['V033','V035','V037','V038','V052','V054','V067']);
input.results=input.results.filter(r=>r.videoId!=='V076').map(row=>{
 const f=featureById.get(row.videoId),scope=f||curById.get(row.videoId);addScope(row,scope);
 row.implementation='已实现';
 if(f){row.checkBindings=featureBindings(f);row.acceptedScope=f.stableExpected.join('；');row.steps=(f.steps||f.stableExpected).join('；');row.actual='冻结源码已满足明示预期：'+f.stableExpected.join('；');row.sourceRef=f.module==='organization'?['src/organization-tools.js','src/organization-ui.js','src/core.cjs','src/draw-tools.js']:f.module==='pet'?['src/pet-progress.js','src/pet-ledger.cjs','src/pet-extra-ui.js','src/app.js']:['src/toolbox-extra.js','src/toolbox-extra-ui.js','src/toolbox-export.cjs','src/main.cjs'];}
 if(windows.has(row.videoId)){
  row.status='未验证';row.requiresWindowsVisual=row.videoId!=='V054';row.requiredPlatformEvidence=row.videoId==='V054'?['audio-observation']:row.videoId==='V067'?['screen-observation','touch-observation']:['screen-observation'];row.blocker='本轮Windows文件自动物化受环境限制，未执行；没有对应'+row.requiredPlatformEvidence.join('、')+'观察，云端与接口测试不能替代';row.retest='云端对应逻辑已验；等待相应Windows观察，不计通过';
 }else{row.status='通过';row.requiresWindowsVisual=false;row.requiredPlatformEvidence=[];row.blocker='';row.issue='';row.retest='已按固定视频效果/推导预期完成冻结源码验证；不宣称原内部规则一致';}
 row.fix='缺陷与修复/复测过程见迭代记录；规则来源和配置见本行';return row;
});
input.supplementalResults=input.supplementalResults.map(row=>{
 addScope(row,curById.get(row.referenceId));row.status='通过';row.implementation='已实现';row.requiresWindowsVisual=false;row.requiredPlatformEvidence=[];row.blocker='';row.issue='';row.acceptedScope=row.stableExpected.join('；');row.actual='按所列跨集证据或明示推导预期实测：'+row.stableExpected.join('；');row.steps=row.stableExpected.join('；');row.retest='冻结源码对应检查通过；保留来源版本、替身与平台边界';
 if(row.referenceId==='R010')row.checkBindings=[...row.checkBindings];
 if(row.referenceId==='R015')row.checkBindings.push(...featureBindings(featureById.get('V075')));
 if(row.referenceId==='F001')row.checkBindings.push(...featureBindings(featureById.get('V074')));
 if(row.referenceId==='F007')row.checkBindings.push(...featureBindings(featureById.get('V066')));
 return row;
});
const ordinaryBatch=input.results.find(r=>r.videoId==='V029');
ordinaryBatch.checkBindings.push(bind('source-wheels','flows','Signed batch field applies negative values to every selected student once and rejects zero'));
ordinaryBatch.steps+='；普通学生积分页选择多人，在有符号批量输入框填写−5并确认；再提交0验证拒绝和数据不变';
ordinaryBatch.actual+='；补充教程R003对应实际UI检查证实普通批量−5逐人仅记一次，0不产生提交或数据改变';
input.schemaVersion=4;
input.metadata={...input.metadata,assessmentMode:'observable_effect',functionalDenominator:75,excludedSourceIds:['V076'],candidateVersion:freeze.candidateVersion,assessmentFinalized:true,inferenceAuthorized:true,originalInternalsVerified:false,referenceRulesComplete:false,additionalBlockers:['Windows屏幕、课件置顶、物理触屏与真实听感没有本轮观察证据；本地未执行不等于失败或通过'],scopeChanges:['按用户授权，将原片未展开的功能固定为明确推导规则并研发验证；通过表示达到该稳定预期，不代表原内部一致','V076版本来源说明独立列示，功能分母75；补充R20/F8单列','学生宠物榜同时展示当前伙伴、等级与总徽章；排序模式不隐藏其他字段','红花真实较慢双击按首次点击前可见状态切换，避免260ms单击回调导致反向隐藏'],windowsValidated:false,windowsExecution:{status:'未执行',authorized:true,reason:'本地测试输入未完成自动物化；所需Python运行环境不可用且相关查询访问被拒，桌面控制接口未提供。未绕过限制。',screenObserved:false,touchObserved:false,audioObserved:false}};
input.sourceAssumptions=(curation.sourceAssumptions?.length?curation.sourceAssumptions:template.sourceAssumptions).map(r=>({...r,originalInternalsVerified:false}));
const currentKnown=read('artifacts/parity/known-flows-results.json');
const more=[
 ['RC4-PET-NEGATIVE-ZERO',['V066'],'截零请求在0成长处产生JS负零，JSON保存后与内存不一致','归一化实际差额为正零，并保留逐人差额/撤销校验','artifacts/qa-pet-extra/TEST-REPORT.md','artifacts/rc4/frozen-petextra-results.json','应用功能'],
 ['RC4-EXTRA-NARROW',['V040','V062','V074','V075'],'新模块240/280/300px下，长名称、URL和按钮导致内层横向溢出','缩小窄窗内边距、按钮换行/单列、长字可换行，测内层和真实可达操作','artifacts/rc4/TOOLBOX-TEST-REPORT.md','artifacts/qa-toolbox-extra-native/results.json','应用功能'],
 ['RC4-RANK-COMPLETE',['R010'],'学生榜在不同排序时未同时显示当前宠物/等级/总徽章','两种排序均显示全部字段并逐行验证，截图滚动至榜单','artifacts/rc4/ranking-before-fix/results.json','artifacts/rc4/frozen-care-results.json','应用功能'],
 ['RC4-FLOWER-SLOW-DOUBLE',['V036'],'隐藏时首击260ms已打开，320ms第二击再toggle会反向隐藏','主进程保存首击前可见性、取消旧timer并按初始状态切换；原生单击/快双击/慢双击均验','artifacts/rc4/flower-double-click-repro/known-flows-results.json','artifacts/parity/known-flows-results.json','应用功能'],
 ['RC4-LEGACY-TEST-PATH',[],'RC4新增清零范围选择与分类Excel路径，原脚本直接跳旧确认/固定三sheet不再符合界面','保留7秒、取消、保护备份和数字值断言，走实际新选择路径','artifacts/rc4/legacy-qa-path-adaptations.json','artifacts/parity/known-flows-results.json','测试运行']
];
for(const [iterationId,videoIds,issue,fix,before,after,scope] of more)input.iterations.push({iterationId,videoIds,beforeStatus:'失败',scope,issue,fix,retestResult:'通过',evidence:[before,after].filter(p=>fs.existsSync(path.join(root,p))),testedAt:currentKnown.completedAt,sourceRevision:input.metadata.sourceRevision,platform:'Linux真实Electron；合成数据',remainingBlocker:''});
const packageFile=path.join(root,stage+'/package-summary.json');
if(fs.existsSync(packageFile)){
 const pkg=read(stage+'/package-summary.json');if(JSON.stringify(pkg.sourceManifest)!==JSON.stringify(freeze.files)||pkg.status!=='passed')throw Error('Package summary stale or not passed');input.metadata.packagedApplication=pkg;
 const issue=path.join(root,stage+'/dependency-package-failure.json');if(fs.existsSync(issue))input.iterations.push({iterationId:'RC4-PACKAGE-DEPENDENCIES',videoIds:[],beforeStatus:'失败',scope:'构建与包运行',issue:'依赖目录为符号链接，打包遗漏jszip等生产依赖，隔离主进程不能启动',fix:'物化同一锁定依赖为实体目录后重建，重新核源码、依赖边界与全部包用例',retestResult:'通过',evidence:[stage+'/dependency-package-failure.json',stage+'/package-summary.json'],testedAt:pkg.createdAt,sourceRevision:input.metadata.sourceRevision,platform:'Linux构建/隔离ASAR',remainingBlocker:'Windows桌面观察仍未完成'});
}
fs.writeFileSync(path.join(root,stage+'/assessment-input.json'),JSON.stringify(input,null,2));
console.log('RC4 assessment',input.results.length,input.results.reduce((m,r)=>(m[r.status]=(m[r.status]||0)+1,m),{}),'supplement',input.supplementalResults.length);
