'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { prepareFolderResources, verifyFolderResources } = require('../scripts/prepare-folder-resources.cjs');
const { createAvatarLibrary, SEED_MARKER } = require('../src/avatar-library.cjs');
const { parsePortableConfig, DEFAULT_CONFIG } = require('../src/portable-config.cjs');
const { isInitialBytes, SHEET_NAME } = require('../src/score-rule-workbook.cjs');
const manifest = require('../assets/avatar-defaults/manifest.json');
const defaultsDirectory = path.resolve(__dirname, '../assets/avatar-defaults');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const nativeImage = { createFromBuffer(bytes) { return { isEmpty: () => false, getSize: () => ({ width: 384, height: 384 }), resize() { return { isEmpty: () => false, getSize: () => ({ width: 256, height: 256 }), toJPEG: () => Buffer.concat([Buffer.from([255, 216, 255]), createHash('sha256').update(bytes).digest()]) }; } }; } };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-initial-package-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const appOutDir = path.join(root, 'fresh-folder');
  return { root, appOutDir };
}

test('fresh extraction resources contain all originals, real editable defaults and empty data/backup folders before launch', async t => {
  const f = fixture(t), result = await prepareFolderResources(f);
  assert.equal(result.avatarCount, 120);
  assert.deepEqual(fs.readdirSync(f.appOutDir).sort(), ['头像', SEED_MARKER, '备份', '数据', '计分卡片.xlsx', '配置.txt'].sort());
  assert.deepEqual(fs.readdirSync(path.join(f.appOutDir, '数据')), []);
  assert.deepEqual(fs.readdirSync(path.join(f.appOutDir, '备份')), []);
  for (const file of manifest.files) {
    const actual = fs.readFileSync(path.join(f.appOutDir, '头像', file.fileName));
    assert.equal(sha256(actual), file.sha256);
    assert.equal(actual.length, file.bytes);
  }
  assert.deepEqual(parsePortableConfig(fs.readFileSync(path.join(f.appOutDir, '配置.txt'), 'utf8')), DEFAULT_CONFIG);
  const workbookBytes = fs.readFileSync(path.join(f.appOutDir, '计分卡片.xlsx'));
  assert.equal(isInitialBytes(workbookBytes), true);
  const workbook = new (require('exceljs').Workbook)();
  await workbook.xlsx.load(workbookBytes);
  const rules = workbook.getWorksheet(SHEET_NAME);
  assert.ok(rules && rules.rowCount > 1);
  assert.ok(workbook.worksheets.length >= 2);
  const again = await prepareFolderResources(f);
  assert.equal(again.workbookSha256, result.workbookSha256);
  assert.deepEqual(verifyFolderResources(f.appOutDir), result);
});

test('packaged seed record preserves a prelaunch deletion and relocation without previous-root dependence', async t => {
  const f = fixture(t); await prepareFolderResources(f);
  const removed = manifest.files[0].fileName;
  fs.unlinkSync(path.join(f.appOutDir, '头像', removed));
  const moved = path.join(f.root, 'moved-whole-folder');
  fs.renameSync(f.appOutDir, moved);
  const library = createAvatarLibrary({resourceDirectory: moved, defaultsDirectory, nativeImage});
  const result = await library.list();
  assert.equal(result.items.length, 119);
  assert.equal(result.items.some(item => item.fileName === removed), false);
  assert.equal(fs.existsSync(f.appOutDir), false);
  assert.deepEqual(fs.readdirSync(path.join(moved, '数据')), ['avatar-location-v2.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(moved, '数据', 'avatar-location-v2.json'))).directory, '头像');
});

test('preparation never overwrites a used classroom folder or changed sibling resource', async t => {
  const f = fixture(t); await prepareFolderResources(f);
  const config = path.join(f.appOutDir, '配置.txt');
  const edited = 'initialZoom=1.2\n'; fs.writeFileSync(config, edited);
  await assert.rejects(prepareFolderResources(f), /已修改.*干净输出目录/);
  assert.equal(fs.readFileSync(config, 'utf8'), edited);
  fs.writeFileSync(path.join(f.appOutDir, '数据', 'classroom.json'), 'synthetic existing classroom');
  await assert.rejects(prepareFolderResources(f), /数据文件夹必须为空/);
  assert.equal(fs.readFileSync(path.join(f.appOutDir, '数据', 'classroom.json'), 'utf8'), 'synthetic existing classroom');
});

test('preparation rejects visible Markdown notes and redirected resource directories', async t => {
  const f = fixture(t); await prepareFolderResources(f);
  fs.writeFileSync(path.join(f.appOutDir, '使用说明.md'), 'obsolete documentation');
  assert.throws(() => verifyFolderResources(f.appOutDir), /Markdown/);
  const external = path.join(f.root, 'outside'); fs.mkdirSync(external);
  const bad = path.join(f.root, 'redirected-output'); fs.mkdirSync(bad);
  fs.symlinkSync(external, path.join(bad, '头像'), 'dir');
  await assert.rejects(prepareFolderResources({appOutDir: bad}), /普通文件夹/);
  assert.deepEqual(fs.readdirSync(external), []);
});
