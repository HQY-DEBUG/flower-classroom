'use strict';
// Application-only classroom privacy lock. This does not lock the OS or prevent
// an administrator from reading/changing files in the application's data folder.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');

const FILE_NAME = 'classroom-lock.json';
const MAX_CONFIG_BYTES = 4096;
const validPin = pin => typeof pin === 'string' && /^[0-9]{4,12}$/.test(pin);
const derive = (pin, salt) => scryptSync(pin, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });

function validConfig(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'hash,locked,salt,version' &&
    value.version === 1 && typeof value.locked === 'boolean' &&
    typeof value.salt === 'string' && /^[0-9a-f]{64}$/.test(value.salt) &&
    typeof value.hash === 'string' && /^[0-9a-f]{128}$/.test(value.hash);
}

function createClassroomLock(dataDir, options = {}) {
  // The optional filesystem is a test seam, never exposed to the renderer.
  const disk = options.fs || fs;
  const file = path.join(dataDir, FILE_NAME);
  let config = null, blocked = false, found = false;
  try {
    const stat = disk.lstatSync(file); found = true;
    if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) throw Error('Invalid config');
    const candidate = JSON.parse(disk.readFileSync(file, 'utf8'));
    if (!validConfig(candidate)) throw Error('Invalid config');
    config = candidate;
  } catch (error) {
    // Only an absent file means "not set up". Corruption, permission errors and
    // unsupported formats keep the classroom protected without overwriting it.
    if (found || error?.code !== 'ENOENT') blocked = true;
  }

  function status() {
    return { configured: !!config || blocked, locked: blocked || !!config?.locked, blocked };
  }
  const result = (ok, code, message) => ({ ok, ...status(), ...(code ? { code, message } : {}) });
  const unavailable = () => blocked ? result(false, 'CONFIG_UNREADABLE', '课堂锁配置无法读取，已保持保护。请保留数据目录并联系管理员检查。') : null;
  const invalid = () => result(false, 'INVALID_PIN', '密码须为 4–12 位数字');
  function persist(next) {
    const temp = path.join(dataDir, `.${FILE_NAME}.${randomUUID()}.tmp`);
    let descriptor;
    try {
      disk.mkdirSync(dataDir, { recursive: true });
      descriptor = disk.openSync(temp, 'wx', 0o600);
      disk.writeFileSync(descriptor, JSON.stringify(next) + '\n', 'utf8');
      disk.fsyncSync(descriptor);
      disk.closeSync(descriptor); descriptor = undefined;
      disk.renameSync(temp, file);
      // No state change or success response until the full replacement commits.
      config = next;
      return result(true);
    } catch (_) {
      if (descriptor !== undefined) { try { disk.closeSync(descriptor); } catch {} }
      try { disk.unlinkSync(temp); } catch {}
      return result(false, 'SAVE_FAILED', '课堂锁未能保存，状态没有改变。请检查可用空间和数据目录权限后重试。');
    }
  }
  function matches(pin) {
    if (!validPin(pin) || !config) return false;
    const computed = derive(pin, config.salt);
    try { return timingSafeEqual(computed, Buffer.from(config.hash, 'hex')); }
    finally { computed.fill(0); }
  }
  function credential(pin, locked) {
    const salt = randomBytes(32).toString('hex'), hash = derive(pin, salt);
    try { return { version: 1, salt, hash: hash.toString('hex'), locked }; }
    finally { hash.fill(0); }
  }
  function setup(pin, repeat) {
    const stop = unavailable(); if (stop) return stop;
    if (config) return result(false, 'ALREADY_CONFIGURED', '课堂密码已设置，请使用修改密码');
    if (!validPin(pin) || !validPin(repeat)) return invalid();
    if (pin !== repeat) return result(false, 'PIN_MISMATCH', '两次输入不一致，请重新输入');
    return persist(credential(pin, true));
  }
  function lock() {
    const stop = unavailable(); if (stop) return stop;
    if (!config) return result(false, 'NOT_CONFIGURED', '请先设置课堂密码');
    return config.locked ? result(true) : persist({ ...config, locked: true });
  }
  function unlock(pin) {
    const stop = unavailable(); if (stop) return stop;
    if (!config) return result(false, 'NOT_CONFIGURED', '尚未设置课堂密码');
    if (!matches(pin)) return result(false, 'WRONG_PIN', '密码不正确，请重试');
    return config.locked ? persist({ ...config, locked: false }) : result(true);
  }
  function change(oldPin, newPin, repeat) {
    const stop = unavailable(); if (stop) return stop;
    if (!config) return result(false, 'NOT_CONFIGURED', '请先设置课堂密码');
    if (!matches(oldPin)) return result(false, 'WRONG_PIN', '当前密码不正确，请重试');
    if (!validPin(newPin) || !validPin(repeat)) return invalid();
    if (newPin !== repeat) return result(false, 'PIN_MISMATCH', '两次输入不一致，请重新输入');
    return persist(credential(newPin, config.locked));
  }
  return Object.freeze({ status, setup, lock, unlock, change });
}

module.exports = { createClassroomLock, FILE_NAME };
