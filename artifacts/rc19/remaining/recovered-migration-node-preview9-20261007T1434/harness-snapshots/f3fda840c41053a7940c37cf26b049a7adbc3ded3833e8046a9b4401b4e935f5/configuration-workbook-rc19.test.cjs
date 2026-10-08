'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const ExcelJS=require('exceljs'),Core=require('../src/core.cjs'),Rules=require('../src/score-rules.js'),Config=require('../src/configuration-model.js'),W=require('../src/score-rule-workbook.cjs'),PetScores=require('../src/pet-score-progression.js');
const clone=value=>structuredClone(value),saved=value=>Core.validateState(value);
function classroom(){
  const state=Core.createInitialState(),other=Core.createInitialState();
  delete other.petProgression;
  state.settings.className=other.settings.className='合成同名班';
  state.panels={activeId:'panel_a',others:[{id:'panel_b',data:other}]};
  Rules.confirmShared(state,Rules.previewShared(state).expectedKey);
  return saved(state);
}
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'flower-config-rc19-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const backup=path.join(root,'备份');fs.mkdirSync(backup);
  const create=options=>W.createScoreRuleWorkbook({resourceDirectory:root,backupDirectory:backup,...options});
  return {root,create,service:create(),file:path.join(root,W.FILE_NAME)};
}
async function load(file){const book=new ExcelJS.Workbook();await book.xlsx.readFile(file);return book;}
async function edit(file,fn){const book=await load(file);fn(book);await book.xlsx.writeFile(file);}
function col(sheet,name){const index=sheet.getRow(1).values.indexOf(name);assert.ok(index>0,`${sheet.name}: ${name}`);return index;}
function choices(book){const sheet=book.getWorksheet('面板设置');return [sheet.getCell('G2').value,sheet.getCell('G3').value];}
function addItems(book){
  const [first,second]=choices(book);
  book.getWorksheet('计分卡片').addRow(['','合成新卡片',4,0]);
  book.getWorksheet('轮盘奖品').addRow(['','','合成新奖品',25,second]);
  const links=book.getWorksheet('课堂网址');
  for(let row=links.rowCount;row>=2;row--)if(links.getRow(row).getCell(1).value==='panel_b')links.spliceRows(row,1);
  links.addRow(['','','合成新网址','https://example.com/class',second]);
  return {first,second};
}

test('RC19 exported IDs are hidden, duplicate panel names have distinct dropdown choices, and new rows have validation',async t=>{
  const f=fixture(t),state=classroom();await f.service.open(state);const book=await load(f.file);
  for(const sheet of book.worksheets)for(const cell of sheet.getRow(1)._cells)if(cell?.value?.endsWith?.('ID'))assert.equal(sheet.getColumn(cell.col).hidden,true,`${sheet.name} ${cell.value}`);
  const labels=choices(book);assert.notEqual(labels[0],labels[1]);assert.ok(labels.every(label=>label.startsWith('合成同名班')));
  for(const name of ['轮盘奖品','趣味挑战','课堂网址','作业科目','工具默认']){
    const sheet=book.getWorksheet(name),column=col(sheet,'所属面板');assert.equal(sheet.getColumn(column).hidden,false);
    assert.deepEqual(sheet.getRow(99).getCell(column).dataValidation.formulae,['FlowerPanelChoices']);
  }
  assert.equal(book.getWorksheet('面板设置').getColumn('G').hidden,true);
  assert.ok(book.definedNames.model.some(item=>item.name==='FlowerPanelChoices'));
});

test('RC19 reviewed add, cancel, apply, rename, reorder, refresh and restart retain stable IDs across all editable ID lists',async t=>{
  const f=fixture(t),state=classroom(),before=clone(state);await f.service.open(state);await edit(f.file,addItems);
  const external=fs.readFileSync(f.file),cancelled=await f.service.prepareRefresh(state);
  assert.deepEqual(state,before);assert.deepEqual(fs.readFileSync(f.file),external);
  f.service.invalidate();assert.throws(()=>f.service.commitRefresh(cancelled,{currentState:state,saveState:saved}),/过期/);
  const preview=await f.service.prepareRefresh(state);assert.ok(preview.rules.some(rule=>rule.label==='合成新卡片'&&rule.id.startsWith('rule_')));
  const next=f.service.commitRefresh(preview,{currentState:state,saveState:saved}),snap=Config.snapshot(next);
  const card=Rules.list(next).find(item=>item.label==='合成新卡片'),panel=snap.panels.find(item=>item.id==='panel_b');
  const prize=panel.wheelPrizes.find(item=>item.name==='合成新奖品'),link=panel.links[0];assert.ok(prize.id.startsWith('prize_'));assert.ok(link.id.startsWith('link_'));
  await edit(f.file,book=>{
    const cards=book.getWorksheet('计分卡片'),r=cards.getRow(cards.rowCount);r.getCell(2).value='合成改名卡片';const value=r.values;cards.spliceRows(cards.rowCount,1);cards.insertRow(2,value);
    const prizes=book.getWorksheet('轮盘奖品');for(const row of prizes.getRows(2,prizes.rowCount-1))if(row.getCell(2).value===prize.id)row.getCell(3).value='合成改名奖品';
    const links=book.getWorksheet('课堂网址');for(const row of links.getRows(2,links.rowCount-1))if(row.getCell(2).value===link.id)row.getCell(3).value='合成改名网址';
    const settings=book.getWorksheet('面板设置');settings.getCell('B3').value='合成面板新名';const a=settings.getRow(2).values,b=settings.getRow(3).values;settings.getRow(2).values=b;settings.getRow(3).values=a;
  });
  const final=f.service.commitRefresh(await f.service.prepareRefresh(next),{currentState:next,saveState:saved});
  assert.equal(Rules.list(final)[0].id,card.id);assert.equal(Rules.list(final)[0].label,'合成改名卡片');
  const changed=Config.snapshot(final).panels.find(item=>item.id==='panel_b');assert.equal(changed.name,'合成面板新名');assert.equal(changed.wheelPrizes.find(item=>item.name==='合成改名奖品').id,prize.id);assert.equal(changed.links[0].id,link.id);
  assert.deepEqual(final.students,state.students);assert.deepEqual(final.logs,state.logs);
  const restarted=f.create(),result=await restarted.bootstrap(final,{saveState:()=>assert.fail('restart must not write')});assert.equal(result.validated,true);
  const unchanged=restarted.commitRefresh(await restarted.prepareRefresh(final),{currentState:final,saveState:saved});assert.deepEqual(Rules.list(unchanged),Rules.list(final));assert.deepEqual(Config.snapshot(unchanged),Config.snapshot(final));
});

test('RC19 duplicate IDs, erased existing IDs, and ambiguous or conflicting panel references fail without mutation',async t=>{
  const f=fixture(t),state=classroom();await f.service.open(state);const baseline=fs.readFileSync(f.file),before=clone(state);
  const variants=[
    [b=>{const s=b.getWorksheet('计分卡片');s.addRow(s.getRow(2).values.slice(1));},/编号重复/],
    [b=>{const s=b.getWorksheet('轮盘奖品');s.addRow(s.getRow(2).values.slice(1));},/编号重复/],
    [b=>{const s=b.getWorksheet('计分卡片');s.getCell('A2').value='';s.getCell('B2').value='合成完全不同名称';},/无法确定是新增还是原条目/],
    [b=>{const s=b.getWorksheet('轮盘奖品');s.getCell('B2').value='';s.getCell('C2').value='合成完全不同奖品';},/无法确定是新增还是原条目/],
    [b=>b.getWorksheet('轮盘奖品').addRow(['','','合成新增',7,'合成同名班']),/名称重复/],
    [b=>b.getWorksheet('轮盘奖品').addRow(['','','合成新增',7,'']),/请选择.*所属面板/],
    [b=>b.getWorksheet('轮盘奖品').getCell('E2').value=choices(b)[1],/与该行保存的面板不一致/],
    [b=>b.getWorksheet('面板设置').addRow(['','合成新面板','true',1,'natural','false','合成新面板']),/新增面板请在软件内创建/]
  ];
  for(const [modify,error] of variants){fs.writeFileSync(f.file,baseline);await edit(f.file,modify);const bytes=fs.readFileSync(f.file);await assert.rejects(f.service.prepareRefresh(state),error);assert.deepEqual(fs.readFileSync(f.file),bytes);assert.deepEqual(state,before);}
});

test('RC19 legacy layout keeps its IDs and data and gains hidden IDs and panel dropdowns only after reviewed apply',async t=>{
  const f=fixture(t),state=classroom();await f.service.open(state);
  await edit(f.file,book=>{for(const name of ['面板设置','轮盘奖品','趣味挑战','课堂网址','作业科目','工具默认']){const sheet=book.getWorksheet(name);sheet.spliceColumns(sheet.columnCount,1);}for(const sheet of book.worksheets)for(const column of sheet.columns)column.hidden=false;const links=book.getWorksheet('课堂网址');for(let r=2;r<=links.rowCount;r++)links.getRow(r).getCell(3).value=null;});
  const source=fs.readFileSync(f.file),preview=await f.service.prepareRefresh(state);assert.deepEqual(fs.readFileSync(f.file),source);
  const next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});assert.deepEqual(Config.snapshot(next),Config.snapshot(state));assert.deepEqual(Rules.list(next),Rules.list(state));const book=await load(f.file);assert.equal(book.getWorksheet('轮盘奖品').getColumn(1).hidden,true);assert.ok(col(book.getWorksheet('轮盘奖品'),'所属面板'));
});

test('RC19 all-sheet refresh rejects external edits and state staleness, rolls back JSON failure and EPERM, and retries once cleanly',async t=>{
  const f=fixture(t),state=classroom(),before=clone(state);await f.service.open(state);await edit(f.file,book=>{addItems(book);book.getWorksheet('启动显示').getCell('B2').value=1.25;});
  const preview=await f.service.prepareRefresh(state);await edit(f.file,book=>book.getWorksheet('计分卡片').getCell('C2').value=9);assert.throws(()=>f.service.commitRefresh(preview,{currentState:state,saveState:saved}),/外部更改/);
  const stale=await f.service.prepareRefresh(state),renamed=clone(state);renamed.settings.className='合成并发改名';assert.throws(()=>f.service.commitRefresh(stale,{currentState:renamed,saveState:saved}),/已变化/);
  const original=fs.readFileSync(f.file),fail=await f.service.prepareRefresh(state);assert.throws(()=>f.service.commitRefresh(fail,{currentState:state,saveState:()=>{throw Error('synthetic JSON failure');}}),/synthetic JSON failure/);assert.deepEqual(fs.readFileSync(f.file),original);assert.deepEqual(state,before);
  let denied=true,writes=0;const io=new Proxy(fs,{get(target,key){if(key==='renameSync')return(from,to)=>{if(to===f.file&&denied)throw Object.assign(Error('synthetic EPERM'),{code:'EPERM'});return fs.renameSync(from,to);};return target[key];}}),service=f.create({fileSystem:io});
  const blocked=await service.prepareRefresh(state);assert.throws(()=>service.commitRefresh(blocked,{currentState:state,saveState:value=>{writes++;return saved(value);}}),/EPERM/);assert.equal(writes,0);assert.deepEqual(fs.readFileSync(f.file),original);assert.deepEqual(state,before);
  denied=false;const applied=service.commitRefresh(await service.prepareRefresh(state),{currentState:state,saveState:value=>{writes++;return saved(value);}});assert.equal(writes,1);assert.equal(applied.appConfig.initialZoom,1.25);assert.ok(Rules.list(applied).some(item=>item.label==='合成新卡片'));assert.equal((await f.create().bootstrap(applied,{saveState:()=>assert.fail('restart readonly')})).validated,true);
});

test('RC19 one global progression sheet exposes exact per-level costs and protected cumulative formulas without modes or panel IDs',async t=>{
  const f=fixture(t),state=classroom();await f.service.open(state);const book=await load(f.file),sheet=book.getWorksheet('宠物进阶');
  assert.deepEqual(sheet.getRow(1).values.slice(1),['等级','升级所需积分','累计积分门槛（自动）']);assert.equal(sheet.rowCount,27);
  assert.deepEqual(sheet.getRows(2,8).map(row=>row.getCell(2).value),[5,10,15,20,20,20,20,20]);
  assert.deepEqual(sheet.getRows(2,8).map(row=>row.getCell(3).value.result),[5,15,30,50,70,90,110,130]);
  assert.equal(sheet.getCell('C26').value.result,470);assert.equal(sheet.getCell('C27').value.result,490);assert.equal(sheet.getCell('B10').value.formula,'$B$9');assert.equal(sheet.getCell('B27').value.formula,'$B$9');assert.notEqual(sheet.getCell('B10').protection?.locked,false);
  assert.equal(sheet.sheetProtection.sheet,true);assert.equal(sheet.getCell('B2').protection.locked,false);assert.notEqual(sheet.getCell('C2').protection?.locked,false);
  assert.equal(book.getWorksheet('计分卡片').getColumn(4).hidden,true);
  const preview=await f.service.prepareRefresh(state);assert.deepEqual(preview.petProgression,PetScores.DEFAULT_PROGRESSION);assert.equal(preview.progression.length,1);assert.equal(preview.progression[0].mode,'current-score');
  assert.equal(preview.progression[0].changed,false);
});

test('RC19 global costs edit has one reviewed authority, recomputes formula caches, survives panel switch/restart, and preserves historical state',async t=>{
  const f=fixture(t),state=classroom();await f.service.open(state);const old=clone(state);
  await edit(f.file,book=>{const sheet=book.getWorksheet('宠物进阶');sheet.getCell('B2').value=6;sheet.getCell('B9').value=25;book.getWorksheet('面板设置').getCell('D2').value=3;});
  const original=fs.readFileSync(f.file),preview=await f.service.prepareRefresh(state);
  assert.deepEqual(preview.petProgression,{version:1,costs:[6,10,15,20,20,20,20],repeatCost:25});assert.deepEqual(preview.progression[0].cumulative,[6,16,31,51,71,91,111]);assert.equal(preview.progression[0].changed,true);assert.ok(preview.configSummary.some(item=>item.sheet==='宠物进阶'));
  assert.deepEqual(state,old);assert.deepEqual(fs.readFileSync(f.file),original);
  const next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});assert.deepEqual(next.petProgression,preview.petProgression);assert.deepEqual(next.students,state.students);assert.deepEqual(next.logs,state.logs);assert.deepEqual(next.petAccounts,state.petAccounts);assert.deepEqual(next.petLogs,state.petLogs);
  const applied=await load(f.file);assert.equal(applied.getWorksheet('宠物进阶').getCell('C2').value.result,6);assert.equal(applied.getWorksheet('宠物进阶').getCell('C9').value.result,136);assert.equal(applied.getWorksheet('宠物进阶').getCell('C26').value.result,561);assert.equal(applied.getWorksheet('宠物进阶').getCell('C27').value.result,586);
  const switched=Core.applyAction(next,{type:'panel.switch',id:'panel_b'});assert.deepEqual(switched.petProgression,next.petProgression);assert.equal((await f.create().bootstrap(switched,{saveState:()=>assert.fail('readonly restart')})).validated,true);
  const another=clone(next);another.petProgression.repeatCost=30;const save=await f.service.prepareSave(next,another);assert.equal(save.petProgression.repeatCost,30);assert.equal(save.progression[0].changed,true);
});

test('RC19 global progression rejects malformed costs and derived formulas and applies no unrelated sheet edits',async t=>{
  const f=fixture(t),state=classroom();await f.service.open(state);const baseline=fs.readFileSync(f.file),before=clone(state);
  for(const [fn,pattern] of [
    [s=>s.getCell('B2').value=0,/整数/],[s=>s.getCell('B2').value=-1,/整数/],[s=>s.getCell('B2').value=2.5,/整数/],
    [s=>s.getCell('B2').value=1000000000,/合计/],[s=>s.getCell('B9').value=0,/整数/],
    [s=>s.getCell('A3').value='LV1',/重复或调换/],[s=>s.spliceRows(27,1),/26行/],
    [s=>s.getCell('B2').value={formula:'1+4',result:5},/不能使用公式/],
    [s=>s.getCell('C2').value={formula:'B2+100',result:105},/公式已改变/],
    [s=>s.getCell('C2').value=999,/自动计算列/]
  ]){fs.writeFileSync(f.file,baseline);await edit(f.file,b=>{fn(b.getWorksheet('宠物进阶'));b.getWorksheet('启动显示').getCell('B2').value=1.4;});const bytes=fs.readFileSync(f.file);await assert.rejects(f.service.prepareRefresh(state),pattern);assert.deepEqual(fs.readFileSync(f.file),bytes);assert.deepEqual(state,before);}
});

test('RC19 old per-panel progression imports through reviewed backup without changing global rules or old historical settings',async t=>{
  const f=fixture(t),state=classroom();state.settings.petStep=13;state.panels.others[0].data.settings.petStep=17;await f.service.open(state);
  await edit(f.file,book=>{book.removeWorksheet('宠物进阶');const sheet=book.addWorksheet('宠物进阶');sheet.addRow(W.LEGACY_PROGRESSION_HEADERS);for(const [id,step] of [['panel_a',13],['panel_b',17]])sheet.addRow([id,'合成同名班','旧版每级成长',...Array.from({length:6},(_,i)=>step*(i+1)),'不适用']);});
  const oldBytes=fs.readFileSync(f.file),before=clone(state),preview=await f.service.prepareRefresh(state);assert.equal(preview.migration.globalProgression,true);assert.match(preview.warning,/统一按当前积分/);assert.deepEqual(preview.petProgression,PetScores.DEFAULT_PROGRESSION);assert.deepEqual(state,before);assert.deepEqual(fs.readFileSync(f.file),oldBytes);
  const next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});assert.deepEqual(fs.readFileSync(preview.backupPath),oldBytes);assert.equal(next.settings.petStep,13);assert.equal(next.panels.others[0].data.settings.petStep,17);assert.deepEqual(next.petProgression,PetScores.DEFAULT_PROGRESSION);assert.equal((await load(f.file)).getWorksheet('宠物进阶').getCell('A1').value,'等级');
});

test('RC19 initial template is deterministic, recognized, and bootstrap produces a bound global config',async t=>{
  const f=fixture(t),first=await W.buildInitialBytes(),second=await W.buildInitialBytes();assert.deepEqual(first,second);assert.equal(W.isInitialBytes(first),true);
  fs.writeFileSync(f.file,first);const state=Core.createInitialState(),next=(await f.service.bootstrap(state,{saveState:saved})).state;assert.ok(next.appConfig);assert.deepEqual(next.petProgression,PetScores.DEFAULT_PROGRESSION);assert.equal((await load(f.file)).worksheets.length,10);
});

test('RC19 recognizes the exact immutable RC18 initial template and preserves edited RC18 bytes through reviewed migration',async t=>{
  const f=fixture(t),state=Core.createInitialState(),original=fs.readFileSync(path.join(__dirname,'fixtures/rc18-initial-configuration.xlsx'));assert.equal(W.isInitialBytes(original),true);
  fs.writeFileSync(f.file,original);await edit(f.file,book=>{book.getWorksheet('轮盘奖品').getCell('C2').value='合成RC18外部改名';book.getWorksheet('启动显示').getCell('B2').value=1.15;});
  const edited=fs.readFileSync(f.file);assert.equal(W.isInitialBytes(edited),false);
  const boot=await f.service.bootstrap(state,{saveState:()=>assert.fail('edited old file requires preview')});assert.equal(boot.needsReview,true);assert.deepEqual(fs.readFileSync(f.file),edited);
  const preview=await f.service.prepareRefresh(state);assert.equal(preview.initialBinding,true);assert.equal(preview.migration.globalProgression,true);
  const next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});assert.equal(next.settings.wheelPrizes[0].name,'合成RC18外部改名');assert.equal(next.appConfig.initialZoom,1.15);assert.deepEqual(next.petProgression,PetScores.DEFAULT_PROGRESSION);assert.deepEqual(fs.readFileSync(preview.backupPath),edited);
  assert.deepEqual(fs.readFileSync(path.join(__dirname,'fixtures/rc18-initial-configuration.xlsx')),original);
});

test('RC19 shared cumulative formulas from spreadsheet applications are read as derived output and recomputed',async t=>{
  const f=fixture(t),state=classroom();await f.service.open(state);
  await edit(f.file,book=>{const sheet=book.getWorksheet('宠物进阶');sheet.fillFormula('C2:C8','SUM($B$2:B2)',[5,15,30,50,70,90,110],'shared');sheet.getCell('B2').value=7;});
  const preview=await f.service.prepareRefresh(state);assert.deepEqual(preview.progression[0].cumulative,[7,17,32,52,72,92,112]);const next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});assert.equal(next.petProgression.costs[0],7);
});

test('RC19 25-level export keeps one repeated-cost authority and accepts the unpublished eight-row draft layout',async t=>{
  const f=fixture(t),state=classroom();await f.service.open(state);
  await edit(f.file,book=>{book.removeWorksheet('宠物进阶');const sheet=book.addWorksheet('宠物进阶');sheet.addRow(W.PROGRESSION_HEADERS);let total=0;for(const [index,cost]of state.petProgression.costs.entries())sheet.addRow([`LV${index+1}`,cost,{formula:`SUM($B$2:B${index+2})`,result:total+=cost}]);sheet.addRow(['LV8及以后',20,{formula:'SUM($B$2:B8)+B9',result:total+20}]);});
  const preview=await f.service.prepareRefresh(state),next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});assert.deepEqual(next.petProgression,state.petProgression);const book=await load(f.file),sheet=book.getWorksheet('宠物进阶');assert.equal(sheet.rowCount,27);assert.equal(sheet.getCell('C26').value.result,470);assert.equal(sheet.getCell('C27').value.result,490);
  const baseline=fs.readFileSync(f.file);for(const value of [99,{formula:'$B$9+1',result:21}]){fs.writeFileSync(f.file,baseline);await edit(f.file,b=>b.getWorksheet('宠物进阶').getCell('B10').value=value);const before=fs.readFileSync(f.file);await assert.rejects(f.service.prepareRefresh(next),/自动计算/);assert.deepEqual(fs.readFileSync(f.file),before);}
  fs.writeFileSync(f.file,baseline);const parsed=await W.parseBytes(baseline,next);for(const [score,level]of [[469,24],[470,25],[489,25],[490,26]])assert.equal(PetScores.progress(score,parsed.configSnapshot.petProgression).level,level);
});
