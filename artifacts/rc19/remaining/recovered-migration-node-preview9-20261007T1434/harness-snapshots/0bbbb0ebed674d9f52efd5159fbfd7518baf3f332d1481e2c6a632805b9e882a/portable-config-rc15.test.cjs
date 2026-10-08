'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { DEFAULT_CONFIG, DEFAULT_CONFIG_TEXT, MAX_CONFIG_BYTES, parsePortableConfig, readPortableConfig } = require('../src/portable-config.cjs');

test('folder config template is supported configuration, with documented defaults', () => {
  assert.deepEqual(parsePortableConfig(DEFAULT_CONFIG_TEXT), DEFAULT_CONFIG);
  assert.deepEqual(parsePortableConfig(''), DEFAULT_CONFIG);
});

test('folder config accepts UTF-8 BOM, CRLF, comments, spaces and supported settings', () => {
  const parsed = parsePortableConfig('\uFEFF# 合成课堂\r\n ; 说明\r\n initialZoom = 1.25 # 放大\r\nwindowWidth=1440\r\nwindowHeight=900\r\nstartMinimized=true ; 最小化\r\n');
  assert.deepEqual(parsed, { initialZoom: 1.25, windowWidth: 1440, windowHeight: 900, startMinimized: true });
  assert.equal(Object.isFrozen(parsed), true);
  assert.deepEqual(parsePortableConfig('initialZoom=.5'), { ...DEFAULT_CONFIG, initialZoom: 0.5 });
});

test('folder config reports the exact bad line and does not accept unsupported destinations', () => {
  for (const source of ['# 合成\ninitialZoom=no', '# 合成\nwindowWidth=899', '# 合成\nwindowHeight=2161', '# 合成\nwindowHeight=840.5', '# 合成\nstartMinimized=1', '# 合成\ndataDirectory=D:\\Other', '# 合成\nwindowWidth 1280', '# 合成\ninitialZoom=Infinity', '# 合成\ninitialZoom=NaN', '# 合成\ninitialZoom=1e0', '# 合成\ninitialZoom=1=2']) {
    assert.throws(() => parsePortableConfig(source), error => error.code === 'CONFIG_INVALID' && error.line === 2);
  }
  assert.throws(() => parsePortableConfig('initialZoom=1\ninitialZoom=1.25'), /重复/);
});

test('folder config rejects oversized or non-UTF-8 input and preserves original bytes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-config-rc15-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, '配置.txt');
  for (const bytes of [Buffer.from([0xff, 0xfe, 0x41, 0x00]), Buffer.alloc(MAX_CONFIG_BYTES + 1, 0x23)]) {
    fs.writeFileSync(file, bytes);
    assert.throws(() => readPortableConfig(file), error => error.code === 'CONFIG_INVALID' && error.path === file);
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
  fs.writeFileSync(file, '\uFEFFinitialZoom=1.5', 'utf8');
  assert.equal(readPortableConfig(file).initialZoom, 1.5);
});

test('folder config distinguishes missing from unreadable files without using defaults', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-config-rc15-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, '配置.txt');
  assert.throws(() => readPortableConfig(file), { code: 'ENOENT' });
  fs.writeFileSync(file, DEFAULT_CONFIG_TEXT);
  const disk = { ...fs, readFileSync() { throw Object.assign(new Error('Synthetic read denied'), { code: 'EACCES' }); } };
  assert.throws(() => readPortableConfig(file, { fs: disk }), { code: 'CONFIG_UNREADABLE', path: file });
  assert.deepEqual(fs.readFileSync(file, 'utf8'), DEFAULT_CONFIG_TEXT);
});
