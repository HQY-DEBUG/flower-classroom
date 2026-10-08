'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {createHash} = require('node:crypto');
const ExcelJS = require('exceljs');
const Core = require('../src/core.cjs');
const Rules = require('../src/score-rules.js');
const Progress = require('../src/pet-progress.js');
const W = require('../src/score-rule-workbook.cjs');
const clone = value => structuredClone(value), saved = value => Core.validateState(value);
function legacyState() {
  const state = Core.createInitialState(), second = Core.applyAction(Core.createInitialState(), {type:'pet.stage-rules',thresholds:[1,2,3,4,5,6]}, 1000);
  state.settings.className='合成旧版班'; state.settings.petStep=13; state.settings.scoreRules=[{id:'rule_same',label:'合成旧卡片',delta:2}];
  second.settings.className='合成六段班'; second.settings.scoreRules=[{id:'rule_same',label:'合成另一卡片',delta:4,growthDelta:0}];
  state.version=2;state.panels={activeId:'panel_old',others:[{id:'panel_six',data:second}]};
  return Core.validateState(state);
}
function sharedState() {const state=legacyState();Rules.confirmShared(state,Rules.previewShared(state).expectedKey);return saved(state);}
function fixture(t, options={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'flower-shared-rc18-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const backupDirectory=path.join(directory,'备份');fs.mkdirSync(backupDirectory);
  const create=overrides=>W.createScoreRuleWorkbook({resourceDirectory:directory,backupDirectory,...options,...overrides});
  return {directory,backupDirectory,file:path.join(directory,W.FILE_NAME),create,service:create()};
}
async function edit(file, modify) {const book=new ExcelJS.Workbook();await book.xlsx.readFile(file);modify(book);await book.xlsx.writeFile(file);}
async function legacyBytes(state) {
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet(W.SHEET_NAME);sheet.addRow(W.LEGACY_HEADERS);
  const panels=[{id:state.panels.activeId,data:state},...state.panels.others];
  for(const panel of panels)for(const rule of panel.data.settings.scoreRules)sheet.addRow([panel.id,panel.data.settings.className,rule.id,rule.label,rule.delta,rule.growthDelta??null]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
function changeRules(state) {const next=clone(state),rules=Rules.list(next);rules[0].label='合成更改卡片';Rules.setShared(next,rules);next.revision++;return next;}

test('RC18 uses one shared card sheet and exact cumulative growth for both existing progression modes',async t=>{
  const f=fixture(t),state=sharedState();await f.service.open(state);
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(f.file);
  assert.deepEqual(book.getWorksheet(W.SHEET_NAME).getRow(1).values.slice(1),W.HEADERS);
  assert.equal(book.getWorksheet(W.SHEET_NAME).actualRowCount,Rules.list(state).length+1);
  const parsed=await W.parseBytes(fs.readFileSync(f.file),state);
  assert.deepEqual(parsed.map(p=>p.cumulative),[[13,26,39,52,65,78],[1,3,6,10,15,21]]);
  assert.deepEqual(parsed[0].rules,parsed[1].rules);
  assert.deepEqual(parsed.map(p=>p.mode),['legacy-step','ledger-six']);
});

test('RC18 combined card and progression apply is atomic and retains all ledger and historical snapshots',async t=>{
  const f=fixture(t),state=sharedState(),original=clone(state);await f.service.open(state);
  await edit(f.file,book=>{book.getWorksheet(W.SHEET_NAME).getCell('B2').value='合成所有面板共用';const s=book.getWorksheet(W.PROGRESSION_SHEET);[7,14,21,28,35,42].forEach((v,i)=>s.getRow(2).getCell(i+4).value=v);[2,5,9,14,20,27].forEach((v,i)=>s.getRow(3).getCell(i+4).value=v);});
  const external=fs.readFileSync(f.file),preview=await f.service.prepareRefresh(state);
  assert.equal(preview.shared,true);assert.equal(preview.ruleCount,2);assert.equal(preview.progression.every(p=>p.changed),true);
  assert.deepEqual(state,original);assert.deepEqual(fs.readFileSync(f.file),external);
  assert.throws(()=>f.service.commitRefresh(preview,{currentState:state,saveState:()=>{throw Error('synthetic JSON denied');}}),/synthetic JSON denied/);
  assert.deepEqual(state,original);assert.deepEqual(fs.readFileSync(f.file),external);
  const retry=await f.service.prepareRefresh(state),next=f.service.commitRefresh(retry,{currentState:state,saveState:saved});
  assert.equal(next.settings.petStep,7);assert.equal(next.settings.petRules,undefined);
  assert.deepEqual(next.panels.others[0].data.settings.petRules.thresholds,[2,3,4,5,6,7]);
  assert.deepEqual(next.students,state.students);assert.deepEqual(next.logs,state.logs);
  assert.deepEqual(next.panels.others[0].data.petAccounts,state.panels.others[0].data.petAccounts);
  assert.deepEqual(next.panels.others[0].data.petLogs,state.panels.others[0].data.petLogs);
  assert.deepEqual(Rules.list(Core.applyAction(next,{type:'panel.switch',id:'panel_six'})),Rules.list(next));
  assert.equal(Rules.list(next)[0].label,'合成所有面板共用');
  const six=next.panels.others[0].data;
  for(const [growth,level] of [[0,1],[1,1],[2,2],[4,2],[5,3],[26,6],[27,7]])assert.equal(Progress.progress(growth,six.settings.petRules.thresholds).level,level);
  assert.equal(Core.petLevel({...next.students[0],growth:6},next.settings.petStep).level,1);
  assert.equal(Core.petLevel({...next.students[0],growth:7},next.settings.petStep).level,2);
});

test('RC18 missing progression sheet requires migration preview, preserves every current setting and backs original bytes',async t=>{
  const f=fixture(t),state=sharedState();await f.service.open(state);
  await edit(f.file,book=>{for(const name of ['宠物进阶','启动显示','面板设置','轮盘奖品','趣味挑战','课堂网址','作业科目','工具默认'])book.removeWorksheet(name);});
  const legacyFile=path.join(f.directory,W.LEGACY_FILE_NAME);fs.renameSync(f.file,legacyFile);
  const prior=fs.readFileSync(legacyFile),preview=await f.service.prepareRefresh(state);
  assert.equal(preview.migration.missingProgression,true);assert.match(preview.warning,/不会启用或重置/);
  assert.equal(preview.backupPath,undefined);
  const next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});
  assert.deepEqual(fs.readFileSync(path.join(f.directory,W.LEGACY_FILE_NAME)),prior);
  assert.deepEqual(W.configuration(next).map(p=>[p.mode,p.cumulative]),W.configuration(state).map(p=>[p.mode,p.cumulative]));
  const book=new ExcelJS.Workbook();await book.xlsx.readFile(f.file);assert.ok(book.getWorksheet(W.PROGRESSION_SHEET));
});

test('RC18 differing legacy workbook imports only after explicit preview and preserves both original source collections',async t=>{
  const f=fixture(t),state=legacyState(),original=clone(state),prior=await legacyBytes(state);fs.writeFileSync(path.join(f.directory,W.LEGACY_FILE_NAME),prior);
  const boot=await f.service.bootstrap(state,{saveState:()=>assert.fail('no automatic migration')});assert.equal(boot.migrationAvailable,true);
  await assert.rejects(f.service.prepareSave(state,changeRules(sharedState())),/旧版迁移/);assert.deepEqual(fs.readFileSync(path.join(f.directory,W.LEGACY_FILE_NAME)),prior);assert.deepEqual(state,original);
  const preview=await f.service.prepareRefresh(state);
  assert.equal(preview.migration.legacyColumns,true);assert.equal(preview.migration.missingProgression,true);assert.equal(preview.migration.conflicts[0].kind,'id');
  assert.deepEqual(state,original);assert.deepEqual(fs.readFileSync(path.join(f.directory,W.LEGACY_FILE_NAME)),prior);
  const next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});
  assert.deepEqual(next.sharedScoreRules.migration.panels.map(p=>p.rules),[state.settings.scoreRules,state.panels.others[0].data.settings.scoreRules]);
  assert.equal(new Set(Rules.list(next).map(r=>r.id)).size,2);assert.deepEqual(next.settings.scoreRules,next.panels.others[0].data.settings.scoreRules);
  assert.deepEqual(fs.readFileSync(path.join(f.directory,W.LEGACY_FILE_NAME)),prior);assert.deepEqual(next.students,state.students);
  assert.deepEqual(next.panels.others[0].data.petAccounts,state.panels.others[0].data.petAccounts);
});

test('RC18 rejects invalid, missing, duplicate, switched-mode and nonmonotonic progression without accepting card edits',async t=>{
  const f=fixture(t),state=sharedState();await f.service.open(state);const baseline=fs.readFileSync(f.file);
  for(const modify of [s=>s.getCell('C2').value='六段成长账本',s=>s.getCell('E2').value=25,s=>s.getCell('E3').value=1,s=>s.getCell('I3').value=1000000001,s=>s.getCell('D2').value=0,s=>s.getCell('D3').value={formula:'1+1',result:2},s=>s.spliceRows(2,1),s=>s.getCell('A3').value='panel_old',s=>s.getCell('D1').value='LV2积分']){
    fs.writeFileSync(f.file,baseline);await edit(f.file,book=>{book.getWorksheet(W.SHEET_NAME).getCell('B2').value='合成不应应用';modify(book.getWorksheet(W.PROGRESSION_SHEET));});
    const before=fs.readFileSync(f.file);await assert.rejects(f.service.prepareRefresh(state));assert.deepEqual(fs.readFileSync(f.file),before);assert.equal(Rules.list(state)[0].label,'合成旧卡片');
  }
});

test('RC18 EPERM after temp creation preserves old workbook and JSON; release and explicit re-preview retry commits once',async t=>{
  let denied=false,tempCreated=false,renameAttempts=0,writes=0;
  const f=fixture(t),state=sharedState(),next=changeRules(state),json=path.join(f.directory,'synthetic-state.json');fs.writeFileSync(json,JSON.stringify(state));
  const io=new Proxy(fs,{get(target,key){if(key==='renameSync')return(from,to)=>{if(to===f.file){renameAttempts++;if(denied){tempCreated=fs.existsSync(from)&&fs.statSync(from).size>0;throw Object.assign(Error('synthetic denied replacement'),{code:'EPERM'});}}return fs.renameSync(from,to);};return target[key];}});
  const service=f.create({fileSystem:io});await service.open(state);const baseline=fs.readFileSync(f.file),oldJson=fs.readFileSync(json);
  const token=await service.prepareSave(state,next);denied=true;
  assert.throws(()=>service.commitPrepared(token,{currentState:state,nextState:next,saveState:value=>{writes++;fs.writeFileSync(json,JSON.stringify(value));return saved(value);}}),/临时文件已写好.*具体原因尚未确认.*原表和课堂设置已保留.*重试保存/);
  assert.equal(tempCreated,true);assert.equal(writes,0);assert.deepEqual(fs.readFileSync(f.file),baseline);assert.deepEqual(fs.readFileSync(json),oldJson);
  assert.equal(fs.readdirSync(f.directory).some(name=>name.endsWith('.tmp')||name.endsWith('.flower-pending.json')),false);
  denied=false;const retry=await service.prepareSave(state,next);
  service.commitPrepared(retry,{currentState:state,nextState:next,saveState:value=>{writes++;fs.writeFileSync(json,JSON.stringify(value));return saved(value);}});
  assert.equal(writes,1);assert.equal(renameAttempts,3);const durable=saved(JSON.parse(fs.readFileSync(json)));
  assert.equal((await f.create().open(durable)).externalChanged,false);assert.equal(Rules.list(durable)[0].label,'合成更改卡片');
});

test('RC18 legacy RC17 receipt fingerprint recovers without accepting changed progression or deleting evidence',async t=>{
  const f=fixture(t),state=legacyState(),prior=await legacyBytes(state),after=Buffer.from('synthetic after workbook');fs.writeFileSync(f.file,after);
  const legacySignature=createHash('sha256').update(JSON.stringify(W.configuration(state).map(({id,name,rules})=>({id,name,rules})))).digest('hex');
  const hash=b=>createHash('sha256').update(b).digest('hex');
  fs.writeFileSync(f.file+'.flower-pending.json',JSON.stringify({version:1,beforeRules:legacySignature,afterRules:'a'.repeat(64),beforeHash:hash(prior),afterHash:hash(after),beforeBytes:prior.toString('base64')}));
  assert.deepEqual(f.service.recover(state),{recovered:true,committed:false});assert.deepEqual(fs.readFileSync(f.file),prior);
});
