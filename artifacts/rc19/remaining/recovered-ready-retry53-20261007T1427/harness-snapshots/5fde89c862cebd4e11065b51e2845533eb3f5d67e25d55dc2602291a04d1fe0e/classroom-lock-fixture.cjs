'use strict';
// Dedicated real-Electron QA. Uses only generated classroom data and test PINs.
// The fixture and temporary credentials are not end-user deliverables.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const electron = require('electron');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'artifacts', process.env.FLOWER_PACKAGE_MAIN?'qa-classroom-lock-packaged':'qa-classroom-lock');
fs.mkdirSync(out, { recursive: true });
if (typeof electron === 'string') {
  const { spawnSync } = require('node:child_process');
  const flags = process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [];
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-qa-lock-'));
  const combined = []; let log = '', failed = false;
  for (const phase of ['main', 'restart', 'corrupt']) {
    if (phase === 'corrupt') fs.writeFileSync(path.join(data, 'classroom-lock.json'), 'SYNTHETIC_CORRUPTION');
    const result = spawnSync(electron, [...flags, __filename], { cwd: root, env: { ...process.env, FLOWER_LOCK_QA_DIR: data, FLOWER_LOCK_QA_PHASE: phase }, encoding: 'utf8', timeout: 100000, maxBuffer: 1024 * 1024 * 8 });
    const phaseLog = (result.stdout || '') + (result.stderr || ''); log += phaseLog;
    console.log(phaseLog.split('\n').filter(line => /^(PASS_LOCK|FAIL_LOCK|QA_LOCK|FATAL_LOCK)/.test(line)).join('\n'));
    if (result.error) console.error(result.error.message);
    failed ||= result.status !== 0 || !!result.error;
    const summaryPath = path.join(out, 'results-' + phase + '.json');
    if (fs.existsSync(summaryPath)) combined.push(...JSON.parse(fs.readFileSync(summaryPath, 'utf8')).checks);
    if (failed) break;
  }
  fs.writeFileSync(path.join(out, 'electron.log'), log);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: combined.filter(check => check.status === 'passed').length, failed: combined.filter(check => check.status === 'failed').length, checks: combined, syntheticDataOnly: true, environment: 'Linux real Electron 44 main/preload/renderer across fresh app processes', windowsTouchscreenTested: false }, null, 2));
  fs.rmSync(data, { recursive: true, force: true }); process.exitCode = failed ? 1 : 0;
} else void run(electron);

async function run({ app, BrowserWindow, dialog, ipcMain }) {
  const { createInitialState } = require('../src/core.cjs');
  const { createClassroomLock, FILE_NAME } = require('../src/classroom-lock.cjs');
  const synthetic = createInitialState();
  synthetic.settings.className = '课堂密码遮罩 · 纯合成测试班';
  synthetic.students = synthetic.students.map((student, index) => ({ ...student, name: `合成同学${String(index + 1).padStart(2, '0')}`, group: '合成测试组' }));
  const data = process.env.FLOWER_LOCK_QA_DIR;
  const phase = process.env.FLOWER_LOCK_QA_PHASE || 'main';
  if (phase === 'main') fs.writeFileSync(path.join(data, 'classroom.json'), JSON.stringify(synthetic));
  process.env.FLOWER_HEADLESS_TEST = '1'; process.env.FLOWER_DATA_DIR = data;
  app.disableHardwareAcceleration();
  const PIN = '304987', NEW_PIN = '76032581';
  const checks = [], errors = []; let main, panel;
  let holdNextUnlock = false, releaseUnlockResponse;
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => originalHandle(channel, channel === 'lock:command' ? async (event, request) => {
    const result = await handler(event, request);
    if (holdNextUnlock && request.command === 'unlock') {
      holdNextUnlock = false;
      return new Promise(resolve => { releaseUnlockResponse = () => resolve(result); });
    }
    return result;
  } : handler);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = (source, window = main) => window.webContents.executeJavaScript(source, true);
  const until = async (fn, name) => { for (let count = 0; count < 180; count++) { if (await fn()) return; await sleep(30); } throw Error('Timed out: ' + name); };
  const click = (selector, window = main) => js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing lock control');el.click();return true;})()`, window);
  const fill = (id, value, window = main) => js(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`, window);
  const status = () => js("classroom.lock({command:'status'})");
  const lockMode = (window = main) => js("(()=>{const el=document.getElementById('classroom-lock-overlay');return el?.hidden?'':el?.dataset.mode;})()", window);
  const shot = async (name, window = main) => { await sleep(90); fs.writeFileSync(path.join(out, name + '.png'), (await window.webContents.capturePage()).toPNG()); };
  const keys = async text => { for (const digit of text) { main.webContents.sendInputEvent({ type: 'keyDown', keyCode: digit }); main.webContents.sendInputEvent({ type: 'keyUp', keyCode: digit }); } await sleep(30); };
  const enter = async () => { main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' }); main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' }); await sleep(20); };
  const unlock = async pin => { await fill('cl-pin', pin); await click('[data-lock-action="submit"]'); await until(async () => !(await status()).locked, 'unlocked'); await until(async () => await lockMode() === '', 'overlay released'); };
  const relock = async () => { await js("classroom.lock({command:'lock'})"); await until(async () => await lockMode() === 'locked', 'locked'); };
  app.on('web-contents-created', (_event, contents) => contents.on('console-message', (event, level, message) => { const severity = event.level ?? level; if (severity === 'error' || severity >= 3) errors.push(event.message ?? message); }));
  async function check(name, test) {
    try { const detail = await test(); checks.push({ name, status: 'passed', ...(detail ? { detail } : {}) }); console.log('PASS_LOCK', name); }
    catch (error) { checks.push({ name, status: 'failed', error: error.message }); console.error('FAIL_LOCK', name, error.message); try { await shot('failed-' + checks.length); } catch {} }
  }
  function finish() {
    const summary = { passed: checks.filter(check => check.status === 'passed').length, failed: checks.filter(check => check.status === 'failed').length, checks, syntheticDataOnly: true, environment: 'Linux real Electron 44 main/preload/renderer, headless display', windowsTouchscreenTested: false };
    fs.writeFileSync(path.join(out, 'results-' + phase + '.json'), JSON.stringify(summary, null, 2));
    console.log('QA_LOCK_COMPLETE', phase, summary.passed, 'passed', summary.failed, 'failed'); app.exit(summary.failed ? 1 : 0);
  }
  const mainEntry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs'));require('../scripts/package-boundary.cjs')(mainEntry,path.join(out,'dependency-boundary-'+phase+'.json'));require(mainEntry);
  await app.whenReady();
  try {
    await until(() => BrowserWindow.getAllWindows().some(window => window.flowerRole === 'main'), 'main window');
    main = BrowserWindow.getAllWindows().find(window => window.flowerRole === 'main');
    await until(() => js("typeof classroom.lock==='function'&&typeof ClassroomLockUI==='object'&&!!document.querySelector('.student-card')").catch(() => false), 'integrated lock UI');
    ipcMain.handle = originalHandle;
    main.setContentSize(1000, 800); await sleep(90);
    if (phase === 'restart') {
      await check('A completely new Electron process boots locked, rejects the old PIN and accepts the changed PIN', async () => {
        assert.equal((await status()).locked, true); assert.equal(await lockMode(), 'locked');
        assert.equal(await js("document.querySelector('#app').inert"), true);
        await shot('10-persisted-lock-after-new-process');
        await fill('cl-pin', PIN); await click('[data-lock-action="submit"]');
        await until(() => js("document.querySelector('.cl-message').textContent.includes('不正确')"), 'old PIN rejected after restart');
        assert.equal((await status()).locked, true); await unlock(NEW_PIN);
      });
      finish(); return;
    }
    if (phase === 'corrupt') {
      await check('Corrupt config in a fresh Electron process keeps every operation blocked with no setup bypass', async () => {
        assert.deepEqual(await status(), { configured: true, locked: true, blocked: true });
        assert.equal(await lockMode(), 'blocked'); await js('ClassroomLockUI.openSetup()');
        assert.equal(await lockMode(), 'blocked'); assert.equal(await js("document.querySelector('#app').inert"), true);
        const setup = await js(`classroom.lock({command:'setup',pin:${JSON.stringify(PIN)},repeat:${JSON.stringify(PIN)}})`);
        assert.equal(setup.ok, false); assert.equal(setup.blocked, true);
        await assert.rejects(js("classroom.file({command:'blank'})"), /锁定/);
        assert.equal(fs.readFileSync(path.join(data, FILE_NAME), 'utf8'), 'SYNTHETIC_CORRUPTION');
        await shot('11-corrupt-config-protection');
      });
      finish(); return;
    }
    await check('Real isolated Electron renderer starts unconfigured with no implicit PIN', async () => {
      assert.equal(await js('typeof require'), 'undefined');
      assert.equal((await status()).configured, false); assert.equal(await lockMode(), '');
      assert.equal(fs.existsSync(path.join(data, FILE_NAME)), false);
      assert.equal(await js("document.querySelector('#app').inert"), false);
    });
    await check('Setup can be canceled with Escape without persisting any credential', async () => {
      await js('ClassroomLockUI.openSetup()');
      assert.equal(await lockMode(), 'setup'); await shot('01-setup');
      await fill('cl-new-pin', PIN);
      main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
      main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      await until(async () => await lockMode() === '', 'setup canceled');
      assert.equal((await status()).configured, false);
      assert.equal(fs.existsSync(path.join(data, FILE_NAME)), false);
      assert.equal(await js("document.querySelector('#app').inert"), false);
    });
    await check('Mismatched confirmation stays in setup; matching setup locks once despite repeated click', async () => {
      await js('ClassroomLockUI.openSetup()'); await fill('cl-new-pin', PIN); await fill('cl-repeat-pin', NEW_PIN);
      await click('[data-lock-action="submit"]');
      assert.equal((await status()).configured, false);
      assert.ok(await js("document.querySelector('.cl-message').textContent.includes('不一致')"));
      await fill('cl-repeat-pin', PIN);
      const disabled = await js("(()=>{const button=document.querySelector('[data-lock-action=submit]');button.click();button.click();button.click();return [...document.querySelectorAll('#classroom-lock-overlay input,#classroom-lock-overlay button')].every(el=>el.disabled);})()");
      assert.equal(disabled, true, 'All entry controls disabled while request is pending');
      await until(async () => await lockMode() === 'locked', 'setup locked');
      assert.equal((await status()).locked, true);
      assert.equal(createClassroomLock(data).status().locked, true);
      await shot('02-locked');
    });
    await check('Wrong PIN typed on physical keyboard keeps the app protected and clears the field', async () => {
      await js("document.querySelector('#cl-pin').focus()"); await keys('1111'); await enter();
      await until(() => js("document.querySelector('.cl-message').textContent.includes('不正确')"), 'wrong PIN error');
      assert.equal((await status()).locked, true);
      assert.equal(await js("document.querySelector('#cl-pin').value.length"), 0);
      assert.equal(await js("document.querySelector('#app').inert"), true);
      await shot('03-wrong-pin');
    });
    await check('Full application render and late sibling controls cannot remove or escape the overlay', async () => {
      assert.equal(await js("(()=>{const overlay=document.getElementById('classroom-lock-overlay');render();const late=document.createElement('button');late.id='qa-late-control';late.textContent='合成后台操作';document.body.append(late);return overlay===document.getElementById('classroom-lock-overlay');})()"), true);
      await sleep(30);
      assert.equal(await js("document.getElementById('qa-late-control').inert"), true);
      await js("document.getElementById('qa-late-control').focus()");
      assert.equal(await js("document.getElementById('classroom-lock-overlay').contains(document.activeElement)"), true);
      main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); await sleep(20);
      assert.equal(await lockMode(), 'locked');
    });
    await check('Focus cycles within the dialog and the random keypad enters only masked digits', async () => {
      await js("document.querySelector('[data-lock-action=submit]').focus()");
      main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' }); await sleep(20);
      assert.equal(await js("document.activeElement.id==='cl-pin'"), true);
      main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['shift'] }); main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['shift'] }); await sleep(20);
      assert.equal(await js("document.activeElement.dataset.lockAction==='submit'"), true);
      for (const digit of PIN) await click(`[data-lock-digit="${digit}"]`);
      assert.equal(await js("document.querySelector('#cl-pin').type"), 'password');
      assert.equal(await js(`document.querySelector('.cl-card').textContent.includes(${JSON.stringify(PIN)})`), false);
      assert.equal(await js("document.querySelector('#cl-pin').value.length"), PIN.length);
      await shot('04-masked-keypad-entry');
      await click('[data-lock-action="submit"]');
      await until(async () => await lockMode() === '', 'keypad unlock');
      assert.equal((await status()).locked, false);
      assert.equal(await js("document.querySelector('#app').inert"), false);
      assert.equal(await js("document.getElementById('qa-late-control').inert"), false);
      await js("document.getElementById('qa-late-control').remove()");
      await shot('05-return-to-classroom');
    });
    await check('Re-lock changes digit positions and renderer reload reads the persisted lock', async () => {
      const previous = await js("[...document.querySelectorAll('[data-lock-digit]')].map(el=>el.dataset.lockDigit).join('')");
      await relock();
      const current = await js("[...document.querySelectorAll('[data-lock-digit]')].map(el=>el.dataset.lockDigit).join('')");
      assert.notEqual(current, previous);
      assert.equal([...current].sort().join(''), '0123456789');
      await shot('06-randomized-relock');
      main.webContents.reload();
      await until(() => js("document.querySelector('#classroom-lock-overlay')?.dataset.mode==='locked'&&document.querySelector('#app').inert").catch(() => false), 'persisted lock after reload');
      assert.equal((await status()).locked, true);
      await unlock(PIN);
    });
    await check('Canceling a password change preserves the old PIN; saving requires current PIN and matching repeat', async () => {
      await js('ClassroomLockUI.openChange()'); assert.equal(await lockMode(), 'change');
      await fill('cl-new-pin', NEW_PIN); await click('[data-lock-action="cancel"]');
      assert.equal(await lockMode(), '');
      await relock(); await unlock(PIN);
      await js('ClassroomLockUI.openChange()');
      await fill('cl-old-pin', '1111'); await fill('cl-new-pin', NEW_PIN); await fill('cl-repeat-pin', NEW_PIN);
      await click('[data-lock-action="submit"]');
      await until(() => js("document.querySelector('.cl-message').textContent.includes('不正确')"), 'wrong old password');
      assert.equal(await lockMode(), 'change');
      await fill('cl-old-pin', PIN); await fill('cl-new-pin', NEW_PIN); await fill('cl-repeat-pin', NEW_PIN);
      await click('[data-lock-action="submit"]');
      await until(async () => await lockMode() === '', 'password changed');
      await relock(); await fill('cl-pin', PIN); await click('[data-lock-action="submit"]');
      await until(() => js("document.querySelector('.cl-message').textContent.includes('不正确')"), 'old password rejected');
      await unlock(NEW_PIN);
    });
    await check('A 240px auxiliary window stays protected and directs unlocking to the existing main window', async () => {
      await js("classroom.window({command:'open',role:'panel'})");
      panel = BrowserWindow.getAllWindows().find(window => window.flowerRole === 'panel');
      await until(() => js("typeof ClassroomLockUI==='object'&&!!document.querySelector('#app')", panel).catch(() => false), 'panel ready');
      panel.setContentSize(240, 500); await relock();
      await until(async () => await lockMode(panel) === 'locked', 'panel covered');
      assert.equal(await js("document.querySelector('#app').inert", panel), true);
      assert.equal(await js("document.querySelector('#cl-pin')===null", panel), true);
      assert.equal(await js("document.documentElement.scrollWidth<=innerWidth", panel), true);
      await shot('07-locked-panel-240px', panel);
      await click('[data-lock-action="main"]', panel);
      assert.equal((await status()).locked, true);
      assert.equal(main.isVisible(), true);
      await unlock(NEW_PIN);
      await until(async () => await lockMode(panel) === '', 'panel released after main unlock');
      assert.equal(await js("document.querySelector('#app').inert", panel), false);
    });
    await check('All eight native window roles receive and retain the lock across broadcasts', async () => {
      for (const role of ['flower', 'sidebar', 'timer', 'draw', 'pet', 'pets']) await js(`classroom.window({command:'open',role:${JSON.stringify(role)}})`);
      for (const window of BrowserWindow.getAllWindows()) await until(() => js("typeof ClassroomLockUI==='object'&&!!document.getElementById('classroom-lock-overlay')", window).catch(() => false), 'all windows ready');
      const roles = BrowserWindow.getAllWindows().map(window => window.flowerRole);
      assert.equal(roles.length, 8); await relock();
      for (const window of BrowserWindow.getAllWindows()) {
        await until(async () => await lockMode(window) === 'locked', 'every window covered');
        assert.equal(await js("document.querySelector('#app').inert", window), true);
        const layout = await js("(()=>{const overlay=document.querySelector('#classroom-lock-overlay');return {role:new URLSearchParams(location.search).get('view'),viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,overlayWidth:overlay.clientWidth,overlayScrollWidth:overlay.scrollWidth};})()", window);
        assert.ok(layout.overlayScrollWidth <= layout.overlayWidth, 'No horizontal mask overflow: ' + JSON.stringify(layout));
      }
      const flower = BrowserWindow.getAllWindows().find(window => window.flowerRole === 'flower');
      await shot('08-tiny-flower-protection', flower);
      await unlock(NEW_PIN);
      for (const window of BrowserWindow.getAllWindows()) await until(async () => await lockMode(window) === '', 'every window released');
    });
    await check('Locked IPC refuses scoring, restores, backups, file operations and new tool windows without mutation', async () => {
      const before = await js('classroom.get().then(data=>data.state)'); await relock();
      const requests = [
        `classroom.action({type:'score',ids:[${JSON.stringify(before.students[0].id)}],delta:1})`,
        'classroom.action({type:"timer.set",seconds:55})',
        'classroom.file({command:"backup"})', 'classroom.file({command:"data-folder"})',
        'classroom.file({command:"photo"})', 'classroom.file({command:"template"})',
        'classroom.file({command:"blank"})', 'classroom.file({command:"archive"})',
        `classroom.file({command:'restore-apply',state:${JSON.stringify(before)}})`,
        'classroom.window({command:"open",role:"timer"})'
      ];
      for (const source of requests) await assert.rejects(js(source), /锁定/);
      assert.deepEqual(await js('classroom.get().then(data=>data.state)'), before);
      assert.equal(await js('classroom.window({command:"main"})'), true);
      assert.equal((await status()).locked, true); await unlock(NEW_PIN);
    });
    await check('A running timer reaches zero under the lock and every overlay remains in place', async () => {
      await js("classroom.action({type:'timer.set',seconds:1})");
      await js("classroom.action({type:'timer.start'})"); await relock();
      await until(async () => !(await js('classroom.get().then(data=>data.state.timer)')).running, 'timer finishes while locked');
      const timer = await js('classroom.get().then(data=>data.state.timer)'); assert.equal(timer.remainingMs, 0);
      for (const window of BrowserWindow.getAllWindows()) assert.equal(await lockMode(window), 'locked');
      await shot('09-locked-after-timer-completion'); await unlock(NEW_PIN);
    });
    await check('A save failure during real IPC unlock leaves disk, live state and all overlays locked', async () => {
      await relock(); const file = path.join(data, FILE_NAME), previous = fs.readFileSync(file, 'utf8'), originalRename = fs.renameSync;
      fs.renameSync = function (from, to) { if (to === file) throw Error('SYNTHETIC_LOCK_SAVE_FAILURE'); return originalRename.apply(this, arguments); };
      try {
        await fill('cl-pin', NEW_PIN); await click('[data-lock-action="submit"]');
        await until(() => js("document.querySelector('.cl-message').textContent.includes('未能保存')"), 'failed save message');
        assert.equal((await status()).locked, true);
        assert.ok(fs.readFileSync(file, 'utf8') === previous, 'Failed write preserves previous credential bytes');
        for (const window of BrowserWindow.getAllWindows()) assert.equal(await lockMode(window), 'locked');
      } finally { fs.renameSync = originalRename; }
      await unlock(NEW_PIN);
    });
    await check('An older unlock response cannot dismiss a newer lock broadcast from another window', async () => {
      await relock(); holdNextUnlock = true; releaseUnlockResponse = null;
      await fill('cl-pin', NEW_PIN); await click('[data-lock-action="submit"]');
      await until(() => !!releaseUnlockResponse, 'unlock response held');
      await js("classroom.lock({command:'lock'})", panel);
      await until(async () => await lockMode() === 'locked', 'newer lock broadcast');
      releaseUnlockResponse();
      await until(() => js("document.querySelector('.cl-card').getAttribute('aria-busy')!=='true'"), 'old response settled');
      assert.equal((await status()).locked, true); assert.equal(await lockMode(), 'locked');
      assert.equal(await js("document.querySelector('#app').inert"), true);
      await unlock(NEW_PIN);
    });
    await check('A pending backup is rejected after locking and a successful classroom backup excludes credentials', async () => {
      const originalSave = dialog.showSaveDialog, backupPath = path.join(data, 'synthetic-backup.json'); let release;
      try {
        dialog.showSaveDialog = () => new Promise(resolve => { release = resolve; });
        await js("window.qaPendingBackup=classroom.file({command:'backup'}).then(()=>false,()=>true);true");
        await until(() => !!release, 'backup dialog waiting'); await relock();
        release({ canceled: false, filePath: backupPath });
        assert.equal(await js('window.qaPendingBackup'), true); assert.equal(fs.existsSync(backupPath), false);
        await unlock(NEW_PIN);
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: backupPath });
        assert.equal(await js("classroom.file({command:'backup'})"), true);
        const raw = fs.readFileSync(backupPath, 'utf8');
        assert.ok(!raw.includes('"salt"') && !raw.includes('"hash"') && !raw.includes('classroom-lock'), 'Backup excludes credential configuration');
        assert.ok(!raw.includes(PIN) && !raw.includes(NEW_PIN), 'Backup excludes test PINs');
      } finally { dialog.showSaveDialog = originalSave; }
    });
    await check('No credentials appear in public results or screenshots and no renderer console errors occurred', async () => {
      const publicStatus = await status();
      assert.ok(Object.keys(publicStatus).every(key => ['configured', 'locked', 'blocked', 'ok'].includes(key)));
      const disk = fs.readFileSync(path.join(data, FILE_NAME), 'utf8');
      assert.ok(!disk.includes(PIN) && !disk.includes(NEW_PIN), 'No plaintext credential persisted');
      assert.equal(errors.length, 0, 'No renderer console errors');
    });
    await relock(); finish();
  } catch (error) {
    console.error('FATAL_LOCK', error.message);
    app.exit(2);
  }
}
