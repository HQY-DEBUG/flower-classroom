'use strict';
// RC19 user explicitly defers new graduation operations and keeps all earned history.
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../src/core.cjs'),Pet=require('../src/pet-progress.js'),Scores=require('../src/pet-score-progression.js');
const act=(s,a)=>Core.applyAction(s,a,3000000),clone=v=>structuredClone(v);
function ready(){const s=Core.validateState(require('./fixtures/pet-score-history-rc19.json'));for(const student of s.students)student.score=110;return Core.validateState(s);}
function confirmation(s){const student=s.students.find(x=>Pet.profile(s,x).adopted),p=Pet.profile(s,student);return {type:'pet.graduate',id:student.id,panelId:Core.panelId(s),expectedCycleId:p.activeCycleId,expectedGraduation:{pet:p.pet,growth:p.growth,thresholds:s.settings.petRules?.thresholds,studentName:student.name,groupName:student.group}};}
function unchangedReject(s,a){const before=clone(s);assert.throws(()=>act(s,a),/暂不设置|统一.*积分|停用/);assert.deepEqual(s,before);}
function honors(s){return {accounts:clone(s.petAccounts),petLogs:clone(s.petLogs),studentHistorical:s.students.map(x=>({id:x.id,growth:x.growth,medals:x.medals}))};}

test('deferred graduation rejects current and stale species, score, global-rule, name and group confirmations without mutation',()=>{
 for(const change of ['pet','score','rules','name','group']){
  const initial=ready(),request=confirmation(initial),id=request.id,student=initial.students.find(x=>x.id===id);
  const edit=change==='pet'?{type:'pet.switch',id,pet:student.pet==='fox'?'owl':'fox',panelId:Core.panelId(initial),expectedPet:student.pet,expectedCycleId:request.expectedCycleId}:
   change==='score'?{type:'score',ids:[id],delta:7}:
   change==='rules'?{type:'petProgression.update',petProgression:{version:1,costs:[6,10,15,20,20,20,20],repeatCost:20},expectedProgressionKey:Scores.key(initial)}:{type:'student.update',id,[change]:'合成另窗修改'};
  unchangedReject(initial,request);unchangedReject(act(initial,edit),request);
 }
});
test('deferred graduation never rewards two windows or repeated direct requests and keeps unrelated later scores',()=>{
 const initial=ready(),request=confirmation(initial),beforeHonors=honors(initial);
 let latest=act(initial,{type:'score',ids:[request.id],delta:-1});latest=act(latest,{type:'score',ids:[latest.students.at(-1).id],delta:2});
 const scores=latest.students.map(x=>[x.id,x.score]);for(let i=0;i<4;i++)unchangedReject(latest,request);
 assert.deepEqual(latest.students.map(x=>[x.id,x.score]),scores);assert.deepEqual(honors(latest),beforeHonors);
});
test('deferred graduation rejects batch and pre-readoption requests while stored graduation and badge balances survive',()=>{
 const initial=ready(),request=confirmation(initial),student=initial.students.find(x=>x.id===request.id),before=honors(initial);
 let latest=act(initial,{type:'student.update',id:student.id,adopted:false});latest=act(latest,{type:'pet.adopt',id:student.id,pet:student.pet});
 unchangedReject(latest,request);unchangedReject(latest,{type:'pet.batch',operation:'graduate',ids:[student.id],requestId:'deferred_batch',expectedRevision:latest.revision,panelId:Core.panelId(latest)});
 assert.deepEqual(honors(latest),before);assert.equal(latest.students.find(x=>x.id===student.id).score,110);
});
test('deferred graduation rejects malformed snapshots atomically rather than partially granting an honor',()=>{
 const s=ready(),request=confirmation(s);
 for(const invalid of [null,{},[],{...request.expectedGraduation,thresholds:[]},{...request.expectedGraduation,growth:'110'}])unchangedReject(s,{...request,expectedGraduation:invalid});
});
test('deferred graduation rejects legacy callers without snapshot and preserves full nonempty history across JSON reload',()=>{
 const s=ready(),before=honors(s);assert.ok(s.petAccounts.some(a=>a.graduations.length));
 unchangedReject(s,{type:'pet.graduate',id:s.students[0].id});const loaded=Core.validateState(JSON.parse(JSON.stringify(s)));assert.deepEqual(honors(loaded),before);
 for(const student of loaded.students)assert.equal(Pet.profile(loaded,student).level,7);
});
