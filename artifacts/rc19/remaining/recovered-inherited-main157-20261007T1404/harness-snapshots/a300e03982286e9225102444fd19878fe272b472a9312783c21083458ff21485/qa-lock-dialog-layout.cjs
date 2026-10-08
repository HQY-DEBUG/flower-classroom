'use strict';
// Real Electron main/preload/renderer. All classroom data and credentials are
// generated here; no user data is read. Native input exercises the header.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const variant = process.env.FLOWER_PACKAGE_MAIN ? 'packaged' : 'source';
const out = path.join(root, 'artifacts/rc9/lock-dialog-' + variant);
fs.mkdirSync(out, { recursive: true });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sourceHashes = () => Object.fromEntries(['classroom-lock-ui.js', 'classroom-lock.css', 'classroom-lock.cjs', 'main.cjs', 'preload.cjs'].map(name => [name, sha(fs.readFileSync(path.join(root, 'src', name)))]));
const layouts = [
  { width: 900, height: 640, zoom: 1 },
  { width: 900, height: 640, zoom: 1.25 },
  { width: 900, height: 640, zoom: 2 },
  { width: 900, height: 720, zoom: 2 },
  { width: 360, height: 640, zoom: 1 },
  { width: 240, height: 480, zoom: 1 },
  { width: 160, height: 340, zoom: 1 },
  { width: 110, height: 146, zoom: 1 },
  { width: 64, height: 480, zoom: 1 }
];

if (!process.versions.electron) {
  const before = sourceHashes(), results = [];
  for (const phase of ['setup', 'change', 'locked', 'corrupt', 'transport', 'pending']) {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-lock-layout-'));
    const fixture = require('../src/core.cjs').createInitialState();
    fixture.settings.className = '合成课堂密码布局验收班';
    fixture.students = fixture.students.slice(0, 4).map((student, index) => ({ ...student, name: '合成同学' + (index + 1), photo: '' }));
    fs.writeFileSync(path.join(data, 'classroom.json'), JSON.stringify(fixture));
    if (['change', 'locked'].includes(phase)) {
      const lock = require('../src/classroom-lock.cjs').createClassroomLock(data);
      lock.setup('2468', '2468');
      if (phase === 'change') lock.unlock('2468');
    }
    if (phase === 'corrupt') fs.writeFileSync(path.join(data, 'classroom-lock.json'), 'SYNTHETIC_CORRUPT_CONFIGURATION');
    const run = require('node:child_process').spawnSync(require('electron'), ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu', __filename], {
      cwd: root, encoding: 'utf8', timeout: 100000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, FLOWER_HEADLESS_TEST: '1', FLOWER_DATA_DIR: data, FLOWER_LOCK_LAYOUT_PHASE: phase }
    });
    fs.writeFileSync(path.join(out, phase + '.log'), (run.stdout || '') + (run.stderr || ''));
    console.log((run.stdout || '').split('\n').filter(line => /^(PASS_LOCK_LAYOUT|FAIL_LOCK_LAYOUT)/.test(line)).join('\n'));
    const resultFile = path.join(out, phase + '.json');
    results.push({ phase, exitCode: run.status, error: run.error?.message, report: fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile)) : null });
    fs.rmSync(data, { recursive: true, force: true });
  }
  const checks = results.flatMap(result => result.report?.checks || []), after = sourceHashes();
  const report = {
    version: require('../package.json').version, variant, syntheticOnly: true,
    environment: 'Linux Electron with actual main, preload, renderer and native mouse/keyboard events',
    windowsExecuted: false, physicalTouchscreenTested: false, zoomIsDpiEquivalentOnly: true,
    sourceAtStart: before, sourceAtFinish: after, sourceChanged: JSON.stringify(before) !== JSON.stringify(after),
    passed: checks.filter(check => check.status === 'passed').length,
    failed: checks.filter(check => check.status !== 'passed').length, results
  };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  assert.ok(results.every(result => result.exitCode === 0), 'Every Electron phase must complete');
  assert.equal(report.failed, 0); assert.equal(report.sourceChanged, false);
  console.log('LOCK_LAYOUT_PASSED', report.passed);
} else {
  const { app, BrowserWindow, Menu, ipcMain } = require('electron');
  app.disableHardwareAcceleration();
  const phase = process.env.FLOWER_LOCK_LAYOUT_PHASE, data = process.env.FLOWER_DATA_DIR;
  const classroomPath = path.join(data, 'classroom.json'), lockPath = path.join(data, 'classroom-lock.json');
  const classroomBytes = fs.readFileSync(classroomPath), lockBytes = fs.existsSync(lockPath) ? fs.readFileSync(lockPath) : null;
  const checks = [], errors = [];
  let main, failure = phase === 'transport', pending = phase === 'pending', releasePending;
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, ...args) => {
    if (channel === 'lock:command' && args[0]?.command === 'status') {
      if (failure) throw Error('SYNTHETIC_LOCK_LAYOUT_TRANSPORT');
      if (pending) await new Promise(resolve => { releasePending = resolve; });
    }
    return handler(event, ...args);
  });
  const entry = path.resolve(process.env.FLOWER_PACKAGE_MAIN || path.join(root, 'src/main.cjs'));
  require('./package-boundary.cjs')(entry, path.join(out, phase + '-dependency-boundary.json'));
  require(entry);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = source => main.webContents.executeJavaScript(source, true);
  const until = async (fn, label) => { for (let i = 0; i < 160; i++) { if (await fn()) return; await sleep(25); } throw Error('Timeout: ' + label); };
  const ui = () => js(`(()=>{const o=document.querySelector('#classroom-lock-overlay');return {mode:o?.dataset.mode,hidden:o?.hidden,inert:document.querySelector('#app')?.inert,activeInside:o?.contains(document.activeElement),cancelCount:o?.querySelectorAll('[data-lock-action="cancel"]').length,headerCount:o?.querySelectorAll('.cl-settings-header').length}})()`);
  const state = () => js('classroom.get().then(result=>result.state)');
  const unchanged = () => {
    assert.deepEqual(fs.readFileSync(classroomPath), classroomBytes);
    if (lockBytes) assert.deepEqual(fs.readFileSync(lockPath), lockBytes);
    else assert.equal(fs.existsSync(lockPath), false);
  };
  async function key(keyCode, modifiers = []) {
    main.show(); main.focus();
    main.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    main.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await sleep(45);
  }
  async function click(selector) {
    const p = await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return {x,y,width:r.width,height:r.height,disabled:e.disabled,hit:h===e||e.contains(h),visible:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}})()`);
    assert.ok(p?.visible && p.hit && !p.disabled, 'Visible native hit target: ' + selector + ' ' + JSON.stringify(p));
    const z = main.webContents.getZoomFactor(), x = Math.round(p.x * z), y = Math.round(p.y * z);
    main.show(); main.focus(); main.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    for (const type of ['mouseDown', 'mouseUp']) main.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
    await sleep(70);
  }
  async function geometry() {
    return js(`(()=>{const o=document.querySelector('#classroom-lock-overlay'),d=o.querySelector('.cl-card'),h=d.querySelector('.cl-settings-header'),t=d.querySelector('#cl-heading'),x=h?.querySelector('[data-lock-action="cancel"]'),c=d.querySelector('.cl-settings-content');const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height}};return {viewport:[innerWidth,innerHeight],dialog:rect(d),header:rect(h),title:rect(t),cancel:rect(x),titleText:t?.textContent,titleCount:d.querySelectorAll('#cl-heading').length,accessibleName:d.getAttribute('aria-labelledby'),compact:o.classList.contains('cl-compact'),content:c?{...rect(c),scroll:c.scrollTop,max:c.scrollHeight-c.clientHeight,overflow:getComputedStyle(c).overflowY}:null,overlayScroll:o.scrollTop,dialogScroll:d.scrollTop,horizontalOverflow:d.scrollWidth>d.clientWidth+1}})()`);
  }
  async function bottom() {
    const g = await geometry(), c = g.content, z = main.webContents.getZoomFactor();
    const x = Math.round((c.left + 8) * z), y = Math.round((c.top + c.height / 2) * z);
    main.show(); main.focus();
    main.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await sleep(100);
    let after = g, attempts = 0;
    const began = Date.now();
    while (after.content.max - after.content.scroll > 2 && attempts < 20) {
      main.webContents.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: -1000, canScroll: true });
      await sleep(150);
      after = await geometry(); attempts++;
    }
    after.nativeWheel = { attempts, waitedMs: Date.now() - began, maximumAttempts: 20, directDOMScrollUsed: false };
    if (c.max > 2) assert.ok(after.content.scroll > 0, 'Native wheel scrolls the form: ' + JSON.stringify({ before: g, after }));
    assert.ok(after.content.max - after.content.scroll <= 2, 'Native wheel reaches form bottom');
    return after;
  }
  const visible = (r, g) => r && r.left >= -1 && r.top >= -1 && r.right <= g.viewport[0] + 1 && r.bottom <= g.viewport[1] + 1;
  async function screenshot(name) { fs.writeFileSync(path.join(out, name + '.png'), (await main.webContents.capturePage()).toPNG()); }
  async function check(name, fn) {
    try { const detail = await fn(); checks.push({ name, status: 'passed', detail }); console.log('PASS_LOCK_LAYOUT', name); }
    catch (error) { checks.push({ name, status: 'failed', error: error.stack }); console.log('FAIL_LOCK_LAYOUT', name, error.message); await screenshot('failure-' + phase + '-' + checks.length); throw error; }
  }
  async function layout({ width, height, zoom }) {
    main.setMinimumSize(40, 80); main.setContentSize(width, height); main.webContents.setZoomFactor(zoom); await sleep(180);
  }
  async function openSettings() {
    await js('document.querySelector("#nav-settings").focus()');
    const menu = Menu.getApplicationMenu().items.find(item => item.label === '课堂工具');
    menu.submenu.items.find(item => item.label === '设置 / 修改课堂密码').click();
    await until(async () => (await ui()).mode === phase && !(await ui()).hidden, 'settings open');
  }
  app.whenReady().then(async () => {
    try {
      await until(async () => { main = BrowserWindow.getAllWindows().find(window => window.flowerRole === 'main'); return main && !main.webContents.isLoading(); }, 'main loaded');
      main.webContents.on('console-message', (_event, level, message) => { if (level === 'error' || level >= 3) errors.push(message); });
      await until(() => js('!!document.querySelector("#nav-settings")&&!!document.querySelector("#classroom-lock-overlay")'), 'renderer');
      const before = await state();
      if (['setup', 'change'].includes(phase)) {
        await until(async () => (await ui()).hidden, 'startup unlocked');
        for (const size of layouts) {
          await check(`${phase}: ${size.width}x${size.height} at ${size.zoom * 100}% keeps title and 44px cancel visible after native bottom scroll`, async () => {
            await layout(size); await openSettings();
            const top = await geometry();
            assert.equal(top.titleText, phase === 'setup' ? '设置课堂密码' : '修改课堂密码');
            assert.equal(top.titleCount, 1); assert.equal(top.accessibleName, 'cl-heading');
            assert.equal((await ui()).inert, true);
            const after = await bottom();
            assert.ok(visible(after.header, after) && visible(after.title, after) && visible(after.cancel, after), 'Header/title/cancel fit viewport: ' + JSON.stringify(after));
            assert.ok(after.cancel.width >= 44 && after.cancel.height >= 44, 'Cancel is at least 44x44 CSS pixels');
            assert.ok(Math.abs(top.header.top - after.header.top) < 1, 'Header does not scroll');
            assert.equal(after.overlayScroll, 0); assert.equal(after.dialogScroll, 0); assert.equal(after.horizontalOverflow, false);
            await screenshot(`${phase}-${size.width}x${size.height}-${size.zoom * 100}-bottom`);
            await click('.cl-settings-header [data-lock-action="cancel"]');
            await until(async () => (await ui()).hidden, 'native header cancel');
            assert.equal(await js('document.activeElement.id'), 'nav-settings');
            assert.equal((await ui()).inert, false);
            assert.equal(await js('[...document.querySelectorAll("#classroom-lock-overlay input")].every(input=>!input.value)'), true);
            assert.deepEqual(await state(), before); unchanged();
            await openSettings(); await key('Escape'); await until(async () => (await ui()).hidden, 'Escape cancel'); unchanged();
            return { ...size, top, bottom: after, nativeHeaderCancel: true, escapeCancel: true, focusRestored: true, syntheticDataUnchanged: true };
          });
        }
        await check(phase + ': focus stays isolated and Tab wraps through the persistent header', async () => {
          await layout(layouts[0]); await openSettings();
          await js('document.querySelector("#nav-students").focus()'); assert.equal((await ui()).activeInside, true);
          await js('document.querySelector(".cl-header-cancel").focus()'); await key('Tab', ['shift']);
          assert.equal(await js('document.activeElement.dataset.lockAction'), 'submit');
          await key('Tab'); assert.equal(await js('document.activeElement.classList.contains("cl-header-cancel")'), true);
          await key('Escape'); await until(async () => (await ui()).hidden, 'close focus test'); unchanged();
        });
        if (phase === 'change') {
          await check('A new lock removes the settings header and its cancel action; Escape and the old cancel location cannot dismiss it', async () => {
            await openSettings(); const g = await geometry();
            await js('classroom.lock({command:"lock"})'); await until(async () => (await ui()).mode === 'locked', 'broadcast lock');
            assert.equal((await ui()).cancelCount, 0); assert.equal((await ui()).headerCount, 0);
            await key('Escape');
            const x = Math.round(g.cancel.left + g.cancel.width / 2), y = Math.round(g.cancel.top + g.cancel.height / 2);
            for (const type of ['mouseDown', 'mouseUp']) main.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
            await sleep(60); assert.equal((await ui()).mode, 'locked'); assert.equal((await ui()).hidden, false); assert.equal((await ui()).inert, true);
            assert.equal((await js('classroom.lock({command:"status"})')).locked, true);
            assert.deepEqual(fs.readFileSync(classroomPath), classroomBytes);
            const prior = JSON.parse(lockBytes), after = JSON.parse(fs.readFileSync(lockPath));
            assert.equal(after.hash, prior.hash); assert.equal(after.salt, prior.salt);
            await screenshot('change-transition-locked');
          });
        }
      } else {
        const expected = { locked: 'locked', corrupt: 'blocked', transport: 'unavailable', pending: 'pending' }[phase];
        await until(async () => (await ui()).mode === expected, 'protected state');
        for (const size of [layouts[0], layouts[1], layouts[2], layouts[5]]) {
          await check(`${phase}: ${size.width}x${size.height} at ${size.zoom * 100}% exposes no cancel and ignores native Escape`, async () => {
            await layout(size);
            assert.equal((await ui()).cancelCount, 0); assert.equal((await ui()).headerCount, 0);
            await key('Escape'); await key('Tab');
            const result = await ui();
            assert.equal(result.mode, expected); assert.equal(result.hidden, false); assert.equal(result.inert, true); assert.equal(result.activeInside, true);
            assert.deepEqual(await state(), before); unchanged();
            await screenshot(`${phase}-${size.width}x${size.height}-${size.zoom * 100}`);
            return { ...size, ...result, credentialsAndDataUnchanged: true };
          });
        }
        if (phase === 'locked' || phase === 'corrupt') await check(phase + ': scoring remains blocked', async () => {
          await assert.rejects(js(`classroom.action({type:'score',ids:[${JSON.stringify(before.students[0].id)}],delta:1})`), /课堂已锁定/); unchanged();
        });
        if (phase === 'transport' || phase === 'pending') await check(phase + ': successful status recovery releases protection without resetting files', async () => {
          failure = false; pending = false;
          if (releasePending) releasePending(); else await js('ClassroomLockUI.refresh()');
          await until(async () => (await ui()).hidden, 'status recovered'); unchanged();
        });
      }
      await check('No unexpected renderer errors', async () => assert.deepEqual(errors, []));
      fs.writeFileSync(path.join(out, phase + '.json'), JSON.stringify({ phase, entry, checks, syntheticOnly: true }, null, 2));
      app.exit(0);
    } catch (error) {
      console.error(error);
      fs.writeFileSync(path.join(out, phase + '.json'), JSON.stringify({ phase, entry, checks, fatal: error.stack, syntheticOnly: true }, null, 2));
      app.exit(1);
    }
  });
  setTimeout(() => app.exit(3), 95000);
}
