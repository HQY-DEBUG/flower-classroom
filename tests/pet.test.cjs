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
const legacyProjection = value => { const copy = clone(value); delete copy.settings.petStep; delete copy.settings.petFocusId; delete copy.petProgression; copy.version=1; return copy; };

test('Pet compatibility: handwritten v1.0 data survives the additive global progression upgrade', () => {
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

test('Pet compatibility: old step metadata is retained while current score uses the global progression', () => {
  const s = createInitialState(); assert.equal(s.version,2); assert.equal(s.settings.petStep,20); assert.equal(s.settings.petFocusId,'');
  assert.deepEqual(s.petProgression,{version:1,costs:[5,10,15,20,20,20,20],repeatCost:20});
  assert.deepEqual(petLevel({score:25,growth:200}),{level:2,current:10,needed:15});
});

test('Pet progression: cumulative costs and repeated later costs have exact boundaries', () => {
  for (const costs of [[5,10,15,20,20,20,20],[5,5,5,5,5,5,5]]) {
    const progression={version:1,costs,repeatCost:20}; let boundary=0;
    costs.forEach((cost,i)=>{boundary+=cost;assert.equal(petLevel({score:boundary-1},progression).level,i);assert.deepEqual(petLevel({score:boundary},progression),{level:i+1,current:0,needed:costs[i+1]||20});});
    assert.equal(petLevel({score:boundary+20},progression).level,8);
  }
});

test('Pet progression: minimum costs and maximum signed score remain finite and exact', () => {
  const p={version:1,costs:[1,1,1,1,1,1,1],repeatCost:1};
  assert.deepEqual(petLevel({score:1_000_000_000,growth:0},p),{level:1_000_000_000,current:0,needed:1});
  assert.deepEqual(petLevel({score:-1_000_000_000,growth:999},p),{level:0,current:0,needed:1});
});

test('Pet progression: invalid scores and retired numeric step arguments reject', () => {
  for (const score of [0.5,NaN,Infinity,'20',1_000_000_001,-1_000_000_001,undefined]) assert.throws(()=>petLevel({score}));
  for (const step of [0,-1,5,20,101,2.5,NaN,Infinity,'5',null]) assert.throws(()=>petLevel({score:20},step));
});

test('Pet rules: global progression editing preserves every historical field and selection', () => {
  let s=act(validateState(legacyState()),{type:'pet.focus',id:'s_legacy_owl'});
  for (const repeatCost of [5,1,100,20]) {
    const before=clone(s);s=act(s,{type:'petProgression.update',petProgression:{...s.petProgression,repeatCost}});
    assert.equal(s.revision,before.revision+1);for(const key of ['students','settings','logs','draw','timer'])assert.deepEqual(s[key],before[key]);
  }
  const bytes=JSON.stringify(s);assert.throws(()=>act(s,{type:'pet.rules',step:5}),/停用|统一/);assert.equal(JSON.stringify(s),bytes);
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
  let s = validateState({...legacyState(),settings:{...legacyState().settings,petStep:5}});
  const focused = first(s).id; s = act(s, { type: 'pet.focus', id: focused });
  const appended = importRows([{ name: '纯合成新增伙伴', group: '纯合成组' }], s, 'append');
  assert.equal(appended.settings.petFocusId, focused); assert.equal(appended.settings.petStep, 5);
  assert.deepEqual(appended.students.slice(0, s.students.length), s.students);
  const replaced = importRows([{ name: '纯合成替换伙伴', group: '纯合成组' }], appended, 'replace');
  assert.equal(replaced.settings.petFocusId, ''); assert.equal(replaced.settings.petStep, 5);
  assert.equal(first(replaced).growth, 0); assert.equal(first(replaced).score, 0);
  assert.deepEqual(replaced.logs, []);
});

test('Pet scoring: positive and negative awards change current levels and freeze saved legacy growth', () => {
  let s=createInitialState();s=award(s,7);assert.equal(first(s).score,7);assert.equal(first(s).growth,0);
  assert.deepEqual(petLevel(first(s)),{level:1,current:2,needed:10});
  s=award(s,-10);assert.equal(first(s).score,-3);assert.equal(first(s).growth,0);assert.equal(petLevel(first(s)).level,0);
  assert.ok(s.logs.every(l=>l.growthDelta===0 && l.changes.every(c=>c.beforeGrowth===c.afterGrowth)));
});

test('Pet scoring: crossing a score boundary and undoing returns to the exact previous level', () => {
  const s=validateState(legacyState());s.students[0].score=29;const plus=award(s,1);
  assert.equal(petLevel(first(s)).level,2);assert.equal(petLevel(first(plus)).level,3);
  const undone=act(plus,{type:'undo',logId:plus.logs.at(-1).id});assert.deepEqual(undone.students,s.students);assert.equal(petLevel(first(undone)).level,2);assert.equal(undone.logs.at(-1).undone,true);
});

test('Pet scoring: a large score award spans stages while archived growth stays unchanged', () => {
  let s=createInitialState();s=award(s,100);assert.equal(first(s).growth,0);assert.equal(petLevel(first(s)).level,6);
  assert.equal(s.logs.length,1);assert.equal(s.logs[0].changes[0].afterGrowth,0);assert.equal(s.logs[0].growthDelta,0);
  s=act(s,{type:'undo',logId:s.logs[0].id});assert.equal(first(s).score,0);assert.equal(petLevel(first(s)).level,0);
});

test('Pet undo: non-sequential score reversal preserves later scores and all historical growth', () => {
  let s=createInitialState();s=award(s,25);const a=s.logs.at(-1).id;s=award(s,7);const b=s.logs.at(-1).id;s=award(s,-3);const c=s.logs.at(-1).id;
  s=act(s,{type:'undo',logId:a});assert.equal(first(s).score,4);assert.equal(first(s).growth,0);assert.equal(petLevel(first(s)).level,0);
  s=act(s,{type:'undo',logId:c});assert.equal(first(s).score,7);assert.equal(petLevel(first(s)).level,1);
  s=act(s,{type:'undo',logId:b});assert.equal(first(s).score,0);assert.equal(first(s).growth,0);
  assert.throws(()=>act(s,{type:'undo',logId:a}),/撤销/);
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
  assert.equal(after.students[0].growth, 19); assert.equal(after.students[1].growth, 27);
  const undone = act(after, { type: 'undo', logId: after.logs.at(-1).id });
  assert.deepEqual(undone.students, before.students);
});

test('Pet profile: switching every supported pet retains identity, score, growth, local image and rules', () => {
  let s = validateState({...legacyState(),settings:{...legacyState().settings,petStep:5}});
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
  let s = validateState({...legacyState(),settings:{...legacyState().settings,petStep:5}});
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
    const next = award(loaded, 1); saveAtomic(file, next);
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
  s = act(s, { type:'petProgression.update',petProgression:s.petProgression });
  s = act(s, { type: 'pet.focus', id: s.students[299].id });
  s = award(s, 5, s.students.map(v => v.id));
  assert.equal(s.students.length, 300); assert.equal(new Set(s.students.map(v => v.id)).size, 300);
  assert.ok(s.students.every(v => v.growth === 0 && petLevel(v, s.petProgression).level === 1));
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
