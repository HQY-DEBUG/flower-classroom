'use strict';

// RC15 deliberately replaces RC14's implicit AppData/old-folder migration.
// Only explicit import owns old data; the avatar library is folder-local.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createAvatarLibrary, initialSeedMarker, FOLDER_NAME, SEED_MARKER, LEGACY_SEED_MARKER, LOCATION_INDEX, DATA_FOLDER_NAME } = require('../src/avatar-library.cjs');
const manifest = require('../assets/avatar-defaults/manifest.json');
const defaultsDirectory = path.resolve(__dirname, '../assets/avatar-defaults');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRj8AAAAASUVORK5CYII=', 'base64');
const nativeImage = { createFromBuffer(bytes) { return { isEmpty: () => false, getSize: () => ({ width: 384, height: 384 }), resize() { return { isEmpty: () => false, getSize: () => ({ width: 256, height: 256 }), toJPEG: () => Buffer.concat([Buffer.from([255, 216, 255]), createHash('sha256').update(bytes).digest()]) }; } }; } };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-folder-avatar-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const legacyDataDirectory = path.join(root, 'AppData'), resourceDirectory = path.join(root, 'program-rc15');
  const config = { resourceDirectory, legacyDataDirectory, defaultsDirectory, nativeImage };
  return { root, legacyDataDirectory, resourceDirectory, directory: path.join(resourceDirectory, FOLDER_NAME), metadata: path.join(resourceDirectory, DATA_FOLDER_NAME, LOCATION_INDEX), config, library: createAvatarLibrary(config) };
}
function stagedLibrary(f) {
  fs.mkdirSync(f.directory, { recursive: true });
  fs.mkdirSync(path.join(f.resourceDirectory, DATA_FOLDER_NAME), { recursive: true });
  for (const { fileName } of manifest.files) fs.copyFileSync(path.join(defaultsDirectory, fileName), path.join(f.directory, fileName));
  fs.writeFileSync(path.join(f.resourceDirectory, SEED_MARKER), initialSeedMarker());
}

test('source-only first use creates all 120 defaults with relative metadata in local 数据 and no AppData access', async t => {
  const f = fixture(t);
  assert.equal(fs.existsSync(f.resourceDirectory), false);
  const first = await f.library.list();
  assert.equal(first.items.length, 120); assert.equal(first.warning, '');
  assert.equal(fs.existsSync(f.legacyDataDirectory), false);
  const index = JSON.parse(fs.readFileSync(f.metadata));
  assert.equal(index.directory, '头像'); assert.equal(index.seededFiles.length, 120); assert.equal(index.complete, true);
  assert.equal(fs.readFileSync(f.metadata, 'utf8').includes(f.resourceDirectory), false);
});

test('AppData avatars and absolute old-location indexes are never discovered or migrated automatically', async t => {
  const f = fixture(t), source = path.join(f.legacyDataDirectory, 'avatars');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, '旧自选.png'), PNG);
  fs.writeFileSync(path.join(f.legacyDataDirectory, LEGACY_SEED_MARKER), 'flower-avatar-library-v1:started\nflower-avatar-library-v1:complete\n');
  fs.writeFileSync(path.join(f.legacyDataDirectory, LOCATION_INDEX), JSON.stringify({version: 2, directory: source, seededFiles: manifest.files.map(file => file.fileName)}));
  const before = fs.readFileSync(path.join(f.legacyDataDirectory, LOCATION_INDEX));
  const touched = [];
  const io = new Proxy(fs.promises, {get(target, key) {
    if (typeof target[key] !== 'function') return target[key];
    return async (...args) => {
      if (typeof args[0] === 'string' && args[0].startsWith(f.legacyDataDirectory)) {touched.push(args[0]); throw new Error('Unrequested old folder access');}
      return target[key](...args);
    };
  }});
  const result = await createAvatarLibrary({...f.config, io}).list();
  assert.equal(result.items.length, 120);
  assert.equal(result.items.some(item => item.fileName === '旧自选.png'), false);
  assert.deepEqual(touched, []);
  assert.deepEqual(fs.readFileSync(path.join(f.legacyDataDirectory, LOCATION_INDEX)), before);
  assert.deepEqual(fs.readFileSync(path.join(source, '旧自选.png')), PNG);
});

test('a staged fresh folder already has 120 original images and preserves deletion before first launch', async t => {
  const f = fixture(t); stagedLibrary(f);
  assert.equal(fs.readdirSync(f.directory).length, 120);
  assert.deepEqual(fs.readdirSync(path.join(f.resourceDirectory, DATA_FOLDER_NAME)), []);
  const removed = manifest.files[0].fileName;
  fs.unlinkSync(path.join(f.directory, removed));
  const result = await f.library.list();
  assert.equal(result.items.length, 119);
  assert.equal(result.items.some(item => item.fileName === removed), false);
  assert.equal((await createAvatarLibrary(f.config).list()).items.length, 119);
});

test('moving the whole folder preserves deleted defaults, custom bytes and snapshot IDs without the old location', async t => {
  const f = fixture(t); stagedLibrary(f);
  fs.writeFileSync(path.join(f.directory, '自选.png'), PNG);
  const before = await f.library.list(), selected = before.items.find(item => item.fileName === '自选.png');
  const removed = manifest.files[0].fileName;
  fs.unlinkSync(path.join(f.directory, removed));
  const destination = path.join(f.root, '搬家后的课堂');
  fs.renameSync(f.resourceDirectory, destination);
  const after = await createAvatarLibrary({...f.config, resourceDirectory: destination}).list();
  assert.equal(after.items.length, 120);
  assert.equal(after.items.some(item => item.fileName === removed), false);
  assert.deepEqual(after.items.find(item => item.fileName === '自选.png'), selected);
  assert.equal(fs.existsSync(f.resourceDirectory), false);
  assert.equal(fs.existsSync(f.legacyDataDirectory), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination, DATA_FOLDER_NAME, LOCATION_INDEX))).directory, '头像');
});

test('removing the whole staged avatar folder before launch keeps it empty without restoring the bundle', async t => {
  const f = fixture(t); stagedLibrary(f);
  fs.rmSync(f.directory, {recursive: true});
  assert.equal((await f.library.list()).items.length, 0);
  assert.equal((await createAvatarLibrary(f.config).list()).items.length, 0);
});

test('local seed history still prevents resurrection if the root marker is accidentally removed', async t => {
  const f = fixture(t); await f.library.list();
  fs.rmSync(f.directory, {recursive: true});
  fs.unlinkSync(path.join(f.resourceDirectory, SEED_MARKER));
  assert.equal((await createAvatarLibrary(f.config).list()).items.length, 0);
  assert.equal(fs.existsSync(f.legacyDataDirectory), false);
});

test('an invalid local absolute location is never followed and keeps deletions conservative', async t => {
  const f = fixture(t), external = path.join(f.root, 'previous-root');
  fs.mkdirSync(external); fs.writeFileSync(path.join(external, '私有.png'), PNG);
  fs.mkdirSync(path.dirname(f.metadata), {recursive: true});
  fs.writeFileSync(f.metadata, JSON.stringify({version: 2, directory: external, seededFiles: []}));
  const result = await f.library.list();
  assert.equal(result.items.length, 0); assert.match(result.warning, /不会自动补回/);
  assert.deepEqual(fs.readdirSync(external), ['私有.png']);
});

test('in-place fixed-catalog upgrade adds only new names, respecting prior deletions', async t => {
  const f = fixture(t); fs.mkdirSync(f.directory, {recursive: true});
  const oldFiles = manifest.files.slice(0, 40).map(item => item.fileName);
  fs.writeFileSync(path.join(f.resourceDirectory, SEED_MARKER), JSON.stringify({version: 2, seededFiles: oldFiles}) + '\nflower-avatar-library-v1:complete\n');
  const first = await f.library.list(); assert.equal(first.items.length, 80);
  fs.unlinkSync(path.join(f.directory, first.items[0].fileName));
  assert.equal((await createAvatarLibrary(f.config).list()).items.length, 79);
});

test('unwritable EXE location reports a writable-folder remedy without touching AppData', async t => {
  const f = fixture(t);
  const io = new Proxy(fs.promises, {get(target, key) {
    if (key !== 'mkdir') return target[key];
    return async (directory, options) => {if (directory === f.directory) throw Object.assign(new Error('synthetic readonly destination'), {code: 'EACCES'}); return target.mkdir(directory, options);};
  }});
  await assert.rejects(createAvatarLibrary({...f.config, io}).list(), /EXE.*不可写.*可写文件夹/);
  assert.equal(fs.existsSync(f.legacyDataDirectory), false);
});
