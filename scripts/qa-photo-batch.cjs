'use strict';

// Run: ELECTRON_CACHE=/tmp/flower-electron-cache XDG_CACHE_HOME=/tmp/flower-cache
//      node scripts/qa-photo-batch.cjs
// Standalone nativeImage checks; no classroom windows, classroom persistence,
// original QA fixtures, production user data, or real student photos are used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const electron = require('electron');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'qa-photo-batch');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = ['src/photo-batch.cjs', 'src/io.cjs', 'tests/photo-batch.test.cjs', 'scripts/qa-photo-batch.cjs'];

if (typeof electron === 'string') {
  fs.mkdirSync(output, { recursive: true });
  const resultFile = path.join(output, 'results.json');
  fs.rmSync(resultFile, { force: true });
  const run = spawnSync(electron, [...(process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : []), __filename], {
    cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ELECTRON_CACHE: process.env.ELECTRON_CACHE || '/tmp/flower-electron-cache', XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || '/tmp/flower-cache' }
  });
  fs.writeFileSync(path.join(output, 'electron.log'), (run.stdout || '') + (run.stderr || ''));
  console.log((run.stdout || '').split('\n').filter(line => /^PHOTO_BATCH_/.test(line)).join('\n'));
  if (run.error) console.error(run.error.message);
  if (run.status !== 0) console.error((run.stderr || '').slice(-5000));
  process.exitCode = !run.error && run.status === 0 && fs.existsSync(resultFile) ? 0 : 1;
} else {
  const { app, nativeImage } = electron;
  const { prepareBatchPhotos, decodePhotoBytes } = require('../src/photo-batch.cjs');
  const { createInitialState, validateState } = require('../src/core.cjs');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-native-photo-batch-'));
  app.setPath('userData', path.join(temporary, 'electron-profile'));
  app.disableHardwareAcceleration();
  app.on('window-all-closed', () => {});
  const checks = [];
  const decoderWindows = [];
  app.on('browser-window-created', (_event, window) => decoderWindows.push(window));
  const sourceHashes = Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(path.join(root, file)))]));
  const student = (id, name) => ({ id, name, photo: '' });
  const folder = name => { const dir = path.join(temporary, name); fs.mkdirSync(dir); return dir; };
  const manifest = dir => Object.fromEntries(fs.readdirSync(dir).sort().map(file => [file, sha(fs.readFileSync(path.join(dir, file)))]));
  async function check(name, run) {
    try { const detail = await run(); checks.push({ name, status: 'passed', detail }); console.log('PHOTO_BATCH_PASS', name); }
    catch (error) { checks.push({ name, status: 'failed', error: error.stack }); console.error('PHOTO_BATCH_FAIL', name, error.stack); }
  }
  function syntheticImage(width, height) {
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const n = (y * width + x) * 4;
      pixels[n] = x % 256; pixels[n + 1] = y % 256; pixels[n + 2] = (x + y) % 256; pixels[n + 3] = 255;
    }
    return nativeImage.createFromBitmap(pixels, { width, height, scaleFactor: 1 });
  }
  function decodedSize(photo) {
    assert.match(photo, /^data:image\/jpeg;base64,/);
    const result = nativeImage.createFromDataURL(photo);
    assert.equal(result.isEmpty(), false);
    return result.getSize();
  }
  const timeout = setTimeout(() => { console.error('PHOTO_BATCH_TIMEOUT'); app.exit(3); }, 50_000);
  app.whenReady().then(async () => {
    try {
      const landscape = syntheticImage(1024, 512), portrait = syntheticImage(300, 900);
      const png = landscape.toPNG(), jpeg = portrait.toJPEG(90);
      // A locally generated solid 12x20 RGB image encoded as lossless WebP.
      const webp = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvC8AEAAdQyeYUsP+BiOh/AAA=', 'base64');
      let validReport;
      await check('The installed nativeImage WebP limitation is covered by the isolated shared fallback', async () => {
        const nativeWebPWasEmpty = nativeImage.createFromBuffer(webp).isEmpty();
        const photo = await decodePhotoBytes(webp, nativeImage);
        assert.deepEqual(decodedSize(photo), { width: 12, height: 20 });
        if (nativeWebPWasEmpty) assert.ok(decoderWindows.length > 0, 'The native decoder requires the Chromium fallback');
        assert.ok(decoderWindows.every(window => window.isDestroyed()));
        return { nativeWebPWasEmpty, fallbackWindows: decoderWindows.length, allFallbackWindowsDestroyed: true };
      });
      await check('Real PNG, JPEG and WebP decode to bounded JPEG avatars', async () => {
        const dir = folder('formats');
        fs.writeFileSync(path.join(dir, '合成横图.png'), png);
        fs.writeFileSync(path.join(dir, '合成竖图.jpeg'), jpeg);
        fs.writeFileSync(path.join(dir, '合成小图.webp'), webp);
        const before = manifest(dir);
        validReport = await prepareBatchPhotos(dir, [student('a', '合成横图'), student('b', '合成竖图'), student('c', '合成小图')], nativeImage);
        assert.deepEqual(validReport.counts, { success: 3, failed: 0, skipped: 0 }, JSON.stringify(validReport.results));
        const photos = Object.fromEntries(validReport.updates.map(update => [update.id, decodedSize(update.photo)]));
        assert.deepEqual(photos.a, { width: 256, height: 128 });
        assert.deepEqual(photos.b, { width: 85, height: 256 });
        assert.deepEqual(photos.c, { width: 12, height: 20 });
        assert.deepEqual(manifest(dir), before);
        return { sourceBytes: { png: png.length, jpeg: jpeg.length, webp: webp.length }, outputSizes: photos, sourceHashes: before };
      });
      await check('Truncated native images fail without excluding another valid match', async () => {
        const dir = folder('corrupt');
        fs.writeFileSync(path.join(dir, '合成坏PNG.png'), png.subarray(0, 12));
        fs.writeFileSync(path.join(dir, '合成坏JPEG.jpg'), jpeg.subarray(0, 8));
        fs.writeFileSync(path.join(dir, '合成坏WebP.webp'), webp.subarray(0, 12));
        fs.writeFileSync(path.join(dir, '合成好图.png'), png);
        const report = await prepareBatchPhotos(dir, [student('a', '合成坏PNG'), student('b', '合成坏JPEG'), student('c', '合成坏WebP'), student('d', '合成好图')], nativeImage);
        assert.deepEqual(report.counts, { success: 1, failed: 3, skipped: 0 }); assert.equal(report.updates[0].id, 'd');
        assert.ok(report.results.filter(result => result.status === 'failed').every(result => /解码/.test(result.reason)));
        return report.results;
      });
      await check('WebP batch reuses its isolated decoder and recovers after a corrupt image', async () => {
        const dir = folder('webp-recovery'), initialWindows = decoderWindows.length;
        for (const name of ['A', 'B', 'D']) fs.writeFileSync(path.join(dir, name + '.webp'), webp);
        fs.writeFileSync(path.join(dir, 'C.webp'), webp.subarray(0, 12));
        const report = await prepareBatchPhotos(dir, ['A', 'B', 'C', 'D'].map(name => student(name.toLowerCase(), name)), nativeImage);
        assert.deepEqual(report.counts, { success: 3, failed: 1, skipped: 0 });
        if (nativeImage.createFromBuffer(webp).isEmpty()) assert.equal(decoderWindows.length - initialWindows, 2, 'Reuse until decode error, then create one clean replacement');
        assert.ok(decoderWindows.every(window => window.isDestroyed()));
        assert.deepEqual(report.updates.map(update => update.id), ['a', 'b', 'd']);
        return { counts: report.counts, decoderWindowsCreated: decoderWindows.length - initialWindows, allDestroyed: true };
      });
      await check('Native image matching preserves NFC identity and rejects ambiguous sources', async () => {
        const dir = folder('matching');
        fs.writeFileSync(path.join(dir, '合成Café.PNG'), png);
        fs.writeFileSync(path.join(dir, '合成重名.png'), png);
        fs.writeFileSync(path.join(dir, '合成重复.jpg'), jpeg);
        fs.writeFileSync(path.join(dir, '合成重复.webp'), webp);
        fs.writeFileSync(path.join(dir, '无匹配.png'), png);
        const report = await prepareBatchPhotos(dir, [student('a', '合成Cafe\u0301'), student('b', '合成重名'), student('c', '合成重名'), student('d', '合成重复')], nativeImage);
        assert.deepEqual(report.counts, { success: 1, failed: 0, skipped: 4 }); assert.equal(report.updates[0].id, 'a');
        return report.results;
      });
      await check('Prepared photos validate as classroom data without saving any classroom file', async () => {
        assert.ok(validReport);
        const state = createInitialState();
        state.students = state.students.slice(0, 3).map((s, i) => ({ ...s, photo: validReport.updates[i].photo }));
        assert.deepEqual(validateState(state).students, state.students);
        assert.equal(fs.existsSync(path.join(temporary, 'classroom.json')), false);
        assert.equal(electron.BrowserWindow.getAllWindows().length, 0, 'Temporary WebP decoder must be destroyed');
        return { validatedPhotos: state.students.length };
      });
      await check('A synthetic 300-student native batch completes and preserves all original photos', async () => {
        const dir = folder('three-hundred');
        const students = Array.from({ length: 300 }, (_, i) => student(`s_${i}`, `合成${i}`));
        const tinyPng = syntheticImage(24, 40).toPNG();
        for (const s of students) fs.writeFileSync(path.join(dir, s.name + '.png'), tinyPng);
        const before = manifest(dir), started = Date.now();
        const report = await prepareBatchPhotos(dir, students, nativeImage);
        assert.deepEqual(report.counts, { success: 300, failed: 0, skipped: 0 });
        assert.equal(new Set(report.updates.map(update => update.id)).size, 300);
        for (const update of report.updates) assert.deepEqual(decodedSize(update.photo), { width: 24, height: 40 });
        assert.deepEqual(manifest(dir), before);
        return { milliseconds: Date.now() - started, updates: report.updates.length, originalPhotosUnchanged: true };
      });
      await check('The exact batch module, validator and independent test sources stayed unchanged during QA', async () => {
        assert.ok(decoderWindows.every(window => window.isDestroyed()));
        assert.deepEqual(Object.fromEntries(sourceFiles.map(file => [file, sha(fs.readFileSync(path.join(root, file)))])), sourceHashes);
        return sourceHashes;
      });
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({
        time: new Date().toISOString(), platform: process.platform, electron: process.versions.electron,
        syntheticDataOnly: true, actualNativeImage: true, scope: 'Batch preparation only; dialog and core transaction integration are outside this standalone suite',
        checks, sourceHashes
      }, null, 2));
      console.log('PHOTO_BATCH_SUMMARY', checks.filter(check => check.status === 'passed').length, 'passed', checks.filter(check => check.status === 'failed').length, 'failed');
      clearTimeout(timeout);
      fs.rmSync(temporary, { recursive: true, force: true });
      app.exit(checks.some(check => check.status === 'failed') ? 1 : 0);
    } catch (error) { clearTimeout(timeout); console.error('PHOTO_BATCH_FATAL', error.stack); fs.rmSync(temporary, { recursive: true, force: true }); app.exit(2); }
  });
}
