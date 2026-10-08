'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {Core,Pet,clone,first,account,cycle,act,score,profile,historic,graduatedArchive,reject,initLedger}=require('./pet-history-rc19.cjs');
const Scores=require('../src/pet-score-progression.js'),Organization=require('../src/organization-tools.js');
const {legacyState,SYNTHETIC_PNG}=require('./pet-fixtures.cjs');

test('Pet history: six historical snapshot thresholds retain exact cumulative boundaries and overflow validation',()=>{
 for(const [costs,boundaries] of [[Pet.DEFAULT_THRESHOLDS,[5,15,30,50,75,105]],[[5,5,5,5,5,5],[5,10,15,20,25,30]]])for(const [i,b]of boundaries.entries()){assert.equal(Pet.progress(b-1,costs).level,i+1);const p=Pet.progress(b,costs);assert.equal(p.level,i+2);assert.equal(p.current,0);assert.equal(p.maxed,i===5);}
 assert.equal(Pet.progress(200,Pet.DEFAULT_THRESHOLDS).overflow,95);
 for(const costs of [[],[5],[5,5,5,5,5,0],[5,5,5,5,5,.5],[5,5,5,5,5,'5'],Array(6).fill(1e9)])assert.throws(()=>Pet.progress(0,costs));
});
test('Pet progression: browser and CommonJS share current-score profiles and historical snapshot readers',()=>{
 const c=vm.createContext({});for(const f of ['pet-score-progression.js','pet-progress.js'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+f),'utf8'),c);
 c.json=JSON.stringify(historic());const result=vm.runInContext('PetProgress.profile(JSON.parse(json),JSON.parse(json).students[0].id)',c);assert.deepEqual(JSON.parse(JSON.stringify(result)),profile(historic()));
 assert.deepEqual(JSON.parse(JSON.stringify(c.PetProgress.progress(15,[5,10,15,20,25,30]))),Pet.progress(15,Pet.DEFAULT_THRESHOLDS));
});
test('Pet migration: v1 data remains intact while all old growth modes immediately display current-score levels',()=>{
 const raw=legacyState(),old=Core.validateState(raw),before=clone(old);
 assert.deepEqual(old.students,raw.students);assert.deepEqual(old.logs,raw.logs);assert.equal(old.version,2);assert.deepEqual(old.petProgression,Scores.get());assert.equal(old.petAccounts,undefined);
 for(const student of old.students)assert.equal(Pet.profile(old,student).level,Scores.progress(student.score).level);
 reject(old,{type:'pet.growth',ids:[first(old).id],delta:3},/已停用/);assert.deepEqual(old,before);
});
test('Pet history initialization retains every student, photo and unlogged growth without inventing graduations',()=>{
 const old=Core.validateState(legacyState()),s=initLedger(old);assert.deepEqual(s.students,old.students);assert.equal(first(s).photo,SYNTHETIC_PNG);
 for(const [i,log]of s.logs.entries()){const original=clone(log);original.changes.forEach(c=>delete c.petEffect);assert.deepEqual(original,old.logs[i]);}
 assert.equal(account(s,'s_legacy_bunny').lifetimeNetGrowth,200);assert.equal(cycle(s,'s_legacy_bunny').netGrowth,200);assert.equal(account(s,'s_legacy_bunny').cycles[0].openedAt,null);
 assert.ok(s.petAccounts.every(a=>a.graduations.length===0&&a.badgeEvents.length===0));assert.deepEqual(Core.validateState(clone(s)),s);
});
test('Global progression edits preserve all historical balances, logs, photos and graduation rule snapshots',()=>{
 const old=historic(),s=act(old,{type:'petProgression.update',petProgression:{version:1,costs:[6,11,16,21,21,21,21],repeatCost:25}});
 for(const key of ['students','logs','petAccounts','petLogs','draw','timer'])assert.deepEqual(s[key],old[key]);assert.deepEqual(account(s).graduations[0].ruleSnapshot.thresholds,[5,5,5,5,5,5]);
});
test('Group point awards produce one complete score record and leave old pet and group history untouched',()=>{
 let s=historic();s=act(s,{type:'group.base',group:first(s).group,delta:9});const old=clone(s),ids=s.students.filter(v=>v.group===first(s).group).map(v=>v.id);s=score(s,3,ids);
 for(const key of ['petAccounts','petLogs','groupBases','groupLogs','draw'])assert.deepEqual(s[key],old[key]);
 assert.equal(s.logs.length,old.logs.length+1);assert.equal(s.logs.at(-1).changes.length,ids.length);assert.equal(s.logs.at(-1).growthDelta,0);
 assert.deepEqual(act(s,{type:'undo',logId:s.logs.at(-1).id}).students,old.students);
});
test('Signed points and nonsequential undo preserve later scores and every archived growth value',()=>{
 const original=historic();let s=score(original,20),a=s.logs.at(-1).id;s=score(s,-6);const penalty=s.logs.at(-1).id;s=score(s,9);const later=s.logs.at(-1).id;
 s=act(s,{type:'undo',logId:a});assert.equal(first(s).score,first(original).score+3);
 s=act(s,{type:'undo',logId:penalty});s=act(s,{type:'undo',logId:later});assert.deepEqual(s.students,original.students);assert.deepEqual(s.petAccounts,original.petAccounts);reject(s,{type:'undo',logId:later},/已经撤销/);
});
test('Negative current points cross multiple levels and can reach an egg without historical growth underflow',()=>{
 let s=score(Core.createInitialState(),30);assert.equal(profile(s).level,3);s=score(s,-16);assert.equal(profile(s).level,1);s=score(s,-15);assert.equal(profile(s).level,0);assert.equal(profile(s).isEgg,true);assert.equal(profile(s).remainingToNext,6);assert.equal(first(s).growth,0);
});
test('Legacy-linked and independent accounts plus newly added students all use the same score path',()=>{
 let s=historic(),old=clone(s.petAccounts),ids=s.students.slice(0,2).map(v=>v.id);s=score(s,7,ids);assert.deepEqual(s.petAccounts,old);assert.ok(s.logs.at(-1).changes.every(c=>c.petEffect===null));
 s=act(s,{type:'student.add',name:'合成新同学',pet:'penguin'});const newcomer=s.students.at(-1).id;s=score(s,15,[newcomer]);assert.equal(Pet.profile(s,newcomer).level,2);assert.equal(cycle(s,newcomer).netGrowth,0);assert.equal(s.students.at(-1).growth,0);
});
test('Level seven and later numeric levels never automatically graduate, cap numeric level or mint honors',()=>{
 let s=score(Core.createInitialState(),100);s=score(s,30);assert.equal(profile(s).level,8);assert.equal(profile(s).shape,7);assert.equal(profile(s).maxed,false);assert.equal(profile(s).medalTotal,0);reject(s,{type:'pet.graduate',id:first(s).id},/已停用/);
});
test('Readoption uses the existing score; undo of an old score changes only its original cycle and keeps its snapshot',()=>{
 let s=graduatedArchive(),id=first(s).id,oldCycle=account(s).cycles[0].id,grad=clone(account(s).graduations);s=act(s,{type:'pet.adopt',id,pet:'cat'});const newCycle=cycle(s).id;assert.notEqual(newCycle,oldCycle);assert.equal(profile(s).level,7);assert.equal(cycle(s).netGrowth,0);
 s=act(s,{type:'undo',logId:'legacy_score_rc19_fixture'});assert.equal(first(s).score,110);assert.equal(cycle(s).netGrowth,0);assert.equal(account(s).cycles.find(c=>c.id===oldCycle).netGrowth,190);assert.deepEqual(account(s).graduations,grad);assert.equal(profile(s).medalTotal,1);
});
test('New points while no pet is active never enter unassigned history and remain reversible after adoption',()=>{
 const old=graduatedArchive();let s=score(old,9),log=s.logs.at(-1);assert.equal(log.changes[0].petEffect,null);assert.equal(account(s).unassignedGrowth,0);assert.deepEqual(s.petAccounts,old.petAccounts);
 s=act(s,{type:'pet.adopt',id:first(s).id,pet:'cat'});assert.equal(profile(s).level,Scores.progress(129).level);s=act(s,{type:'undo',logId:log.id});assert.equal(first(s).score,120);assert.equal(cycle(s).netGrowth,0);
});
test('Old attributed score undo preserves the newer independent history and all recorded graduation facts',()=>{
 const old=historic(),active=clone(cycle(old)),graduations=clone(account(old).graduations),s=act(old,{type:'undo',logId:'legacy_score_rc19_fixture'});
 assert.equal(first(s).growth,190);assert.equal(first(s).score,110);assert.deepEqual(cycle(s),active);assert.deepEqual(account(s).graduations,graduations);assert.deepEqual(s.petLogs,old.petLogs);
});
test('Legacy medals initialize as the exact existing honor balance without invented graduations',()=>{
 const raw=legacyState();raw.students[0].medals=4;const s=initLedger(raw);assert.equal(first(s).medals,4);assert.equal(account(s).legacyMedals,4);assert.deepEqual(account(s).badgeEvents,[]);assert.equal(profile(s).medalAvailable,null);assert.equal(profile(s).medalTotal,4);assert.equal(profile(s).medalBalanceKnown,false);
});
test('All forty species can change without changing score, old growth, cycle identity or graduation snapshots',()=>{
 let s=historic(),id=first(s).id,original=clone(s),cycleId=cycle(s).id;
 for(const pet of Object.keys(require('../src/pet-art.js').names)){s=act(s,{type:'student.update',id,pet});assert.equal(cycle(s).pet,pet);assert.equal(cycle(s).netGrowth,cycle(original).netGrowth);assert.equal(cycle(s).id,cycleId);assert.equal(first(s).score,first(original).score);assert.deepEqual(account(s).graduations,account(original).graduations);}
});
test('Dormant old pets resume with the same score and historical growth, and repeated adoption rejects',()=>{
 let s=historic(),id=first(s).id,oldGrowth=cycle(s).netGrowth;s=act(s,{type:'student.update',id,adopted:false});assert.equal(profile(s).adopted,false);reject(s,{type:'pet.growth',ids:[id],delta:1},/已停用/);s=act(s,{type:'pet.adopt',id,pet:'penguin'});assert.equal(cycle(s).netGrowth,oldGrowth);assert.equal(profile(s).level,7);reject(s,{type:'pet.adopt',id,pet:'cat'},/已有/);
});
test('Mixed pet-draw awards commit once through ordinary score and reject duplicate recipients atomically',()=>{
 let s=act(historic(),{type:'pet.draw',scope:'students',count:4,mode:'repeat'}),ids=s.petDraw.lastIds;
 const action={type:'score.mixed',awards:ids.map((id,i)=>({id,delta:i<2?3:7})),expectedPetDraw:Organization.petDrawKey(s)};const next=act(s,action);assert.equal(next.revision,s.revision+1);assert.equal(next.logs.length,s.logs.length+2);assert.deepEqual(next.petAccounts,s.petAccounts);
 reject(s,{...action,awards:[...action.awards,action.awards[0]]},/重复/);reject(s,{...action,awards:[action.awards[0],{id:ids[1],delta:101}]},/整数/);
});
test('Pet student/group draw is fair, excludes paused pets and never changes the ordinary draw',()=>{
 let s=initLedger(),excluded=first(s).id;s=act(s,{type:'student.update',id:excluded,adopted:false});const ordinary=clone(s.draw),seen=new Set();
 for(let i=0;i<4;i++){s=act(s,{type:'pet.draw',scope:'students',mode:'cycle',count:3});for(const id of s.petDraw.lastIds){assert.notEqual(id,excluded);assert.ok(!seen.has(id));seen.add(id);}}
 assert.equal(seen.size,11);assert.equal(s.petDraw.bag.length,0);assert.deepEqual(s.draw,ordinary);s=act(s,{type:'pet.draw',scope:'groups',count:2,mode:'cycle'});
 for(const group of s.petDraw.groups)assert.deepEqual(group.ids,s.students.filter(v=>v.group===group.group&&v.id!==excluded).map(v=>v.id));assert.deepEqual(s.petDraw.lastIds,s.petDraw.groups.flatMap(v=>v.ids));
 const next=score(s,3,s.petDraw.lastIds);assert.deepEqual(next.petAccounts,s.petAccounts);assert.deepEqual(next.draw,ordinary);s=act(s,{type:'students.group',ids:[s.petDraw.lastIds[0]],group:'合成换组'});assert.equal(s.petDraw.lastIds.length,0);
});
test('Every roster member counts in honor group averages and equal current-score levels share ranks',()=>{
 let s=Core.importRows(Array.from({length:10},(_,i)=>({name:`合成排行${i}`,group:`合成组${Math.floor(i/2)}`})),Core.createInitialState(),'replace');s.students[0].medals=6;s.students[2].medals=4;s.students[4].medals=2;s.students[1].adopted=false;s=initLedger(s);
 const rows=Pet.groupRankings(s);assert.deepEqual(rows.map(v=>v.averageMedals),[3,2,1,0,0]);assert.deepEqual(rows.map(v=>v.rank),[1,2,3,4,4]);assert.ok(rows.every(v=>v.count===2));assert.ok(Pet.studentRankings(s,{sortBy:'level'}).every(v=>v.rank===1&&v.level===0));
});
test('Fresh panels share root progression and preserve the original archived panel without nested progression',()=>{
 const old=historic(),s=act(old,{type:'panel.create',mode:'copy',name:'合成新板'});assert.deepEqual(s.petProgression,old.petProgression);assert.ok(s.students.every(v=>v.score===0&&Pet.profile(s,v).level===0));assert.equal(s.panels.others[0].data.petProgression,undefined);assert.deepEqual(s.panels.others[0].data.students,old.students);assert.deepEqual(s.panels.others[0].data.petAccounts,old.petAccounts);
 const blank=act(old,{type:'panel.create',mode:'blank',name:'合成空板'});assert.deepEqual(blank.students,[]);assert.deepEqual(blank.petProgression,old.petProgression);
});
test('Backup round trip and panel switching preserve photos, score effects, graduations and independent histories',()=>{
 let s=historic(),originalPanel=Core.panelId(s),old=clone(s);s=act(s,{type:'panel.create',mode:'copy',name:'合成第二板'});s=score(s,8);s=act(s,{type:'pet.visibility',hideLateForms:true});const secondId=Core.panelId(s),second=clone(s);assert.deepEqual(Core.validateState(clone(s)),s);
 s=act(s,{type:'panel.switch',id:originalPanel});for(const key of ['students','logs','petAccounts','petLogs'])assert.deepEqual(s[key],old[key]);s=act(s,{type:'panel.switch',id:secondId});for(const key of ['students','logs','petAccounts','petLogs','settings'])assert.deepEqual(s[key],second[key]);assert.deepEqual(Core.validateState(clone(s)),s);
});
test('Clearing ordinary points returns eggs while preserving historical growth, lifetime and graduation facts',()=>{
 const old=historic(),s=act(old,{type:'points.clear'});assert.deepEqual(s.petAccounts,old.petAccounts);assert.deepEqual(s.petLogs,old.petLogs);assert.equal(first(s).growth,first(old).growth);assert.equal(first(s).score,0);assert.equal(profile(s).level,0);assert.equal(s.logs.length,0);assert.deepEqual(Core.validateState(clone(s)),s);
});
test('Removing a participant preserves historical account IDs and rejects a partial score-batch undo',()=>{
 let s=historic(),ids=s.students.slice(0,2).map(v=>v.id);s=score(s,4,ids);const logId=s.logs.at(-1).id,oldAccount=clone(account(s,ids[1]));s=act(s,{type:'student.remove',id:ids[1]});assert.deepEqual(account(s,ids[1]),oldAccount);reject(s,{type:'undo',logId},/已移除/);assert.deepEqual(Core.validateState(clone(s)),s);
});
test('Malformed historical references, snapshots, attribution and duplicate events remain rejected without normalization',()=>{
 const s=historic(),mutations=[v=>{v.version=1;},v=>{v.settings.petRules.thresholds[0]=0;},v=>{v.settings.hideLateForms='true';},v=>{v.petAccounts[0].lifetimeNetGrowth++;},v=>{v.petAccounts[0].mode='mystery';},v=>{v.petAccounts[0].activeCycleId='missing';},v=>{v.petAccounts[0].cycles[0].netGrowth=-1;},v=>{v.petAccounts[0].cycles[1].id=v.petAccounts[0].cycles[0].id;},v=>{v.petAccounts[0].graduations[0].growthSnapshot=0;},v=>{v.petAccounts[0].graduations.push(clone(v.petAccounts[0].graduations[0]));},v=>{v.petAccounts[0].badgeEvents[0].amount=2;},v=>{v.petAccounts[0].badgeEvents=[];},v=>{delete v.logs[0].changes[0].petEffect;},v=>{v.logs[0].changes[0].petEffect=null;},v=>{v.logs[0].changes[0].petEffect.cycleId='missing';},v=>{v.petLogs[0].changes[0].afterGrowth++;},v=>{v.petLogs[0].changes[0].accountId='missing';},v=>{v.petLogs[0].changes.push(clone(v.petLogs[0].changes[0]));},v=>{v.petAccounts[0].legacyMedals=1;},v=>{v.petAccounts.pop();}];
 for(const mutate of mutations){const bad=clone(s);mutate(bad);const bytes=JSON.stringify(bad);assert.throws(()=>Core.validateState(bad));assert.equal(JSON.stringify(bad),bytes);}
 reject(s,{type:'pet.stage-rules',thresholds:[5,5,5,5,5,null]},/已停用/);reject(s,{type:'pet.growth',ids:[first(s).id,'missing'],delta:1},/已停用/);
});
test('Old cycle selections cannot adopt or award score to a replacement pet',()=>{
 let s=graduatedArchive(),id=first(s).id,oldCycleId=account(s).cycles[0].id;reject(s,{type:'pet.adopt',id,pet:'cat',expectedCycleId:oldCycleId},/另一窗口/);s=act(s,{type:'pet.adopt',id,pet:'cat',expectedCycleId:null});
 reject(s,{type:'score',ids:[id],delta:3,expectedCycles:[{id,cycleId:oldCycleId}]},/另一窗口/);reject(s,{type:'score',ids:[id],delta:3,expectedCycles:[]},/不完整/);const next=act(s,{type:'score',ids:[id],delta:3,expectedCycles:[{id,cycleId:cycle(s).id}]});assert.equal(first(next).score,123);assert.equal(cycle(next).netGrowth,0);
});
test('Historical records and cycles retain explicit limits and never discard oldest entries',()=>{
 const s=historic();for(const field of ['petLogs','cycles','petAccounts']){const bad=clone(s);if(field==='cycles')bad.petAccounts[0].cycles=Array(20001).fill(bad.petAccounts[0].cycles[0]);else bad[field]=Array(20001).fill(bad[field][0]);assert.throws(()=>Core.validateState(bad),/数量超过上限/);}assert.equal(s.petLogs.length,1);assert.equal(account(s).cycles.length,2);
});
test('Complete UTF-8 JSON capacity remains exactly enforced',()=>{
 const object={text:'合成'},bytes=Buffer.byteLength(JSON.stringify(object));assert.equal(Core.assertStateCapacity(object,{maxBytes:bytes}),bytes);assert.throws(()=>Core.assertStateCapacity(object,{maxBytes:bytes-1}),/容量/);assert.equal(Core.MAX_STATE_BYTES,90*1024*1024);
 const payload={synthetic:'x'.repeat(Core.MAX_STATE_BYTES-Buffer.byteLength(JSON.stringify({synthetic:''})))};assert.equal(Core.assertStateCapacity(payload),Core.MAX_STATE_BYTES);payload.synthetic+='x';assert.throws(()=>Core.assertStateCapacity(payload),/容量/);
});
