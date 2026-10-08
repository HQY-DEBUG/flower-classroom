'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../src/core.cjs'),Tools=require('../src/organization-tools.js'),Progress=require('../src/pet-progress.js'),Ledger=require('../src/pet-ledger.cjs');
const clone=v=>JSON.parse(JSON.stringify(v));
const Rules=require('../src/score-rules.js');
// RC18 full copies retain independent classroom data but mirror one shared catalog.
const mirroredSource=require('./shared-rule-fixtures.cjs').mirroredLegacyPanel;
const archived=name=>Core.validateState(require('./rc18-regression-fixtures.cjs').historical(name));
const run=(s,a)=>Core.applyAction(s,a,1000000);
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRj8AAAAASUVORK5CYII=';
const options=patch=>({scores:false,groupScores:false,petGrowth:false,history:false,petHistory:false,...patch});
const clear=(s,patch)=>run(s,{type:'points.clear',options:options(patch),expectedRevision:s.revision,confirmed:true,panelId:Core.panelId(s)});
test('RC4 old JSON validation introduces no display order or draw sessions',()=>{const s=Core.createInitialState();assert.deepEqual(Core.validateState(clone(s)),s);assert.equal(s.settings.studentSort,undefined);assert.equal(s.drawSessions,undefined);});
test('RC4 display sorts are stable pure views and never disturb roster, photos, score records or draw pools',()=>{
 let s=run(Core.createInitialState(),{type:'draw',count:2});s.students[0].name='同学10';s.students[1].name='同学2';s.students[0].score=10;s.students[1].score=-5;s.students[2].leader=true;s.students[3].growth=70;s.students[3].photo=PNG;
 const before=clone(s),ids=s.students.map(v=>v.id);
 assert.equal(Tools.sortedStudents(s,s.students,'name').filter(v=>v.name.startsWith('同学'))[0].name,'同学2');
 assert.equal(Tools.sortedStudents(s,s.students,'scoreDesc')[0].id,ids[0]);assert.equal(Tools.sortedStudents(s,s.students,'scoreAsc')[0].id,ids[1]);
 assert.equal(Tools.sortedStudents(s,s.students,'growth')[0].id,ids[0]);assert.equal(Tools.sortedStudents(s,s.students,'level')[0].id,ids[0]);assert.equal(Tools.sortedStudents(s,s.students,'leader')[0].id,ids[2]);
 assert.deepEqual(s,before);assert.notEqual(Tools.sortedStudents(s),s.students);
 for(const mode of Object.keys(Tools.sorts)){const next=run(s,{type:'students.sort',mode});assert.deepEqual(next.students,s.students);assert.deepEqual(next.draw,s.draw);assert.deepEqual(next.drawSessions,s.drawSessions);assert.deepEqual(next.logs,s.logs);}
});
test('RC4 score-derived pet sorting ignores archived graduation and growth while preserving history',()=>{
 const s=archived('organization'),id=s.students[0].id;s.students[1].score=15;const before=clone(s);
 assert.equal(Tools.sortedStudents(s,s.students,'growth')[0].id,s.students[1].id);assert.equal(Tools.sortedStudents(s,s.students,'level')[0].id,s.students[1].id);
 assert.equal(Progress.profile(s,id).graduates.length,1);assert.deepEqual(s,before);
});

test('RC4 custom order is guarded, panel local, reconciles add/remove and does not mutate archive order',()=>{
 let s=Core.createInitialState(),original=s.students.map(v=>v.id),reversed=[...original].reverse();s=run(s,{type:'students.order',order:reversed,expectedOrder:original,panelId:Core.panelId(s)});assert.deepEqual(s.students.map(v=>v.id),original);assert.deepEqual(Tools.sortedStudents(s).map(v=>v.id),reversed);
 assert.throws(()=>run(s,{type:'students.order',order:original,expectedOrder:original,panelId:Core.panelId(s)}),/已变化/);
 assert.throws(()=>run(s,{type:'students.order',order:reversed,expectedOrder:reversed,panelId:'wrong'}),/面板/);
 s=run(s,{type:'student.add',name:'新增',group:'新增组'});assert.equal(Tools.customOrder(s).at(-1),s.students.at(-1).id);s=run(s,{type:'student.remove',id:reversed[0]});assert.equal(Tools.customOrder(s).includes(reversed[0]),false);
 assert.deepEqual(Core.validateState(clone(s)),s);
});
test('RC4 full-state copy preserves all state values and source, assigns independent IDs and supports independent undo',()=>{
 let source=archived('organization'),id=source.students[0].id;source=run(source,{type:'student.update',id,photo:PNG});source=run(source,{type:'draw',scope:'groups',count:2});source=run(source,{type:'students.order',order:[...source.students.map(v=>v.id)].reverse(),expectedOrder:source.students.map(v=>v.id),panelId:Core.panelId(source)});
 const before=clone(source),copy=run(source,{type:'panel.create',mode:'full',name:'完整状态副本'});assert.deepEqual(source,before);assert.deepEqual(copy.panels.others[0].data,mirroredSource(source));assert.deepEqual(copy.sharedScoreRules.rules,Rules.list(source));assert.equal(copy.students[0].photo,PNG);assert.equal(copy.students[0].score,7);assert.equal(copy.students[0].growth,7);assert.equal(copy.students[0].leader,true);assert.notEqual(copy.students[0].id,id);assert.notEqual(copy.logs[0].id,source.logs[0].id);assert.notEqual(copy.petAccounts[0].id,source.petAccounts[0].id);assert.notEqual(copy.petAccounts[0].cycles[0].id,source.petAccounts[0].cycles[0].id);
 assert.equal(Progress.profile(copy,copy.students[0]).graduates.length,1);assert.equal(Progress.profile(copy,copy.students[0]).growth,7);assert.deepEqual(copy.draw.lastGroups,source.draw.lastGroups);assert.ok(copy.draw.lastIds.every(id=>copy.students.some(v=>v.id===id)));assert.deepEqual(Core.validateState(clone(copy)),copy);
 const undone=run(copy,{type:'undo',logId:copy.logs[0].id});assert.equal(undone.students[0].score,0);assert.equal(Progress.profile(undone,undone.students[0]).growth,0);assert.deepEqual(undone.panels.others[0].data,mirroredSource(source));assert.throws(()=>run(copy,{type:'undo',logId:source.logs[0].id}),/找不到/);
});
test('RC4 full copy remaps activity live and historical references while preserving textual ID-like names',()=>{
 const state={students:[{id:'s1',name:'s1'}],settings:{petFocusId:'s1',studentOrder:['s1']},draw:{mode:'cycle',bag:['s1'],lastIds:[],round:1},toolboxExtra:{homework:{tasks:[{id:'t1',submittedIds:['s1']}],history:[{id:'h1',taskId:'t1',members:[{id:'s1',name:'s1',group:'s1'}]}]}},petOperations:[{id:'operation'}]};let i=0;const copied=Tools.copyPanel(state,()=>`new${++i}`);assert.notEqual(copied.students[0].id,'s1');assert.equal(copied.students[0].name,'s1');assert.equal(copied.settings.petFocusId,copied.students[0].id);assert.equal(copied.toolboxExtra.homework.tasks[0].submittedIds[0],copied.students[0].id);assert.equal(copied.toolboxExtra.homework.history[0].taskId,copied.toolboxExtra.homework.tasks[0].id);assert.equal(copied.toolboxExtra.homework.history[0].members[0].group,'s1');assert.notEqual(copied.petOperations[0].id,'operation');
});
test('RC4 full-state reducer copy remaps real homework live/history, links and score text independently',()=>{
 const Extra=require('../src/toolbox-extra.js');let s=Core.createInitialState(),id=s.students[0].id;s=run(s,{type:'student.update',id,name:id});s=run(s,{type:'score',ids:[id],delta:2,reason:id});
 for(const action of [{type:'toolbox.link.add',id:'link1',title:id,url:'https://example.com/'+id},{type:'toolbox.homework.add',id:'task1',title:id,subject:'语文',date:'2026-10-02'},{type:'toolbox.homework.set',id:'task1',studentId:id,submitted:true},{type:'toolbox.homework.reset',id:'task1',historyId:'history1',confirmed:true},{type:'toolbox.homework.set',id:'task1',studentId:id,submitted:true}])s=run(s,{...Extra.expectation(s),...action});
 const copy=run(s,{type:'panel.create',mode:'full',name:'含工具完整副本'}),newId=copy.students[0].id;assert.notEqual(newId,id);assert.equal(copy.students[0].name,id);assert.equal(copy.logs[0].reason,id);assert.equal(copy.logs[0].changes[0].name,id);assert.equal(copy.toolboxExtra.links[0].title,id);assert.equal(copy.toolboxExtra.links[0].url,s.toolboxExtra.links[0].url);assert.equal(copy.toolboxExtra.homework.tasks[0].submittedIds[0],newId);assert.equal(copy.toolboxExtra.homework.history[0].members[0].id,newId);assert.equal(copy.toolboxExtra.homework.history[0].members[0].name,id);assert.equal(copy.toolboxExtra.homework.history[0].taskId,copy.toolboxExtra.homework.tasks[0].id);assert.notEqual(copy.toolboxExtra.homework.tasks[0].id,'task1');assert.deepEqual(Core.validateState(clone(copy)),copy);assert.deepEqual(copy.panels.others[0].data,mirroredSource(s));assert.deepEqual(copy.sharedScoreRules.rules,Rules.list(s));
});
test('RC4 clear default retains ordinary semantics including pet growth history; explicit choices are independent',()=>{
 let s=archived('clear'),id=s.students[0].id;s=run(s,{type:'group.base',group:s.students[0].group,delta:4});const before=clone(s);
 const normal=run(s,{type:'points.clear'});assert.equal(normal.students[0].score,0);assert.equal(normal.groupBases[0].score,0);assert.equal(normal.logs.length,0);assert.equal(normal.groupLogs.length,0);assert.deepEqual(normal.petLogs,s.petLogs);assert.deepEqual(normal.petAccounts,s.petAccounts);
 const scores=clear(s,{scores:true});assert.equal(scores.students[0].score,0);assert.equal(scores.groupBases[0].score,4);assert.deepEqual(scores.logs,s.logs);assert.deepEqual(scores.petAccounts,s.petAccounts);
 const history=clear(s,{petHistory:true});assert.equal(history.petLogs.length,0);assert.deepEqual(history.logs,s.logs);assert.deepEqual(history.petAccounts,s.petAccounts);assert.deepEqual(history.students,s.students);assert.deepEqual(s,before);
});
test('RC4 retired growth clear and growth undo reject atomically without erasing archived periods',()=>{
 const s=archived('clear'),before=clone(s);
 assert.throws(()=>clear(s,{petGrowth:true}),/停用|统一/);
 for(const log of s.petLogs)assert.throws(()=>run(s,{type:'pet.undo',logId:log.id}),/停用|统一/);
 assert.deepEqual(s,before);assert.deepEqual(Core.validateState(clone(s)),s);
 const scored=run(s,{type:'score',ids:[s.students[0].id],delta:2});const undone=run(scored,{type:'undo',logId:scored.logs.at(-1).id});assert.deepEqual(undone.students,s.students);assert.deepEqual(undone.petAccounts,s.petAccounts);assert.deepEqual(undone.petLogs,s.petLogs);
});

test('RC4 global score clearing preserves graduated records and unrelated panels; growth reset is retired',()=>{
 const old=archived('organization');const s=run(old,{type:'panel.create',mode:'full',name:'副本'}),before=clone(s);
 assert.throws(()=>clear(s,{petGrowth:true,history:true,petHistory:true}),/停用|统一/);assert.deepEqual(s,before);
 const reset=clear(s,{scores:true});assert.equal(Progress.profile(reset,reset.students[0]).level,0);assert.deepEqual(reset.petAccounts,s.petAccounts);assert.deepEqual(reset.petLogs,s.petLogs);assert.equal(Progress.profile(reset,reset.students[0]).graduates.length,1);assert.deepEqual(reset.panels,s.panels);assert.deepEqual(Core.validateState(clone(reset)),reset);
});

test('RC4 destructive choice validation rejects missing consent, stale revision and ambiguous options',()=>{
 const s=Core.createInitialState(),before=clone(s);for(const action of [{options:options({})},{options:options({scores:true})},{options:options({scores:true}),confirmed:true,expectedRevision:99},{options:{scores:true},confirmed:true,expectedRevision:s.revision}])assert.throws(()=>run(s,{type:'points.clear',...action}));assert.deepEqual(s,before);
});
test('RC4 ordinary group drawing excludes empty groups, exhausts each round, and rewards every member',()=>{
 let s=Core.createInitialState();s=run(s,{type:'group.create',group:'空组',panelId:Core.panelId(s)});const first=run(s,{type:'draw',scope:'groups',count:3}),last=run(first,{type:'draw',scope:'groups',count:3});assert.equal(first.draw.lastGroups.length,3);assert.equal(first.draw.lastIds.length,9);assert.equal(last.draw.lastGroups.length,1);assert.equal(last.draw.lastIds.length,3);assert.equal(last.draw.round,1);assert.equal(new Set([...first.draw.lastGroups,...last.draw.lastGroups]).size,4);assert.equal(run(last,{type:'draw',scope:'groups',count:3}).draw.round,2);assert.ok(!first.draw.lastGroups.includes('空组'));
 const awards=first.draw.lastIds.map(id=>({id,delta:3})),awarded=run(first,{type:'score.mixed',awards,expectedDraw:Tools.drawKey(first)});assert.equal(awarded.logs.length,1);assert.equal(awarded.logs[0].changes.length,9);assert.equal(awarded.students.reduce((n,s)=>n+s.score,0),27);const undone=run(awarded,{type:'undo',logId:awarded.logs[0].id});assert.deepEqual(undone.students,first.students);
 assert.throws(()=>run(last,{type:'score',ids:first.draw.lastIds,delta:3,expectedDraw:Tools.drawKey(first)}),/点名结果已变化/);
});
test('RC4 four scope/mode sessions resume independently and only selected reset changes that pool',()=>{
 let s=run(Core.createInitialState(),{type:'draw',scope:'students',mode:'cycle',count:2});const studentPool=clone(s.draw);s=run(s,{type:'draw',scope:'groups',mode:'cycle',count:1});const groupPool=clone(s.draw);s=run(s,{type:'draw',scope:'students',mode:'repeat',count:3});const repeatPool=clone(s.draw);s=run(s,{type:'draw',scope:'groups',mode:'repeat',count:2});
 const values=({eventId,...v})=>v;s=run(s,{type:'draw.select',scope:'students',mode:'cycle'});assert.deepEqual(values(s.draw),values(studentPool));assert.notEqual(s.draw.eventId,studentPool.eventId);const resumedStudentPool=clone(s.draw);s=run(s,{type:'draw.select',scope:'groups',mode:'cycle'});assert.deepEqual(values(s.draw),values(groupPool));assert.notEqual(s.draw.eventId,groupPool.eventId);s=run(s,{type:'draw.reset'});assert.equal(s.draw.round,0);assert.deepEqual(s.drawSessions.students_cycle,resumedStudentPool);assert.deepEqual(s.drawSessions.students_repeat,repeatPool);assert.deepEqual(Core.validateState(clone(s)),s);
});
test('RC4 grouping invalidates group snapshots but preserves student cycles; roster change clears both safely',()=>{
 let s=run(Core.createInitialState(),{type:'draw',scope:'students',count:2});const students=clone(s.draw);s=run(s,{type:'draw',scope:'groups',count:2});s=run(s,{type:'students.group',ids:[s.students[0].id],group:'新组'});assert.equal(s.draw.lastIds.length,0);assert.deepEqual(s.drawSessions.students_cycle,students);s=run(s,{type:'student.remove',id:s.students[1].id});assert.equal(s.draw.lastIds.length,0);assert.equal(s.drawSessions.students_cycle,undefined);assert.deepEqual(Core.validateState(clone(s)),s);
});
test('RC4 group draw handles 300 members and validates snapshots and pool integrity',()=>{
 let s=Core.createInitialState();s.students=Array.from({length:300},(_,i)=>({...s.students[i%12],id:'synthetic_'+i,group:'大组'}));s=run(s,{type:'draw',scope:'groups',count:1});assert.equal(s.draw.lastIds.length,300);s=run(s,{type:'score.mixed',awards:s.draw.lastIds.map(id=>({id,delta:1}))});assert.equal(s.logs[0].changes.length,300);assert.equal(s.students.reduce((n,s)=>n+s.score,0),300);const bad=clone(s);bad.draw.groups[0].ids.reverse();assert.throws(()=>Core.validateState(bad),/快照/);const badPool=clone(s);badPool.drawSessions.groups_cycle.lastIds=[];assert.throws(()=>Core.validateState(badPool),/快照|不一致/);
});
