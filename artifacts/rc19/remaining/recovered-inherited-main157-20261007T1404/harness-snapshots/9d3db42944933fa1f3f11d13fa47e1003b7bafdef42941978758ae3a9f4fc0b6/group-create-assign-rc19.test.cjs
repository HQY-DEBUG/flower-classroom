'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../src/core.cjs'),Groups=require('../src/group-tools.js');
const fixture=()=>{const s=Core.createInitialState();s.students=s.students.slice(0,3);s.students.forEach((v,i)=>{v.name='合成学生'+i;v.group=i<2?'合成甲组':'合成乙组';v.score=20+i;v.growth=8+i;v.leader=i===0;});s.groupBases=[{group:'合成保留空组',score:0}];s.version=2;return s;};
const snapshot=(s,ids)=>s.students.filter(v=>ids.includes(v.id)).map(({id,group})=>({id,group}));
const request=(s,extra={})=>{const ids=s.students.slice(0,2).map(v=>v.id);return {type:'students.group.create',ids,expectedAssignments:snapshot(s,ids),group:'合成新组',panelId:Core.panelId(s),...extra};};
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};

test('create-and-assign prepares a pure patch and preserves the source when its selection is stale',()=>{
 const s=fixture(),ids=s.students.slice(0,2).map(v=>v.id),expected=snapshot(s,ids),before=structuredClone(s);freeze(s);
 const patch=Groups.createAndAssignPatch(s,ids,expected,'  合成新组  ');
 assert.equal(patch.group,'合成新组');assert.deepEqual(patch.groupBases,[...s.groupBases,{group:'合成新组',score:0}]);assert.deepEqual(s,before);
 assert.throws(()=>Groups.createAndAssignPatch(s,ids,[{...expected[0],group:'旧组'},expected[1]],'合成新组'),/已变化/);assert.deepEqual(s,before);
});
test('one action creates one group and assigns chosen students with one revision, preserving every other student field and history',()=>{
 const s=fixture();s.students[0].photo=require('./pet-fixtures.cjs').SYNTHETIC_PNG;const before=structuredClone(s),action=request(s),after=Core.applyAction(s,action);
 assert.equal(after.revision,s.revision+1);assert.equal(after.version,2);assert.deepEqual(after.groupBases,[...s.groupBases,{group:'合成新组',score:0}]);
 assert.deepEqual(after.students.map(v=>v.group),['合成新组','合成新组','合成乙组']);
 assert.deepEqual(after.students.map(({group,...v})=>v),s.students.map(({group,...v})=>v));
 for(const key of ['logs','petAccounts','petLogs','groupLogs','panels'])assert.deepEqual(after[key],s[key]);
 assert.deepEqual(s,before);assert.deepEqual(Core.validateState(after),after);
});
test('new group uses saved order and removes member-only groups that lost their last members',()=>{
 const s=fixture();s.settings.groupOrder=['合成乙组','合成甲组','合成保留空组'];
 const after=Core.applyAction(s,request(s));assert.deepEqual(after.settings.groupOrder,['合成乙组','合成保留空组','合成新组']);
 const legacy=fixture();assert.equal(Core.applyAction(legacy,request(legacy)).settings.groupOrder,undefined);
});
test('blank, whitespace, duplicate, malformed and over-limit names never create a group or move anyone',()=>{
 const s=fixture(),before=structuredClone(s);
 for(const group of ['', '   ', '合成甲组',' 合成保留空组 ', 'a\n组', '😀'.repeat(41), null, 5]){
  assert.throws(()=>Core.applyAction(s,request(s,{group})));assert.deepEqual(s,before);
 }
 const full=fixture();full.groupBases=Array.from({length:300},(_,i)=>({group:'合成空组'+i,score:0}));const fullBefore=structuredClone(full);
 assert.throws(()=>Core.applyAction(full,request(full)),/300/);assert.deepEqual(full,fullBefore);
});
test('a new-group assignment requires a current panel and complete unique current student snapshot',()=>{
 const s=fixture(),before=structuredClone(s),a=request(s);
 const variants=[{panelId:undefined},{panelId:'other'},{ids:[]},{ids:[a.ids[0],a.ids[0]]},{ids:['missing']},{expectedAssignments:undefined},{expectedAssignments:[]},{expectedAssignments:[a.expectedAssignments[0],a.expectedAssignments[0]]},{expectedAssignments:[{...a.expectedAssignments[0],group:'旧组'},a.expectedAssignments[1]]}];
 for(const extra of variants){assert.throws(()=>Core.applyAction(s,{...a,...extra}));assert.deepEqual(s,before);}
});
test('changed or removed students and a concurrently created target fail atomically; current scores remain intact',()=>{
 const s=fixture(),a=request(s),changed=Core.applyAction(s,{type:'students.group',ids:[a.ids[0]],group:'另一组'});
 assert.throws(()=>Core.applyAction(changed,a),/已变化/);assert.equal(changed.groupBases.some(v=>v.group===a.group),false);
 const removed=Core.applyAction(s,{type:'student.remove',id:a.ids[0]});assert.throws(()=>Core.applyAction(removed,a));assert.equal(removed.groupBases.some(v=>v.group===a.group),false);
 const created=Core.applyAction(s,{type:'group.create',group:a.group,panelId:a.panelId});assert.throws(()=>Core.applyAction(created,a),/同名/);
 const scored=Core.applyAction(s,{type:'score',ids:[a.ids[0]],delta:3,reason:'合成加分'}),after=Core.applyAction(scored,a);
 assert.equal(after.students[0].score,scored.students[0].score);assert.equal(after.students[0].growth,scored.students[0].growth);assert.deepEqual(after.logs,scored.logs);
});
test('repeated same action cannot create duplicate group or move students a second time',()=>{
 const s=fixture(),a=request(s),after=Core.applyAction(s,a),before=structuredClone(after);
 assert.throws(()=>Core.applyAction(after,a),/同名/);assert.deepEqual(after,before);assert.equal(after.groupBases.filter(v=>v.group===a.group).length,1);
});
