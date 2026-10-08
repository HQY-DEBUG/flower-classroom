'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../src/core.cjs');
const { legacyState, SYNTHETIC_PNG } = require('./pet-fixtures.cjs');
const clone = value => JSON.parse(JSON.stringify(value));

test('RC11 roster photo snapshots: omitted and blank optional photos keep two-column imports compatible', () => {
  const original = Core.validateState(legacyState());
  const state = Core.importRows([{ 姓名: '纯合成甲', 小组: '合成组' }, { name: '纯合成乙', group: '', photo: '' }], original, 'append');
  assert.deepEqual(state.students.slice(0, original.students.length), original.students);
  assert.deepEqual(state.students.slice(-2).map(student => [student.name, student.group, student.photo, student.startFromEgg]), [
    ['纯合成甲', '合成组', '', true], ['纯合成乙', '未分组', '', true]
  ]);
  assert.deepEqual(state.logs, original.logs);
});

test('RC11 roster photo snapshots: append preserves existing avatars/history and replace saves validated snapshots in new egg accounts', () => {
  const original = Core.validateState(require('./rc18-regression-fixtures.cjs').historical('legacyEnabled'));
  const rows = [{ name: '纯合成头像同学', group: '头像组', photo: SYNTHETIC_PNG, '头像名称': 'synthetic.png' }];
  const appended = Core.importRows(rows, original, 'append');
  assert.deepEqual(appended.students.slice(0, -1), original.students);
  assert.deepEqual(appended.petAccounts.slice(0, -1), original.petAccounts);
  assert.deepEqual(appended.logs, original.logs);
  assert.equal(appended.students.at(-1).photo, SYNTHETIC_PNG);
  assert.equal(Object.hasOwn(appended.students.at(-1), '头像名称'), false);
  assert.equal(Core.petProfile(appended, appended.students.at(-1)).isEgg, true);
  const replaced = Core.importRows(rows, appended, 'replace');
  assert.equal(replaced.students.length, 1); assert.equal(replaced.students[0].photo, SYNTHETIC_PNG);
  assert.equal(replaced.petAccounts.length, 1); assert.equal(replaced.petAccounts[0].cycles[0].startFromEgg, true);
  assert.equal(Core.petProfile(replaced, replaced.students[0]).isEgg, true);
  assert.deepEqual(Core.validateState(clone(replaced)), replaced);
});

test('RC11 roster photo snapshots: an invalid later photo rejects the entire append or replace import', () => {
  const state = Core.validateState(legacyState()), before = JSON.stringify(state);
  for (const mode of ['append', 'replace']) for (const photo of [null, 1, {}, '/tmp/synthetic.png', 'https://example.invalid/photo.png',
    'data:image/png;base64,bm90LWEtcG5n', 'data:image/svg+xml;base64,PHN2Zz4=', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    assert.throws(() => Core.importRows([{ name: '纯合成可用', photo: SYNTHETIC_PNG }, { name: '纯合成无效', photo }], state, mode), /第 2 行：照片/);
    assert.equal(JSON.stringify(state), before);
  }
});
