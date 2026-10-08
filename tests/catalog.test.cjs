'use strict';
// Independent v1.2 contract tests. Fixtures are entirely synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const PetArt = require('../src/pet-art.js');
const { createInitialState, validateState, applyAction, petLevel, importRows } = require('../src/core.cjs');
const { saveAtomic } = require('../src/io.cjs');
const { legacyState, legacyJSON } = require('./pet-fixtures.cjs');
const CLASSIC = ['owl', 'fox', 'bunny', 'cat', 'penguin', 'panda', 'bear', 'dog', 'deer', 'squirrel', 'hedgehog', 'raccoon', 'koala', 'elephant', 'lion', 'tiger', 'dragon', 'unicorn', 'otter', 'seal'];
const ADVENTURE = ['robot','rover','mechcrab','mechbeetle','mechdragonfly','rex','raptor','triceratops','stegosaurus','ankylosaurus','pteranodon','mammoth','rhino','gorilla','wolf','boar','eagle','shark','orca','phoenix'];
const EXPECTED = [...CLASSIC,...ADVENTURE];
const clone = x => JSON.parse(JSON.stringify(x));
const act = (s, a) => applyAction(s, a, 2_000_000);
const freeze = x => { Object.freeze(x); for (const v of Object.values(x)) if (v && typeof v === 'object') freeze(v); return x; };
const v11 = () => ({ ...legacyState(), settings: { className: '纯合成1.1兼容班', petStep: 5, petFocusId: 's_legacy_bunny' } });
function fixture(count = EXPECTED.length) {
  const s = v11();
  s.students = Array.from({ length: count }, (_, i) => ({ id: 's_catalog_' + i, name: '纯合成图鉴学生' + i, group: '纯合成组' + (i % 10), score: i - 10, growth: i * 5, pet: EXPECTED[i % EXPECTED.length], photo: i === 0 ? s.students[0].photo : '' }));
  s.logs = []; s.draw = { mode: 'cycle', bag: [], lastIds: [], round: 0 }; s.settings.petFocusId = s.students.at(-1).id;
  return s;
}
// Include only shape-bearing SVG nodes and actual coordinates/transforms. Strip ALL
// color, text, class, data and accessibility metadata, so recolors cannot pass.
function geometry(svg) {
  const attrs = /\b(d|points|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|transform)="([^"]*)"/g;
  return [...svg.matchAll(/<(g|path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*)>/g)].map(m => {
    const a = [...m[2].matchAll(attrs)].map(x => x[1] + '=' + x[2]).sort();
    return m[1] + '(' + a.join(';') + ')';
  }).join('|');
}

test('Catalog contract: forty named species preserve the four original IDs', () => {
  assert.deepEqual(Object.keys(PetArt.names), EXPECTED);
  assert.equal(new Set(Object.values(PetArt.names)).size, EXPECTED.length);
  assert.ok(Object.values(PetArt.names).every(n => typeof n === 'string' && n.trim().length >= 2));
  assert.equal(PetArt.stages.length, 7);
  assert.ok(Object.isFrozen(PetArt.names), 'authoritative catalog must not be mutable');
});

test('Catalog artwork: all 280 SVGs contain finite, nonempty geometries', () => {
  for (const id of EXPECTED) for (let stage = 1; stage <= 7; stage++) {
    const svg = PetArt.render(id, stage);
    assert.match(svg, /^<svg\b/); assert.match(svg, /<\/svg>$/);
    assert.match(svg, new RegExp('data-stage="' + stage + '"'));
    assert.match(svg, new RegExp('data-level="' + stage + '"'));
    assert.ok(geometry(svg).length > 300, id + ' stage ' + stage + ' must contain real art');
    assert.doesNotMatch(svg, /\b(?:NaN|Infinity|undefined|null)\b/);
  }
});

test('Catalog artwork: forty species remain geometrically distinct at EVERY stage after stripping colors and labels', () => {
  for (let stage = 1; stage <= 7; stage++) {
    const shapes = EXPECTED.map(id => geometry(PetArt.render(id, stage)));
    assert.equal(new Set(shapes).size, EXPECTED.length, 'stage ' + stage + ' must have forty genuine silhouettes/features');
  }
});

test('Catalog artwork: seven forms for EVERY species and 280 overall geometries are distinct', () => {
  const all = [];
  for (const id of EXPECTED) {
    const shapes = Array.from({ length: 7 }, (_, i) => geometry(PetArt.render(id, i + 1)));
    assert.equal(new Set(shapes).size, 7, id + ' needs seven geometric forms'); all.push(...shapes);
  }
  assert.equal(new Set(all).size, EXPECTED.length * 7);
});

test('Catalog artwork compatibility: all 28 original v1.1 SVG outputs remain byte-identical', () => {
  const baseline = require('./legacy-pet-art-hashes.json');
  assert.equal(Object.keys(baseline).length, 28);
  for (const [key, expectedHash] of Object.entries(baseline)) {
    const [id, level] = key.split('/');
    assert.equal(crypto.createHash('sha256').update(PetArt.render(id, Number(level))).digest('hex'), expectedHash, key);
  }
});

test('Catalog artwork: stage cap keeps the full real level for every species', () => {
  for (const id of EXPECTED) for (const level of [8, 51, 200_000_001]) {
    const svg = PetArt.render(id, level);
    assert.match(svg, /data-stage="7"/); assert.match(svg, new RegExp('data-level="' + level + '"'));
    assert.match(svg, new RegExp('LV' + level)); assert.equal(geometry(svg), geometry(PetArt.render(id, 7)));
  }
});

test('Catalog artwork: all forms are offline, script-free, ID-free and injection-resistant', () => {
  for (const id of EXPECTED) for (let stage = 1; stage <= 7; stage++) {
    const svg = PetArt.render(id, stage, { animated: true });
    assert.doesNotMatch(svg, /<script|<image|<foreignObject|\s(?:href|src|id|on[a-z]+)=|url\(/i);
    assert.doesNotMatch(svg.replace('http://www.w3.org/2000/svg', ''), /https?:\/\//i);
  }
  for (const bad of ['__proto__', 'constructor', 'toString', 'missing', '<svg onload=alert(1)>']) {
    assert.equal(PetArt.render(bad, 1), PetArt.render('owl', 1));
  }
  const injected = PetArt.render('dragon', 1, { className: '\"><img src=x onerror=alert(1)>' });
  assert.doesNotMatch(injected, /<img/);
  assert.doesNotMatch(injected.replace(/class="[^"]*"/g, ''), /\sonerror=/);
});

test('Catalog validation: all forty IDs survive JSON serialization with version=1', () => {
  const input = freeze(fixture()); const actual = validateState(input);
  assert.deepEqual(actual, input); assert.equal(actual.version, 1);
  assert.deepEqual(validateState(clone(actual)), actual);
});

test('Catalog add: each species is accepted through the normal student.add action', () => {
  let s = createInitialState(); const before = clone(s.students);
  for (const pet of EXPECTED) { s = act(s, { type: 'student.add', name: '纯合成新增' + pet, group: '合成组', pet }); assert.equal(s.students.at(-1).pet, pet); }
  assert.deepEqual(s.students.slice(0, before.length), before);
  assert.deepEqual(s.students.slice(-EXPECTED.length).map(s => s.pet), EXPECTED);
  assert.deepEqual(validateState(clone(s)), s);
});

test('Catalog profile: cycling all forty pets retains identity, photo, scores, growth, rules and history', () => {
  let s = validateState(v11()); const original = clone(s), id = s.students[0].id;
  for (const pet of EXPECTED) {
    s = act(s, { type: 'student.update', id, pet });
    assert.deepEqual(s.students[0], { ...original.students[0], pet });
    assert.deepEqual(s.students.slice(1), original.students.slice(1));
    for (const key of ['settings', 'logs', 'timer', 'draw']) assert.deepEqual(s[key], original[key]);
  }
});

test('Catalog persistence: all forty selections survive an atomic save and fresh module reload', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-catalog-unit-'));
  try {
    const file = path.join(dir, 'classroom.json'), original = fixture(); saveAtomic(file, original);
    delete require.cache[require.resolve('../src/core.cjs')];
    const freshCore = require('../src/core.cjs');
    const reopened = freshCore.validateState(JSON.parse(fs.readFileSync(file, 'utf8')));
    assert.deepEqual(reopened, original); assert.deepEqual(reopened.students.map(x => x.pet), EXPECTED);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Catalog compatibility: pre-adventure twenty-species backup keeps every original ID, field and full growth', () => {
  const old = fixture(CLASSIC.length); old.students.forEach((student, index) => { student.pet = CLASSIC[index]; });
  const original = freeze(clone(old)), restored = validateState(clone(original));
  assert.deepEqual(restored, original); assert.deepEqual(restored.students.map(student => student.pet), CLASSIC);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-classic-backup-'));
  try { const file = path.join(dir, 'classic20.json'); saveAtomic(file, restored); assert.deepEqual(validateState(JSON.parse(fs.readFileSync(file))), original); }
  finally { fs.rmSync(dir, {recursive:true,force:true}); }
});

test('Catalog compatibility: handwritten v1.0 migrates with identical legacy fields and a twenty-point default', () => {
  const input = freeze(legacyState()), migrated = validateState(input), projection = clone(migrated);
  delete projection.settings.petStep; delete projection.settings.petFocusId;
  assert.deepEqual(projection, input); assert.equal(migrated.settings.petStep, 20);
  assert.equal(migrated.students[2].growth, 200); assert.equal(migrated.students[2].pet, 'bunny');
});

test('Catalog compatibility: handwritten v1.1 custom rules, focused pet and old audit records are unchanged', () => {
  const input = freeze(v11()); assert.deepEqual(validateState(input), input);
  assert.deepEqual(validateState(clone(validateState(input))), input);
});

test('Catalog compatibility: first v1.2 save retains byte-identical v1.0 or v1.1 recovery files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-catalog-legacy-'));
  try {
    for (const [name, bytes] of [['v10', legacyJSON()], ['v11', JSON.stringify(v11(), null, 2)]]) {
      const file = path.join(dir, name + '.json'); fs.writeFileSync(file, bytes);
      const previous = validateState(JSON.parse(bytes)); const next = act(previous, { type: 'student.update', id: previous.students[0].id, pet: 'dragon' });
      saveAtomic(file, next); assert.equal(fs.readFileSync(file + '.previous', 'utf8'), bytes);
      assert.deepEqual(validateState(JSON.parse(fs.readFileSync(file))), next);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Catalog backup: new species, local photo, focus, rules and audit history round-trip without schema change', () => {
  let s = validateState(fixture()); s = act(s, { type: 'score', ids: s.students.map(s => s.id), delta: 2, reason: '纯合成备份测试' });
  const restored = validateState(clone(s)); assert.deepEqual(restored, s); assert.equal(restored.version, 1);
  assert.equal(new Set(restored.students.map(s => s.pet)).size, EXPECTED.length);
});

test('Catalog unknown IDs: validation rejects new and prototype-bearing values without modifying caller data', () => {
  for (const invalid of ['not-a-species', '__proto__', 'constructor', 'toString', '', null, 7, '<script>']) {
    const s = fixture(); s.students[13].pet = invalid; const input = freeze(s), before = JSON.stringify(input);
    assert.throws(() => validateState(input)); assert.equal(JSON.stringify(input), before);
  }
});

test('Catalog unknown IDs: add and update actions fail atomically for every invalid species', () => {
  const input = freeze(validateState(fixture())), before = JSON.stringify(input);
  for (const invalid of ['not-a-species', '__proto__', 'constructor', 'toString', '<script>', null, 42]) {
    assert.throws(() => act(input, { type: 'student.update', id: input.students[0].id, pet: invalid }));
    if (invalid !== null) assert.throws(() => act(input, { type: 'student.add', name: '纯合成非法输入', group: '合成组', pet: invalid }));
  }
  assert.equal(JSON.stringify(input), before);
});

test('Catalog add: omitted or null pet retains the existing owl default without weakening update validation', () => {
  const original = validateState(fixture());
  for (const pet of [undefined, null]) assert.equal(act(original, { type: 'student.add', name: '纯合成默认伙伴', group: '合成组', pet }).students.at(-1).pet, 'owl');
});

test('Catalog scoring: forty species cross the threshold together and undo restores every student', () => {
  const input = fixture(); input.students.forEach(s => { s.score = 4; s.growth = 4; });
  const original = validateState(input), awarded = act(original, { type: 'score', ids: original.students.map(s => s.id), delta: 1, reason: '纯合成全物种升级' });
  assert.equal(awarded.logs.length, 1); assert.equal(awarded.logs[0].changes.length, EXPECTED.length);
  for (const [i, s] of awarded.students.entries()) { assert.equal(s.pet, EXPECTED[i]); assert.equal(s.growth, 5); assert.equal(petLevel(s, 5).level, 2); }
  assert.deepEqual(act(awarded, { type: 'undo', logId: awarded.logs[0].id }).students, original.students);
});

test('Catalog scoring: negative points never remove growth and changing the pet never resets earned levels', () => {
  let s = validateState(fixture()); const before = clone(s.students);
  s = act(s, { type: 'score', ids: s.students.map(s => s.id), delta: -2, reason: '纯合成扣分' });
  s.students.forEach((student, i) => { assert.equal(student.growth, before[i].growth); assert.equal(student.score, before[i].score - 2); });
  for (let i = 0; i < EXPECTED.length; i++) s = act(s, { type: 'student.update', id: s.students[i].id, pet: EXPECTED[(i + 1) % EXPECTED.length] });
  s.students.forEach((student, i) => assert.equal(student.growth, before[i].growth));
});

test('Catalog scaling: 300 mixed-species students save, award and undo without losing any species or identity', () => {
  const original = validateState(fixture(300));
  const awarded = act(original, { type: 'score', ids: original.students.map(s => s.id), delta: 5, reason: '纯合成300人升级' });
  assert.equal(awarded.logs.at(-1).changes.length, 300); assert.equal(new Set(awarded.students.map(s => s.pet)).size, EXPECTED.length);
  assert.deepEqual(validateState(clone(awarded)), awarded);
  assert.deepEqual(act(awarded, { type: 'undo', logId: awarded.logs.at(-1).id }).students, original.students);
});

test('Catalog import: replace and append assign only supported catalog IDs while preserving existing pets', () => {
  const original = validateState(fixture());
  const appended = importRows([{ name: '纯合成追加', group: '合成组' }], original, 'append');
  assert.deepEqual(appended.students.slice(0, EXPECTED.length), original.students); assert.ok(EXPECTED.includes(appended.students.at(-1).pet));
  const replaced = importRows(Array.from({ length: 300 }, (_, i) => ({ name: '纯合成导入' + i, group: '合成组' })), original, 'replace');
  assert.ok(replaced.students.every(s => EXPECTED.includes(s.pet))); assert.equal(replaced.students.length, 300);
});

test('Catalog rules: thresholds 1/5/20/100 preserve historic scores and full growth for all forty species', () => {
  const original = validateState(fixture());
  for (const step of [1, 5, 20, 100]) {
    const changed = act(original, { type: 'pet.rules', step }); assert.deepEqual(changed.students, original.students);
    for (const s of changed.students) assert.equal(petLevel(s, step).level, Math.floor(s.growth / step) + 1);
  }
});
