'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../src/core.cjs'),Progress=require('../src/pet-progress.js'),Ledger=require('../src/pet-ledger.cjs');
const {legacyState,SYNTHETIC_PNG}=require('./pet-fixtures.cjs');
const now=8_000_000,clone=v=>JSON.parse(JSON.stringify(v)),act=(s,a)=>Core.applyAction(s,a,now);
const enable=(s=Core.createInitialState())=>act(s,{type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]});
const id=s=>s.students[0].id,p=(s,sid=id(s))=>Progress.profile(s,sid),account=(s,sid=id(s))=>s.petAccounts.find(a=>a.studentId===sid);
const growth=(s,delta,ids=[id(s)])=>act(s,{type:'pet.growth',delta,ids});
const guard=(s,extra={})=>({expectedRevision:s.revision,requestId:'test_'+s.revision,...extra});
function reject(s,a,re){const before=JSON.stringify(s);assert.throws(()=>act(s,a),re);assert.equal(JSON.stringify(s),before);}
const batch=(s,operation,ids,extra={})=>act(s,{type:'pet.batch',operation,ids,...guard(s),...extra});

test('V066: default remains reject for v1 migration and v2 existing accounts; thresholds preserve policy',()=>{
 let s=enable(legacyState());assert.equal(Progress.growthFloor(s),'reject');assert.equal(s.settings.petRules.growthFloor,undefined);
 reject(s,{type:'pet.growth-policy',growthFloor:'allow-negative'},/规则无效/);
 s=act(s,{type:'pet.growth-policy',growthFloor:'clamp'});s=act(s,{type:'pet.stage-rules',thresholds:[1,2,3,4,5,6]});assert.equal(Progress.growthFloor(s),'clamp');assert.deepEqual(Core.validateState(clone(s)),s);
});
test('V066: multiple cumulative thresholds downgrade and clamp records actual per-student effects',()=>{
 let s=growth(enable(),22);s=growth(s,3,[s.students[1].id]);const originalStudents=clone(s.students),ids=s.students.slice(0,3).map(v=>v.id);
 s=act(s,{type:'pet.growth-policy',growthFloor:'clamp'});s=growth(s,-17,ids);assert.equal(p(s).level,2);assert.equal(p(s).growth,5);assert.deepEqual(s.petLogs.at(-1).changes.map(c=>c.actualDelta),[-17,-3,0]);
 const log=s.petLogs.at(-1);s=growth(s,2,ids);s=act(s,{type:'pet.undo',logId:log.id});assert.deepEqual(ids.map(i=>p(s,i).growth),[24,5,2]);assert.deepEqual(s.students,originalStudents);
 assert.deepEqual(Core.validateState(clone(s)),s);
});
test('V066: undo remains strict under clamp, atomic and bound to original graduated cycle',()=>{
 let s=growth(enable(),30),log=s.petLogs.at(-1).id;s=act(s,{type:'pet.graduate',id:id(s)});const snapshot=clone(p(s).graduates);
 s=act(s,{type:'pet.adopt',id:id(s),pet:'dragon'});s=growth(s,2);s=act(s,{type:'pet.growth-policy',growthFloor:'clamp'});s=growth(s,-5);const penalty=s.petLogs.at(-1).id;
 s=act(s,{type:'pet.undo',logId:log});assert.equal(p(s).growth,0);assert.deepEqual(p(s).graduates,snapshot);assert.equal(p(s).medalTotal,1);
 s=act(s,{type:'pet.undo',logId:penalty});assert.equal(p(s).growth,2);const plus=s.petLogs.find(l=>l.delta===2).id;s=growth(s,-2);reject(s,{type:'pet.undo',logId:plus},/低于 0/);
});
test('V066: tampered clamp delta and reset records are rejected on import',()=>{
 let s=growth(enable(),2);s=act(s,{type:'pet.growth-policy',growthFloor:'clamp'});s=growth(s,-5);let broken=clone(s);broken.petLogs.at(-1).changes[0].actualDelta=-5;assert.throws(()=>Core.validateState(broken),/差额/);
 broken=clone(s);broken.petLogs.at(-1).changes[0].afterGrowth=1;assert.throws(()=>Core.validateState(broken),/前后/);
 broken=clone(s);broken.petLogs.at(-1).floorPolicy='unsafe';assert.throws(()=>Core.validateState(broken),/下限/);
});
test('V012: reset covers large current balances without erasing snapshots, is reversible and keeps old undo strict',()=>{
 let s=growth(enable(),30);s=act(s,{type:'pet.graduate',id:id(s)});const graduates=clone(p(s).graduates);s=act(s,{type:'pet.adopt',id:id(s),pet:'cat'});s=growth(s,100);s=growth(s,100);const oldLog=s.petLogs.at(-1).id;
 const next=clone(s);Ledger.clearCurrentGrowth(next,now);s=Core.validateState(next);assert.equal(p(s).growth,0);assert.equal(s.petLogs.at(-1).kind,'reset');assert.equal(s.petLogs.at(-1).changes[0].actualDelta,-200);assert.deepEqual(p(s).graduates,graduates);
 reject(s,{type:'pet.undo',logId:oldLog},/低于 0/);s=act(s,{type:'pet.undo',logId:s.petLogs.at(-1).id});assert.equal(p(s).growth,200);assert.equal(p(s).medalTotal,1);
});
test('V062: eligibility preview explains exclusions without writes and batch atomically adopts only selected unadopted',()=>{
 let s=enable();s=act(s,{type:'student.update',id:id(s),adopted:false});const ids=s.students.slice(0,3).map(v=>v.id),before=JSON.stringify(s),preview=Progress.batchPreview(s,{operation:'adopt',ids,pet:'seal'});
 assert.equal(preview.eligibleIds.length,1);assert.equal(preview.excluded.length,2);assert.equal(JSON.stringify(s),before);
 reject(s,{type:'pet.batch',operation:'adopt',ids,pet:'seal',...guard(s)},/资格/);
 const old=clone(s);s=batch(s,'adopt',preview.eligibleIds,{pet:'seal'});assert.equal(s.revision,old.revision+1);assert.equal(p(s).pet,'seal');assert.equal(p(s).adopted,true);assert.deepEqual(s.students.slice(1),old.students.slice(1));
});
test('V062: group batch growth commits once, uses one audit log and rejects duplicate or stale submissions',()=>{
 const s=enable(),ids=s.students.slice(0,4).map(v=>v.id),a={type:'pet.batch',operation:'growth',ids,delta:7,reason:'合成批量',...guard(s)},next=act(s,a);
 assert.equal(next.revision,s.revision+1);assert.equal(next.petLogs.length,1);assert.deepEqual(ids.map(i=>p(next,i).growth),[7,7,7,7]);assert.deepEqual(next.students,s.students);reject(next,a,/重复/);
 reject(growth(s,1),a,/已变化/);reject(s,{...a,ids:[ids[0],ids[0]]},/重复/);reject(s,{...a,requestId:undefined},/凭据/);reject(s,{...a,expectedRevision:undefined},/版本/);
});
test('V062: preview rejects underflow and unavailable species, switch preserves all original cycle data',()=>{
 let s=growth(enable(),5);const ids=s.students.slice(0,2).map(v=>v.id),preview=Progress.batchPreview(s,{operation:'growth',ids,delta:-3});assert.deepEqual(preview.eligibleIds,[ids[0]]);assert.match(preview.excluded[0].reason,/低于/);
 const before=clone(s);s=batch(s,'switch',ids,{pet:'dragon'});assert.equal(p(s).growth,5);assert.equal(account(s).activeCycleId,account(before).activeCycleId);assert.deepEqual(s.logs,before.logs);assert.deepEqual(s.petLogs,before.petLogs);
 reject(s,{type:'pet.batch',operation:'switch',ids,pet:'bad',...guard(s)},/类型无效/);reject(s,{type:'pet.batch',operation:'switch',ids,pet:'dragon',...guard(s)},/资格/);
});
test('V062: only maxed active pets graduate once, retain overflow and snapshots and new adoption is zero',()=>{
 let s=enable(),ids=s.students.slice(0,3).map(v=>v.id);s=growth(s,40,ids.slice(0,2));s=growth(s,29,[ids[2]]);
 const preview=Progress.batchPreview(s,{operation:'graduate',ids});assert.equal(preview.eligibleIds.length,2);assert.match(preview.excluded[0].reason,/LV.7/);
 const a={type:'pet.batch',operation:'graduate',ids:preview.eligibleIds,...guard(s)},before=clone(s);s=act(s,a);assert.equal(s.revision,before.revision+1);assert.deepEqual(ids.map(i=>p(s,i).medalTotal),[1,1,0]);assert.equal(p(s).graduates[0].growthSnapshot,40);reject(s,a,/重复/);
 s=batch(s,'adopt',ids.slice(0,2),{pet:'penguin'});assert.equal(p(s).growth,0);assert.equal(p(s).graduates.length,1);
});
test('V075: legacy medals are preserved as opening honors without invented transactions or graduations',()=>{
 const raw=legacyState();raw.students[0].medals=4;const old=Core.validateState(raw),s=enable(old);
 assert.equal(p(old).medalAvailable,null);assert.equal(p(s).medalAvailable,4);assert.equal(p(s).medalTotal,4);assert.equal(account(s).badgeTransactions,undefined);assert.deepEqual(p(s).graduates,[]);assert.deepEqual(s.students,old.students);assert.equal(s.students[0].photo,SYNTHETIC_PNG);
});
test('V075: spend, undo and re-spend are append-only, independent of permanent honors and ordinary scores',()=>{
 const raw=legacyState();raw.students[0].medals=4;let s=enable(raw);const original=clone(s),a={type:'pet.badge.redeem',id:id(s),amount:3,reason:'合成课堂奖品',...guard(s)};
 s=act(s,a);assert.equal(p(s).medalTotal,4);assert.equal(p(s).medalAvailable,1);assert.equal(p(s).medalSpent,3);assert.deepEqual(s.students,original.students);assert.deepEqual(s.logs,original.logs);assert.deepEqual(s.petLogs,original.petLogs);assert.deepEqual(Progress.studentRankings(s).map(v=>[v.id,v.rank,v.medalTotal]),Progress.studentRankings(original).map(v=>[v.id,v.rank,v.medalTotal]));assert.deepEqual(Progress.groupRankings(s),Progress.groupRankings(original));reject(s,a,/重复/);
 const redemption=account(s).badgeTransactions[0].id;reject(s,{type:'pet.badge.redeem',id:id(s),amount:2,reason:'超额',...guard(s)},/不足/);
 s=act(s,{type:'pet.badge.undo',id:id(s),redemptionId:redemption,...guard(s)});assert.equal(p(s).medalAvailable,4);assert.equal(account(s).badgeTransactions.length,2);
 reject(s,{type:'pet.badge.undo',id:id(s),redemptionId:redemption,...guard(s)},/已经撤销/);
 s=act(s,{type:'pet.badge.redeem',id:id(s),amount:4,reason:'再次合成兑换',...guard(s)});assert.equal(p(s).medalAvailable,0);assert.equal(p(s).medalTotal,4);assert.deepEqual(Core.validateState(clone(s)),s);
});
test('V075: growth undo after spent graduation cannot reduce honor total or make availability negative',()=>{
 let s=growth(enable(),30),log=s.petLogs.at(-1).id;s=act(s,{type:'pet.graduate',id:id(s)});const snapshot=clone(p(s).graduates);
 s=act(s,{type:'pet.badge.redeem',id:id(s),amount:1,reason:'合成毕业奖励',...guard(s)});s=act(s,{type:'pet.undo',logId:log});assert.equal(p(s).medalTotal,1);assert.equal(p(s).medalAvailable,0);assert.deepEqual(p(s).graduates,snapshot);
});
test('V075: invalid amount, duplicate ledger IDs, orphan undo, overdraw and malformed optional extensions reject',()=>{
 const raw=legacyState();raw.students[0].medals=4;let s=enable(raw);
 for(const amount of [0,-1,1.5,'1',NaN,1e9+1])reject(s,{type:'pet.badge.redeem',id:id(s),amount,reason:'合成',...guard(s)},/整数/);
 s=act(s,{type:'pet.badge.redeem',id:id(s),amount:2,reason:'合成',...guard(s)});
 for(const mutate of [a=>a.badgeTransactions.push({...a.badgeTransactions[0]}),a=>{a.badgeTransactions[0].amount=5;},a=>{a.badgeTransactions[0].type='undo';a.badgeTransactions[0].redemptionId='missing';}]){const broken=clone(s);mutate(account(broken));assert.throws(()=>Core.validateState(broken));}
 const broken=clone(s);broken.petOperations.push({...broken.petOperations[0]});assert.throws(()=>Core.validateState(broken),/重复/);
});
test('V075: honor-card export returns immutable local data, preserves unsafe text as plain data and round-trips panels',()=>{
 let s=enable();s=act(s,{type:'student.update',id:id(s),name:'合成<荣誉>'});s=growth(s,30);s=act(s,{type:'pet.graduate',id:id(s)});const before=JSON.stringify(s),card=Progress.honorCard(s,id(s));
 assert.equal(card.totalHonors,1);assert.equal(card.availableBadges,1);assert.equal(card.graduations.length,1);assert.match(card.ruleNote,/本账本/);card.graduations[0].thresholds[0]=99;card.studentName='changed';assert.equal(JSON.stringify(s),before);
 const panel=Core.panelId(s);s=act(s,{type:'panel.create',mode:'copy',name:'合成新班'});s=act(s,{type:'panel.switch',id:panel});assert.equal(p(s).medalTotal,1);assert.deepEqual(Core.validateState(clone(s)),s);
});
