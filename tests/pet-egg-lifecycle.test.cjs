'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {Core,Pet,clone,first,account,cycle,act,score,profile,historic,graduatedArchive,reject,initLedger,guard}=require('./pet-history-rc19.cjs');
const Art=require('../src/pet-art.js'),Scores=require('../src/pet-score-progression.js'),{legacyState}=require('./pet-fixtures.cjs');
const id=s=>first(s).id,switchPet=(s,pet)=>act(s,{type:'pet.switch',id:id(s),pet,panelId:Core.panelId(s),expectedPet:profile(s).pet,expectedCycleId:profile(s).activeCycleId});
function unmarkedArchive(){const s=historic();delete first(s).startFromEgg;delete cycle(s).startFromEgg;first(s).score=0;return Core.validateState(s);}

test('RC19 eggs: all forty species use levels zero at 0–4, then exact shared score boundaries and capped art',()=>{
 const examples=Core.createInitialState();assert.ok(examples.students.every(s=>s.startFromEgg===true&&Pet.profile(examples,s).isEgg));const pets=Object.keys(Art.names);assert.equal(pets.length,40);
 let s=Core.importRows(pets.map((pet,i)=>({name:`纯合成宠物${i}`,group:'合成组'})),examples,'replace');assert.deepEqual(s.students.map(v=>v.pet),pets);const ids=s.students.map(v=>v.id);
 for(const [delta,value,level] of [[1,1,0],[3,4,0],[1,5,1],[10,15,2],[15,30,3],[20,50,4],[20,70,5],[20,90,6],[20,110,7],[20,130,8]]){s=score(s,delta,ids);assert.ok(s.students.every(v=>v.score===value&&Pet.profile(s,v).level===level&&Pet.profile(s,v).shape===Math.min(7,level)&&Pet.profile(s,v).isEgg===(level===0)));}
 assert.ok(s.students.every(v=>v.growth===0&&Pet.profile(s,v).medalTotal===0));
});
test('RC19 eggs: legacy v1 marker absence, photos and audit data remain intact while display uses score',()=>{
 const raw=legacyState(),s=Core.validateState(raw);assert.deepEqual(s.students,raw.students);assert.deepEqual(s.logs,raw.logs);for(const student of s.students){assert.equal(Object.hasOwn(student,'startFromEgg'),false);assert.equal(Pet.profile(s,student).isEgg,student.adopted===false||student.score<5);}
 const initialized=initLedger(s);assert.deepEqual(initialized.students,s.students);for(const student of s.students)assert.equal(Pet.profile(initialized,student).level,Scores.progress(student.score).level);assert.deepEqual(Core.validateState(clone(initialized)),initialized);
});
test('RC19 eggs: old unmarked cycles become eggs at score zero through restore, switch, pause and resume',()=>{
 let s=unmarkedArchive(),old=clone(s),cycleId=cycle(s).id;assert.equal(profile(s).isEgg,true);assert.equal(profile(s).level,0);s=switchPet(s,'dragon');s=act(s,{type:'student.update',id:id(s),adopted:false});s=act(s,{type:'pet.adopt',id:id(s),pet:'cat'});
 assert.equal(profile(s).isEgg,true);assert.equal(first(s).score,0);assert.equal(cycle(s).id,cycleId);assert.equal(Object.hasOwn(cycle(s),'startFromEgg'),false);assert.equal(cycle(s).netGrowth,cycle(old).netGrowth);assert.deepEqual(s.petLogs,old.petLogs);
});
test('RC19 eggs: pre-ledger score and undo hatch only at five without writing historical growth',()=>{
 let s=Core.createInitialState();s=score(s,4);assert.equal(profile(s).isEgg,true);s=score(s,1);const log=s.logs.at(-1).id;assert.equal(profile(s).isEgg,false);assert.equal(profile(s).level,1);assert.equal(first(s).growth,0);s=act(s,{type:'undo',logId:log});assert.equal(profile(s).isEgg,true);const before=clone(s.students);s=initLedger(s);assert.deepEqual(s.students,before);assert.equal(profile(s).level,0);assert.equal(cycle(s).netGrowth,0);
});
test('RC19 eggs: add/import/fresh copies start at zero; full copies retain source score and every marker',()=>{
 for(const base of [Core.validateState(legacyState()),historic()]){let s=act(base,{type:'student.add',name:'纯合成新增',pet:'dragon',adopted:false});assert.equal(s.students.at(-1).startFromEgg,true);assert.equal(Pet.profile(s,s.students.at(-1)).level,0);assert.deepEqual(s.students.slice(0,-1),base.students);
 s=Core.importRows([{name:'纯合成导入'}],s,'append');assert.equal(Pet.profile(s,s.students.at(-1)).isEgg,true);s=Core.importRows([{name:'纯合成替换'}],s,'replace');assert.equal(profile(s).isEgg,true);
 const fresh=act(base,{type:'panel.create',mode:'copy',name:'纯合成名单副本'});assert.ok(fresh.students.every(v=>Pet.profile(fresh,v).isEgg&&v.score===0));assert.deepEqual(fresh.panels.others[0].data.students,base.students);assert.equal(fresh.panels.others[0].data.petProgression,undefined);
 const full=act(base,{type:'panel.create',mode:'full',name:'纯合成完整副本'});assert.deepEqual(full.students.map(v=>[v.score,v.growth,v.startFromEgg,Pet.profile(full,v).isEgg]),base.students.map(v=>[v.score,v.growth,v.startFromEgg,Pet.profile(base,v).isEgg]));
 let blank=act(base,{type:'panel.create',mode:'blank',name:'纯合成空白'});blank=act(blank,{type:'student.add',name:'纯合成空白新增'});assert.equal(profile(blank).isEgg,true);}
});
test('RC19 eggs: deduction and undo cross the egg boundary, negative points preserve debt, explicit score clear resets it',()=>{
 let s=score(historic(),-100);s=score(s,-15);assert.equal(first(s).score,5);assert.equal(profile(s).isEgg,false);const old=clone(s);s=score(s,-1);const penalty=s.logs.at(-1).id;assert.equal(profile(s).isEgg,true);s=act(s,{type:'undo',logId:penalty});assert.equal(profile(s).isEgg,false);s=score(s,-100);assert.equal(first(s).score,-95);assert.equal(profile(s).remainingToNext,100);
 s=act(s,{type:'points.clear',confirmed:true,expectedRevision:s.revision,options:{scores:true,groupScores:false,petGrowth:false,history:false,petHistory:false}});assert.equal(first(s).score,0);assert.equal(profile(s).level,0);assert.deepEqual(s.petAccounts,old.petAccounts);assert.deepEqual(s.petLogs,old.petLogs);
});
test('RC19 eggs: re-adoption after a historical graduation does not reset score and old-score undo preserves the newer cycle',()=>{
 let s=graduatedArchive(),oldCycle=account(s).cycles[0].id,snapshots=clone(account(s).graduations);s=act(s,{type:'pet.adopt',id:id(s),pet:'cat'});const newCycle=cycle(s).id;assert.notEqual(newCycle,oldCycle);assert.equal(cycle(s).startFromEgg,true);assert.equal(profile(s).isEgg,false);assert.equal(profile(s).level,7);
 s=act(s,{type:'undo',logId:'legacy_score_rc19_fixture'});assert.equal(profile(s).level,7);assert.equal(first(s).score,110);assert.equal(cycle(s).netGrowth,0);assert.equal(account(s).cycles.find(c=>c.id===oldCycle).netGrowth,190);assert.deepEqual(account(s).graduations,snapshots);assert.equal(profile(s).medalTotal,1);assert.deepEqual(Core.validateState(clone(s)),s);
});
test('RC19 eggs: single/batch species switches and pause/resume retain score, historical markers and cycle identity',()=>{
 let s=unmarkedArchive(),originalCycle=cycle(s).id;for(const pet of Object.keys(Art.names)){s=switchPet(s,pet);assert.equal(profile(s).isEgg,true);assert.equal(cycle(s).id,originalCycle);assert.equal(Object.hasOwn(cycle(s),'startFromEgg'),false);}
 s=score(s,7);const before=clone(s),ids=s.students.slice(0,2).map(v=>v.id);s=act(s,{type:'pet.batch',operation:'switch',ids,pet:'cat',...guard(s)});assert.equal(profile(s).level,1);assert.equal(first(s).score,7);assert.equal(profile(s).isEgg,false);assert.equal(Pet.profile(s,ids[1]).isEgg,true);assert.deepEqual(s.logs,before.logs);assert.deepEqual(s.petLogs,before.petLogs);
 s=act(s,{type:'student.update',id:id(s),adopted:false});s=act(s,{type:'pet.adopt',id:id(s),pet:'dragon'});assert.equal(first(s).score,7);assert.equal(cycle(s).id,originalCycle);
});
test('RC19 eggs: adoption previews, rankings and honor cards all expose the same score-based level and egg state',()=>{
 let s=Core.createInitialState(),ids=s.students.slice(0,2).map(v=>v.id);assert.ok(Pet.studentRankings(s,{sortBy:'level'}).every(row=>row.rank===1&&row.level===0&&row.isEgg));assert.ok(Pet.groupRankings(s).every(row=>row.medalTotal===0));let card=Pet.honorCard(s,ids[0]);assert.equal(card.level,0);assert.equal(card.isEgg,true);
 s=score(s,5,ids);s=act(s,{type:'student.update',id:ids[0],adopted:false});const preview=Pet.batchPreview(s,{operation:'adopt',ids,pet:'dragon'});assert.equal(preview.eligibleIds.length,1);assert.equal(preview.rows[0].afterLevel,1);assert.equal(preview.rows[0].afterIsEgg,false);s=act(s,{type:'pet.batch',operation:'adopt',ids:preview.eligibleIds,pet:'dragon',...guard(s)});card=Pet.honorCard(s,ids[0]);assert.equal(card.level,1);assert.equal(card.isEgg,false);assert.equal(card.totalHonors,0);
});
test('RC19 eggs: optional historical true/false markers round-trip but never override current score; non-booleans reject',()=>{
 for(const marker of [true,false]){const raw=historic();first(raw).startFromEgg=marker;cycle(raw).startFromEgg=marker;first(raw).score=4;const s=Core.validateState(raw);assert.deepEqual(s,raw);assert.equal(profile(s).isEgg,true);assert.equal(profile(score(s,1)).isEgg,false);assert.deepEqual(Core.validateState(clone(s)),s);}
 for(const invalid of [undefined,null,0,1,'true',[],{}]){let bad=historic();first(bad).startFromEgg=invalid;assert.throws(()=>Core.validateState(bad),/蛋起始标记/);bad=historic();cycle(bad).startFromEgg=invalid;assert.throws(()=>Core.validateState(bad),/蛋起始标记/);bad=historic();account(bad).cycles[0].startFromEgg=invalid;assert.throws(()=>Core.validateState(bad),/蛋起始标记/);}
});
test('RC19 eggs: mixed old/new panel archives retain marker absence and snapshots, including browser model parity',()=>{
 let s=unmarkedArchive(),oldPanel=Core.panelId(s),old=clone(s);s=act(s,{type:'panel.create',mode:'copy',name:'纯合成新蛋班'});const newPanel=Core.panelId(s);s=score(s,5);const next=clone(s);s=act(s,{type:'panel.switch',id:oldPanel});assert.equal(profile(s).isEgg,true);assert.equal(Object.hasOwn(cycle(s),'startFromEgg'),false);assert.deepEqual(s.petAccounts,old.petAccounts);s=act(s,{type:'panel.switch',id:newPanel});for(const key of ['students','logs','petAccounts','petLogs','settings'])assert.deepEqual(s[key],next[key]);
 const c=vm.createContext({});for(const f of ['pet-score-progression.js','pet-progress.js'])vm.runInContext(fs.readFileSync(require.resolve('../src/'+f),'utf8'),c);c.json=JSON.stringify(s);for(const fn of ['profile','honorCard'])assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(`PetProgress.${fn}(JSON.parse(json),JSON.parse(json).students[0].id)`,c))),Pet[fn](s,id(s)));assert.deepEqual(Core.validateState(clone(s)),s);
});
