'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULT_CONFIG } = require('./portable-config.cjs');
const CONFIG_FILE_NAME = '配置.xlsx';

function folderError(code, message, target, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = code;
  if (target) error.path = target;
  return error;
}

/** Pure path resolution: normal packaged launches follow the actual EXE only.
 * No cwd, AppData, registry or obsolete portable-launcher variable is consulted.
 * Legacy headless fixtures retain their explicit, direct data-dir override.
 */
function resolveFolderLayout({ execPath = process.execPath, env = process.env, platform = process.platform, isPackaged = true, developmentDirectory } = {}) {
  const paths = platform === 'win32' ? path.win32 : path;
  const absolute = (value, label) => {
    if (typeof value !== 'string' || !value || !paths.isAbsolute(value)) {
      throw folderError('INVALID_FOLDER_PATH', `${label}必须是完整路径，请完整解压程序文件夹后重新启动`, typeof value === 'string' ? value : undefined);
    }
    return paths.normalize(value);
  };
  const synthetic = env.FLOWER_HEADLESS_TEST === '1';
  let root;
  if (synthetic && env.FLOWER_FOLDER_ROOT) root = absolute(env.FLOWER_FOLDER_ROOT, '测试程序目录');
  else if (synthetic && env.FLOWER_EXTERNAL_RESOURCE_DIR) root = absolute(env.FLOWER_EXTERNAL_RESOURCE_DIR, '测试资源目录');
  else if (synthetic && env.FLOWER_DATA_DIR) root = absolute(env.FLOWER_DATA_DIR, '测试数据目录');
  else if (!isPackaged && developmentDirectory) root = absolute(developmentDirectory, '开发程序目录');
  else root = paths.dirname(absolute(execPath, '程序路径'));
  const dataDirectory = synthetic && env.FLOWER_DATA_DIR ? absolute(env.FLOWER_DATA_DIR, '测试数据目录') : paths.join(root, '数据');
  const runtimeDirectory = paths.join(dataDirectory, '运行缓存');
  return Object.freeze({
    root, resourceDirectory: root, configFile: paths.join(root, CONFIG_FILE_NAME), legacyConfigFile: paths.join(root, '配置.txt'),
    dataDirectory, backupDirectory: paths.join(root, '备份'), runtimeDirectory,
    sessionDirectory: paths.join(runtimeDirectory, '会话'), cacheDirectory: paths.join(runtimeDirectory, '缓存'),
    logsDirectory: paths.join(runtimeDirectory, '日志'), crashDirectory: paths.join(runtimeDirectory, '崩溃'),
    tempDirectory: paths.join(runtimeDirectory, '临时'), synthetic
  });
}

function ensureDirectory(directory, disk) {
  try {
    disk.mkdirSync(directory, { recursive: true });
    if (!disk.statSync(directory).isDirectory()) throw new Error('Not a directory');
  } catch (error) {
    throw folderError('FOLDER_UNWRITABLE', '程序文件夹无法写入，请将整个文件夹复制到有写入权限的位置后再启动', directory, error);
  }
}

function probeWritable(directory, disk) {
  const file = path.join(directory, `.flower-write-check-${randomUUID()}`);
  let descriptor, created = false;
  try {
    descriptor = disk.openSync(file, 'wx', 0o600); created = true;
    disk.writeFileSync(descriptor, 'FlowerClassroom folder check\n');
    disk.fsyncSync(descriptor);
    disk.closeSync(descriptor); descriptor = undefined;
    disk.unlinkSync(file); created = false;
  } catch (error) {
    throw folderError('FOLDER_UNWRITABLE', '程序文件夹无法写入，请将整个文件夹复制到有写入权限的位置后再启动', directory, error);
  } finally {
    if (descriptor !== undefined) { try { disk.closeSync(descriptor); } catch {} }
    if (created) { try { disk.unlinkSync(file); } catch {} }
  }
}

function assertContained(directory, root, disk) {
  const relative = path.relative(disk.realpathSync(root), disk.realpathSync(directory));
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw folderError('FOLDER_OUTSIDE_ROOT', '数据和运行文件夹必须保存在程序文件夹内，请检查文件夹位置后重新启动', directory);
  }
}

function ensureLayout(layout, disk) {
  ensureDirectory(layout.root, disk);
  probeWritable(layout.root, disk);
  const directories = [layout.dataDirectory, layout.backupDirectory, layout.runtimeDirectory, layout.sessionDirectory, layout.cacheDirectory, layout.logsDirectory, layout.crashDirectory, layout.tempDirectory];
  for (const directory of directories) {
    ensureDirectory(directory, disk);
    // Legacy synthetic fixtures deliberately keep resources and data separate.
    // Each fixture's runtime still stays under its own explicit data directory.
    assertContained(directory, layout.synthetic && directory !== layout.backupDirectory ? layout.dataDirectory : layout.root, disk);
    probeWritable(directory, disk);
  }
}

function configureElectronPaths(app, layout, env) {
  // These overrides run before any Session or BrowserWindow is created. Cache
  // is not an app.setPath name; Chromium's disk-cache-dir switch handles it.
  const paths = {
    appData: layout.runtimeDirectory, userData: layout.dataDirectory,
    sessionData: layout.sessionDirectory, temp: layout.tempDirectory,
    logs: layout.logsDirectory, crashDumps: layout.crashDirectory
  };
  for (const [name, directory] of Object.entries(paths)) app.setPath(name, directory);
  app.setAppLogsPath(layout.logsDirectory);
  app.commandLine.appendSwitch('disk-cache-dir', layout.cacheDirectory);
  app.commandLine.appendSwitch('log-file', path.join(layout.logsDirectory, 'chromium.log'));
  // Node's os.tmpdir() and app-owned child processes follow the same folder.
  // These are process-local variables, never OS/user environment settings.
  Object.assign(env, {
    TMPDIR: layout.tempDirectory, TMP: layout.tempDirectory, TEMP: layout.tempDirectory,
    XDG_CONFIG_HOME: layout.runtimeDirectory, XDG_CACHE_HOME: layout.cacheDirectory,
    ELECTRON_LOG_FILE: path.join(layout.logsDirectory, 'chromium.log')
  });
}

/** Synchronous entry point. A failure is terminal for this launch: caller shows
 * error.title/error.message and exits before store/lock/session initialization.
 * Never read, migrate, reset or fall back to an AppData classroom here.
 */
function bootstrapFolderApp({ app, env = process.env, fs: disk = fs, ...options } = {}) {
  let layout;
  try {
    if (!app || typeof app.setPath !== 'function' || typeof app.setAppLogsPath !== 'function' || typeof app.commandLine?.appendSwitch !== 'function') {
      throw folderError('ELECTRON_PATH_FAILED', '程序运行环境不完整，请重新完整解压程序文件夹');
    }
    if (app.isReady()) throw folderError('BOOTSTRAP_TOO_LATE', '程序目录必须在启动窗口前配置，请关闭程序后重试');
    layout = resolveFolderLayout({ isPackaged: app.isPackaged, ...options, env });
    ensureLayout(layout, disk);
    // The synchronous bootstrap owns paths only. Configuration.xlsx is handled
    // as a whole, asynchronously, before the first window is created. Main uses
    // the classroom's last validated appConfig; old text is migration input only.
    try { configureElectronPaths(app, layout, env); }
    catch (error) { throw folderError('ELECTRON_PATH_FAILED', '程序无法使用本文件夹保存运行文件，请保留整个文件夹并重新启动', layout.root, error); }
    return { ok: true, layout, config: { ...DEFAULT_CONFIG } };
  } catch (error) {
    const detail = {
      code: error.code || 'FOLDER_STARTUP_FAILED', title: '花伴课堂无法启动',
      message: `${error.message}\n\n课堂数据和课堂锁文件没有被重置。请修正后重新启动。`,
      path: error.path || layout?.root || '', ...(error.line === undefined ? {} : { line: error.line })
    };
    if (detail.path) detail.message += `\n位置：${detail.path}`;
    return { ok: false, error: detail };
  }
}

module.exports = { resolveFolderLayout, bootstrapFolderApp };
