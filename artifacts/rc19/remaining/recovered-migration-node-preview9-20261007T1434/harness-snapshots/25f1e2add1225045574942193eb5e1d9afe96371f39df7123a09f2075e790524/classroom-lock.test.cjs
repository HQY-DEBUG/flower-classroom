'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createClassroomLock, FILE_NAME } = require('../src/classroom-lock.cjs');
const { shuffledDigits } = require('../src/classroom-lock-ui.js');
// These PINs are synthetic unit-test input, never user credentials.
const PIN = '304987', REPLACEMENT = '76032581';
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-lock-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, FILE_NAME), lock: createClassroomLock(dir) };
}
function assertSafe(result) {
  assert.ok(Object.keys(result).every(key => ['ok', 'configured', 'locked', 'blocked', 'code', 'message'].includes(key)), 'Only safe public fields');
  assert.ok(!JSON.stringify(result).includes(PIN), 'Result does not contain PIN');
  assert.ok(!JSON.stringify(result).includes(REPLACEMENT), 'Result does not contain new PIN');
}
function faultDisk(method, when = () => true) {
  let fail = true;
  const disk = new Proxy(fs, { get(target, key) {
    if (key === method) return (...args) => { if (fail && when(...args)) throw Object.assign(Error('SYNTHETIC_STORAGE_FAILURE'), { code: 'EIO' }); return target[key](...args); };
    return target[key];
  } });
  return { disk, repair() { fail = false; } };
}

test('Classroom lock starts without a default PIN and exposes only safe flags', t => {
  const { lock, dir } = fixture(t);
  assert.deepEqual(lock.status(), { configured: false, locked: false, blocked: false });
  assert.equal(lock.lock().code, 'NOT_CONFIGURED');
  assert.equal(lock.unlock(PIN).code, 'NOT_CONFIGURED');
  assert.equal(lock.change(PIN, REPLACEMENT, REPLACEMENT).code, 'NOT_CONFIGURED');
  assert.equal(fs.readdirSync(dir).length, 0);
  assertSafe(lock.status());
});
test('Setup requires matching 4–12 ASCII digits and cancellation has no mutation API', t => {
  const { lock, file } = fixture(t);
  for (const input of ['', '123', '1'.repeat(13), '123a', '１２３４', ' 1234', '1234 ', 1234, null]) {
    assert.equal(lock.setup(input, input).ok, false);
    assert.equal(fs.existsSync(file), false);
    assert.equal(lock.status().configured, false);
  }
  assert.equal(lock.setup(PIN, REPLACEMENT).code, 'PIN_MISMATCH');
  assert.equal(fs.existsSync(file), false);
  assertSafe(lock.setup(PIN, PIN));
  assert.equal(lock.status().locked, true);
  assert.equal(lock.setup(REPLACEMENT, REPLACEMENT).code, 'ALREADY_CONFIGURED');
});
test('Wrong PIN retains persistent lock; unlock and re-lock survive a new instance', t => {
  const { lock, dir, file } = fixture(t);
  assert.equal(lock.setup(PIN, PIN).ok, true);
  let restarted = createClassroomLock(dir);
  assert.equal(restarted.status().locked, true);
  const before = fs.readFileSync(file, 'utf8');
  for (const candidate of ['1234', 'wrong', '', 304987]) {
    assert.equal(restarted.unlock(candidate).code, 'WRONG_PIN');
    assert.equal(restarted.status().locked, true);
    assert.ok(fs.readFileSync(file, 'utf8') === before, 'Wrong PIN does not change disk');
  }
  assertSafe(restarted.unlock(PIN));
  assert.equal(createClassroomLock(dir).status().locked, false);
  assert.equal(restarted.lock().ok, true);
  restarted = createClassroomLock(dir);
  assert.equal(restarted.status().locked, true);
});
test('Credential file contains only salted scrypt material and a lock flag, never plaintext', t => {
  const { lock, file, dir } = fixture(t); lock.setup(PIN, PIN);
  const raw = fs.readFileSync(file, 'utf8'), saved = JSON.parse(raw);
  assert.ok(Object.keys(saved).sort().join(',') === 'hash,locked,salt,version');
  assert.ok(!raw.includes(PIN), 'Plaintext PIN never stored');
  assert.ok(/^[0-9a-f]{64}$/.test(saved.salt), '32-byte random salt');
  assert.ok(/^[0-9a-f]{128}$/.test(saved.hash), '64-byte scrypt hash');
  const other = path.join(dir, 'another-device');
  createClassroomLock(other).setup(PIN, PIN);
  const second = JSON.parse(fs.readFileSync(path.join(other, FILE_NAME), 'utf8'));
  assert.ok(saved.salt !== second.salt, 'Fresh random salt per installation');
  assert.ok(saved.hash !== second.hash, 'Identical test PINs do not have identical hashes');
  assertSafe(lock.status()); assertSafe(lock.lock());
});
test('Change verifies old PIN, repeat and length; only new PIN works after restart', t => {
  const { lock, dir, file } = fixture(t); lock.setup(PIN, PIN); lock.unlock(PIN);
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(lock.change('0000', REPLACEMENT, REPLACEMENT).code, 'WRONG_PIN');
  assert.equal(lock.change(PIN, '123', '123').code, 'INVALID_PIN');
  assert.equal(lock.change(PIN, REPLACEMENT, PIN).code, 'PIN_MISMATCH');
  assert.ok(fs.readFileSync(file, 'utf8') === before, 'Invalid changes preserve disk');
  assertSafe(lock.change(PIN, REPLACEMENT, REPLACEMENT));
  assert.equal(lock.status().locked, false);
  const next = createClassroomLock(dir); next.lock();
  assert.equal(next.unlock(PIN).code, 'WRONG_PIN');
  assert.equal(next.unlock(REPLACEMENT).ok, true);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(REPLACEMENT));
});
test('Changing the password while locked preserves the locked state', t => {
  const { lock, dir } = fixture(t); lock.setup(PIN, PIN);
  assert.equal(lock.change(PIN, REPLACEMENT, REPLACEMENT).locked, true);
  assert.equal(createClassroomLock(dir).status().locked, true);
  assert.equal(lock.unlock(PIN).ok, false);
  assert.equal(lock.unlock(REPLACEMENT).ok, true);
});
for (const failure of ['openSync', 'writeFileSync', 'fsyncSync', 'renameSync']) {
  test(`Failed ${failure} never partially configures the lock and later retry succeeds`, t => {
    const { dir, file } = fixture(t), faulty = faultDisk(failure);
    const lock = createClassroomLock(dir, { fs: faulty.disk });
    assert.equal(lock.setup(PIN, PIN).code, 'SAVE_FAILED');
    assert.deepEqual(lock.status(), { configured: false, locked: false, blocked: false });
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.readdirSync(dir).length, 0, 'Failed temporary file cleaned');
    faulty.repair(); assert.equal(lock.setup(PIN, PIN).ok, true);
  });
}
test('Failed save keeps live and disk states identical for unlock, lock and password change', t => {
  const { dir, file, lock } = fixture(t); lock.setup(PIN, PIN);
  function attempt(operation) {
    const before = fs.readFileSync(file, 'utf8'), broken = faultDisk('renameSync');
    const current = createClassroomLock(dir, { fs: broken.disk }), flags = current.status();
    assert.equal(operation(current).code, 'SAVE_FAILED');
    assert.deepEqual(current.status(), flags);
    assert.ok(fs.readFileSync(file, 'utf8') === before, 'Failed save preserves exact disk bytes');
    assert.deepEqual(createClassroomLock(dir).status(), flags);
    assert.equal(fs.readdirSync(dir).length, 1, 'No orphaned temporary credential file');
    return current;
  }
  attempt(current => current.unlock(PIN));
  attempt(current => current.change(PIN, REPLACEMENT, REPLACEMENT));
  lock.unlock(PIN);
  attempt(current => current.lock());
});
test('Corruption, wrong schemas and oversized configuration fail closed without rewriting data', t => {
  const { dir, file, lock } = fixture(t); lock.setup(PIN, PIN);
  const original = JSON.parse(fs.readFileSync(file, 'utf8'));
  const examples = ['', 'not JSON', 'null', '{}', JSON.stringify({ ...original, locked: 'false' }), JSON.stringify({ ...original, version: 99 }), JSON.stringify({ ...original, pin: PIN }), JSON.stringify({ ...original, hash: 'short' }), ' '.repeat(4097)];
  for (const raw of examples) {
    fs.writeFileSync(file, raw);
    const current = createClassroomLock(dir);
    assert.deepEqual(current.status(), { configured: true, locked: true, blocked: true });
    for (const result of [current.lock(), current.unlock(PIN), current.setup(REPLACEMENT, REPLACEMENT), current.change(PIN, REPLACEMENT, REPLACEMENT)]) { assert.equal(result.code, 'CONFIG_UNREADABLE'); assertSafe(result); }
    assert.ok(fs.readFileSync(file, 'utf8') === raw, 'Corrupt config preserved');
  }
});
test('Unreadable configuration and a read race after existence check fail closed', t => {
  const { dir, lock } = fixture(t); lock.setup(PIN, PIN);
  const unreadable = faultDisk('readFileSync');
  assert.equal(createClassroomLock(dir, { fs: unreadable.disk }).status().blocked, true);
  const vanished = new Proxy(fs, { get(target, key) { return key === 'readFileSync' ? () => { throw Object.assign(Error('SYNTHETIC_RACE'), { code: 'ENOENT' }); } : target[key]; } });
  assert.equal(createClassroomLock(dir, { fs: vanished }).status().blocked, true);
});
test('A configuration symlink cannot silently bypass lock protection', t => {
  const { dir, file } = fixture(t);
  try { fs.symlinkSync(path.join(dir, 'missing-target'), file); }
  catch (error) { if (['EPERM', 'ENOTSUP'].includes(error.code)) { t.skip('This environment cannot create symlinks'); return; } throw error; }
  assert.equal(createClassroomLock(dir).status().blocked, true);
});
test('Random keyboard uses every decimal digit exactly once and always changes on re-lock', () => {
  let previous = [];
  for (let index = 0; index < 200; index++) {
    const current = shuffledDigits(previous);
    assert.equal([...current].sort().join(''), '0123456789');
    assert.notEqual(current.join(''), previous.join(''));
    previous = current;
  }
});
