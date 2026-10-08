'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Core,Pet,clone,first,account,cycle,act,score,profile,historic,reject,initLedger,guard}=require('./pet-history-rc19.cjs');
const {legacyState,SYNTHETIC_PNG}=require('./pet-fixtures.cjs');
const id=s=>first(s).id,batch=(s,operation,ids,extra={})=>act(s,{type:'pet.batch',operation,ids,...guard(s),...extra});
// Frozen RC18 explicitly verified opening ledger; automatic setup cannot certify old honors.
function openingMedals(){const s=Core.validateState(clone(require('./fixtures/rc18-ui-pet-extra.json')));assert.equal(profile(s).medalBalanceKnown,true);assert.equal(profile(s).medalAvailable,4);return s;}
function clampArchive(reset=false){const s=historic(),a=account(s),c=cycle(s);c.netGrowth=0;a.lifetimeNetGrowth=a.cycles.reduce((sum,x)=>sum+x.netGrowth,0);s.settings.petRules.growthFloor='clamp';s.petLogs=[{id:'historic_floor_rc19',timestamp:8000000,delta:reset?0:-5,reason:'合成历史下限记录',undone:false,...(reset?{kind:'reset'}:{floorPolicy:'clamp'}),changes:[{id:id(s),name:first(s).name,accountId:a.id,cycleId:c.id,beforeGrowth:reset?200:2,afterGrowth:0,actualDelta:reset?-200:-2}]}];return Core.validateState(s);}

test('Historical clamp/reject policies remain readable but cannot control or edit current-score progression',()=>{
 for(const old of [historic(),clampArchive()]){const before=clone(old);assert.ok(['reject','clamp'].includes(Pet.growthFloor(old)));reject(old,{type:'pet.growth-policy',growthFloor:'clamp'},/已停用/);reject(old,{type:'pet.stage-rules',thresholds:[1,2,3,4,5,6]},/已停用/);assert.deepEqual(old,before);}
});
test('Ordinary score deduction can cross multiple levels without clamping or mutating legacy growth logs',()=>{
 let s=clampArchive(),old=clone(s);s=score(s,-100);s=score(s,-25);assert.equal(first(s).score,-5);assert.equal(profile(s).level,0);assert.equal(profile(s).remainingToNext,10);assert.deepEqual(s.petLogs,old.petLogs);assert.deepEqual(s.petAccounts,old.petAccounts);
 s=act(s,{type:'undo',logId:s.logs.at(-1).id});assert.equal(first(s).score,20);assert.equal(profile(s).level,2);
});
test('Retired independent growth undo rejects atomically while normal score undo preserves historical floor snapshots',()=>{
 const s=clampArchive(),before=clone(s);reject(s,{type:'pet.undo',logId:s.petLogs[0].id},/已停用/);let next=score(s,5);next=act(next,{type:'undo',logId:next.logs.at(-1).id});assert.deepEqual(next.students,before.students);assert.deepEqual(next.petAccounts,before.petAccounts);assert.deepEqual(next.petLogs,before.petLogs);
});
test('Tampered historical clamp and reset deltas, after values and floor policies are rejected during import',()=>{
 for(const s of [clampArchive(),clampArchive(true)]){for(const edit of [v=>{v.petLogs[0].changes[0].actualDelta--;},v=>{v.petLogs[0].changes[0].afterGrowth=1;},v=>{v.petLogs[0].floorPolicy='unsafe';}]){const bad=clone(s);edit(bad);assert.throws(()=>Core.validateState(bad));}}
});
test('Historical growth resets remain readable and immutable; current-score reset only changes the selected current data',()=>{
 const s=clampArchive(true);assert.equal(s.petLogs[0].changes[0].actualDelta,-200);assert.deepEqual(Core.validateState(clone(s)),s);
 reject(s,{type:'points.clear',confirmed:true,expectedRevision:s.revision,options:{scores:false,groupScores:false,petGrowth:true,history:false,petHistory:false}},/已停用/);
 const next=act(s,{type:'points.clear',confirmed:true,expectedRevision:s.revision,options:{scores:true,groupScores:false,petGrowth:false,history:false,petHistory:false}});assert.equal(first(next).score,0);assert.equal(profile(next).level,0);assert.deepEqual(next.petAccounts,s.petAccounts);assert.deepEqual(next.petLogs,s.petLogs);assert.deepEqual(next.logs,s.logs);
});
test('Batch adoption preview explains exclusions without writes and commits only the selected paused pets',()=>{
 let s=historic();s=act(s,{type:'student.update',id:id(s),adopted:false});const ids=s.students.slice(0,3).map(v=>v.id),before=clone(s),preview=Pet.batchPreview(s,{operation:'adopt',ids,pet:'seal'});assert.equal(preview.eligibleIds.length,1);assert.equal(preview.excluded.length,2);assert.deepEqual(s,before);
 reject(s,{type:'pet.batch',operation:'adopt',ids,pet:'seal',...guard(s)},/资格/);s=batch(s,'adopt',preview.eligibleIds,{pet:'seal'});assert.equal(s.revision,before.revision+1);assert.equal(profile(s).pet,'seal');assert.equal(first(s).score,first(before).score);assert.equal(profile(s).level,7);assert.deepEqual(s.students.slice(1),before.students.slice(1));
});
test('Batch switch keeps one revision and request receipt and rejects duplicate or stale submissions',()=>{
 const s=historic(),ids=s.students.slice(0,4).map(v=>v.id),request={type:'pet.batch',operation:'switch',ids,pet:'dragon',...guard(s)},next=act(s,request);assert.equal(next.revision,s.revision+1);assert.ok(ids.every(id=>Pet.profile(next,id).pet==='dragon'));assert.deepEqual(next.logs,s.logs);assert.deepEqual(next.petLogs,s.petLogs);reject(next,request,/重复/);reject(score(s,1),request,/已变化/);reject(s,{...request,ids:[ids[0],ids[0]]},/重复/);reject(s,{...request,requestId:undefined},/凭据/);reject(s,{...request,expectedRevision:undefined},/版本/);
});
test('Batch switch preserves score and old cycle data; invalid animals and retired growth previews cannot execute',()=>{
 const s=historic(),ids=s.students.slice(0,2).map(v=>v.id),preview=Pet.batchPreview(s,{operation:'growth',ids,delta:-3});assert.equal(preview.eligibleIds.length,0);assert.ok(preview.excluded.every(v=>/已停用/.test(v.reason)));
 const next=batch(s,'switch',ids,{pet:'dragon'});assert.equal(first(next).score,first(s).score);assert.equal(cycle(next).netGrowth,cycle(s).netGrowth);assert.equal(account(next).activeCycleId,account(s).activeCycleId);reject(s,{type:'pet.batch',operation:'switch',ids,pet:'bad',...guard(s)},/类型无效/);reject(next,{type:'pet.batch',operation:'switch',ids,pet:'dragon',...guard(next)},/资格/);
});
test('Existing graduation and re-adoption histories retain overflow and honors even when current score is reduced',()=>{
 const s=historic(),original=clone(account(s).graduations);let next=score(s,-100);next=score(next,-30);assert.equal(profile(next).level,0);assert.equal(profile(next).medalTotal,1);assert.deepEqual(account(next).graduations,original);assert.equal(original[0].growthSnapshot,200);
 next=act(next,{type:'student.update',id:id(next),adopted:false});next=batch(next,'adopt',[id(next)],{pet:'penguin'});assert.equal(first(next).score,-10);assert.equal(profile(next).isEgg,true);assert.equal(profile(next).medalTotal,1);
});
test('Legacy medals preserve exact opening honors without invented transactions or graduations',()=>{
 const raw=legacyState();raw.students[0].medals=4;const old=Core.validateState(raw),s=initLedger(old);assert.equal(profile(old).medalAvailable,null);assert.equal(profile(s).medalAvailable,null);assert.equal(profile(s).medalBalanceKnown,false);assert.equal(profile(s).medalTotal,4);assert.equal(account(s).badgeTransactions,undefined);assert.deepEqual(profile(s).graduates,[]);assert.deepEqual(s.students,old.students);assert.equal(first(s).photo,SYNTHETIC_PNG);
});
test('Badge spend, undo and re-spend remain append-only and independent of permanent honors and points',()=>{
 let s=openingMedals(),original=clone(s),request={type:'pet.badge.redeem',id:id(s),amount:3,reason:'合成课堂奖品',...guard(s)};s=act(s,request);assert.equal(profile(s).medalTotal,4);assert.equal(profile(s).medalAvailable,1);assert.equal(profile(s).medalSpent,3);assert.deepEqual(s.students,original.students);assert.deepEqual(s.logs,original.logs);assert.deepEqual(s.petLogs,original.petLogs);assert.deepEqual(Pet.groupRankings(s),Pet.groupRankings(original));reject(s,request,/重复/);
 const redemption=account(s).badgeTransactions[0].id;reject(s,{type:'pet.badge.redeem',id:id(s),amount:2,reason:'超额',...guard(s)},/不足/);s=act(s,{type:'pet.badge.undo',id:id(s),redemptionId:redemption,...guard(s)});assert.equal(profile(s).medalAvailable,4);assert.equal(account(s).badgeTransactions.length,2);reject(s,{type:'pet.badge.undo',id:id(s),redemptionId:redemption,...guard(s)},/已经撤销/);s=act(s,{type:'pet.badge.redeem',id:id(s),amount:4,reason:'再次合成兑换',...guard(s)});assert.equal(profile(s).medalAvailable,0);assert.equal(profile(s).medalTotal,4);assert.deepEqual(Core.validateState(clone(s)),s);
});
test('Undo of an old score after its graduation badge was spent cannot reduce earned honors or alter snapshots',()=>{
 let s=historic(),snapshot=clone(profile(s).graduates);s=act(s,{type:'pet.badge.redeem',id:id(s),amount:1,reason:'合成毕业奖励',...guard(s)});s=act(s,{type:'undo',logId:'legacy_score_rc19_fixture'});assert.equal(profile(s).medalTotal,1);assert.equal(profile(s).medalAvailable,0);assert.deepEqual(profile(s).graduates,snapshot);
});
test('Invalid badge amounts, duplicate IDs, orphan undo, overdraw and malformed operation receipts still reject',()=>{
 let s=openingMedals();for(const amount of [0,-1,1.5,'1',NaN,1e9+1])reject(s,{type:'pet.badge.redeem',id:id(s),amount,reason:'合成',...guard(s)},/整数/);s=act(s,{type:'pet.badge.redeem',id:id(s),amount:2,reason:'合成',...guard(s)});
 for(const mutate of [a=>a.badgeTransactions.push({...a.badgeTransactions[0]}),a=>{a.badgeTransactions[0].amount=5;},a=>{a.badgeTransactions[0].type='undo';a.badgeTransactions[0].redemptionId='missing';}]){const bad=clone(s);mutate(account(bad));assert.throws(()=>Core.validateState(bad));}const bad=clone(s);bad.petOperations.push({...bad.petOperations[0]});assert.throws(()=>Core.validateState(bad),/重复/);
});
test('Honor cards remain immutable plain local data and preserve current-score levels and historical snapshots across panels',()=>{
 let s=historic();s=act(s,{type:'student.update',id:id(s),name:'合成<荣誉>'});const before=clone(s),card=Pet.honorCard(s,id(s));assert.equal(card.studentName,'合成<荣誉>');assert.equal(card.level,7);assert.equal(card.totalHonors,1);assert.equal(card.availableBadges,1);assert.equal(card.graduations.length,1);assert.match(card.ruleNote,/本账本/);card.graduations[0].thresholds[0]=99;card.studentName='changed';assert.deepEqual(s,before);
 const panel=Core.panelId(s);s=act(s,{type:'panel.create',mode:'copy',name:'合成新班'});s=act(s,{type:'panel.switch',id:panel});assert.equal(profile(s).medalTotal,1);assert.deepEqual(Core.validateState(clone(s)),s);
});
