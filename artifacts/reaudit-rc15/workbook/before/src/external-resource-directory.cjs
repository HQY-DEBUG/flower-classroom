'use strict';

const path = require('node:path');

/**
 * Editable resources belong beside the EXE the user launched. The portable
 * NSIS launcher extracts Electron to a temporary directory, so execPath alone
 * is incorrect for that target. electron-builder provides the outer location:
 * https://github.com/electron-userland/electron-builder/blob/master/website/docs/nsis.md#portable
 * https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/templates/nsis/portable.nsi
 * This function only resolves a path: it never creates directories or changes
 * permissions. Callers report write failures rather than switching locations.
 */
function resolveExternalResourceDirectory({ execPath = process.execPath, env = process.env, platform = process.platform, isPackaged = true, developmentDirectory } = {}) {
  const paths = platform === 'win32' ? path.win32 : path;
  const absolute = (value, label) => {
    if (typeof value !== 'string' || !value || !paths.isAbsolute(value)) throw new Error(`${label}必须是完整路径，请将程序放到可写文件夹后重新启动`);
    return paths.normalize(value);
  };
  // Test overrides are explicit and cannot redirect a normal packaged launch.
  if (env.FLOWER_HEADLESS_TEST === '1' && env.FLOWER_EXTERNAL_RESOURCE_DIR) return absolute(env.FLOWER_EXTERNAL_RESOURCE_DIR, '测试资源目录');
  if (!isPackaged && developmentDirectory) return absolute(developmentDirectory, '开发资源目录');
  if (platform === 'win32' && isPackaged) {
    if (env.PORTABLE_EXECUTABLE_DIR) return absolute(env.PORTABLE_EXECUTABLE_DIR, '便携程序目录');
    if (env.PORTABLE_EXECUTABLE_FILE) return paths.dirname(absolute(env.PORTABLE_EXECUTABLE_FILE, '便携程序路径'));
  }
  return paths.dirname(absolute(execPath, '程序路径'));
}

module.exports = { resolveExternalResourceDirectory };
