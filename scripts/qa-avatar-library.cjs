'use strict';

// Synthetic avatar-library validation with actual Electron nativeImage and a
// minimal ASAR. Does not open classroom windows or use existing user data.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts/rc14/avatar-library');
const sources = ['src/avatar-library.cjs', 'src/photo-batch.cjs', 'src/io.cjs', 'src/pet-art.js'];
const sha = value => createHash('sha256').update(value).digest('hex');

if (!process.versions.electron) {
  (async () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-avatar-asar-'));
    fs.mkdirSync(output, { recursive: true });
    try {
      const staging = path.join(temporary, 'package'), archive = path.join(temporary, 'app.asar');
      fs.mkdirSync(path.join(staging, 'src'), { recursive: true });
      for (const file of sources) fs.copyFileSync(path.join(root, file), path.join(staging, file));
      fs.cpSync(path.join(root, 'assets/avatar-defaults'), path.join(staging, 'assets/avatar-defaults'), { recursive: true });
      await require('@electron/asar').createPackage(staging, archive);
      const result = require('node:child_process').spawnSync(require('electron'), ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu', __filename, archive, temporary], {
        cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
        env: { ...process.env, FLOWER_AVATAR_QA_ASAR: archive, FLOWER_AVATAR_QA_DIRECTORY: temporary, XDG_CACHE_HOME: '/tmp/flower-cache', ELECTRON_CACHE: '/tmp/flower-electron-cache' }
      });
      fs.writeFileSync(path.join(output, 'native-asar.log'), (result.stdout || '') + (result.stderr || ''));
      console.log(result.stdout || '');
      if (result.error || result.status !== 0) console.error(result.error?.message || result.stderr);
      process.exitCode = result.error || result.status !== 0 ? 1 : 0;
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, nativeImage } = require('electron');
  const archive = process.env.FLOWER_AVATAR_QA_ASAR, temporary = process.env.FLOWER_AVATAR_QA_DIRECTORY;
  app.setPath('userData', path.join(temporary, 'decoder-profile'));
  app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
  const checks = [];
  const sourceHashes = Object.fromEntries(sources.map(file => [file, sha(fs.readFileSync(path.join(archive, file)))]));
  async function check(name, fn) {
    try { const detail = await fn(); checks.push({ name, status: 'passed', detail }); console.log('AVATAR_LIBRARY_PASS', name); }
    catch (error) { checks.push({ name, status: 'failed', error: error.stack }); console.error('AVATAR_LIBRARY_FAIL', name, error.stack); }
  }
  const timeout = setTimeout(() => { console.error('AVATAR_LIBRARY_TIMEOUT'); app.exit(3); }, 50_000);
  app.whenReady().then(async () => {
    const { createAvatarLibrary, SEED_MARKER } = require(path.join(archive, 'src/avatar-library.cjs'));
    const defaultsDirectory = path.join(archive, 'assets/avatar-defaults');
    const dataDirectory = path.join(temporary, 'normal-persistent-user-data');
    const library = createAvatarLibrary({ dataDirectory, defaultsDirectory, nativeImage });
    let first;
    await check('ASAR defaults seed 120 editable PNG files outside the archive and native decode to bounded snapshots', async () => {
      assert.equal(fs.existsSync(dataDirectory), false);
      first = await library.list();
      assert.equal(first.items.length, 120, first.warning);
      assert.equal(first.warning, ''); assert.equal(first.skipped, 0);
      assert.equal(first.directory, path.join(dataDirectory, '头像'));
      assert.ok(fs.existsSync(path.join(dataDirectory, SEED_MARKER)));
      assert.equal(fs.readdirSync(first.directory).length, 120);
      for (const item of first.items) {
        const image = nativeImage.createFromDataURL(item.photo);
        assert.equal(image.isEmpty(), false);
        assert.deepEqual(image.getSize(), { width: 256, height: 256 });
        assert.equal(sha(fs.readFileSync(path.join(first.directory, item.fileName))), sha(fs.readFileSync(path.join(defaultsDirectory, item.fileName))));
      }
      return { items: first.items.length, width: 256, height: 256, copiedBytesPreserved: true };
    });
    await check('Real JPEG and WebP additions appear only after explicit refresh, while corrupt and animated data is excluded', async () => {
      assert.ok(first?.items.length === 120);
      const image = nativeImage.createFromDataURL(first.items[0].photo);
      fs.writeFileSync(path.join(first.directory, '自选照片.jpg'), image.toJPEG(90));
      fs.writeFileSync(path.join(first.directory, '自选静态.webp'), Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvC8AEAAdQyeYUsP+BiOh/AAA=', 'base64'));
      fs.writeFileSync(path.join(first.directory, '损坏图片.png'), Buffer.from('not an image'));
      const animated = Buffer.alloc(30); animated.write('RIFF'); animated.writeUInt32LE(22, 4); animated.write('WEBPVP8X', 8); animated.writeUInt32LE(10, 16); animated[20] = 2;
      fs.writeFileSync(path.join(first.directory, '动画.webp'), animated);
      assert.equal((await library.list()).items.length, 120);
      const refreshed = await library.refresh();
      assert.equal(refreshed.items.length, 122, refreshed.warning);
      assert.equal(refreshed.skipped, 2);
      const webp = refreshed.items.find(item => item.fileName === '自选静态.webp');
      assert.deepEqual(nativeImage.createFromDataURL(webp.photo).getSize(), { width: 12, height: 20 });
      return { items: 122, skipped: 2, webpDecoded: true };
    });
    await check('Deleting originals keeps selected embedded snapshots intact and restart does not seed again', async () => {
      assert.ok(first?.items.length === 120);
      const chosen = first.items[0], snapshot = chosen.photo;
      fs.unlinkSync(path.join(first.directory, chosen.fileName));
      const restarted = await createAvatarLibrary({ dataDirectory, defaultsDirectory, nativeImage }).list();
      assert.equal(restarted.items.length, 121);
      assert.equal(restarted.items.some(item => item.fileName === chosen.fileName), false);
      assert.equal(nativeImage.createFromDataURL(snapshot).isEmpty(), false);
      assert.equal(chosen.photo, snapshot);
      return { restartItems: 121, snapshotDecodes: true };
    });
    await check('Bundled default files and backend code are unchanged after seed and refresh', async () => {
      const sourceNow = Object.fromEntries(sources.map(file => [file, sha(fs.readFileSync(path.join(root, file)))]));
      assert.deepEqual(sourceNow, sourceHashes);
      return sourceHashes;
    });
    fs.writeFileSync(path.join(output, 'native-asar-results.json'), JSON.stringify({ time: new Date().toISOString(), syntheticDataOnly: true, platform: process.platform, electron: process.versions.electron, realAsar: true, actualNativeImage: true, checks, sourceHashes }, null, 2));
    console.log('AVATAR_LIBRARY_SUMMARY', checks.filter(item => item.status === 'passed').length, 'passed', checks.filter(item => item.status === 'failed').length, 'failed');
    clearTimeout(timeout); app.exit(checks.some(item => item.status === 'failed') ? 1 : 0);
  }).catch(error => { console.error(error); clearTimeout(timeout); app.exit(2); });
}
