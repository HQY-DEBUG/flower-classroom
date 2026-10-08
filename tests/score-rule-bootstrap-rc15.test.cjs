'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const ExcelJS = require('exceljs');
const Core = require('../src/core.cjs');
const Rules = require('../src/score-rules.js');
const {createScoreRuleWorkbook, buildInitialBytes, isInitialBytes, buildBytes, parseBytes,
  FILE_NAME, INITIAL_PANEL_ID, INITIAL_MARKER, INITIAL_VERSION, INITIAL_SHA256} = require('../src/score-rule-workbook.cjs');

function classroom({custom = false, multiple = false, blank = true} = {}) {
  const state = Core.createInitialState();
  state.settings.className = '新学期班级';
  if (blank) state.students = [];
  state.panels = {activeId: `panel_${randomUUID()}`, others: []};
  if (custom) state.settings.scoreRules = [{id: 'old_rule', label: '老师保留的规则', delta: -7, growthDelta: 0}];
  if (multiple) {
    const other = Core.createInitialState();
    other.settings.className = '另一课堂';
    other.settings.scoreRules = [{id: 'other_rule', label: '另一个面板的规则', delta: 9}];
    state.panels.others.push({id: `panel_${randomUUID()}`, data: other});
  }
  return state;
}
async function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-initial-rules-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const backupDirectory = path.join(directory, '备份');
  fs.mkdirSync(backupDirectory);
  const file = path.join(directory, FILE_NAME);
  const initial = await buildInitialBytes();
  if (options.initial !== false) fs.writeFileSync(file, initial);
  const service = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory, ...options});
  return {directory, backupDirectory, file, initial, service};
}
async function edit(file, modify) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  modify(book.getWorksheet('计分卡片'), book);
  await book.xlsx.writeFile(file);
}
const saved = value => value;

test('distribution template is reproducible across clocks and time zones with an explicit unbound marker', async () => {
  const bytes = await buildInitialBytes();
  assert.equal(isInitialBytes(bytes), true);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheet = book.getWorksheet('计分卡片');
  assert.equal(sheet.actualRowCount, Rules.defaults.length + 1);
  assert.equal(book.getWorksheet('宠物进阶').getCell('A2').value, INITIAL_PANEL_ID);
  assert.equal(sheet.getCell('A2').value, Rules.defaults[0].id);
  assert.equal(sheet.getCell('D2').value, null);
  const markers = [];
  book.getWorksheet('填写说明').eachRow(row => {if (row.getCell(1).value === INITIAL_MARKER) markers.push(row.getCell(2).value);});
  assert.deepEqual(markers, [INITIAL_VERSION]);
  for (const timezone of ['Pacific/Honolulu', 'Asia/Shanghai']) {
    const child = spawnSync(process.execPath, ['-e', `const RealDate=Date;global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2031-08-17T12:34:56Z']));}};const w=require('./src/score-rule-workbook.cjs');w.buildInitialBytes().then(bytes=>console.log(require('node:crypto').createHash('sha256').update(bytes).digest('hex')));`],
      {cwd: path.resolve(__dirname, '..'), env: {...process.env, TZ: timezone}, encoding: 'utf8'});
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), INITIAL_SHA256);
  }
});

test('blank first launch binds random panel IDs and durably saves once; restart preserves all bytes', async t => {
  const {service, file, directory, backupDirectory} = await setup(t);
  const state = classroom(), prior = structuredClone(state);
  let writes = 0;
  const first = await service.bootstrap(state, {saveState: value => {writes++; return value;}});
  assert.equal(first.bound, true); assert.equal(first.created, false); assert.equal(first.needsReview, false);
  assert.deepEqual(first.state.students, state.students); assert.deepEqual(first.state.logs, state.logs); assert.ok(first.state.appConfig); assert.ok(first.state.sharedScoreRules); assert.deepEqual(state, prior); assert.equal(writes, 1);
  const bytes = fs.readFileSync(file);
  assert.equal(isInitialBytes(bytes), false);
  const panels = await parseBytes(bytes, state);
  assert.equal(panels[0].id, state.panels.activeId); assert.deepEqual(panels[0].rules, Rules.defaults);
  const restarted = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory});
  const second = await restarted.bootstrap(first.state, {saveState: () => assert.fail('restart must not rewrite valid JSON')});
  assert.equal(second.bound, false); assert.equal(second.needsReview, false);
  assert.equal(second.validated, true); assert.equal(restarted.status().observedHash, second.hash);
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('missing workbook is created at startup with local receipts and without reading any outside directory', async t => {
  const {directory, backupDirectory, file} = await setup(t, {initial: false});
  const touched = [];
  const fileSystem = new Proxy(fs, {get(target, key) {
    if (['openSync', 'readFileSync', 'statSync', 'renameSync', 'unlinkSync'].includes(key)) return (...args) => {
      for (const candidate of (key === 'renameSync' ? args.slice(0, 2) : args.slice(0, 1))) if (typeof candidate === 'string') {
        assert.equal(path.relative(directory, candidate).startsWith('..'), false, candidate); touched.push(candidate);
      }
      return target[key](...args);
    };
    return target[key];
  }});
  const service = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory, fileSystem});
  const result = await service.bootstrap(classroom(), {saveState: saved});
  assert.equal(result.created, true); assert.equal(fs.existsSync(file), true);
  assert.equal(touched.some(name => name.endsWith('.flower-pending.json')), true);
  assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.tmp') || name.endsWith('.flower-pending.json')), false);
});

test('untouched shipped template uses migrated custom JSON and every panel instead of default rules', async t => {
  const {service, file} = await setup(t), state = classroom({custom: true, multiple: true, blank: false});
  const legacy = structuredClone(state);
  await assert.rejects(service.bootstrap(state, {saveState: saved}), /先预览并确认合并/);
  assert.deepEqual(state, legacy);
  Rules.confirmShared(state, Rules.previewShared(state).expectedKey);
  const before = structuredClone(state);
  await service.bootstrap(state, {saveState: saved});
  const panels = await parseBytes(fs.readFileSync(file), state);
  assert.equal(panels.length, 2);
  assert.deepEqual(panels.find(panel => panel.id === state.panels.activeId).rules, state.settings.scoreRules);
  assert.deepEqual(panels.find(panel => panel.id === state.panels.others[0].id).rules, state.panels.others[0].data.settings.scoreRules);
  assert.deepEqual(state, before);
});

test('edited placeholder is retained at startup and binds only after explicit single-panel refresh', async t => {
  const {service, file, backupDirectory} = await setup(t), state = classroom();
  await edit(file, sheet => {sheet.getCell('B2').value = '解压后先修改的卡片'; sheet.getCell('C2').value = -5; sheet.getCell('D2').value = 0;});
  const external = fs.readFileSync(file), prior = structuredClone(state);
  const result = await service.bootstrap(state, {saveState: () => assert.fail('edited template must not silently import')});
  assert.equal(result.validationDeferred, true);
  const opened = await service.open(state);
  assert.equal(opened.externalChanged, true); assert.match(opened.warning, /未绑定/);
  assert.deepEqual(fs.readFileSync(file), external); assert.deepEqual(state, prior);
  await assert.rejects(service.prepareSave(state, state), /未绑定/);
  const preview = await service.prepareRefresh(state);
  assert.equal(preview.initialBinding, true); assert.equal(preview.summary[0].id, state.panels.activeId);
  assert.match(preview.warning, /新学期班级/); assert.equal(path.dirname(preview.backupPath), backupDirectory);
  assert.deepEqual(fs.readFileSync(file), external);
  const next = service.commitRefresh(preview, {currentState: state, saveState: saved});
  assert.equal(next.settings.scoreRules[0].label, '解压后先修改的卡片'); assert.equal(next.settings.scoreRules[0].delta, -5);
  assert.equal(next.settings.scoreRules[0].growthDelta, 0); assert.deepEqual(fs.readFileSync(preview.backupPath), external);
  assert.deepEqual((await parseBytes(fs.readFileSync(file), next))[0].rules, next.settings.scoreRules);
  assert.deepEqual(state, prior);
});

test('an edited multi-panel placeholder stays intact until an explicit rebuild preserves the original', async t => {
  const {service, file, backupDirectory} = await setup(t), state = classroom({custom: true, multiple: true});
  await edit(file, sheet => sheet.getCell('B2').value = '无法猜测所属面板');
  const external = fs.readFileSync(file);
  const result = await service.bootstrap(state, {saveState: () => assert.fail('must not save')});
  assert.equal(result.validationDeferred, true);
  await assert.rejects(service.prepareRefresh(state), /多个面板/);
  assert.deepEqual(fs.readFileSync(file), external);
  Rules.confirmShared(state, Rules.previewShared(state).expectedKey);
  const preview = await service.prepareExport(state, {expectedHash: result.hash});
  assert.equal(path.dirname(preview.backupPath), backupDirectory);
  const next = service.commitExport(preview, {currentState: state, saveState: saved});
  assert.deepEqual(fs.readFileSync(preview.backupPath), external);
  assert.equal((await parseBytes(fs.readFileSync(file), next)).length, 2);
});

test('format-only template edits are never automatically overwritten', async t => {
  const {service, file} = await setup(t);
  await edit(file, sheet => sheet.getCell('B2').font = {bold: true});
  const external = fs.readFileSync(file);
  assert.equal(isInitialBytes(external), false);
  const result = await service.bootstrap(classroom(), {saveState: () => assert.fail('must not save')});
  assert.equal(result.validationDeferred, true); assert.deepEqual(fs.readFileSync(file), external);
});

test('custom and unrelated old workbook bytes survive bootstrap without touching current JSON', async t => {
  const {service, file} = await setup(t), state = classroom({custom: true});
  const different = structuredClone(state); different.settings.scoreRules[0].label = '旧表中的规则';
  for (const bytes of [await buildBytes(state), await buildBytes(different), Buffer.from('old unreadable workbook retained')]) {
    fs.writeFileSync(file, bytes);
    const result = await service.bootstrap(state, {saveState: () => assert.fail('must not save old files')});
    assert.equal(result.bound, false); assert.deepEqual(fs.readFileSync(file), bytes);
  }
  assert.equal(state.settings.scoreRules[0].label, '老师保留的规则');
});

test('panel rename on restart keeps file and ownership, then explicit save updates display names', async t => {
  const {service, file, directory, backupDirectory} = await setup(t), state = classroom();
  await service.bootstrap(state, {saveState: saved});
  const bytes = fs.readFileSync(file), renamed = structuredClone(state);
  renamed.settings.className = '改名后的班级';
  const restarted = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory});
  const result = await restarted.bootstrap(renamed, {saveState: () => assert.fail('rename must not force startup write')});
  assert.equal(result.needsReview, true); assert.equal(result.validationDeferred, true);
  assert.match((await restarted.open(renamed)).warning, /不同|当前课堂/);
  assert.deepEqual(fs.readFileSync(file), bytes);
  const next = structuredClone(renamed); next.settings.scoreRules = [...Rules.defaults]; next.revision++;
  await assert.rejects(restarted.prepareSave(renamed,next), /外部更改/);
  const token = await restarted.prepareExport(renamed);
  restarted.commitExport(token, {currentState: renamed, saveState: saved});
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(file);
  assert.equal(book.getWorksheet('宠物进阶').getCell('B2').value, '改名后的班级');
});

test('failed first JSON save restores the exact template or absence and allows retry', async t => {
  for (const initial of [true, false]) {
    const {service, file, initial: template} = await setup(t, {initial}), state = classroom();
    await assert.rejects(service.bootstrap(state, {saveState: () => {throw new Error('synthetic full disk');}}), /full disk/);
    if (initial) assert.deepEqual(fs.readFileSync(file), template); else assert.equal(fs.existsSync(file), false);
    assert.equal(fs.existsSync(file + '.flower-pending.json'), false);
    assert.equal((await service.bootstrap(state, {saveState: saved})).bound, true);
  }
});

test('failed workbook replacement and stale startup guard never invoke JSON save', async t => {
  for (const failure of ['rename', 'guard']) {
    const {directory, file, initial, backupDirectory} = await setup(t), state = classroom();
    const fileSystem = new Proxy(fs, {get(target, key) {
      if (key === 'renameSync' && failure === 'rename') return (...args) => {
        if (args[1] === file) {const error = new Error('synthetic lock'); error.code = 'EBUSY'; throw error;}
        return target.renameSync(...args);
      };
      return target[key];
    }});
    const service = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory, fileSystem});
    let guards = 0;
    await assert.rejects(service.bootstrap(state, {saveState: () => assert.fail('must not save'), beforeCommit: () => {
      if (++guards > 1 && failure === 'guard') throw new Error('startup epoch changed');
    }}), failure === 'rename' ? /关闭可能占用/ : /epoch changed/);
    assert.deepEqual(fs.readFileSync(file), initial);
    assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.tmp') || name.endsWith('.flower-pending.json')), false);
  }
});

test('external edit racing startup binding is retained and rejects the transaction', async t => {
  const {directory, backupDirectory, file} = await setup(t), state = classroom();
  const external = Buffer.from('externally replaced workbook');
  const service = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory,
    loadExcel: () => {fs.writeFileSync(file, external); return ExcelJS;}});
  await assert.rejects(service.bootstrap(state, {saveState: () => assert.fail('must not save')}), /外部更改/);
  assert.deepEqual(fs.readFileSync(file), external);
});

test('interrupted bootstrap recovers both sides of JSON save, including regenerated initial panel IDs', async t => {
  for (const afterJson of [false, true]) {
    const {directory, backupDirectory, file, initial} = await setup(t), state = classroom();
    const stateFile = path.join(directory, 'synthetic-state.json');
    const modulePath = path.resolve(__dirname, '../src/score-rule-workbook.cjs');
    const script = `const fs=require('node:fs');const {createScoreRuleWorkbook}=require(${JSON.stringify(modulePath)});const state=${JSON.stringify(state)};createScoreRuleWorkbook({resourceDirectory:${JSON.stringify(directory)},backupDirectory:${JSON.stringify(backupDirectory)}}).bootstrap(state,{saveState:value=>{${afterJson ? `fs.writeFileSync(${JSON.stringify(stateFile)},JSON.stringify(value));` : ''}process.exit(23);}}).catch(error=>{console.error(error);process.exit(1);});`;
    const child = spawnSync(process.execPath, ['-e', script], {encoding: 'utf8'});
    assert.equal(child.status, 23, child.stderr); assert.equal(fs.existsSync(file + '.flower-pending.json'), true);
    const durable = afterJson ? JSON.parse(fs.readFileSync(stateFile)) : classroom();
    const restarted = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory});
    assert.deepEqual(restarted.recover(durable), {recovered: true, committed: afterJson});
    if (!afterJson) assert.deepEqual(fs.readFileSync(file), initial);
    await restarted.bootstrap(durable, {saveState: saved});
    assert.equal((await parseBytes(fs.readFileSync(file), durable))[0].id, durable.panels.activeId);
  }
});

test('failed edited-template refresh rolls back external bytes and preserves its backup', async t => {
  const {service, file} = await setup(t), state = classroom();
  await edit(file, sheet => sheet.getCell('B2').value = '需要保留的编辑');
  const external = fs.readFileSync(file), preview = await service.prepareRefresh(state);
  assert.throws(() => service.commitRefresh(preview, {currentState: state, saveState: () => {throw new Error('JSON rejected');}}), /JSON rejected/);
  assert.deepEqual(fs.readFileSync(file), external); assert.deepEqual(fs.readFileSync(preview.backupPath), external);
  assert.equal(fs.existsSync(file + '.flower-pending.json'), false);
});

test('marked initial table cannot mix real IDs, invalid edits, or lose optimistic conflict guards', async t => {
  const {service, file, initial} = await setup(t), state = classroom();
  await edit(file, (_sheet, book) => {const stages=book.getWorksheet('宠物进阶'); stages.addRow([state.panels.activeId, state.settings.className, '旧版每级成长',20,40,60,80,100,120]);});
  await assert.rejects(service.prepareRefresh(state), /重复/);
  fs.writeFileSync(file, initial);
  await edit(file, sheet => sheet.getCell('C2').value = {formula: '1+1', result: 2});
  await assert.rejects(service.prepareRefresh(state), /公式/);
  fs.writeFileSync(file, initial);
  await edit(file, sheet => sheet.getCell('B2').value = '确认前编辑');
  const preview = await service.prepareRefresh(state);
  await edit(file, sheet => sheet.getCell('B2').value = '确认后又修改');
  const external = fs.readFileSync(file);
  assert.throws(() => service.commitRefresh(preview, {currentState: state, saveState: () => assert.fail('must not save')}), /外部更改/);
  assert.deepEqual(fs.readFileSync(file), external);
});

test('backup destination outside the portable root is rejected', async t => {
  const {directory} = await setup(t);
  assert.throws(() => createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory: path.dirname(directory)}), /程序文件夹内/);
});

test('existing workbook startup never loads Excel or trusts its bytes before explicit validation', async t => {
  const {directory, backupDirectory, file} = await setup(t), state = classroom({custom: true});
  const valid = await buildBytes(state), malformed = Buffer.from('preserve malformed old Excel');
  for (const bytes of [valid, malformed]) {
    fs.writeFileSync(file, bytes);
    let loads = 0;
    const service = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory, loadExcel: () => {loads++; return ExcelJS;}});
    const result = await service.bootstrap(state, {saveState: () => assert.fail('existing startup must not save')});
    assert.equal(loads, 0); assert.equal(result.validationDeferred, true); assert.equal(result.state, state);
    assert.equal(service.status().observedHash, undefined); assert.deepEqual(fs.readFileSync(file), bytes);
    if (bytes === malformed) {
      await assert.rejects(service.prepareRefresh(state));
      await assert.rejects(service.prepareSave(state, state));
    } else {
      await service.prepareSave(state, state); assert.equal(loads > 0, true);
    }
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
});

test('interrupted bootstrap cannot overwrite a subsequent external edit even when initial IDs changed', async t => {
  const {directory, backupDirectory, file} = await setup(t), state = classroom();
  let blockRollback = false;
  const fileSystem = new Proxy(fs, {get(target, key) {
    if (key === 'renameSync') return (...args) => {if (blockRollback && args[1] === file) throw new Error('rollback locked'); return target.renameSync(...args);};
    return target[key];
  }});
  const service = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory, fileSystem});
  await assert.rejects(service.bootstrap(state, {saveState: () => {blockRollback = true; throw new Error('JSON failure');}}), /回滚也未完成/);
  const external = Buffer.from('external file after interrupted initial binding'); fs.writeFileSync(file, external);
  const restarted = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory});
  await assert.rejects(restarted.bootstrap(classroom(), {saveState: () => assert.fail('must not save')}), /尚未完成/);
  assert.deepEqual(fs.readFileSync(file), external); assert.equal(fs.existsSync(file + '.flower-pending.json'), true);
});

test('bootstrap recovery never broadens the recovery rules for a prior custom workbook', async t => {
  const {directory, backupDirectory, file} = await setup(t), state = classroom({custom: true});
  fs.writeFileSync(file, await buildBytes(state));
  let blockRollback = false;
  const fileSystem = new Proxy(fs, {get(target, key) {
    if (key === 'renameSync') return (...args) => {if (blockRollback && args[1] === file) throw new Error('rollback locked'); return target.renameSync(...args);};
    return target[key];
  }});
  const service = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory, fileSystem});
  const preview = await service.prepareExport(state, {expectedHash: service.info().hash});
  assert.throws(() => service.commitExport(preview, {currentState: state, saveState: () => {blockRollback = true; throw new Error('JSON failure');}}), /回滚也未完成/);
  const receiptPath = file + '.flower-pending.json', receipt = JSON.parse(fs.readFileSync(receiptPath));
  receipt.purpose = 'bootstrap'; fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  const baseline = fs.readFileSync(file);
  const restarted = createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory});
  assert.throws(() => restarted.recover(classroom()), /初始化事务校验失败/);
  assert.deepEqual(fs.readFileSync(file), baseline);
});
