const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { parseWorkbook, resolveAvatarRows } = require('../src/io.cjs');
const { createInitialState, importRows } = require('../src/core.cjs');
const { SYNTHETIC_PNG } = require('./pet-fixtures.cjs');

const rich = (...texts) => ({ richText: texts.map((text, i) => ({ text, font: { bold: i % 2 === 0 } })) });
const avatars = ['001.png', '12.30.png', 'Hero.PNG'].map(fileName => ({ fileName, photo: SYNTHETIC_PNG }));
async function workbookRows(rows, edit = () => {}) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('合成名单');
  sheet.addRows(rows);
  edit(sheet);
  return parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()), 'synthetic.xlsx');
}

test('CSV retains quoted and unquoted numeric-looking names, groups and avatar stems', async () => {
  const rows = await parseWorkbook(Buffer.from('\ufeff姓名,小组,头像名称\r\n"0001","001","001"\r\n0002,0003,12.30\r\n'), 'synthetic.csv');
  assert.deepEqual(rows, [
    { 姓名: '0001', 小组: '001', 头像名称: '001' },
    { 姓名: '0002', 小组: '0003', 头像名称: '12.30' }
  ]);
  const resolved = resolveAvatarRows(rows, avatars);
  assert.deepEqual(resolved.avatarMatches.map(v => [v.requested, v.status]), [['001', 'matched'], ['12.30', 'matched']]);
  assert.deepEqual(importRows(resolved.rows, createInitialState(), 'replace').students.map(s => [s.name, s.group, s.photo]), [
    ['0001', '001', SYNTHETIC_PNG], ['0002', '0003', SYNTHETIC_PNG]
  ]);
});

test('CSV treats date, boolean, error and formula-looking fields as literal text', async () => {
  const names = ['2026-10-05', 'true', 'false', '#N/A', '#DIV/0!', '=1+1', '1e3', '+007', '-0', '0'];
  const rows = await parseWorkbook(Buffer.from('name,group\n' + names.map(name => `${name},001`).join('\n')), 'literal.csv');
  assert.deepEqual(rows.map(row => row.name), names);
  assert.ok(rows.every(row => row.group === '001'));
});

test('XLSX reads all rich-text header and value runs, preserving avatar snapshots', async () => {
  const rows = await workbookRows([
    [rich('\ufeff姓', '名 '), rich('小', '组'), rich('头像', '名称')],
    [rich('合成', '彩色', '同学'), rich('00', '1'), rich('He', 'ro.PNG')]
  ]);
  assert.deepEqual(rows, [{ 姓名: '合成彩色同学', 小组: '001', 头像名称: 'Hero.PNG' }]);
  const resolved = resolveAvatarRows(rows, avatars);
  assert.equal(resolved.avatarMatches[0].status, 'matched');
  assert.equal(resolved.rows[0].photo, SYNTHETIC_PNG);
});

test('XLSX rich-text English aliases and an old two-column roster still import', async () => {
  const rows = await workbookRows([[rich('na', 'me'), rich('gro', 'up')], [rich('合成', '同学'), '']]);
  const next = importRows(resolveAvatarRows(rows).rows, createInitialState(), 'replace');
  assert.deepEqual(next.students.map(s => [s.name, s.group, s.photo]), [['合成同学', '未分组', '']]);
});

test('XLSX replace retains a rich-text name-only row and skips genuinely blank rows', async () => {
  const before = createInitialState(), snapshot = JSON.stringify(before);
  const rows = await workbookRows([['姓名', '小组', '头像名称'], ['合成普通', '', ''], [rich('合成', '仅姓名'), '', ''], [rich('', ''), '', '']]);
  const next = importRows(resolveAvatarRows(rows).rows, before, 'replace');
  assert.deepEqual(next.students.map(s => s.name), ['合成普通', '合成仅姓名']);
  assert.equal(JSON.stringify(before), snapshot);
});

test('XLSX duplicate aliases remain invalid when their headers use rich text', async () => {
  await assert.rejects(workbookRows([[rich('姓', '名'), rich('na', 'me')], ['合成甲', '合成乙']]), /表头重复/);
  await assert.rejects(workbookRows([['姓名', rich('头像', '名称'), rich('avatar', 'Name')], ['合成甲', '001', '001']]), /头像名称表头重复/);
});

test('XLSX uses hyperlink labels for headers and values without importing link targets', async () => {
  const link = text => ({ text, hyperlink: 'https://example.invalid/never-opened' });
  const rows = await workbookRows([[link('姓名'), link('小组'), link('头像名称')], [link('合成链接同学'), link('001'), link('Hero.PNG')]]);
  assert.deepEqual(rows, [{ 姓名: '合成链接同学', 小组: '001', 头像名称: 'Hero.PNG' }]);
  assert.equal(resolveAvatarRows(rows, avatars).avatarMatches[0].status, 'matched');
});

test('XLSX reads cached formula strings, zero and false without calculating expressions', async () => {
  const cached = result => ({ formula: '1/0', result });
  const rows = await workbookRows([
    [cached('姓名'), cached('小组'), cached('头像名称')],
    [cached('0001'), cached('001'), cached('001')],
    [cached(0), cached(false), cached('')],
    [cached(false), cached(0), '']
  ]);
  assert.deepEqual(rows, [
    { 姓名: '0001', 小组: '001', 头像名称: '001' },
    { 姓名: '0', 小组: 'false', 头像名称: '' },
    { 姓名: 'false', 小组: '0', 头像名称: '' }
  ]);
});

test('XLSX retains raw numeric scalars without inventing custom-format zeroes', async () => {
  const rows = await workbookRows([['姓名', '小组', '头像名称'], [1, 12.3, 0]], sheet => {
    sheet.getCell('A2').numFmt = '0000';
    sheet.getCell('B2').numFmt = '0.00';
  });
  assert.deepEqual(rows, [{ 姓名: '1', 小组: '12.3', 头像名称: '0' }]);
});

test('XLSX text-field errors identify the cell and reject the entire parse before import', async t => {
  for (const address of ['A1', 'A3', 'B3', 'C3']) {
    for (const cached of [false, true]) {
      await t.test(`${address}: ${cached ? 'cached formula' : 'direct'} error`, async () => {
        const before = createInitialState(), snapshot = JSON.stringify(before);
        await assert.rejects(async () => {
          const rows = await workbookRows([['姓名', '小组', '头像名称'], ['合成有效', '组', ''], ['合成错误', '组', '']], sheet => {
            const error = { error: '#DIV/0!' };
            sheet.getCell(address).value = cached ? { formula: '1/0', result: error } : error;
          });
          importRows(resolveAvatarRows(rows).rows, before, 'replace');
        }, error => error.message.includes(address) && error.message.includes('错误') && !error.message.includes('[object Object]'));
        assert.equal(JSON.stringify(before), snapshot);
      });
    }
  }
});

test('XLSX actual date cells in imported text fields require explicit text', async () => {
  await assert.rejects(workbookRows([['姓名', '小组'], [new Date('2026-10-05T00:00:00.000Z'), '']]), /A2.*日期.*文本/);
});

test('XLSX unrelated metadata errors and dates do not reject a valid roster', async () => {
  const rows = await workbookRows([['姓名', '小组', '参考日期', '参考公式'], ['合成同学', '组', new Date('2026-10-05T00:00:00.000Z'), { error: '#N/A' }]]);
  assert.equal(importRows(resolveAvatarRows(rows).rows, createInitialState(), 'replace').students[0].name, '合成同学');
});
