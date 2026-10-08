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
const enable = state => act(state, { type: 'pet.stage-rules', thresholds: [5, 5, 5, 5, 5, 5] });
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

test('RC14 reason growth: old v1 saves, old history and ordinary custom score calls remain unchanged', () => {
  const old = Core.validateState(legacyState());
  assert.deepEqual(Core.validateState(clone(old)), old);
  assert.equal(old.version, 1);
  assert.ok(old.logs.every(log => !Object.hasOwn(log, 'growthDelta')));
  assert.ok(rules(old).every(rule => !Object.hasOwn(rule, 'growthDelta')));
});

test('RC14 reason growth: ordinary custom score calls retain positive growth and zero deduction growth', () => {
  let state = Core.createInitialState();
  const id = first(state).id;
  state = act(state, { type: 'score', ids: [id], delta: 6, reason: '合成临时加分' });
  state = act(state, { type: 'score', ids: [id], delta: -3, reason: '合成临时扣分' });
  assert.equal(state.version, 1);
  assert.equal(first(state).score, 3);
  assert.equal(first(state).growth, 6);
  assert.ok(state.logs.every(log => !Object.hasOwn(log, 'growthDelta')));
});

test('RC14 reason growth: explicit positive/zero customization preserves score and snaps growth into history', () => {
  for (const growthDelta of [0, 1, 7, 100]) {
    const state = configured({ delta: 3, growthDelta });
    const next = act(state, ruleAction(state, { custom: true }));
    assert.equal(next.version, 2);
    assert.equal(first(next).score, 3);
    assert.equal(first(next).growth, growthDelta);
    assert.equal(next.logs[0].growthDelta, growthDelta);
    assert.equal(next.logs[0].changes[0].afterGrowth - next.logs[0].changes[0].beforeGrowth, growthDelta);
    assert.deepEqual(Core.validateState(clone(next)), next);
    assert.deepEqual(first(act(next, { type: 'undo', logId: next.logs[0].id })), first(state));
  }
});

test('RC14 reason growth: deduction may explicitly award growth and zero-growth reward leaves its egg intact', () => {
  let state = configured({ delta: -3, growthDelta: 4 });
  state = act(state, ruleAction(state, { custom: true }));
  assert.equal(first(state).score, -3);
  assert.equal(first(state).growth, 4);
  assert.equal(Progress.profile(state, first(state)).isEgg, false);
  state = act(state, { type: 'undo', logId: state.logs[0].id });
  assert.equal(Progress.profile(state, first(state)).isEgg, true);
  state = configured({ delta: 4, growthDelta: 0 }, state);
  state = act(state, ruleAction(state, { custom: true }));
  assert.equal(first(state).score, 4);
  assert.equal(Progress.profile(state, first(state)).isEgg, true);
});

test('RC14 reason growth: detached customization and invalid legacy signed values cannot mutate state', () => {
  const state = configured({ growthDelta: 4 });
  const command = ruleAction(state, { custom: true });
  for (const growthDelta of [-1, 0, 5, 101, '4', null, undefined]) {
    rejectsWithoutChange(state, { ...command, growthDelta }, /成长值/);
  }
  const detached = { ...command }; delete detached.expectedRule;
  rejectsWithoutChange(state, detached, /成长值/);
  const negative = configured({ growthDelta: -2 });
  rejectsWithoutChange(negative, ruleAction(negative, { custom: true }), /负成长仅支持独立宠物成长/);
  rejectsWithoutChange(negative, ruleAction(negative), /负成长仅支持独立宠物成长/);
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
  assert.equal(untouched.version, 1);
});

test('RC14 reason growth: removing the new history field cannot weaken old log validation', () => {
  const state = configured({ delta: 3, growthDelta: 7 });
  const next = act(state, ruleAction(state, { custom: true }));
  for (const mutate of [
    log => delete log.growthDelta,
    log => { log.growthDelta = 6; },
    log => { log.growthDelta = -1; },
    log => { log.growthDelta = '7'; },
    log => { log.changes[0].afterGrowth = 3; }
  ]) {
    const broken = clone(next); mutate(broken.logs[0]);
    assert.throws(() => Core.validateState(broken), /成长|前后数值/);
  }
  const legacy = Core.validateState(legacyState());
  legacy.logs[0].changes[0].afterGrowth++;
  assert.throws(() => Core.validateState(legacy), /前后数值/);
});

test('RC14 reason growth: new rules never recalculate saved historical values or undo amounts', () => {
  let state = configured({ label: '合成旧原因', delta: 2, growthDelta: 5 });
  state = act(state, ruleAction(state, { custom: true }));
  const originalLog = clone(state.logs[0]);
  state = configured({ label: '合成新原因', delta: 7, growthDelta: 1 }, state);
  state = act(state, ruleAction(state, { custom: true }));
  assert.deepEqual(state.logs[0], originalLog);
  state = act(state, { type: 'undo', logId: originalLog.id });
  assert.equal(first(state).score, 7);
  assert.equal(first(state).growth, 1);
  assert.equal(state.logs[0].reason, '合成旧原因');
});

test('RC14 reason growth: rule-save concurrency includes explicit growth and detects omitted-versus-zero changes', () => {
  const original = Core.createInitialState(), expectedRules = rules(original);
  const state = configured({ growthDelta: 0 }, original);
  rejectsWithoutChange(state, { type: 'rules.save', rules: expectedRules, expectedRules }, /另一窗口/);
  const current = rules(state), changed = current.map((rule, index) => index ? rule : { ...rule, growthDelta: 4 });
  const newer = save(state, changed);
  rejectsWithoutChange(newer, { type: 'rules.save', rules: current, expectedRules: current }, /另一窗口/);
});

test('RC14 reason growth: stale selected rule identity is rejected on both award paths', () => {
  for (const type of ['score', 'pet.growth']) for (const patch of [{ label: '合成已改名' }, { delta: 2 }, { growthDelta: 3 }, { growthDelta: 0 }]) {
    const original = enable(Core.createInitialState());
    const command = ruleAction(original, { type });
    const changed = configured(patch, original);
    rejectsWithoutChange(changed, command, /另一窗口/);
  }
  const original = configured({ growthDelta: 0 }, enable(Core.createInitialState()));
  const command = ruleAction(original);
  const nextRules = rules(original); delete nextRules[0].growthDelta;
  rejectsWithoutChange(save(original, nextRules), command, /另一窗口/);
  const removed = save(original, rules(original).slice(1));
  rejectsWithoutChange(removed, command, /另一窗口/);
});

test('RC14 reason growth: award delta/reason must match its checked rule while free-form actions still work', () => {
  for (const type of ['score', 'pet.growth']) {
    const state = configured({ delta: 3, growthDelta: 2 }, enable(Core.createInitialState()));
    const command = ruleAction(state, { type });
    rejectsWithoutChange(state, { ...command, delta: 4 }, /所选规则/);
    rejectsWithoutChange(state, { ...command, reason: '合成被替换原因' }, /所选规则/);
    const custom = { ...command, delta: 4, reason: '合成临时原因' }; delete custom.expectedRule;
    assert.doesNotThrow(() => act(state, custom));
  }
});

test('RC14 reason growth: migration links explicit historical growth including negative scores and zero rewards', () => {
  let state = configured({ delta: -2, growthDelta: 7 });
  state = act(state, ruleAction(state, { custom: true }));
  state = configured({ delta: 4, growthDelta: 0 }, state);
  state = act(state, ruleAction(state, { custom: true }));
  state = enable(state);
  assert.equal(cycle(state).netGrowth, 7);
  assert.equal(state.logs[0].changes[0].petEffect.delta, 7);
  assert.equal(state.logs[1].changes[0].petEffect, null);
  assert.deepEqual(Core.validateState(clone(state)), state);
  state = act(state, { type: 'undo', logId: state.logs[0].id });
  assert.equal(cycle(state).netGrowth, 0);
  assert.equal(first(state).score, 4);
  assert.equal(first(state).growth, 0);
});

test('RC14 reason growth: linked scores validate custom growth effect and reject missing/mismatched attribution', () => {
  const state = configured({ delta: -3, growthDelta: 6 }, enable(Core.createInitialState()));
  const next = act(state, ruleAction(state, { custom: true }));
  assert.equal(cycle(next).netGrowth, 6);
  assert.equal(next.logs[0].changes[0].petEffect.delta, 6);
  for (const petEffect of [null, { ...next.logs[0].changes[0].petEffect, delta: 3 }]) {
    const broken = clone(next); broken.logs[0].changes[0].petEffect = petEffect;
    assert.throws(() => Core.validateState(broken), /归属/);
  }
  const zero = configured({ delta: 5, growthDelta: 0 }, next);
  const unchanged = act(zero, ruleAction(zero, { custom: true }));
  assert.equal(cycle(unchanged).netGrowth, 6);
  assert.equal(unchanged.logs.at(-1).changes[0].petEffect, null);
});

test('RC14 reason growth: a custom score batch rejects overflow without any partial score, growth or history', () => {
  const state = configured({ growthDelta: 100 });
  state.students[1].growth = 1_000_000_000;
  const command = { ...ruleAction(state, { custom: true }), ids: state.students.slice(0, 2).map(student => student.id) };
  rejectsWithoutChange(state, command, /成长值/);
  assert.equal(first(state).score, 0);
  assert.equal(first(state).growth, 0);
  assert.equal(state.logs.length, 0);
});

test('RC14 reason growth: old-cycle custom score undo preserves a new adoption and graduation snapshot', () => {
  let state = configured({ delta: 2, growthDelta: 30 }, enable(Core.createInitialState()));
  state = act(state, ruleAction(state, { custom: true }));
  const logId = state.logs[0].id, oldCycle = cycle(state).id;
  state = act(state, { type: 'pet.graduate', id: first(state).id });
  const graduation = clone(account(state).graduations[0]);
  state = act(state, { type: 'pet.adopt', id: first(state).id, pet: 'cat' });
  state = act(state, { type: 'pet.growth', ids: [first(state).id], delta: 5 });
  state = act(state, { type: 'undo', logId });
  assert.equal(cycle(state).netGrowth, 5);
  assert.equal(account(state).cycles.find(item => item.id === oldCycle).netGrowth, 0);
  assert.equal(first(state).growth, 0);
  assert.deepEqual(account(state).graduations[0], graduation);
  assert.equal(Progress.profile(state, first(state)).medalTotal, 1);
});

test('RC14 reason growth: custom growth after graduation stays unassigned and undo never touches the next pet', () => {
  let state = configured({ delta: -1, growthDelta: 5 }, enable(Core.createInitialState()));
  state = act(state, { type: 'pet.growth', ids: [first(state).id], delta: 30 });
  state = act(state, { type: 'pet.graduate', id: first(state).id });
  state = act(state, ruleAction(state, { custom: true }));
  const log = state.logs[0];
  assert.equal(log.changes[0].petEffect.cycleId, null);
  assert.equal(account(state).unassignedGrowth, 5);
  state = act(state, { type: 'pet.adopt', id: first(state).id, pet: 'cat' });
  assert.equal(cycle(state).netGrowth, 0);
  state = act(state, { type: 'undo', logId: log.id });
  assert.equal(account(state).unassignedGrowth, 0);
  assert.equal(cycle(state).netGrowth, 0);
  assert.equal(first(state).growth, 0);
});

test('RC14 reason growth: staged rule rewards change only pet growth and support signed changes', () => {
  let state = configured({ delta: 9, growthDelta: 4 }, enable(Core.createInitialState()));
  const students = clone(state.students);
  state = act(state, ruleAction(state, { type: 'pet.growth' }));
  const firstLog = state.petLogs[0].id;
  assert.equal(cycle(state).netGrowth, 4);
  assert.deepEqual(state.students, students);
  assert.equal(state.logs.length, 0);
  state = configured({ delta: 7, growthDelta: -3 }, state);
  state = act(state, ruleAction(state, { type: 'pet.growth' }));
  assert.equal(cycle(state).netGrowth, 1);
  rejectsWithoutChange(state, ruleAction(state, { type: 'pet.growth' }), /低于 0/);
  state = act(state, { type: 'pet.undo', logId: state.petLogs.at(-1).id });
  state = act(state, { type: 'pet.undo', logId: firstLog });
  assert.equal(cycle(state).netGrowth, 0);
  assert.equal(Progress.profile(state, first(state)).isEgg, true);
  assert.deepEqual(state.students, students);
});

test('RC14 reason growth: staged negative custom rule preserves explicit clamp snapshots and exact undo', () => {
  let state = configured({ delta: -1, growthDelta: -5 }, enable(Core.createInitialState()));
  state = act(state, { type: 'pet.growth-policy', growthFloor: 'clamp', expectedRevision: state.revision });
  state = act(state, { type: 'pet.growth', ids: [first(state).id], delta: 2 });
  state = act(state, ruleAction(state, { type: 'pet.growth' }));
  const log = state.petLogs.at(-1);
  assert.equal(log.delta, -5);
  assert.equal(log.changes[0].actualDelta, -2);
  assert.equal(log.floorPolicy, 'clamp');
  assert.equal(cycle(state).netGrowth, 0);
  state = Core.validateState(clone(state));
  state = act(state, { type: 'pet.undo', logId: log.id });
  assert.equal(cycle(state).netGrowth, 2);
});

test('RC14 reason growth: ordinary rule points ignore customized growth on independent pets', () => {
  let state = enable(Core.createInitialState());
  state = act(state, { type: 'student.add', name: '纯合成独立学生' });
  const id = state.students.at(-1).id;
  state = configured({ delta: 2, growthDelta: -5 }, state);
  state = act(state, ruleAction(state, { id }));
  assert.equal(cycle(state, id).netGrowth, 0);
  assert.equal(state.students.at(-1).score, 2);
  assert.equal(state.students.at(-1).growth, 2);
  assert.equal(state.logs.at(-1).changes[0].petEffect, null);
  assert.equal(Object.hasOwn(state.logs.at(-1), 'growthDelta'), false);
});

test('RC14 reason growth: zero staged rule is non-award and stale cycle/panel rejects before mutation', () => {
  const zero = configured({ growthDelta: 0 }, enable(Core.createInitialState()));
  rejectsWithoutChange(zero, ruleAction(zero, { type: 'pet.growth' }), /不能为零/);
  const state = configured({ growthDelta: 4 }, zero);
  rejectsWithoutChange(state, { ...ruleAction(state, { type: 'pet.growth' }), expectedCycles: [{ id: first(state).id, cycleId: 'pc_old_synthetic' }] }, /另一窗口/);
  rejectsWithoutChange(state, { ...ruleAction(state), panelId: 'panel_old_synthetic' }, /面板已切换/);
});

test('RC14 reason growth: full panel copy and backup preserve independent custom rules and historical amounts', () => {
  let state = configured({ label: '合成第一面板原因', growthDelta: 6 }, enable(Core.createInitialState()));
  state = act(state, ruleAction(state, { custom: true }));
  const oldId = Core.panelId(state), oldRules = clone(rules(state)), oldLog = clone(state.logs[0]);
  state = act(state, { type: 'panel.create', mode: 'full', name: '合成完整副本' });
  assert.equal(rules(state)[0].growthDelta, 6);
  assert.notEqual(rules(state)[0].id, oldRules[0].id);
  assert.equal(state.logs[0].growthDelta, 6);
  state = configured({ growthDelta: 2 }, state);
  state = Core.validateState(clone(state));
  state = act(state, { type: 'panel.switch', id: oldId });
  assert.deepEqual(rules(state), oldRules);
  assert.deepEqual(state.logs[0], oldLog);
});

test('RC14 reason growth: response-loss receipt replays once after rule edits and fingerprints growth snapshots', () => {
  let state = configured({ growthDelta: 3 });
  const receipts = createActionReceipts({ getState: () => state }), owner = {};
  const command = { ...ruleAction(state, { custom: true }), _transportId: 'synthetic_rc14_reason_receipt' };
  const run = action => (state = act(state, action));
  assert.throws(() => receipts.execute(owner, command, action => { run(action); throw Error('synthetic response lost'); }), /response lost/);
  assert.equal(receipts.inspect(owner, command._transportId).committed, true);
  state = configured({ growthDelta: 9 }, state);
  receipts.execute(owner, command, run);
  assert.equal(first(state).growth, 3);
  assert.equal(state.logs.length, 1);
  assert.throws(() => receipts.execute(owner, { ...command, growthDelta: 9 }, run), /回执与内容不一致/);
});
