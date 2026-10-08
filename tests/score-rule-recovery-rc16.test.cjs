'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createScoreRuleWorkbook, buildBytes, parseBytes, signature, FILE_NAME, MAX_BYTES} = require('../src/score-rule-workbook.cjs');

const clone = value => structuredClone(value);
const saved = value => value;
const state = () => ({version: 2, revision: 4, settings: {className: '恢复测试班', scoreRules: [{id: 'rule_a', label: '原规则', delta: 2}]},
  panels: {activeId: 'panel_a', others: []}, students: [{id: 'student_a', score: 17}], logs: [{id: 'history_a', delta: 5}], petLogs: [{id: 'growth_a', delta: 3}]});
function nextRules(current) {const next = clone(current); next.settings.scoreRules[0].label = '保存后的规则'; next.revision++; return next;}
function ioError(message, code = 'EBUSY') {return Object.assign(new Error(message), {code});}
function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-rc16-recovery-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const backupDirectory = path.join(directory, '备份'); fs.mkdirSync(backupDirectory);
  const file = path.join(directory, FILE_NAME), receipt = file + '.flower-pending.json';
  const create = options => createScoreRuleWorkbook({resourceDirectory: directory, backupDirectory, ...overrides, ...options});
  return {directory, backupDirectory, file, receipt, create, service: create()};
}
async function pendingSave(f, original = state()) {
  let failCleanup = false;
  const fileSystem = new Proxy(fs, {get(target, key) {
    if (key === 'unlinkSync') return file => {if (failCleanup && file === f.receipt) throw ioError('receipt busy'); return fs.unlinkSync(file);};
    return target[key];
  }});
  const service = f.create({fileSystem});
  await service.open(original);
  const next = nextRules(original), preview = await service.prepareSave(original, next);
  const result = service.commitPrepared(preview, {currentState: original, nextState: next, saveState: value => {failCleanup = true; return value;}});
  assert.equal(result, next); assert.match(service.warning, /事务记录暂未清理/);
  return {original, next, service, release: () => {failCleanup = false;}, bytes: fs.readFileSync(f.file), receiptBytes: fs.readFileSync(f.receipt)};
}
function unchanged(f, bytes, receiptBytes) {
  assert.deepEqual(fs.existsSync(f.file) ? fs.readFileSync(f.file) : null, bytes);
  assert.deepEqual(fs.existsSync(f.receipt) ? fs.readFileSync(f.receipt) : null, receiptBytes);
}

test('oversize, nonfile and EIO workbook startup failures preserve valid JSON input and all original evidence', async t => {
  for (const type of ['oversize', 'nonfile', 'EIO']) {
    const f = fixture(t), current = state(), original = clone(current);
    if (type === 'nonfile') fs.mkdirSync(f.file);
    else fs.writeFileSync(f.file, type === 'oversize' ? Buffer.alloc(MAX_BYTES + 1, 65) : await buildBytes(current));
    const bytes = type === 'nonfile' ? null : fs.readFileSync(f.file);
    const fileSystem = new Proxy(fs, {get(target, key) {
      if (key === 'readFileSync') return (...args) => {if (type === 'EIO' && args[0] === f.file) throw ioError('synthetic read EIO', 'EIO'); return fs.readFileSync(...args);};
      return target[key];
    }});
    const service = f.create({fileSystem});
    await assert.rejects(service.bootstrap(current, {saveState: () => assert.fail('must not save valid JSON')}), /大小上限|EIO/);
    await assert.rejects(service.prepareExport(current), /大小上限|EIO/);
    assert.deepEqual(current, original); assert.equal(fs.existsSync(f.receipt), false);
    if (bytes) assert.deepEqual(fs.readFileSync(f.file), bytes); else assert.equal(fs.statSync(f.file).isDirectory(), true);
    assert.deepEqual(fs.readdirSync(f.backupDirectory), []);
  }
});

test('ordinary startup still handles missing, current and malformed workbooks without importing rules', async t => {
  for (const type of ['missing', 'current', 'malformed']) {
    const f = fixture(t), current = state(), original = clone(current);
    const prior = type === 'missing' ? null : type === 'current' ? await buildBytes(current) : Buffer.from('malformed workbook preserved');
    if (prior) fs.writeFileSync(f.file, prior);
    const result = await f.service.bootstrap(current, {saveState: saved});
    assert.deepEqual(result.state, original); assert.deepEqual(current, original);
    if (prior) assert.deepEqual(fs.readFileSync(f.file), prior);
    else assert.deepEqual((await parseBytes(fs.readFileSync(f.file), current))[0].rules, current.settings.scoreRules);
  }
});

test('completed version-1 receipt is reconciled before rename, panel structure change and backup restore', async t => {
  for (const change of ['rename', 'panel', 'restore']) {
    const f = fixture(t), pending = await pendingSave(f), next = clone(pending.next);
    if (change === 'rename') next.settings.className = '更名后';
    else if (change === 'panel') next.panels.activeId = 'restored_panel';
    else next.settings.scoreRules[0].delta = 9;
    pending.release();
    assert.deepEqual(pending.service.reconcileBeforeStateChange(pending.next, next, {force: change === 'restore'}), {recovered: true, committed: true});
    assert.equal(fs.existsSync(f.receipt), false);
    const restarted = await f.create().bootstrap(next, {saveState: () => assert.fail('existing workbook startup must not save')});
    assert.equal(restarted.state, next); assert.deepEqual(fs.readFileSync(f.file), pending.bytes);
  }
});

test('ongoing cleanup failure blocks configuration replacement but unrelated scoring performs no receipt or workbook I/O', async t => {
  const f = fixture(t), pending = await pendingSave(f), renamed = clone(pending.next); renamed.settings.className = '稍后更名';
  assert.throws(() => pending.service.reconcileBeforeStateChange(pending.next, renamed), /本次班级、面板或规则变更未保存/);
  unchanged(f, pending.bytes, pending.receiptBytes);
  const cannotRead = f.create({fileSystem: new Proxy(fs, {get(target, key) {
    if (['statSync', 'readFileSync'].includes(key)) return () => assert.fail('unrelated score must not depend on workbook');
    return target[key];
  }})});
  const scored = clone(pending.next); scored.students[0].score++; scored.logs.push({id: 'later_score'}); scored.revision++;
  assert.deepEqual(cannotRead.reconcileBeforeStateChange(pending.next, scored), {recovered: false});
  pending.release();
  assert.deepEqual(pending.service.reconcileBeforeStateChange(pending.next, renamed), {recovered: true, committed: true});
});

test('restore with unchanged rules still must settle receipt when explicitly forced', async t => {
  const f = fixture(t), pending = await pendingSave(f), restored = clone(pending.next); restored.students = [];
  assert.equal(signature(restored), signature(pending.next));
  assert.throws(() => pending.service.reconcileBeforeStateChange(pending.next, restored, {force: true}), /尚未清理/);
  unchanged(f, pending.bytes, pending.receiptBytes);
});

test('external workbook edits after a completed receipt block reconciliation and retain both files', async t => {
  const f = fixture(t), pending = await pendingSave(f), next = clone(pending.next); next.settings.className = '不应保存';
  const external = Buffer.from('new external edits'); fs.writeFileSync(f.file, external); pending.release();
  assert.throws(() => pending.service.reconcileBeforeStateChange(pending.next, next), /尚未完成/);
  unchanged(f, external, pending.receiptBytes);
});

test('explicit rebuild safely resolves stale RC15 receipts after rename or restore with exact dual backups', async t => {
  for (const change of ['rename', 'restore']) {
    const f = fixture(t), pending = await pendingSave(f), current = clone(pending.next);
    if (change === 'rename') current.settings.className = '旧版已更名';
    else current.settings.scoreRules = [{id: 'restored_rule', label: '备份恢复规则', delta: -3, growthDelta: 0}];
    assert.throws(() => f.service.recover(current), /尚未完成/);
    const original = clone(current), preview = await f.service.prepareExport(current);
    assert.equal(preview.recovery, true); assert.match(preview.warning, /当前已验证的课堂 JSON/);
    assert.equal(fs.existsSync(preview.backupPath), false); assert.equal(fs.existsSync(preview.receiptBackupPath), false);
    unchanged(f, pending.bytes, pending.receiptBytes); assert.deepEqual(current, original);
    const result = f.service.commitExport(preview, {currentState: current, saveState: saved});
    assert.deepEqual(fs.readFileSync(preview.backupPath), pending.bytes);
    assert.deepEqual(fs.readFileSync(preview.receiptBackupPath), pending.receiptBytes);
    assert.equal(fs.existsSync(f.receipt), false);
    assert.deepEqual(result, {...original, revision: original.revision + 1});
    assert.deepEqual((await parseBytes(fs.readFileSync(f.file), result))[0].rules, current.settings.scoreRules);
    assert.equal((await f.create().bootstrap(result, {saveState: saved})).state, result);
  }
});

test('malformed or missing workbook and malformed receipt can be explicitly rebuilt from validated current state', async t => {
  for (const workbook of [null, Buffer.from('malformed workbook')]) {
    const f = fixture(t), current = state(), oldReceipt = Buffer.from('{ damaged legacy receipt');
    if (workbook) fs.writeFileSync(f.file, workbook);
    fs.writeFileSync(f.receipt, oldReceipt);
    const preview = await f.service.prepareExport(current);
    unchanged(f, workbook, oldReceipt);
    const result = f.service.commitExport(preview, {currentState: current, saveState: saved});
    assert.deepEqual(fs.readFileSync(preview.receiptBackupPath), oldReceipt);
    if (workbook) assert.deepEqual(fs.readFileSync(preview.backupPath), workbook); else assert.equal(preview.backupPath, null);
    assert.equal(fs.existsSync(f.receipt), false);
    assert.deepEqual((await parseBytes(fs.readFileSync(f.file), result))[0].rules, current.settings.scoreRules);
  }
});

test('rebuild cancellation and workbook or receipt edits after preview make no further changes', async t => {
  for (const change of ['cancel', 'workbook', 'receipt', 'class']) {
    const f = fixture(t), pending = await pendingSave(f), current = clone(pending.next); current.settings.className = '已更名';
    const preview = await f.service.prepareExport(current);
    if (change === 'cancel') f.service.invalidate();
    if (change === 'workbook') fs.writeFileSync(f.file, 'later external workbook');
    if (change === 'receipt') fs.writeFileSync(f.receipt, 'later external receipt');
    if (change === 'class') current.settings.className = '再次更名';
    const bytes = fs.readFileSync(f.file), receiptBytes = fs.readFileSync(f.receipt);
    assert.throws(() => f.service.commitExport(preview, {currentState: current, saveState: () => assert.fail('stale preview must not save')}), /过期|外部更改|事务记录已变化|已变化/);
    unchanged(f, bytes, receiptBytes); assert.deepEqual(fs.readdirSync(f.backupDirectory), []);
  }
});

test('rebuild backup, receipt, workbook and JSON failures preserve the old workbook AND old receipt and allow retry', async t => {
  for (const point of ['workbook-backup', 'receipt-backup', 'receipt-write', 'workbook-write', 'json']) {
    const f = fixture(t), pending = await pendingSave(f), current = clone(pending.next); current.settings.className = '旧版已更名';
    let fail = true;
    const fileSystem = new Proxy(fs, {get(target, key) {
      if (key === 'renameSync') return (...args) => {
        const targetPath = args[1], base = path.basename(targetPath);
        if (fail && ((point === 'workbook-backup' && base.startsWith('计分卡片-备份-')) ||
          (point === 'receipt-backup' && base.startsWith('计分卡片-事务备份-')) ||
          (point === 'receipt-write' && targetPath === f.receipt) || (point === 'workbook-write' && targetPath === f.file))) throw ioError(`synthetic ${point}`, 'ENOSPC');
        return fs.renameSync(...args);
      };
      return target[key];
    }});
    const service = f.create({fileSystem}), preview = await service.prepareExport(current);
    let calls = 0;
    assert.throws(() => service.commitExport(preview, {currentState: current, saveState: value => {calls++; if (point === 'json') throw ioError('synthetic json', 'ENOSPC'); return value;}}), /synthetic/);
    assert.equal(calls, point === 'json' ? 1 : 0);
    unchanged(f, pending.bytes, pending.receiptBytes);
    assert.equal(fs.readdirSync(f.directory).some(name => name.endsWith('.tmp')), false);
    fail = false;
    const retry = await service.prepareExport(current);
    service.commitExport(retry, {currentState: current, saveState: saved});
    assert.equal(fs.existsSync(f.receipt), false);
  }
});

test('a rebuild cleanup failure returns success, keeps backed-up evidence, and settles before later rename', async t => {
  const f = fixture(t), pending = await pendingSave(f), current = clone(pending.next); current.settings.className = 'RC15已更名';
  const preview = await pending.service.prepareExport(current);
  const result = pending.service.commitExport(preview, {currentState: current, saveState: saved});
  assert.match(pending.service.warning, /规则已保存/);
  assert.equal(JSON.parse(fs.readFileSync(f.receipt)).version, 2);
  assert.deepEqual(fs.readFileSync(preview.receiptBackupPath), pending.receiptBytes);
  pending.release();
  const renamed = clone(result); renamed.settings.className = 'RC16更名';
  assert.deepEqual(pending.service.reconcileBeforeStateChange(result, renamed), {recovered: true, committed: true});
  assert.equal(fs.existsSync(f.receipt), false);
});

test('receipt edits during a save are retained and prevent unsafe rollback or cleanup', async t => {
  const f = fixture(t), current = state(); await f.service.open(current);
  const next = nextRules(current), preview = await f.service.prepareSave(current, next), externalReceipt = Buffer.from('receipt edited during JSON callback');
  const result = f.service.commitPrepared(preview, {currentState: current, nextState: next, saveState: value => {fs.writeFileSync(f.receipt, externalReceipt); return value;}});
  assert.equal(result, next); assert.deepEqual(fs.readFileSync(f.receipt), externalReceipt);
  assert.match(f.service.warning, /事务记录已变化/);
});

test('rebuild crash at each durable boundary recovers current rules or restores exact prior receipt', async t => {
  for (const point of ['before-receipt', 'after-receipt', 'before-json', 'after-json']) {
    const f = fixture(t), pending = await pendingSave(f), current = clone(pending.next); current.settings.className = '旧版已更名';
    const json = path.join(f.directory, 'synthetic-state.json'); fs.writeFileSync(json, JSON.stringify(current));
    const script = `const fs=require('node:fs');const {createScoreRuleWorkbook}=require(${JSON.stringify(path.resolve(__dirname, '../src/score-rule-workbook.cjs'))});
      const point=${JSON.stringify(point)}, receipt=${JSON.stringify(f.receipt)};
      const io=new Proxy(fs,{get(target,key){if(key==='renameSync')return(...args)=>{if(args[1]===receipt&&point==='before-receipt')process.exit(23);const r=fs.renameSync(...args);if(args[1]===receipt&&point==='after-receipt')process.exit(23);return r;};return target[key];}});
      (async()=>{const current=JSON.parse(fs.readFileSync(${JSON.stringify(json)}));const service=createScoreRuleWorkbook({resourceDirectory:${JSON.stringify(f.directory)},backupDirectory:${JSON.stringify(f.backupDirectory)},fileSystem:io});const preview=await service.prepareExport(current);service.commitExport(preview,{currentState:current,saveState:value=>{if(point==='after-json')fs.writeFileSync(${JSON.stringify(json)},JSON.stringify(value));process.exit(23);}});})().catch(error=>{console.error(error);process.exit(1);});`;
    const child = spawnSync(process.execPath, ['-e', script], {encoding: 'utf8'});
    assert.equal(child.status, 23, child.stderr);
    const durable = JSON.parse(fs.readFileSync(json)), restarted = f.create();
    assert.deepEqual(durable.students, current.students); assert.deepEqual(durable.logs, current.logs);
    if (point === 'before-receipt') {
      unchanged(f, pending.bytes, pending.receiptBytes);
      assert.throws(() => restarted.recover(durable), /尚未完成/);
    } else if (point === 'after-receipt') {
      assert.throws(() => restarted.recover(durable), /原表格和事务记录已恢复/);
      unchanged(f, pending.bytes, pending.receiptBytes);
    } else {
      assert.deepEqual(restarted.recover(durable), {recovered: true, committed: true});
      assert.equal(fs.existsSync(f.receipt), false);
      assert.deepEqual((await parseBytes(fs.readFileSync(f.file), durable))[0].rules, current.settings.scoreRules);
    }
    const receiptBackups = fs.readdirSync(f.backupDirectory).filter(name => name.startsWith('计分卡片-事务备份-'));
    assert.equal(receiptBackups.length, 1); assert.deepEqual(fs.readFileSync(path.join(f.backupDirectory, receiptBackups[0])), pending.receiptBytes);
  }
});

test('response loss after durable rebuild JSON never rolls back and consumed token cannot repeat the save', async t => {
  const f = fixture(t), pending = await pendingSave(f), current = clone(pending.next); current.settings.className = '旧版已更名';
  const preview = await f.service.prepareExport(current); let durable = current, calls = 0;
  assert.throws(() => f.service.commitExport(preview, {currentState: current, saveState: value => {calls++; durable = value; return undefined;}}), /无法确认的结果/);
  assert.equal(calls, 1); assert.equal(durable.revision, current.revision + 1);
  assert.throws(() => f.service.commitExport(preview, {currentState: durable, saveState: () => {calls++;}}), /过期/);
  assert.equal(calls, 1); assert.deepEqual(f.create().recover(durable), {recovered: true, committed: true});
  assert.deepEqual(fs.readFileSync(preview.receiptBackupPath), pending.receiptBytes);
});

test('a lost or edited receipt backup prevents recovery from erasing the remaining recovery evidence', async t => {
  for (const change of ['missing', 'edited']) {
    const f = fixture(t), pending = await pendingSave(f), current = clone(pending.next); current.settings.className = '旧版已更名';
    const preview = await pending.service.prepareExport(current);
    const result = pending.service.commitExport(preview, {currentState: current, saveState: saved});
    const bytes = fs.readFileSync(f.file), receiptBytes = fs.readFileSync(f.receipt);
    if (change === 'missing') fs.unlinkSync(preview.receiptBackupPath); else fs.writeFileSync(preview.receiptBackupPath, 'changed backup');
    assert.throws(() => f.create().recover(result), /备份缺失或已变化/);
    unchanged(f, bytes, receiptBytes);
  }
});

test('receipt read failures, nonfiles and oversize receipts block rebuild without disturbing either source', async t => {
  for (const type of ['EIO', 'nonfile', 'oversize']) {
    const f = fixture(t), current = state(), bytes = await buildBytes(current); fs.writeFileSync(f.file, bytes);
    if (type === 'nonfile') fs.mkdirSync(f.receipt);
    else fs.writeFileSync(f.receipt, type === 'oversize' ? Buffer.alloc(2 * MAX_BYTES + 32769, 65) : 'unreadable receipt');
    const priorReceipt = type === 'nonfile' ? null : fs.readFileSync(f.receipt);
    const service = f.create({fileSystem: new Proxy(fs, {get(target, key) {
      if (key === 'readFileSync') return (...args) => {if (type === 'EIO' && args[0] === f.receipt) throw ioError('receipt read EIO', 'EIO'); return fs.readFileSync(...args);};
      return target[key];
    }})});
    await assert.rejects(service.prepareExport(current), /EIO|大小上限/);
    assert.deepEqual(fs.readFileSync(f.file), bytes); assert.deepEqual(fs.readdirSync(f.backupDirectory), []);
    if (priorReceipt) assert.deepEqual(fs.readFileSync(f.receipt), priorReceipt); else assert.equal(fs.statSync(f.receipt).isDirectory(), true);
  }
});

test('receipt or workbook edit during asynchronous rebuild preparation invalidates the preview without any writes', async t => {
  for (const target of ['workbook', 'receipt']) {
    const f = fixture(t), current = state(); await f.service.open(current);
    fs.writeFileSync(f.receipt, 'stale receipt');
    const service = f.create({loadExcel: () => {fs.writeFileSync(target === 'workbook' ? f.file : f.receipt, 'new external edit during preview'); return require('exceljs');}});
    await assert.rejects(service.prepareExport(current), /外部更改|事务记录已变化/);
    assert.equal(fs.readFileSync(target === 'workbook' ? f.file : f.receipt, 'utf8'), 'new external edit during preview');
    assert.deepEqual(fs.readdirSync(f.backupDirectory), []);
  }
});
