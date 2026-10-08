'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createLegacyMigration, JOURNAL, RECEIPT } = require('../src/legacy-migration.cjs');
const { validateState, createInitialState, applyAction } = require('../src/core.cjs');
const { createStore } = require('../src/storage.cjs');
const { createClassroomLock } = require('../src/classroom-lock.cjs');
const { legacyState, SYNTHETIC_PNG } = require('./pet-fixtures.cjs');
const Workbook = require('../src/score-rule-workbook.cjs');
const digest = value => createHash('sha256').update(value).digest('hex');
function save(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); }
function snapshot(root) {
  const result = {};
  function walk(directory, prefix = '') { if (!fs.existsSync(directory)) return; for (const name of fs.readdirSync(directory).sort()) { const file = path.join(directory, name), relative = path.join(prefix, name); if (fs.statSync(file).isDirectory()) walk(file, relative); else result[relative] = digest(fs.readFileSync(file)); } }
  walk(root); return result;
}
function fixture(t, extras = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-explicit-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'old-AppData'), resourceDirectory = path.join(root, 'new-program');
  const dataDirectory = path.join(resourceDirectory, '数据'), backupDirectory = path.join(resourceDirectory, '备份');
  fs.mkdirSync(source); save(path.join(source, 'classroom.json'), legacyState());
  const config = { dataDirectory, backupDirectory, resourceDirectory, validate: validateState, ...extras };
  return { root, source, dataDirectory, backupDirectory, resourceDirectory, config, migration: createLegacyMigration(config) };
}
async function prepared(f, options = {}) { const preview = f.migration.preview(f.source, options); await f.migration.prepare(preview.token, { approvedResourcePaths: preview.externalResources.map(item => item.path) }); return preview; }

test('explicit migration construction is inert and preview reads source without any write', t => {
  const f = fixture(t), before = snapshot(f.root);
  const m = createLegacyMigration({ ...f.config, disk: new Proxy(fs, { get() { throw Error('construction performed IO'); } }) });
  assert.equal(typeof m.preview, 'function');
  const preview = f.migration.preview(f.source);
  assert.equal(preview.summary.students, 4); assert.equal(preview.summary.photos, 1); assert.equal(preview.summary.panels, 1);
  assert.deepEqual(snapshot(f.root), before); assert.equal(fs.existsSync(f.dataDirectory), false);
});

test('explicit migration preserves complete multipanel v2 state, photos, growth, redemption records and lock through restart', async t => {
  const f = fixture(t); const state = validateState(require('./rc18-regression-fixtures.cjs').historical('migration'));
  save(path.join(f.source, 'classroom-v2.json'), state); save(path.join(f.source, 'classroom-v2.enabled'), 'format 2');
  save(path.join(f.source, 'before-restore-1.json'), state);
  const lock = createClassroomLock(f.source); assert.equal(lock.setup('1357', '1357').ok, true);
  const before = snapshot(f.source), preview = await prepared(f);
  assert.equal(preview.summary.panels, 2); assert.equal(preview.summary.photos, 2); assert.equal(preview.summary.lock.locked, true);
  const result = f.migration.commit(preview.token);
  assert.deepEqual(result.state, state); assert.equal(result.restartRequired, true);
  assert.deepEqual(snapshot(f.source), before);
  assert.deepEqual(createStore(f.dataDirectory, { validate: validateState, initial: createInitialState }).load().state, state);
  assert.equal(createClassroomLock(f.dataDirectory).status().locked, true);
  assert.equal(createClassroomLock(f.dataDirectory).unlock('1357').ok, true);
  assert.equal(result.state.students[0].photo, SYNTHETIC_PNG);
  assert.equal(result.state.petOperations[0].id, 'synthetic_migration_redemption');
  assert.equal(result.state.petAccounts[0].badgeTransactions[0].type, 'redeem');
  assert.deepEqual(snapshot(path.join(result.archiveDirectory, '旧版数据')), before);
  assert.deepEqual(f.migration.commit(preview.token), result);
  assert.throws(() => f.migration.preview(f.source), error => error.code === 'DESTINATION_NOT_EMPTY');
  assert.equal(createLegacyMigration(f.config).recover().recovered, false);
});

test('unused example requires exact hashes and is replaced by v1 without stale v2 selection', async t => {
  const f = fixture(t), store = createStore(f.dataDirectory, { validate: validateState, initial: createInitialState });
  store.load(); store.save(createInitialState());
  const allowPristineFiles = snapshot(f.dataDirectory);
  assert.throws(() => f.migration.preview(f.source), /已有课堂/);
  const preview = await prepared(f, { allowPristineFiles });
  assert.equal(preview.summary.replacesUnusedExample, true);
  f.migration.commit(preview.token);
  assert.equal(fs.existsSync(path.join(f.dataDirectory, 'classroom-v2.json')), false);
  assert.equal(fs.existsSync(path.join(f.dataDirectory, 'classroom-v2.enabled')), false);
  const loaded = createStore(f.dataDirectory, { validate: validateState, initial: createInitialState }).load();
  assert.equal(loaded.readOnly, false); assert.deepEqual(loaded.state, validateState(legacyState()));
});

test('cancel before preparation and after staged copy leaves source and active destination untouched', async t => {
  const f = fixture(t), before = snapshot(f.source), first = f.migration.preview(f.source);
  await f.migration.cancel(first.token); await assert.rejects(f.migration.prepare(first.token), /正在准备/);
  const preview = await prepared(f); await f.migration.cancel(preview.token);
  assert.throws(() => f.migration.commit(preview.token), /先确认/);
  assert.deepEqual(snapshot(f.source), before); assert.equal(fs.existsSync(path.join(f.dataDirectory, 'classroom.json')), false);
  assert.deepEqual(fs.readdirSync(f.backupDirectory), []);
});

test('cancel while asynchronous copy is pending never revives a migration token', async t => {
  let release, entered; const pause = new Promise(resolve => { entered = resolve; }); const hold = new Promise(resolve => { release = resolve; });
  let once = true;
  const io = new Proxy(fs.promises, { get(target, key) { if (key !== 'copyFile') return target[key]; return async (...args) => { if (once) { once = false; entered(); await hold; } return target.copyFile(...args); }; } });
  const f = fixture(t, { io }), preview = f.migration.preview(f.source), pending = f.migration.prepare(preview.token);
  await pause; await f.migration.cancel(preview.token); release();
  await assert.rejects(pending, error => error.code === 'CANCELLED');
  assert.throws(() => f.migration.commit(preview.token), /先确认/);
  assert.deepEqual(fs.readdirSync(f.backupDirectory), []);
});

test('changed source, target, or caller epoch refuses commit without overwrites', async t => {
  const f = fixture(t), preview = await prepared(f), before = snapshot(f.source);
  assert.throws(() => f.migration.commit(preview.token, { check() { throw Error('current epoch changed'); } }), /epoch/);
  save(path.join(f.source, 'classroom.json'), { ...legacyState(), revision: 90 });
  assert.throws(() => f.migration.commit(preview.token), error => error.code === 'SOURCE_CHANGED');
  assert.equal(fs.existsSync(path.join(f.dataDirectory, 'classroom.json')), false);
  assert.notDeepEqual(snapshot(f.source), before);
  await f.migration.cancel(preview.token);
  const second = await prepared(f); save(path.join(f.dataDirectory, 'classroom.json'), legacyState());
  const destination = snapshot(f.dataDirectory); assert.throws(() => f.migration.commit(second.token), error => error.code === 'DESTINATION_NOT_EMPTY');
  assert.deepEqual(snapshot(f.dataDirectory), destination);
});

test('ordinary copy failure preserves source and supports clean preparation retry', async t => {
  let failCopy = true;
  const io = new Proxy(fs.promises, { get(target, key) { if (key !== 'copyFile') return target[key]; return async (...args) => { if (failCopy) throw Object.assign(Error('synthetic copy IO failure'), { code: 'EIO' }); return target.copyFile(...args); }; } });
  const f = fixture(t, { io }), before = snapshot(f.source), preview = f.migration.preview(f.source);
  await assert.rejects(f.migration.prepare(preview.token), /synthetic copy/);
  assert.deepEqual(snapshot(f.source), before); assert.deepEqual(fs.readdirSync(f.backupDirectory), []);
  failCopy = false; await f.migration.prepare(preview.token); f.migration.commit(preview.token);
  assert.deepEqual(snapshot(f.source), before);
});

test('ordinary rename failure rolls back example data and resources, then retry succeeds once', async t => {
  let failAt = '', failed = false;
  const disk = new Proxy(fs, { get(target, key) { if (key !== 'renameSync') return target[key]; return (from, to) => { if (to === failAt && !failed) { failed = true; throw Object.assign(Error('synthetic rename IO failure'), { code: 'EIO' }); } return target.renameSync(from, to); }; } });
  const f = fixture(t, { disk }); save(path.join(f.source, 'avatars', '自选.png'), Buffer.from(SYNTHETIC_PNG.split(',')[1], 'base64'));
  const store = createStore(f.dataDirectory, { validate: validateState, initial: createInitialState }); store.load(); store.save(createInitialState());
  const before = snapshot(f.dataDirectory), old = snapshot(f.source), preview = await prepared(f, { allowPristineFiles: before });
  failAt = path.join(f.resourceDirectory, '配置.xlsx');
  assert.throws(() => f.migration.commit(preview.token), /synthetic rename/);
  assert.deepEqual(snapshot(f.dataDirectory), before); assert.deepEqual(snapshot(f.source), old);
  assert.equal(fs.existsSync(path.join(f.resourceDirectory, '头像', '自选.png')), false);
  assert.equal(fs.existsSync(path.join(f.backupDirectory, JOURNAL)), false);
  f.migration.commit(preview.token);
  assert.equal(createStore(f.dataDirectory, { validate: validateState, initial: createInitialState }).load().state.revision, 17);
});

test('restart restores interrupted transaction from its EXE-local journal before data is loaded', async t => {
  let failCommit = true, failRollback = true, f;
  const disk = new Proxy(fs, { get(target, key) { if (key !== 'renameSync') return target[key]; return (from, to) => { if (failCommit && to === path.join(f.resourceDirectory, '配置.xlsx')) { failCommit = false; throw Error('synthetic commit interruption'); } if (failRollback && from === path.join(f.dataDirectory, 'classroom.json')) { failRollback = false; throw Error('synthetic rollback interruption'); } return target.renameSync(from, to); }; } });
  f = fixture(t, { disk }); const before = snapshot(f.source), preview = await prepared(f);
  assert.throws(() => f.migration.commit(preview.token), error => error.code === 'RECOVERY_REQUIRED');
  assert.equal(fs.existsSync(path.join(f.backupDirectory, JOURNAL)), true);
  const restarted = createLegacyMigration(f.config).recover();
  assert.deepEqual(restarted, { recovered: true, committed: false });
  assert.equal(fs.existsSync(path.join(f.dataDirectory, 'classroom.json')), false);
  assert.equal(fs.existsSync(path.join(f.dataDirectory, RECEIPT)), false);
  assert.deepEqual(snapshot(f.source), before);
});

test('malformed classroom, lock, and avatar metadata stop before any destination is written', t => {
  const f = fixture(t), check = code => { const old = snapshot(f.source); assert.throws(() => f.migration.preview(f.source), error => error.code === code); assert.deepEqual(snapshot(f.source), old); assert.equal(fs.existsSync(f.resourceDirectory), false); };
  save(path.join(f.source, 'classroom.json'), '{broken'); check('INVALID_CLASSROOM');
  save(path.join(f.source, 'classroom.json'), legacyState()); save(path.join(f.source, 'classroom-lock.json'), { version: 9 }); check('INVALID_LOCK');
  fs.unlinkSync(path.join(f.source, 'classroom-lock.json')); save(path.join(f.source, 'avatar-location-v2.json'), '{broken'); check('INVALID_JSON');
});

test('legacy recovery copies valid previous state while archiving exact corrupt primary bytes', async t => {
  const f = fixture(t); save(path.join(f.source, 'classroom-v2.enabled'), 'format2'); save(path.join(f.source, 'classroom-v2.json'), 'broken current');
  const state = validateState({ ...legacyState(), version: 2 }); save(path.join(f.source, 'classroom-v2.json.previous'), state);
  const before = snapshot(f.source), preview = await prepared(f), result = f.migration.commit(preview.token);
  assert.match(preview.warnings[0], /上一次完整/); assert.deepEqual(snapshot(f.source), before);
  assert.equal(fs.readFileSync(path.join(result.archiveDirectory, '旧版数据', 'classroom-v2.json'), 'utf8'), 'broken current');
  assert.deepEqual(createStore(f.dataDirectory, { validate: validateState, initial: createInitialState }).load().state, state);
});

test('external avatar references are only read after exact displayed paths are approved', async t => {
  const f = fixture(t), oldProgram = path.join(f.root, 'old-program'), avatar = path.join(oldProgram, '头像');
  const png = Buffer.from(SYNTHETIC_PNG.split(',')[1], 'base64'); save(path.join(avatar, '自选.png'), png);
  save(path.join(f.source, 'avatar-location-v2.json'), { version: 2, directory: avatar, seededFiles: [] });
  const before = snapshot(f.root), preview = f.migration.preview(f.source);
  assert.deepEqual(preview.externalResources.map(item=>item.kind).sort(),['avatars','avatar-marker','legacy-text','legacy-workbook','legacy-receipt','configuration'].sort()); assert.deepEqual(snapshot(f.root), before);
  await assert.rejects(f.migration.prepare(preview.token), error => error.code === 'RESOURCE_APPROVAL_REQUIRED');
  await f.migration.prepare(preview.token, { approvedResourcePaths: preview.externalResources.map(item => item.path) });
  f.migration.commit(preview.token);
  assert.deepEqual(fs.readFileSync(path.join(f.resourceDirectory, '头像', '自选.png')), png);
  assert.deepEqual(fs.readFileSync(path.join(avatar, '自选.png')), png);
});

test('avatar merge retains custom collisions and respects deleted untouched bundled defaults', async t => {
  const f = fixture(t), manifest = require('../assets/avatar-defaults/manifest.json');
  const [deleted, protectedName] = manifest.files.slice(0, 2).map(item => item.fileName), existing = Buffer.from('synthetic retained custom bytes');
  fs.mkdirSync(path.join(f.source, 'avatars')); save(path.join(f.source, 'avatars-seeded-v1.txt'), 'flower-avatar-library-v1:started\nflower-avatar-library-v1:complete\n');
  save(path.join(f.source, 'avatars', '重名.png'), Buffer.from(SYNTHETIC_PNG.split(',')[1], 'base64'));
  save(path.join(f.resourceDirectory, '头像', deleted), fs.readFileSync(path.join(__dirname, '../assets/avatar-defaults', deleted)));
  save(path.join(f.resourceDirectory, '头像', protectedName), existing); save(path.join(f.resourceDirectory, '头像', '重名.png'), existing);
  const preview = await prepared(f); const result = f.migration.commit(preview.token);
  assert.equal(fs.existsSync(path.join(f.resourceDirectory, '头像', deleted)), false);
  assert.deepEqual(fs.readFileSync(path.join(f.resourceDirectory, '头像', protectedName)), existing);
  assert.deepEqual(fs.readFileSync(path.join(f.resourceDirectory, '头像', '重名.png')), existing);
  assert.ok(fs.readdirSync(path.join(f.resourceDirectory, '头像')).some(name => /^重名-迁入-/.test(name)));
  assert.ok(result.warnings.some(value => /同名资源/.test(value)));
});

test('exact pristine bound workbook is rebuilt and an edited destination refuses migration without changes', async t => {
  const f = fixture(t), initial = await Workbook.buildBytes(createInitialState()); save(path.join(f.resourceDirectory, '配置.xlsx'), initial);
  const preview = await prepared(f, { allowPristineWorkbookHash: digest(initial) }); f.migration.commit(preview.token);
  const parsed = await Workbook.parseBytes(fs.readFileSync(path.join(f.resourceDirectory, '配置.xlsx')), validateState(legacyState()));
  assert.equal(parsed[0].name, legacyState().settings.className);
  const other = fixture(t); save(path.join(other.resourceDirectory, '配置.xlsx'), 'teacher edited workbook');
  const before=snapshot(other.source);
  await assert.rejects(prepared(other),error=>error.code==='CONFIGURATION_DESTINATION_CHANGED');
  assert.equal(fs.readFileSync(path.join(other.resourceDirectory, '配置.xlsx'), 'utf8'), 'teacher edited workbook');
  assert.equal(fs.readdirSync(other.resourceDirectory).some(name => /^配置-迁入-/.test(name)),false);
  assert.deepEqual(snapshot(other.source),before);
  assert.deepEqual(snapshot(other.dataDirectory),{});
});

test('browser cache is excluded while old photos, material files and custom rules are archived intact', async t => {
  const f = fixture(t); save(path.join(f.source, 'Cache', 'ignored.bin'), 'transient');
  save(path.join(f.source, 'photos', 'synthetic.png'), Buffer.from(SYNTHETIC_PNG.split(',')[1], 'base64'));
  save(path.join(f.source, 'customrules', 'rules.json'), { synthetic: true }); save(path.join(f.source, 'materials', 'notes.txt'), 'synthetic material');
  const old = snapshot(f.source), preview = await prepared(f), result = f.migration.commit(preview.token);
  assert.equal(preview.files.some(item => item.path.startsWith('Cache')), false);
  assert.equal(fs.existsSync(path.join(result.archiveDirectory, '旧版数据', 'Cache')), false);
  for (const name of ['photos/synthetic.png', 'customrules/rules.json', 'materials/notes.txt']) assert.equal(digest(fs.readFileSync(path.join(result.archiveDirectory, '旧版数据', name))), old[name]);
  assert.deepEqual(snapshot(f.source), old);
});

test('deleting the whole legacy avatar folder keeps seeded40 deleted and preserves destination custom replacements', async t => {
  const f = fixture(t), names = require('../assets/avatar-defaults/manifest.json').files.map(item => item.fileName);
  save(path.join(f.source, 'avatars-seeded-v1.txt'), 'flower-avatar-library-v1:started\nflower-avatar-library-v1:complete\n');
  for (const name of names) save(path.join(f.resourceDirectory, '头像', name), fs.readFileSync(path.join(__dirname, '../assets/avatar-defaults', name)));
  const protectedBytes = Buffer.from(SYNTHETIC_PNG.split(',')[1], 'base64'); save(path.join(f.resourceDirectory, '头像', names[0]), protectedBytes);
  const before = snapshot(f.source), first = await prepared(f);
  assert.ok(first.warnings.some(value => /文件夹已缺失/.test(value)));
  assert.equal(fs.readdirSync(path.join(f.resourceDirectory, '头像')).length, 120);
  await f.migration.cancel(first.token);
  assert.equal(fs.readdirSync(path.join(f.resourceDirectory, '头像')).length, 120);
  const second = await prepared(f), result = f.migration.commit(second.token);
  assert.equal(fs.readdirSync(path.join(f.resourceDirectory, '头像')).length, 81);
  for (const name of names.slice(1, 40)) assert.equal(fs.existsSync(path.join(f.resourceDirectory, '头像', name)), false);
  for (const name of names.slice(40)) assert.equal(fs.existsSync(path.join(f.resourceDirectory, '头像', name)), true);
  assert.deepEqual(fs.readFileSync(path.join(f.resourceDirectory, '头像', names[0])), protectedBytes);
  assert.deepEqual(snapshot(f.source), before); assert.ok(result.warnings.some(value => /避免补回/.test(value)));
});

test('unavailable indexed avatar folder conservatively retains seeded deletion history without removing custom destination files', async t => {
  const f = fixture(t), names = require('../assets/avatar-defaults/manifest.json').files.map(item => item.fileName);
  save(path.join(f.source, 'avatar-location-v2.json'), { version: 2, directory: path.join(f.root, 'disconnected-old-program', '头像'), seededFiles: names });
  for (const name of names) save(path.join(f.resourceDirectory, '头像', name), fs.readFileSync(path.join(__dirname, '../assets/avatar-defaults', name)));
  const custom = Buffer.from(SYNTHETIC_PNG.split(',')[1], 'base64'); save(path.join(f.resourceDirectory, '头像', names[0]), custom);
  const before = snapshot(f.source), preview = await prepared(f), result = f.migration.commit(preview.token);
  assert.ok(preview.warnings.some(value => /原头像文件夹不可用/.test(value)));
  assert.deepEqual(fs.readdirSync(path.join(f.resourceDirectory, '头像')), [names[0]]);
  assert.deepEqual(fs.readFileSync(path.join(f.resourceDirectory, '头像', names[0])), custom);
  assert.deepEqual(snapshot(f.source), before); assert.ok(result.warnings.some(value => /自定义图片仍需从原目录找回/.test(value)));
});

test('customized old default keeps its original filename by replacing only exact bundled destination bytes', async t => {
  const f = fixture(t), name = '01-星星猫头鹰.png', custom = Buffer.from(SYNTHETIC_PNG.split(',')[1], 'base64');
  save(path.join(f.source, 'avatars', name), custom);
  save(path.join(f.resourceDirectory, '头像', name), fs.readFileSync(path.join(__dirname, '../assets/avatar-defaults', name)));
  const before = snapshot(f.source), preview = await prepared(f); f.migration.commit(preview.token);
  assert.deepEqual(fs.readFileSync(path.join(f.resourceDirectory, '头像', name)), custom);
  assert.deepEqual(fs.readdirSync(path.join(f.resourceDirectory, '头像')), [name]); assert.deepEqual(snapshot(f.source), before);
  const other = fixture(t), retained = Buffer.from('synthetic destination teacher replacement');
  save(path.join(other.source, 'avatars', name), custom); save(path.join(other.resourceDirectory, '头像', name), retained);
  const second = await prepared(other), result = other.migration.commit(second.token);
  assert.deepEqual(fs.readFileSync(path.join(other.resourceDirectory, '头像', name)), retained);
  assert.ok(fs.readdirSync(path.join(other.resourceDirectory, '头像')).some(value => /^01-星星猫头鹰-迁入-/.test(value)));
  assert.ok(result.warnings.some(value => /当前同名资源已保留/.test(value)));
});

test('folder-edition relative avatar index resolves only the fixed sibling path shown for explicit approval', async t => {
  const f = fixture(t), oldProgram = path.join(f.root, 'old-folder-edition'); fs.mkdirSync(oldProgram);
  const oldData = path.join(oldProgram, '数据'); fs.renameSync(f.source, oldData); f.source = oldData;
  const avatar = path.join(oldProgram, '头像'), custom = Buffer.from(SYNTHETIC_PNG.split(',')[1], 'base64'); save(path.join(avatar, '自选.png'), custom);
  save(path.join(f.source, 'avatar-location-v2.json'), { version: 2, directory: '头像', seededFiles: [], complete: true });
  const before = snapshot(oldProgram), preview = f.migration.preview(f.source);
  assert.equal(preview.externalResources[0].path, avatar); assert.deepEqual(snapshot(oldProgram), before);
  await assert.rejects(f.migration.prepare(preview.token), error => error.code === 'RESOURCE_APPROVAL_REQUIRED');
  await f.migration.prepare(preview.token, { approvedResourcePaths: preview.externalResources.map(item => item.path) }); f.migration.commit(preview.token);
  assert.deepEqual(fs.readFileSync(path.join(f.resourceDirectory, '头像', '自选.png')), custom); assert.deepEqual(snapshot(oldProgram), before);
  const other = fixture(t); save(path.join(other.source, 'avatar-location-v2.json'), { version: 2, directory: '头像', seededFiles: [] });
  assert.throws(() => other.migration.preview(other.source), error => error.code === 'INVALID_AVATAR_INDEX');
});
