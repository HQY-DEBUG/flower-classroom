'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { prepareBatchPhotos, decodePhotoBytes, LIMITS } = require('../src/photo-batch.cjs');

// Only synthetic bytes are used. These tests isolate matching, boundaries,
// safe file reads and resize arguments. scripts/qa-photo-batch.cjs separately
// verifies actual PNG/JPEG/WebP decoding and JPEG dimensions with Electron.
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1]);
const JPEG = Buffer.from([255, 216, 255, 224, 0, 1, 255, 217]);
const WEBP = Buffer.from('RIFF1234WEBPsynthetic');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const student = (id, name, photo = '') => ({ id, name, photo });

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-synthetic-photo-batch-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  return folder;
}
function write(folder, filename, bytes = PNG) { fs.writeFileSync(path.join(folder, filename), bytes); }
function fakeImage({ width = 640, height = 480, empty = false, output = JPEG, onDecode } = {}) {
  const calls = { decoded: [], resized: [], qualities: [] };
  const nativeImage = {
    createFromBuffer(bytes) {
      calls.decoded.push(Buffer.from(bytes));
      if (onDecode) onDecode(calls.decoded.length);
      return {
        isEmpty: () => empty,
        getSize: () => ({ width, height }),
        resize(options) {
          calls.resized.push(options);
          const scale = options.width ? options.width / width : options.height / height;
          return {
            isEmpty: () => false,
            getSize: () => ({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }),
            toJPEG(quality) { calls.qualities.push(quality); return output; }
          };
        }
      };
    }
  };
  return { nativeImage, calls };
}

test('Chinese filename matching prepares JPEG updates and leaves students/source files unchanged', async t => {
  const folder = fixture(t);
  write(folder, '合成小禾.PNG'); write(folder, '合成小雨.jpeg', JPEG);
  const students = Object.freeze([Object.freeze(student('s_a', '合成小禾', 'old')), Object.freeze(student('s_b', '合成小雨'))]);
  const original = fs.readdirSync(folder).map(file => [file, sha(fs.readFileSync(path.join(folder, file)))]);
  const { nativeImage, calls } = fakeImage();
  const report = await prepareBatchPhotos(folder, students, nativeImage);
  assert.deepEqual(report.counts, { success: 2, failed: 0, skipped: 0 });
  assert.equal(report.updates.length, 2);
  assert.deepEqual(report.updates.map(update => update.id).sort(), ['s_a', 's_b']);
  assert.ok(report.updates.every(update => update.photo === `data:image/jpeg;base64,${JPEG.toString('base64')}`));
  assert.deepEqual(calls.resized, [{ width: 256, quality: 'best' }, { width: 256, quality: 'best' }]);
  assert.deepEqual(calls.qualities, [85, 85]);
  assert.deepEqual(fs.readdirSync(folder).map(file => [file, sha(fs.readFileSync(path.join(folder, file)))]), original);
  assert.equal(students[0].photo, 'old');
});

test('NFC matching handles decomposed names and does not trim names or fold their case', async t => {
  const folder = fixture(t);
  write(folder, '合成Café.webp', WEBP); write(folder, ' 合成同学.png'); write(folder, 'synthetic.png');
  const { nativeImage } = fakeImage();
  const report = await prepareBatchPhotos(folder, [student('s_a', '合成Cafe\u0301'), student('s_b', '合成同学'), student('s_c', 'Synthetic')], nativeImage);
  assert.deepEqual(report.counts, { success: 1, failed: 0, skipped: 2 });
  assert.equal(report.updates[0].id, 's_a');
  assert.equal(report.results.find(result => result.status === 'success').name, '合成Café');
});

test('same student names, including NFC-equivalent names, are skipped without choosing an ID', async t => {
  const folder = fixture(t);
  write(folder, '合成重名.png'); write(folder, 'Café.png');
  const { nativeImage, calls } = fakeImage();
  const report = await prepareBatchPhotos(folder, [student('a', '合成重名'), student('b', '合成重名'), student('c', 'Café'), student('d', 'Cafe\u0301')], nativeImage);
  assert.deepEqual(report.counts, { success: 0, failed: 0, skipped: 2 });
  assert.deepEqual(report.updates, []); assert.equal(calls.decoded.length, 0);
  assert.ok(report.results.every(result => /同名学生/.test(result.reason)));
});

test('multiple image extensions or NFC-equivalent basenames are all skipped as ambiguous', async t => {
  const folder = fixture(t);
  write(folder, '合成同学.jpg', JPEG); write(folder, '合成同学.png');
  write(folder, 'Café.png'); write(folder, 'Cafe\u0301.webp', WEBP);
  const { nativeImage, calls } = fakeImage();
  const report = await prepareBatchPhotos(folder, [student('a', '合成同学'), student('b', 'Café')], nativeImage);
  assert.deepEqual(report.counts, { success: 0, failed: 0, skipped: 4 });
  assert.ok(report.results.every(result => /多张同名照片/.test(result.reason)));
  assert.equal(calls.decoded.length, 0);
});

test('unsupported files, unmatched photos and folders count as skipped, with no recursion', async t => {
  const folder = fixture(t);
  write(folder, '说明.txt', Buffer.from('synthetic')); write(folder, '合成同学.svg', Buffer.from('<svg/>'));
  write(folder, '未匹配.png'); fs.mkdirSync(path.join(folder, '子目录'));
  fs.mkdirSync(path.join(folder, '合成同学.png')); write(path.join(folder, '子目录'), '合成同学.jpg', JPEG);
  const { nativeImage, calls } = fakeImage();
  const report = await prepareBatchPhotos(folder, [student('s', '合成同学')], nativeImage);
  assert.deepEqual(report.counts, { success: 0, failed: 0, skipped: 5 });
  assert.equal(calls.decoded.length, 0); assert.equal(report.results.length, 5);
});

test('only the final extension is removed and object-like names are ordinary names', async t => {
  const folder = fixture(t); write(folder, '合成.同学.JpG', JPEG); write(folder, '__proto__.png');
  const { nativeImage } = fakeImage();
  const report = await prepareBatchPhotos(folder, [student('a', '合成.同学'), student('b', '__proto__')], nativeImage);
  assert.deepEqual(report.counts, { success: 2, failed: 0, skipped: 0 });
});

test('one invalid signature fails while independent valid photos still succeed', async t => {
  const folder = fixture(t); write(folder, '合成坏图.png', Buffer.from('not an image')); write(folder, '合成好图.jpg', JPEG);
  const { nativeImage, calls } = fakeImage();
  const report = await prepareBatchPhotos(folder, [student('a', '合成坏图'), student('b', '合成好图')], nativeImage);
  assert.deepEqual(report.counts, { success: 1, failed: 1, skipped: 0 });
  assert.equal(report.updates[0].id, 'b'); assert.equal(calls.decoded.length, 1);
  assert.match(report.results.find(result => result.status === 'failed').reason, /格式无效/);
});

test('a signature-only corrupt image fails when nativeImage cannot decode it', async t => {
  const folder = fixture(t); write(folder, '合成损坏.png', PNG);
  const { nativeImage } = fakeImage({ empty: true });
  const report = await prepareBatchPhotos(folder, [student('a', '合成损坏')], nativeImage);
  assert.deepEqual(report.counts, { success: 0, failed: 1, skipped: 0 });
  assert.match(report.results[0].reason, /无法解码/);
});

test('input exactly at 1400 KiB is accepted and one byte over fails before decoding', async t => {
  const folder = fixture(t);
  const exact = Buffer.alloc(LIMITS.photoBytes); PNG.copy(exact); exact.writeUInt32BE(640, 16); exact.writeUInt32BE(480, 20);
  write(folder, '合成上限.png', exact); write(folder, '合成超限.png', Buffer.concat([exact, Buffer.from([0])]));
  const { nativeImage, calls } = fakeImage();
  const report = await prepareBatchPhotos(folder, [student('a', '合成上限'), student('b', '合成超限')], nativeImage);
  assert.deepEqual(report.counts, { success: 1, failed: 1, skipped: 0 });
  assert.equal(calls.decoded.length, 1); assert.equal(report.updates[0].id, 'a');
  assert.match(report.results.find(result => result.status === 'failed').reason, /1.4 MB/);
});

test('unmatched corrupt and oversized photos are skipped instead of reported as failed', async t => {
  const folder = fixture(t); write(folder, '无匹配坏图.jpg', Buffer.from('corrupt'));
  write(folder, '无匹配大图.png'); fs.truncateSync(path.join(folder, '无匹配大图.png'), LIMITS.photoBytes + 1);
  const { nativeImage, calls } = fakeImage();
  const report = await prepareBatchPhotos(folder, [student('a', '合成同学')], nativeImage);
  assert.deepEqual(report.counts, { success: 0, failed: 0, skipped: 2 }); assert.equal(calls.decoded.length, 0);
});

test('folder source total over 50 MiB rejects before decoding any matching photo', async t => {
  const folder = fixture(t); write(folder, 'A.png'); write(folder, 'Z.png');
  fs.truncateSync(path.join(folder, 'Z.png'), LIMITS.totalBytes);
  const { nativeImage, calls } = fakeImage();
  await assert.rejects(prepareBatchPhotos(folder, [student('a', 'A')], nativeImage), /总量不能超过 50 MB/);
  assert.equal(calls.decoded.length, 0);
});

test('exactly 50 MiB of source files passes the total bound and retains per-file failure reporting', async t => {
  const folder = fixture(t); write(folder, '合成超大.png'); fs.truncateSync(path.join(folder, '合成超大.png'), LIMITS.totalBytes);
  const { nativeImage, calls } = fakeImage();
  const report = await prepareBatchPhotos(folder, [student('a', '合成超大')], nativeImage);
  assert.deepEqual(report.counts, { success: 0, failed: 1, skipped: 0 }); assert.equal(calls.decoded.length, 0);
});

test('300 student inputs succeed while 301 and duplicate IDs reject without mutation', async t => {
  const folder = fixture(t), { nativeImage } = fakeImage();
  const students = Array.from({ length: 300 }, (_, i) => student(`s_${i}`, `合成同学${i}`));
  for (let i = 0; i < 300; i++) write(folder, `合成同学${i}.png`);
  const before = JSON.stringify(students);
  const report = await prepareBatchPhotos(folder, students, nativeImage);
  assert.deepEqual(report.counts, { success: 300, failed: 0, skipped: 0 });
  assert.equal(new Set(report.updates.map(update => update.id)).size, 300);
  assert.equal(JSON.stringify(students), before);
  await assert.rejects(prepareBatchPhotos(folder, [...students, student('s_300', '301')], nativeImage), /300/);
  await assert.rejects(prepareBatchPhotos(folder, [student('a', '合成甲'), student('a', '合成乙')], nativeImage), /编号不能重复/);
});

test('directory enumeration is bounded at 3000 entries, including unsupported files', async t => {
  const folder = fixture(t), { nativeImage, calls } = fakeImage();
  for (let i = 0; i < LIMITS.entries + 1; i++) write(folder, `${i}.txt`, Buffer.alloc(0));
  await assert.rejects(prepareBatchPhotos(folder, [], nativeImage), /3000/); assert.equal(calls.decoded.length, 0);
});

test('final total photo accounting includes untouched students and permits replacement to free space', async t => {
  const folder = fixture(t); write(folder, '合成新图.png');
  const { nativeImage } = fakeImage();
  const large = 'x'.repeat(LIMITS.totalBytes);
  await assert.rejects(prepareBatchPhotos(folder, [student('a', '合成新图'), student('b', '保留照片', large)], nativeImage), /全部照片数据不能超过 50 MB/);
  const report = await prepareBatchPhotos(folder, [student('a', '合成新图', large)], nativeImage);
  assert.equal(report.counts.success, 1);
  assert.equal(report.updates[0].photo.length, `data:image/jpeg;base64,${JPEG.toString('base64')}`.length);
});

test('portrait and small images use the longest edge without upscaling', async t => {
  const folder = fixture(t); write(folder, '合成头像.png');
  for (const [width, height, expected] of [[80, 240, { height: 240, quality: 'best' }], [480, 960, { height: 256, quality: 'best' }], [40, 40, { width: 40, quality: 'best' }]]) {
    const { nativeImage, calls } = fakeImage({ width, height });
    assert.equal((await prepareBatchPhotos(folder, [student('a', '合成头像')], nativeImage)).counts.success, 1);
    assert.deepEqual(calls.resized, [expected]);
  }
});

test('bad dimensions, a thrown decoder and invalid JPEG output become per-file failures', async t => {
  const folder = fixture(t); write(folder, '合成头像.png');
  for (const nativeImage of [fakeImage({ width: 0 }).nativeImage, fakeImage({ width: Infinity }).nativeImage,
    fakeImage({ width: 20000 }).nativeImage, fakeImage({ width: 10000, height: 10000 }).nativeImage,
    fakeImage({ output: PNG }).nativeImage, fakeImage({ output: Buffer.alloc(0) }).nativeImage,
    { createFromBuffer() { throw new Error('合成解码失败'); } }]) {
    const report = await prepareBatchPhotos(folder, [student('a', '合成头像')], nativeImage);
    assert.deepEqual(report.counts, { success: 0, failed: 1, skipped: 0 }); assert.deepEqual(report.updates, []);
  }
});

test('shared single-photo decoder produces the same verified JPEG and rejects invalid input', async () => {
  const { nativeImage, calls } = fakeImage();
  assert.equal(await decodePhotoBytes(PNG, nativeImage), `data:image/jpeg;base64,${JPEG.toString('base64')}`);
  assert.deepEqual(calls.qualities, [85]);
  await assert.rejects(decodePhotoBytes(Buffer.from('invalid'), nativeImage), /格式无效/);
  await assert.rejects(decodePhotoBytes(PNG, null), /解码器/);
});

test('oversized advertised PNG/JPEG/WebP dimensions reject before a native decoder allocation', async () => {
  const png = Buffer.alloc(24); PNG.subarray(0, 8).copy(png); png.writeUInt32BE(20000, 16); png.writeUInt32BE(20000, 20);
  const jpeg = Buffer.from([255, 216, 255, 192, 0, 8, 8, 0x4e, 0x20, 0x4e, 0x20, 0]);
  const webp = Buffer.alloc(30); webp.write('RIFF', 0); webp.write('WEBPVP8X', 8); webp.writeUIntLE(19999, 24, 3); webp.writeUIntLE(19999, 27, 3);
  const { nativeImage, calls } = fakeImage();
  for (const bytes of [png, jpeg, webp]) await assert.rejects(decodePhotoBytes(bytes, nativeImage), /尺寸过大/);
  assert.equal(calls.decoded.length, 0);
});

test('file symlinks are skipped, and directory or ancestor symlinks are rejected', async t => {
  const root = fixture(t), folder = path.join(root, 'photos'); fs.mkdirSync(folder);
  write(root, 'external.png'); fs.symlinkSync(path.join(root, 'external.png'), path.join(folder, '合成头像.png'));
  const { nativeImage, calls } = fakeImage();
  const report = await prepareBatchPhotos(folder, [student('a', '合成头像')], nativeImage);
  assert.deepEqual(report.counts, { success: 0, failed: 0, skipped: 1 }); assert.match(report.results[0].reason, /软链接/);
  fs.symlinkSync(folder, path.join(root, 'linked-photos'), 'dir');
  await assert.rejects(prepareBatchPhotos(path.join(root, 'linked-photos'), [], nativeImage), /软链接/);
  fs.mkdirSync(path.join(folder, 'child'));
  await assert.rejects(prepareBatchPhotos(path.join(root, 'linked-photos', 'child'), [], nativeImage), /软链接/);
  assert.equal(calls.decoded.length, 0);
});

test('a source changed to a symlink after enumeration fails without decoding the link target', async t => {
  const root = fixture(t), folder = path.join(root, 'photos'); fs.mkdirSync(folder);
  write(root, 'external.png'); write(folder, 'A.png'); write(folder, 'B.png');
  const { nativeImage, calls } = fakeImage({ onDecode(n) {
    if (n === 1) { fs.unlinkSync(path.join(folder, 'B.png')); fs.symlinkSync(path.join(root, 'external.png'), path.join(folder, 'B.png')); }
  } });
  const report = await prepareBatchPhotos(folder, [student('a', 'A'), student('b', 'B')], nativeImage);
  assert.deepEqual(report.counts, { success: 1, failed: 1, skipped: 0 });
  assert.equal(calls.decoded.length, 1); assert.equal(report.updates[0].id, 'a');
});

test('a disappearing photo fails independently and errors do not leak an absolute source path', async t => {
  const folder = fixture(t); write(folder, 'A.png'); write(folder, 'B.png');
  const { nativeImage } = fakeImage({ onDecode(n) { if (n === 1) fs.unlinkSync(path.join(folder, 'B.png')); } });
  const report = await prepareBatchPhotos(folder, [student('a', 'A'), student('b', 'B')], nativeImage);
  assert.deepEqual(report.counts, { success: 1, failed: 1, skipped: 0 });
  assert.equal(JSON.stringify(report).includes(folder), false);
});

test('empty folders/students have honest counts; missing/canceled paths are caller errors', async t => {
  const folder = fixture(t), { nativeImage } = fakeImage();
  assert.deepEqual(await prepareBatchPhotos(folder, [], nativeImage), { updates: [], results: [], counts: { success: 0, failed: 0, skipped: 0 } });
  write(folder, '合成头像.png');
  assert.deepEqual((await prepareBatchPhotos(folder, [], nativeImage)).counts, { success: 0, failed: 0, skipped: 1 });
  for (const canceled of [undefined, null, '']) await assert.rejects(prepareBatchPhotos(canceled, [], nativeImage), /取消选择由调用者处理/);
  await assert.rejects(prepareBatchPhotos(path.join(folder, 'missing'), [], nativeImage));
  await assert.rejects(prepareBatchPhotos(path.join(folder, '合成头像.png'), [], nativeImage), /有效的照片文件夹/);
  await assert.rejects(prepareBatchPhotos(folder, [], null), /解码器/);
});

test('repeat imports report the same deterministic results and never edit the source directory', async t => {
  const folder = fixture(t); write(folder, 'Z.png'); write(folder, 'A.png'); write(folder, 'M.txt', Buffer.from('synthetic'));
  const { nativeImage } = fakeImage(), students = [student('a', 'A'), student('z', 'Z')];
  const before = fs.readdirSync(folder).map(file => [file, sha(fs.readFileSync(path.join(folder, file)))]);
  const first = await prepareBatchPhotos(folder, students, nativeImage);
  assert.deepEqual(await prepareBatchPhotos(folder, students, nativeImage), first);
  assert.deepEqual(first.results.map(result => result.file), ['A.png', 'M.txt', 'Z.png']);
  assert.equal(first.results.length, Object.values(first.counts).reduce((a, b) => a + b, 0));
  assert.deepEqual(fs.readdirSync(folder).map(file => [file, sha(fs.readFileSync(path.join(folder, file)))]), before);
});
