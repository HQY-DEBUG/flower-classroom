'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const Migration = require('../src/legacy-migration.cjs');
const Core = require('../src/core.cjs');
const { createStore } = require('../src/storage.cjs');
const Workbook = require('../src/score-rule-workbook.cjs');
const { legacyState, SYNTHETIC_PNG } = require('./pet-fixtures.cjs');

const digest = value => createHash('sha256').update(value).digest('hex');
const journalPending = file => /^journal-[a-f0-9-]+\.pending$/.test(path.basename(file));
const options = root => ({ dataDirectory: path.join(root, '数据'), backupDirectory: path.join(root, '备份'), resourceDirectory: root, validate: Core.validateState });
function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}
function snapshot(root) {
  const result = {};
  function walk(directory) {
    if (!fs.existsSync(directory)) return;
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else result[path.relative(root, file)] = digest(fs.readFileSync(file));
    }
  }
  walk(root); return result;
}
function activeSnapshot(root) {
  return Object.fromEntries(Object.entries(snapshot(root)).filter(([name]) => !name.startsWith(path.join('备份', '.legacy-migration-'))));
}
async function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-journal-rc16-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const source = path.join(home, 'old-program'), root = path.join(home, 'new-program');
  const state = legacyState(), config = options(root);
  save(path.join(source, 'classroom.json'), state);
  save(path.join(source, 'classroom.json.previous'), state);
  save(path.join(source, 'materials', 'teacher-notes.txt'), 'Synthetic classroom migration notes\n');
  save(path.join(source, 'avatars-seeded-v1.txt'), 'flower-avatar-library-v1:started\nflower-avatar-library-v1:complete\n');
  const names = require('../assets/avatar-defaults/manifest.json').files.map(item => item.fileName);
  save(path.join(source, 'avatars', names[0]), Buffer.from(SYNTHETIC_PNG.split(',')[1], 'base64'));
  for (const name of names.slice(0, 3)) save(path.join(root, '头像', name), fs.readFileSync(path.join(__dirname, '../assets/avatar-defaults', name)));
  save(path.join(root, '头像', names[2]), 'Synthetic teacher-customized destination avatar');
  save(path.join(root, '备份', 'teacher-backup.txt'), 'Synthetic existing backup must be retained');
  const initial = Core.createInitialState();
  const store = createStore(config.dataDirectory, { validate: Core.validateState, initial: () => initial });
  store.load(); store.save(initial);
  const workbook = await Workbook.buildBytes(initial);
  save(path.join(root, '计分卡片.xlsx'), workbook);
  const previewOptions = { allowPristineFiles: snapshot(config.dataDirectory), allowPristineWorkbookHash: digest(workbook) };
  const f = { home, source, root, config, state: Core.validateState(state), names, previewOptions, before: snapshot(root), sourceBefore: snapshot(source) };
  save(path.join(home, 'fixture.json'), { root, source, previewOptions });
  return f;
}
async function prepare(f, extras = {}) {
  const service = Migration.createLegacyMigration({ ...f.config, ...extras });
  const preview = service.preview(f.source, f.previewOptions);
  await service.prepare(preview.token, { approvedResourcePaths: preview.externalResources.map(item => item.path) });
  return { service, preview };
}
function assertImported(f, root = f.root) {
  assert.deepEqual(createStore(path.join(root, '数据'), { validate: Core.validateState, initial: Core.createInitialState }).load().state, f.state);
  assert.deepEqual(fs.readFileSync(path.join(root, '头像', f.names[0])), fs.readFileSync(path.join(f.source, 'avatars', f.names[0])));
  assert.equal(fs.existsSync(path.join(root, '头像', f.names[1])), false);
  assert.equal(fs.readFileSync(path.join(root, '头像', f.names[2]), 'utf8'), 'Synthetic teacher-customized destination avatar');
  assert.deepEqual(snapshot(f.source), f.sourceBefore);
}
function faultDisk(boundary, code, f) {
  const descriptors = new Map(); let failed = false;
  const injected = () => Object.assign(Error(`Synthetic ${boundary} ${code}`), { code });
  const disk = new Proxy(fs, { get(target, key) {
    if (key === 'openSync') return (...args) => { const fd = target.openSync(...args); descriptors.set(fd, String(args[0])); return fd; };
    if (key === 'writeFileSync') return (file, ...args) => {
      if (!failed && boundary === 'write' && journalPending(descriptors.get(file) || '')) {
        failed = true; target.writeFileSync(file, '{"version":2'); throw injected();
      }
      return target.writeFileSync(file, ...args);
    };
    if (key === 'fsyncSync') return fd => {
      if (!failed && boundary === 'sync' && journalPending(descriptors.get(fd) || '')) { failed = true; throw injected(); }
      return target.fsyncSync(fd);
    };
    if (key === 'renameSync') return (from, to) => {
      if (!failed && boundary === 'publish' && path.basename(to) === Migration.JOURNAL) { failed = true; throw injected(); }
      return target.renameSync(from, to);
    };
    if (key === 'mkdirSync') return (directory, ...args) => {
      const setupDirectory = boundary === 'prepare-data-directory' && directory === f.config.dataDirectory;
      const previousDirectory = boundary === 'prepare-previous-directory' && path.basename(directory) === 'previous' && path.dirname(directory).startsWith(path.join(f.config.backupDirectory, '.legacy-migration-'));
      if (!failed && (setupDirectory || previousDirectory)) { failed = true; throw injected(); }
      return target.mkdirSync(directory, ...args);
    };
    return target[key];
  } });
  return { disk, wasInjected: () => failed };
}

async function crashWorker() {
  const { root, source, previewOptions } = JSON.parse(fs.readFileSync(process.env.FLOWER_RC16_CRASH_FIXTURE));
  const boundary = process.env.FLOWER_RC16_CRASH_BOUNDARY, descriptors = new Map();
  const disk = new Proxy(fs, { get(target, key) {
    if (key === 'openSync') return (...args) => { const fd = target.openSync(...args); descriptors.set(fd, String(args[0])); return fd; };
    if (key === 'writeFileSync') return (file, ...args) => {
      if (boundary === 'partial-journal' && journalPending(descriptors.get(file) || '')) { target.writeFileSync(file, '{"version":2'); process.reallyExit(77); }
      return target.writeFileSync(file, ...args);
    };
    if (key === 'fsyncSync') return fd => {
      const result = target.fsyncSync(fd);
      if (boundary === 'synced-journal' && journalPending(descriptors.get(fd) || '')) process.reallyExit(77);
      return result;
    };
    if (key === 'renameSync') return (from, to) => {
      if (boundary === 'before-receipt' && to === path.join(root, '数据', Migration.RECEIPT)) process.reallyExit(77);
      const result = target.renameSync(from, to);
      if (boundary === 'published-journal' && path.basename(to) === Migration.JOURNAL) process.reallyExit(77);
      if (boundary === 'after-receipt' && to === path.join(root, '数据', Migration.RECEIPT)) process.reallyExit(77);
      return result;
    };
    return target[key];
  } });
  const service = Migration.createLegacyMigration({ ...options(root), disk });
  const preview = service.preview(source, previewOptions);
  await service.prepare(preview.token, { approvedResourcePaths: preview.externalResources.map(item => item.path) });
  service.commit(preview.token);
  throw Error('Requested crash boundary was not reached');
}
function crash(f, boundary) {
  const child = spawnSync(process.execPath, [__filename], { encoding: 'utf8', timeout: 30000, env: { ...process.env, FLOWER_RC16_CRASH_FIXTURE: path.join(f.home, 'fixture.json'), FLOWER_RC16_CRASH_BOUNDARY: boundary } });
  assert.equal(child.status, 77, `${child.error || ''}\n${child.stdout}\n${child.stderr}`);
  assert.deepEqual(snapshot(f.source), f.sourceBefore);
}

if (process.env.FLOWER_RC16_CRASH_FIXTURE) {
  crashWorker().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  for (const boundary of ['write', 'sync', 'publish', 'prepare-data-directory', 'prepare-previous-directory']) for (const code of ['EIO', 'ENOSPC']) {
    test(`journal ${boundary} ${code} leaves no final record and permits same-token retry`, async t => {
      const f = await fixture(t), fault = faultDisk(boundary, code, f), { service, preview } = await prepare(f, { disk: fault.disk });
      assert.throws(() => service.commit(preview.token), error => error.code === code);
      assert.equal(fault.wasInjected(), true);
      assert.equal(fs.existsSync(path.join(f.config.backupDirectory, Migration.JOURNAL)), false);
      const stage = path.join(f.config.backupDirectory, `.legacy-migration-${preview.token}`);
      assert.equal(fs.readdirSync(stage).some(journalPending), false);
      assert.equal(fs.existsSync(path.join(stage, 'receipt.json')), false);
      assert.deepEqual(activeSnapshot(f.root), f.before);
      assert.deepEqual(snapshot(f.source), f.sourceBefore);
      assert.deepEqual(Migration.createLegacyMigration(f.config).recover(), { recovered: false });
      const result = service.commit(preview.token);
      assert.deepEqual(snapshot(path.join(result.archiveDirectory, '旧版数据')), f.sourceBefore);
      assertImported(f);
      assert.deepEqual(service.commit(preview.token), result);
    });
  }

  for (const boundary of ['partial-journal', 'synced-journal', 'published-journal']) {
    test(`process exit at ${boundary} keeps original classroom and restart/retry succeeds`, async t => {
      const f = await fixture(t); crash(f, boundary);
      assert.deepEqual(activeSnapshot(f.root), f.before);
      const final = path.join(f.config.backupDirectory, Migration.JOURNAL);
      assert.equal(fs.existsSync(final), boundary === 'published-journal');
      if (fs.existsSync(final)) { const record = JSON.parse(fs.readFileSync(final)); assert.equal(record.version, 2); assert.equal(record.stage, `.legacy-migration-${record.token}`); }
      assert.deepEqual(Migration.createLegacyMigration(f.config).recover(), boundary === 'published-journal' ? { recovered: true, committed: false } : { recovered: false });
      assert.deepEqual(activeSnapshot(f.root), f.before);
      const { service, preview } = await prepare(f); service.commit(preview.token); assertImported(f);
    });
  }

  for (const boundary of ['before-receipt', 'after-receipt']) for (const format of ['rc16-relative', 'rc15-absolute']) {
    test(`${format} ${boundary} complete-folder copy/move recovers locally and independently`, async t => {
      const f = await fixture(t); crash(f, boundary);
      const final = path.join(f.config.backupDirectory, Migration.JOURNAL), record = JSON.parse(fs.readFileSync(final));
      assert.equal(record.stage, `.legacy-migration-${record.token}`);
      if (format === 'rc15-absolute') save(final, { ...record, version: 1, stage: path.join(f.config.backupDirectory, record.stage) });
      const interrupted = snapshot(f.root);
      for (const method of ['copy', 'move']) {
        const branch = path.join(f.home, `branch-${method}`), relocated = path.join(f.home, `relocated-${method}`);
        fs.cpSync(f.root, branch, { recursive: true });
        if (method === 'copy') fs.cpSync(branch, relocated, { recursive: true });
        else fs.renameSync(branch, relocated);
        const service = Migration.createLegacyMigration(options(relocated));
        assert.deepEqual(service.recover(), { recovered: true, committed: boundary === 'after-receipt' });
        assert.deepEqual(service.recover(), { recovered: false });
        if (boundary === 'before-receipt') assert.deepEqual(snapshot(relocated), f.before);
        else assertImported(f, relocated);
        assert.deepEqual(snapshot(f.root), interrupted);
        if (method === 'copy') assert.deepEqual(snapshot(branch), interrupted);
        assert.deepEqual(snapshot(f.source), f.sourceBefore);
      }
      assert.deepEqual(Migration.createLegacyMigration(f.config).recover(), { recovered: true, committed: boundary === 'after-receipt' });
      if (boundary === 'before-receipt') assert.deepEqual(snapshot(f.root), f.before);
      else assertImported(f);
    });
  }

  test('existing truncated RC15 final journal is retained with all source, stage and target bytes', async t => {
    const f = await fixture(t), { preview } = await prepare(f);
    save(path.join(f.config.backupDirectory, Migration.JOURNAL), '{"version":1');
    save(path.join(f.config.backupDirectory, `.legacy-migration-${preview.token}`, 'previous', 'unclassified-copy'), 'Synthetic ambiguous prior copy');
    const before = snapshot(f.home);
    assert.throws(() => Migration.createLegacyMigration(f.config).recover(), error => error.code === 'RECOVERY_REQUIRED');
    assert.deepEqual(snapshot(f.home), before);
  });

  test('incomplete moved RC15 folder without local stage is retained without using original stage', async t => {
    const f = await fixture(t); crash(f, 'before-receipt');
    const final = path.join(f.config.backupDirectory, Migration.JOURNAL), record = JSON.parse(fs.readFileSync(final));
    save(final, { ...record, version: 1, stage: path.join(f.config.backupDirectory, record.stage) });
    const moved = path.join(f.home, 'incomplete-copy'); fs.cpSync(f.root, moved, { recursive: true });
    fs.rmSync(path.join(moved, '备份', record.stage), { recursive: true });
    const original = snapshot(f.root), before = snapshot(moved);
    assert.throws(() => Migration.createLegacyMigration(options(moved)).recover(), error => error.code === 'RECOVERY_REQUIRED');
    assert.deepEqual(snapshot(moved), before); assert.deepEqual(snapshot(f.root), original); assert.deepEqual(snapshot(f.source), f.sourceBefore);
  });

  test('committed recovery survives completed stage cleanup before journal unlink', async t => {
    const f = await fixture(t); crash(f, 'after-receipt');
    const final = path.join(f.config.backupDirectory, Migration.JOURNAL), record = JSON.parse(fs.readFileSync(final));
    fs.rmSync(path.join(f.config.backupDirectory, record.stage), { recursive: true });
    assert.deepEqual(Migration.createLegacyMigration(f.config).recover(), { recovered: true, committed: true });
    assertImported(f);
  });
}
