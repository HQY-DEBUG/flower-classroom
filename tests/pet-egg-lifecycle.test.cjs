'use strict';
const {mirroredLegacyPanel} = require('./shared-rule-fixtures.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../src/core.cjs');
const Progress = require('../src/pet-progress.js');
const Art = require('../src/pet-art.js');
const { legacyState } = require('./pet-fixtures.cjs');

const clone = value => JSON.parse(JSON.stringify(value));
const act = (state, action) => Core.applyAction(state, action, 9_000_000);
const firstId = state => state.students[0].id;
const profile = (state, id = firstId(state)) => Progress.profile(state, id);
const account = (state, id = firstId(state)) => state.petAccounts.find(value => value.studentId === id);
const cycle = (state, id = firstId(state)) => account(state, id).cycles.find(value => value.id === account(state, id).activeCycleId);
const enable = (state = Core.createInitialState(), thresholds = [5, 5, 5, 5, 5, 5]) => act(state, { type: 'pet.stage-rules', thresholds });
const grow = (state, delta, ids = [firstId(state)]) => act(state, { type: 'pet.growth', ids, delta, reason: '纯合成蛋生命周期' });
const score = (state, delta, ids = [firstId(state)]) => act(state, { type: 'score', ids, delta, reason: '纯合成课堂积分' });
const batch = (state, operation, ids, options = {}) => act(state, { type: 'pet.batch', operation, ids,
  requestId: `egg_batch_${state.revision}`, expectedRevision: state.revision, ...options });
const switchPet = (state, pet, id = firstId(state)) => act(state, { type: 'pet.switch', id, pet,
  panelId: Core.panelId(state), expectedPet: profile(state, id).pet, expectedCycleId: profile(state, id).activeCycleId });
const resetGrowth = state => act(state, { type: 'points.clear', confirmed: true, expectedRevision: state.revision,
  options: { scores: false, groupScores: false, petGrowth: true, history: false, petHistory: false } });

// Synthetic RC10-format archive, specified independently of current creation
// and migration code so absent markers cannot be accidentally regenerated.
function rc10Archive() {
  return {
    version: 2, revision: 17,
    settings: { className: '纯合成RC10兼容班', petStep: 5, petFocusId: '', petRules: { thresholds: [5, 5, 5, 5, 5, 5] } },
    students: [{ id: 's_rc10', name: '虚构旧版同学', group: '合成组', score: 0, growth: 0, pet: 'cat', photo: '', adopted: true }],
    logs: [], draw: { mode: 'cycle', bag: [], lastIds: [], round: 0 },
    timer: { durationMs: 300000, remainingMs: 300000, endsAt: null, running: false },
    petAccounts: [{ id: 'pa_rc10', studentId: 's_rc10', mode: 'independent', activeCycleId: 'pc_rc10', legacyMedals: 0,
      unassignedGrowth: 0, lifetimeNetGrowth: 0,
      cycles: [{ id: 'pc_rc10', pet: 'cat', status: 'active', netGrowth: 0, openedAt: 1000000, origin: 'explicit-adoption' }],
      graduations: [], badgeEvents: [] }], petLogs: []
  };
}

test('RC11 eggs: new examples and all 40 species share zero-growth egg state without changing seven-stage math', () => {
  const examples = Core.createInitialState();
  assert.ok(examples.students.every(student => student.startFromEgg === true && profile(examples, student.id).isEgg));
  const pets = Object.keys(Art.names);
  assert.equal(pets.length, 40);
  let state = Core.importRows(pets.map((pet, index) => ({ name: `纯合成宠物${index}`, group: '合成组' })), examples, 'replace');
  assert.deepEqual(state.students.map(student => student.pet), pets);
  state = enable(state);
  assert.ok(state.petAccounts.every(value => value.cycles[0].startFromEgg === true));
  for (const student of state.students) {
    const p = profile(state, student.id);
    assert.equal(p.isEgg, true); assert.equal(p.adopted, true); assert.equal(p.level, 1); assert.equal(p.shape, 1); assert.equal(p.growth, 0);
  }
  const ids = state.students.map(student => student.id);
  state = grow(state, 1, ids);
  assert.ok(ids.every(id => !profile(state, id).isEgg && profile(state, id).level === 1 && profile(state, id).growth === 1));
  state = grow(state, 4, ids);
  assert.ok(ids.every(id => !profile(state, id).isEgg && profile(state, id).level === 2 && profile(state, id).growth === 5));
  for (let level = 3; level <= 7; level++) {
    state = grow(state, 5, ids);
    assert.ok(ids.every(id => profile(state, id).level === level && profile(state, id).shape === level));
  }
  assert.ok(ids.every(id => profile(state, id).maxed && profile(state, id).medalTotal === 0));
});

test('RC11 eggs: legacy v1 zero/nonzero forms, photos, history and migration remain unchanged', () => {
  const original = Core.validateState(legacyState());
  assert.deepEqual(Core.validateState(clone(original)), original);
  for (const student of original.students) {
    assert.equal(Object.hasOwn(student, 'startFromEgg'), false);
    assert.equal(profile(original, student.id).isEgg, false);
  }
  const migrated = enable(original);
  assert.deepEqual(migrated.students, original.students);
  assert.ok(migrated.petAccounts.every(value => !Object.hasOwn(value.cycles[0], 'startFromEgg')));
  for (const student of original.students) {
    assert.equal(profile(migrated, student.id).growth, student.growth);
    assert.equal(profile(migrated, student.id).isEgg, false);
  }
  assert.deepEqual(Core.validateState(clone(migrated)), migrated);
  const oldZeroId = 's_legacy_cat';
  let changed = grow(migrated, 1, [oldZeroId]);
  changed = act(changed, { type: 'pet.undo', logId: changed.petLogs.at(-1).id });
  assert.equal(profile(changed, oldZeroId).isEgg, false);
});

test('RC11 eggs: an unmarked RC10 explicit-adoption cycle stays a baby at zero across import, switch, pause and resume', () => {
  const archived = rc10Archive();
  let state = Core.validateState(clone(archived));
  assert.deepEqual(state, archived);
  assert.equal(profile(state).isEgg, false);
  state = switchPet(state, 'dragon');
  const originalCycle = cycle(state).id;
  state = act(state, { type: 'student.update', id: firstId(state), adopted: false });
  assert.equal(profile(state).isEgg, true);
  state = act(state, { type: 'pet.adopt', id: firstId(state), pet: 'seal' });
  assert.equal(cycle(state).id, originalCycle); assert.equal(profile(state).isEgg, false);
  assert.equal(Object.hasOwn(cycle(state), 'startFromEgg'), false);
  assert.deepEqual(Core.validateState(clone(state)), state);
  state = grow(state, 9);
  state = act(state, { type: 'student.update', id: firstId(state), adopted: false });
  state = act(state, { type: 'pet.adopt', id: firstId(state), pet: 'fox' });
  assert.equal(profile(state).growth, 9); assert.equal(profile(state).level, 2); assert.equal(profile(state).isEgg, false);
});

test('RC11 eggs: pre-ledger score/undo and nonzero enabling preserve original score semantics', () => {
  let state = Core.createInitialState();
  state = score(state, -2); assert.equal(profile(state).isEgg, true);
  state = score(state, 1); const positive = state.logs.at(-1).id;
  assert.equal(profile(state).isEgg, false); assert.equal(profile(state).level, 1);
  state = score(state, -3); assert.equal(profile(state).growth, 1); assert.equal(profile(state).isEgg, false);
  state = act(state, { type: 'undo', logId: positive }); assert.equal(profile(state).isEgg, true);
  state = score(state, 25);
  const before = clone(state.students);
  state = enable(state);
  assert.deepEqual(state.students, before); assert.equal(profile(state).growth, 25); assert.equal(profile(state).level, 6); assert.equal(profile(state).isEgg, false);
  assert.equal(cycle(state).startFromEgg, true);
});

test('RC11 eggs: new additions, append/replace imports, blank panels and fresh roster copies are marked; complete copies retain legacy forms', () => {
  for (const base of [Core.validateState(legacyState()), enable(legacyState())]) {
    let state = act(base, { type: 'student.add', name: '纯合成新增', pet: 'dragon', adopted: false });
    const newcomer = state.students.at(-1);
    assert.equal(newcomer.startFromEgg, true); assert.equal(profile(state, newcomer.id).isEgg, true);
    assert.deepEqual(state.students.slice(0, -1), base.students);
    state = Core.importRows([{ name: '纯合成导入' }], state, 'append');
    assert.equal(state.students.at(-1).startFromEgg, true); assert.equal(profile(state, state.students.at(-1).id).isEgg, true);
    state = Core.importRows([{ name: '纯合成替换' }], state, 'replace');
    assert.equal(profile(state).isEgg, true);
    if (state.settings.petRules) assert.equal(cycle(state).startFromEgg, true);
    const copied = act(base, { type: 'panel.create', mode: 'copy', name: '纯合成名单副本' });
    assert.ok(copied.students.every(student => profile(copied, student.id).isEgg));
    assert.deepEqual(copied.panels.others[0].data, mirroredLegacyPanel(base));
    assert.deepEqual(copied.sharedScoreRules.rules, copied.panels.others[0].data.settings.scoreRules);
    const complete = act(base, { type: 'panel.create', mode: 'full', name: '纯合成完整副本' });
    assert.ok(complete.students.every(student => !profile(complete, student.id).isEgg));
    let blank = act(base, { type: 'panel.create', mode: 'blank', name: '纯合成空白' });
    blank = act(blank, { type: 'student.add', name: '纯合成空白新增' });
    assert.equal(profile(blank).isEgg, true); assert.equal(cycle(blank).startFromEgg, true);
  }
});

test('RC11 eggs: deduction, clamping, undo and reversible reset return marked cycles to an egg at zero', () => {
  let state = grow(enable(), 5); const award = state.petLogs.at(-1).id;
  state = grow(state, -5); const penalty = state.petLogs.at(-1).id;
  assert.equal(profile(state).isEgg, true);
  state = act(state, { type: 'pet.undo', logId: penalty }); assert.equal(profile(state).growth, 5); assert.equal(profile(state).isEgg, false);
  state = act(state, { type: 'pet.undo', logId: award }); assert.equal(profile(state).isEgg, true);
  state = act(state, { type: 'pet.growth-policy', growthFloor: 'clamp' });
  state = grow(state, -100); assert.equal(profile(state).isEgg, true); assert.equal(state.petLogs.at(-1).changes[0].actualDelta, 0);
  state = grow(state, 3);
  state = resetGrowth(state);
  assert.equal(profile(state).isEgg, true); const reset = state.petLogs.at(-1);
  assert.equal(reset.kind, 'reset'); assert.equal(reset.changes[0].actualDelta, -3);
  state = act(state, { type: 'pet.undo', logId: reset.id }); assert.equal(profile(state).growth, 3); assert.equal(profile(state).isEgg, false);
  const legacy = grow(Core.validateState(rc10Archive()), 5);
  const resetLegacy = resetGrowth(legacy);
  assert.equal(profile(resetLegacy).growth, 0); assert.equal(profile(resetLegacy).isEgg, false);
});

test('RC11 eggs: graduation/readoption and old-cycle undo never hatch or reset a newer cycle, or alter honors', () => {
  let state = grow(Core.validateState(rc10Archive()), 30); const oldLog = state.petLogs.at(-1).id;
  const oldCycle = cycle(state).id;
  state = act(state, { type: 'pet.graduate', id: firstId(state) });
  assert.equal(profile(state).isEgg, true); assert.equal(profile(state).adopted, false); assert.equal(profile(state).medalTotal, 1);
  const snapshot = clone(account(state).graduations);
  state = act(state, { type: 'pet.adopt', id: firstId(state), pet: 'cat' });
  assert.notEqual(cycle(state).id, oldCycle); assert.equal(cycle(state).startFromEgg, true);
  assert.equal(profile(state).isEgg, true); assert.equal(profile(state).adopted, true);
  state = grow(state, 1);
  state = act(state, { type: 'pet.undo', logId: oldLog });
  assert.equal(account(state).cycles.find(value => value.id === oldCycle).netGrowth, 0);
  assert.equal(profile(state).growth, 1); assert.equal(profile(state).isEgg, false); assert.equal(profile(state).medalTotal, 1);
  assert.deepEqual(account(state).graduations, snapshot);
  state = grow(state, 29);
  state = act(state, { type: 'pet.graduate', id: firstId(state) });
  state = act(state, { type: 'pet.adopt', id: firstId(state), pet: 'cat' });
  const newestCycle = cycle(state).id;
  state = act(state, { type: 'pet.undo', logId: state.petLogs.find(value => value.delta === 1).id });
  assert.equal(cycle(state).id, newestCycle); assert.equal(profile(state).growth, 0); assert.equal(profile(state).isEgg, true);
  assert.equal(account(state).cycles.length, 3); assert.equal(profile(state).medalTotal, 2);
  assert.deepEqual(Core.validateState(clone(state)), state);
});

test('RC11 eggs: single/batch switches and pause/resume retain marker, current growth and cycle identity', () => {
  let state = enable(); const id = firstId(state), originalCycle = cycle(state).id;
  for (const pet of Object.keys(Art.names)) {
    state = switchPet(state, pet);
    assert.equal(profile(state).isEgg, true); assert.equal(cycle(state).id, originalCycle); assert.equal(cycle(state).startFromEgg, true);
  }
  state = grow(state, 7);
  const before = clone(state), ids = state.students.slice(0, 2).map(student => student.id);
  state = batch(state, 'switch', ids, { pet: 'cat' });
  assert.equal(profile(state).growth, 7); assert.equal(profile(state).isEgg, false); assert.equal(profile(state, ids[1]).isEgg, true);
  assert.equal(cycle(state).id, originalCycle); assert.deepEqual(state.petLogs, before.petLogs); assert.deepEqual(state.logs, before.logs);
  state = act(state, { type: 'student.update', id, adopted: false });
  state = act(state, { type: 'pet.adopt', id, pet: 'dragon' });
  assert.equal(profile(state).growth, 7); assert.equal(profile(state).isEgg, false); assert.equal(cycle(state).id, originalCycle);
});

test('RC11 eggs: preview, rank and honor data expose egg state without changing eligibility or level ranking', () => {
  let state = enable(); const ids = state.students.slice(0, 2).map(student => student.id);
  let preview = Progress.batchPreview(state, { operation: 'growth', ids, delta: 1 });
  assert.ok(preview.rows.every(row => row.eligible && row.isEgg && !row.afterIsEgg && row.level === 1 && row.afterLevel === 1));
  state = batch(state, 'growth', ids, { delta: 1 });
  preview = Progress.batchPreview(state, { operation: 'growth', ids, delta: -1 });
  assert.ok(preview.rows.every(row => row.eligible && !row.isEgg && row.afterIsEgg));
  state = batch(state, 'growth', ids, { delta: -1 });
  assert.ok(Progress.studentRankings(state, { sortBy: 'level' }).every(row => row.rank === 1 && row.level === 1 && row.isEgg));
  assert.ok(Progress.groupRankings(state).every(row => row.medalTotal === 0 && row.averageMedals === 0));
  const card = Progress.honorCard(state, ids[0]); assert.equal(card.isEgg, true); assert.equal(card.level, 1); assert.equal(card.adopted, true);
  assert.equal(card.totalHonors, 0); assert.equal(card.graduationCount, 0);
  state = grow(state, 30, ids);
  preview = Progress.batchPreview(state, { operation: 'graduate', ids });
  assert.ok(preview.rows.every(row => row.eligible && !row.isEgg && row.afterIsEgg));
  state = batch(state, 'graduate', ids);
  preview = Progress.batchPreview(state, { operation: 'adopt', ids, pet: 'dragon' });
  assert.ok(preview.rows.every(row => row.eligible && row.isEgg && row.afterIsEgg));
  state = batch(state, 'adopt', ids, { pet: 'dragon' });
  assert.ok(ids.every(id => profile(state, id).isEgg && profile(state, id).medalTotal === 1));
});

test('RC11 eggs: optional true/false markers round-trip while non-booleans fail atomically in students and cycles', () => {
  for (const value of [true, false]) {
    const raw = Core.validateState(legacyState()); raw.students[3].startFromEgg = value;
    const state = Core.validateState(clone(raw));
    assert.deepEqual(state, raw); assert.equal(profile(state, 's_legacy_cat').isEgg, value);
    const enabled = enable(state); assert.equal(cycle(enabled, 's_legacy_cat').startFromEgg, value);
    assert.deepEqual(Core.validateState(clone(enabled)), enabled);
  }
  for (const invalid of [undefined, null, 0, 1, 'true', [], {}]) {
    const raw = Core.validateState(legacyState()); raw.students[0].startFromEgg = invalid;
    assert.throws(() => Core.validateState(raw), /蛋起始标记/);
    const enabled = enable(); cycle(enabled).startFromEgg = invalid;
    assert.throws(() => Core.validateState(enabled), /蛋起始标记/);
  }
  let state = grow(enable(), 30);
  state = act(state, { type: 'pet.graduate', id: firstId(state) });
  account(state).cycles[0].startFromEgg = 'false';
  assert.throws(() => Core.validateState(state), /蛋起始标记/);
});

test('RC11 eggs: mixed legacy/new panel archives preserve marker absence, growth, snapshots and browser-model results', () => {
  let state = Core.validateState(rc10Archive()); const legacyPanel = Core.panelId(state);
  state = act(state, { type: 'panel.create', mode: 'copy', name: '纯合成新蛋班' });
  const eggPanel = Core.panelId(state);
  state = grow(state, 30); state = act(state, { type: 'pet.graduate', id: firstId(state) });
  state = act(state, { type: 'pet.adopt', id: firstId(state), pet: 'cat' });
  const newPanelState = clone(state);
  state = act(state, { type: 'panel.switch', id: legacyPanel });
  assert.equal(profile(state).isEgg, false); assert.equal(Object.hasOwn(cycle(state), 'startFromEgg'), false);
  state = Core.validateState(clone(state));
  state = act(state, { type: 'panel.switch', id: eggPanel });
  for (const key of ['students', 'logs', 'petAccounts', 'petLogs', 'settings']) assert.deepEqual(state[key], newPanelState[key]);
  assert.equal(profile(state).isEgg, true);
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/pet-progress.js'), 'utf8'), context);
  assert.deepEqual(clone(context.PetProgress.profile(state, firstId(state))), profile(state));
  assert.deepEqual(clone(context.PetProgress.honorCard(state, firstId(state))), Progress.honorCard(state, firstId(state)));
  assert.deepEqual(Core.validateState(clone(state)), state);
});
