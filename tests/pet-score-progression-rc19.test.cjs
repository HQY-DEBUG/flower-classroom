'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), os = require('node:os');
const Core = require('../src/core.cjs'), Scores = require('../src/pet-score-progression.js');
const Pet = require('../src/pet-progress.js'), Art = require('../src/pet-art.js');
const Wheels = require('../src/classroom-wheels.js'), {createStore} = require('../src/storage.cjs');
const Organization = require('../src/organization-tools.js');
const clone = value => structuredClone(value), now = 9000000;
const act = (state, action) => Core.applyAction(state, action, now);
const first = state => state.students[0], profile = state => Pet.profile(state, first(state));
const score = (state, delta) => act(state, {type:'score',ids:[first(state).id],delta,reason:'RC19 合成当前积分'});
const historic = () => Core.validateState(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/pet-score-history-rc19.json'), 'utf8')));
const boundaryRows = [[-1000000000,0,0,5],[-1,0,0,5],[0,0,0,5],[1,0,1,5],[4,0,4,5],[5,1,0,10],[14,1,9,10],[15,2,0,15],[29,2,14,15],[30,3,0,20],[49,3,19,20],[50,4,0,20],[69,4,19,20],[70,5,0,20],[89,5,19,20],[90,6,0,20],[109,6,19,20],[110,7,0,20],[129,7,19,20],[130,8,0,20],[1000000000,50000001,10,20]];

test('RC19 current-score progression: exact egg, every boundary and unbounded numeric levels', () => {
  assert.deepEqual(Scores.cumulative(), [5,15,30,50,70,90,110]);
  for (const [value,level,current,needed] of boundaryRows) {
    const p = Scores.progress(value);
    assert.equal(p.level,level,`score ${value}`); assert.equal(p.shape,Math.min(7,level));
    assert.equal(p.current,current); assert.equal(p.needed,needed); assert.equal(p.maxed,false); assert.equal(p.isEgg,level===0);
    assert.equal(p.remainingToNext,needed-current+Math.max(0,-value));
    assert.deepEqual(Core.petLevel({score:value,growth:999}), {level,current,needed});
  }
});

test('RC19 current-score progression: browser and CommonJS use the same model', () => {
  const context = vm.createContext({});
  for (const file of ['pet-score-progression.js','pet-progress.js']) vm.runInContext(fs.readFileSync(require.resolve('../src/'+file),'utf8'),context);
  for (const [value] of boundaryRows) assert.deepEqual(JSON.parse(JSON.stringify(context.PetScoreProgression.progress(value))),Scores.progress(value));
  const state = historic();
  context.stateJson=JSON.stringify(state);context.studentId=first(state).id;
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext('PetProgress.profile(JSON.parse(stateJson), studentId)',context))),profile(state));
});

test('RC19 current-score progression: all 40 species ignore old step, cycle growth, and egg flags', () => {
  let state = Core.importRows(Object.keys(Art.names).map((pet,i)=>({name:`合成宠物${i}`,group:'合成组'})),Core.createInitialState(),'replace');
  assert.equal(state.students.length,40);
  for (const [value,level] of boundaryRows) {
    for (const [index,student] of state.students.entries()) { student.score=value; student.growth=index*100; student.startFromEgg=index%2===0; }
    state.settings.petStep=99;
    const next=Core.validateState(state);
    for(const student of next.students) {const p=Pet.profile(next,student);assert.equal(p.level,level);assert.equal(p.isEgg,level===0);assert.equal(p.shape,Math.min(7,level));assert.equal(p.mode,'score');}
  }
  const old=historic();first(old).score=4;
  assert.ok(old.petAccounts.find(a=>a.studentId===first(old).id).lifetimeNetGrowth>4);
  assert.equal(profile(old).level,0);assert.equal(profile(old).isEgg,true);
});

test('RC19 current-score progression: ordinary addition, subtraction and undo recompute levels immediately', () => {
  let state=Core.createInitialState(); state=score(state,5);assert.equal(profile(state).level,1);
  state=score(state,10);const plus=state.logs.at(-1).id;assert.equal(profile(state).level,2);
  state=score(state,-1);const minus=state.logs.at(-1).id;assert.equal(profile(state).level,1);assert.equal(first(state).growth,0);
  state=act(state,{type:'undo',logId:minus});assert.equal(profile(state).level,2);
  state=act(state,{type:'undo',logId:plus});assert.equal(profile(state).level,1);
  state=score(state,-6);assert.equal(first(state).score,-1);assert.equal(profile(state).level,0);
  state=act(state,{type:'undo',logId:state.logs.at(-1).id});assert.equal(profile(state).level,1);
});

test('RC19 current-score progression: redemption lowers current level and undo restores it', () => {
  let state=score(Core.createInitialState(),30);
  const prize={id:'rc19_prize',name:'合成兑换',cost:16,weight:1};state=act(state,{type:'wheel.prizes',prizes:[prize]});
  const item=Wheels.list(state)[0],before=clone(first(state));
  state=act(state,{type:'wheel.redeem',id:first(state).id,redemptionId:'rc19_redeem',prizeId:item.id,expectedPrize:item,expectedScore:30});
  assert.equal(first(state).score,14);assert.equal(profile(state).level,1);assert.equal(first(state).growth,before.growth);
  state=act(state,{type:'undo',logId:state.logs.at(-1).id});assert.equal(profile(state).level,3);assert.equal(first(state).score,30);
});

test('RC19 current-score progression: existing history and graduation snapshots remain byte-identical through rule edits and adoption', () => {
  let state=historic(); const original=clone(state),id=first(state).id;
  state=act(state,{type:'petProgression.update',petProgression:{version:1,costs:[6,11,16,21,21,21,21],repeatCost:25},expectedProgressionKey:Scores.key(state)});
  for(const key of ['students','logs','petAccounts','petLogs'])assert.deepEqual(state[key],original[key],key);
  const expected=Scores.progress(first(state).score,Scores.get(state)).level;
  state=act(state,{type:'student.update',id,adopted:false});
  state=act(state,{type:'pet.adopt',id,pet:'dragon',expectedCycleId:state.petAccounts.find(a=>a.studentId===id).activeCycleId});
  assert.equal(profile(state).level,expected);assert.equal(first(state).score,first(original).score);
  assert.deepEqual(profile(state).graduates,Pet.profile(original,id).graduates);
  assert.equal(profile(state).medalTotal,Pet.profile(original,id).medalTotal);
  assert.deepEqual(state.logs,original.logs);assert.deepEqual(state.petLogs,original.petLogs);
});

test('RC19 current-score progression: repeat adoption after historical graduation cannot reset score or mint medals', () => {
  let state=historic();const id=first(state).id,account=state.petAccounts.find(a=>a.studentId===id);
  // Synthetic historical fixture already has a graduated cycle and an active one.
  const before=clone(profile(state).graduates),medals=profile(state).medalTotal,points=first(state).score,level=profile(state).level;
  for (const pet of ['fox','seal','dragon']) {state=act(state,{type:'student.update',id,adopted:false});state=act(state,{type:'pet.adopt',id,pet});assert.equal(first(state).score,points);assert.equal(profile(state).level,level);assert.equal(profile(state).medalTotal,medals);}
  assert.deepEqual(profile(state).graduates,before);assert.equal(state.petAccounts.find(a=>a.studentId===id).cycles.length,account.cycles.length);
});

test('RC19 current-score progression: first readoption from a previously graduated archive uses the same current score', () => {
  const archive=historic(),id=first(archive).id,account=archive.petAccounts.find(a=>a.studentId===id);
  account.cycles=account.cycles.filter(c=>c.status==='graduated');account.activeCycleId=null;
  account.lifetimeNetGrowth=account.unassignedGrowth+account.cycles.reduce((sum,c)=>sum+c.netGrowth,0);
  archive.petLogs=archive.petLogs.filter(log=>log.changes.every(c=>c.id!==id));first(archive).adopted=false;
  const state=Core.validateState(archive),before=clone(state),next=act(state,{type:'pet.adopt',id,pet:'dragon',expectedCycleId:null});
  assert.equal(first(next).score,first(before).score);assert.equal(profile(next).level,Scores.progress(first(before).score).level);
  assert.equal(profile(next).historicalGrowth,0);assert.deepEqual(profile(next).graduates,profile(before).graduates);
  assert.equal(profile(next).medalTotal,profile(before).medalTotal);assert.deepEqual(next.logs,before.logs);
});

test('RC19 current-score progression: retired growth, reset and graduation entry points reject atomically', () => {
  const state=historic(),id=first(state).id,before=JSON.stringify(state);
  const actions=[{type:'pet.rules',step:5},{type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]},{type:'pet.growth',ids:[id],delta:5},{type:'pet.growth.mixed',awards:[{ids:[id],delta:1}]},{type:'pet.undo',logId:state.petLogs[0]?.id},{type:'pet.growth-policy',growthFloor:'clamp'},{type:'pet.graduate',id},{type:'pet.batch',operation:'graduate',ids:[id]},{type:'pet.batch',operation:'growth',ids:[id],delta:1},{type:'points.clear',confirmed:true,expectedRevision:state.revision,options:{scores:true,groupScores:false,petGrowth:true,history:false,petHistory:false}}];
  for(const action of actions){assert.throws(()=>act(state,action),/当前积分.*已停用/);assert.equal(JSON.stringify(state),before);}
  for(const operation of ['growth','graduate']){const preview=Pet.batchPreview(state,{operation,ids:[id],delta:1});assert.deepEqual(preview.eligibleIds,[]);assert.match(preview.excluded[0].reason,/当前积分/);}
});

test('RC19 current-score progression: one root schedule survives create, copy, switch, remove and full save/restore', t => {
  let state=historic(); const schedule={version:1,costs:[8,10,12,14,16,18,20],repeatCost:22};
  state=act(state,{type:'petProgression.update',petProgression:schedule});const originalPanel=Core.panelId(state),original=clone(state);
  for(const mode of ['blank','copy','full']){
    state=act(state,{type:'panel.create',mode,name:'合成'+mode});assert.deepEqual(state.petProgression,schedule);
    for(const panel of state.panels.others)assert.equal(panel.data.petProgression,undefined);
    state=act(state,{type:'panel.switch',id:originalPanel});assert.deepEqual(state.petProgression,schedule);assert.deepEqual(state.students,original.students);assert.deepEqual(state.petAccounts,original.petAccounts);
  }
  state=act(state,{type:'panel.remove'});assert.deepEqual(state.petProgression,schedule);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rc19-score-save-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=createStore(root,{validate:Core.validateState,initial:Core.createInitialState});const saved=store.save(state);
  const restored=createStore(root,{validate:Core.validateState,initial:Core.createInitialState}).load().state;
  assert.deepEqual(restored,saved);assert.deepEqual(restored.petProgression,schedule);
  const tampered=clone(state);tampered.panels.others[0].data.petProgression=clone(schedule);assert.throws(()=>Core.validateState(tampered),/根部/);
});

test('RC19 current-score progression: invalid schedules and stale edits leave the entire classroom unchanged', () => {
  const state=historic(),before=JSON.stringify(state),valid=Scores.get(state);
  for(const invalid of [null,[],{...valid,version:2},{...valid,costs:[5,10]},{...valid,costs:[0,10,15,20,20,20,20]},{...valid,repeatCost:0},{...valid,repeatCost:0.5},{...valid,costs:Array(7).fill(1e9)},{...valid,mode:'legacy'}])assert.throws(()=>act(state,{type:'petProgression.update',petProgression:invalid}));
  assert.throws(()=>act(state,{type:'petProgression.update',petProgression:valid,expectedProgressionKey:'stale'}),/另一窗口/);
  assert.equal(JSON.stringify(state),before);
  for(const invalid of [1.5,NaN,Infinity,'5',1000000001,-1000000001])assert.throws(()=>Scores.progress(invalid));
});

test('RC19 current-score progression: old negative independent growth metadata cannot block ordinary card points', () => {
  let state=Core.createInitialState();state=act(state,{type:'rules.save',rules:[{id:'old_negative_growth',label:'合成旧卡片',delta:-1,growthDelta:-5,enabled:true}]});
  state=score(state,5);const rule=state.settings.scoreRules.find(r=>r.id==='old_negative_growth');
  state=act(state,{type:'score',ids:[first(state).id],delta:rule.delta,reason:rule.label,expectedRule:rule});
  assert.equal(first(state).score,4);assert.equal(profile(state).level,0);assert.equal(first(state).growth,0);
});

test('RC19 roster gender: explicit optional values survive add, update, import, clone, validation and restore', () => {
  let state=Core.createInitialState();state=act(state,{type:'student.add',name:'合成女生',group:'合成组',gender:'女'});
  const id=state.students.at(-1).id;state=act(state,{type:'student.update',id,gender:'男',expectedStudent:{gender:'女'}});
  assert.equal(state.students.at(-1).gender,'男');
  state=Core.importRows([{姓名:'合成空值',性别:''},{name:'合成男生',gender:'男'},{name:'合成无性别'}],state);
  assert.deepEqual(state.students.slice(-3).map(v=>v.gender),['','男',undefined]);
  state=act(state,{type:'panel.create',mode:'copy',name:'合成复制'});
  assert.deepEqual(state.students.slice(-4).map(v=>v.gender),['男','','男',undefined]);
  assert.deepEqual(Core.validateState(JSON.parse(JSON.stringify(state))),state);
  const before=JSON.stringify(state);assert.throws(()=>act(state,{type:'student.update',id:first(state).id,gender:'未知'}),/性别/);assert.equal(JSON.stringify(state),before);
});

test('RC19 current-score progression: archived growth can never block or absorb a new score', () => {
  let state=Core.createInitialState();first(state).growth=1000000000;
  state=score(state,5);assert.equal(first(state).growth,1000000000);assert.equal(first(state).score,5);assert.equal(profile(state).level,1);
  assert.equal(state.logs.at(-1).growthDelta,0);assert.equal(state.logs.at(-1).changes[0].beforeGrowth,state.logs.at(-1).changes[0].afterGrowth);
  const history=historic(),before=clone(history.petAccounts),scored=score(history,1);
  assert.deepEqual(scored.petAccounts,before);assert.equal(scored.logs.at(-1).changes[0].petEffect,null);
  const undone=act(scored,{type:'undo',logId:scored.logs.at(-1).id});assert.deepEqual(undone.petAccounts,before);assert.deepEqual(undone.students,history.students);
});

test('RC19 current-score progression: pet controls work before any legacy ledger exists and never mint honors', () => {
  let state=score(Core.createInitialState(),15),id=first(state).id;assert.equal(state.petAccounts,undefined);
  state=act(state,{type:'pet.switch',id,pet:'dragon',panelId:Core.panelId(state),expectedPet:first(state).pet,expectedCycleId:null});assert.equal(profile(state).level,2);
  state=act(state,{type:'student.update',id,adopted:false});
  state=act(state,{type:'pet.adopt',id,pet:'seal',expectedCycleId:null});
  assert.equal(profile(state).level,2);assert.equal(first(state).score,15);assert.equal(profile(state).medalTotal,0);
  state=act(state,{type:'student.update',id,adopted:false});
  state=act(state,{type:'pet.batch',operation:'adopt',ids:[id],pet:'seal',requestId:'rc19_new_adopt',expectedRevision:state.revision});
  state=act(state,{type:'pet.batch',operation:'switch',ids:[id],pet:'fox',requestId:'rc19_new_switch',expectedRevision:state.revision});
  state=act(state,{type:'pet.draw',scope:'students',mode:'cycle',count:1});assert.equal(state.petDraw.lastIds.length,1);
  state=act(state,{type:'pet.draw.reset'});assert.equal(state.petDraw.lastIds.length,0);assert.equal(first(state).score,15);
});

test('RC19 pet-origin score guards: changed rules, cycles, paused targets, duplicates and incomplete previews reject atomically', () => {
  const state=Core.createInitialState(),id=first(state).id;
  const request={type:'score',ids:[id],delta:5,reason:'合成宠物积分',expectedCycles:[{id,cycleId:null}],expectedProgressionKey:Scores.key(state)};
  assert.equal(profile(act(state,request)).level,1);
  const changed=act(state,{type:'petProgression.update',petProgression:{version:1,costs:[6,10,15,20,20,20,20],repeatCost:20}});
  assert.throws(()=>act(changed,request),/全局宠物进阶.*另一窗口/);
  const paused=act(state,{type:'student.update',id,adopted:false});assert.throws(()=>act(paused,request),/暂停领养/);
  const withLedger=act(state,{type:'pet.draw.reset'});assert.throws(()=>act(withLedger,request),/重新选择/);
  for(const expectedCycles of [[],[{id,cycleId:'old_cycle'}],[{id:'missing',cycleId:null}],[{id,cycleId:null},{id,cycleId:null}]])assert.throws(()=>act(state,{...request,expectedCycles}));
  assert.equal(first(state).score,0);assert.equal(state.petAccounts,undefined);
});

test('RC19 pet-origin mixed scores use the reviewed pet draw and reject fresh draws and out-of-result targets', () => {
  let state=act(Core.createInitialState(),{type:'pet.draw',scope:'students',mode:'repeat',count:2});
  const ids=state.petDraw.lastIds,request={type:'score.mixed',awards:ids.map(id=>({id,delta:5})),expectedPetDraw:Organization.petDrawKey(state),expectedProgressionKey:Scores.key(state),expectedCycles:ids.map(id=>({id,cycleId:Pet.profile(state,id).activeCycleId}))};
  const next=act(state,request);assert.ok(ids.every(id=>Pet.profile(next,id).level===1));assert.equal(next.logs.length,1);
  assert.deepEqual(next.draw,state.draw);assert.deepEqual(next.petAccounts,state.petAccounts);
  const outside=state.students.find(s=>!ids.includes(s.id)).id;
  assert.throws(()=>act(state,{...request,awards:[{id:outside,delta:5}],expectedCycles:[{id:outside,cycleId:Pet.profile(state,outside).activeCycleId}]}),/不存在/);
  assert.throws(()=>act(state,{type:'score',ids:[outside],delta:5,expectedPetDraw:request.expectedPetDraw}),/不存在/);
  const signed=act(state,{...request,awards:[{id:ids[0],delta:-3},{id:ids[1],delta:7}]});
  assert.equal(signed.students.find(s=>s.id===ids[0]).score,-3);assert.equal(signed.students.find(s=>s.id===ids[1]).score,7);assert.deepEqual(signed.petAccounts,state.petAccounts);
  state=act(state,{type:'pet.draw',scope:'students',mode:'repeat',count:2});assert.throws(()=>act(state,request),/宠物抽取结果已变化/);
});
