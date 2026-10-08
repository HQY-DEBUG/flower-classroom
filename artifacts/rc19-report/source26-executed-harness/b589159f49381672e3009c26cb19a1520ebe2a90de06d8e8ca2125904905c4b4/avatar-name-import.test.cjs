const test=require('node:test'),assert=require('node:assert/strict');
const {parseWorkbook,resolveAvatarRows}=require('../src/io.cjs');
const {SYNTHETIC_PNG}=require('./pet-fixtures.cjs');
const items=[{id:'a',fileName:'01-星星猫头鹰.png',photo:SYNTHETIC_PNG},{id:'b',fileName:'机器人.jpg',photo:SYNTHETIC_PNG},{id:'c',fileName:'机器人.webp',photo:SYNTHETIC_PNG},{id:'d',fileName:'Cat.PNG',photo:SYNTHETIC_PNG}];
test('Avatar filename matcher resolves explicit, unique stem and case-normalized names',()=>{
 const result=resolveAvatarRows(['01-星星猫头鹰.png','01-星星猫头鹰','cat.png'].map(avatarName=>({name:'合成同学',group:'合成组',avatarName})),items);
 assert.deepEqual(result.avatarMatches.map(v=>v.status),['matched','matched','matched']);assert.ok(result.rows.every(v=>v.photo===SYNTHETIC_PNG));
});
test('Empty, missing and ambiguous avatar names stay explicit and use default initials',()=>{
 const r=resolveAvatarRows(['','不存在.png','机器人'].map(avatarName=>({name:'合成同学',avatarName})),items);assert.deepEqual(r.avatarMatches.map(v=>v.status),['default','missing','ambiguous']);assert.ok(r.rows.every(v=>v.photo===''));
});
test('Avatar column never follows a path or URL and ignores unrelated raw photo columns',()=>{
 const names=['../cat.png','C:\\头像\\cat.png','https://example.invalid/avatar.png','folder/cat.png','x\x00.png'];
 const r=resolveAvatarRows(names.map(avatarName=>({name:'合成同学',avatarName,photo:SYNTHETIC_PNG})),items);assert.ok(r.avatarMatches.every(v=>v.status==='invalid'));assert.ok(r.rows.every(v=>v.photo===''));
});
test('Case-colliding filenames and omitted extensions are never silently chosen',()=>{
 const r=resolveAvatarRows([{name:'合成同学',avatarName:'CAT.png'}],[...items,{id:'e',fileName:'cat.png',photo:SYNTHETIC_PNG}]);assert.equal(r.avatarMatches[0].status,'ambiguous');
});
test('Resolved photo snapshots do not change if the source listing mutates after preview',()=>{
 const listing=items.map(v=>({...v})),r=resolveAvatarRows([{姓名:'合成甲',小组:'合成组',头像名称:'Cat.PNG'}],listing);listing[3].photo='';listing.pop();assert.equal(r.rows[0].photo,SYNTHETIC_PNG);assert.equal(r.avatarMatches[0].fileName,'Cat.PNG');
});
test('CSV old two-column template and new optional avatar-name column parse',async()=>{
 const old=await parseWorkbook(Buffer.from('\ufeff姓名,小组\n合成甲,合成组\n'),'old.csv');assert.equal(old[0]['姓名'],'合成甲');assert.equal(resolveAvatarRows(old,items).rows[0].photo,'');
 const next=await parseWorkbook(Buffer.from('\ufeff姓名,小组,头像名称\n合成乙,合成组,01-星星猫头鹰.png\n'),'next.csv');assert.equal(resolveAvatarRows(next,items).avatarMatches[0].status,'matched');
});
test('XLSX optional avatar name parses and duplicate aliases reject',async()=>{
 const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('名单');sheet.addRow(['姓名','小组','头像名称']);sheet.addRow(['合成甲','合成组','机器人.jpg']);const rows=await parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()),'合成.xlsx');assert.equal(resolveAvatarRows(rows,items).avatarMatches[0].status,'matched');
 await assert.rejects(()=>parseWorkbook(Buffer.from('姓名,小组,头像名称,avatarName\n合成甲,组,Cat.PNG,Cat.PNG'),'dupe.csv'),/头像名称表头重复/);
});
