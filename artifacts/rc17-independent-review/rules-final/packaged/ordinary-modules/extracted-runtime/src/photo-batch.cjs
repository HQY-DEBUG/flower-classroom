'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validatePhoto } = require('./io.cjs');
const files = fs.promises;

const LIMITS = Object.freeze({
  students: 300,
  entries: 3000,
  photoBytes: 1400 * 1024,
  totalBytes: 50 * 1024 * 1024,
  edge: 256,
  jpegQuality: 85,
  sourceEdge: 16384,
  sourcePixels: 50_000_000,
  decodeTimeout: 15_000
});
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

// Check every path component, including a selected directory that is itself a
// symlink/junction. Never silently resolve a link and import its target instead.
async function checkDirectory(directory) {
  const absolute = path.resolve(directory);
  const root = path.parse(absolute).root;
  let current = root;
  let stat = await files.lstat(root);
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    stat = await files.lstat(current);
    if (stat.isSymbolicLink()) throw new Error('照片文件夹不能是软链接，也不能经过软链接');
    if (!stat.isDirectory()) throw new Error('请选择有效的照片文件夹');
  }
  return { absolute, stat };
}

async function readPhoto(directory, entry, directoryStat) {
  const checked = await checkDirectory(directory);
  if (checked.stat.dev !== directoryStat.dev || checked.stat.ino !== directoryStat.ino) {
    throw new Error('照片文件夹已变化，请重新选择');
  }
  const filename = path.join(directory, entry.file);
  const before = await files.lstat(filename);
  if (before.isSymbolicLink() || !before.isFile()) throw new Error('照片已变化或成为软链接，请重新选择');
  if (!sameFile(before, entry.stat)) throw new Error('照片在导入前已变化，请重新选择');
  if (before.size > LIMITS.photoBytes) throw new Error('照片应小于 1.4 MB，请先裁剪或压缩');

  // O_NOFOLLOW protects the final path component on supporting platforms. The
  // surrounding lstat/fstat identity checks also reject replacements on Windows.
  const handle = await files.open(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    const current = await files.lstat(filename);
    const directoryAfterOpen = await checkDirectory(directory);
    if (!opened.isFile() || current.isSymbolicLink() || !sameFile(before, opened) || !sameFile(current, opened)) {
      throw new Error('照片在导入时已变化，请重新选择');
    }
    if (directoryAfterOpen.stat.dev !== directoryStat.dev || directoryAfterOpen.stat.ino !== directoryStat.ino) {
      throw new Error('照片文件夹已变化，请重新选择');
    }
    // Bounded reads do not grow an allocation if a source file changes in place.
    const buffer = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length !== opened.size || !sameFile(opened, after)) throw new Error('照片在读取时已变化，请重新选择');
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function checkDimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error('图片尺寸无效');
  if (width > LIMITS.sourceEdge || height > LIMITS.sourceEdge || width * height > LIMITS.sourcePixels) {
    throw new Error('图片尺寸过大，请先裁剪照片');
  }
}

// Read advertised dimensions before allocating a decoded bitmap where the
// format supplies them. This is a size guard, not a replacement for decoding.
function checkHeaderDimensions(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    checkDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 3 < bytes.length && bytes[offset] === 255) {
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9 || offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        checkDimensions(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
        break;
      }
      offset += length;
    }
  } else if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    const chunk = bytes.subarray(12, 16).toString();
    if (chunk === 'VP8X' && bytes.length >= 30) checkDimensions(1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3));
    else if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      checkDimensions(1 + (bytes[21] | ((bytes[22] & 0x3f) << 8)), 1 + ((bytes[22] >> 6) | (bytes[23] << 2) | ((bytes[24] & 0x0f) << 10)));
    } else if (chunk === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      checkDimensions(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
    }
  }
}

function createWebPDecoder(nativeImage) {
  let window;
  return {
    async decode(bytes) {
      // Electron's nativeImage PNG/JPEG decoder does not support WebP on every
      // platform. Chromium does. Use one isolated, temporary renderer only when
      // needed, give it validated in-memory bytes, and decode the result again
      // with nativeImage. This adds no package or persistent browser profile.
      const electron = require('electron');
      if (typeof electron !== 'object' || electron.nativeImage !== nativeImage || !electron.app.isReady()) {
        throw new Error('图片无法解码，请选择有效照片');
      }
      let timeout;
      try {
        return await Promise.race([
          (async () => {
            let decoderWindow = window;
            if (!decoderWindow || decoderWindow.isDestroyed()) {
              decoderWindow = new electron.BrowserWindow({
                show: false, width: 256, height: 256, skipTaskbar: true,
                webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
                  webSecurity: true, backgroundThrottling: false, offscreen: true,
                  partition: `flower-photo-decoder-${randomUUID()}` }
              });
              window = decoderWindow;
              decoderWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
              decoderWindow.webContents.session.setPermissionCheckHandler(() => false);
              decoderWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }));
              decoderWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
              decoderWindow.webContents.on('will-navigate', event => event.preventDefault());
              decoderWindow.webContents.on('will-frame-navigate', event => event.preventDefault());
              decoderWindow.webContents.on('will-attach-webview', event => event.preventDefault());
              await decoderWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:"><title>Local photo decoder</title>'));
            }
            const dataURL = `data:image/webp;base64,${bytes.toString('base64')}`;
            const pngURL = await decoderWindow.webContents.executeJavaScript(`new Promise((resolve, reject) => {
              const image = new Image();
              image.onerror = () => reject(new Error('图片无法解码，请选择有效照片'));
              image.onload = () => {
                try {
                  const width = image.naturalWidth, height = image.naturalHeight;
                  if (!width || !height || width > ${LIMITS.sourceEdge} || height > ${LIMITS.sourceEdge} || width * height > ${LIMITS.sourcePixels}) throw new Error('图片尺寸过大或无效，请先裁剪照片');
                  const scale = Math.min(1, ${LIMITS.edge} / Math.max(width, height));
                  const canvas = document.createElement('canvas');
                  canvas.width = Math.max(1, Math.round(width * scale));
                  canvas.height = Math.max(1, Math.round(height * scale));
                  const context = canvas.getContext('2d');
                  context.drawImage(image, 0, 0, canvas.width, canvas.height);
                  resolve(canvas.toDataURL('image/png'));
                } catch (error) { reject(error); }
              };
              image.src = ${JSON.stringify(dataURL)};
            })`);
            if (typeof pngURL !== 'string' || pngURL.length > LIMITS.photoBytes || !pngURL.startsWith('data:image/png;base64,')) throw new Error('图片转换失败');
            return nativeImage.createFromBuffer(Buffer.from(pngURL.slice('data:image/png;base64,'.length), 'base64'));
          })(),
          new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('图片解码超时，请检查照片')), LIMITS.decodeTimeout); })
        ]);
      } catch (error) {
        this.close();
        // Electron may prefix renderer errors with the executed expression.
        // Keep reports brief and never expose encoded photo bytes in an error.
        throw new Error(/尺寸过大/.test(error.message) ? '图片尺寸过大或无效，请先裁剪照片' : /超时/.test(error.message) ? '图片解码超时，请检查照片' : '图片无法解码，请选择有效照片');
      } finally {
        clearTimeout(timeout);
      }
    },
    close() { if (window && !window.isDestroyed()) window.destroy(); window = null; }
  };
}

async function encodePhoto(bytes, nativeImage, webpDecoder) {
  // Share the existing single-photo size/signature rules, then require a real
  // native decoder to accept the image before producing the persisted JPEG.
  validatePhoto(bytes);
  checkHeaderDimensions(bytes);
  let source = nativeImage.createFromBuffer(bytes);
  if ((!source || source.isEmpty()) && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    source = await webpDecoder.decode(bytes);
  }
  if (!source || source.isEmpty()) throw new Error('图片无法解码，请选择有效照片');
  const size = source.getSize();
  checkDimensions(size.width, size.height);
  const resized = source.resize(size.width >= size.height
    ? { width: Math.min(LIMITS.edge, size.width), quality: 'best' }
    : { height: Math.min(LIMITS.edge, size.height), quality: 'best' });
  if (!resized || resized.isEmpty()) throw new Error('图片缩放失败');
  const outputSize = resized.getSize();
  if (!Number.isSafeInteger(outputSize.width) || !Number.isSafeInteger(outputSize.height) ||
      outputSize.width <= 0 || outputSize.height <= 0 ||
      Math.max(outputSize.width, outputSize.height) > LIMITS.edge) throw new Error('图片缩放尺寸无效');
  const jpeg = resized.toJPEG(LIMITS.jpegQuality);
  if (!Buffer.isBuffer(jpeg) || jpeg.length < 3 || jpeg[0] !== 255 || jpeg[1] !== 216 || jpeg[2] !== 255) {
    throw new Error('图片转换失败');
  }
  return validatePhoto(jpeg);
}

/** Prepare one validated local photo as a JPEG data URL; no file/data writes. */
async function decodePhotoBytes(bytes, nativeImage) {
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') throw new Error('照片解码器不可用');
  const webpDecoder = createWebPDecoder(nativeImage);
  try { return await encodePhoto(bytes, nativeImage, webpDecoder); }
  finally { webpDecoder.close(); }
}

/**
 * Prepare, but never save, a folder of student photos. The caller handles dialog
 * cancellation before calling this function, then applies updates in one core
 * transaction. Neither the students array nor any source file is modified.
 *
 * Matching is exact after Unicode NFC normalization of the student name and
 * filename without its final extension. No trimming, case folding, recursion,
 * or "first match" fallback is performed. Extensions are case insensitive.
 *
 * Results/counts are PER TOP-LEVEL DIRECTORY ENTRY, not per student:
 * - success: one unambiguous student/photo pair decoded into one update;
 * - failed: an unambiguous pair whose read, size, signature, or decoding failed;
 * - skipped: unsupported entries, links/directories, unmatched names, duplicate
 *   student names, or multiple supported regular image files with the same name.
 * A student with no corresponding entry contributes no result/count.
 *
 * Whole-folder failures throw and expose no partial updates: invalid arguments,
 * unreadable/linked directory, >300 students, >3000 entries, or >50 MiB of source
 * image files. The final classroom's photo data URLs must also fit in 50 MiB,
 * using the same accounting as core.validateState. Individual bad images do not
 * prevent other valid images from being prepared. Ordering is deterministic.
 */
async function prepareBatchPhotos(directory, students, nativeImage) {
  if (typeof directory !== 'string' || !directory) throw new Error('请选择照片文件夹；取消选择由调用者处理');
  if (!Array.isArray(students) || students.length > LIMITS.students) throw new Error('学生人数不能超过 300');
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') throw new Error('照片解码器不可用');
  const studentsByName = new Map(), ids = new Set();
  for (const student of students) {
    if (!student || typeof student.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(student.id) ||
        typeof student.name !== 'string' || !student.name ||
        (student.photo !== undefined && typeof student.photo !== 'string')) throw new Error('学生姓名、编号或照片格式无效');
    if (ids.has(student.id)) throw new Error('学生编号不能重复');
    ids.add(student.id);
    const name = student.name.normalize('NFC');
    const matches = studentsByName.get(name) || [];
    matches.push(student);
    studentsByName.set(name, matches);
  }

  const { absolute, stat: directoryStat } = await checkDirectory(directory);
  const entries = [], imagesByName = new Map();
  let sourceBytes = 0;
  const folder = await files.opendir(absolute);
  for await (const dirent of folder) {
    if (entries.length >= LIMITS.entries) throw new Error('文件夹项目不能超过 3000 项，请先整理照片');
    const extension = path.extname(dirent.name);
    const entry = { file: dirent.name, name: path.basename(dirent.name, extension).normalize('NFC') };
    entries.push(entry);
    if (!IMAGE_EXTENSIONS.has(extension.toLowerCase())) { entry.skip = '不是支持的照片格式'; continue; }
    try {
      entry.stat = await files.lstat(path.join(absolute, dirent.name));
      if (entry.stat.isSymbolicLink()) { entry.skip = '软链接不能导入'; continue; }
      if (!entry.stat.isFile()) { entry.skip = '仅导入当前文件夹的普通照片文件，不读取子文件夹'; continue; }
      sourceBytes += entry.stat.size;
      if (sourceBytes > LIMITS.totalBytes) throw new Error('照片文件总量不能超过 50 MB，请先整理或压缩照片');
    } catch (error) {
      if (sourceBytes > LIMITS.totalBytes) throw error;
      entry.error = '无法读取照片文件，请检查文件是否存在和读取权限';
    }
    const matchingFiles = imagesByName.get(entry.name) || [];
    matchingFiles.push(entry);
    imagesByName.set(entry.name, matchingFiles);
  }
  entries.sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0);

  const updates = [], results = [], counts = { success: 0, failed: 0, skipped: 0 };
  const webpDecoder = createWebPDecoder(nativeImage);
  try { for (const entry of entries) {
    const matches = studentsByName.get(entry.name) || [];
    let status = 'skipped', reason = entry.skip;
    if (!reason && !matches.length) reason = '未找到姓名完全匹配的学生';
    if (!reason && matches.length > 1) reason = '班级中有同名学生，无法确定照片归属';
    if (!reason && imagesByName.get(entry.name).length > 1) reason = '有多张同名照片，无法确定使用哪一张';
    if (!reason) {
      try {
        if (entry.error) throw new Error(entry.error);
        const bytes = await readPhoto(absolute, entry, directoryStat);
        const photo = await encodePhoto(bytes, nativeImage, webpDecoder);
        updates.push({ id: matches[0].id, photo });
        status = 'success';
        reason = '已按姓名匹配并准备照片';
      } catch (error) {
        status = 'failed';
        reason = ['EACCES', 'EPERM', 'ENOENT', 'ELOOP'].includes(error.code)
          ? '照片无法读取或已变化，请检查文件和读取权限' : error.message || '照片导入失败';
      }
    }
    results.push({ name: entry.name, file: entry.file, status, reason });
    counts[status] += 1;
  } } finally { webpDecoder.close(); }
  const photosById = new Map(updates.map(update => [update.id, update.photo]));
  const totalPhotoBytes = students.reduce((total, student) => total + (photosById.get(student.id) ?? student.photo ?? '').length, 0);
  if (totalPhotoBytes > LIMITS.totalBytes) throw new Error('全部照片数据不能超过 50 MB，请先压缩照片');
  return { updates, results, counts };
}

module.exports = { prepareBatchPhotos, decodePhotoBytes, LIMITS };
