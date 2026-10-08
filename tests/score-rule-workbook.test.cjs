'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const ExcelJS = require('exceljs');
const Rules = require('../src/score-rules.js');
const {createScoreRuleWorkbook, buildBytes, parseBytes, signature, FILE_NAME} = require('../src/score-rule-workbook.cjs');

function classroom() {
  const state = {version: 2, revision: 10, settings: {className: '一班', scoreRules: [
    {id: 'rule_a', label: '认真听讲', delta: 3}, {id: 'rule_b', label: '整理书桌', delta: -2}]},
  students: [{id: 's_a', name: '示例甲', score: 11}], logs: [{id: 'log_old', delta: 5}], petLogs: [{id: 'pet_old', delta: 2}],
  panels: {activeId: 'panel_a', others: [{id: 'panel_b', data: {version: 2, revision: 3,
    settings: {className: '二班', scoreRules: [{id: 'rule_a', label: '同编号不同规则', delta: 7}]},
    students: [{id: 's_b', name: '示例乙', score: 9}], logs: [{id: 'log_b', delta: 1}]}}]}};
  Rules.confirmShared(state, Rules.previewShared(state).expectedKey);
  return state;
}
function changed(state, label = '修改后的卡片') {
  const next = structuredClone(state);
  const rules = Rules.list(next); rules[0].label = label; Rules.setShared(next, rules);
  next.revision++;
  return next;
}
function setup(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-score-workbook-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  return {directory, service: createScoreRuleWorkbook({resourceDirectory: directory, ...options}), file: path.join(directory, FILE_NAME)};
}
async function edit(file, modify) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(file);
  modify(book.getWorksheet('计分卡片'), book);
  await book.xlsx.writeFile(file);
}
const saved = value => value;

test('construction does not read files or load Excel; info reads no workbook parser', t => {
  let reads = 0, loads = 0;
  const fileSystem = new Proxy(fs, {get(target, key) {
    if (['readFileSync', 'statSync'].includes(key)) return (...args) => {reads++; return target[key](...args);};
    return target[key];
  }});
  const {service} = setup(t, {fileSystem, loadExcel: () => {loads++; return ExcelJS;}});
  assert.equal(reads, 0); assert.equal(loads, 0);
  assert.equal(service.info().existing, false);
  assert.equal(loads, 0);
});

test('explicit first open creates workbook with every panel, preserved IDs, and blank legacy growth', async t => {
  const {service, file} = setup(t), state = classroom();
  const result = await service.open(state);
  assert.equal(result.created, true); assert.equal(result.externalChanged, false);
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(file);
  const sheet = book.getWorksheet('计分卡片');
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['规则ID', '卡片名称', '积分变化', '成长值变化']);
  assert.equal(sheet.getRow(2).getCell(1).value, 'rule_a');
  assert.equal(book.getWorksheet('面板设置').getRow(3).getCell(1).value, 'panel_b');
  assert.equal(sheet.getRow(4).getCell(2).value, '同编号不同规则');
  assert.equal(sheet.getRow(2).getCell(4).value, null);
  const before = fs.readFileSync(file);
  assert.equal((await service.open(state)).created, false);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('synchronous commit writes the file before JSON and preserves current unrelated scores/history', async t => {
  const {service, file} = setup(t), state = classroom();
  await service.open(state);
  const prep = await service.prepareSave(state, changed(state));
  const current = structuredClone(state); current.students[0].score = 18; current.logs.push({id: 'later'}); current.revision++;
  const next = changed(current);
  let callbacks = 0;
  const result = service.commitPrepared(prep.token, {currentState: current, nextState: next, saveState: value => {
    callbacks++; assert.notEqual(fs.readFileSync(file).length, 0); return value;
  }});
  assert.equal(callbacks, 1); assert.equal(result.students[0].score, 18);
  assert.deepEqual(result.logs, current.logs); assert.deepEqual(result.petLogs, state.petLogs);
  assert.deepEqual((await parseBytes(fs.readFileSync(file), next))[0].rules, next.settings.scoreRules);
  assert.throws(() => service.commitPrepared(prep.token, {currentState: current, nextState: next, saveState: saved}), /过期/);
});

test('saving the first UI rule change can create the workbook transactionally', async t => {
  const {service, file} = setup(t), state = classroom(), next = changed(state);
  const prepared = await service.prepareSave(state, next);
  assert.equal(fs.existsSync(file), false);
  service.commitPrepared(prepared, {currentState: state, nextState: next, saveState: saved});
  assert.equal(fs.existsSync(file), true);
  assert.equal(fs.existsSync(file + '.flower-pending.json'), false);
});

test('external changes before prepare, after prepare, and invalid cells never silently overwrite', async t => {
  const {service, file} = setup(t), state = classroom();
  await service.open(state);
  await edit(file, sheet => sheet.getCell('B2').value = 'Excel中的新卡片');
  const external = fs.readFileSync(file);
  await assert.rejects(service.prepareSave(state, changed(state)), /外部更改/);
  assert.deepEqual(fs.readFileSync(file), external);
  const refresh = await service.prepareRefresh(state);
  const imported = service.commitRefresh(refresh, {currentState: state, saveState: saved});
  const prep = await service.prepareSave(imported, changed(imported));
  await edit(file, sheet => sheet.getCell('C2').value = 8);
  assert.throws(() => service.commitPrepared(prep, {currentState: imported, nextState: changed(imported), saveState: saved}), /外部更改/);
  await edit(file, sheet => sheet.getCell('C2').value = {formula: '1+1', result: 2});
  await assert.rejects(service.prepareSave(imported, changed(imported)), /不能使用公式/);
});

test('opening changed or invalid workbook reports it without importing or accepting an overwrite', async t => {
  const {service, file} = setup(t), state = classroom(), original = structuredClone(state);
  await service.open(state);
  await edit(file, sheet => sheet.getCell('B2').value = '外部编辑');
  assert.equal((await service.open(state)).externalChanged, true);
  assert.deepEqual(state, original);
  await edit(file, sheet => sheet.getCell('C2').value = {error: '#DIV/0!'});
  const result = await service.open(state);
  assert.equal(result.externalChanged, true); assert.match(result.warning, /Excel 错误/);
  assert.deepEqual(state, original);
});

test('refresh is a preview, imports all panels by IDs, and leaves every historical object unchanged', async t => {
  const {service, file} = setup(t), state = classroom(), original = structuredClone(state);
  await service.open(state);
  await edit(file, sheet => {sheet.getCell('B2').value = '一班外部修改'; sheet.getCell('C4').value = 9;});
  const prepared = await service.prepareRefresh(state);
  assert.equal(prepared.panelCount, 2); assert.equal(prepared.ruleCount, 3);
  assert.deepEqual(state, original);
  const current = structuredClone(state); current.students[0].score = 14; current.revision++;
  const next = service.commitRefresh(prepared, {currentState: current, saveState: saved});
  assert.equal(next.settings.scoreRules[0].label, '一班外部修改');
  assert.equal(next.panels.others[0].data.settings.scoreRules[2].delta, 9);
  assert.deepEqual(next.panels.others[0].data.settings.scoreRules,next.settings.scoreRules);
  assert.equal(next.students[0].score, 14); assert.deepEqual(next.logs, current.logs);
  assert.deepEqual(next.panels.others[0].data.logs, state.panels.others[0].data.logs);
  assert.deepEqual(next.petLogs, state.petLogs); assert.equal(next.revision, current.revision + 1);
});

test('refresh rejects unknown/missing panels, duplicate IDs, partial rows, extra data, and invalid deltas', async t => {
  const {service, file} = setup(t), state = classroom();
  await service.open(state); const baseline = fs.readFileSync(file);
  const variants = [
    [(_sheet, book) => book.getWorksheet('面板设置').getCell('A2').value = 'unknown_panel', /面板ID不存在/],
    [(_sheet, book) => book.getWorksheet('面板设置').spliceRows(3, 1), /须包含每个现有面板/],
    [sheet => sheet.getCell('A3').value = 'rule_a', /重复/],
    [sheet => sheet.getCell('A2').value = '', /编号无效/],
    [sheet => sheet.getCell('B2').value = '', /1–120/],
    [sheet => sheet.getCell('C2').value = 0, /非零整数/],
    [sheet => sheet.getCell('C2').value = 101, /非零整数/],
    [sheet => sheet.getCell('D2').value = -101, /可填0/],
    [sheet => sheet.getCell('C2').value = '1e1', /非零整数/],
    [sheet => sheet.getCell('E2').value = 'not ignored', /表头之外/],
    [sheet => sheet.getCell('E1').value = '未知列', /未知表头/],
    [sheet => sheet.getCell('B1').value = '规则ID', /规则ID/],
    [(_sheet, book) => book.addWorksheet('隐藏的数据').getCell('A1').value = 'must reject', /无法应用的数据/]
  ];
  for (const [modify, message] of variants) {
    fs.writeFileSync(file, baseline); await edit(file, modify);
    await assert.rejects(service.prepareRefresh(state), message);
  }
});

test('rows and columns can be reordered without crossing panels; hidden rows are not dropped', async t => {
  const {service, file} = setup(t), state = classroom(); await service.open(state);
  await edit(file, sheet => {
    const first = sheet.getRow(2).values, last = sheet.getRow(4).values;
    sheet.getRow(2).values = last; sheet.getRow(4).values = first; sheet.getRow(3).hidden = true;
    for (let r = 1; r <= 4; r++) {const row = sheet.getRow(r), a = row.getCell(1).value, b = row.getCell(2).value; row.getCell(1).value = b; row.getCell(2).value = a;}
  });
  const prepared = await service.prepareRefresh(state);
  const next = service.commitRefresh(prepared, {currentState: state, saveState: saved});
  assert.equal(next.settings.scoreRules.length, 3);
  assert.equal(next.panels.others[0].data.settings.scoreRules[0].label, '同编号不同规则');
});

test('failed JSON save rolls back workbook and leaves authoritative input and histories unchanged', async t => {
  const {service, file} = setup(t), state = classroom(), next = changed(state), original = structuredClone(state);
  await service.open(state); const baseline = fs.readFileSync(file);
  const prepared = await service.prepareSave(state, next);
  assert.throws(() => service.commitPrepared(prepared, {currentState: state, nextState: next, saveState: () => {throw new Error('synthetic JSON failure');}}), /synthetic JSON failure/);
  assert.deepEqual(fs.readFileSync(file), baseline); assert.deepEqual(state, original);
  assert.equal(fs.existsSync(file + '.flower-pending.json'), false);
});

test('write and rename failures never call the JSON writer or modify prior workbook', async t => {
  let fail = false;
  const fileSystem = new Proxy(fs, {get(target, key) {
    if (key === 'renameSync') return (...args) => {
      if (fail && args[1].endsWith(FILE_NAME)) {const error = new Error('synthetic locked workbook'); error.code = 'EBUSY'; throw error;}
      return target.renameSync(...args);
    };
    return target[key];
  }});
  const {service, file} = setup(t, {fileSystem}), state = classroom(), next = changed(state);
  await service.open(state); const baseline = fs.readFileSync(file);
  const prepared = await service.prepareSave(state, next); fail = true;
  let called = false;
  assert.throws(() => service.commitPrepared(prepared, {currentState: state, nextState: next, saveState: () => {called = true;}}), /关闭可能占用/);
  assert.equal(called, false); assert.deepEqual(fs.readFileSync(file), baseline);
  assert.equal(fs.readdirSync(path.dirname(file)).some(name => name.endsWith('.tmp')), false);
});

test('rollback failure preserves receipt and next explicit access recovers the old valid workbook', async t => {
  let failRollback = false;
  const fileSystem = new Proxy(fs, {get(target, key) {
    if (key === 'renameSync') return (...args) => {if (failRollback && args[1].endsWith(FILE_NAME)) throw new Error('synthetic rollback failure'); return target.renameSync(...args);};
    return target[key];
  }});
  const {service, file, directory} = setup(t, {fileSystem}), state = classroom(), next = changed(state);
  await service.open(state); const baseline = fs.readFileSync(file);
  const prepared = await service.prepareSave(state, next);
  assert.throws(() => service.commitPrepared(prepared, {currentState: state, nextState: next, saveState: () => {failRollback = true; throw new Error('JSON failure');}}), /回滚也未完成/);
  assert.equal(fs.existsSync(file + '.flower-pending.json'), true);
  const restarted = createScoreRuleWorkbook({resourceDirectory: directory});
  assert.deepEqual(restarted.recover(state), {recovered: true, committed: false});
  assert.deepEqual(fs.readFileSync(file), baseline);
  assert.equal(fs.existsSync(file + '.flower-pending.json'), false);
});

test('restart after process interruption on either side of JSON commit chooses its last valid rules', async t => {
  for (const afterJson of [false, true]) {
    const {directory, service, file} = setup(t), state = classroom(), next = changed(state);
    await service.open(state); const baseline = fs.readFileSync(file);
    const json = path.join(directory, 'synthetic-state.json'); fs.writeFileSync(json, JSON.stringify(state));
    const script = `const fs=require('node:fs');const {createScoreRuleWorkbook}=require(${JSON.stringify(path.resolve(__dirname, '../src/score-rule-workbook.cjs'))});
      (async()=>{const current=JSON.parse(fs.readFileSync(${JSON.stringify(json)}));const next=${JSON.stringify(next)};
      const service=createScoreRuleWorkbook({resourceDirectory:${JSON.stringify(directory)}});
      const token=await service.prepareSave(current,next);service.commitPrepared(token,{currentState:current,nextState:next,saveState:value=>{${afterJson ? `fs.writeFileSync(${JSON.stringify(json)},JSON.stringify(value));` : ''}process.exit(23);}});})().catch(error=>{console.error(error);process.exit(1);});`;
    const child = spawnSync(process.execPath, ['-e', script], {encoding: 'utf8'});
    assert.equal(child.status, 23, child.stderr);
    assert.equal(fs.existsSync(file + '.flower-pending.json'), true);
    const durable = JSON.parse(fs.readFileSync(json));
    const restarted = createScoreRuleWorkbook({resourceDirectory: directory});
    assert.deepEqual(restarted.recover(durable), {recovered: true, committed: afterJson});
    if (!afterJson) assert.deepEqual(fs.readFileSync(file), baseline);
    else assert.deepEqual((await parseBytes(fs.readFileSync(file), durable))[0].rules, next.settings.scoreRules);
  }
});

test('recovery will not overwrite an externally edited file after an interrupted transaction', async t => {
  let rejectRollback = false;
  const fileSystem = new Proxy(fs, {get(target, key) {if (key === 'renameSync') return (...args) => {if (rejectRollback && args[1].endsWith(FILE_NAME)) throw new Error('rollback blocked'); return target.renameSync(...args);}; return target[key];}});
  const {service, directory, file} = setup(t, {fileSystem}), state = classroom(), next = changed(state);
  await service.open(state); const prepared = await service.prepareSave(state, next);
  assert.throws(() => service.commitPrepared(prepared, {currentState: state, nextState: next, saveState: () => {rejectRollback = true; throw new Error('JSON rejected');}}));
  await edit(file, sheet => sheet.getCell('B2').value = '外部另存的修改'); const external = fs.readFileSync(file);
  const restarted = createScoreRuleWorkbook({resourceDirectory: directory});
  assert.throws(() => restarted.recover(state), /尚未完成/);
  assert.deepEqual(fs.readFileSync(file), external);
  assert.equal(fs.existsSync(file + '.flower-pending.json'), true);
});

test('restart accepts unchanged external file and rejects edited external file before UI save', async t => {
  const {directory, service, file} = setup(t), state = classroom(); await service.open(state);
  const restarted = createScoreRuleWorkbook({resourceDirectory: directory});
  await restarted.prepareSave(state, changed(state));
  await edit(file, sheet => sheet.getCell('B2').value = '重启前的Excel修改');
  const restartedAgain = createScoreRuleWorkbook({resourceDirectory: directory});
  await assert.rejects(restartedAgain.prepareSave(state, changed(state)), /外部更改/);
});

test('confirmed rebuild preserves previous file and supports changed panel structure', async t => {
  const {service, file} = setup(t), state = classroom(); await service.open(state);
  await edit(file, sheet => sheet.getCell('B2').value = '需要留存的外部编辑'); const external = fs.readFileSync(file);
  const current = structuredClone(state); current.panels.others[0].id = 'panel_new';
  const info = service.info();
  await assert.rejects(service.prepareExport(current, {expectedHash: 'old'}), /外部更改/);
  const prepared = await service.prepareExport(current, {expectedHash: info.hash});
  assert.equal(fs.existsSync(prepared.backupPath), false);
  const next = service.commitExport(prepared, {currentState: current, saveState: saved});
  assert.equal(next.revision, current.revision + 1);
  assert.deepEqual(fs.readFileSync(prepared.backupPath), external);
  assert.equal((await parseBytes(fs.readFileSync(file), next))[1].id, 'panel_new');
});

test('changed rules/panel name invalidates preparation while normal scoring does not', async t => {
  const {service} = setup(t), state = classroom(); await service.open(state);
  for (const mutate of [state => {state.settings.className = '改名';}, state => {const rules=Rules.list(state);rules[1].delta=-4;Rules.setShared(state,rules);}]) {
    const prep = await service.prepareSave(state, changed(state));
    const current = structuredClone(state); mutate(current);
    assert.throws(() => service.commitPrepared(prep, {currentState: current, nextState: changed(current), saveState: saved}), /已变化/);
  }
});

test('lock/epoch guard rejects after async preparation before any durable write', async t => {
  const {service, file} = setup(t), state = classroom(), next = changed(state);
  await service.open(state); const baseline = fs.readFileSync(file);
  const token = await service.prepareSave(state, next);
  assert.throws(() => service.commitPrepared(token, {currentState: state, nextState: next, saveState: saved, beforeCommit: () => {throw new Error('classroom locked');}}), /classroom locked/);
  assert.deepEqual(fs.readFileSync(file), baseline);
});

test('refresh failure and stale preview keep state and external file unchanged', async t => {
  const {service, file} = setup(t), state = classroom(); await service.open(state);
  await edit(file, sheet => sheet.getCell('B2').value = '待应用'); const bytes = fs.readFileSync(file);
  const prepared = await service.prepareRefresh(state);
  assert.throws(() => service.commitRefresh(prepared, {currentState: state, saveState: () => {throw new Error('state writer unavailable');}}), /unavailable/);
  assert.equal(state.settings.scoreRules[0].label, '认真听讲'); assert.deepEqual(fs.readFileSync(file), bytes);
  const second = await service.prepareRefresh(state);
  await edit(file, sheet => sheet.getCell('B2').value = '预览后更改');
  assert.throws(() => service.commitRefresh(second, {currentState: state, saveState: saved}), /外部更改/);
});

test('configuration fingerprint is independent of active-panel position but preserves rule order', () => {
  const state = classroom(), other = state.panels.others[0];
  const {panels: ignored, ...prior} = structuredClone(state);
  const switched = {...other.data, sharedScoreRules:structuredClone(state.sharedScoreRules), panels: {activeId: other.id, others: [{id: state.panels.activeId, data: prior}]}};
  assert.equal(signature(switched), signature(state));
  Rules.setShared(switched,Rules.list(switched).reverse());
  assert.notEqual(signature(switched), signature(state));
});

test('signed growth and zero round-trip distinctly from blank and upgrade every shared mirror', async t => {
  const {service, file} = setup(t), state = classroom();
  state.version = 1; state.panels.others[0].data.version = 1;
  await service.open(state);
  await edit(file, sheet => {sheet.getCell('D2').value = -4; sheet.getCell('D3').value = 0;});
  const preview = await service.prepareRefresh(state);
  const next = service.commitRefresh(preview, {currentState: state, saveState: saved});
  assert.equal(next.version, 2); assert.equal(next.panels.others[0].data.version, 2);
  assert.equal(next.settings.scoreRules[0].growthDelta, -4);
  assert.equal(next.settings.scoreRules[1].growthDelta, 0);
  assert.equal(Object.hasOwn(next.panels.others[0].data.settings.scoreRules[2], 'growthDelta'), false);
  const roundTrip = await parseBytes(await buildBytes(next), next);
  assert.equal(roundTrip[0].rules[0].growthDelta, -4); assert.equal(roundTrip[0].rules[1].growthDelta, 0);
  assert.equal(Object.hasOwn(roundTrip[1].rules[2], 'growthDelta'), false);
  await edit(file, sheet => {sheet.getCell('D2').value = ''; sheet.getCell('D3').value = ''; sheet.getCell('D4').value = 8;});
  const second = await service.prepareRefresh(state);
  const upgradedOther = service.commitRefresh(second, {currentState: state, saveState: saved});
  assert.equal(upgradedOther.version, 2); assert.equal(upgradedOther.panels.others[0].data.version, 2);
});

test('post-commit receipt cleanup failure returns saved state and remains recoverable', async t => {
  let failCleanup = false;
  const fileSystem = new Proxy(fs, {get(target, key) {
    if (key === 'unlinkSync') return file => {if (failCleanup && file.endsWith('.flower-pending.json')) throw new Error('cleanup blocked'); return target.unlinkSync(file);};
    return target[key];
  }});
  const {service, directory, file} = setup(t, {fileSystem}), state = classroom(), next = changed(state);
  await service.open(state); const preview = await service.prepareSave(state, next);
  const result = service.commitPrepared(preview, {currentState: state, nextState: next, saveState: value => {failCleanup = true; return value;}});
  assert.equal(result, next); assert.match(service.warning, /规则已保存/);
  assert.equal(fs.existsSync(file + '.flower-pending.json'), true);
  const restarted = createScoreRuleWorkbook({resourceDirectory: directory});
  assert.deepEqual(restarted.recover(next), {recovered: true, committed: true});
});

test('a returning but invalid save callback never rolls Excel back across possibly committed JSON', async t => {
  const {service, directory, file} = setup(t), state = classroom(), next = changed(state);
  await service.open(state); const preview = await service.prepareSave(state, next);
  assert.throws(() => service.commitPrepared(preview, {currentState: state, nextState: next, saveState: () => undefined}), /无法确认的结果/);
  assert.equal(fs.existsSync(file + '.flower-pending.json'), true);
  const restarted = createScoreRuleWorkbook({resourceDirectory: directory});
  assert.deepEqual(restarted.recover(next), {recovered: true, committed: true});
});

test('unwritable program directory gets a useful error without fallback, mkdir, or permission changes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-score-unwritable-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const fileSystem = new Proxy(fs, {get(target, key) {
    if (key === 'openSync') return () => {const error = new Error('synthetic program directory is read-only'); error.code = 'EACCES'; throw error;};
    if (['mkdirSync', 'chmodSync'].includes(key)) return () => assert.fail('must not create fallback directories or change permissions');
    return target[key];
  }});
  const service = createScoreRuleWorkbook({resourceDirectory: directory, fileSystem});
  await assert.rejects(service.open(classroom()), /写入权限/);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('failed first save removes the newly created workbook and failed refresh never accepts external changes', async t => {
  const {service, file} = setup(t), state = classroom(), next = changed(state);
  const token = await service.prepareSave(state, next);
  assert.throws(() => service.commitPrepared(token, {currentState: state, nextState: next, saveState: () => {throw new Error('no space');}}), /no space/);
  assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(file + '.flower-pending.json'), false);
  await service.open(state); await edit(file, sheet => sheet.getCell('C2').value = 4);
  const refresh = await service.prepareRefresh(state);
  assert.throws(() => service.commitRefresh(refresh, {currentState: state, saveState: () => {throw new Error('no space');}}), /no space/);
  await assert.rejects(service.prepareSave(state, next), /外部更改/);
});

test('confirmed rebuild checks latest hash again and backup failure leaves both stores unchanged', async t => {
  let failBackup = false;
  const fileSystem = new Proxy(fs, {get(target, key) {
    if (key === 'renameSync') return (...args) => {if (failBackup && path.basename(args[1]).startsWith('配置-备份-')) throw new Error('backup write denied'); return target.renameSync(...args);};
    return target[key];
  }});
  const {service, file} = setup(t, {fileSystem}), state = classroom(); await service.open(state);
  const first = await service.prepareExport(state, {expectedHash: service.info().hash});
  await edit(file, sheet => sheet.getCell('B2').value = '确认期间更改');
  assert.throws(() => service.commitExport(first, {currentState: state, saveState: saved}), /外部更改/);
  const baseline = fs.readFileSync(file);
  const second = await service.prepareExport(state, {expectedHash: service.info().hash}); failBackup = true;
  let called = false;
  assert.throws(() => service.commitExport(second, {currentState: state, saveState: () => {called = true;}}), /backup write denied/);
  assert.equal(called, false); assert.deepEqual(fs.readFileSync(file), baseline);
});

test('preparation tokens expire and invalidate without changing files', async t => {
  let time = 1000;
  const {service, file} = setup(t, {now: () => time}), state = classroom(), next = changed(state);
  await service.open(state); const baseline = fs.readFileSync(file);
  const stale = await service.prepareSave(state, next); time += 16 * 60 * 1000;
  assert.throws(() => service.commitPrepared(stale, {currentState: state, nextState: next, saveState: saved}), /过期/);
  const cancelled = await service.prepareSave(state, next); service.invalidate();
  assert.throws(() => service.commitPrepared(cancelled, {currentState: state, nextState: next, saveState: saved}), /过期/);
  assert.deepEqual(fs.readFileSync(file), baseline);
});

test('real core validation accepts custom growth imported into a legacy classroom', async t => {
  const Core = require('../src/core.cjs');
  const state = Core.createInitialState();
  state.version = 1;
  const {service, file} = setup(t);
  await service.open(state);
  await edit(file, sheet => {sheet.getCell('D2').value = -3; sheet.getCell('D3').value = 0;});
  const preview = await service.prepareRefresh(state);
  const result = service.commitRefresh(preview, {currentState: state, saveState: Core.validateState});
  assert.equal(result.version, 2);
  assert.equal(result.settings.scoreRules[0].growthDelta, -3);
  assert.equal(result.settings.scoreRules[1].growthDelta, 0);
  assert.deepEqual(result.students, state.students);
  assert.deepEqual(result.logs, state.logs);
});

test('renamed classroom after restart uses stable panel IDs and refreshes display names on save', async t => {
  const {directory, service, file} = setup(t), state = classroom();
  await service.open(state);
  const renamed = structuredClone(state);
  renamed.settings.className = '一年级新班名';
  renamed.panels.others[0].data.settings.className = '二年级新班名';
  renamed.revision++;
  const restarted = createScoreRuleWorkbook({resourceDirectory: directory});
  const opened = await restarted.open(renamed);
  assert.equal(opened.externalChanged, true); assert.match(opened.warning, /不同|当前课堂/);
  const preview = await restarted.prepareRefresh(renamed);
  assert.ok(preview.configSummary.some(group => group.sheet === '面板设置' && group.changes.some(change => change.key === 'name')));
  const refreshed = restarted.commitRefresh(preview, {currentState: renamed, saveState: saved});
  assert.equal(refreshed.settings.className, '一班');
  assert.equal(refreshed.panels.others[0].data.settings.className, '二班');
  assert.deepEqual(refreshed.settings.scoreRules, state.settings.scoreRules);
  assert.deepEqual(refreshed.panels.others[0].data.settings.scoreRules, state.panels.others[0].data.settings.scoreRules);
  const freshProcess = createScoreRuleWorkbook({resourceDirectory: directory});
  const next = changed(refreshed), prepared = await freshProcess.prepareSave(refreshed, next);
  freshProcess.commitPrepared(prepared, {currentState: refreshed, nextState: next, saveState: saved});
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(file);
  assert.equal(book.getWorksheet('面板设置').getCell('B2').value, '一班');
  assert.equal(book.getWorksheet('面板设置').getCell('B3').value, '二班');
});

test('renamed display names never hide real external rule changes or unknown/missing panel IDs', async t => {
  const {directory, service, file} = setup(t), state = classroom(); await service.open(state);
  const renamed = structuredClone(state); renamed.settings.className = '新班名';
  await edit(file, (sheet,book) => {sheet.getCell('B2').value = '真正的外部规则修改'; book.getWorksheet('面板设置').getCell('B2').value = '另一个显示名称';});
  const restarted = createScoreRuleWorkbook({resourceDirectory: directory});
  await assert.rejects(restarted.prepareSave(renamed, changed(renamed)), /外部更改/);
  const preview = await restarted.prepareRefresh(renamed);
  const imported = restarted.commitRefresh(preview, {currentState: renamed, saveState: saved});
  assert.equal(imported.settings.scoreRules[0].label, '真正的外部规则修改');
  assert.equal(imported.settings.className, '另一个显示名称');
  await edit(file, (_sheet,book) => book.getWorksheet('面板设置').getCell('A2').value = 'missing_panel');
  await assert.rejects(restarted.prepareRefresh(imported), /面板ID不存在/);
});
