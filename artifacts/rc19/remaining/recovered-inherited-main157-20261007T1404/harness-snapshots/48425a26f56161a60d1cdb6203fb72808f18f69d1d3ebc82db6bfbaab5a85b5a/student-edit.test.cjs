'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../src/core.cjs'),Progress=require('../src/pet-progress.js');
const run=(s,a)=>Core.applyAction(s,a,1_000_000),clone=s=>JSON.parse(JSON.stringify(s));
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRj8AAAAASUVORK5CYII=';
const archived=name=>Core.validateState(require('./rc18-regression-fixtures.cjs').historical(name));
const enabled=()=>archived('enabled');
const context=(s,id=s.students[0].id)=>{const p=Progress.profile(s,id),v=s.students.find(v=>v.id===id);return {enabled:p.enabled,cycleId:p.activeCycleId,pet:v.pet,adopted:v.adopted!==false};};

test('Student editor field patch preserves independently saved photo, group, pet, score and growth',()=>{
 const initial=enabled(),id=initial.students[0].id;
 let latest=run(initial,{type:'student.update',id,photo,group:'另窗小组',pet:'fox'});
 latest=run(latest,{type:'score',ids:[id],delta:5});
 const saved=run(latest,{type:'student.update',id,name:'修改姓名',expectedStudent:{name:initial.students[0].name}});
 assert.deepEqual({...saved.students[0],name:latest.students[0].name},latest.students[0]);
 assert.deepEqual(saved.petAccounts,latest.petAccounts);assert.deepEqual(saved.logs,latest.logs);assert.deepEqual(saved.petLogs,latest.petLogs);
 assert.equal(run(saved,{type:'undo',logId:saved.logs.at(-1).id}).students[0].score,0);
});

for(const [field,newer,intended] of [['name','另窗姓名','草稿姓名'],['group','另窗组','草稿组'],['photo',photo,''],['pet','fox','cat'],['leader',true,false],['adopted',false,true]]){
 test('Student editor rejects a conflicting '+field+' without partial changes',()=>{
  const initial=enabled(),id=initial.students[0].id,original=field==='leader'?false:field==='adopted'?true:initial.students[0][field];
  const latest=run(initial,{type:'student.update',id,[field]:newer}),before=clone(latest);
  const patch={type:'student.update',id,[field]:intended,expectedStudent:{[field]:original}};
  if(field!=='name'){patch.name='不应部分保存';patch.expectedStudent.name=initial.students[0].name;}
  assert.throws(()=>run(latest,patch),/另一窗口变化/);assert.deepEqual(latest,before);
 });
}

test('Student editor accepts an identical independently saved field value and normalizes optional flags',()=>{
 const initial=Core.createInitialState(),id=initial.students[0].id;
 const latest=run(initial,{type:'student.update',id,name:'同一个新姓名'});
 const saved=run(latest,{type:'student.update',id,name:'同一个新姓名',leader:true,adopted:false,expectedStudent:{name:initial.students[0].name,leader:false,adopted:true}});
 assert.equal(saved.students[0].name,'同一个新姓名');assert.equal(saved.students[0].leader,true);assert.equal(saved.students[0].adopted,false);
});

test('Student editor snapshot requires exactly the fields in its patch',()=>{
 const s=enabled(),id=s.students[0].id;
 for(const expectedStudent of [null,[],{}, {name:s.students[0].name,photo:''},{score:0}])assert.throws(()=>run(s,{type:'student.update',id,name:'合成修改',expectedStudent}),/快照/);
 assert.throws(()=>run(s,{type:'student.update',id,pet:'cat',expectedPetContext:{}}),/快照/);
});

test('Student editor pet context rejects restored historical graduation and replacement cycles',()=>{
 const initial=enabled(),id=initial.students[0].id,snapshot=context(initial),action={type:'student.update',id,pet:'cat',expectedStudent:{pet:initial.students[0].pet},expectedPetContext:snapshot};
 let latest=archived('graduated');
 assert.throws(()=>run(latest,action),/成长周期/);
 latest=archived('readopted');const before=clone(latest);
 assert.equal(latest.students[0].pet,initial.students[0].pet);assert.notEqual(context(latest).cycleId,snapshot.cycleId);
 assert.throws(()=>run(latest,action),/成长周期/);assert.deepEqual(latest,before);
 const nameSaved=run(latest,{type:'student.update',id,name:'周期变化后改姓名',expectedStudent:{name:initial.students[0].name}});
 assert.deepEqual(nameSaved.petAccounts,latest.petAccounts);
});

test('Student editor pet context permits unrelated scores but rejects a changed adoption cycle',()=>{
 const initial=Core.createInitialState(),id=initial.students[0].id,snapshot=context(initial),action={type:'student.update',id,pet:'cat',expectedStudent:{pet:initial.students[0].pet},expectedPetContext:snapshot};
 const scored=run(initial,{type:'score',ids:[id],delta:3});assert.equal(run(scored,action).students[0].score,3);
 const modern=run(scored,{type:'pet.draw',count:1});assert.throws(()=>run(modern,action),/成长周期/);
});

test('Non-group, non-adoption edits and identical legacy fields preserve ordinary and pet draw pools',()=>{
 let s=enabled();s=run(s,{type:'draw',scope:'groups',mode:'cycle',count:1});s=run(s,{type:'pet.draw',scope:'students',mode:'cycle',count:1});const student=s.students[0];
 for(const patch of [{name:'只改姓名'},{photo},{pet:'cat'},{group:student.group,adopted:true}]){
  const saved=run(s,{type:'student.update',id:student.id,...patch});assert.deepEqual(saved.draw,s.draw);assert.deepEqual(saved.drawSessions,s.drawSessions);assert.deepEqual(saved.petDraw,s.petDraw);
 }
 const regrouped=run(s,{type:'student.update',id:student.id,group:'真实换组'});assert.equal(regrouped.draw.lastIds.length,0);assert.deepEqual(regrouped.petDraw.lastIds,[]);
});

test('Legacy student.update calls stay valid and removed students remain missing',()=>{
 const s=Core.createInitialState(),id=s.students[0].id,saved=run(s,{type:'student.update',id,name:'旧调用',photo,leader:true});assert.equal(saved.students[0].name,'旧调用');assert.equal(saved.students[0].photo,photo);
 const removed=run(saved,{type:'student.remove',id});assert.throws(()=>run(removed,{type:'student.update',id,name:'不得复活',expectedStudent:{name:'旧调用'}}),/找不到/);
 assert.deepEqual(Core.validateState(clone(saved)),saved);
});
