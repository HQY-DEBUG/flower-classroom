'use strict';

// afterPack preparation for the folder distribution. This is a build-time
// operation only: normal application startup must never run this initializer.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FOLDER_NAME, DATA_FOLDER_NAME, SEED_MARKER, initialSeedMarker } = require('../src/avatar-library.cjs');
const { CONFIG_FILE_NAME, DEFAULT_CONFIG_TEXT, parsePortableConfig } = require('../src/portable-config.cjs');
const manifest = require('../assets/avatar-defaults/manifest.json');
const DEFAULTS_DIRECTORY = path.resolve(__dirname, '../assets/avatar-defaults');
const BACKUP_FOLDER_NAME = '备份';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function plainDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`打包资源目录必须为普通文件夹：${directory}`);
}
function readPlainFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`打包资源必须为普通文件：${file}`);
  return fs.readFileSync(file);
}
function writeInitialFile(file, bytes) {
  try { fs.writeFileSync(file, bytes, { flag: 'wx' }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    // A repeat afterPack may accept its own identical output. It must never
    // overwrite an edited configuration, workbook, image or initialization.
    if (!readPlainFile(file).equals(Buffer.from(bytes))) throw new Error(`打包目录含有已修改的文件，请使用干净输出目录：${file}`);
  }
}
function emptyDirectory(directory) {
  plainDirectory(directory);
  if (fs.readdirSync(directory).length) throw new Error(`初始发行包中的${path.basename(directory)}文件夹必须为空，请使用干净输出目录`);
}
function validateManifest() {
  if (manifest.count !== 120 || manifest.files.length !== 120 || new Set(manifest.files.map(file => file.fileName)).size !== 120) throw new Error('头像默认清单必须恰好包含120张原始图片');
  for (const file of manifest.files) {
    if (file.fileName !== path.basename(file.fileName) || !file.fileName.endsWith('.png') || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('头像默认清单无效');
  }
}

function verifyFolderResources(appOutDir) {
  validateManifest();
  const directory = path.join(appOutDir, FOLDER_NAME);
  plainDirectory(directory);
  const actual = fs.readdirSync(directory).sort();
  const expected = manifest.files.map(file => file.fileName).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('初始发行包头像目录必须恰好包含120张原始 PNG');
  for (const file of manifest.files) {
    const bytes = readPlainFile(path.join(directory, file.fileName));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`发行包头像与原始图片不一致：${file.fileName}`);
  }
  if (readPlainFile(path.join(appOutDir, SEED_MARKER)).toString('utf8') !== initialSeedMarker()) throw new Error('初始头像记录与发行包不一致');
  const config = parsePortableConfig(readPlainFile(path.join(appOutDir, CONFIG_FILE_NAME)).toString('utf8'));
  const { FILE_NAME, isInitialBytes } = require('../src/score-rule-workbook.cjs');
  const workbook = readPlainFile(path.join(appOutDir, FILE_NAME));
  if (!isInitialBytes(workbook)) throw new Error('初始计分卡片必须是尚未绑定课堂的原始默认工作簿');
  emptyDirectory(path.join(appOutDir, DATA_FOLDER_NAME));
  emptyDirectory(path.join(appOutDir, BACKUP_FOLDER_NAME));
  const rootFiles = fs.readdirSync(appOutDir).sort();
  if (rootFiles.some(file => /\.md$/i.test(file))) throw new Error('发行包根目录不能包含面向用户的 Markdown 说明文件');
  return { directory: appOutDir, avatarCount: actual.length, workbookSha256: sha256(workbook), config, rootFiles };
}

async function prepareFolderResources({ appOutDir } = {}) {
  if (typeof appOutDir !== 'string' || !path.isAbsolute(appOutDir)) throw new Error('发行包输出目录必须为绝对路径');
  plainDirectory(appOutDir);
  validateManifest();
  // Do not seed into a used application folder. Empty directories are shipped
  // as real ZIP entries, with no .keep or marker files inside either directory.
  emptyDirectory(path.join(appOutDir, DATA_FOLDER_NAME));
  emptyDirectory(path.join(appOutDir, BACKUP_FOLDER_NAME));
  const directory = path.join(appOutDir, FOLDER_NAME);
  plainDirectory(directory);
  for (const file of manifest.files) {
    const bytes = readPlainFile(path.join(DEFAULTS_DIRECTORY, file.fileName));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`默认头像源文件校验失败：${file.fileName}`);
    writeInitialFile(path.join(directory, file.fileName), bytes);
  }
  writeInitialFile(path.join(appOutDir, CONFIG_FILE_NAME), DEFAULT_CONFIG_TEXT);
  const { FILE_NAME, buildInitialBytes } = require('../src/score-rule-workbook.cjs');
  writeInitialFile(path.join(appOutDir, FILE_NAME), await buildInitialBytes());
  // The complete record belongs in the archive already. Deleting an image
  // between extraction and first launch must count as a user deletion.
  writeInitialFile(path.join(appOutDir, SEED_MARKER), initialSeedMarker());
  return verifyFolderResources(appOutDir);
}

module.exports = { prepareFolderResources, verifyFolderResources };
if (require.main === module) {
  prepareFolderResources({ appOutDir: process.argv[2] }).then(result => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
}
