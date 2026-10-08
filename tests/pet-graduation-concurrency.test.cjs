'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../src/core.cjs'),Progress=require('../src/pet-progress.js');
const act=(s,a)=>Core.applyAction(s,a,3000000),clone=v=>JSON.parse(JSON.stringify(v));
function ready(){let s=Core.createInitialState();s=act(s,{type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]});return act(s,{type:'pet.growth',ids:[s.students[0].id],delta:30});}
function confirmation(s){const student=s.students[0],p=Progress.profile(s,student);return {type:'pet.graduate',id:student.id,panelId:Core.panelId(s),expectedCycleId:p.activeCycleId,expectedGraduation:{pet:p.pet,growth:p.growth,thresholds:[...s.settings.petRules.thresholds],studentName:student.name,groupName:student.group}};}
function unchangedReject(s,a,pattern=/毕业资料.*重新打开/){const before=clone(s);assert.throws(()=>act(s,a),pattern);assert.deepEqual(s,before);}

test('graduation confirmation rejects same-cycle species, growth, rule, name and group changes atomically',()=>{
 for(const change of ['pet','growth','thresholds','name','group']){
  const initial=ready(),request=confirmation(initial),id=initial.students[0].id;
  const edit=change==='pet'?{type:'pet.switch',id,pet:'fox',panelId:Core.panelId(initial),expectedPet:initial.students[0].pet,expectedCycleId:request.expectedCycleId}:
    change==='growth'?{type:'pet.growth',ids:[id],delta:7}:
    change==='thresholds'?{type:'pet.stage-rules',thresholds:[1,1,1,1,1,1]}:{type:'student.update',id,[change]:'合成另窗修改'};
  unchangedReject(act(initial,edit),request);
 }
});

test('graduation snapshot allows unrelated score and other-student growth without losing those changes',()=>{
 const initial=ready(),request=confirmation(initial),id=initial.students[0].id;
 let latest=act(initial,{type:'score',ids:[id],delta:-1});latest=act(latest,{type:'pet.growth',ids:[latest.students[1].id],delta:2});
 const result=act(latest,request),p=Progress.profile(result,id);
 assert.equal(result.students[0].score,-1);assert.equal(Progress.profile(result,result.students[1]).growth,2);
 assert.equal(p.graduates.length,1);assert.equal(p.graduates[0].petSnapshot,request.expectedGraduation.pet);
 assert.equal(p.graduates[0].growthSnapshot,30);assert.deepEqual(p.graduates[0].ruleSnapshot.thresholds,[5,5,5,5,5,5]);assert.equal(p.medalTotal,1);
 unchangedReject(result,request,/另一窗口/);
});

test('same-species readoption with identical growth still rejects old cycle confirmation',()=>{
 const initial=ready(),request=confirmation(initial),id=initial.students[0].id;
 let latest=act(initial,request);latest=act(latest,{type:'pet.adopt',id,pet:initial.students[0].pet});latest=act(latest,{type:'pet.growth',ids:[id],delta:30});
 unchangedReject(latest,request,/另一窗口/);
});

test('malformed or incomplete optional graduation snapshot is rejected atomically',()=>{
 const s=ready(),request=confirmation(s);
 for(const invalid of [null,{},[],{...request.expectedGraduation,thresholds:[]},{...request.expectedGraduation,thresholds:new Array(6)},{...request.expectedGraduation,thresholds:[5,5,5,5,5,'5']},{...request.expectedGraduation,growth:'30'}])
  unchangedReject(s,{...request,expectedGraduation:invalid},/快照|毕业资料/);
});

test('legacy core graduation callers without a snapshot remain compatible',()=>{
 const s=ready(),result=act(s,{type:'pet.graduate',id:s.students[0].id});assert.equal(Progress.profile(result,result.students[0]).graduates.length,1);
});
