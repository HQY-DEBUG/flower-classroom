'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createInitialState, validateState, applyAction, importRows, panelId, assertStateCapacity, MAX_STATE_BYTES } = require('../src/core.cjs');
const Progress = require('../src/pet-progress.js');
const { legacyState, SYNTHETIC_PNG } = require('./pet-fixtures.cjs');
const NOW = 3_000_000;
const ALL_FIVE = [5, 5, 5, 5, 5, 5];
const clone = v => JSON.parse(JSON.stringify(v));
const act = (s, a) => applyAction(s, a, NOW);
const first = s => s.students[0];
const account = (s, id = first(s).id) => s.petAccounts.find(v => v.studentId === id);
const current = (s, id = first(s).id) => { const a = account(s, id); return a.cycles.find(c => c.id === a.activeCycleId); };
const enabled = (s = createInitialState(), thresholds = ALL_FIVE) => act(s, { type: 'pet.stage-rules', thresholds });
const growth = (s, delta, ids = [first(s).id]) => act(s, { type: 'pet.growth', ids, delta, reason: '纯合成独立成长测试' });
const score = (s, delta, ids = [first(s).id]) => act(s, { type: 'score', ids, delta, reason: '纯合成兼容积分测试' });
function unchangedOnFailure(s, a, pattern) { const before = JSON.stringify(s); assert.throws(() => act(s, a), pattern); assert.equal(JSON.stringify(s), before); }

test('Pet ledger: six incremental thresholds use exact cumulative boundaries and preserve overflow', () => {
  for (const [costs, boundaries] of [[Progress.DEFAULT_THRESHOLDS, [5, 15, 30, 50, 75, 105]], [ALL_FIVE, [5, 10, 15, 20, 25, 30]]]) {
    boundaries.forEach((boundary, i) => {
      assert.equal(Progress.progress(boundary - 1, costs).level, i + 1);
      const p = Progress.progress(boundary, costs); assert.equal(p.level, i + 2); assert.equal(p.current, 0);
      assert.equal(p.needed, i === 5 ? null : costs[i + 1]); assert.equal(p.maxed, i === 5);
    });
  }
  assert.deepEqual(Progress.progress(15, Progress.DEFAULT_THRESHOLDS), { level: 3, current: 0, needed: 15, maxed: false, shape: 3, growth: 15, overflow: 0 });
  assert.equal(Progress.progress(200, Progress.DEFAULT_THRESHOLDS).overflow, 95);
  for (const costs of [[], [5], [5, 5, 5, 5, 5, 0], [5, 5, 5, 5, 5, 0.5], [5, 5, 5, 5, 5, '5'], Array(6).fill(1e9)]) assert.throws(() => Progress.progress(0, costs));
});

test('Pet ledger: browser and CommonJS share exactly the same pure progression model', () => {
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('../src/pet-progress.js'), 'utf8'), context);
  assert.deepEqual(clone(context.PetProgress.progress(15, [5, 10, 15, 20, 25, 30])), Progress.progress(15, Progress.DEFAULT_THRESHOLDS));
  assert.equal(clone(context.PetProgress.profile(legacyState(), 's_legacy_bunny')).level, 11);
});

test('Pet ledger: v1 stays unmodified until explicit enabling, including genuine LV11', () => {
  const old = validateState(legacyState()), bytes = JSON.stringify(old);
  const p = Progress.profile(old, 's_legacy_bunny'); assert.equal(p.level, 11); assert.equal(p.enabled, false); assert.equal(p.growth, 200);
  assert.equal(old.version, 1); assert.equal(old.petAccounts, undefined); assert.equal(old.settings.petRules, undefined);
  unchangedOnFailure(old, { type: 'pet.growth', ids: [first(old).id], delta: 3 }, /先保存/);
  assert.equal(JSON.stringify(old), bytes);
});

test('Pet ledger: activation retains every legacy field and unlogged growth without inventing graduations', () => {
  const old = validateState(legacyState()), s = enabled(old, Progress.DEFAULT_THRESHOLDS);
  assert.equal(s.version, 2); assert.deepEqual(s.students, old.students); assert.equal(s.students[0].photo, SYNTHETIC_PNG);
  for (const [i, log] of s.logs.entries()) { const original = clone(log); original.changes.forEach(c => delete c.petEffect); assert.deepEqual(original, old.logs[i]); }
  assert.equal(account(s, 's_legacy_bunny').lifetimeNetGrowth, 200); assert.equal(current(s, 's_legacy_bunny').netGrowth, 200);
  assert.equal(account(s, 's_legacy_bunny').cycles[0].openedAt, null);
  assert.ok(s.petAccounts.every(a => a.mode === 'legacy-linked' && a.graduations.length === 0 && a.badgeEvents.length === 0));
  assert.equal(s.petLogs.length, 0); assert.equal(Progress.profile(s, 's_legacy_bunny').maxed, true);
  assert.deepEqual(validateState(clone(s)), s);
});

test('Pet ledger: changing six thresholds never rewrites balances, logs, photos or existing snapshots', () => {
  let s = growth(enabled(legacyState()), 15); s = act(s, { type: 'pet.graduate', id: first(s).id });
  const before = clone(s);
  s = enabled(s, Progress.DEFAULT_THRESHOLDS);
  for (const key of ['students', 'logs', 'petAccounts', 'petLogs', 'draw', 'timer']) assert.deepEqual(s[key], before[key]);
  assert.deepEqual(account(s).graduations[0].ruleSnapshot.thresholds, ALL_FIVE);
});

test('Pet ledger: direct group growth changes only each selected pet and retains ordinary score/group state', () => {
  let s = enabled(); const ids = s.students.filter(v => v.group === first(s).group).map(v => v.id);
  s = act(s, { type: 'group.base', group: first(s).group, delta: 9 });
  const before = clone(s); s = growth(s, 3, ids);
  for (const key of ['students', 'logs', 'groupBases', 'groupLogs', 'draw']) assert.deepEqual(s[key], before[key]);
  assert.ok(ids.every(id => current(s, id).netGrowth === 3)); assert.equal(s.petLogs.length, 1); assert.equal(s.petLogs[0].changes.length, 3);
  assert.ok(s.petAccounts.filter(a => !ids.includes(a.studentId)).every(a => a.lifetimeNetGrowth === 0));
  const undo = act(s, { type: 'pet.undo', logId: s.petLogs[0].id }); assert.deepEqual(undo.petAccounts, before.petAccounts);
});

test('Pet ledger: signed growth and nonsequential undo retain later changes without clamping', () => {
  let s = growth(enabled(), 20), a = s.petLogs.at(-1).id;
  s = growth(s, -6); const penalty = s.petLogs.at(-1).id;
  s = growth(s, 9); const later = s.petLogs.at(-1).id;
  s = act(s, { type: 'pet.undo', logId: a }); assert.equal(current(s).netGrowth, 3);
  unchangedOnFailure(s, { type: 'pet.undo', logId: later }, /低于 0/);
  s = act(s, { type: 'pet.undo', logId: penalty }); assert.equal(current(s).netGrowth, 9);
  s = act(s, { type: 'pet.undo', logId: later }); assert.equal(current(s).netGrowth, 0);
  unchangedOnFailure(s, { type: 'pet.undo', logId: later }, /已经撤销/);
});

test('Pet ledger: negative growth visibly lowers a level; unknown minimum rejects the entire transaction', () => {
  let s = growth(enabled(), 12); assert.equal(Progress.profile(s, first(s)).level, 3);
  s = growth(s, -10); assert.equal(Progress.profile(s, first(s)).level, 1); assert.equal(current(s).netGrowth, 2);
  unchangedOnFailure(s, { type: 'pet.growth', ids: [first(s).id], delta: -3 }, /宠物成长将低于 0/);
  unchangedOnFailure(s, { type: 'pet.growth', ids: s.students.slice(0, 2).map(v => v.id), delta: -1 }, /低于 0/);
});

test('Pet ledger: migrated legacy score linkage persists; newly added students are explicitly independent', () => {
  let s = enabled(), id = first(s).id; s = score(s, 7); assert.equal(current(s).netGrowth, 7); assert.equal(first(s).growth, 7);
  const log = s.logs.at(-1); assert.deepEqual(log.changes[0].petEffect, { accountId: account(s).id, cycleId: current(s).id, delta: 7 });
  s = score(s, -3); assert.equal(current(s).netGrowth, 7); assert.equal(s.logs.at(-1).changes[0].petEffect, null);
  s = act(s, { type: 'student.add', name: '合成独立同学', pet: 'penguin' }); const newcomer = s.students.at(-1).id;
  assert.equal(account(s, newcomer).mode, 'independent');
  s = score(s, 6, [newcomer]); assert.equal(current(s, newcomer).netGrowth, 0); assert.equal(s.students.at(-1).growth, 6); assert.equal(s.logs.at(-1).changes[0].petEffect, null);
  s = growth(s, 4, [newcomer]); assert.equal(current(s, newcomer).netGrowth, 4); assert.equal(s.students.at(-1).score, 6);
  s = act(s, { type: 'undo', logId: log.id }); assert.equal(current(s, id).netGrowth, 0);
});

test('Pet ledger: LV7 does not auto-graduate; explicit graduation awards exactly one permanent event', () => {
  let s = growth(enabled(), 37), id = first(s).id;
  assert.equal(Progress.profile(s, id).maxed, true); assert.equal(Progress.profile(s, id).overflow, 7); assert.equal(Progress.profile(s, id).medalTotal, 0);
  s = act(s, { type: 'pet.graduate', id }); const a = account(s);
  assert.equal(a.activeCycleId, null); assert.equal(a.cycles[0].netGrowth, 37); assert.equal(a.lifetimeNetGrowth, 37);
  assert.equal(a.graduations.length, 1); assert.equal(a.graduations[0].growthSnapshot, 37); assert.equal(a.badgeEvents.length, 1); assert.equal(Progress.profile(s, id).medalTotal, 1);
  assert.equal(Progress.profile(s, id).adopted, false); assert.equal(first(s).growth, 0);
  unchangedOnFailure(s, { type: 'pet.graduate', id }, /没有/);
  unchangedOnFailure(s, { type: 'student.update', id, adopted: true }, /重新领养/);
});

test('Pet ledger compatibility policy (not reference-confirmed): later adoption starts at zero and undo changes original closed cycle only', () => {
  let s = score(enabled(), 30), id = first(s).id, scoreLog = s.logs.at(-1).id, oldCycle = current(s).id;
  s = growth(s, 5); const directLog = s.petLogs.at(-1).id;
  s = act(s, { type: 'pet.graduate', id }); const snapshot = clone(account(s).graduations[0]);
  s = act(s, { type: 'pet.adopt', id, pet: 'cat' }); const newCycle = current(s).id;
  assert.notEqual(newCycle, oldCycle); assert.equal(current(s).netGrowth, 0); assert.equal(account(s).lifetimeNetGrowth, 35); assert.equal(first(s).growth, 30);
  s = growth(s, 7); s = act(s, { type: 'undo', logId: scoreLog });
  assert.equal(current(s).netGrowth, 7); assert.equal(account(s).cycles.find(c => c.id === oldCycle).netGrowth, 5); assert.equal(account(s).lifetimeNetGrowth, 12);
  s = act(s, { type: 'pet.undo', logId: directLog }); assert.equal(current(s).netGrowth, 7); assert.equal(account(s).lifetimeNetGrowth, 7);
  assert.deepEqual(account(s).graduations[0], snapshot); assert.equal(Progress.profile(s, id).medalTotal, 1);
});

test('Pet ledger: legacy positive points while no pet is active stay unassigned, never spill into a later adoption', () => {
  let s = growth(enabled(), 30), id = first(s).id; s = act(s, { type: 'pet.graduate', id });
  s = score(s, 9); const log = s.logs.at(-1); assert.equal(log.changes[0].petEffect.cycleId, null); assert.equal(account(s).unassignedGrowth, 9);
  s = act(s, { type: 'pet.adopt', id, pet: 'cat' }); assert.equal(current(s).netGrowth, 0); assert.equal(account(s).lifetimeNetGrowth, 39);
  s = act(s, { type: 'undo', logId: log.id }); assert.equal(current(s).netGrowth, 0); assert.equal(account(s).unassignedGrowth, 0); assert.equal(account(s).lifetimeNetGrowth, 30);
});

test('Pet ledger: historic logs bind to the legacy cycle and remain reversible after explicit migration and graduation', () => {
  let s = enabled(legacyState(), [1, 1, 1, 1, 1, 1]), id = first(s).id, oldCycle = current(s).id;
  s = act(s, { type: 'pet.graduate', id }); s = act(s, { type: 'pet.adopt', id, pet: 'penguin' }); s = growth(s, 4);
  s = act(s, { type: 'undo', logId: 'l_legacy_award_owl' });
  assert.equal(first(s).growth, 0); assert.equal(first(s).score, 0); assert.equal(current(s).netGrowth, 4);
  assert.equal(account(s).cycles.find(v => v.id === oldCycle).netGrowth, 0); assert.equal(account(s).graduations[0].growthSnapshot, 19);
});

test('Pet ledger: legacy medals become opening honor balance without invented graduation sources or past spending', () => {
  const raw = legacyState(); raw.students[0].medals = 4; let s = enabled(raw);
  assert.equal(first(s).medals, 4); assert.equal(account(s).legacyMedals, 4); assert.equal(account(s).badgeEvents.length, 0);
  let p = Progress.profile(s, first(s)); assert.equal(p.medalTotal, 4); assert.equal(p.medalAvailable, 4); assert.equal(p.medalBalanceKnown, true); assert.equal(p.medalTotalIncludesLegacy, true);
  s = growth(s, 11); s = act(s, { type: 'pet.graduate', id: first(s).id });
  p = Progress.profile(s, first(s)); assert.equal(p.medalTotal, 5); assert.equal(first(s).medals, 4); assert.equal(account(s).badgeEvents.length, 1);
});

test('Pet ledger: species changes preserve cycle growth and all twenty catalog IDs, while graduated snapshots stay immutable', () => {
  let s = growth(enabled(), 30), id = first(s).id; s = act(s, { type: 'pet.graduate', id }); const grad = clone(account(s).graduations[0]);
  s = act(s, { type: 'pet.adopt', id, pet: 'cat' }); s = growth(s, 7); const cycleId = current(s).id;
  for (const pet of Object.keys(require('../src/pet-art.js').names)) {
    s = act(s, { type: 'student.update', id, pet }); assert.equal(current(s).pet, pet); assert.equal(current(s).netGrowth, 7); assert.equal(current(s).id, cycleId); assert.deepEqual(account(s).graduations[0], grad);
  }
});

test('Pet ledger: dormant legacy pets preserve growth on adoption and cannot receive direct growth beforehand', () => {
  const raw = legacyState(); raw.students[0].adopted = false; let s = enabled(raw), id = first(s).id;
  assert.equal(Progress.profile(s, id).adopted, false); assert.equal(current(s).netGrowth, 19);
  unchangedOnFailure(s, { type: 'pet.growth', ids: [id], delta: 1 }, /尚未领养/);
  s = act(s, { type: 'pet.adopt', id, pet: 'penguin' }); assert.equal(current(s).netGrowth, 19); assert.equal(Progress.profile(s, id).adopted, true);
  unchangedOnFailure(s, { type: 'pet.adopt', id, pet: 'cat' }, /已有/);
});

test('Pet ledger: multi-group confirmation commits once and failures never leave partial rewards', () => {
  const s = enabled(), ids = s.students.slice(0, 4).map(v => v.id);
  const action = { type: 'pet.growth.mixed', awards: [{ ids: ids.slice(0, 2), delta: 3 }, { ids: ids.slice(2), delta: 7 }] };
  const next = act(s, action); assert.equal(next.revision, s.revision + 1); assert.equal(next.petLogs.length, 2); assert.equal(current(next, ids[0]).netGrowth, 3); assert.equal(current(next, ids[3]).netGrowth, 7); assert.deepEqual(next.students, s.students);
  unchangedOnFailure(s, { ...action, awards: [...action.awards, { ids: [ids[0]], delta: 2 }] }, /重复/);
  unchangedOnFailure(s, { ...action, awards: [action.awards[0], { ids: ids.slice(2), delta: -1 }] }, /低于 0/);
});

test('Pet ledger: independent student and group draw is fair, excludes unadopted pets and never changes ordinary draw', () => {
  let s = enabled(), excluded = first(s).id; s = act(s, { type: 'student.update', id: excluded, adopted: false }); const ordinary = clone(s.draw), seen = new Set();
  for (let i = 0; i < 4; i++) { s = act(s, { type: 'pet.draw', scope: 'students', mode: 'cycle', count: 3 }); for (const id of s.petDraw.lastIds) { assert.notEqual(id, excluded); assert.ok(!seen.has(id)); seen.add(id); } }
  assert.equal(seen.size, 11); assert.equal(s.petDraw.bag.length, 0); assert.deepEqual(s.draw, ordinary);
  s = act(s, { type: 'pet.draw', scope: 'groups', count: 2, mode: 'cycle' }); assert.equal(s.petDraw.groups.length, 2);
  for (const group of s.petDraw.groups) assert.deepEqual(group.ids, s.students.filter(v => v.group === group.group && v.id !== excluded).map(v => v.id));
  assert.deepEqual(s.petDraw.lastIds, s.petDraw.groups.flatMap(v => v.ids));
  const rewarded = growth(s, 3, s.petDraw.lastIds); assert.deepEqual(rewarded.students, s.students); assert.deepEqual(rewarded.draw, ordinary);
  s = act(s, { type: 'students.group', ids: [s.petDraw.lastIds[0]], group: '合成换组' }); assert.equal(s.petDraw.lastIds.length, 0);
});

test('Pet ledger: all roster members count in group averages and zero groups share competition rank', () => {
  let s = importRows(Array.from({ length: 10 }, (_, i) => ({ name: `合成排行${i}`, group: `合成组${Math.floor(i / 2)}` })), createInitialState(), 'replace');
  s.students[0].medals = 6; s.students[2].medals = 4; s.students[4].medals = 2; s.students[1].adopted = false; s = enabled(s);
  const rows = Progress.groupRankings(s); assert.deepEqual(rows.map(v => v.averageMedals), [3, 2, 1, 0, 0]); assert.deepEqual(rows.map(v => v.rank), [1, 2, 3, 4, 4]); assert.ok(rows.every(v => v.count === 2));
  assert.equal(Progress.studentRankings(s, { sortBy: 'medals' })[0].id, s.students[0].id);
  assert.ok(Progress.studentRankings(s, { sortBy: 'level' }).every(v => v.rank === 1));
});

test('Pet ledger: new blank and copied panels use six stages and independent accounts without migrating the source', () => {
  const old = validateState(legacyState()); let s = act(old, { type: 'panel.create', mode: 'copy', name: '合成新板' });
  assert.deepEqual(s.settings.petRules.thresholds, ALL_FIVE); assert.ok(s.petAccounts.every(a => a.mode === 'independent' && a.lifetimeNetGrowth === 0)); assert.deepEqual(s.panels.others[0].data, old);
  s = enabled(s, Progress.DEFAULT_THRESHOLDS); s = act(s, { type: 'panel.create', mode: 'copy', name: '合成阈值副本' }); assert.deepEqual(s.settings.petRules.thresholds, Progress.DEFAULT_THRESHOLDS);
  const blank = act(old, { type: 'panel.create', mode: 'blank', name: '合成空板' }); assert.deepEqual(blank.petAccounts, []); assert.deepEqual(blank.settings.petRules.thresholds, ALL_FIVE);
});

test('Pet ledger: backups round-trip all panels, photos, score effects, graduations and independent histories', () => {
  let s = enabled(legacyState()), originalPanel = panelId(s); s = growth(s, 30); s = act(s, { type: 'pet.graduate', id: first(s).id }); s = act(s, { type: 'pet.adopt', id: first(s).id, pet: 'cat' }); s = growth(s, 4);
  const oldData = clone(s); s = act(s, { type: 'panel.create', mode: 'copy', name: '合成第二板' }); s = growth(s, 8); s = act(s, { type: 'pet.visibility', hideLateForms: true }); const secondId = panelId(s), secondData = clone(s);
  assert.deepEqual(validateState(clone(s)), s); s = act(s, { type: 'panel.switch', id: originalPanel });
  for (const key of ['students', 'logs', 'petAccounts', 'petLogs', 'settings']) assert.deepEqual(s[key], oldData[key]);
  s = act(s, { type: 'panel.switch', id: secondId }); for (const key of ['students', 'logs', 'petAccounts', 'petLogs', 'settings']) assert.deepEqual(s[key], secondData[key]);
  assert.deepEqual(validateState(clone(s)), s);
});

test('Pet ledger: clearing ordinary points cannot erase pet lifetime history or graduation facts', () => {
  let s = score(enabled(), 30); s = act(s, { type: 'pet.graduate', id: first(s).id }); const before = clone(s.petAccounts);
  s = act(s, { type: 'points.clear' }); assert.deepEqual(s.petAccounts, before); assert.equal(first(s).growth, 30); assert.equal(first(s).score, 0); assert.equal(s.logs.length, 0);
  assert.deepEqual(validateState(clone(s)), s);
});

test('Pet ledger: removing a participant preserves original IDs and rejects a partial batch undo', () => {
  let s = enabled(), ids = s.students.slice(0, 2).map(v => v.id); s = growth(s, 4, ids); const logId = s.petLogs[0].id, oldAccount = clone(account(s, ids[1]));
  s = act(s, { type: 'student.remove', id: ids[1] }); assert.deepEqual(account(s, ids[1]), oldAccount);
  unchangedOnFailure(s, { type: 'pet.undo', logId }, /已移除/); assert.equal(current(s, ids[0]).netGrowth, 4);
  assert.deepEqual(validateState(clone(s)), s);
});

test('Pet ledger: malformed new fields, references and duplicate events reject atomically', () => {
  let s = score(enabled(), 30); s = act(s, { type: 'pet.graduate', id: first(s).id }); s = act(s, { type: 'pet.adopt', id: first(s).id, pet: 'cat' }); s = growth(s, 2);
  const mutations = [
    v => { v.version = 1; }, v => { v.settings.petRules.thresholds[0] = 0; }, v => { v.settings.hideLateForms = 'true'; },
    v => { v.petAccounts[0].lifetimeNetGrowth++; }, v => { v.petAccounts[0].mode = 'mystery'; }, v => { v.petAccounts[0].activeCycleId = 'missing'; },
    v => { v.petAccounts[0].cycles[0].netGrowth = -1; }, v => { v.petAccounts[0].cycles[1].id = v.petAccounts[0].cycles[0].id; },
    v => { v.petAccounts[0].graduations[0].growthSnapshot = 0; }, v => { v.petAccounts[0].graduations.push(clone(v.petAccounts[0].graduations[0])); },
    v => { v.petAccounts[0].badgeEvents[0].amount = 2; }, v => { v.petAccounts[0].badgeEvents = []; },
    v => { delete v.logs[0].changes[0].petEffect; }, v => { v.logs[0].changes[0].petEffect = null; }, v => { v.logs[0].changes[0].petEffect.cycleId = 'missing'; },
    v => { v.petLogs[0].changes[0].afterGrowth++; }, v => { v.petLogs[0].changes[0].accountId = 'missing'; }, v => { v.petLogs[0].changes.push(clone(v.petLogs[0].changes[0])); },
    v => { v.petAccounts[0].legacyMedals = 1; }, v => { v.petAccounts.pop(); },
  ];
  for (const mutate of mutations) { const bad = clone(s); mutate(bad); const bytes = JSON.stringify(bad); assert.throws(() => validateState(bad)); assert.equal(JSON.stringify(bad), bytes); }
  unchangedOnFailure(s, { type: 'pet.stage-rules', thresholds: [5, 5, 5, 5, 5, null] });
  unchangedOnFailure(s, { type: 'pet.growth', ids: [first(s).id, 'missing'], delta: 1 });
});

test('Pet ledger: stale multiwindow cycle selections reject without rewarding a later pet', () => {
  let s = growth(enabled(), 30), id = first(s).id, oldCycleId = current(s).id;
  s = act(s, { type: 'pet.graduate', id, expectedCycleId: oldCycleId });
  unchangedOnFailure(s, { type: 'pet.adopt', id, pet: 'cat', expectedCycleId: oldCycleId }, /另一窗口/);
  s = act(s, { type: 'pet.adopt', id, pet: 'cat', expectedCycleId: null });
  unchangedOnFailure(s, { type: 'pet.growth', ids: [id], delta: 3, expectedCycles: [{ id, cycleId: oldCycleId }] }, /另一窗口/);
  unchangedOnFailure(s, { type: 'pet.growth', ids: [id], delta: 3, expectedCycles: [] }, /不完整/);
  unchangedOnFailure(s, { type: 'pet.graduate', id, expectedCycleId: oldCycleId }, /另一窗口/);
  s = act(s, { type: 'pet.growth', ids: [id], delta: 3, expectedCycles: [{ id, cycleId: current(s).id }] }); assert.equal(current(s).netGrowth, 3);
});

test('Pet ledger: independent histories and cycles have explicit limits and never silently discard oldest records', () => {
  const s = growth(enabled(), 1), tooMany = clone(s); tooMany.petLogs = Array(20_001).fill(tooMany.petLogs[0]);
  assert.throws(() => validateState(tooMany), /数量超过上限/);
  const tooManyCycles = clone(s); tooManyCycles.petAccounts[0].cycles = Array(20_001).fill(tooManyCycles.petAccounts[0].cycles[0]);
  assert.throws(() => validateState(tooManyCycles), /数量超过上限/);
  const tooManyAccounts = clone(s); tooManyAccounts.petAccounts = Array(20_001).fill(tooManyAccounts.petAccounts[0]);
  assert.throws(() => validateState(tooManyAccounts), /数量超过上限/);
  assert.equal(s.petLogs.length, 1); assert.equal(s.petAccounts[0].cycles.length, 1);
});

test('Pet ledger: capacity is measured across complete UTF-8 JSON and exactly enforced', () => {
  const object = { text: '合成' }, bytes = Buffer.byteLength(JSON.stringify(object));
  assert.equal(assertStateCapacity(object, { maxBytes: bytes }), bytes);
  assert.throws(() => assertStateCapacity(object, { maxBytes: bytes - 1 }), /容量/);
  assert.equal(MAX_STATE_BYTES, 90 * 1024 * 1024);
  const payload = { synthetic: 'x'.repeat(MAX_STATE_BYTES - Buffer.byteLength(JSON.stringify({ synthetic: '' }))) };
  assert.equal(assertStateCapacity(payload), MAX_STATE_BYTES);
  payload.synthetic += 'x'; assert.throws(() => assertStateCapacity(payload), /容量/);
});
