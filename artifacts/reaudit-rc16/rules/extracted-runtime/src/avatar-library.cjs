'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { decodePhotoBytes } = require('./photo-batch.cjs');
const oldDefaultNames = new Map(Object.entries(require('./pet-art.js').names).map(([pet, name], index) => [`${String(index + 1).padStart(2, '0')}-${name}.png`, { pet, name }]));
const defaultNames = new Map(require('../assets/avatar-defaults/manifest.json').files.map(({ fileName, name }) => [fileName, { name, ...oldDefaultNames.get(fileName) }]));

const FOLDER_NAME = '头像';
// This lives beside the editable folder: deleting it never re-seeds old files.
const SEED_MARKER = '头像-初始化-v2.txt';
const LEGACY_FOLDER_NAME = 'avatars';
const LEGACY_SEED_MARKER = 'avatars-seeded-v1.txt';
const LOCATION_INDEX = 'avatar-location-v2.json';
const DATA_FOLDER_NAME = '数据';
const STARTED = 'flower-avatar-library-v1:started\n';
const COMPLETE = 'flower-avatar-library-v1:complete\n';
const LIMITS = Object.freeze({ entries: 1000, items: 200, photoBytes: 1400 * 1024, totalBytes: 32 * 1024 * 1024, cacheBytes: 12 * 1024 * 1024 });
const EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const INTERRUPTED = '头像库首次准备未完成，已保留现有文件；为尊重手动删除，不会自动补回默认头像。可在头像文件夹中手动添加图片';
const READ_ONLY = 'EXE 所在目录或头像文件夹不可写，请将程序移到可写文件夹，或重新选择可写安装位置；已有图片仍可使用';
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const joinWarnings = (...values) => [...new Set(values.filter(Boolean))].join('；');

// Reject animated formats before calling the shared bounded image decoder.
// A filename is always text, never a URL; only generated JPEG bytes reach UI.
function checkStaticImage(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let offset = 8, ended = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
      if (length > bytes.length - offset - 12) throw new Error('图片文件不完整');
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new Error('头像库仅支持静态图片');
      offset += length + 12;
      if (type === 'IEND') { ended = true; break; }
    }
    if (!ended) throw new Error('图片文件不完整');
  } else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('图片文件不完整');
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = bytes.toString('ascii', offset, offset + 4), length = bytes.readUInt32LE(offset + 4);
      if (length > bytes.length - offset - 8) throw new Error('图片文件不完整');
      if (type === 'ANIM' || type === 'ANMF' || (type === 'VP8X' && length >= 1 && (bytes[offset + 8] & 2))) throw new Error('头像库仅支持静态图片');
      offset += 8 + length + (length % 2);
    }
    if (offset !== bytes.length) throw new Error('图片文件不完整');
  }
}

/**
 * A user-editable, persistent library, independent of classroom JSON/backups.
 * No disk access at construction/startup. Folder packages ship seeded; a
 * source checkout's first list/open seeds at most once;
 * later list calls return cached embedded snapshots. Only refresh rescans.
 * A crash after the durable STARTED marker never silently reintroduces files.
 * io is injectable solely for deterministic filesystem-failure unit tests.
 */
function createAvatarLibrary({ resourceDirectory, dataDirectory, defaultsDirectory, nativeImage, io = fs.promises } = {}) {
  // dataDirectory is retained for existing isolated test/decoder callers only.
  const rootDirectory = resourceDirectory || dataDirectory;
  if (typeof rootDirectory !== 'string' || !rootDirectory || typeof defaultsDirectory !== 'string' || !defaultsDirectory) throw new Error('头像库目录无效');
  const root = path.resolve(rootDirectory);
  const directory = path.join(root, FOLDER_NAME);
  const marker = path.join(root, SEED_MARKER);
  // The old legacyDataDirectory option is intentionally ignored. Normal
  // launches never discover or read another installation or AppData.
  const metadataDirectory = path.join(root, DATA_FOLDER_NAME);
  const indexPath = path.join(metadataDirectory, LOCATION_INDEX);
  let initialized = false, seedWarning = '', cache = null, queue = Promise.resolve();
  const run = task => { const pending = queue.then(task); queue = pending.catch(() => {}); return pending; };
  const copyResult = result => ({ ...result, items: result.items.map(item => ({ ...item })) });

  async function directoryStat(targetDirectory = directory) {
    const stat = await io.lstat(targetDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('头像库路径不是普通文件夹，请检查头像文件夹');
    return stat;
  }
  async function readSmallFile(file) {
    let stat;
    try { stat = await io.lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return '';
    const handle = await io.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat();
      if (!sameFile(stat, opened)) return '';
      const bytes = Buffer.alloc(64 * 1024 + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      return bytes.subarray(0, bytesRead).toString();
    } finally { await handle.close(); }
  }
  function parseState(value, legacyFiles = [...defaultNames.keys()]) {
    if (value === null) return null;
    if (value === STARTED + COMPLETE) return { version: 2, complete: true, seededFiles: legacyFiles };
    try {
      const [first, complete] = value.split('\n'), state = JSON.parse(first);
      if (state.version !== 2 || !Array.isArray(state.seededFiles) || state.seededFiles.length > LIMITS.entries || !state.seededFiles.every(file => typeof file === 'string' && file === path.basename(file))) throw new Error('invalid');
      return { ...state, complete: complete === COMPLETE.trim() };
    } catch { return { version: 2, complete: false, seededFiles: legacyFiles }; }
  }
  const readMarker = async () => {
    try { return parseState(await readSmallFile(marker)); }
    catch { throw new Error(`无法读取头像初始化记录；${READ_ONLY}`); }
  };
  async function saveLocation(state, check) {
    check();
    // Relative metadata travels with the whole program folder. It is only a
    // second copy of seed history, never a pointer to an earlier installation.
    const temporary = `${indexPath}.tmp-${randomUUID()}`;
    let handle;
    try {
      await io.mkdir(metadataDirectory, { recursive: true });
      await directoryStat(metadataDirectory);
      handle = await io.open(temporary, 'wx');
      await handle.writeFile(JSON.stringify({ version: 2, directory: FOLDER_NAME, seededFiles: state.seededFiles, complete: !!state.complete }) + '\n');
      await handle.sync();
      await handle.close(); handle = null;
      check();
      await directoryStat(metadataDirectory);
      await io.rename(temporary, indexPath);
    } catch {
      check();
      seedWarning = joinWarnings(seedWarning, '无法保存本地头像初始化记录；请保留头像文件夹旁的初始化记录，并检查数据文件夹写入权限');
    } finally {
      if (handle) await handle.close();
      await io.unlink(temporary).catch(() => {});
    }
  }
  async function localSeedHistory(check) {
    check();
    let value;
    try {
      await directoryStat(metadataDirectory);
      value = await readSmallFile(indexPath);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      value = '';
    }
    if (value === null) return null;
    try {
      const state = JSON.parse(value);
      if (state.version !== 2 || state.directory !== FOLDER_NAME || !Array.isArray(state.seededFiles) || state.seededFiles.length > LIMITS.entries || !state.seededFiles.every(file => typeof file === 'string' && file === path.basename(file))) throw new Error('invalid');
      return { version: 2, seededFiles: state.seededFiles, complete: state.complete === true };
    } catch {
      // A damaged record is evidence of prior initialization. Conservatively
      // keep deletions instead of assuming this is a brand new program folder.
      return { version: 2, seededFiles: [...defaultNames.keys()], complete: false };
    }
  }
  async function ensureFolder(check) {
    check();
    try { await io.mkdir(directory, { recursive: true }); }
    catch (error) { throw new Error(error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EROFS' ? `无法创建头像文件夹：${READ_ONLY}` : '无法打开头像文件夹，请检查 EXE 所在目录'); }
    check();
    return directoryStat();
  }
  async function initialize(check) {
    if (initialized) return;
    await ensureFolder(check);
    const markerState = await readMarker();
    const existing = markerState || await localSeedHistory(check);
    if (existing && !existing.complete) {
      seedWarning = INTERRUPTED;
      await saveLocation(existing, check);
      initialized = true;
      return;
    }
    const previous = existing || { version: 2, seededFiles: [], complete: false };
    const knownFiles = new Set(previous.seededFiles);
    // The bundled catalog is fixed and bounded. Electron's ASAR supports
    // lstat/copyFile, but not opendir; never enumerate the archive as an OS dir.
    const defaults = [...defaultNames.keys()].filter(file => !knownFiles.has(file));
    if (existing && !defaults.length) {
      await saveLocation(existing, check);
      initialized = true;
      return;
    }
    try {
      if (defaults.length > LIMITS.items) throw new Error('默认头像数量超出限制');
      for (const file of defaults) {
        check();
        const stat = await io.lstat(path.join(defaultsDirectory, file));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.photoBytes) throw new Error('默认头像文件无效');
      }
    } catch (error) {
      check();
      seedWarning = error.code ? '默认头像文件暂不可用，可手动添加图片' : error.message;
      initialized = true;
      return;
    }
    defaults.sort((a, b) => a.localeCompare(b, 'zh-CN'));
    let handle;
    try {
      check();
      // Reserve the one-time seed before copying. An exclusive destination
      // copy never replaces even a same-name image the user already supplied.
      handle = await io.open(marker, markerState ? 'w' : 'wx');
      const planned = { version: 2, seededFiles: [...new Set([...previous.seededFiles, ...defaultNames.keys()])] };
      await handle.writeFile(JSON.stringify(planned) + '\n');
      await handle.sync();
      await saveLocation(planned, check);
      for (const file of defaults) {
        check();
        await directoryStat();
        const source = path.join(defaultsDirectory, file), sourceStat = await io.lstat(source);
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.size > LIMITS.photoBytes) throw new Error('默认头像文件无效');
        try { await io.copyFile(source, path.join(directory, file), fs.constants.COPYFILE_EXCL); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      check();
      await handle.writeFile(COMPLETE);
      await handle.sync();
      await saveLocation({ ...planned, complete: true }, check);
    } catch (error) {
      // Do not hide a lock/generation guard rejection as a filesystem warning.
      check();
      if (error.code === 'EEXIST') seedWarning = (await readMarker())?.complete ? seedWarning : joinWarnings(seedWarning, INTERRUPTED);
      else seedWarning = joinWarnings(seedWarning, error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EROFS' ? READ_ONLY : '默认头像准备失败', handle ? INTERRUPTED : '请将程序移到可写文件夹后重启应用');
    } finally {
      if (handle) await handle.close();
    }
    initialized = true;
  }
  async function readImage(file, before, parentStat, sourceDirectory = directory) {
    const target = path.join(sourceDirectory, file), currentParent = await directoryStat(sourceDirectory);
    if (currentParent.dev !== parentStat.dev || currentParent.ino !== parentStat.ino) throw new Error('头像文件夹已变化，请刷新');
    const handle = await io.open(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat(), current = await io.lstat(target);
      if (!opened.isFile() || current.isSymbolicLink() || !sameFile(before, opened) || !sameFile(current, opened)) throw new Error('头像文件已变化，请刷新');
      const bytes = Buffer.alloc(opened.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat(), finalParent = await directoryStat(sourceDirectory);
      if (length !== opened.size || !sameFile(opened, after) || finalParent.dev !== parentStat.dev || finalParent.ino !== parentStat.ino) throw new Error('头像文件在读取时变化，请刷新');
      return bytes.subarray(0, length);
    } finally { await handle.close(); }
  }
  async function scan(check) {
    const parentStat = await directoryStat();
    const entries = [], warnings = [];
    let skipped = 0, totalBytes = 0, cacheBytes = 0;
    const folder = await io.opendir(directory);
    for await (const entry of folder) {
      check();
      if (entries.length >= LIMITS.entries) { warnings.push('文件夹项目超过 1000 项，仅检查前 1000 项，请整理后刷新'); break; }
      entries.push(entry);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    const items = [];
    for (const entry of entries) {
      check();
      if (!EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || !entry.isFile() || entry.isSymbolicLink()) { skipped++; continue; }
      if (items.length >= LIMITS.items) { skipped++; warnings.push('最多显示 200 张头像，部分图片已省略，请整理后刷新'); continue; }
      try {
        const stat = await io.lstat(path.join(directory, entry.name));
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('不是普通图片文件');
        if (stat.size > LIMITS.photoBytes) throw new Error('单张图片超过 1.4 MB');
        if (totalBytes + stat.size > LIMITS.totalBytes) { skipped++; warnings.push('本次读取达到 32 MB 上限，部分图片已省略'); continue; }
        totalBytes += stat.size;
        const bytes = await readImage(entry.name, stat, parentStat);
        checkStaticImage(bytes);
        const photo = await decodePhotoBytes(bytes, nativeImage);
        check();
        if (cacheBytes + photo.length > LIMITS.cacheBytes) { skipped++; warnings.push('头像预览达到容量上限，部分图片已省略'); continue; }
        cacheBytes += photo.length;
        // Names never become paths or HTML. IDs are stable across process
        // launches and change only when the exact filename changes.
        const id = createHash('sha256').update(entry.name).digest('hex');
        const builtin = defaultNames.get(entry.name);
        items.push({ id, fileName: entry.name, name: builtin?.name || path.basename(entry.name, path.extname(entry.name)).normalize('NFC'), photo, ...(builtin?.pet ? { pet: builtin.pet } : {}) });
      } catch (error) { check(); skipped++; }
    }
    if (skipped) warnings.push(`已跳过 ${skipped} 项不支持、损坏、超限或不符合要求的文件（仅读取当前文件夹的静态 PNG、JPEG、WebP）`);
    try { await io.access(directory, fs.constants.W_OK); } catch { warnings.push(`头像文件夹当前不可写；${READ_ONLY}`); }
    return { items, directory, warning: joinWarnings(seedWarning, ...warnings), skipped };
  }
  async function load(refresh, check) {
    check();
    if (!refresh && cache) return copyResult(cache);
    await initialize(check);
    // Deleting the whole folder clears the catalog on refresh. The external
    // seed marker survives, so the replacement folder intentionally stays empty.
    await ensureFolder(check);
    check();
    cache = await scan(check);
    check();
    return copyResult(cache);
  }
  return {
    directory,
    get warning() { return seedWarning; },
    list: ({ check = () => {} } = {}) => run(() => load(false, check)),
    refresh: ({ check = () => {} } = {}) => run(() => load(true, check)),
    openFolder: ({ check = () => {} } = {}) => run(async () => { await initialize(check); await ensureFolder(check); check(); return directory; })
  };
}

function initialSeedMarker() {
  return JSON.stringify({ version: 2, seededFiles: [...defaultNames.keys()] }) + '\n' + COMPLETE;
}

module.exports = { createAvatarLibrary, checkStaticImage, initialSeedMarker, FOLDER_NAME, SEED_MARKER, LEGACY_FOLDER_NAME, LEGACY_SEED_MARKER, LOCATION_INDEX, DATA_FOLDER_NAME, LIMITS };
