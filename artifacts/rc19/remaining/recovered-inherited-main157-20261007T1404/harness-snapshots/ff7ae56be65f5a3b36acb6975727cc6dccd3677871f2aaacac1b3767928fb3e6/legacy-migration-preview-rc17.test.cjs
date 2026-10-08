'use strict';
// Synthetic ordinary-save interactions only; no user data or desktop is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Migration = require('../src/legacy-migration.cjs');
const Core = require('../src/core.cjs');
const { createStore } = require('../src/storage.cjs');
const Workbook = require('../src/score-rule-workbook.cjs');
const { legacyState } = require('./pet-fixtures.cjs');

function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}
function snapshot(root) {
  const files = {};
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else files[path.relative(root, file)] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
  }
  walk(root); return files;
}
function fixture(t, modern = false) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-preview-rc17-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, 'source'), root = path.join(home, 'destination');
  const state = Core.validateState(legacyState());
  const current = path.join(source, modern ? 'classroom-v2.json' : 'classroom.json');
  save(current, state);
  save(path.join(source, 'materials', 'notes.txt'), 'Synthetic original notes');
  save(path.join(root, 'teacher-notes.txt'), 'Synthetic destination notes to preserve');
  const newer = Core.applyAction(state, { type: 'panel.create', mode: 'copy', name: '合成新增面板' }, 1770000000000);
  const config = { dataDirectory: path.join(root, '数据'), backupDirectory: path.join(root, '备份'), resourceDirectory: root, validate: Core.validateState };
  return { home, source, root, current, state, newer, config, targetBefore: snapshot(root) };
}
function assertRefused(service, f) {
  assert.throws(() => service.preview(f.source), error => error.code === 'SOURCE_CHANGED');
  assert.deepEqual(snapshot(f.root), f.targetBefore);
  assert.equal(fs.existsSync(f.config.backupDirectory), false);
}
async function assertCoherentRetry(service, f, state) {
  const sourceBefore = snapshot(f.source), preview = service.preview(f.source);
  assert.equal(preview.summary.panels, 1 + (state.panels?.others || []).length);
  assert.equal(preview.summary.revision, state.revision);
  await service.prepare(preview.token, { approvedResourcePaths: preview.externalResources.map(item => item.path) });
  const result = service.commit(preview.token);
  assert.deepEqual(result.state, state);
  const loaded = createStore(f.config.dataDirectory, { validate: Core.validateState, initial: Core.createInitialState }).load().state;
  assert.deepEqual(loaded, state);
  const workbook = await Workbook.parseBytes(fs.readFileSync(path.join(f.root, Workbook.FILE_NAME)), loaded);
  assert.equal(workbook.length, preview.summary.panels);
  assert.deepEqual(snapshot(path.join(result.archiveDirectory, '旧版数据')), sourceBefore);
  assert.deepEqual(snapshot(f.source), sourceBefore);
}

for (const modern of [false, true]) test(`ordinary ${modern ? 'v2' : 'v1-to-v2'} save during first source read refuses stale preview and permits a coherent retry`, async t => {
  const f = fixture(t, modern);
  const store = createStore(f.source, { validate: Core.validateState, initial: Core.createInitialState });
  store.load();
  let injected = false, afterSave;
  const disk = new Proxy(fs, { get(target, key) {
    if (key === 'readFileSync') return (file, ...args) => {
      const value = target.readFileSync(file, ...args);
      if (!injected && file === f.current) { injected = true; store.save(f.newer); afterSave = snapshot(f.source); }
      return value;
    };
    return target[key];
  } });
  const service = Migration.createLegacyMigration({ ...f.config, disk });
  assertRefused(service, f);
  assert.equal(injected, true);
  assert.deepEqual(snapshot(f.source), afterSave);
  await assertCoherentRetry(service, f, f.newer);
});

test('a source save after classroom validation is caught before publishing the token', async t => {
  const f = fixture(t, true); let injected = false;
  const validate = value => {
    const state = Core.validateState(value);
    if (!injected) { injected = true; save(f.current, f.newer); }
    return state;
  };
  const service = Migration.createLegacyMigration({ ...f.config, validate });
  assertRefused(service, f);
  await assertCoherentRetry(service, f, f.newer);
});

for (const variant of ['valid-current', 'partial-current', 'valid-previous', 'avatar-index']) test(`parsed ${variant} bytes must match the captured snapshot even when the source is restored before recheck`, async t => {
  const f = fixture(t, true);
  let file = f.current, replacement = JSON.stringify(f.newer);
  if (variant === 'partial-current') { replacement = '{'; save(f.current + '.previous', f.state); }
  if (variant === 'valid-previous') { save(f.current, '{'); file += '.previous'; save(file, f.state); }
  if (variant === 'avatar-index') {
    file = path.join(f.source, 'avatar-location-v2.json');
    save(file, { version: 2, directory: path.join(f.source, 'avatars'), seededFiles: [] });
    replacement = JSON.stringify({ version: 2, directory: path.join(f.home, 'other-program', '头像'), seededFiles: ['01-星星猫头鹰.png'] });
  }
  const original = fs.readFileSync(file), sourceBefore = snapshot(f.source);
  let reads = 0, injected = false;
  const disk = new Proxy(fs, { get(target, key) {
    if (key === 'readFileSync') return (candidate, ...args) => {
      if (candidate === file && ++reads === 2) {
        injected = true;
        save(file, replacement);
        try { return target.readFileSync(candidate, ...args); }
        finally { save(file, original); }
      }
      return target.readFileSync(candidate, ...args);
    };
    return target[key];
  } });
  const service = Migration.createLegacyMigration({ ...f.config, disk });
  assertRefused(service, f);
  assert.equal(injected, true);
  assert.deepEqual(snapshot(f.source), sourceBefore);
  await assertCoherentRetry(service, f, f.state);
});

for (const change of ['added', 'removed']) test(`avatar metadata ${change} during validation refuses the preview without writing the target`, async t => {
  const f = fixture(t), index = path.join(f.source, 'avatar-location-v2.json');
  const value = { version: 2, directory: path.join(f.source, 'avatars'), seededFiles: [] };
  if (change === 'removed') save(index, value);
  let injected = false;
  const validate = input => {
    const state = Core.validateState(input);
    if (!injected) { injected = true; if (change === 'added') save(index, value); else fs.unlinkSync(index); }
    return state;
  };
  const service = Migration.createLegacyMigration({ ...f.config, validate });
  assertRefused(service, f);
  await assertCoherentRetry(service, f, f.state);
});

test('unchanged corrupt or missing current save still uses the same-version previous save through cancel and retry', async t => {
  for (const missing of [false, true]) {
    const f = fixture(t, true);
    save(f.current + '.previous', f.state);
    if (missing) fs.unlinkSync(f.current); else save(f.current, '{');
    const before = snapshot(f.source), service = Migration.createLegacyMigration(f.config);
    const preview = service.preview(f.source);
    assert.equal(preview.summary.sourceFile, 'classroom-v2.json.previous');
    assert.ok(preview.warnings.some(warning => /上一次完整存档/.test(warning)));
    await service.prepare(preview.token);
    await service.cancel(preview.token);
    assert.equal(fs.existsSync(path.join(f.config.dataDirectory, 'classroom-v2.json')), false);
    assert.deepEqual(snapshot(f.root), f.targetBefore);
    await assertCoherentRetry(service, f, f.state);
    assert.deepEqual(snapshot(f.source), before);
  }
});
