'use strict';
// Independent synthetic-domain audit. The target can be source or an extracted ASAR.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),runtime=path.resolve(process.env.RC18_AUDIT_RUNTIME||root),out=path.resolve(process.env.RC18_AUDIT_OUT||path.join(root,'artifacts/rc18-independent/source-domain'));
fs.mkdirSync(out,{recursive:true});
const Core=require(path.join(runtime,'src/core.cjs')),Rules=require(path.join(runtime,'src/score-rules.js')),Progress=require(path.join(runtime,'src/pet-progress.js'));
const clone=v=>structuredClone(v),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const act=(s,a)=>Core.applyAction(s,a,1700000000000),pid=Core.panelId,results=[];
const save=(s,rules,extra={})=>act(s,{type:'rules.save',rules,expectedRules:Rules.list(s),expectedKey:Rules.key(s),panelId:pid(s),...extra});
const share=s=>act(s,{type:'rules.share',confirmed:true,expectedKey:Rules.previewShared(s).expectedKey,panelId:pid(s)});
const edit=(s,patch)=>save(s,Rules.list(s).map((r,i)=>i?r:{...r,...patch}));
function fixture(n=2,count=2,{same=false}={}){
 const entries=Array.from({length:n},(_,p)=>{const s=Core.createInitialState();s.settings.className=`合成审计${p+1}班`;s.students=s.students.slice(0,2).map((v,i)=>({...v,id:`student_${p}_${i}`,name:`合成学生${p}_${i}`}));s.settings.scoreRules=Array.from({length:count},(_,i)=>({id:`rule_${i}`,label:`${same?'相同':p}原因${i}`,delta:i%2?-1:2}));return {id:`panel_${String(p).padStart(2,'0')}`,data:s};});
 const [first,...others]=entries;return Core.validateState({...first.data,panels:{activeId:first.id,others}});
}
function allPanels(s){return[{id:pid(s),data:s},...(s.panels?.others||[])];}
function histories(s){return Object.fromEntries(allPanels(s).map(p=>[p.id,{students:p.data.students,logs:p.data.logs,petLogs:p.data.petLogs,petAccounts:p.data.petAccounts,draw:p.data.draw,timer:p.data.timer}]));}
function mirrored(s){const expected=Rules.list(s);for(const p of allPanels(s))assert.deepEqual(p.data.settings.scoreRules,expected,`mirror ${p.id}`);assert.deepEqual(Core.validateState(clone(s)),s);}
function rejected(s,a,pattern){const before=clone(s);assert.throws(()=>act(s,a),pattern);assert.deepEqual(s,before);}
async function check(id,name,run){const started=Date.now();try{const detail=await run();results.push({id,name,status:'passed',durationMs:Date.now()-started,detail});console.log(`PASS ${id} ${name}`);}catch(e){results.push({id,name,status:'failed',classification:'product-or-contract-review',durationMs:Date.now()-started,error:e.stack});console.error(`FAIL ${id} ${name}\n${e.stack}`);}fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report(),null,2));}
function report(){return{runtime,syntheticOnly:true,windowsExecuted:false,layer:'independent Node domain behavior',runtimeHashes:Object.fromEntries(['src/core.cjs','src/score-rules.js','src/pet-progress.js','src/pet-ledger.cjs'].map(n=>[n,sha(fs.readFileSync(path.join(runtime,n)))])),passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,results};}
(async()=>{
await check('D01','different legacy variants require explicit consent and preserve the input',()=>{
 const s=fixture(),before=clone(s),p=Rules.previewShared(s);assert.equal(p.required,true);assert.equal(p.rules.length,4);assert.deepEqual(s,before);
 rejected(s,{type:'rules.save',rules:Rules.list(s),expectedRules:Rules.list(s)},/合并|共享/);
 rejected(s,{type:'rules.share',expectedKey:p.expectedKey},/确认/);
 rejected(s,{type:'rules.share',confirmed:true,expectedKey:p.expectedKey+'stale'},/变化|预览|修改/);
 const next=share(s);assert.equal(Rules.list(next).length,4);assert.deepEqual(histories(next),histories(s));assert.deepEqual(next.sharedScoreRules.migration.panels,p.panels);mirrored(next);
 fs.writeFileSync(path.join(out,'legacy-before.json'),JSON.stringify(s,null,2));fs.writeFileSync(path.join(out,'shared-after.json'),JSON.stringify(next,null,2));
});
await check('D02','generated migration IDs avoid existing IDs and preserve absent versus zero growth',()=>{
 const s=fixture(3,2);s.settings.scoreRules=[{id:'shared_0001',label:'保留编号',delta:2},{id:'rule_x',label:'相同文字',delta:2}];
 s.panels.others[0].data.settings.scoreRules=[{id:'shared_0001',label:'冲突编号',delta:-3},{id:'rule_x',label:'相同文字',delta:2,growthDelta:0}];
 s.panels.others[1].data.settings.scoreRules=[{id:'rule_z',label:'相同文字',delta:2,growthDelta:3},{id:'rule_x',label:'相同文字',delta:2}];
 for(const panel of allPanels(s))panel.data.version=2;const p=Rules.previewShared(s),next=share(s);assert.equal(p.rules.length,5);assert.equal(new Set(p.rules.map(r=>r.id)).size,5);
 assert.equal(p.rules.find(r=>r.id==='shared_0001').label,'保留编号');assert.ok(p.conflicts.some(x=>x.kind==='id'));assert.ok(p.conflicts.some(x=>x.kind==='label'));
 for(const panel of p.panels)for(const rule of panel.rules){const mapping=p.mappings.find(m=>m.panelId===panel.id&&m.ruleId===rule.id),converted=p.rules.find(r=>r.id===mapping.sharedRuleId);assert.deepEqual({...converted,id:rule.id},rule);}
 assert.deepEqual(Core.validateState(clone(next)),next);return{rules:p.rules,mappingCount:p.mappings.length};
});
await check('D03','migration union is stable after switching which legacy panel is active',()=>{
 const s=fixture(4,3),p=Rules.previewShared(s),switched=act(s,{type:'panel.switch',id:s.panels.others[2].id}),q=Rules.previewShared(switched);
 assert.deepEqual(q.rules,p.rules);assert.deepEqual(q.mappings,p.mappings);assert.deepEqual(q.panels,p.panels);assert.equal(q.expectedKey,p.expectedKey);
});
await check('D04','20 legacy panels preserve every one of 2,000 variants through validation and JSON round trip',()=>{
 const s=fixture(20,100),p=Rules.previewShared(s);assert.equal(p.rules.length,2000);assert.equal(p.mappings.length,2000);
 const next=share(s);assert.equal(Rules.list(next).length,2000);mirrored(next);assert.deepEqual(Core.validateState(JSON.parse(JSON.stringify(next))),next);
 const edited=edit(next,{label:'第两千张联合集合仍可编辑'});assert.equal(Rules.list(edited).length,2000);mirrored(edited);
 const switched=act(edited,{type:'panel.switch',id:edited.panels.others.at(-1).id});mirrored(switched);assert.deepEqual(switched.sharedScoreRules.migration,next.sharedScoreRules.migration);
 fs.writeFileSync(path.join(out,'max-union.json'),JSON.stringify(switched));return{rules:2000,panels:20,stateBytes:Buffer.byteLength(JSON.stringify(switched))};
});
await check('D05','shared edits survive blank, roster copy and full copy without rewriting histories or snapshots',()=>{
 for(const mode of ['blank','copy','full']){let s=share(fixture(2,3));s=act(s,{type:'score',ids:[s.students[0].id],delta:4,reason:'共享前历史'});s=edit(s,{label:'全班共享',delta:7,growthDelta:2});const before=clone(s),original=pid(s),snapshot=clone(s.sharedScoreRules.migration);
  let next=act(s,{type:'panel.create',mode,name:`合成${mode}班`});mirrored(next);assert.deepEqual(next.sharedScoreRules,before.sharedScoreRules);assert.deepEqual(next.panels.others.find(p=>p.id===original).data.logs,before.logs);
  next=edit(next,{label:`在${mode}新班修改`});const updated=clone(Rules.list(next));next=act(next,{type:'panel.switch',id:original});assert.deepEqual(Rules.list(next),updated);mirrored(next);assert.deepEqual(next.logs,before.logs);assert.deepEqual(next.sharedScoreRules.migration,snapshot);
 }
});
await check('D06','removing the panel that initiated sharing does not remove canonical rules or snapshots',()=>{
 let s=share(fixture(3,3));const snapshot=clone(s.sharedScoreRules.migration),r=Rules.list(s);s=act(s,{type:'panel.remove'});assert.deepEqual(Rules.list(s),r);assert.deepEqual(s.sharedScoreRules.migration,snapshot);mirrored(s);
 s=act(s,{type:'panel.remove'});assert.deepEqual(Rules.list(s),r);mirrored(s);rejected(s,{type:'panel.remove'},/至少/);
});
await check('D07','equal legacy panels promote without creating duplicate cards',()=>{
 const s=fixture(3,3,{same:true});assert.equal(Rules.previewShared(s).required,false);const next=edit(s,{label:'一致旧规则直接共享'});assert.equal(Rules.list(next).length,3);mirrored(next);assert.equal(next.sharedScoreRules.migration.mappings.length,9);
});
await check('D08','stale shared editor rejects same-value ABA revision while unrelated scoring remains compatible',()=>{
 const original=share(fixture()),rules=Rules.list(original),expectedKey=Rules.key(original),originalRevision=original.sharedScoreRules.revision;
 let s=edit(original,{label:'B'});s=save(s,rules);assert.deepEqual(Rules.list(s),rules);assert.notEqual(Rules.key(s),expectedKey);
 rejected(s,{type:'rules.save',rules,expectedRules:rules,expectedKey},/变化|修改/);rejected(s,{type:'rules.save',rules,expectedRules:rules,sharedRevision:originalRevision},/变化|修改/);
 const scored=act(original,{type:'score',ids:[original.students[0].id],delta:2,reason:'等待编辑时记分'});const next=save(scored,rules.map((r,i)=>i?r:{...r,label:'允许无关记分'}),{expectedKey});assert.deepEqual(next.logs,scored.logs);assert.deepEqual(next.students,scored.students);
});
await check('D09','late score snapshots reject changed shared rules and preserve earlier recorded arithmetic',()=>{
 let s=share(fixture());const rule=Rules.list(s)[0],request={type:'score',ids:[s.students[0].id],delta:rule.delta,reason:rule.label,expectedRule:rule,panelId:pid(s)};
 const scored=act(s,request),record=clone(scored.logs.at(-1));s=edit(scored,{label:'新共享原因',delta:9,growthDelta:0});rejected(s,request,/规则|卡片/);assert.deepEqual(s.logs.at(-1),record);
 const undone=act(s,{type:'undo',logId:record.id});assert.deepEqual(undone.students,scored.students.map((v,i)=>i?v:{...v,score:v.score-rule.delta,growth:v.growth-Math.max(0,rule.delta)}));
});
await check('D10','member append and replacement preserve root shared configuration and inactive panels',()=>{
 for(const mode of ['append','replace']){const s=share(fixture()),snapshot=clone(s.sharedScoreRules),inactive=clone(s.panels.others);const next=Core.importRows([{name:'合成导入同学',group:'合成组'}],s,mode);assert.deepEqual(next.sharedScoreRules,snapshot);assert.deepEqual(next.panels.others,inactive);mirrored(next);}
});
await check('D11','canonical state rejects detached nested metadata, divergent mirrors and legacy over-cap arrays',()=>{
 const s=share(fixture());for(const mutation of [x=>x.panels.others[0].data.sharedScoreRules=clone(x.sharedScoreRules),x=>x.panels.others[0].data.settings.scoreRules[0].delta=99,x=>x.settings.scoreRules[0].delta=99,x=>x.version=1]){const bad=clone(s);mutation(bad);assert.throws(()=>Core.validateState(bad));}
 const old=fixture(1,100);old.settings.scoreRules.push({id:'rule_101',label:'超限旧卡片',delta:1});assert.throws(()=>Core.validateState(old),/100/);
});
await check('D12','migration archive and mapping remain verifiable after removal of current shared card',()=>{
 let s=share(fixture());const archive=clone(s.sharedScoreRules.migration);s=save(s,Rules.list(s).slice(1));assert.deepEqual(s.sharedScoreRules.migration,archive);mirrored(s);
 const bad=clone(s);bad.sharedScoreRules.migration.mappings[0].sharedRuleId='corrupt_mapping';assert.throws(()=>Core.validateState(bad),/映射/);
});
await check('D13','changed thresholds have exact boundaries and do not rewrite score or growth history',()=>{
 let s=share(fixture(1));s=act(s,{type:'pet.stage-rules',thresholds:[2,3,4,5,6,7]});s=act(s,{type:'pet.growth',ids:[s.students[0].id],delta:27,reason:'合成边界成长'});const before=clone(s),log=s.petLogs.at(-1);const costs=[3,4,5,6,7,8];s=act(s,{type:'pet.stage-rules',thresholds:costs});assert.deepEqual(s.students,before.students);assert.deepEqual(s.petLogs,before.petLogs);assert.deepEqual(s.petAccounts,before.petAccounts);assert.deepEqual(s.logs,before.logs);
 let boundary=0;for(let level=1;level<=7;level++){assert.equal(Progress.progress(boundary,costs).level,level);if(boundary)assert.equal(Progress.progress(boundary-1,costs).level,level-1);if(level<7)boundary+=costs[level-1];}assert.equal(Progress.progress(34,costs).overflow,1);
 s=act(s,{type:'pet.undo',logId:log.id});assert.equal(Progress.profile(s,s.students[0]).growth,0);mirrored(s);
});
await check('D14','graduation keeps permanent old threshold snapshot after shared rule and threshold edits',()=>{
 let s=share(fixture(1));s=act(s,{type:'pet.stage-rules',thresholds:[1,2,3,4,5,6]});s=act(s,{type:'pet.growth',ids:[s.students[0].id],delta:21});s=act(s,{type:'pet.graduate',id:s.students[0].id});const old=clone(Progress.profile(s,s.students[0]).graduates),medals=Progress.profile(s,s.students[0]).medalTotal;
 s=edit(s,{delta:-3,growthDelta:4});s=act(s,{type:'pet.stage-rules',thresholds:[9,8,7,6,5,4]});assert.deepEqual(Progress.profile(s,s.students[0]).graduates,old);assert.equal(Progress.profile(s,s.students[0]).medalTotal,medals);assert.deepEqual(old[0].ruleSnapshot.thresholds,[1,2,3,4,5,6]);assert.deepEqual(Core.validateState(clone(s)),s);
});
await check('D15','full JSON restore round trip retains shared revision, migrations and 2,000 card mirrors',()=>{
 const s=JSON.parse(fs.readFileSync(path.join(out,'max-union.json')));const restored=Core.validateState(clone(s));assert.deepEqual(restored,s);mirrored(restored);assert.equal(restored.sharedScoreRules.migration.panels.length,20);
});
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report(),null,2));console.log(JSON.stringify({passed:report().passed,failed:report().failed,out}));process.exitCode=report().failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
