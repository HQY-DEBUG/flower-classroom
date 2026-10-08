'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/classroom-tools.js');
const make = (count = 6) => ({ version: 1, revision: 0, settings: { className: '合成测试班' },
  students: Array.from({ length: count }, (_, i) => ({ id: `s_${i}`, name: `合成同学${i + 1}`, group: i % 2 ? '合成B组' : '合成A组', score: 10, growth: 20, photo: `synthetic-photo-${i}` })),
  logs: [{ id: 'old-log', changes: [] }], petAccounts: [{ id: 'synthetic-pet-ledger' }], draw: { lastIds: [] }, timer: { running: false } });
const action = (s, type, fields = {}) => ({ type, ...T.expectation(s), ...fields });
const run = (s, type, fields = {}) => {
  const next = structuredClone(s);
  T.apply(next, action(s, type, fields));
  next.revision++;
  return next;
};
const vote = (s, ids = ['s_0', 's_1', 's_2']) => run(s, 'classroom.vote.start', { ids });
const attendance = (s, id = 's_0', present = true) => run(s, 'classroom.attendance.set', { id, present });
const protectedData = s => { const copy = structuredClone(s); delete copy.classroomTools; delete copy.revision; delete copy.version; return copy; };
test('legacy reads are lazy, do not add tools, and snapshots are fresh copies', () => {
  const s = make(), before = structuredClone(s), result = { students: s.students };
  T.validateExtensions(s, result);
  assert.equal(Object.hasOwn(result, 'classroomTools'), false);
  assert.equal(T.hasNewFields(s), false);
  const snapshot = T.snapshot(s); snapshot.attendance.presentIds.push('s_0');
  assert.deepEqual(T.snapshot(s).attendance.presentIds, []);
  assert.deepEqual(s, before);
});
test('vote candidate bound is exactly two to four distinct current IDs', () => {
  for (const ids of [[], ['s_0'], ['s_0', 's_1', 's_2', 's_3', 's_4'], ['s_0', 's_0'], ['s_0', 'deleted'], null]) {
    const s = make(), before = structuredClone(s);
    assert.throws(() => T.apply(s, action(s, 'classroom.vote.start', { ids })));
    assert.deepEqual(s, before);
  }
  for (const count of [2, 3, 4]) assert.equal(vote(make(), Array.from({ length: count }, (_, i) => `s_${i}`)).classroomTools.vote.candidates.length, count);
});
test('votes alter only the selected candidate; points, growth, photos and ledger stay exact', () => {
  const original = make(); let s = vote(original);
  s = run(s, 'classroom.vote.adjust', { id: 's_1', delta: 1 });
  s = run(s, 'classroom.vote.adjust', { id: 's_1', delta: 1 });
  s = run(s, 'classroom.vote.adjust', { id: 's_0', delta: 1 });
  s = run(s, 'classroom.vote.adjust', { id: 's_1', delta: -1 });
  assert.deepEqual(s.classroomTools.vote.candidates.map(v => v.votes), [1, 1, 0]);
  assert.deepEqual(protectedData(s), protectedData(original));
  assert.equal(s.version, 2);
});
test('negative votes are rejected as our product default, also bounds and malformed deltas', () => {
  const s = vote(make()), before = structuredClone(s);
  for (const delta of [-2, 0, 2, 1.1, '1', NaN, Infinity, -1]) assert.throws(() => T.apply(s, action(s, 'classroom.vote.adjust', { id: 's_0', delta })));
  assert.deepEqual(s, before);
  s.classroomTools.vote.candidates[0].votes = T.MAX_COUNT;
  assert.throws(() => T.apply(s, action(s, 'classroom.vote.adjust', { id: 's_0', delta: 1 })), /票数/);
});
test('reselection requires explicit clear-votes confirmation and is atomic on failure', () => {
  const s = run(vote(make()), 'classroom.vote.adjust', { id: 's_0', delta: 1 }), before = structuredClone(s);
  assert.throws(() => T.apply(s, action(s, 'classroom.vote.start', { ids: ['s_0', 's_3'] })), /清空当前票数/);
  assert.deepEqual(s, before);
  const next = run(s, 'classroom.vote.start', { ids: ['s_0', 's_3'], confirmedNewVote: true });
  assert.deepEqual(next.classroomTools.vote.candidates, [{ id: 's_0', votes: 0 }, { id: 's_3', votes: 0 }]);
});
test('each action requires panel, tools revision and reviewed roster; unrelated revision is allowed', () => {
  const s = vote(make());
  for (const key of ['panelId', 'expectedToolsRevision', 'expectedRoster']) {
    const a = action(s, 'classroom.vote.adjust', { id: 's_0', delta: 1 }); delete a[key];
    assert.throws(() => T.apply(structuredClone(s), a));
  }
  const a = action(s, 'classroom.vote.adjust', { id: 's_0', delta: 1 });
  const updated = structuredClone(s); updated.revision += 10; updated.students[0].score++;
  T.apply(updated, a);
  assert.equal(updated.classroomTools.vote.candidates[0].votes, 1);
  assert.throws(() => T.apply(structuredClone(s), { ...a, panelId: 'another-panel' }), /面板/);
  assert.throws(() => T.apply(structuredClone(s), { ...a, expectedRoster: 'stale' }), /名单/);
});
test('duplicate request and stale cross-window requests reject; a refreshed retry adds exactly once', () => {
  const s = vote(make()), a = action(s, 'classroom.vote.adjust', { id: 's_0', delta: 1 });
  const next = structuredClone(s); T.apply(next, a);
  const before = structuredClone(next);
  assert.throws(() => T.apply(next, a), /另一窗口/);
  assert.deepEqual(next, before);
  T.apply(next, action(next, 'classroom.vote.adjust', { id: 's_0', delta: 1 }));
  assert.equal(next.classroomTools.vote.candidates[0].votes, 2);
});
test('old vote actions cannot land in a freshly reselected round, even with the same students', () => {
  let s = vote(make());
  const old = action(s, 'classroom.vote.adjust', { id: 's_0', delta: 1 });
  s = run(s, 'classroom.vote.start', { ids: ['s_0', 's_1'], confirmedNewVote: true });
  assert.throws(() => T.apply(s, old), /另一窗口/);
  assert.equal(s.classroomTools.vote.candidates[0].votes, 0);
});
test('roster name, group, order, removal and replacement changes invalidate reviewed lists', () => {
  const s = vote(make()), a = action(s, 'classroom.vote.adjust', { id: 's_0', delta: 1 });
  for (const change of [n => n.students[0].name += '改名', n => n.students[0].group += '新组', n => n.students.reverse(), n => n.students.pop(), n => n.students[5].id = 'replacement']) {
    const n = structuredClone(s); change(n); assert.throws(() => T.apply(n, a), /名单/);
  }
});
test('attendance marks and unmarks by stable ID, including duplicate names', () => {
  let s = make(); s.students[0].name = s.students[1].name = '合成重名';
  s = attendance(s, 's_0'); s = attendance(s, 's_1'); s = attendance(s, 's_0', false);
  assert.deepEqual(s.classroomTools.attendance.presentIds, ['s_1']);
  assert.equal(T.attendanceSummary(s).absent, 5);
  const before = structuredClone(s);
  for (const fields of [{ id: 's_1', present: true }, { id: 'gone', present: true }, { id: 's_0', present: 'true' }]) assert.throws(() => T.apply(s, action(s, 'classroom.attendance.set', fields)));
  assert.deepEqual(s, before);
});
test('attendance statistics include zero-member result and all 300 students grouped in stable order', () => {
  assert.deepEqual(T.attendanceSummary(make(0)), { total: 0, present: 0, absent: 0, groups: [] });
  let s = make(300); s = attendance(s, 's_299'); s = attendance(s, 's_0');
  const summary = T.attendanceSummary(s);
  assert.equal(summary.total, 300); assert.equal(summary.present, 2); assert.equal(summary.absent, 298);
  assert.deepEqual(summary.groups.map(g => [g.name, g.students.length, g.present.length, g.absent.length]), [['合成A组', 150, 1, 149], ['合成B组', 150, 1, 149]]);
});
test('explicit attendance reset keeps voting and all protected data; absent marks persist until reset', () => {
  let s = attendance(vote(make()));
  const before = structuredClone(s);
  for (const confirmed of [undefined, false, 'true']) assert.throws(() => T.apply(s, action(s, 'classroom.attendance.reset', { confirmed })), /确认/);
  assert.deepEqual(s, before);
  s = run(s, 'classroom.attendance.reset', { confirmed: true });
  assert.deepEqual(s.classroomTools.attendance.presentIds, []);
  assert.deepEqual(s.classroomTools.vote, before.classroomTools.vote);
  assert.deepEqual(protectedData(s), protectedData(before));
  assert.throws(() => T.apply(s, action(s, 'classroom.attendance.reset', { confirmed: true })), /没有需要清空/);
});
test('backup validation preserves valid values, rejects malformed types and dangling references', () => {
  const s = attendance(vote(make())), result = { students: s.students };
  T.validateExtensions(JSON.parse(JSON.stringify(s)), result);
  assert.deepEqual(result.classroomTools, s.classroomTools);
  for (const mutate of [n => n.version = 1, n => n.classroomTools.version = 2, n => n.classroomTools.revision = -1, n => n.classroomTools.attendance.presentIds.push('gone'), n => n.classroomTools.attendance.presentIds.push('s_0'), n => n.classroomTools.vote.candidates[0].votes = -1, n => n.classroomTools.vote.candidates[0].votes = '1', n => n.classroomTools.vote.candidates[1].id = 's_0', n => n.classroomTools.vote.candidates = [null], n => n.classroomTools.vote = undefined]) {
    const n = structuredClone(s); mutate(n); assert.throws(() => T.validateExtensions(n, { students: n.students }));
  }
});
test('storage uses candidate arrays safely even for prototype-shaped valid identifiers', () => {
  const s = make(3); s.students[0].id = '__proto__'; s.students[1].id = 'constructor';
  const next = vote(s, ['__proto__', 'constructor']);
  T.apply(next, action(next, 'classroom.vote.adjust', { id: '__proto__', delta: 1 }));
  assert.equal(next.classroomTools.vote.candidates[0].votes, 1);
  assert.equal(Object.prototype.votes, undefined);
});
test('reconcile removal retains surviving votes and attendance, then ends fewer-than-two candidates', () => {
  let s = attendance(run(vote(make()), 'classroom.vote.adjust', { id: 's_1', delta: 1 }));
  const revision = s.classroomTools.revision;
  s.students = s.students.filter(v => v.id !== 's_0'); T.reconcile(s);
  assert.deepEqual(s.classroomTools.vote.candidates, [{ id: 's_1', votes: 1 }, { id: 's_2', votes: 0 }]);
  assert.deepEqual(s.classroomTools.attendance.presentIds, []);
  assert.equal(s.classroomTools.revision, revision + 1);
  const once = structuredClone(s); T.reconcile(s); assert.deepEqual(s, once);
  s.students = s.students.filter(v => v.id !== 's_2'); T.reconcile(s); assert.equal(s.classroomTools.vote, null);
});
test('reconcile clear or ID replacement clears only activity references and is lazy on old states', () => {
  const old = make(); T.reconcile(old); assert.equal(Object.hasOwn(old, 'classroomTools'), false);
  for (const count of [0, 3]) {
    const s = attendance(vote(make())); s.students = make(count).students.map(v => ({ ...v, id: 'new_' + v.id }));
    T.reconcile(s);
    assert.equal(s.classroomTools.vote, null); assert.deepEqual(s.classroomTools.attendance.presentIds, []);
    assert.equal(s.logs.length, 1); assert.equal(s.petAccounts.length, 1);
  }
});
test('panel identity blocks old requests and activity reducer never changes other panels', () => {
  const s = make(); s.panels = { activeId: 'panel_one', others: [{ id: 'panel_two', data: attendance(vote(make())) }] };
  const before = structuredClone(s.panels);
  const next = attendance(vote(s));
  assert.deepEqual(next.panels, before);
  assert.throws(() => T.apply(next, action(next, 'classroom.vote.adjust', { id: 's_0', delta: 1, panelId: 'panel_two' })), /面板/);
});
test('failed writes can discard a prepared copy without changing source, retry is well-defined', () => {
  const original = vote(make()), before = structuredClone(original), a = action(original, 'classroom.vote.adjust', { id: 's_0', delta: 1 });
  const unsaved = structuredClone(original); T.apply(unsaved, a);
  assert.deepEqual(original, before);
  const retry = structuredClone(original); T.apply(retry, a);
  assert.deepEqual(retry, unsaved);
});
test('revision overflow and unsupported actions fail without partial mutation', () => {
  const s = vote(make()); s.classroomTools.revision = Number.MAX_SAFE_INTEGER - 1;
  const before = structuredClone(s);
  assert.throws(() => T.apply(s, action(s, 'classroom.vote.adjust', { id: 's_0', delta: 1 })), /版本/);
  assert.deepEqual(s, before);
  assert.throws(() => T.apply(s, action(s, 'classroom.bad')));
});
test('verified 1/6/0 vote ranks are 2/1/3 at stable positions; our tie rule is competition ranking', () => {
  const s = vote(make()); s.classroomTools.vote.candidates.forEach((v, i) => { v.votes = [1, 6, 0][i]; });
  assert.deepEqual(T.voteStandings(s).map(v => [v.id, v.rank]), [['s_0', 2], ['s_1', 1], ['s_2', 3]]);
  s.classroomTools.vote.candidates[0].votes = 6;
  assert.deepEqual(T.voteStandings(s).map(v => v.rank), [1, 1, 3]);
});
test('group order is honored without adding empty groups or changing attendance', () => {
  const s = attendance(make()); s.settings.groupOrder = ['合成B组', '空组', '合成A组'];
  const summary = T.attendanceSummary(s);
  assert.deepEqual(summary.groups.map(g => g.name), ['合成B组', '合成A组']);
  assert.equal(summary.total, 6); assert.equal(summary.present, 1);
});
test('core integration keeps legacy reads lazy, upgrades on use and roundtrips complete backup', () => {
  const Core = require('../src/core.cjs');
  const legacy = Core.createInitialState(), before = structuredClone(legacy);
  assert.deepEqual(Core.validateState(legacy), before);
  const s = Core.applyAction(legacy, action(legacy, 'classroom.vote.start', { ids: legacy.students.slice(0, 3).map(v => v.id) }));
  assert.equal(s.version, 2); assert.equal(s.revision, before.revision + 1);
  assert.deepEqual(s.students, before.students); assert.deepEqual(s.logs, before.logs);
  assert.deepEqual(Core.validateState(JSON.parse(JSON.stringify(s))), s);
});
test('core integration reconciles student deletion, imported replacement and panel clearing', () => {
  const Core = require('../src/core.cjs');
  let s = Core.createInitialState();
  s = Core.applyAction(s, action(s, 'classroom.vote.start', { ids: s.students.slice(0, 3).map(v => v.id) }));
  s = Core.applyAction(s, action(s, 'classroom.attendance.set', { id: s.students[0].id, present: true }));
  let removed = Core.applyAction(s, { type: 'student.remove', id: s.students[0].id });
  assert.equal(removed.classroomTools.vote.candidates.length, 2); assert.deepEqual(removed.classroomTools.attendance.presentIds, []);
  removed = Core.applyAction(removed, { type: 'student.remove', id: removed.students[0].id }); assert.equal(removed.classroomTools.vote, null);
  const replaced = Core.importRows([{ name: '合成替换学生', group: '合成组' }], s, 'replace');
  assert.equal(replaced.classroomTools.vote, null); assert.deepEqual(replaced.classroomTools.attendance.presentIds, []);
  const cleared = Core.applyAction(s, { type: 'panel.clear' });
  assert.equal(cleared.classroomTools.vote, null); assert.deepEqual(cleared.classroomTools.attendance.presentIds, []);
});
test('core integration isolates panel states and rejects a pending action after panel switch', () => {
  const Core = require('../src/core.cjs');
  let s = Core.createInitialState();
  s = Core.applyAction(s, action(s, 'classroom.vote.start', { ids: s.students.slice(0, 3).map(v => v.id) }));
  s = Core.applyAction(s, action(s, 'classroom.attendance.set', { id: s.students[0].id, present: true }));
  const oldPanel = Core.panelId(s), stored = structuredClone(s.classroomTools), pending = action(s, 'classroom.vote.adjust', { id: s.students[0].id, delta: 1 });
  s = Core.applyAction(s, { type: 'panel.create', mode: 'copy', name: '合成新面板' });
  assert.equal(s.classroomTools, undefined); assert.throws(() => Core.applyAction(s, pending), /面板/);
  assert.deepEqual(Core.validateState(JSON.parse(JSON.stringify(s))), s);
  s = Core.applyAction(s, { type: 'panel.switch', id: oldPanel }); assert.deepEqual(s.classroomTools, stored);
});
