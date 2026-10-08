'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, randomUUID } = require('node:crypto');
const { createAvatarLibrary, checkStaticImage, FOLDER_NAME, SEED_MARKER, LIMITS } = require('../src/avatar-library.cjs');
const Core = require('../src/core.cjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRj8AAAAASUVORK5CYII=', 'base64');
const DEFAULTS = path.resolve(__dirname, '../assets/avatar-defaults');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Unit decoder only: real native image decoding is checked separately with the
// existing Electron workflow. These bytes and directories are synthetic.
function decoder({ empty = false, onDecode, width = 384, height = 384, outputBytes } = {}) {
  let calls = 0;
  return { get calls() { return calls; }, createFromBuffer(bytes) {
    calls++; onDecode?.(calls);
    const jpeg = Buffer.concat([Buffer.from([255, 216, 255]), Buffer.from(digest(bytes))]);
    return { isEmpty: () => empty, getSize: () => ({ width, height }), resize(options) {
      const scale = options.width ? options.width / width : options.height / height;
      return { isEmpty: () => false, getSize: () => ({ width: Math.round(width * scale), height: Math.round(height * scale) }), toJPEG: () => outputBytes || jpeg };
    } };
  } };
}
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-avatar-library-'));
  const dataDirectory = path.join(root, 'persistent-data');
  const directory = path.join(dataDirectory, FOLDER_NAME);
  const nativeImage = options.nativeImage || decoder();
  const config = { dataDirectory, defaultsDirectory: DEFAULTS, nativeImage, ...options };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, dataDirectory, directory, nativeImage, config, library: createAvatarLibrary(config) };
}
function markSeeded(f) {
  fs.mkdirSync(f.directory, { recursive: true });
  fs.writeFileSync(path.join(f.dataDirectory, SEED_MARKER), 'flower-avatar-library-v1:started\nflower-avatar-library-v1:complete\n');
}
function write(f, name, bytes = PNG) { fs.writeFileSync(path.join(f.directory, name), bytes); }
function faultIO(method, predicate, code = 'EACCES') {
  return new Proxy(fs.promises, { get(target, key) {
    if (key !== method) return target[key];
    return async (...args) => { if (predicate(...args)) throw Object.assign(new Error('SYNTHETIC_IO_FAILURE'), { code }); return target[key](...args); };
  } });
}

test('listed leading-space and filesystem-length filenames resolve to their own image snapshots', async t => {
  const { resolveAvatarRows } = require('../src/io.cjs');
  const f = fixture(t); markSeeded(f);
  const names = [' 前导空格.png', '前导空格.png', 'a'.repeat(181) + '.png', 'b'.repeat(251) + '.png'];
  const otherBytes = fs.readFileSync(path.join(DEFAULTS, '01-星星猫头鹰.png'));
  names.forEach((name, index) => write(f, name, index === 1 ? otherBytes : PNG));
  const listing = await f.library.list();
  assert.equal(listing.items.length, names.length);
  assert.notEqual(listing.items.find(item => item.fileName === names[0]).photo, listing.items.find(item => item.fileName === names[1]).photo);
  const resolved = resolveAvatarRows(names.map(avatarName => ({ name: '合成同学', avatarName })), listing.items);
  for (const [index, name] of names.entries()) {
    assert.equal(resolved.avatarMatches[index].status, 'matched');
    assert.equal(resolved.avatarMatches[index].fileName, name);
    assert.equal(resolved.rows[index].photo, listing.items.find(item => item.fileName === name).photo);
  }
});

test('construction performs no folder creation or scanning; first use seeds exactly 120 defaults once', async t => {
  const f = fixture(t);
  assert.equal(fs.existsSync(f.dataDirectory), false);
  assert.equal(f.nativeImage.calls, 0);
  const first = await f.library.list();
  assert.equal(first.directory, f.directory);
  assert.equal(first.items.length, 120);
  assert.equal(first.warning, '');
  assert.equal(first.skipped, 0);
  assert.equal(fs.readdirSync(f.directory).length, 120);
  assert.equal(fs.readdirSync(f.dataDirectory).length, 3); // 头像, root seed record, local 数据 metadata
  assert.equal(first.items.find(item => item.fileName === '01-星星猫头鹰.png').pet, 'owl');
  assert.equal(first.items.find(item => item.pet === 'owl').name, '星星猫头鹰');
  assert.ok(first.items.every(item => /^[a-f0-9]{64}$/.test(item.id) && item.photo.startsWith('data:image/jpeg;base64,')));
  first.items[0].name = 'mutated caller copy';
  assert.notEqual((await f.library.list()).items[0].name, first.items[0].name);
  assert.equal(f.nativeImage.calls, 120);
});

test('manual refresh recognizes additions and deletions; cached snapshots and IDs stay stable until then', async t => {
  const f = fixture(t); markSeeded(f); write(f, '自选头像.png');
  const first = await f.library.list(), chosen = first.items[0];
  write(f, '自选头像.png', Buffer.concat([PNG, Buffer.from('new bytes')]));
  write(f, '新增图片.png');
  assert.deepEqual(await f.library.list(), first);
  assert.equal(f.nativeImage.calls, 1);
  const refreshed = await f.library.refresh();
  assert.equal(refreshed.items.length, 2);
  const replacement = refreshed.items.find(item => item.fileName === '自选头像.png');
  assert.equal(replacement.id, chosen.id);
  assert.notEqual(replacement.photo, chosen.photo);
  fs.unlinkSync(path.join(f.directory, '自选头像.png'));
  assert.equal((await f.library.list()).items.length, 2);
  assert.equal((await f.library.refresh()).items.length, 1);
});

test('sessions in the same program folder use one persistent location and never resurrect deleted defaults on restart or upgrade', async t => {
  const f = fixture(t), first = await f.library.list(), removed = first.items[0];
  fs.unlinkSync(path.join(f.directory, removed.fileName));
  const extraDefaults = path.join(f.root, 'new-version-defaults');
  fs.mkdirSync(extraDefaults);
  fs.writeFileSync(path.join(extraDefaults, '升级新增.png'), PNG);
  const restarted = createAvatarLibrary({ ...f.config, defaultsDirectory: extraDefaults });
  const next = await restarted.list();
  assert.equal(next.directory, first.directory);
  assert.equal(next.items.length, 119);
  assert.equal(next.items.some(item => item.fileName === removed.fileName || item.fileName === '升级新增.png'), false);
  assert.equal(next.items.find(item => item.fileName === first.items[1].fileName).id, first.items[1].id);
});

test('an existing same-name user image is never overwritten by first seed', async t => {
  const f = fixture(t); fs.mkdirSync(f.directory, { recursive: true });
  const name = '01-星星猫头鹰.png', custom = Buffer.concat([PNG, Buffer.from('user-owned')]);
  write(f, name, custom);
  const listed = await f.library.list();
  assert.equal(listed.items.length, 120);
  assert.deepEqual(fs.readFileSync(path.join(f.directory, name)), custom);
});

test('deleting the full avatar folder creates an empty folder on refresh, preserving selected student photos and backup bytes', async t => {
  const f = fixture(t), item = (await f.library.list()).items[0];
  const initial = Core.createInitialState(), id = initial.students[0].id;
  const saved = Core.applyAction(initial, { type: 'student.update', id, photo: item.photo, expectedStudent: { photo: initial.students[0].photo } });
  const backup = JSON.stringify(saved);
  fs.rmSync(f.directory, { recursive: true });
  assert.equal((await f.library.refresh()).items.length, 0);
  assert.equal((await createAvatarLibrary(f.config).list()).items.length, 0);
  assert.equal(JSON.stringify(saved), backup);
  assert.equal(Core.validateState(JSON.parse(backup)).students[0].photo, item.photo);
});

test('partial first seed records an interruption and never retries deleted or uncopied images', async t => {
  let copies = 0;
  const io = faultIO('copyFile', () => ++copies === 4, 'EIO');
  const f = fixture(t, { io });
  const result = await f.library.list();
  assert.equal(result.items.length, 3);
  assert.match(result.warning, /首次准备未完成/);
  fs.unlinkSync(path.join(f.directory, result.items[0].fileName));
  assert.equal((await f.library.refresh()).items.length, 2);
  const restarted = await createAvatarLibrary({ ...f.config, io: fs.promises }).list();
  assert.equal(restarted.items.length, 2);
  assert.match(restarted.warning, /不会自动补回/);
  assert.equal(copies, 4);
});

test('a crash marker or malformed marker preserves the existing user library without seeding', async t => {
  const f = fixture(t); markSeeded(f); write(f, '手动图片.png');
  for (const marker of ['', 'flower-avatar-library-v1:started\n', 'invalid-state']) {
    fs.writeFileSync(path.join(f.dataDirectory, SEED_MARKER), marker);
    const result = await createAvatarLibrary(f.config).list();
    assert.equal(result.items.length, 1);
    assert.match(result.warning, /首次准备未完成/);
  }
});

test('a read-only seed marker reports the problem and still lists user images without writing defaults', async t => {
  const io = faultIO('open', (file, flags) => file.endsWith(SEED_MARKER) && flags === 'wx');
  const f = fixture(t, { io }); fs.mkdirSync(f.directory, { recursive: true }); write(f, '已有图片.png');
  const result = await f.library.list();
  assert.equal(result.items.length, 1);
  assert.match(result.warning, /不可写/);
  assert.equal(fs.readdirSync(f.directory).length, 1);
  assert.equal(fs.existsSync(path.join(f.dataDirectory, SEED_MARKER)), false);
});

test('an existing read-only library remains selectable and a non-creatable folder has a clear error', async t => {
  const io = faultIO('access', () => true);
  const f = fixture(t, { io }); markSeeded(f); write(f, '已有图片.png');
  const result = await f.library.list();
  assert.equal(result.items.length, 1); assert.match(result.warning, /当前不可写/);
  const denied = createAvatarLibrary({ ...f.config, io: faultIO('mkdir', () => true) });
  await assert.rejects(denied.list(), /无法创建头像文件夹.*不可写/);
});

test('corrupt, oversized, huge-dimension, animated and unsupported entries are skipped while static PNG/JPEG/WebP remain', async t => {
  const f = fixture(t); markSeeded(f);
  write(f, '好图.png'); write(f, '照片.jpeg', Buffer.from([255, 216, 255, 224, 1, 2]));
  write(f, '静态.webp', Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvC8AEAAdQyeYUsP+BiOh/AAA=', 'base64'));
  write(f, '坏图.png', Buffer.from('broken'));
  write(f, '超大.png'); fs.truncateSync(path.join(f.directory, '超大.png'), LIMITS.photoBytes + 1);
  const huge = Buffer.from(PNG); huge.writeUInt32BE(20000, 16); write(f, '超大尺寸.png', huge);
  const animationChunk = Buffer.alloc(20); animationChunk.writeUInt32BE(8); animationChunk.write('acTL', 4);
  write(f, '动画.png', Buffer.concat([PNG.subarray(0, 33), animationChunk, PNG.subarray(33)]));
  const webp = Buffer.alloc(30); webp.write('RIFF'); webp.writeUInt32LE(22, 4); webp.write('WEBPVP8X', 8); webp.writeUInt32LE(10, 16); webp[20] = 2; write(f, '动画.webp', webp);
  write(f, '文件.svg', Buffer.from('<svg/>'));
  fs.mkdirSync(path.join(f.directory, '子目录')); fs.writeFileSync(path.join(f.directory, '子目录', '藏起来.png'), PNG);
  const result = await f.library.list();
  assert.equal(result.items.length, 3);
  assert.equal(result.skipped, 7);
  assert.equal(f.nativeImage.calls, 3);
  assert.match(result.warning, /已跳过 7 项/);
});

test('native decode failure is omitted and a source changed during reading never supplies unchecked bytes', async t => {
  const f = fixture(t, { nativeImage: decoder({ empty: true }) }); markSeeded(f); write(f, '损坏.png');
  assert.equal((await f.library.list()).items.length, 0);
  let readOpens = 0;
  const io = new Proxy(fs.promises, { get(target, key) {
    if (key !== 'open') return target[key];
    return async (file, flags) => {
      if (file.endsWith('变化.png') && typeof flags === 'number') { readOpens++; fs.writeFileSync(file, Buffer.concat([PNG, Buffer.from('replaced')])); }
      return target.open(file, flags);
    };
  } });
  write(f, '变化.png');
  const current = await createAvatarLibrary({ ...f.config, io, nativeImage: decoder() }).list();
  assert.equal(current.items.some(item => item.fileName === '变化.png'), false);
  assert.equal(readOpens, 1);
});

test('encoded and HTML-like filenames stay plain text with opaque IDs, with no path or URL decoding', async t => {
  const f = fixture(t); markSeeded(f);
  for (const name of ['%2e%2e%2foutside.png', '<img onerror=alert(1)>.png', '__proto__.png', '雪 人 #%.png']) write(f, name);
  const result = await f.library.list();
  assert.equal(result.items.length, 4);
  assert.deepEqual(new Set(result.items.map(item => item.fileName)), new Set(fs.readdirSync(f.directory)));
  assert.ok(result.items.every(item => /^[a-f0-9]{64}$/.test(item.id) && item.photo.startsWith('data:image/jpeg;base64,')));
});

test('the listing caps images and top-level entries without traversing subdirectories', async t => {
  const f = fixture(t); markSeeded(f);
  for (let i = 0; i < LIMITS.items + 1; i++) write(f, `${String(i).padStart(4, '0')}.png`);
  let result = await f.library.list();
  assert.equal(result.items.length, LIMITS.items); assert.match(result.warning, /最多显示 200/);
  for (let i = 0; i < LIMITS.entries + 1; i++) write(f, `${i}.txt`, Buffer.from('synthetic'));
  result = await f.library.refresh(); assert.match(result.warning, /仅检查前 1000/);
});

test('total source bytes and decoded cache bytes are bounded independently', async t => {
  const f = fixture(t); markSeeded(f);
  const large = Buffer.alloc(LIMITS.photoBytes); PNG.copy(large);
  for (let i = 0; i < 25; i++) write(f, `${i}.png`, large);
  const result = await f.library.list();
  assert.equal(result.items.length, Math.floor(LIMITS.totalBytes / LIMITS.photoBytes));
  assert.match(result.warning, /32 MB/);
  const output = Buffer.alloc(LIMITS.photoBytes); output[0] = 255; output[1] = 216; output[2] = 255;
  const limited = await createAvatarLibrary({ ...f.config, nativeImage: decoder({ outputBytes: output }) }).list();
  assert.ok(limited.items.reduce((total, item) => total + item.photo.length, 0) <= LIMITS.cacheBytes);
  assert.match(limited.warning, /预览达到容量上限/);
});

test('concurrent first requests share one seed and cache; a lock guard stops in-flight work and all later reads', async t => {
  const f = fixture(t);
  const [a, b] = await Promise.all([f.library.list(), f.library.list()]);
  assert.deepEqual(a, b); assert.equal(f.nativeImage.calls, 120);
  await assert.rejects(f.library.list({ check: () => { throw new Error('课堂已锁定'); } }), /课堂已锁定/);
  let locked = false;
  const interrupted = fixture(t, { nativeImage: decoder({ onDecode: () => { locked = true; } }) });
  markSeeded(interrupted); write(interrupted, '合成图片.png');
  await assert.rejects(interrupted.library.list({ check: () => { if (locked) throw new Error('课堂已锁定'); } }), /课堂已锁定/);
});

test('main avatar commands use the existing lock and restore guards and can only open the known folder', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/main.cjs'), 'utf8');
  const functionSource = source.slice(source.indexOf('async function fileCommand('), source.indexOf('\napp.whenReady()'));
  let locked = false, blocked = false, generation = 4, listed = 0, opened = [];
  const knownDirectory = path.join(os.tmpdir(), 'synthetic-known-avatar-directory');
  const scope = { lockRevision: 1, state: {}, get store() { return { blocked }; },
    assertUnlocked: () => { if (locked) throw new Error('课堂已锁定'); },
    assertRestoreGeneration: request => { if (request._restoreGeneration !== generation) throw new Error('备份已恢复'); }, panelId: () => 'main',
    avatarLibrary: { list: async ({ check }) => { check(); listed++; return { items: [] }; }, refresh: async ({ check }) => { check(); listed++; return { items: [] }; }, openFolder: async ({ check }) => { check(); return knownDirectory; } },
    shell: { openPath: async value => { opened.push(value); return ''; } }
  };
  vm.runInNewContext(functionSource + '\nthis.run = fileCommand;', scope);
  await scope.run({}, { command: 'avatars-list', _restoreGeneration: 4 }); assert.equal(listed, 1);
  await scope.run({}, { command: 'avatar-open-folder', _restoreGeneration: 4, path: '/arbitrary', directory: 'https://example.com' });
  assert.deepEqual(opened, [knownDirectory]);
  locked = true; await assert.rejects(scope.run({}, { command: 'avatars-list', _restoreGeneration: 4 }), /课堂已锁定/);
  locked = false; blocked = true; await assert.rejects(scope.run({}, { command: 'avatars-list', _restoreGeneration: 4 }), /新版存档/);
  blocked = false; generation = 5; await assert.rejects(scope.run({}, { command: 'avatars-refresh', _restoreGeneration: 4 }), /备份已恢复/);
  assert.equal(listed, 1);
});

test('preload avatar commands capture current restore generation without creating action receipts', async () => {
  const calls = [], listeners = new Map(); let api;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/preload.cjs'), 'utf8'), { crypto: { randomUUID }, require: () => ({
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: { on: (name, callback) => listeners.set(name, callback), invoke: async (channel, request) => { calls.push({ channel, request }); return {}; } }
  }) });
  listeners.get('state:changed')({}, { revision: 8 }, { restoreGeneration: 3 });
  for (const command of ['avatars-list', 'avatars-refresh', 'avatar-open-folder']) await api.file({ command });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.channel === 'file:command' && call.request._restoreGeneration === 3 && !call.request._transportId));
});
