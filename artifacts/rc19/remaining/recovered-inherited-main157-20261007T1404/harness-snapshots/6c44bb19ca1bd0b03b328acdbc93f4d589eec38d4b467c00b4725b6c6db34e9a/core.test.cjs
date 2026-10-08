'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInitialState, validateState, applyAction, remainingMs, petLevel, importRows } = require('../src/core.cjs');
const NOW = 1_000_000;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRj8AAAAASUVORK5CYII=';
const clone = value => JSON.parse(JSON.stringify(value));
const score = (s, delta, ids = [s.students[0].id]) => applyAction(s, { type: 'score', ids, delta, reason: '测试' }, NOW);
function freezeDeep(value) { Object.freeze(value); for (const item of Object.values(value)) if (item && typeof item === 'object') freezeDeep(item); return value; }
function first(s) { return s.students[0]; }
function smallState(count = 3) { return importRows(Array.from({ length: count }, (_, i) => ({ name: `假同学${i + 1}`, group: '测试组' })), createInitialState(), 'replace'); }

test('initial state contains twelve explicitly fictional students, four groups and supported pets', () => {
  const s = createInitialState();
  assert.equal(s.students.length, 12);
  assert.equal(new Set(s.students.map(v => v.group)).size, 4);
  assert.equal(new Set(s.students.map(v => v.id)).size, 12);
  assert.ok(s.students.every(v => v.name.startsWith('示例同学') && !v.photo && v.score === 0 && v.growth === 0));
  assert.deepEqual(validateState(s), s);
});

test('validation returns an independent, projected state suitable for JSON persistence', () => {
  const s = createInitialState();
  const restored = validateState(clone(s));
  assert.deepEqual(restored, s);
  restored.students[0].name = '改变';
  restored.draw.bag.push('different');
  assert.notEqual(s.students[0].name, '改变');
  assert.deepEqual(s.draw.bag, []);
  assert.notEqual(restored.settings, s.settings);
  assert.notEqual(restored.timer, s.timer);
});

test('positive and negative points change current-score levels while preserving historical growth', () => {
  const initial = freezeDeep(createInitialState());
  const snapshot = JSON.stringify(initial);
  const plus = score(initial, 25);
  assert.equal(first(plus).score, 25); assert.equal(first(plus).growth, 0);
  assert.deepEqual(petLevel(first(plus)), { level: 2, current: 10, needed: 15 });
  const minus = score(plus, -30);
  assert.equal(first(minus).score, -5); assert.equal(first(minus).growth, 0);
  assert.equal(JSON.stringify(initial), snapshot);
  assert.equal(plus.revision, initial.revision + 1);
});

test('pet levels use score at the seven cumulative thresholds, regardless of old growth', () => {
  const thresholds = [5,15,30,50,70,90,110], costs = [5,10,15,20,20,20,20];
  for (const score of [-30,-1,0,4]) assert.equal(petLevel({score,growth:999}).level, 0);
  thresholds.forEach((score, i) => {
    assert.equal(petLevel({score:score-1,growth:0}).level, i);
    assert.deepEqual(petLevel({score,growth:999}), {level:i+1,current:0,needed:costs[i+1] || 20});
  });
  assert.equal(petLevel({score:130,growth:0}).level,8);
});

test('batch points make one complete log with snapshots and no duplicate changes', () => {
  const s = createInitialState(), ids = s.students.slice(0, 3).map(v => v.id);
  const result = score(s, 4, ids);
  assert.equal(result.logs.length, 1);
  assert.equal(result.logs[0].timestamp, NOW);
  assert.equal(result.logs[0].delta, 4);
  assert.equal(result.logs[0].undone, false);
  assert.equal(result.logs[0].changes.length, 3);
  for (const c of result.logs[0].changes) assert.deepEqual({ ...c, id: '', name: '' }, { id: '', name: '', beforeScore: 0, afterScore: 4, beforeGrowth: 0, afterGrowth: 0 });
  assert.equal(result.students.reduce((n, v) => n + v.score, 0), 12);
  assert.equal(s.logs.length, 0);
});

test('point validation rejects missing/duplicate students and invalid amounts atomically', () => {
  const s = freezeDeep(createInitialState()), original = JSON.stringify(s), id = first(s).id;
  for (const delta of [0, 101, -101, 0.1, NaN, Infinity, '1', undefined]) assert.throws(() => score(s, delta));
  for (const ids of [[], [id, id], [id, 'missing'], null, 'abc']) assert.throws(() => score(s, 1, ids));
  assert.throws(() => applyAction(s, { type: 'score', ids: [id], delta: 1, reason: '长'.repeat(121) }, NOW));
  assert.equal(JSON.stringify(s), original);
});

test('undo reverses full batch and preserves an audit record', () => {
  const s = createInitialState(), updated = score(s, 8, s.students.slice(0, 5).map(v => v.id));
  const undone = applyAction(updated, { type: 'undo', logId: updated.logs[0].id }, NOW);
  assert.deepEqual(undone.students, s.students);
  assert.equal(undone.logs[0].undone, true);
  assert.equal(updated.logs[0].undone, false);
  assert.throws(() => applyAction(undone, { type: 'undo', logId: undone.logs[0].id }, NOW));
  assert.throws(() => applyAction(updated, { type: 'undo', logId: 'missing' }, NOW));
});

test('out-of-order undo subtracts only its score transaction and preserves archived growth', () => {
  let s = score(createInitialState(), 10), firstLog = s.logs[0].id;
  s = score(s, 7); s = score(s, -3);
  s = applyAction(s, { type: 'undo', logId: firstLog }, NOW);
  assert.equal(first(s).score, 4); assert.equal(first(s).growth, 0);
  s = applyAction(s, { type: 'undo', logId: s.logs[2].id }, NOW);
  assert.equal(first(s).score, 7); assert.equal(first(s).growth, 0);
  s = applyAction(s, { type: 'undo', logId: s.logs[1].id }, NOW);
  assert.equal(first(s).score, 0); assert.equal(first(s).growth, 0);
});

test('batch undo with a removed student fails without partial changes', () => {
  let s = createInitialState();
  s = score(s, 5, s.students.slice(0, 2).map(v => v.id));
  const removedId = first(s).id, logId = s.logs[0].id;
  s = applyAction(s, { type: 'student.remove', id: removedId }, NOW);
  const snapshot = JSON.stringify(s);
  assert.throws(() => applyAction(s, { type: 'undo', logId }, NOW), /已移除/);
  assert.equal(JSON.stringify(s), snapshot); assert.equal(first(s).score, 5);
  assert.equal(s.logs[0].changes[0].id, removedId);
});

test('repeated serialized operations retain every update, modeling centralized multiwindow dispatch', () => {
  let s = createInitialState();
  for (let i = 0; i < 50; i++) s = score(s, 1);
  assert.equal(first(s).score, 50); assert.equal(first(s).growth, 0);
  assert.equal(s.logs.length, 50); assert.equal(new Set(s.logs.map(v => v.id)).size, 50);
  assert.equal(s.revision, 50);
});

test('student add/update/remove support flat fields, stable IDs and independent same-name students', () => {
  let s = smallState(1);
  s = applyAction(s, { type: 'student.add', name: ' 新同学 ', group: '', pet: 'cat', photo: PNG }, NOW);
  const added = s.students[1];
  assert.equal(added.name, '新同学'); assert.equal(added.group, '未分组'); assert.equal(added.photo, PNG);
  s = score(s, 3, [added.id]);
  s = applyAction(s, { type: 'student.update', id: added.id, name: first(s).name, group: '新组', pet: 'fox' }, NOW);
  assert.equal(s.students[1].id, added.id); assert.equal(s.students[1].score, 3); assert.equal(s.students[1].growth, 0); assert.equal(s.students[1].photo, PNG);
  s = applyAction(s, { type: 'student.remove', id: added.id }, NOW);
  assert.equal(s.students.length, 1); assert.equal(s.logs.length, 1);
  assert.throws(() => applyAction(s, { type: 'student.remove', id: 'unknown' }, NOW));
  assert.throws(() => applyAction(s, { type: 'student.update', id: 'unknown', name: '新名' }, NOW));
});

test('student fields are bounded and score cannot be overwritten using a profile edit', () => {
  const s = smallState(1);
  for (const name of ['', '   ', '字'.repeat(41), '\u0000abc', 23]) assert.throws(() => applyAction(s, { type: 'student.add', name }, NOW));
  assert.throws(() => applyAction(s, { type: 'student.add', name: '假名', group: '组'.repeat(41) }, NOW));
  assert.throws(() => applyAction(s, { type: 'student.add', name: '假名', pet: 'unknown-pet' }, NOW));
  const edited = applyAction(s, { type: 'student.update', id: first(s).id, name: '新名', score: 999, growth: 999 }, NOW);
  assert.equal(first(edited).score, 0); assert.equal(first(edited).growth, 0);
});

test('settings validation is bounded and does not disturb the roster', () => {
  const s = createInitialState();
  const changed = applyAction(s, { type: 'settings', className: ' 三年级二班 ' }, NOW);
  assert.equal(changed.settings.className, '三年级二班'); assert.deepEqual(changed.students, s.students);
  for (const className of ['', '班'.repeat(81), null]) assert.throws(() => applyAction(s, { type: 'settings', className }, NOW));
});

test('photos only accept bounded local raster data URIs with matching file signatures', () => {
  const s = smallState(1), id = first(s).id;
  const update = value => applyAction(s, { type: 'student.update', id, photo: value }, NOW);
  assert.equal(first(update(PNG)).photo, PNG);
  assert.equal(first(update('')).photo, '');
  for (const value of ['https://example.com/kid.jpg', 'file:///tmp/kid.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,PHN2Zz4=', 'data:image/png;base64,!!!!', PNG.replace('image/png', 'image/jpeg'), 'data:image/png;base64,' + 'A'.repeat(2 * 1024 * 1024), null]) assert.throws(() => update(value));
  const jpg = 'data:image/jpeg;base64,' + Buffer.from([255,216,255,224]).toString('base64');
  const webp = 'data:image/webp;base64,' + Buffer.from('RIFF1234WEBP').toString('base64');
  assert.equal(first(update(jpg)).photo, jpg); assert.equal(first(update(webp)).photo, webp);
});

test('cycle drawing exhausts the pool without repeats and refills only on the next draw', () => {
  let s = smallState(5), seen = new Set();
  for (const expected of [2, 2, 1]) {
    s = applyAction(s, { type: 'draw', count: 2, mode: 'cycle' }, NOW);
    assert.equal(s.draw.lastIds.length, expected); assert.equal(s.draw.round, 1);
    for (const id of s.draw.lastIds) { assert.ok(!seen.has(id)); seen.add(id); }
  }
  assert.equal(seen.size, 5); assert.equal(s.draw.bag.length, 0);
  s = applyAction(s, { type: 'draw', count: 2, mode: 'cycle' }, NOW);
  assert.equal(s.draw.round, 2); assert.equal(s.draw.lastIds.length, 2); assert.equal(s.draw.bag.length, 3);
});

test('repeat drawing permits later repeats but keeps each individual draw unique', () => {
  let s = smallState(5);
  for (let i = 0; i < 30; i++) {
    s = applyAction(s, { type: 'draw', count: 5, mode: 'repeat' }, NOW);
    assert.equal(s.draw.lastIds.length, 5); assert.equal(new Set(s.draw.lastIds).size, 5); assert.deepEqual(s.draw.bag, []);
  }
  s = applyAction(s, { type: 'draw', count: 1, mode: 'cycle' }, NOW);
  assert.equal(s.draw.round, 1); assert.equal(s.draw.bag.length, 4);
});

test('draw reset and roster changes reset stale draw state', () => {
  let s = applyAction(smallState(3), { type: 'draw', count: 2 }, NOW);
  s = applyAction(s, { type: 'draw.reset' }, NOW);
  assert.match(s.draw.eventId,/^[a-f0-9-]{36}$/); assert.deepEqual(s.draw, { mode: 'cycle', bag: [], lastIds: [], round: 0, eventId:s.draw.eventId });
  s = applyAction(s, { type: 'draw', count: 2 }, NOW);
  const picked = s.draw.lastIds[0];
  s = applyAction(s, { type: 'student.remove', id: picked }, NOW);
  assert.equal(s.draw.lastIds.length, 0); assert.equal(s.draw.bag.length, 0);
  s = applyAction(s, { type: 'draw', count: 2 }, NOW);
  assert.ok(!s.draw.lastIds.includes(picked));
  s = applyAction(s, { type: 'student.add', name: '后来者' }, NOW);
  assert.equal(s.draw.lastIds.length, 0); assert.equal(s.draw.round, 0);
});

test('draw boundaries reject invalid counts and empty classes', () => {
  let s = smallState(1);
  for (const count of [0, -1, 2, 1.1, NaN, '1']) assert.throws(() => applyAction(s, { type: 'draw', count }, NOW));
  assert.throws(() => applyAction(s, { type: 'draw', mode: 'unknown' }, NOW));
  s = applyAction(s, { type: 'student.remove', id: first(s).id }, NOW);
  assert.throws(() => applyAction(s, { type: 'draw', count: 1 }, NOW));
});

test('timer countdown follows wall-clock even while windows are hidden or the system sleeps', () => {
  let s = applyAction(createInitialState(), { type: 'timer.set', seconds: 60 }, NOW);
  s = applyAction(s, { type: 'timer.start' }, NOW);
  assert.equal(s.timer.endsAt, NOW + 60000);
  assert.equal(remainingMs(s.timer, NOW + 12345), 47655);
  assert.equal(remainingMs(s.timer, NOW + 1000000), 0);
  const restored = validateState(clone(s));
  assert.equal(remainingMs(restored.timer, NOW + 20000), 40000);
});

test('timer pause/resume does not lose time and repeated start does not reset the deadline', () => {
  let s = applyAction(createInitialState(), { type: 'timer.set', seconds: 10 }, NOW);
  s = applyAction(s, { type: 'timer.start' }, NOW);
  s = applyAction(s, { type: 'timer.start' }, NOW + 2000);
  assert.equal(s.timer.endsAt, NOW + 10000);
  s = applyAction(s, { type: 'timer.pause' }, NOW + 3200);
  assert.equal(s.timer.remainingMs, 6800); assert.equal(s.timer.endsAt, null); assert.equal(s.timer.running, false);
  assert.equal(remainingMs(s.timer, NOW + 100000), 6800);
  s = applyAction(s, { type: 'timer.start' }, NOW + 20000);
  assert.equal(s.timer.endsAt, NOW + 26800);
  s = applyAction(s, { type: 'timer.pause' }, NOW + 26800);
  assert.equal(s.timer.remainingMs, 0);
  s = applyAction(s, { type: 'timer.start' }, NOW + 30000);
  assert.equal(s.timer.endsAt, NOW + 40000);
});

test('timer reset stops the timer, presets replace it, and values stay within supported bounds', () => {
  let s = applyAction(createInitialState(), { type: 'timer.start' }, NOW);
  s = applyAction(s, { type: 'timer.reset' }, NOW + 10000);
  assert.equal(s.timer.running, false); assert.equal(s.timer.remainingMs, s.timer.durationMs); assert.equal(s.timer.endsAt, null);
  s = applyAction(s, { type: 'timer.set', seconds: 10800 }, NOW);
  assert.equal(s.timer.durationMs, 10800000);
  for (const seconds of [0, -1, 10801, 1.5, '60', NaN, Infinity]) assert.throws(() => applyAction(s, { type: 'timer.set', seconds }, NOW));
});

test('clock rollback cannot display more than the configured timer duration', () => {
  let s = applyAction(createInitialState(), { type: 'timer.set', seconds: 10 }, NOW);
  s = applyAction(s, { type: 'timer.start' }, NOW);
  assert.equal(remainingMs(s.timer, NOW - 1000), 10000);
});

test('imports accept Chinese and English headers, trim text, and preserve independent duplicate names', () => {
  const s = createInitialState(), before = JSON.stringify(s);
  const imported = importRows([{ 姓名: ' 新同学 ', 小组: ' 火箭组 ' }, { name: '新同学', group: '' }], s);
  assert.equal(imported.students.length, 14);
  assert.equal(imported.students[12].name, '新同学'); assert.equal(imported.students[12].group, '火箭组');
  assert.equal(imported.students[13].group, '未分组'); assert.notEqual(imported.students[12].id, imported.students[13].id);
  assert.deepEqual(imported.students.slice(0, 12), s.students); assert.equal(JSON.stringify(s), before);
  assert.equal(imported.revision, s.revision + 1);
});

test('replace import explicitly clears old roster, score history and draw state while preserving settings/timer', () => {
  let s = score(createInitialState(), 3);
  s = applyAction(s, { type: 'draw', count: 2 }, NOW);
  s = applyAction(s, { type: 'timer.start' }, NOW);
  const result = importRows([{ name: '新的虚构学生' }], s, 'replace');
  assert.equal(result.students.length, 1); assert.equal(result.logs.length, 0);
  assert.match(result.draw.eventId,/^[a-f0-9-]{36}$/); assert.deepEqual(result.draw, { mode: 'cycle', bag: [], lastIds: [], round: 0, eventId:result.draw.eventId });
  assert.deepEqual(result.timer, s.timer); assert.deepEqual(result.settings, s.settings);
});

test('imports fail atomically for bad rows, missing headers, unsupported mode or overcapacity', () => {
  const s = freezeDeep(createInitialState()), original = JSON.stringify(s);
  for (const rows of [[], [{ surname: '空姓名' }], [{ name: '合法' }, { name: ' ' }], [null], [{ name: '=SUM(1,1)', group: 3 }]]) assert.throws(() => importRows(rows, s));
  assert.throws(() => importRows([{ name: '假名' }], s, 'merge'));
  assert.throws(() => importRows(Array.from({ length: 289 }, (_, i) => ({ name: `测试${i}` })), s));
  assert.equal(JSON.stringify(s), original);
});

test('300-student boundary is supported and the 301st student is rejected', () => {
  const s = smallState(300);
  assert.equal(s.students.length, 300);
  assert.throws(() => applyAction(s, { type: 'student.add', name: '超额' }, NOW));
  assert.throws(() => importRows([{ name: '超额' }], s));
  const scored = score(s, 100, s.students.map(v => v.id));
  assert.equal(scored.logs[0].changes.length, 300);
  const result = applyAction(scored, { type: 'undo', logId: scored.logs[0].id }, NOW);
  assert.ok(result.students.every(v => v.score === 0 && v.growth === 0));
});

test('backup validation rejects malformed shapes, wrong version and duplicate IDs', () => {
  for (const bad of [null, [], 'bad', {}, { version: 2 }, new Date()]) assert.throws(() => validateState(bad));
  for (const mutate of [s => { s.version = 3; }, s => { s.revision = -1; }, s => { s.students = null; }, s => { s.students[1].id = s.students[0].id; }, s => { s.students[0].id = '" onclick="bad'; }, s => { s.students[0].score = '3'; }, s => { s.students[0].growth = -1; }, s => { s.settings = null; }, s => { s.logs = {}; }]) {
    const s = createInitialState(); mutate(s); assert.throws(() => validateState(s));
  }
});

test('backup validation rejects malformed log arithmetic, duplicates, missing fields and invalid rollback flags', () => {
  const base = score(createInitialState(), 5);
  for (const mutate of [s => { s.logs[0].changes[0].afterScore = 99; }, s => { s.logs[0].changes[0].afterGrowth = 1; }, s => { s.logs[0].changes.push(clone(s.logs[0].changes[0])); }, s => { s.logs.push(clone(s.logs[0])); }, s => { s.logs[0].undone = 'false'; }, s => { s.logs[0].changes = []; }, s => { s.logs[0].timestamp = -1; }, s => { delete s.logs[0].changes[0].beforeScore; }]) {
    const s = clone(base); mutate(s); assert.throws(() => validateState(s));
  }
});

test('backup validation rejects unsafe draw and inconsistent timer state', () => {
  for (const mutate of [s => { s.draw.mode = 'bad'; }, s => { s.draw.bag = ['missing']; }, s => { s.draw.lastIds = [first(s).id, first(s).id]; }, s => { s.draw.bag = [first(s).id]; s.draw.lastIds = [first(s).id]; }, s => { s.draw.mode = 'repeat'; s.draw.bag = [first(s).id]; }, s => { s.timer.endsAt = NOW; }, s => { s.timer.running = true; s.timer.endsAt = null; }, s => { s.timer.durationMs = 0; }, s => { s.timer.remainingMs = 99999999; }, s => { s.timer.running = 'false'; }]) {
    const s = createInitialState(); mutate(s); assert.throws(() => validateState(s));
  }
});

test('validation strips unknown prototype-related keys rather than assigning them', () => {
  const s = createInitialState(), dangerous = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"polluted":true}}');
  const clean = validateState({ ...s, ...dangerous });
  Object.assign(s, dangerous);
  assert.throws(() => validateState(s), /格式无效/);
  assert.equal({}.polluted, undefined); assert.equal(Object.hasOwn(clean, '__proto__'), false); assert.equal(Object.hasOwn(clean, 'constructor'), false);
});

test('score and growth overflow are rejected without changing the supplied state', () => {
  const s = createInitialState(); first(s).score = 1_000_000_000; first(s).growth = 1_000_000_000;
  const original = JSON.stringify(s); assert.throws(() => score(s, 1)); assert.equal(JSON.stringify(s), original);
  first(s).score = -1_000_000_000;
  assert.throws(() => score(s, -1));
});

test('unknown actions and invalid timestamps fail explicitly', () => {
  const s = createInitialState();
  for (const action of [null, [], {}, { type: 'unknown' }]) assert.throws(() => applyAction(s, action, NOW));
  assert.throws(() => applyAction(s, { type: 'timer.start' }, -1));
  assert.throws(() => applyAction(s, { type: 'timer.start' }, Infinity));
});
