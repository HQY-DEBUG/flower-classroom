'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createInitialState, validateState, applyAction, petLevel, importRows } = require('../src/core.cjs');
const { saveAtomic } = require('../src/io.cjs');
const { legacyState, legacyJSON, SYNTHETIC_PNG } = require('./pet-fixtures.cjs');
const NOW = 2_000_000;
const clone = value => JSON.parse(JSON.stringify(value));
const frozen = value => { Object.freeze(value); for (const v of Object.values(value)) if (v && typeof v === 'object') frozen(v); return value; };
const act = (s, action) => applyAction(s, action, NOW);
const first = s => s.students[0];
const award = (s, delta, ids = [first(s).id]) => act(s, { type: 'score', ids, delta, reason: '纯合成宠物兼容测试' });
const legacyProjection = value => { const copy = clone(value); delete copy.settings.petStep; delete copy.settings.petFocusId; return copy; };

test('Pet compatibility: handwritten v1.0 save retains every original field and receives only safe pet defaults', () => {
  const input = frozen(legacyState()), bytes = JSON.stringify(input);
  const migrated = validateState(input);
  assert.deepEqual(legacyProjection(migrated), input);
  assert.equal(migrated.settings.petStep, 20);
  assert.equal(migrated.settings.petFocusId, '');
  assert.equal(JSON.stringify(input), bytes);
  assert.equal(migrated.students[0].photo, SYNTHETIC_PNG);
  assert.equal(migrated.students[2].growth, 200, 'legacy high growth must not be clamped to stage seven');
  assert.equal(migrated.logs[2].changes[0].afterGrowth, 27, 'old negative awards keep their old arithmetic');
  assert.equal(migrated.logs[3].undone, true);
});

test('Pet compatibility: migrating and serializing an old save is deterministic and idempotent', () => {
  const once = validateState(JSON.parse(legacyJSON()));
  assert.deepEqual(validateState(once), once);
  assert.deepEqual(validateState(clone(once)), once);
  assert.notEqual(validateState(once).settings, once.settings);
});

test('Pet compatibility: default class keeps the original twenty-point progression', () => {
  const s = createInitialState();
  assert.equal(s.version, 1);
  assert.equal(s.settings.petStep, 20);
  assert.equal(s.settings.petFocusId, '');
  assert.deepEqual(petLevel({ growth: 25 }), { level: 2, current: 5, needed: 20 });
});

test('Pet progression: all seven stage boundaries are exact with step five and twenty', () => {
  for (const step of [5, 20]) {
    for (let level = 1; level <= 7; level++) {
      const boundary = (level - 1) * step;
      assert.deepEqual(petLevel({ growth: boundary }, step), { level, current: 0, needed: step });
      assert.deepEqual(petLevel({ growth: boundary + step - 1 }, step), { level, current: step - 1, needed: step });
      if (boundary) assert.equal(petLevel({ growth: boundary - 1 }, step).level, level - 1);
    }
    assert.equal(petLevel({ growth: step * 7 }, step).level, 8, 'levels remain unbounded after the seventh visual form');
  }
});

test('Pet progression: minimum/maximum step and maximum saved growth remain finite and exact', () => {
  assert.deepEqual(petLevel({ growth: 6 }, 1), { level: 7, current: 0, needed: 1 });
  assert.deepEqual(petLevel({ growth: 699 }, 100), { level: 7, current: 99, needed: 100 });
  assert.deepEqual(petLevel({ growth: 1_000_000_000 }, 5), { level: 200_000_001, current: 0, needed: 5 });
});

test('Pet progression: invalid growth and step inputs cannot produce misleading levels', () => {
  for (const growth of [-1, 0.5, NaN, Infinity, '20', 1_000_000_001]) assert.throws(() => petLevel({ growth }, 5));
  for (const step of [0, -1, 101, 2.5, NaN, Infinity, '5', null]) assert.throws(() => petLevel({ growth: 20 }, step));
});

test('Pet rules: changing thresholds preserves student scores, growth, history, photos and selections', () => {
  let s = validateState(legacyState());
  s = act(s, { type: 'pet.focus', id: first(s).id });
  for (const step of [5, 1, 100, 20]) {
    const before = clone(s);
    s = act(s, { type: 'pet.rules', step });
    assert.equal(s.settings.petStep, step);
    assert.equal(s.settings.petFocusId, first(s).id);
    assert.equal(s.revision, before.revision + 1);
    assert.deepEqual(s.students, before.students);
    assert.deepEqual(s.logs, before.logs);
    assert.deepEqual(s.draw, before.draw);
    assert.deepEqual(s.timer, before.timer);
    assert.equal(s.settings.className, before.settings.className);
  }
});

test('Pet rules: invalid threshold actions fail atomically', () => {
  const s = frozen(validateState(legacyState())), before = JSON.stringify(s);
  for (const step of [0, -1, 101, 0.1, NaN, Infinity, '5', null, undefined]) assert.throws(() => act(s, { type: 'pet.rules', step }));
  assert.equal(JSON.stringify(s), before);
});

test('Pet focus: choosing a floating pet changes only focus and revision', () => {
  const s = frozen(validateState(legacyState()));
  const id = s.students[2].id, next = act(s, { type: 'pet.focus', id });
  assert.equal(next.settings.petFocusId, id);
  assert.equal(next.revision, s.revision + 1);
  const normalized = clone(next); normalized.settings.petFocusId = ''; normalized.revision = s.revision;
  assert.deepEqual(normalized, s);
  assert.deepEqual(validateState(clone(next)), next);
});

test('Pet focus: malformed or nonexistent students are rejected atomically', () => {
  const s = frozen(validateState(legacyState())), before = JSON.stringify(s);
  for (const id of ['missing', '<script>', null, undefined, [], 42]) assert.throws(() => act(s, { type: 'pet.focus', id }));
  assert.equal(JSON.stringify(s), before);
});

test('Pet focus: removing another student preserves focus and removing the focused one clears it', () => {
  let s = validateState(legacyState()); const focused = first(s).id;
  s = act(s, { type: 'pet.focus', id: focused });
  s = act(s, { type: 'student.remove', id: s.students.at(-1).id });
  assert.equal(s.settings.petFocusId, focused);
  s = act(s, { type: 'student.remove', id: focused });
  assert.equal(s.settings.petFocusId, '');
  assert.deepEqual(validateState(s), s);
});

test('Pet import: appending retains focus and rules; replacing clears obsolete focus while preserving rules', () => {
  let s = act(validateState(legacyState()), { type: 'pet.rules', step: 5 });
  const focused = first(s).id; s = act(s, { type: 'pet.focus', id: focused });
  const appended = importRows([{ name: '纯合成新增伙伴', group: '纯合成组' }], s, 'append');
  assert.equal(appended.settings.petFocusId, focused); assert.equal(appended.settings.petStep, 5);
  assert.deepEqual(appended.students.slice(0, s.students.length), s.students);
  const replaced = importRows([{ name: '纯合成替换伙伴', group: '纯合成组' }], appended, 'replace');
  assert.equal(replaced.settings.petFocusId, ''); assert.equal(replaced.settings.petStep, 5);
  assert.equal(first(replaced).growth, 0); assert.equal(first(replaced).score, 0);
  assert.deepEqual(replaced.logs, []);
});

test('Pet scoring: positive and negative awards retain the v1.0 arithmetic under custom rules', () => {
  let s = act(createInitialState(), { type: 'pet.rules', step: 5 });
  s = award(s, 7); assert.equal(first(s).score, 7); assert.equal(first(s).growth, 7);
  assert.deepEqual(petLevel(first(s), s.settings.petStep), { level: 2, current: 2, needed: 5 });
  s = award(s, -10); assert.equal(first(s).score, -3); assert.equal(first(s).growth, 7);
  assert.equal(s.logs.at(-1).changes[0].beforeGrowth, s.logs.at(-1).changes[0].afterGrowth);
});

test('Pet scoring: crossing a boundary and undoing it returns exactly to the previous level', () => {
  const s = validateState(legacyState()), plus = award(s, 1);
  assert.equal(petLevel(first(s)).level, 1); assert.equal(petLevel(first(plus)).level, 2);
  const undone = act(plus, { type: 'undo', logId: plus.logs.at(-1).id });
  assert.deepEqual(undone.students, s.students);
  assert.equal(petLevel(first(undone)).level, 1);
  assert.equal(undone.logs.at(-1).undone, true);
});

test('Pet scoring: one large award can span stages without capping saved growth', () => {
  let s = act(createInitialState(), { type: 'pet.rules', step: 5 });
  s = award(s, 100);
  assert.equal(first(s).growth, 100); assert.equal(petLevel(first(s), 5).level, 21);
  assert.equal(s.logs.length, 1); assert.equal(s.logs[0].changes[0].afterGrowth, 100);
  s = act(s, { type: 'undo', logId: s.logs[0].id });
  assert.equal(first(s).growth, 0); assert.equal(petLevel(first(s), 5).level, 1);
});

test('Pet undo: non-sequential mixed award reversal retains later growth and custom rules', () => {
  let s = act(createInitialState(), { type: 'pet.rules', step: 5 });
  s = award(s, 25); const a = s.logs.at(-1).id;
  s = award(s, 7); const b = s.logs.at(-1).id;
  s = award(s, -3); const c = s.logs.at(-1).id;
  s = act(s, { type: 'undo', logId: a });
  assert.equal(first(s).score, 4); assert.equal(first(s).growth, 7); assert.equal(petLevel(first(s), 5).level, 2);
  s = act(s, { type: 'undo', logId: c }); assert.equal(first(s).score, 7); assert.equal(first(s).growth, 7);
  s = act(s, { type: 'undo', logId: b }); assert.equal(first(s).score, 0); assert.equal(first(s).growth, 0);
  assert.equal(s.settings.petStep, 5);
  assert.throws(() => act(s, { type: 'undo', logId: a }), /撤销/);
});

test('Pet legacy undo: undoing a historic negative award never adds or removes growth', () => {
  const s = validateState(legacyState()), next = act(s, { type: 'undo', logId: 'l_legacy_penalty' });
  assert.equal(next.students[1].score, 27); assert.equal(next.students[1].growth, 27);
  assert.equal(next.logs[2].undone, true);
  assert.throws(() => act(s, { type: 'undo', logId: 'l_legacy_undone' }), /撤销/);
});

test('Pet batch undo: all selected pets advance once and reverse together without affecting classmates', () => {
  const before = validateState(legacyState()), ids = before.students.slice(0, 2).map(s => s.id);
  const after = award(before, 5, ids);
  assert.equal(after.logs.length, before.logs.length + 1);
  assert.equal(after.logs.at(-1).changes.length, 2);
  assert.deepEqual(after.students.slice(2), before.students.slice(2));
  assert.equal(after.students[0].growth, 24); assert.equal(after.students[1].growth, 32);
  const undone = act(after, { type: 'undo', logId: after.logs.at(-1).id });
  assert.deepEqual(undone.students, before.students);
});

test('Pet profile: switching every supported pet retains identity, score, growth, local image and rules', () => {
  let s = act(validateState(legacyState()), { type: 'pet.rules', step: 5 });
  const before = clone(first(s));
  for (const pet of ['fox', 'bunny', 'cat', 'owl']) {
    s = act(s, { type: 'student.update', id: before.id, pet });
    assert.deepEqual(first(s), { ...before, pet }); assert.equal(s.settings.petStep, 5);
  }
  const bytes = JSON.stringify(s);
  assert.throws(() => act(s, { type: 'student.update', id: before.id, pet: '__proto__' }));
  assert.equal(JSON.stringify(s), bytes);
});

test('Pet backup: new rules, focused companion, old photos, scores and audit records round-trip together', () => {
  let s = act(validateState(legacyState()), { type: 'pet.rules', step: 5 });
  s = act(s, { type: 'pet.focus', id: s.students[1].id });
  s = award(s, 2);
  assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))), s);
});

test('Pet persistence: first new write preserves byte-identical legacy JSON as the previous save', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-pet-legacy-')), file = path.join(dir, 'classroom.json');
  try {
    const bytes = legacyJSON(); fs.writeFileSync(file, bytes);
    const loaded = validateState(JSON.parse(fs.readFileSync(file, 'utf8')));
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    const next = act(loaded, { type: 'pet.rules', step: 5 }); saveAtomic(file, next);
    assert.equal(fs.readFileSync(file + '.previous', 'utf8'), bytes);
    assert.deepEqual(validateState(JSON.parse(fs.readFileSync(file, 'utf8'))), next);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Pet validation: corrupt new rules reject without weakening the historic log arithmetic check', () => {
  for (const step of [0, 101, '5', null, 5.5]) { const s = legacyState(); s.settings.petStep = step; assert.throws(() => validateState(s)); }
  const malformed = legacyState(); malformed.logs[2].changes[0].afterGrowth = 0;
  assert.throws(() => validateState(malformed), /前后数值/);
});

test('Pet scaling: maximum supported roster preserves every independent companion through a batch award', () => {
  let s = importRows(Array.from({ length: 300 }, (_, i) => ({ name: `纯合成宠物${i}`, group: `合成组${i % 10}` })), createInitialState(), 'replace');
  s = act(s, { type: 'pet.rules', step: 5 });
  s = act(s, { type: 'pet.focus', id: s.students[299].id });
  s = award(s, 5, s.students.map(v => v.id));
  assert.equal(s.students.length, 300); assert.equal(new Set(s.students.map(v => v.id)).size, 300);
  assert.ok(s.students.every(v => v.growth === 5 && petLevel(v, s.settings.petStep).level === 2));
  assert.equal(s.logs.at(-1).changes.length, 300); assert.equal(s.settings.petFocusId, s.students[299].id);
});

test('Pet artwork: all four species have seven distinct geometric forms, capped visuals and truthful high-level labels', () => {
  const art = require('../src/pet-art.js');
  assert.equal(art.stages.length, 7);
  for (const species of ['owl', 'fox', 'bunny', 'cat']) {
    const forms = Array.from({ length: 7 }, (_, i) => art.render(species, i + 1));
    const geometry = forms.map(svg => svg.replace(/(?:class|aria-label|data-[\w-]+)="[^"]*"|<title>.*?<\/title>/g, ''));
    assert.equal(new Set(geometry).size, 7, species + ' needs seven genuinely different SVG geometries');
    forms.forEach((svg, i) => { assert.match(svg, new RegExp(`data-stage="${i + 1}"`)); assert.match(svg, new RegExp(`data-level="${i + 1}"`)); });
    const high = art.render(species, 51); assert.match(high, /data-stage="7"/); assert.match(high, /data-level="51"/);
    assert.match(high, /LV51/);
  }
});

test('Pet artwork: renderers remain offline, ID-free and reject markup-bearing type/level inputs', () => {
  const art = require('../src/pet-art.js');
  for (const species of Object.keys(art.names)) for (let level = 1; level <= 7; level++) {
    const svg = art.render(species, level, { animated: true });
    assert.ok(!/<script|<image|<foreignObject|\s(?:href|src|id)=|url\(|onload=/i.test(svg));
    assert.ok(!/https?:\/\//i.test(svg.replace('http://www.w3.org/2000/svg', '')));
  }
  assert.equal(art.render('<script>alert(1)</script>', '<img src=x>'), art.render('owl', 1));
  const injected = art.render('cat', 1, { className: '\"><script>alert(1)</script>' });
  assert.ok(!injected.includes('<script>')); assert.ok(injected.includes('&quot;&gt;&lt;script&gt;'));
});

test('Pet focus validation clears a syntactically valid but obsolete saved student id', () => {
  const input = legacyState(); input.settings.petFocusId = 's_deleted_long_ago';
  const next = validateState(input); assert.equal(next.settings.petFocusId, '');
  assert.deepEqual(next.students, input.students); assert.deepEqual(next.logs, input.logs);
});
