'use strict';

const fs = require('node:fs');
const { TextDecoder } = require('node:util');

const CONFIG_FILE_NAME = '配置.txt';
const MAX_CONFIG_BYTES = 64 * 1024;
const DEFAULT_CONFIG = Object.freeze({ initialZoom: 1, windowWidth: 1280, windowHeight: 840, startMinimized: false });
const DEFAULT_CONFIG_TEXT = [
  '# 花伴课堂 · 文件夹版配置',
  '# 使用 UTF-8 保存。每行一个 名称=值；以 # 或 ; 开头的行是说明。',
  '# 修改后完整退出程序，再重新打开生效。删除某项即使用下方默认值。',
  '# 这里只控制显示和启动方式，不改变课堂数据、密码、积分或宠物规则。',
  '# 数据固定保存在本程序旁的“数据”文件夹，备份默认保存在“备份”。',
  '# 不支持自定义数据路径；移动或复制时请带走整个程序文件夹。',
  '',
  '# 初始界面缩放：0.5 至 2（1 为 100%）。',
  'initialZoom=1',
  '# 主窗口初始宽度：900 至 3840 像素。',
  'windowWidth=1280',
  '# 主窗口初始高度：640 至 2160 像素。',
  'windowHeight=840',
  '# 启动后最小化：true 或 false。课堂锁的保护状态不会改变。',
  'startMinimized=false',
  ''
].join('\r\n');

class PortableConfigError extends Error {
  constructor(message, { code = 'CONFIG_INVALID', line, path, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'PortableConfigError';
    this.code = code;
    if (line !== undefined) this.line = line;
    if (path !== undefined) this.path = path;
  }
}

function parsePortableConfig(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_CONFIG_BYTES) {
    throw new PortableConfigError('配置.txt 必须是小于等于 64 KB 的 UTF-8 文本');
  }
  const config = { ...DEFAULT_CONFIG }, seen = new Set();
  const lines = source.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim(), line = index + 1;
    if (!text || text.startsWith('#') || text.startsWith(';')) continue;
    const fail = message => { throw new PortableConfigError(`配置.txt 第 ${line} 行：${message}`, { line }); };
    const entry = /^([A-Za-z][A-Za-z0-9]*)\s*=\s*([^#;]*?)(?:\s*[#;].*)?$/.exec(text);
    if (!entry) fail('请使用 名称=值 格式');
    const key = entry[1], value = entry[2].trim();
    if (!Object.hasOwn(DEFAULT_CONFIG, key)) fail(`不支持的设置“${key}”，请保留文件中列出的显示和启动设置`);
    if (seen.has(key)) fail(`设置“${key}”重复，请只保留一行`);
    seen.add(key);
    if (key === 'startMinimized') {
      if (!['true', 'false'].includes(value)) fail('startMinimized 只能是 true 或 false');
      config[key] = value === 'true';
      continue;
    }
    if (!/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(value)) fail(`${key} 必须填写数字`);
    const number = Number(value);
    const [min, max] = key === 'initialZoom' ? [0.5, 2] : key === 'windowWidth' ? [900, 3840] : [640, 2160];
    if (!Number.isFinite(number) || number < min || number > max || (key !== 'initialZoom' && !Number.isInteger(number))) {
      fail(`${key} 必须在 ${min} 至 ${max} 之间${key === 'initialZoom' ? '' : '，且为整数'}`);
    }
    config[key] = number;
  }
  return Object.freeze(config);
}

// A missing file is deliberately reported as ENOENT so only first-run bootstrap
// may create the template. An unreadable or malformed file is never replaced.
function readPortableConfig(file, { fs: disk = fs } = {}) {
  let stat;
  try { stat = disk.lstatSync(file); }
  catch (error) {
    if (error.code === 'ENOENT') throw error;
    throw new PortableConfigError('配置.txt 无法读取，请检查此文件的读取权限', { code: 'CONFIG_UNREADABLE', path: file, cause: error });
  }
  if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) {
    throw new PortableConfigError('配置.txt 必须是小于等于 64 KB 的普通 UTF-8 文本文件', { path: file });
  }
  let bytes;
  try { bytes = disk.readFileSync(file); }
  catch (error) {
    throw new PortableConfigError('配置.txt 无法读取，请检查此文件的读取权限', { code: 'CONFIG_UNREADABLE', path: file, cause: error });
  }
  try {
    if (bytes.length > MAX_CONFIG_BYTES) throw new PortableConfigError('配置.txt 不能超过 64 KB');
    return parsePortableConfig(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof PortableConfigError) { error.path = file; throw error; }
    throw new PortableConfigError('配置.txt 编码无法读取，请使用 UTF-8 保存', { path: file, cause: error });
  }
}

module.exports = { CONFIG_FILE_NAME, MAX_CONFIG_BYTES, DEFAULT_CONFIG, DEFAULT_CONFIG_TEXT, PortableConfigError, parsePortableConfig, readPortableConfig };
