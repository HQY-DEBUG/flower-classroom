'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Core=require('../src/core.cjs'),Pet=require('../src/pet-progress.js');
const {createStore}=require('../src/storage.cjs'),{legacyState}=require('./pet-fixtures.cjs');
const act=(state,action)=>Core.applyAction(state,action,9100000);
const legacy=()=>{const s=legacyState();s.students[0].medals=5;return Core.validateState(s);};
const historical=()=>Core.validateState(JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pet-score-history-rc19.json'))));
function unknown(state,id=state.students[0].id){const p=Pet.profile(state,id);assert.equal(p.medalBalanceKnown,false);assert.equal(p.medalAvailable,null);return p;}
function withoutAttribution(logs){return logs.map(log=>({...log,changes:log.changes.map(({petEffect,...change})=>change)}));}
function badgeAction(state,type='pet.badge.redeem'){return {type,id:state.students[0].id,amount:1,reason:'合成余额校验',redemptionId:'missing_redemption',requestId:'synthetic_badge_request',expectedRevision:state.revision};}

test('automatic student/group pet draw preserves unknown legacy badge balances and all original score/history fields',()=>{
 for(const scope of ['students','groups']){
  const before=legacy(),snapshot=structuredClone(before);assert.equal(unknown(before).medalTotal,5);
  const after=act(before,{type:'pet.draw',scope,mode:'repeat',count:1});
  assert.deepEqual(before,snapshot);assert.deepEqual(after.students,before.students);assert.deepEqual(withoutAttribution(after.logs),before.logs);
  assert.deepEqual(after.draw,before.draw);assert.deepEqual(after.timer,before.timer);
  for(const s of after.students){unknown(after,s.id);const a=after.petAccounts.find(a=>a.studentId===s.id);assert.equal(a.lifetimeNetGrowth,s.growth);assert.equal(a.graduations.length,0);assert.equal(a.badgeEvents.length,0);assert.equal(a.badgeTransactions,undefined);}
  assert.equal(unknown(after).medalTotal,5);
 }
});

test('first adoption, ordinary switch, batch switch and draw reset cannot establish a redeemable legacy balance',()=>{
 const s=legacy(),id=s.students[0].id;
 const paused=act(s,{type:'student.update',id,adopted:false});
 const adopted=act(paused,{type:'pet.adopt',id,pet:'fox',expectedCycleId:null});
 assert.equal(unknown(adopted,id).medalTotal,5);assert.equal(adopted.students[0].score,s.students[0].score);assert.equal(adopted.students[0].growth,s.students[0].growth);
 const switched=act(s,{type:'pet.switch',id,pet:'fox',expectedPet:s.students[0].pet,expectedCycleId:null,panelId:Core.panelId(s)});
 assert.equal(unknown(switched,id).medalTotal,5);assert.equal(switched.petAccounts,undefined);
 const batched=act(s,{type:'pet.batch',operation:'switch',ids:[id],pet:'fox',requestId:'synthetic_batch_switch',expectedRevision:s.revision});
 assert.equal(unknown(batched,id).medalTotal,5);
 assert.equal(unknown(act(s,{type:'pet.draw.reset'}),id).medalTotal,5);
});

test('direct redeem and undo reject unverified balance before and after automatic initialization without any partial mutation',()=>{
 for(const s of [legacy(),act(legacy(),{type:'pet.draw.reset'})])for(const type of ['pet.badge.redeem','pet.badge.undo']){
  const before=structuredClone(s);assert.throws(()=>act(s,badgeAction(s,type)),/没有可验证的兑换余额/);assert.deepEqual(s,before);unknown(s);
 }
});

test('group assignment, score/undo, panel copying and switching preserve unknown balance',()=>{
 let s=act(legacy(),{type:'pet.draw.reset'}),id=s.students[0].id;
 s=act(s,{type:'students.group.create',ids:[id],expectedAssignments:[{id,group:s.students[0].group}],group:'合成新组',panelId:Core.panelId(s)});unknown(s,id);
 const before=Pet.profile(s,id);s=act(s,{type:'score',ids:[id],delta:5,reason:'合成当前积分'});unknown(s,id);
 s=act(s,{type:'undo',logId:s.logs.at(-1).id});assert.equal(unknown(s,id).medalTotal,before.medalTotal);
 const originalId=Core.panelId(s);s=act(s,{type:'panel.create',mode:'full',name:'合成完整副本'});const copiedStudent=s.students[0].id;unknown(s,copiedStudent);
 const copiedId=Core.panelId(s);s=act(s,{type:'panel.switch',id:originalId});unknown(s,id);
 s=Core.validateState(JSON.parse(JSON.stringify(s)));s=act(s,{type:'panel.switch',id:copiedId});unknown(s,copiedStudent);
});

test('unknown balance survives actual save, fresh storage instance and complete JSON restoration',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flower-badge-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const options={validate:Core.validateState,initial:Core.createInitialState},state=act(legacy(),{type:'pet.draw.reset'});
 const store=createStore(dir,options);store.load();store.save(state);
 const restarted=createStore(dir,options).load();assert.equal(restarted.readOnly,false);assert.deepEqual(restarted.state,state);assert.equal(unknown(restarted.state).medalTotal,5);
 assert.throws(()=>act(restarted.state,badgeAction(restarted.state)),/没有可验证的兑换余额/);
 unknown(Core.validateState(JSON.parse(JSON.stringify(restarted.state))));
});

test('existing verified wallet preserves historical graduations and supports redeem/undo after ordinary pet actions',()=>{
 let s=historical();const id=s.students[0].id,a=s.petAccounts.find(a=>a.studentId===id);assert.equal(Object.hasOwn(a,'badgeBalanceVerified'),false);
 const before=structuredClone(s),balance=Pet.profile(s,id);assert.equal(balance.medalBalanceKnown,true);assert.ok(balance.medalAvailable>=1);
 s=act(s,{type:'pet.draw',scope:'groups',mode:'repeat',count:1});assert.deepEqual(s.petAccounts,before.petAccounts);
 s=act(s,{...badgeAction(s),id,requestId:'synthetic_known_redeem'});assert.equal(Pet.profile(s,id).medalAvailable,balance.medalAvailable-1);
 const redemption=s.petAccounts.find(a=>a.studentId===id).badgeTransactions.at(-1);
 s=act(s,{...badgeAction(s,'pet.badge.undo'),id,requestId:'synthetic_known_undo',redemptionId:redemption.id});assert.equal(Pet.profile(s,id).medalAvailable,balance.medalAvailable);
 assert.deepEqual(s.students,before.students);assert.deepEqual(s.logs,before.logs);assert.deepEqual(s.petLogs,before.petLogs);
 const final=s.petAccounts.find(a=>a.studentId===id);for(const key of ['cycles','graduations','badgeEvents','legacyMedals','lifetimeNetGrowth'])assert.deepEqual(final[key],a[key]);
 assert.deepEqual(final.badgeTransactions.slice(0,-2),a.badgeTransactions);assert.equal(Pet.profile(Core.validateState(JSON.parse(JSON.stringify(s))),id).medalBalanceKnown,true);
});

test('verification marker is preserved as a boolean and malformed marker is rejected atomically',()=>{
 const s=act(legacy(),{type:'pet.draw.reset'});assert.equal(Core.validateState(s).petAccounts[0].badgeBalanceVerified,false);
 for(const value of ['false',0,null,{}]){const invalid=structuredClone(s);invalid.petAccounts[0].badgeBalanceVerified=value;assert.throws(()=>Core.validateState(invalid),/余额核定标记/);}
});
