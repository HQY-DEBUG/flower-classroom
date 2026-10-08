const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
// Export to a sibling temporary file so an interrupted replacement never
// truncates the teacher's existing backup or workbook.
function writeFileAtomic(file, bytes, { beforeCommit = () => {} } = {}) {
  if (typeof bytes !== 'string' && !Buffer.isBuffer(bytes)) throw new TypeError('导出内容无效');
  const temp = file + '.flower-' + randomUUID() + '.tmp';
  let created = false;
  try {
    const fd = fs.openSync(temp, 'wx');
    created = true;
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    beforeCommit();
    fs.renameSync(temp, file);
    created = false;
  } finally {
    if (created && fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
function saveAtomic(file, state, { preservePrevious = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  const fd = fs.openSync(temp, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(state), 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (!preservePrevious && fs.existsSync(file)) fs.copyFileSync(file, file + '.previous');
  fs.renameSync(temp, file);
}
const rosterTextHeaders = new Set(['姓名', 'name', '性别', 'gender', '小组', '组号', 'group', '头像名称', '头像', 'avatarName']);
// The worksheet scan has its own generous bound; blank/template rows are not
// students and must never consume the separate 300-student limit.
const MAX_WORKSHEET_ROWS = 100000;
async function emptyFormulaCaches(zip, sheetId) {
  const empty = new Set();
  // ExcelJS 4.4 drops valid cached empty strings as well as missing caches.
  // Reuse its XML parser dependency to distinguish an explicit string <v/>
  // from an unresolved formula, without evaluating any formula or link.
  const { SaxesParser } = require('saxes');
  const readXml = async (entryName, visit) => {
    const entry = zip.files.find(file => file.path === entryName);
    if (!entry) return;
    const parser = new SaxesParser({ xmlns: true });
    visit(parser);
    parser.write((await entry.buffer()).toString('utf8')).close();
  };
  let relationshipId, target;
  await readXml('xl/workbook.xml', parser => parser.on('opentag', tag => {
    if (tag.local === 'sheet' && tag.attributes.sheetId?.value === String(sheetId)) {
      relationshipId = Object.values(tag.attributes).find(attribute => attribute.local === 'id')?.value;
    }
  }));
  if (!relationshipId) return empty;
  await readXml('xl/_rels/workbook.xml.rels', parser => parser.on('opentag', tag => {
    if (tag.local === 'Relationship' && tag.attributes.Id?.value === relationshipId && tag.attributes.TargetMode?.value !== 'External') target = tag.attributes.Target?.value;
  }));
  if (!target) return empty;
  const entryName = path.posix.normalize(target.startsWith('/') ? target.slice(1) : path.posix.join('xl', target));
  if (!entryName.startsWith('xl/worksheets/')) return empty;
  await readXml(entryName, parser => {
    let cell, readingValue = false;
    parser.on('opentag', tag => {
      if (tag.local === 'c') cell = { address: tag.attributes.r?.value, string: tag.attributes.t?.value === 'str', formula: false, cached: false, value: '' };
      else if (cell && tag.local === 'f') cell.formula = true;
      else if (cell && tag.local === 'v') { cell.cached = true; readingValue = true; }
    });
    const append = value => { if (cell && readingValue) cell.value += value; };
    parser.on('text', append);
    parser.on('cdata', append);
    parser.on('closetag', tag => {
      if (tag.local === 'v') readingValue = false;
      if (tag.local === 'c' && cell) {
        if (cell.address && cell.string && cell.formula && cell.cached && cell.value === '') empty.add(cell.address);
        cell = undefined;
      }
    });
  });
  return empty;
}
function workbookCellText(cell, requiredText = true, emptyCaches = new Set()) {
  const raw = cell.value;
  // ExcelJS's value getter omits cached 0/false results. Read the result getter
  // directly, and never evaluate a formula or follow a hyperlink.
  const formula = raw && typeof raw === 'object' && ('formula' in raw || 'sharedFormula' in raw);
  const value = formula ? cell.result : raw;
  if (formula && value == null && !emptyCaches.has(cell.address)) {
    if (requiredText) throw new Error(`单元格 ${cell.address} 的公式没有可用计算结果，请在 Excel 中重新计算并保存，或改为文本后再导入`);
    return '';
  }
  const scalar = v => v == null ? '' : ['string', 'number', 'boolean'].includes(typeof v) ? String(v) : '';
  if (!value || typeof value !== 'object') return scalar(value);
  if (value.error !== undefined) {
    if (requiredText) throw new Error(`单元格 ${cell.address} 含有 Excel 错误，请修正或改为文本后再导入`);
    return '';
  }
  if (value instanceof Date) {
    if (requiredText) throw new Error(`单元格 ${cell.address} 是日期，请改为文本后再导入`);
    return '';
  }
  if (Array.isArray(value.richText)) return value.richText.map(run => scalar(run.text)).join('');
  return scalar(value.text);
}
async function parseWorkbook(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 10 * 1024 * 1024) throw new Error('名单文件不能超过 10 MB');
  const ExcelJS = require('exceljs');
  const book = new ExcelJS.Workbook();
  let zip;
  // Roster cells are text: the default CSV map would discard leading zeroes,
  // decimal suffixes, date-looking strings and literal spreadsheet error names.
  if (/\.csv$/i.test(filename)) { const { Readable } = require('node:stream'); await book.csv.read(Readable.from([buffer]), { map: value => value }); }
  else if (/\.xlsx$/i.test(filename)) {
    zip = await require('unzipper').Open.buffer(buffer);
    if(zip.files.length>2000 || zip.files.reduce((n,f)=>n+f.uncompressedSize,0)>32*1024*1024)throw new Error('Excel 解压后内容过大，请使用简洁的名单模板');
    await book.xlsx.load(buffer);
  }
  else throw new Error('仅支持 .xlsx / .csv 文件');
  const sheet = book.worksheets[0];
  if (!sheet || sheet.rowCount < 2) throw new Error('名单需包含表头及 1–300 位学生');
  if (sheet.rowCount > MAX_WORKSHEET_ROWS) throw new Error('工作表范围超过 100000 行，请删除多余空白行或使用简洁的名单模板');
  const emptyCaches = zip ? await emptyFormulaCaches(zip, sheet.id) : new Set();
  const headerRow = sheet.getRow(1);
  const headers = headerRow.values.slice(1).map((v, j) => workbookCellText(headerRow.getCell(j + 1), true, emptyCaches).replace(/^\uFEFF/, '').trim());
  if(headers.length>100)throw new Error('名单列数过多，请仅保留姓名、性别、组号和头像等名单列');
  if(headers.filter(h=>['姓名','name'].includes(h)).length!==1 || headers.filter(h=>['小组','组号','group'].includes(h)).length>1)throw new Error('姓名或小组/组号表头重复或混用，请仅保留一列');
  if (!headers.includes('姓名') && !headers.includes('name')) throw new Error('第一行需包含「姓名」或 name 表头');
  if(headers.filter(h=>['头像名称','头像','avatarName'].includes(h)).length>1)throw new Error('头像名称表头重复或混用，请仅保留一列');
  if(headers.filter(h=>['性别','gender'].includes(h)).length>1)throw new Error('性别表头重复或混用，请仅保留一列');
  const rows = [];
  sheet.eachRow((row, i) => {
    if (i === 1) return;
    const record = {};
    headers.forEach((h, j) => { if (h !== '__proto__' && h !== 'constructor' && h !== 'prototype') record[h] = workbookCellText(row.getCell(j + 1), rosterTextHeaders.has(h), emptyCaches); });
    if (Object.values(record).some(v => v.trim())) {
      rows.push(record);
      if (rows.length > 300) throw new Error('名单需包含表头及 1–300 位学生');
    }
  });
  if (!rows.length) throw new Error('名单需包含表头及 1–300 位学生');
  return rows;
}
function resolveAvatarRows(rows, items = []) {
  const fold=value=>String(value).normalize('NFC').toLocaleLowerCase('en-US');
  const stem=name=>name.replace(/\.(?:png|jpe?g|webp)$/i,'');
  const matches=[];
  const resolved=rows.map((row,index)=>{
    const rawRequested=String(row['头像名称']??row['头像']??row.avatarName??'');
    const requested=rawRequested.trim()?rawRequested:'';
    const rawGender=row['性别']??row.gender;
    const gender=rawGender===undefined?undefined:String(rawGender).trim();
    if(gender!==undefined&&!['','男','女'].includes(gender))throw new Error(`第${index+2}行性别仅支持男、女或留空，请核对原名单`);
    const result={name:row['姓名']??row.name,group:row['小组']??row['组号']??row.group,photo:'',...(gender===undefined?{}:{gender})};
    let status='default', detail='使用默认姓名头像', match;
    if(requested){
      if(/[\\/:\x00-\x1f\x7f]/.test(requested)||requested.trim()==='.'||requested.trim()==='..') {status='invalid';detail='只填写头像文件名，不支持路径或网址；使用默认头像';}
      else {
        const find=value=>{
          const exact=items.filter(item=>fold(item.fileName)===fold(value));
          return exact.length?exact:items.filter(item=>fold(stem(item.fileName))===fold(value));
        };
        // A copied filename may itself contain spaces. Match that identity
        // first, then allow ordinary input padding only when it has no match.
        let candidates=find(requested);
        if(!candidates.length&&requested!==requested.trim())candidates=find(requested.trim());
        if(candidates.length===1){match=candidates[0];result.photo=match.photo;status='matched';detail='已匹配 '+match.fileName;}
        else if(candidates.length>1){status='ambiguous';detail='名称有多个匹配，请填写完整文件名；暂用默认头像';}
        else{status='missing';detail='头像文件夹中未找到有效图片；使用默认头像';}
      }
    }
    matches.push({row:index+2,name:String(result.name??''),requested,status,detail,fileName:match?.fileName||'',photo:result.photo});
    return result;
  });
  return {rows:resolved,avatarMatches:matches};
}
function validatePhoto(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1400 * 1024) throw new Error('照片应小于 1.4 MB，请先裁剪或压缩');
  let mime;
  if (bytes[0]===0x89 && bytes.subarray(1,4).toString()==='PNG') mime='image/png';
  else if (bytes[0]===0xff && bytes[1]===0xd8) mime='image/jpeg';
  else if (bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP') mime='image/webp';
  else throw new Error('图片格式无效，仅支持 PNG、JPEG、WebP');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
module.exports = { saveAtomic, writeFileAtomic, parseWorkbook, validatePhoto, resolveAvatarRows };
