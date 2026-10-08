'use strict';
const {ensureToolControl,visibleControl,nativeClick}=require('./qa-tool-control.cjs');
// Native IPC/storage/restart QA. All files are synthetic and scoped to this script's fixture directory.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), suffix=process.env.FLOWER_PACKAGE_MAIN?'-packaged':'', out = path.join(root, 'artifacts/qa-classroom-tools-native'+suffix), dir = path.join(root, '.qa-classroom-tools-native'+suffix);
const crypto=require('node:crypto');
const hashes=()=>Object.fromEntries(fs.readdirSync(path.join(root,'src')).sort().map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src',n))).digest('hex')]));
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8);
fs.mkdirSync(out, { recursive: true });
if (!process.versions.electron) {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'classroom.json'), require('../tests/pet-fixtures.cjs').legacyJSON());
  const phases = [], before=hashes();
  for (const name of ['flows', 'restart']) {
    const run = require('node:child_process').spawnSync(require('electron'), ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu', __filename, '--phase=' + name], {
      cwd: root, encoding: 'utf8', timeout: 90000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, FLOWER_HEADLESS_TEST: '1', FLOWER_DATA_DIR: dir, XDG_CACHE_HOME: '/tmp/flower-classroom-tools-cache' }
    });
    fs.writeFileSync(path.join(out, name + '.log'), (run.stdout || '') + (run.stderr || ''));
    console.log((run.stdout || '').split('\n').filter(line => /^(PASS|FAIL|RESULT)/.test(line)).join('\n'));
    phases.push({ phase: name, exitCode: run.status, signal: run.signal, error: run.error?.message, report:fs.existsSync(path.join(out,name+'.json'))?JSON.parse(fs.readFileSync(path.join(out,name+'.json'))):null });
    if (run.status !== 0 || run.error) { console.error(run.error?.message || run.stderr); break; }
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ createdAt:new Date().toISOString(), syntheticOnly: true, scope: 'Real Electron main/preload/renderer, native file storage and fresh-process restart', sourceAtStart:before,sourceAtFinish:hashes(),sourceChanged:JSON.stringify(before)!==JSON.stringify(hashes()),results:phases }, null, 2));
  process.exitCode = phases.length === 2 && phases.every(p => p.exitCode === 0) ? 0 : 1;
} else {
  const { app, BrowserWindow, dialog } = require('electron'); app.disableHardwareAcceleration();
  const T = require('../src/classroom-tools.js');
  const checks = [], rendererErrors = [], requests = [];
  let main, panel;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = (code, window = main) => window.webContents.executeJavaScript(code, true);
  const state = () => js('classroom.get().then(value=>value.state)');
  const act = (a, window = main) => js(`classroom.action(${JSON.stringify(a)})`, window);
  const toolAct = async (type, fields = {}, window = main) => act({ type, ...T.expectation(await state()), ...fields }, window);
  const click = async (selector, window = main) => {selector=await ensureToolControl(window,selector);return js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Absent/disabled '+${JSON.stringify(selector)});e.click();})()`, window);};
  async function until(fn, label) { for (let i = 0; i < 140; i++) { if (await fn()) return; await sleep(25); } throw Error('Timed out: ' + label); }
  async function close(window = main) { await js('document.querySelector("#modal [data-do=modal-close]")?.click()', window); }
  async function open(kind, window = main) {
    await close(window);
    if (['main','panel'].includes(window.flowerRole)) { await click('[data-do=cw-toolbox]',window); await click('[data-do=ct-' + kind + ']',window); }
    else await js(`handleDo('ct-${kind}',{dataset:{}})`, window);
    await until(() => js('!!document.querySelector(".ct-root")', window), 'tool open ' + kind);
  }
  async function shot(name) { await sleep(140); const image = await main.webContents.capturePage(); assert.ok(image.getSize().width > 1, 'Screenshot must contain real pixels'); fs.writeFileSync(path.join(out, name + '.png'), image.toPNG()); }
  async function check(name, fn) {
    try { await fn(); checks.push({ name, status: 'passed' }); console.log('PASS_CT_NATIVE', name); }
    catch (error) { checks.push({ name, status: 'failed', error: error.stack }); console.log('FAIL_CT_NATIVE', name, error.message); try { await shot('failure-' + checks.length); } catch {} }
  }
  const mainEntry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs'));
  require('./package-boundary.cjs')(mainEntry,path.join(out,'dependency-boundary-'+phase+'.json'));require(mainEntry);
  const appRequire=require('node:module').createRequire(mainEntry),configuration=appRequire('./configuration-model.js'),rules=appRequire('./score-rules.js'),workbook=appRequire('./score-rule-workbook.cjs'),{assertRestoredState,verifyRestoredWorkbook}=require('./qa-restore-fixture.cjs');
  app.whenReady().then(async () => {
    await until(async () => {
      main = BrowserWindow.getAllWindows().find(w => w.flowerRole === 'main');
      return main && !main.webContents.isLoading() && await js('typeof ClassroomToolsUI!=="undefined"&&!!document.querySelector("[data-do=panel-toggle]")');
    }, 'main bootstrap');
    main.webContents.on('console-message', (_event, detail) => { if (detail.level === 'error') rendererErrors.push(detail.message); });
    main.webContents.session.webRequest.onBeforeRequest((details, callback) => { if (/^https?:/.test(details.url)) requests.push(details.url); callback({ cancel: false }); });
    if (phase === 'restart') {
      await check('Fresh process restores full multi-panel activity state and untouched legacy data', async () => {
        assert.deepEqual(await state(), JSON.parse(fs.readFileSync(path.join(out, 'expected-restart.json'), 'utf8')));
        assert.equal(fs.readFileSync(path.join(dir, 'classroom.json'), 'utf8'), require('../tests/pet-fixtures.cjs').legacyJSON());
        await open('vote'); assert.equal(await js('document.querySelectorAll(".ct-vote-card").length'), 3);
        await open('attendance'); assert.equal(await js('document.querySelectorAll(".ct-present").length'), 1);
      });
    } else {
      const baseline = await state(), ids = baseline.students.map(s => s.id);
      await check('Existing legacy points, photos and history remain exact after first vote migration', async () => {
        assert.equal(baseline.classroomTools, undefined);
        await open('vote');
        await click('[data-do=ct-candidate][data-id="' + ids[0] + '"]');
        assert.equal(await js('document.querySelector("#ct-vote-form [type=submit]").disabled'), true, 'one candidate cannot submit');
        await click('[data-do=ct-candidate][data-id="' + ids[1] + '"]');
        assert.equal(await js('document.querySelector("#ct-vote-form [type=submit]").disabled'), false, 'two candidates may submit');
        await click('[data-do=ct-candidate][data-id="' + ids[2] + '"]');
        await click('[data-do=ct-candidate][data-id="' + ids[3] + '"]');
        assert.equal(await js('document.querySelectorAll(".ct-selected").length'), 4);
        assert.equal(await js('document.querySelector("#ct-vote-form [type=submit]").disabled'), false, 'four candidates may submit');
        await click('[data-do=ct-candidate][data-id="' + ids[3] + '"]');
        assert.equal(await js('document.querySelectorAll(".ct-selected").length'), 3);
        await js('document.querySelector("#ct-vote-form").requestSubmit()');
        await until(async () => (await state()).classroomTools?.vote?.candidates.length === 3, 'vote persisted');
        await until(() => js('document.querySelectorAll(".ct-vote-card").length===3'), 'saved vote board');
        const saved = await state(); assert.equal(saved.version, 2); assert.deepEqual(saved.students, baseline.students); assert.deepEqual(saved.logs, baseline.logs);
        assert.equal(fs.readFileSync(path.join(dir, 'classroom.json'), 'utf8'), require('../tests/pet-fixtures.cjs').legacyJSON());
        assert.ok(fs.existsSync(path.join(dir, 'classroom-v2.json')));
      });
      await check('Actual button double-click adds once and verified 1/6/0 renders second/first/third', async () => {
        await js(`(()=>{const e=document.querySelector('[data-do=ct-vote-plus][data-id="${ids[0]}"]');e.click();e.click();})()`);
        await until(async () => (await state()).classroomTools.vote.candidates[0].votes === 1, 'single vote');
        await until(() => js(`!document.querySelector('[data-do=ct-vote-minus][data-id="${ids[0]}"]').disabled`), 'native minus enabled');
        await click('[data-do=ct-vote-minus][data-id="' + ids[0] + '"]');
        await until(async () => (await state()).classroomTools.vote.candidates[0].votes === 0, 'native minus saved zero');
        await until(() => js(`document.querySelector('[data-ct-count="${ids[0]}"]').textContent==='0票'`), 'native zero rendered');
        await click('[data-do=ct-vote-plus][data-id="' + ids[0] + '"]');
        await until(async () => (await state()).classroomTools.vote.candidates[0].votes === 1, 'native plus restored one');
        for (let i = 0; i < 6; i++) await toolAct('classroom.vote.adjust', { id: ids[1], delta: 1 });
        await until(() => js('document.querySelectorAll(".ct-rank")[1]?.textContent==="第一名"'), 'rank sync');
        assert.deepEqual(await js('[...document.querySelectorAll(".ct-vote-card")].map(e=>[e.querySelector(".ct-rank").textContent,e.querySelector(".ct-votes").textContent])'), [['第二名', '1票'], ['第一名', '6票'], ['第三名', '0票']]);
        await shot('01-native-vote-1-6-0');
      });
      await check('Native write failure leaves prior file and vote unchanged, then one retry persists', async () => {
        const before = await state(), filename = path.join(dir, 'classroom-v2.json'), bytes = fs.readFileSync(filename), tmp = filename + '.tmp';
        fs.mkdirSync(tmp);
        try {
          await click('[data-do=ct-vote-plus][data-id="' + ids[0] + '"]');
          await until(() => js('!document.querySelector(".ct-error").hidden'), 'save failure message');
          assert.deepEqual(await state(), before); assert.ok(fs.readFileSync(filename).equals(bytes));
        } finally { fs.rmdirSync(tmp); }
        await click('[data-do=ct-vote-plus][data-id="' + ids[0] + '"]');
        await until(async () => (await state()).classroomTools.vote.candidates[0].votes === 2, 'retry once');
      });
      await check('Real second window refreshes live counts and rejects stale requests and stale candidate lists', async () => {
        await js('classroom.window({command:"open",role:"panel"})');
        await until(async () => { panel = BrowserWindow.getAllWindows().find(w => w.flowerRole === 'panel'); return panel && !panel.webContents.isLoading() && await js('!!document.querySelector(".utility")', panel); }, 'second window');
        await open('vote', panel);
        const stale = { type: 'classroom.vote.adjust', ...T.expectation(await state()), id: ids[0], delta: 1 };
        await toolAct('classroom.vote.adjust', { id: ids[0], delta: 1 }, panel);
        await until(() => js(`document.querySelector('[data-ct-count="${ids[0]}"]').textContent==='3票'`), 'remote count');
        assert.match(await js(`classroom.action(${JSON.stringify(stale)}).then(()=>"accepted",e=>e.message)`), /另一窗口/);
        await click('[data-do=ct-reselect]');
        await toolAct('classroom.attendance.set', { id: ids[0], present: true }, panel);
        await until(() => js('document.querySelector("#ct-vote-form [type=submit]").disabled'), 'stale selection');
        assert.equal((await state()).classroomTools.vote.candidates[0].votes, 3);
      });
      await check('Attendance group marks and absent list sync across native windows', async () => {
        await open('attendance'); await open('attendance', panel);
        await click('[data-do=ct-attendance-toggle][data-id="' + ids[1] + '"]', panel);
        await until(() => js('document.querySelectorAll(".ct-present").length===2'), 'remote attendance');
        await click('[data-do=ct-absent]'); assert.equal(await js('document.querySelectorAll(".ct-absent-person").length'), 2);
        await toolAct('classroom.attendance.set', { id: ids[2], present: true }, panel);
        await until(() => js('document.querySelectorAll(".ct-absent-person").length===1'), 'remote absence');
        await shot('02-native-absent');
      });
      await check('Attendance reset cancellation and save failure retain marks; confirmed retry is backed up', async () => {
        await open('attendance'); await click('[data-do=ct-reset]'); const before = await state();
        await click('[data-do=ct-attendance-back]'); assert.deepEqual(await state(), before);
        await click('[data-do=ct-reset]'); const tmp = path.join(dir, 'classroom-v2.json.tmp'); fs.mkdirSync(tmp);
        try { await click('[data-do=ct-reset-confirm]'); await until(() => js('!document.querySelector(".ct-error").hidden'), 'reset failed'); assert.deepEqual(await state(), before); }
        finally { fs.rmdirSync(tmp); }
        await click('[data-do=ct-reset-confirm]'); await until(async () => (await state()).classroomTools.attendance.presentIds.length === 0, 'reset saved');
        assert.ok(fs.readdirSync((await js('classroom.file({command:"folder-info"})')).backup).some(name => name.startsWith('before-classroom-attendance.reset-')));
        await toolAct('classroom.attendance.set', { id: ids[0], present: true });
      });
      await check('Panel switch closes both tool windows, rejects old action and restores original activity', async () => {
        await open('vote'); await open('attendance', panel);
        const saved = await state(), oldPanel = T.panelId(saved), oldAction = { type: 'classroom.vote.adjust', ...T.expectation(saved), id: ids[0], delta: 1 };
        await act({ type: 'panel.create', mode: 'copy', name: '合成第二面板' });
        await until(() => js('!document.querySelector(".ct-root")'), 'main dismissed');
        await until(() => js('!document.querySelector(".ct-root")', panel), 'panel dismissed');
        assert.equal((await state()).classroomTools, undefined);
        assert.match(await js(`classroom.action(${JSON.stringify(oldAction)}).then(()=>"accepted",e=>e.message)`, panel), /面板/);
        await act({ type: 'panel.switch', id: oldPanel }); assert.deepEqual((await state()).classroomTools, saved.classroomTools);
      });
      await check('Native JSON backup and restore preserve activities, photos, ledgers and both panels', async () => {
        const saved = await state(), backup = path.join(out, 'synthetic-full-backup.json');
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: backup });
        await js('classroom.file({command:"backup"})'); assert.deepEqual(JSON.parse(fs.readFileSync(backup, 'utf8')), saved);
        await toolAct('classroom.vote.adjust', { id: ids[0], delta: 1 });const beforeRestore=await js('classroom.get()');
        await js(`classroom.file({command:'restore-apply',state:${JSON.stringify(saved)}})`);
        const restored = await state();assertRestoredState(restored,saved,beforeRestore.state,{configuration,rules});assert.equal((await js('classroom.get()')).restoreGeneration,beforeRestore.restoreGeneration+1);await verifyRestoredWorkbook(restored,r=>js('classroom.file('+JSON.stringify(r)+')'),workbook,configuration);assert.deepEqual(restored.classroomTools, saved.classroomTools);
        assert.deepEqual(restored.students, baseline.students); assert.deepEqual(restored.logs, baseline.logs);
        fs.writeFileSync(path.join(out, 'expected-restart.json'), JSON.stringify(restored));
      });
      await check('No renderer errors or external requests during native activity flows', async () => { assert.deepEqual(rendererErrors, []); assert.deepEqual(requests, []); });
    }
    fs.writeFileSync(path.join(out, phase + '.json'), JSON.stringify({ syntheticOnly: true, phase, checks, rendererErrors, requests }, null, 2));
    console.log('RESULT_CT_NATIVE', phase, checks.filter(c => c.status === 'passed').length + '/' + checks.length);
    app.exit(checks.some(c => c.status === 'failed') ? 1 : 0);
  }).catch(error => { console.error(error.stack); app.exit(2); });
}
