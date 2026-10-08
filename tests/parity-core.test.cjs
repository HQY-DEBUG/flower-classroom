'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInitialState, validateState, applyAction, panelId, panelList } = require('../src/core.cjs');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRj8AAAAASUVORK5CYII=';
const clone = x => JSON.parse(JSON.stringify(x));
const run = (s, a) => applyAction(s, a, 100000);
test('Parity panels: legacy state is unchanged until a panel is created', () => {
  const s = createInitialState();
  assert.equal(s.panels, undefined);
  assert.deepEqual(validateState(s), s);
  assert.deepEqual(panelList(s), [{ id: 'panel_default', name: s.settings.className, count: 12 }]);
});
test('Parity panels: creating blank preserves every original field and switching restores it', () => {
  let original = createInitialState();
  original = run(original, {type:'score',ids:[original.students[0].id],delta:7});
  original = run(original, {type:'student.update',id:original.students[0].id,photo:PNG});
  const next = run(original, {type:'panel.create',mode:'blank',name:'第二面板'});
  assert.equal(next.students.length, 0); assert.equal(next.settings.petStep, 5);
  assert.deepEqual(next.panels.others[0].data, original);
  assert.equal(original.panels, undefined);
  const newId = panelId(next);
  const back = run(next, {type:'panel.switch',id:'panel_default'});
  for (const key of ['students','settings','logs','timer','draw']) assert.deepEqual(back[key],original[key]);
  assert.equal(back.panels.others[0].id,newId);
  assert.equal(back.revision,original.revision+2);
  assert.deepEqual(validateState(clone(back)),back);
});
test('Parity panels: copy is expressly a fresh roster and leaves source scores/photos/growth untouched', () => {
  let original = createInitialState();
  original = run(original,{type:'score',ids:[original.students[0].id],delta:20});
  original = run(original,{type:'student.update',id:original.students[0].id,photo:PNG});
  const next=run(original,{type:'panel.create',mode:'copy',name:'复制名单'});
  assert.deepEqual(next.students.map(s=>[s.name,s.group]),original.students.map(s=>[s.name,s.group]));
  assert.ok(next.students.every(s=>s.score===0&&s.growth===0&&s.photo===''));
  assert.ok(next.students.every(s=>!original.students.some(o=>o.id===s.id)));
  assert.equal(next.logs.length,0);
  assert.deepEqual(next.panels.others[0].data,original);
});
test('Parity panels: edits and scoring do not leak across panels; stale window commands reject', () => {
  const original=createInitialState(),oldId=original.students[0].id;
  let next=run(original,{type:'panel.create',mode:'copy',name:'副本'});
  const before=clone(next.panels.others[0].data);
  next=run(next,{type:'score',ids:[next.students[0].id],delta:8,panelId:panelId(next)});
  assert.deepEqual(next.panels.others[0].data,before);
  assert.throws(()=>run(next,{type:'score',ids:[oldId],delta:2,panelId:'panel_default'}),/已切换/);
  assert.throws(()=>run(next,{type:'student.add',name:'错面板',panelId:'panel_default'}),/已切换/);
  assert.throws(()=>run(next,{type:'panel.switch',id:'missing'}));
});
test('Parity panels: validation rejects duplicate and recursive panel records without mutating input', () => {
  const s=run(createInitialState(),{type:'panel.create',mode:'blank',name:'新面板'});
  const bad=clone(s);bad.panels.others[0].id=bad.panels.activeId;
  assert.throws(()=>validateState(bad),/重复/);
  const nested=clone(s);nested.panels.others[0].data.panels={activeId:'inner',others:[]};
  assert.throws(()=>validateState(nested),/嵌套/);
  const tooMany=clone(s);tooMany.panels.others=Array.from({length:20},(_,i)=>({id:'p'+i,data:createInitialState()}));
  assert.throws(()=>validateState(tooMany),/20/);
});
test('Parity panels: remove affects only current panel and refuses deleting the final panel', () => {
  const original=createInitialState();
  assert.throws(()=>run(original,{type:'panel.remove'}),/至少/);
  const added=run(original,{type:'panel.create',mode:'copy',name:'副本'});
  const removed=run(added,{type:'panel.remove'});
  assert.deepEqual(removed.students,original.students);
  assert.equal(removed.panels.others.length,0);
  assert.throws(()=>run(removed,{type:'panel.remove'}),/至少/);
});
test('Parity photos: batch is atomic, preserves scores and never accepts foreign IDs or duplicates', () => {
  const s=createInitialState(),ids=s.students.slice(0,2).map(s=>s.id);
  const updated=run(s,{type:'photos.batch',updates:ids.map(id=>({id,photo:PNG}))});
  assert.ok(updated.students.slice(0,2).every(s=>s.photo===PNG));
  assert.deepEqual(updated.students.slice(2),s.students.slice(2));
  assert.equal(updated.revision,s.revision+1);
  for(const updates of [[],[{id:'missing',photo:PNG}],[{id:ids[0],photo:PNG},{id:ids[0],photo:PNG}],[{id:ids[0],photo:PNG},{id:ids[1],photo:'broken'}]]) assert.throws(()=>run(s,{type:'photos.batch',updates}));
  assert.ok(s.students.every(s=>s.photo===''));
});
test('Parity photo visibility and sound settings round-trip without changing legacy defaults', () => {
  let s=createInitialState();assert.equal(s.settings.showAvatars,undefined);assert.equal(s.settings.timerSound,undefined);
  s=run(s,{type:'photos.visibility',value:false});
  for(const sound of ['tick','applause','laser']) {s=run(s,{type:'timer.sound',sound});assert.equal(validateState(clone(s)).settings.timerSound,sound);}
  assert.equal(validateState(clone(s)).settings.showAvatars,false);
  assert.throws(()=>run(s,{type:'timer.sound',sound:'unknown'}));
  assert.throws(()=>run(s,{type:'photos.visibility',value:'true'}));
});
test('Parity draw: mixed per-student awards commit once and preserve reversible legacy logs', () => {
  let s=run(createInitialState(),{type:'draw',count:5});
  const ids=s.draw.lastIds,awards=ids.map((id,i)=>({id,delta:i===4?5:2}));
  const next=run(s,{type:'score.mixed',awards,reason:'随机点名奖励'});
  assert.equal(next.revision,s.revision+1);assert.equal(next.logs.length,2);
  for(const a of awards){const item=next.students.find(s=>s.id===a.id);assert.equal(item.score,a.delta);assert.equal(item.growth,a.delta);}
  let undone=next;for(const log of next.logs)undone=run(undone,{type:'undo',logId:log.id});
  assert.deepEqual(undone.students,s.students);
  assert.throws(()=>run(s,{type:'score.mixed',awards:[{id:ids[0],delta:2},{id:ids[1],delta:101}]}));
  assert.throws(()=>run(s,{type:'score.mixed',awards:[{id:ids[0],delta:2},{id:ids[0],delta:3}]}));
  const unpicked=s.students.find(x=>!ids.includes(x.id));assert.throws(()=>run(s,{type:'score.mixed',awards:[{id:unpicked.id,delta:1}]}));
  assert.ok(s.students.every(x=>x.score===0));
});
test('Parity draw: core matches the documented twenty-student limit', () => {
  let s=createInitialState();
  for(let i=0;i<10;i++)s=run(s,{type:'student.add',name:'合成边界'+i});
  assert.equal(run(s,{type:'draw',count:20}).draw.lastIds.length,20);
  assert.throws(()=>run(s,{type:'draw',count:21}));
});
test('Parity group base: group points and reversals are independent of every student score and growth', () => {
  const s=createInitialState(),group=s.students[0].group;
  let next=run(s,{type:'group.base',group,delta:5});const id=next.groupLogs[0].id;
  next=run(next,{type:'group.base',group,delta:-2});
  assert.equal(next.groupBases[0].score,3);assert.deepEqual(next.students,s.students);
  next=run(next,{type:'group.undo',logId:id});assert.equal(next.groupBases[0].score,-2);
  assert.throws(()=>run(next,{type:'group.undo',logId:id}));
  assert.deepEqual(validateState(clone(next)),next);
  const bad=clone(next);bad.groupLogs[0].after=99;assert.throws(()=>validateState(bad));
  assert.throws(()=>run(s,{type:'group.base',group:'missing',delta:1}));
  assert.throws(()=>run(s,{type:'group.base',group,delta:0}));
});
test('Parity bulk grouping keeps identity, photos, points and growth and is atomic', () => {
  let s=createInitialState();const ids=s.students.slice(0,2).map(s=>s.id);
  s=run(s,{type:'score',ids,delta:8});s=run(s,{type:'photos.batch',updates:ids.map(id=>({id,photo:PNG}))});
  const next=run(s,{type:'students.group',ids,group:'合成新组'});
  next.students.forEach((student,i)=>assert.deepEqual(student,{...s.students[i],...(i<2?{group:'合成新组'}:{})}));
  assert.deepEqual(next.logs,s.logs);assert.throws(()=>run(s,{type:'students.group',ids:[...ids,'missing'],group:'新组'}));
  assert.throws(()=>run(s,{type:'students.group',ids,group:''}));
});
test('Parity leader and adoption markers preserve legacy absent fields and existing growth', () => {
  let s=createInitialState();assert.equal(s.students[0].leader,undefined);assert.equal(s.students[0].adopted,undefined);
  const id=s.students[0].id;s=run(s,{type:'score',ids:[id],delta:25});
  let next=run(s,{type:'student.update',id,leader:true,adopted:false});
  assert.equal(next.students[0].growth,25);assert.equal(next.students[0].score,25);assert.equal(next.students[0].adopted,false);
  next=run(next,{type:'student.update',id,leader:false,adopted:true,pet:'penguin'});
  assert.equal(next.students[0].growth,25);assert.equal(next.students[0].leader,false);assert.equal(next.students[0].pet,'penguin');
  assert.deepEqual(validateState(clone(next)),next);
  assert.throws(()=>run(s,{type:'student.update',id,adopted:'false'}));
  assert.throws(()=>run(s,{type:'student.update',id,leader:1}));
});
test('Parity score step rejects malformed values and is retained per panel', () => {
  let s=run(createInitialState(),{type:'score.step',value:5});
  assert.equal(s.settings.scoreStep,5);
  for(const value of [0,101,'5',null,1.5])assert.throws(()=>run(s,{type:'score.step',value}));
  s=run(s,{type:'panel.create',mode:'blank',name:'另一面板'});
  assert.equal(s.settings.scoreStep,undefined);s=run(s,{type:'panel.switch',id:'panel_default'});assert.equal(s.settings.scoreStep,5);
});
test('Parity clear commands operate on the current panel with their explicit, different semantics', () => {
  let s=createInitialState(),id=s.students[0].id;
  s=run(s,{type:'score',ids:[id],delta:22});s=run(s,{type:'photos.batch',updates:[{id,photo:PNG}]});
  s=run(s,{type:'group.base',group:s.students[0].group,delta:4});
  s=run(s,{type:'panel.create',mode:'blank',name:'保留板'});
  const other=s;s=run(s,{type:'panel.switch',id:'panel_default'});
  const cleared=run(s,{type:'points.clear'});
  assert.equal(cleared.students[0].score,0);assert.equal(cleared.students[0].growth,22);assert.equal(cleared.students[0].photo,PNG);
  assert.equal(cleared.groupBases[0].score,0);assert.equal(cleared.logs.length,0);assert.equal(cleared.groupLogs.length,0);
  assert.deepEqual(cleared.panels,s.panels);
  const empty=run(s,{type:'panel.clear'});assert.equal(empty.students.length,0);assert.equal(empty.settings.className,s.settings.className);assert.deepEqual(empty.panels,s.panels);
  assert.equal(other.students.length,0);assert.equal(s.students[0].score,22);
});
