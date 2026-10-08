'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resolveFolderLayout, bootstrapFolderApp } = require('../src/folder-layout.cjs');
const { DEFAULT_CONFIG_TEXT } = require('../src/portable-config.cjs');

function fixture(t, suffix = '课堂 with spaces') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-folder-rc15-')), root = path.join(base, suffix);
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  return { base, root, execPath: path.join(root, '花伴课堂.exe') };
}

function fakeApp() {
  const paths = new Map(), switches = new Map(), calls = [];
  return {
    isPackaged: true, isReady: () => false, paths, switches, calls,
    getPath() { throw new Error('Bootstrap must not ask Electron for an AppData default'); },
    setPath(name, value) { assert.equal(fs.statSync(value).isDirectory(), true); paths.set(name, value); calls.push(name); },
    setAppLogsPath(value) { assert.equal(fs.statSync(value).isDirectory(), true); calls.push('appLogs'); },
    commandLine: { appendSwitch(name, value) { switches.set(name, value); } }
  };
}

test('normal Windows folder launch follows actual EXE, ignoring cwd, AppData, launcher and test paths', () => {
  const options = {
    platform: 'win32', execPath: 'D:\\课堂工具 with spaces\\花伴课堂.exe', isPackaged: true,
    env: { APPDATA: 'C:\\Users\\Teacher\\AppData\\Roaming', PORTABLE_EXECUTABLE_DIR: 'E:\\old launcher', PORTABLE_EXECUTABLE_FILE: 'E:\\old.exe', FLOWER_DATA_DIR: 'F:\\ignored', FLOWER_FOLDER_ROOT: 'F:\\ignored', FLOWER_EXTERNAL_RESOURCE_DIR: 'F:\\ignored' }
  };
  const layout = resolveFolderLayout(options);
  assert.equal(layout.root, 'D:\\课堂工具 with spaces');
  assert.equal(layout.dataDirectory, 'D:\\课堂工具 with spaces\\数据');
  assert.equal(layout.backupDirectory, 'D:\\课堂工具 with spaces\\备份');
  assert.equal(layout.tempDirectory, 'D:\\课堂工具 with spaces\\数据\\运行缓存\\临时');
  assert.equal(layout.synthetic, false);
  assert.equal(resolveFolderLayout({ platform: 'win32', execPath: '\\\\server\\共享课堂\\花伴课堂.exe', env: {} }).root, '\\\\server\\共享课堂\\');
});

test('folder path resolution rejects relative paths and permits explicit development checkout', () => {
  assert.throws(() => resolveFolderLayout({ execPath: 'relative/app.exe', env: {} }), { code: 'INVALID_FOLDER_PATH' });
  assert.throws(() => resolveFolderLayout({ execPath: '/runtime/electron', env: { FLOWER_HEADLESS_TEST: '1', FLOWER_DATA_DIR: 'relative' } }), { code: 'INVALID_FOLDER_PATH' });
  assert.equal(resolveFolderLayout({ execPath: '/runtime/electron', isPackaged: false, developmentDirectory: '/checkout/开发', env: {} }).root, '/checkout/开发');
});

test('legacy synthetic data override remains direct and all default resources stay in that fixture', () => {
  const layout = resolveFolderLayout({ execPath: '/runtime/electron', env: { FLOWER_HEADLESS_TEST: '1', FLOWER_DATA_DIR: '/fixtures/classroom' } });
  assert.equal(layout.dataDirectory, '/fixtures/classroom');
  assert.equal(layout.root, '/fixtures/classroom');
  assert.equal(layout.configFile, '/fixtures/classroom/配置.txt');
  assert.equal(layout.backupDirectory, '/fixtures/classroom/备份');
  assert.equal(layout.sessionDirectory, '/fixtures/classroom/运行缓存/会话');
  const separate = resolveFolderLayout({ execPath: '/runtime/electron', env: { FLOWER_HEADLESS_TEST: '1', FLOWER_DATA_DIR: '/fixtures/classroom', FLOWER_EXTERNAL_RESOURCE_DIR: '/fixtures/resources' } });
  assert.equal(separate.root, '/fixtures/resources');
  assert.equal(separate.dataDirectory, '/fixtures/classroom');
});

test('bootstrap creates local paths, parses real config and configures Electron before ready', t => {
  const { root, execPath } = fixture(t), app = fakeApp(), env = { APPDATA: '/unused/legacy/appdata', TEMP: '/unused/temp' };
  fs.writeFileSync(path.join(root, '配置.txt'), 'initialZoom=1.25\nwindowWidth=1440\nwindowHeight=900\nstartMinimized=true');
  const result = bootstrapFolderApp({ app, execPath, env });
  assert.equal(result.ok, true);
  const { layout } = result;
  assert.equal(result.config.initialZoom, 1.25);
  assert.equal(result.config.startMinimized, true);
  assert.deepEqual([...app.paths.keys()], ['appData', 'userData', 'sessionData', 'temp', 'logs', 'crashDumps']);
  assert.equal(app.paths.get('userData'), path.join(root, '数据'));
  assert.equal(app.paths.get('sessionData'), layout.sessionDirectory);
  assert.equal(app.paths.get('appData'), layout.runtimeDirectory);
  assert.equal(app.switches.get('disk-cache-dir'), layout.cacheDirectory);
  assert.equal(app.switches.get('log-file'), path.join(layout.logsDirectory, 'chromium.log'));
  for (const key of ['TEMP', 'TMP', 'TMPDIR']) assert.equal(env[key], layout.tempDirectory);
  assert.equal(env.APPDATA, '/unused/legacy/appdata');
  assert.equal(env.XDG_CACHE_HOME, layout.cacheDirectory);
  assert.equal(fs.statSync(layout.backupDirectory).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(root).sort(), ['备份', '数据', '配置.txt'].sort());
});

test('bootstrap creates one editable default template when missing and keeps user edits on restart', t => {
  const { root, execPath } = fixture(t);
  const first = bootstrapFolderApp({ app: fakeApp(), execPath, env: {} });
  assert.equal(first.ok, true);
  assert.equal(fs.readFileSync(path.join(root, '配置.txt'), 'utf8'), DEFAULT_CONFIG_TEXT);
  fs.writeFileSync(first.layout.configFile, 'initialZoom=1.5\n# 教师自己的说明\n');
  const second = bootstrapFolderApp({ app: fakeApp(), execPath, env: {} });
  assert.equal(second.ok, true);
  assert.equal(second.config.initialZoom, 1.5);
  assert.equal(fs.readFileSync(first.layout.configFile, 'utf8'), 'initialZoom=1.5\n# 教师自己的说明\n');
});

test('malformed config returns actionable startup error without creating data or changing config', t => {
  const { root, execPath } = fixture(t), app = fakeApp(), text = '# keep this file\ninitialZoom=oops\n';
  fs.writeFileSync(path.join(root, '配置.txt'), text);
  const result = bootstrapFolderApp({ app, execPath, env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONFIG_INVALID');
  assert.equal(result.error.line, 2);
  assert.equal(result.error.path, path.join(root, '配置.txt'));
  assert.match(result.error.message, /没有被重置/);
  assert.deepEqual(fs.readdirSync(root), ['配置.txt']);
  assert.equal(fs.readFileSync(path.join(root, '配置.txt'), 'utf8'), text);
  assert.deepEqual(app.calls, []);
});

test('unwritable root is a terminal startup error with no AppData fallback or classroom changes', t => {
  const { root, execPath } = fixture(t), app = fakeApp(), original = Buffer.from('existing classroom bytes');
  fs.mkdirSync(path.join(root, '数据'));
  fs.writeFileSync(path.join(root, '数据', 'classroom-v2.json'), original);
  const disk = { ...fs, openSync(file, ...args) { if (path.basename(file).startsWith('.flower-write-check-')) throw Object.assign(new Error('Synthetic write failure'), { code: 'EACCES' }); return fs.openSync(file, ...args); } };
  const result = bootstrapFolderApp({ app, execPath, env: {}, fs: disk });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'FOLDER_UNWRITABLE');
  assert.equal(result.error.path, root);
  assert.deepEqual(app.calls, []);
  assert.deepEqual(fs.readFileSync(path.join(root, '数据', 'classroom-v2.json')), original);
  assert.deepEqual(fs.readdirSync(root), ['数据']);
});

test('unwritable existing session directory stops before Electron path setup', t => {
  const { root, execPath } = fixture(t), app = fakeApp();
  const first = bootstrapFolderApp({ app: fakeApp(), execPath, env: {} });
  assert.equal(first.ok, true);
  const disk = { ...fs, openSync(file, ...args) { if (path.dirname(file) === first.layout.sessionDirectory) throw Object.assign(new Error('Synthetic session write failure'), { code: 'EACCES' }); return fs.openSync(file, ...args); } };
  const result = bootstrapFolderApp({ app, execPath, env: {}, fs: disk });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'FOLDER_UNWRITABLE');
  assert.equal(result.error.path, first.layout.sessionDirectory);
  assert.deepEqual(app.calls, []);
  assert.equal(fs.readFileSync(path.join(root, '配置.txt'), 'utf8'), DEFAULT_CONFIG_TEXT);
});

test('moved and independently copied folders preserve all existing classroom and lock bytes', t => {
  const { base, root, execPath } = fixture(t);
  const first = bootstrapFolderApp({ app: fakeApp(), execPath, env: {} });
  assert.equal(first.ok, true);
  const names = ['classroom.json', 'classroom-v2.json', 'classroom-v2.json.previous', 'classroom-v2.enabled', 'classroom-lock.json', 'before-restore-existing.json'];
  for (const name of names) fs.writeFileSync(path.join(first.layout.dataDirectory, name), `existing ${name}`);
  const moved = path.join(base, '已移动 new folder'), copied = path.join(base, '独立副本');
  fs.renameSync(root, moved);
  fs.cpSync(moved, copied, { recursive: true });
  const noClassroomReads = { ...fs, readFileSync(file, ...args) { assert.equal(path.basename(file), '配置.txt', 'bootstrap must not read classroom or lock'); return fs.readFileSync(file, ...args); } };
  for (const folder of [moved, copied]) {
    const result = bootstrapFolderApp({ app: fakeApp(), execPath: path.join(folder, '花伴课堂.exe'), env: {}, fs: noClassroomReads });
    assert.equal(result.ok, true);
    assert.equal(result.layout.dataDirectory, path.join(folder, '数据'));
    for (const name of names) assert.equal(fs.readFileSync(path.join(result.layout.dataDirectory, name), 'utf8'), `existing ${name}`);
  }
  fs.writeFileSync(path.join(copied, '数据', 'classroom-v2.json'), 'copy only');
  assert.equal(fs.readFileSync(path.join(moved, '数据', 'classroom-v2.json'), 'utf8'), 'existing classroom-v2.json');
});

test('late bootstrap and Electron path override failure return explicit startup errors', t => {
  const { root, execPath } = fixture(t), readyApp = fakeApp();
  readyApp.isReady = () => true;
  assert.equal(bootstrapFolderApp({ app: readyApp, execPath, env: {} }).error.code, 'BOOTSTRAP_TOO_LATE');
  assert.deepEqual(fs.readdirSync(root), []);
  const brokenApp = fakeApp();
  brokenApp.setPath = () => { throw new Error('Synthetic Electron failure'); };
  const result = bootstrapFolderApp({ app: brokenApp, execPath, env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'ELECTRON_PATH_FAILED');
  assert.equal(result.error.path, root);
});
