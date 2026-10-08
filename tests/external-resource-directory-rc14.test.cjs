'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveExternalResourceDirectory: resolve } = require('../src/external-resource-directory.cjs');

test('Windows portable resources follow the launched outer EXE rather than its temporary extracted runtime', () => {
  const common = { platform: 'win32', isPackaged: true, execPath: 'C:\\Users\\Synthetic\\AppData\\Local\\Temp\\abc\\花伴课堂.exe' };
  assert.equal(resolve({ ...common, env: { PORTABLE_EXECUTABLE_DIR: 'D:\\课堂工具', PORTABLE_EXECUTABLE_FILE: 'D:\\课堂工具\\花伴课堂便携.exe' } }), 'D:\\课堂工具');
  assert.equal(resolve({ ...common, env: { PORTABLE_EXECUTABLE_FILE: 'E:\\新版本\\花伴课堂便携.exe' } }), 'E:\\新版本');
});

test('folder and installed Windows builds resolve to their real EXE folder independently of cwd or AppData', () => {
  assert.equal(resolve({ platform: 'win32', isPackaged: true, execPath: 'C:\\Apps\\花伴课堂\\花伴课堂.exe', env: { APPDATA: 'C:\\Users\\Synthetic\\AppData\\Roaming' } }), 'C:\\Apps\\花伴课堂');
  assert.equal(resolve({ platform: 'win32', isPackaged: true, execPath: '\\\\server\\shared\\花伴课堂.exe', env: {} }), '\\\\server\\shared\\');
});

test('development and synthetic tests require explicit resource paths; normal launches ignore the test override', () => {
  assert.equal(resolve({ platform: 'linux', isPackaged: false, developmentDirectory: '/synthetic/source', execPath: '/runtime/electron', env: {} }), '/synthetic/source');
  assert.equal(resolve({ platform: 'linux', isPackaged: true, execPath: '/runtime/electron', env: { FLOWER_HEADLESS_TEST: '1', FLOWER_EXTERNAL_RESOURCE_DIR: '/synthetic/exe-folder' } }), '/synthetic/exe-folder');
  assert.equal(resolve({ platform: 'linux', execPath: '/runtime/electron', env: { FLOWER_EXTERNAL_RESOURCE_DIR: '/synthetic/ignored' } }), '/runtime');
  assert.throws(() => resolve({ platform: 'win32', execPath: 'C:\\App\\app.exe', env: { PORTABLE_EXECUTABLE_DIR: 'relative' } }), /完整路径/);
});
