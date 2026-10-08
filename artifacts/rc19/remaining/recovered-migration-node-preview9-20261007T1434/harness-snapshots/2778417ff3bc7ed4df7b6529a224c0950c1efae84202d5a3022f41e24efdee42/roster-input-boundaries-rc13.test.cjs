'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { parseWorkbook, resolveAvatarRows } = require('../src/io.cjs');
const { createInitialState, importRows } = require('../src/core.cjs');
const { SYNTHETIC_PNG } = require('./pet-fixtures.cjs');

async function xlsx(rows, edit = () => {}) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('合成名单');
  sheet.addRows([['姓名', '小组', '头像名称'], ...rows]);
  edit(sheet, book);
  return Buffer.from(await book.xlsx.writeBuffer());
}

test('uncached formulas in every recognized header or data field reject before replacement', async t => {
  for (const address of ['A1', 'B1', 'C1', 'A3', 'B3', 'C3']) {
    await t.test(address, async () => {
      const before = createInitialState(), snapshot = JSON.stringify(before);
      const bytes = await xlsx([['合成首位', '', ''], ['合成公式行', '', ''], ['合成末位', '', '']], sheet => {
        sheet.getCell(address).value = { formula: '"合成值"' };
      });
      await assert.rejects(async () => {
        const rows = await parseWorkbook(bytes, 'uncached.xlsx');
        importRows(resolveAvatarRows(rows).rows, before, 'replace');
      }, error => error.message.includes(address) && /公式/.test(error.message) && /文本|计算/.test(error.message));
      assert.equal(JSON.stringify(before), snapshot);
    });
  }
});

test('shared formulas with missing caches reject at their actual cell', async () => {
  const bytes = await xlsx([['合成首位', '', ''], ['', '', '']], sheet => {
    sheet.getCell('A2').value = { formula: '"合成首位"', result: '合成首位', shareType: 'shared', ref: 'A2:A3' };
    sheet.getCell('A3').value = { sharedFormula: 'A2' };
  });
  await assert.rejects(parseWorkbook(bytes, 'shared.xlsx'), /A3.*公式/);
});

test('cached empty strings, zero and false remain valid; unrelated uncached metadata is ignored', async () => {
  const cached = result => ({ formula: '1/0', result });
  const bytes = await xlsx([[cached('合成同学'), cached(''), cached('')], [cached(0), cached(false), '']], sheet => {
    sheet.getCell('D1').value = '备注';
    sheet.getCell('D2').value = { formula: '"未计算备注"' };
  });
  const rows = await parseWorkbook(bytes, 'cached.xlsx');
  assert.deepEqual(rows.map(row => [row.姓名, row.小组, row.头像名称]), [['合成同学', '', ''], ['0', 'false', '']]);
  assert.equal(importRows(resolveAvatarRows(rows).rows, createInitialState(), 'replace').students[0].group, '未分组');
});

test('cached empty strings are read from the selected worksheet when sheet order differs from IDs', async () => {
  const bytes = await xlsx([['合成第一张', { formula: '""', result: '' }, '']], (sheet, book) => {
    sheet.orderNo = 1;
    const other = book.addWorksheet('先读这张');
    other.orderNo = 0;
    other.addRows([['姓名', '小组', '头像名称'], ['合成实际首张', { formula: '""', result: '' }, '']]);
  });
  const rows = await parseWorkbook(bytes, 'reordered.xlsx');
  assert.deepEqual(rows.map(row => [row.姓名, row.小组]), [['合成实际首张', '']]);
});

test('blank XLSX separators and formatted tails do not consume the 300-student limit', async () => {
  const bytes = await xlsx(Array.from({ length: 300 }, (_, i) => ['合成' + i, '组', '']), sheet => {
    sheet.spliceRows(100, 0, [], []);
    for (let i = 304; i <= 500; i++) sheet.getCell('A' + i).numFmt = '@';
  });
  const rows = await parseWorkbook(bytes, '300-plus-blanks.xlsx');
  assert.equal(rows.length, 300);
  assert.equal(rows[299].姓名, '合成299');
  assert.equal(importRows(resolveAvatarRows(rows).rows, createInitialState(), 'replace').students.length, 300);
});

test('sparse worksheets and empty CSV trailing records retain only the populated roster rows', async () => {
  const bytes = await xlsx([['合成首行', '', '']], sheet => { sheet.getCell('A304').value = '合成末行'; });
  assert.deepEqual((await parseWorkbook(bytes, 'sparse.xlsx')).map(row => row.姓名), ['合成首行', '合成末行']);
  const csv = '姓名,小组,头像名称\r\n合成唯一,,\r\n' + ',,\r\n'.repeat(310);
  assert.deepEqual((await parseWorkbook(Buffer.from(csv), 'trailing.csv')).map(row => row.姓名), ['合成唯一']);
});

test('301 populated rows and entirely blank rosters still reject', async () => {
  await assert.rejects(parseWorkbook(await xlsx(Array.from({ length: 301 }, (_, i) => ['合成' + i, '', ''])), '301.xlsx'), /300/);
  await assert.rejects(parseWorkbook(await xlsx([['', '', '']], sheet => { sheet.getCell('A500').numFmt = '@'; }), 'empty.xlsx'), /1–300/);
});

test('worksheet processing bounds are separate from the student count', async () => {
  const bytes = await xlsx([['合成唯一', '', '']], sheet => { sheet.getCell('A100001').numFmt = '@'; });
  await assert.rejects(parseWorkbook(bytes, 'excessive-template.xlsx'), /工作表范围超过 100000 行/);
});

test('exact leading and trailing spaces in filenames win before optional input padding', () => {
  const items = [
    { fileName: ' 前导空格.png', photo: 'snapshot-leading' },
    { fileName: '前导空格.png', photo: 'snapshot-unspaced' },
    { fileName: '末尾.png ', photo: 'snapshot-trailing' },
    { fileName: '末尾.png', photo: 'snapshot-unpadded' },
    { fileName: 'Cat.PNG', photo: SYNTHETIC_PNG }
  ];
  const names = [' 前导空格.png', '前导空格.png', ' 前导空格', '末尾.png ', ' Cat.PNG ', '   '];
  const resolved = resolveAvatarRows(names.map(avatarName => ({ name: '合成同学', avatarName })), items);
  assert.deepEqual(resolved.rows.map(row => row.photo), ['snapshot-leading', 'snapshot-unspaced', 'snapshot-leading', 'snapshot-trailing', SYNTHETIC_PNG, '']);
  assert.deepEqual(resolved.avatarMatches.map(row => row.requested), names.map(name => name.trim() ? name : ''));
  assert.deepEqual(resolved.avatarMatches.map(row => row.status), ['matched', 'matched', 'matched', 'matched', 'matched', 'default']);
});

test('long filenames supported by the library retain the selected image in CSV and XLSX', async () => {
  for (const length of [185, 255]) {
    const name = 'a'.repeat(length - 4) + '.png', items = [{ fileName: name, photo: SYNTHETIC_PNG }];
    for (const [bytes, filename] of [[Buffer.from('姓名,小组,头像名称\n合成同学,组,' + name), 'long.csv'], [await xlsx([['合成同学', '组', name]]), 'long.xlsx']]) {
      const resolved = resolveAvatarRows(await parseWorkbook(bytes, filename), items);
      assert.equal(resolved.avatarMatches[0].status, 'matched');
      assert.equal(resolved.avatarMatches[0].fileName, name);
      assert.equal(importRows(resolved.rows, createInitialState(), 'replace').students[0].photo, SYNTHETIC_PNG);
    }
  }
});
