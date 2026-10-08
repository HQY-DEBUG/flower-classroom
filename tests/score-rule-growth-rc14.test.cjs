'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../src/core.cjs');
const Rules = require('../src/score-rules.js');
const Progress = require('../src/pet-progress.js');
const { createActionReceipts } = require('../src/action-receipts.cjs');
const { legacyState } = require('./pet-fixtures.cjs');

const clone = value => JSON.parse(JSON.stringify(value));
const act = (state, action) => Core.applyAction(state, action, 14_000_000);
const first = state => state.students[0];
const rules = state => Rules.list(state);
const save = (state, changed) => act(state, { type: 'rules.save', rules: changed, expectedRules: rules(state), panelId: Core.panelId(state) });
const configured = (patch, state = Core.createInitialState()) => save(state, rules(state).map((rule, index) => index ? rule : { ...rule, ...patch }));
// Archived fixtures were generated once with immutable RC18; this suite executes only RC19.
const archived = name => Core.validateState(clone(require('./fixtures/rc18-custom-growth-snapshots.json')[name]));
const enable = state => state;
const account = (state, id = first(state).id) => state.petAccounts.find(item => item.studentId === id);
const cycle = (state, id = first(state).id) => account(state, id).cycles.find(item => item.id === account(state, id).activeCycleId);
function ruleAction(state, { type = 'score', custom = false, id = first(state).id, index = 0 } = {}) {
  const rule = rules(state)[index];
  return { type, ids: [id], delta: type === 'pet.growth' ? Rules.effectiveGrowth(rule, true) : rule.delta,
    reason: rule.label, expectedRule: rule, panelId: Core.panelId(state),
    ...(custom && Object.hasOwn(rule, 'growthDelta') ? { growthDelta: rule.growthDelta } : {}) };
}
function rejectsWithoutChange(state, action, pattern) {
  const before = JSON.stringify(state);
  assert.throws(() => act(state, action), pattern);
  assert.equal(JSON.stringify(state), before);
}

test('RC14 reason growth: omitted defaults retain exactly the prior rule fields and contextual growth', () => {
  const defaults = Rules.list();
  assert.ok(defaults.every(rule => !Object.hasOwn(rule, 'growthDelta')));
  assert.equal(Rules.effectiveGrowth(defaults[0], false), 1);
  assert.equal(Rules.effectiveGrowth(defaults[5], false), 0);
  assert.equal(Rules.effectiveGrowth(defaults[5], true), -1);
  const changed = { ...defaults[0], growthDelta: 0 };
  assert.equal(Rules.effectiveGrowth(changed, false), 0);
  assert.equal(Rules.effectiveGrowth(changed, true), 0);
  assert.deepEqual(Rules.validateRules([changed]), [changed]);
  assert.equal(Rules.same([changed], [defaults[0]]), false);
});

test('RC14 reason growth: signed growth has strict numeric bounds and browser/CommonJS parity', () => {
  const baseline = Rules.list()[0];
  for (const growthDelta of [-100, -1, 0, 1, 100]) assert.equal(Rules.validateRules([{ ...baseline, growthDelta }])[0].growthDelta, growthDelta);
  for (const growthDelta of [-101, 101, 1.5, '', '0', null, undefined, NaN, Infinity, true, {}]) {
    assert.throws(() => Rules.validateRules([{ ...baseline, growthDelta }]), /成长值/);
  }
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../src/score-rules.js'), 'utf8'), context);
  assert.deepEqual(clone(context.ScoreRules.list()), Rules.list());
  assert.equal(vm.runInContext('ScoreRules.effectiveGrowth({delta: 5, growthDelta: 0}, true)', context), 0);
  assert.equal(vm.runInContext('ScoreRules.validateRules([{id:"rule_test",label:"合成",delta:1,growthDelta:-2}])[0].growthDelta', context), -2);
});

test('RC14 reason growth: old v1 records and rule metadata survive root progression upgrade', () => {
  const old = Core.validateState(legacyState());
  assert.deepEqual(Core.validateState(clone(old)), old);
  assert.equal(old.version, 2);
  assert.ok(old.logs.every(log => !Object.hasOwn(log, 'growthDelta')));
  assert.ok(rules(old).every(rule => !Object.hasOwn(rule, 'growthDelta')));
});

test('RC14 reason growth replacement: all new scores freeze legacy growth and record explicit zero effect', () => {
 let state=Core.createInitialState();const id=first(state).id;state=act(state,{type:'score',ids:[id],delta:6});state=act(state,{type:'score',ids:[id],delta:-3});
 assert.equal(first(state).score,3);assert.equal(first(state).growth,0);assert.ok(state.logs.every(l=>l.growthDelta===0));assert.deepEqual(Core.validateState(clone(state)),state);
});

test('RC14 reason growth replacement: saved rule growth metadata cannot change new score effects', () => {
 for(const growthDelta of [-100,-1,0,1,7,100]){const state=configured({delta:3,growthDelta}),next=act(state,ruleAction(state));assert.equal(first(next).score,3);assert.equal(first(next).growth,0);assert.equal(next.logs[0].growthDelta,0);assert.equal(next.logs[0].changes[0].afterGrowth,0);assert.deepEqual(Core.validateState(clone(next)),next);assert.deepEqual(first(act(next,{type:'undo',logId:next.logs[0].id})),first(state));}
});

test('RC14 reason growth replacement: deductions and zero-growth metadata still follow score egg boundaries', () => {
 let state=configured({delta:-3,growthDelta:4});state=act(state,ruleAction(state));assert.equal(first(state).score,-3);assert.equal(first(state).growth,0);assert.equal(Progress.profile(state,first(state)).isEgg,true);
 state=act(state,{type:'undo',logId:state.logs[0].id});state=configured({delta:5,growthDelta:0},state);state=act(state,ruleAction(state));assert.equal(Progress.profile(state,first(state)).level,1);assert.equal(first(state).growth,0);
});

test('RC14 reason growth replacement: nonzero or malformed direct growth overrides reject atomically', () => {
 const state=configured({growthDelta:4}),command=ruleAction(state);
 for(const growthDelta of [-1,1,4,5,101,'4',null,undefined])rejectsWithoutChange(state,{...command,growthDelta},/成长|积分|停用/);
 const detached={...command,growthDelta:4};delete detached.expectedRule;rejectsWithoutChange(state,detached,/成长|积分|停用/);
 assert.equal(act(state,{...command,growthDelta:0}).logs[0].growthDelta,0);
});

test('RC14 reason growth: saved values upgrade to v2 and cannot hide in downgraded rules/history', () => {
  const state = configured({ growthDelta: 0 });
  assert.equal(state.version, 2);
  const oldFormat = clone(state); oldFormat.version = 1;
  assert.throws(() => Core.validateState(oldFormat), /新版存档/);
  const withLog = act(state, ruleAction(state, { custom: true }));
  delete withLog.settings.scoreRules; withLog.version = 1;
  assert.throws(() => Core.validateState(withLog), /新版存档/);
  const untouched = save(Core.createInitialState(), Rules.list());
  assert.equal(untouched.version, 2);
  assert.deepEqual(untouched.sharedScoreRules.rules, Rules.list());
});

test('RC14 reason growth: archived custom growth amounts remain strictly validated after loading', () => {
 const next=archived('custom');assert.equal(next.logs[0].growthDelta,7);
 for(const mutate of [l=>delete l.growthDelta,l=>l.growthDelta=6,l=>l.growthDelta=-1,l=>l.growthDelta='7',l=>l.changes[0].afterGrowth=3]){const broken=clone(next);mutate(broken.logs[0]);assert.throws(()=>Core.validateState(broken),/成长|前后数值/);}
 const legacy=Core.validateState(legacyState());legacy.logs[0].changes[0].afterGrowth++;assert.throws(()=>Core.validateState(legacy),/前后数值/);
});

test('RC14 reason growth: new rules preserve historical custom amounts and historic undo reverses the original effect', () => {
 let state=archived('custom');const originalLog=clone(state.logs[0]);state=configured({label:'合成新原因',delta:7,growthDelta:1},state);state=act(state,ruleAction(state));assert.deepEqual(state.logs[0],originalLog);
 state=act(state,{type:'undo',logId:originalLog.id});assert.equal(first(state).score,7);assert.equal(first(state).growth,0);assert.equal(state.logs[0].reason,originalLog.reason);assert.equal(state.logs.at(-1).growthDelta,0);
});

test('RC14 reason growth: rule-save concurrency includes explicit growth and detects omitted-versus-zero changes', () => {
  const original = Core.createInitialState(), expectedRules = rules(original);
  const state = configured({ growthDelta: 0 }, original);
  rejectsWithoutChange(state, { type: 'rules.save', rules: expectedRules, expectedRules }, /另一窗口/);
  const current = rules(state), changed = current.map((rule, index) => index ? rule : { ...rule, growthDelta: 4 });
  const newer = save(state, changed);
  rejectsWithoutChange(newer, { type: 'rules.save', rules: current, expectedRules: current }, /另一窗口/);
});

test('RC14 reason growth: stale selected rule identity rejects scores and retired growth paths', () => {
 for(const patch of [{label:'合成已改名'},{delta:2},{growthDelta:3},{growthDelta:0}]){const original=Core.createInitialState(),command=ruleAction(original),changed=configured(patch,original);rejectsWithoutChange(changed,command,/另一窗口/);rejectsWithoutChange(changed,{...command,type:'pet.growth'},/另一窗口|停用/);}
 const original=configured({growthDelta:0}),command=ruleAction(original),nextRules=rules(original);delete nextRules[0].growthDelta;rejectsWithoutChange(save(original,nextRules),command,/另一窗口/);rejectsWithoutChange(save(original,rules(original).slice(1)),command,/另一窗口/);
});

test('RC14 reason growth: score delta and reason must match the checked rule while free-form scoring works', () => {
 const state=configured({delta:3,growthDelta:2}),command=ruleAction(state);rejectsWithoutChange(state,{...command,delta:4},/所选规则/);rejectsWithoutChange(state,{...command,reason:'合成被替换原因'},/所选规则/);const custom={...command,delta:4,reason:'合成临时原因'};delete custom.expectedRule;assert.equal(first(act(state,custom)).score,4);rejectsWithoutChange(state,ruleAction(state,{type:'pet.growth'}),/停用/);
});

test('RC14 reason growth: archived negative-score growth attribution and zero rewards survive migration and undo', () => {
 let state=archived('migrated');assert.equal(cycle(state).netGrowth,7);assert.equal(state.logs[0].changes[0].petEffect.delta,7);assert.equal(state.logs[1].changes[0].petEffect,null);assert.deepEqual(Core.validateState(clone(state)),state);
 state=act(state,{type:'undo',logId:state.logs[0].id});assert.equal(cycle(state).netGrowth,0);assert.equal(first(state).score,4);assert.equal(first(state).growth,0);
});

test('RC14 reason growth: archived linked scores reject missing or mismatched cycle attribution', () => {
 const next=archived('linked');assert.equal(cycle(next).netGrowth,6);assert.equal(next.logs[0].changes[0].petEffect.delta,6);
 for(const petEffect of [null,{...next.logs[0].changes[0].petEffect,delta:3}]){const broken=clone(next);broken.logs[0].changes[0].petEffect=petEffect;assert.throws(()=>Core.validateState(broken),/归属/);}
 const state=configured({delta:5,growthDelta:0},next),scored=act(state,ruleAction(state));assert.deepEqual(scored.petAccounts,state.petAccounts);assert.equal(scored.logs.at(-1).growthDelta,0);
});

test('RC14 reason growth replacement: score batch overflow rejects without partial score or history changes', () => {
 const state=configured({delta:3,growthDelta:100});state.students[1].score=1_000_000_000;state.students[1].growth=1_000_000_000;
 rejectsWithoutChange(state,{...ruleAction(state),ids:state.students.slice(0,2).map(s=>s.id)},/积分/);assert.equal(first(state).score,0);assert.equal(first(state).growth,0);assert.equal(state.logs.length,0);
});

test('RC14 reason growth: archived old-cycle custom score undo preserves the later adoption and graduation', () => {
 let state=archived('oldCycle');const before=clone(account(state).graduations[0]),active=cycle(state).id,old=state.logs[0].changes[0].petEffect.cycleId;state=act(state,{type:'undo',logId:state.logs[0].id});assert.equal(cycle(state).id,active);assert.equal(cycle(state).netGrowth,5);assert.equal(account(state).cycles.find(c=>c.id===old).netGrowth,0);assert.equal(first(state).growth,0);assert.deepEqual(account(state).graduations[0],before);assert.equal(Progress.profile(state,first(state)).medalTotal,1);
});

test('RC14 reason growth: archived unassigned growth undo cannot touch a later pet cycle', () => {
 let state=archived('unassigned');const log=state.logs[0],active=cycle(state).id;assert.equal(log.changes[0].petEffect.cycleId,null);assert.equal(account(state).unassignedGrowth,5);state=act(state,{type:'undo',logId:log.id});assert.equal(account(state).unassignedGrowth,0);assert.equal(cycle(state).id,active);assert.equal(cycle(state).netGrowth,0);assert.equal(first(state).growth,0);
});

test('RC14 reason growth replacement: signed staged histories survive but new growth and growth undo reject', () => {
 const state=archived('staged');assert.equal(cycle(state).netGrowth,1);assert.deepEqual(state.petLogs.map(l=>l.delta),[4,-3]);assert.deepEqual(Core.validateState(clone(state)),state);
 for(const delta of [-3,4])rejectsWithoutChange(state,{type:'pet.growth',ids:[first(state).id],delta},/停用/);
 for(const log of state.petLogs)rejectsWithoutChange(state,{type:'pet.undo',logId:log.id},/停用/);
});

test('RC14 reason growth replacement: archived clamp snapshots stay exact and cannot be modified', () => {
 const state=archived('clamp'),log=state.petLogs.at(-1);assert.equal(log.delta,-5);assert.equal(log.changes[0].actualDelta,-2);assert.equal(log.floorPolicy,'clamp');assert.equal(cycle(state).netGrowth,0);assert.deepEqual(Core.validateState(clone(state)),state);
 rejectsWithoutChange(state,{type:'pet.undo',logId:log.id},/停用/);for(const mutate of [l=>l.changes[0].actualDelta=-5,l=>l.changes[0].afterGrowth=1]){const bad=clone(state);mutate(bad.petLogs.at(-1));assert.throws(()=>Core.validateState(bad));}
});

test('RC14 reason growth replacement: new students ignore old growth metadata in all historical panel modes', () => {
 let state=archived('linked');state=act(state,{type:'student.add',name:'纯合成独立学生'});const id=state.students.at(-1).id;state=configured({delta:2,growthDelta:-5},state);state=act(state,ruleAction(state,{id}));assert.equal(cycle(state,id).netGrowth,0);assert.equal(state.students.at(-1).score,2);assert.equal(state.students.at(-1).growth,0);assert.equal(state.logs.at(-1).growthDelta,0);
});

test('RC14 reason growth replacement: retired zero growth and stale score cycle or panel reject atomically', () => {
 const state=archived('linked');rejectsWithoutChange(state,{type:'pet.growth',ids:[first(state).id],delta:0},/停用/);
 rejectsWithoutChange(state,{...ruleAction(state),expectedCycles:[{id:first(state).id,cycleId:'pc_old_synthetic'}]},/另一窗口/);rejectsWithoutChange(state,{...ruleAction(state),panelId:'panel_old_synthetic'},/面板已切换/);
});

test('RC18 reason growth: full copies share rule metadata while preserving independent historic amounts', () => {
 let state=archived('full');const oldId=Core.panelId(state),oldRules=clone(rules(state)),oldLog=clone(state.logs[0]);state=act(state,{type:'panel.create',mode:'full',name:'合成完整副本'});assert.equal(rules(state)[0].growthDelta,6);assert.equal(rules(state)[0].id,oldRules[0].id);assert.equal(state.logs[0].growthDelta,6);state=configured({growthDelta:2},state);state=Core.validateState(clone(state));state=act(state,{type:'panel.switch',id:oldId});assert.deepEqual(rules(state),oldRules.map((r,i)=>i?r:{...r,growthDelta:2}));assert.deepEqual(state.logs[0],oldLog);assert.equal(state.logs[0].growthDelta,6);
});

test('RC14 reason growth replacement: response-loss score receipt replays once and rejects altered growth payload', () => {
 let state=configured({growthDelta:3});const receipts=createActionReceipts({getState:()=>state}),owner={},command={...ruleAction(state),_transportId:'synthetic_rc14_reason_receipt'},run=a=>(state=act(state,a));
 assert.throws(()=>receipts.execute(owner,command,a=>{run(a);throw Error('synthetic response lost');}),/response lost/);assert.equal(receipts.inspect(owner,command._transportId).committed,true);state=configured({growthDelta:9},state);receipts.execute(owner,command,run);assert.equal(first(state).score,1);assert.equal(first(state).growth,0);assert.equal(state.logs.length,1);assert.equal(state.logs[0].growthDelta,0);assert.throws(()=>receipts.execute(owner,{...command,growthDelta:9},run),/回执与内容不一致/);
});
