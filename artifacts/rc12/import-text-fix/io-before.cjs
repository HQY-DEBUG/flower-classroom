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
async function parseWorkbook(buffer, filename) {
  if (!Buffer.isBuffer(buffer) || buffer.length > 10 * 1024 * 1024) throw new Error('名单文件不能超过 10 MB');
  const ExcelJS = require('exceljs');
  const book = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filename)) { const { Readable } = require('node:stream'); await book.csv.read(Readable.from([buffer])); }
  else if (/\.xlsx$/i.test(filename)) {
    const zip = await require('unzipper').Open.buffer(buffer);
    if(zip.files.length>2000 || zip.files.reduce((n,f)=>n+f.uncompressedSize,0)>32*1024*1024)throw new Error('Excel 解压后内容过大，请使用简洁的名单模板');
    await book.xlsx.load(buffer);
  }
  else throw new Error('仅支持 .xlsx / .csv 文件');
  const sheet = book.worksheets[0];
  if (!sheet || sheet.rowCount < 2 || sheet.rowCount > 301) throw new Error('名单需包含表头及 1–300 位学生');
  const headers = sheet.getRow(1).values.slice(1).map(v => String(v ?? '').replace(/^\uFEFF/, '').trim());
  if(headers.length>100)throw new Error('名单列数过多，请仅保留姓名、小组和可选头像名称列');
  if(headers.filter(h=>['姓名','name'].includes(h)).length!==1 || headers.filter(h=>['小组','group'].includes(h)).length>1)throw new Error('姓名或小组表头重复或混用，请仅保留一列');
  if (!headers.includes('姓名') && !headers.includes('name')) throw new Error('第一行需包含「姓名」或 name 表头');
  if(headers.filter(h=>['头像名称','avatarName'].includes(h)).length>1)throw new Error('头像名称表头重复或混用，请仅保留一列');
  const rows = [];
  sheet.eachRow((row, i) => {
    if (i === 1) return;
    const record = {};
    headers.forEach((h, j) => { const value = row.getCell(j + 1).value; if (h !== '__proto__' && h !== 'constructor' && h !== 'prototype') record[h] = value && typeof value === 'object' ? String(value.text ?? value.result ?? '') : String(value ?? ''); });
    if (Object.values(record).some(v => v.trim())) rows.push(record);
  });
  return rows;
}
function resolveAvatarRows(rows, items = []) {
  const fold=value=>String(value).normalize('NFC').toLocaleLowerCase('en-US');
  const stem=name=>name.replace(/\.(?:png|jpe?g|webp)$/i,'');
  const matches=[];
  const resolved=rows.map((row,index)=>{
    const requested=String(row['头像名称']??row.avatarName??'').trim();
    const result={name:row['姓名']??row.name,group:row['小组']??row.group,photo:''};
    let status='default', detail='使用默认姓名头像', match;
    if(requested){
      if(requested.length>180||/[\\/:\x00-\x1f\x7f]/.test(requested)||requested==='.'||requested==='..') {status='invalid';detail='只填写头像文件名，不支持路径或网址；使用默认头像';}
      else {
        const exact=items.filter(item=>fold(item.fileName)===fold(requested));
        const candidates=exact.length?exact:items.filter(item=>fold(stem(item.fileName))===fold(requested));
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
