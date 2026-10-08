'use strict';
const {ensureToolControl,visibleControl,nativeClick}=require('./qa-tool-control.cjs');
// Independent pet regression: real Electron main/preload/renderer, synthetic data only.
// Run with Electron, not node. FLOWER_PACKAGE_MAIN may target a tested packaged main.cjs.
const { app, BrowserWindow, dialog, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { legacyState, legacyJSON } = require('../tests/pet-fixtures.cjs');
const root = path.resolve(__dirname, '..'), out = process.env.FLOWER_PETS_OUT ? path.resolve(process.env.FLOWER_PETS_OUT) : path.join(root, 'artifacts', process.env.FLOWER_PACKAGE_MAIN?'qa-pets-packaged':'qa-pets'), data = path.join(root, process.env.FLOWER_PACKAGE_MAIN?'.qa-pets-packaged':'.qa-pets');
const mainPath = process.env.FLOWER_PACKAGE_MAIN ? path.resolve(process.env.FLOWER_PACKAGE_MAIN) : path.join(root, 'src', 'main.cjs');
const sourceDir = path.dirname(mainPath);
const { validateState, createInitialState, importRows } = require(path.join(sourceDir, 'core.cjs'));
const Rules = require(path.join(sourceDir, 'score-rules.js')), Config = require(path.join(sourceDir, 'configuration-model.js'));
const configured = (input, current) => { const value = validateState(input); if (!value.appConfig && current?.appConfig) value.appConfig = JSON.parse(JSON.stringify(current.appConfig)); if (!value.sharedScoreRules) Rules.confirmShared(value, Rules.previewShared(value).expectedKey); Config.apply(value, Config.snapshot(value)); return value; };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function manifest(dir, prefix = '') { return Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? Object.entries(manifest(path.join(dir, d.name), prefix + d.name + '/')) : [[prefix + d.name, sha(fs.readFileSync(path.join(dir, d.name)))]])); }
const testedSource = manifest(sourceDir);
// Only this hard-coded isolated fixture directory is reset. Never production userData.
fs.rmSync(data, { recursive: true, force: true });
fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(data, 'classroom.json'), legacyJSON());
process.env.FLOWER_HEADLESS_TEST = '1'; process.env.FLOWER_DATA_DIR = data;
app.disableHardwareAcceleration();
let main, pet, pets, panel, sidebar, openPath, savePath;
const checks = [], requests = [], consoleErrors = [];
dialog.showOpenDialog = async () => openPath ? { canceled: false, filePaths: [openPath] } : { canceled: true, filePaths: [] };
dialog.showSaveDialog = async () => savePath ? { canceled: false, filePath: savePath } : { canceled: true };
app.on('web-contents-created', (_event, wc) => wc.on('console-message', (event, level, message) => {
  const msg = event.message ?? message, severity = event.level ?? level;
  if (severity === 'error' || severity >= 3) consoleErrors.push({ window: wc.id, message: msg });
}));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const js = (w, source) => w.webContents.executeJavaScript(source, true);
const until = async (fn, label = 'condition') => { for (let n = 0; n < 160; n++) { if (await fn()) return; await sleep(40); } throw Error('Timed out: ' + label); };
const state = w => js(w, 'classroom.get().then(x=>x.state)');
const action = (w, a) => js(w, `classroom.action(${JSON.stringify(a)})`);
const file = (w, a) => js(w, `classroom.file(${JSON.stringify(a)})`);
const textOf = (w, sel = '#app') => js(w, `document.querySelector(${JSON.stringify(sel)})?.innerText || ''`);
const exists = (w, sel) => js(w, `!!document.querySelector(${JSON.stringify(sel)})`);
const click = async (w, sel) => {sel=await ensureToolControl(w,sel);return js(w, `(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)throw Error('Missing selector: '+${JSON.stringify(sel)});if(b.disabled)throw Error('Disabled control: '+${JSON.stringify(sel)});b.click();return true;})()`);};
const fill = (w, sel, value, event = 'input') => js(w, `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('Missing input: '+${JSON.stringify(sel)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));return true;})()`);
const submit = (w, sel, twice = false) => js(w, `(()=>{const f=document.querySelector(${JSON.stringify(sel)});if(!f)throw Error('Missing form');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));${twice ? "f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));" : ''}return true;})()`);
async function check(name, fn) { try { const detail = await fn(); checks.push({ name, status: 'passed', detail }); console.log('PASS_PET', name, detail ?? ''); } catch (e) { checks.push({ name, status: 'failed', error: e.stack }); console.error('FAIL_PET', name, e.message); try { await shot(main, 'failure-' + checks.length); } catch {} } }
async function ready(w) { await until(() => js(w, '!!window.classroom && !!document.querySelector("#app")?.innerText.trim()').catch(() => false), 'renderer ready'); await sleep(100); assert.equal(await exists(w, '.fatal'), false, await textOf(w)); }
async function shot(w, name) { await sleep(100); fs.writeFileSync(path.join(out, name + '.png'), (await captureRetry(w)).toPNG()); }
async function open(role) { await js(main, `classroom.window({command:'open',role:${JSON.stringify(role)}})`); const w = BrowserWindow.getAllWindows().find(w => w.flowerRole === role); assert.ok(w, 'missing ' + role); await ready(w); return w; }
async function closeModal(w = main) { if (await exists(w, '#modal .dialog')) await click(w, '#modal [data-do="modal-close"]'); }
async function closeFeedback(w = main) { if (await exists(w, '[data-do="pet-feedback-close"]')) await click(w, '[data-do="pet-feedback-close"]'); }
const applyRestorePreview = incoming => file(main,{command:'restore-apply',state:incoming,restoreToken:incoming.restoreToken,expectedRevision:incoming.expectedRevision});
let fixtureNumber = 0;
async function restoreFixture(input) {
  const before = await state(main), previousPath = openPath, fixturePath = path.join(out, 'restore-fixture-' + (++fixtureNumber) + '.json');
  const bytes = JSON.stringify(input); fs.writeFileSync(fixturePath, bytes); openPath = fixturePath;
  try {
    const preview = await file(main, {command:'restore-preview'});
    assert.deepEqual(validateState(preview), validateState(input)); assert.equal(typeof preview.restoreToken,'string'); assert.equal(preview.expectedRevision,before.revision); assert.ok(preview.restoreConfiguration);
    assert.deepEqual(await state(main),before); assert.equal(fs.readFileSync(fixturePath,'utf8'),bytes);
    await applyRestorePreview(preview);
    assert.deepEqual(snapshotWithoutRevision(await state(main)),snapshotWithoutRevision(configured(input,before)));
    assert.equal(fs.readFileSync(fixturePath,'utf8'),bytes);
  } finally { openPath = previousPath; }
}
async function restore(input = legacyState()) { await closeModal(); await restoreFixture(input); await sleep(60); await closeFeedback(); }
async function goPets() { await closeModal(); await click(main, '[data-page="pets"]'); }
async function detail(id = 's_legacy_owl') { await goPets(); await click(main, `[data-do="pet-detail"][data-id="${id}"]`); }
const snapshotWithoutRevision = s => { const value = JSON.parse(JSON.stringify(s)); delete value.revision; return value; };
require(mainPath);
app.whenReady().then(async () => {
  try {
    session.defaultSession.webRequest.onCompleted(details => requests.push(details.url));
    await until(() => BrowserWindow.getAllWindows().some(w => w.flowerRole === 'main'));
    main = BrowserWindow.getAllWindows().find(w => w.flowerRole === 'main'); await ready(main); main.setSize(1440, 1000); await sleep(100);
    await check('Raw v1.0 bytes remain recoverable while startup adds only the declared v2 configuration cache', async () => {
      const loaded = await js(main, 'classroom.get()');
      assert.equal(loaded.warning, ''); assert.equal(loaded.workbookWarning, ''); assert.deepEqual(loaded.state, configured(legacyState()));
      assert.deepEqual(loaded.state.students, validateState(legacyState()).students); assert.deepEqual(loaded.state.logs, legacyState().logs);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'classroom-v2.json'))), loaded.state);
      const backups=(await file(main,{command:'folder-info'})).backup; assert.ok(fs.readdirSync(backups).filter(n=>n.startsWith('before-v2-migration')).some(n=>fs.readFileSync(path.join(backups,n),'utf8')===legacyJSON()));
      assert.equal(fs.readFileSync(path.join(data, 'classroom.json'), 'utf8'), legacyJSON());
      assert.equal(await js(main, 'typeof require'), 'undefined'); assert.equal(await js(main, 'typeof process'), 'undefined');
      assert.equal(await js(main, 'document.querySelectorAll(".student-card").length'), 4);
      await shot(main, '01-legacy-start');
    });
    await check('Pet garden has explicit navigation and direct student-card entry without editing a student', async () => {
      assert.match(await textOf(main, 'nav'), /养宠物|宠物/);
      assert.equal(await js(main, 'document.querySelectorAll(".student-card [data-do=pet-detail]").length'), 4);
      const beforeNavigation = await state(main), paths = [];
      for (const [label, selector] of [['left navigation','nav [data-page="pets"]'],['class overview action','.class-overview [data-page="pets"]'],['tools palette','[data-do="tools-pets"]']]) {
        await click(main, 'nav [data-page="students"]');
        const actualSelector = await ensureToolControl(main, selector), control = await visibleControl(main, actualSelector);
        assert.ok(control && !control.disabled, label + ' is visible and hit-testable');
        if (label === 'tools palette') await shot(main, '02-pet-tools-palette');
        await nativeClick(main, control);
        await until(() => js(main, '!!document.querySelector(".pet-student-card")'), label + ' opens pet garden');
        assert.equal(await js(main, 'document.querySelectorAll("[data-do=pet-detail]").length'), 4);
        assert.equal(await exists(main, '#modal .dialog'), false);
        paths.push({label,selector,hitTested:true,nativeClick:true});
      }
      assert.deepEqual(await state(main), beforeNavigation);
      for(const actionName of ['open-pets','open-pet']){const selector=await ensureToolControl(main,'[data-do="'+actionName+'"]');assert.ok(await visibleControl(main,selector),actionName+' remains accessible through pet features');await closeModal();}
      await shot(main, '02-pet-garden');
      return {oldPath:'duplicate topbar pet shortcut and inline tool strip',newPaths:paths,studentCardEntryCount:4,dataUnchanged:true};
    });
    await check('Legacy high-growth pet keeps its full level and seven-stage visual cap', async () => {
      await detail('s_legacy_bunny'); const content = await textOf(main);
      assert.match(content, /(?:LV\.?|Lv\.?|等级\s*)\s*11/); assert.equal((await state(main)).students[2].growth, 200);
      assert.ok(await exists(main, '[data-do="pet-album"]')); await shot(main, '03-high-growth-detail');
    });
    await check('Every species exposes seven independently previewable, genuinely distinct evolution forms', async () => {
      const summaries = [];
      for (const student of legacyState().students) {
        await detail(student.id); await click(main, `[data-do="pet-album"][data-id="${student.id}"]`);
        // RC11 adds one common egg prelude; the original seven forms stay intact.
        assert.equal(await js(main, 'document.querySelectorAll("#modal .album-tile[data-do=pet-preview]").length'), 8);
        assert.equal(await js(main, 'document.querySelectorAll("#modal .album-tile[data-level=\\"0\\"] svg.pet-egg[data-pet-stage=egg]").length'), 1);
        const markup = await js(main, `[...document.querySelectorAll('#modal .album-tile[data-do=pet-preview]:not([data-level="0"])')].map(b=>({level:Number(b.dataset.level),svg:b.querySelector('svg')?.outerHTML||''}))`);
        assert.deepEqual(markup.map(x => x.level), [1, 2, 3, 4, 5, 6, 7]);
        assert.ok(markup.every(x => x.svg));
        const shapes = markup.map(x => x.svg.replace(/class="[^"]*"|aria-label="[^"]*"|data-[\w-]+="[^"]*"|<title>.*?<\/title>/g, ''));
        assert.equal(new Set(shapes).size, 7, student.pet + ' must differ by actual SVG geometry, not just label');
        const before = await state(main);
        await click(main, '#modal .album-tile[data-do="pet-preview"][data-level="0"]');
        assert.ok(await exists(main, '#album-preview svg.pet-egg[data-pet-stage=egg]'));
        for (let level = 1; level <= 7; level++) await click(main, `#modal .album-tile[data-do="pet-preview"][data-level="${level}"]`);
        assert.deepEqual(await state(main), before, 'preview must never grant growth');
        await shot(main, '04-album-' + student.pet); summaries.push({ pet: student.pet, distinctForms: 7 }); await closeModal();
      }
      return summaries;
    });
    await check('Album Escape and rapid repeated previews release modal focus without changing pet growth', async () => {
      await detail(); const before = await state(main); await click(main, '[data-do="pet-album"]');
      await js(main, `(()=>{const b=document.querySelector('#modal .album-tile[data-do="pet-preview"][data-level="7"]');b.click();b.click();return true;})()`);
      assert.equal(await js(main, 'document.querySelector("#app").inert'), true);
      main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await sleep(60);
      assert.equal(await exists(main, '#modal .dialog'), false); assert.equal(await js(main, 'document.querySelector("#app").inert'), false);
      assert.deepEqual(await state(main), before);
    });
    await check('Reward picker cancellation is non-mutating and +2 reason commits only once under repeated click', async () => {
      await restore(); await detail(); const before = await state(main);
      await click(main, '[data-do="pet-reward"]'); assert.match(await textOf(main, '#modal'), /认真做题/); await closeModal(); assert.deepEqual(await state(main), before);
      await click(main, '[data-do="pet-reward"]');
      await js(main, `(()=>{const b=[...document.querySelectorAll('#modal [data-do="pet-reason"]')].find(b=>b.textContent.includes('认真做题'));if(!b)throw Error('Missing +2 reason');b.click();b.click();return true;})()`);
      await until(async () => (await state(main)).revision > before.revision, 'reward persisted'); await sleep(150);
      const after = await state(main); assert.equal(after.revision, before.revision + 1); assert.equal(after.logs.length, before.logs.length + 1);
      assert.equal(after.logs.at(-1).delta, 2); assert.equal(after.logs.at(-1).reason, '认真做题'); assert.equal(after.students[0].score, 21); assert.equal(after.students[0].growth, 21);
      assert.equal(await exists(main, '#modal .dialog'), false); assert.equal(await js(main, 'document.querySelector("#app").inert'), false);
      assert.match(await textOf(main, '#pet-feedback'), /升级/); await sleep(500); await shot(main, '05-upgrade-feedback');
    });
    await check('Repeated and stale state broadcasts do not duplicate an upgrade celebration', async () => {
      const current = await state(main); await closeFeedback();
      main.webContents.send('state:changed', current); main.webContents.send('state:changed', { ...current, revision: current.revision - 1 }); await sleep(100);
      assert.equal(await textOf(main, '#pet-feedback'), ''); assert.deepEqual(await state(main), current);
    });
    await check('Undo reduces the gained level with explicit rollback feedback and restores the audit record', async () => {
      const before = await state(main); const reward = before.logs.at(-1);
      await action(main, { type: 'undo', logId: reward.id }); await sleep(100);
      assert.equal((await state(main)).students[0].growth, 19);
      assert.equal((await state(main)).logs.at(-1).undone, true);
      const feedback = (await textOf(main, '#pet-feedback')) + ' ' + await textOf(main, '#toast');
      assert.match(feedback, /撤销|回退|恢复|降级/); await shot(main, '06-undo-feedback');
    });
    await check('Rules dialog cancel, validation and repeated submit preserve historic values and never fake upgrades', async () => {
      await closeFeedback(); await goPets(); const before = await state(main); await click(main, '[data-do="pet-rules"]'); await fill(main, '#pet-step', 5); await closeModal(); assert.deepEqual(await state(main), before);
      await click(main, '[data-do="pet-rules"]'); await fill(main, '#pet-step', 0); await submit(main, '#pet-rules-form'); await sleep(50); assert.deepEqual(await state(main), before);
      await fill(main, '#pet-step', 5); await submit(main, '#pet-rules-form', true); await until(async () => (await state(main)).settings.petStep === 5); await sleep(100);
      const after = await state(main); assert.equal(after.revision, before.revision + 1); assert.deepEqual(after.students, before.students); assert.deepEqual(after.logs, before.logs);
      assert.equal(await exists(main, '#modal .dialog'), false); assert.equal(await textOf(main, '#pet-feedback'), '');
    });
    await check('Independent classroom and floating pet windows open from visible controls and repeated open reuses one window', async () => {
      await goPets(); await click(main, '[data-do="open-pets"]'); pets = BrowserWindow.getAllWindows().find(w => w.flowerRole === 'pets'); assert.ok(pets); await ready(pets);
      await click(main, '[data-do="open-pet"]'); pet = BrowserWindow.getAllWindows().find(w => w.flowerRole === 'pet'); assert.ok(pet); await ready(pet);
      const id = pet.id; await click(main, '[data-do="open-pet"]'); await click(main, '[data-do="open-pet"]');
      assert.equal(BrowserWindow.getAllWindows().filter(w => w.flowerRole === 'pet').length, 1); assert.equal(pet.id, id);
      assert.match(await textOf(pets), /课堂展示|成长伙伴/); assert.ok(await exists(pets, '[data-do="fullscreen"]'));
      panel = await open('panel'); sidebar = await open('sidebar'); assert.ok(await exists(sidebar, '[data-do="open-pet"]'));
      await shot(pets, '07-classroom-display'); await shot(pet, '08-floating-pet');
    });
    await check('Floating red flower double-click repeatedly shows and hides the existing score panel without changing data', async () => {
      const flower = await open('flower'); await open('panel'); await until(() => panel.isVisible(), 'panel initially visible');
      const before = await state(main), panelId = panel.id;
      const doubleClick = () => js(flower, `(()=>{const b=document.querySelector('[data-do="open-panel"]');for(const type of ['click','click','dblclick'])b.dispatchEvent(new MouseEvent(type,{bubbles:true,detail:type==='dblclick'?2:1}));return true;})()`);
      for (const visible of [false, true, false, true]) { await doubleClick(); await sleep(400); assert.equal(panel.isVisible(), visible); assert.equal(panel.id, panelId); }
      await doubleClick(); await sleep(400); assert.equal(panel.isVisible(), false); await click(flower, '[data-do="open-panel"]'); await sleep(400); assert.equal(panel.isVisible(), true);
      assert.equal(BrowserWindow.getAllWindows().filter(w => w.flowerRole === 'panel').length, 1); assert.deepEqual(await state(main), before);
      await shot(flower, '08-red-flower');
    });
    await check('Floating focus selects the requested student and survives an independent window close/reopen', async () => {
      await detail('s_legacy_fox'); await click(main, '[data-do="pet-focus"][data-id="s_legacy_fox"]');
      await until(async () => (await state(main)).settings.petFocusId === 's_legacy_fox'); await until(async () => (await textOf(pet)).includes('虚构兼容乙'));
      pet.close(); await until(() => !BrowserWindow.getAllWindows().some(w => w.flowerRole === 'pet')); pet = await open('pet'); assert.match(await textOf(pet), /虚构兼容乙/);
      assert.equal((await state(pet)).settings.petFocusId, 's_legacy_fox');
    });
    await check('Concurrent points from four windows are all retained and every renderer converges', async () => {
      const before = await state(main), id = before.students[0].id; const windows = [main, panel, pet, pets];
      await Promise.all(Array.from({ length: 24 }, (_, i) => action(windows[i % windows.length], { type: 'score', ids: [id], delta: 1, reason: '纯合成多窗成长' })));
      const after = await state(main); assert.equal(after.revision, before.revision + 24); assert.equal(after.students[0].growth, before.students[0].growth + 24); assert.equal(after.students[0].score, before.students[0].score + 24);
      assert.equal(after.logs.length, before.logs.length + 24); for (const w of [...windows, sidebar]) assert.deepEqual(await state(w), after);
      await until(async () => Number(await js(panel, 'document.querySelector(".quick-student strong").textContent')) === after.students[0].score);
      await shot(pets, '09-synced-classroom');
    });
    await check('Full native backup/export/restore recovers pet rules, focus, photos and points without phantom celebration', async () => {
      await closeFeedback(); const before = await state(main); savePath = path.join(out, 'synthetic-pet-backup.json');
      assert.equal(await file(main, { command: 'backup' }), true); assert.deepEqual(JSON.parse(fs.readFileSync(savePath)), before);
      await action(main, { type: 'pet.rules', step: 100 }); await action(main, { type: 'student.update', id: before.students[0].id, pet: 'cat', photo: '' });
      openPath = savePath; const incoming = await file(main, { command: 'restore-preview' }); assert.deepEqual(validateState(incoming), before); await applyRestorePreview(incoming); await sleep(100);
      assert.deepEqual(snapshotWithoutRevision(await state(main)), snapshotWithoutRevision(before)); assert.equal(await textOf(main, '#pet-feedback'), '');
      const restored = await state(main); await action(main,{type:'pet.rules',step:99}); assert.deepEqual((await state(main)).students,restored.students); assert.deepEqual((await state(main)).logs,restored.logs);
      assert.ok(fs.readdirSync((await file(main,{command:'folder-info'})).backup).some(n => n.startsWith('before-restore-'))); openPath = null; savePath = null;
    });
    await check('Old-format backup import restores original defaults and data; cancelled import is non-mutating', async () => {
      const oldPath = path.join(out, 'synthetic-old-v1.json'); fs.writeFileSync(oldPath, legacyJSON()); openPath = oldPath;
      const incoming = await file(main, { command: 'restore-preview' }); assert.deepEqual(validateState(incoming), validateState(legacyState()));
      await closeFeedback(); const prior=await state(main); await applyRestorePreview(incoming); await sleep(100); assert.deepEqual(snapshotWithoutRevision(await state(main)), snapshotWithoutRevision(configured(incoming,prior))); assert.equal(await textOf(main, '#pet-feedback'), '');
      openPath = null; const before = await state(main); assert.equal(await file(main, { command: 'restore-preview' }), null); assert.deepEqual(await state(main), before);
    });
    await check('A restore that resembles exactly one threshold-crossing award does not trigger any window celebration', async () => {
      await restore(); for (const w of [main, pet, pets]) await closeFeedback(w);
      const replacement = legacyState(); replacement.students[0].score = 20; replacement.students[0].growth = 20;
      replacement.logs.push({ id: 'l_old_backup_extra_award', timestamp: 1_004_000, delta: 1, reason: '纯合成备份中的旧记录', undone: false, changes: [{ id: 's_legacy_owl', name: '虚构兼容甲', beforeScore: 19, afterScore: 20, beforeGrowth: 19, afterGrowth: 20 }] });
      await restoreFixture(replacement); await sleep(120);
      for (const w of [main, pet, pets]) assert.equal(await textOf(w, '#pet-feedback'), '', w.flowerRole + ' must not celebrate a restore');
      assert.equal((await state(main)).students[0].growth, 20);
    });
    await check('Removing a student during a reward dialog cannot award another student or leave the reward lock stuck', async () => {
      await restore(); await detail(); await click(main, '[data-do="pet-reward"]');
      await action(panel, { type: 'student.remove', id: 's_legacy_owl' }); const before = await state(main);
      await click(main, '#modal [data-do="pet-reason"][data-index="1"]'); await sleep(120);
      assert.deepEqual(await state(main), before); assert.match(await textOf(main, '#toast'), /不存在|找不到/);
      assert.equal(await exists(main, '#modal .dialog'), false); assert.equal(await js(main, 'document.querySelector("#app").inert'), false);
      await detail('s_legacy_fox'); await click(main, '[data-do="pet-reward"]'); await js(main, `(()=>{const b=[...document.querySelectorAll('#modal [data-do="pet-reason"]')].find(b=>b.textContent.includes('进步很大'));if(!b)throw Error('Missing +5 reason');b.click();return true;})()`);
      await until(async () => (await state(main)).revision === before.revision + 1);
      assert.equal((await state(main)).logs.at(-1).delta, 5); assert.equal((await state(main)).students.find(s => s.id === 's_legacy_fox').growth, 32);
      await restore();
    });
    await check('Minimum window sizes and maximum legal names do not hide content behind horizontal overflow', async () => {
      const before = await state(main), id = before.students[0].id;
      await action(main, { type: 'settings', className: 'C'.repeat(80) }); await action(main, { type: 'student.update', id, name: 'W'.repeat(40), group: 'G'.repeat(40) }); await action(main, { type: 'pet.focus', id });
      main.setSize(900, 640); pets.setSize(900, 640); pet.setSize(320, 400); await sleep(120);
      const results = [];
      await goPets(); for (const [w, label] of [[main, 'main-garden'], [pets, 'classroom'], [pet, 'floating']]) { results.push({ label, ...await js(w, '({viewport:innerWidth,width:document.documentElement.scrollWidth})') }); await shot(w, '10-minimum-' + label); }
      await detail(id); results.push({ label: 'main-detail', ...await js(main, '({viewport:innerWidth,width:document.documentElement.scrollWidth})') }); await shot(main, '10-minimum-detail');
      await click(main, '[data-do="pet-album"]'); results.push({ label: 'album', ...await js(main, '({viewport:innerWidth,width:document.documentElement.scrollWidth})') }); await shot(main, '10-minimum-album'); await closeModal();
      assert.ok(results.every(r => r.width <= r.viewport), JSON.stringify(results)); await restore(before); main.setSize(1440, 1000); pets.setSize(1280, 840); return results;
    });
    await check('Batch pet selection and +5 reason create one shared transaction, and UI undo restores every selected student', async () => {
      await restore(); await goPets(); const before = await state(main), ids = before.students.slice(0, 2).map(s => s.id);
      for (const id of ids) await click(main, `.pet-select[data-student="${id}"]`);
      assert.equal(await js(main, 'document.querySelectorAll(".pet-select.checked").length'), 2);
      await click(main, '.pet-batch-bar [data-do="pet-reward"]');
      const dialogText = await textOf(main, '#modal'); for (const student of before.students.slice(0, 2)) assert.ok(dialogText.includes(student.name));
      await js(main, `(()=>{const b=[...document.querySelectorAll('#modal [data-do="pet-reason"]')].find(b=>b.textContent.includes('进步很大'));if(!b)throw Error('Missing +5 reason');b.click();return true;})()`); await until(async () => (await state(main)).revision > before.revision);
      const after = await state(main), log = after.logs.at(-1); assert.equal(after.revision, before.revision + 1); assert.equal(after.logs.length, before.logs.length + 1); assert.equal(log.delta, 5); assert.deepEqual(log.changes.map(c => c.id), ids);
      after.students.slice(0, 2).forEach((student, index) => { assert.equal(student.score, before.students[index].score + 5); assert.equal(student.growth, before.students[index].growth + 5); }); assert.deepEqual(after.students.slice(2), before.students.slice(2));
      await closeFeedback(); await detail(ids[0]); await click(main, `[data-do="undo"][data-id="${log.id}"]`); await until(async () => (await state(main)).logs.at(-1).undone);
      assert.deepEqual((await state(main)).students, before.students); await shot(main, '11-batch-undo');
    });
    await check('Restore, rule changes and profile edits immediately remove an obsolete upgrade card in every pet window', async () => {
      for (const change of ['rules', 'profile', 'restore']) {
        await restore(); await action(main, { type: 'score', ids: ['s_legacy_owl'], delta: 1, reason: '纯合成清理旧庆祝' });
        for (const w of [main, pet, pets]) await until(async () => (await textOf(w, '#pet-feedback')).includes('升级'), w.flowerRole + ' upgrade visible');
        if (change === 'rules') await action(main, { type: 'pet.rules', step: 5 });
        else if (change === 'profile') await action(main, { type: 'student.update', id: 's_legacy_owl', pet: 'cat' });
        else await restoreFixture(legacyState());
        await sleep(80); for (const w of [main, pet, pets]) assert.equal(await textOf(w, '#pet-feedback'), '', `${change} must clear ${w.flowerRole} obsolete feedback`);
      }
    });
    await check('Deleting the focused companion falls back safely and a blank class uses its documented five-point rule', async () => {
      await restore(); await action(main, { type: 'pet.focus', id: 's_legacy_fox' }); await action(main, { type: 'student.remove', id: 's_legacy_fox' });
      assert.equal((await state(main)).settings.petFocusId, ''); await until(async () => (await textOf(pet)).includes('虚构兼容甲'));
      const before = await state(main); await file(main, { command: 'blank' }); await sleep(100); const blank = await state(main);
      assert.equal(blank.students.length, 0); assert.equal(blank.settings.petStep, 5); assert.equal(blank.settings.petFocusId, '');
      const backups=(await file(main,{command:'folder-info'})).backup;assert.ok(fs.readdirSync(backups).filter(n => n.startsWith('before-blank-')).some(n => JSON.stringify(JSON.parse(fs.readFileSync(path.join(backups, n)))) === JSON.stringify(before)));
      assert.match(await textOf(pet), /添加|暂无|还没有|空/); await goPets(); await shot(main, '11-empty-pet-garden');
    });
    await check('A synthetic 300-student pet garden and classroom display stay bounded and responsive', async () => {
      const fixture = importRows(Array.from({ length: 300 }, (_, i) => ({ name: `纯合成宠物QA${String(i + 1).padStart(3, '0')}`, group: `纯合成组${i % 10}` })), createInitialState(), 'replace');
      const started = Date.now(); await restoreFixture(fixture); await goPets();
      assert.equal(await js(main, 'document.querySelectorAll("[data-do=pet-detail]").length'), 300);
      assert.equal(await js(pets, 'document.querySelectorAll("[data-do=pet-detail]").length'), 300);
      await action(panel, { type: 'score', ids: fixture.students.map(s => s.id), delta: 20, reason: '纯合成全班进化' }); await sleep(100);
      assert.ok((await state(main)).students.every(s => s.growth === 20));
      assert.equal(await js(main, 'document.documentElement.scrollWidth<=innerWidth'), true); await shot(main, '12-300-pets');
      assert.ok(Date.now() - started < 12_000, '300-pet update should complete within 12s in this environment'); return `${Date.now() - started} ms including offscreen screenshot`;
    });
    await check('Rewarding a lower student in the floating pet list preserves scroll position and the correct identity', async () => {
      const before = await state(main), target = before.students[20];
      const selector = `.pet-student-card[data-pet-student="${target.id}"] .pet-card-actions [data-do="pet-reward"]`;
      const originalScroll = await js(pet, `(()=>{const button=document.querySelector(${JSON.stringify(selector)});button.scrollIntoView({block:'center'});return document.querySelector('.floating-pet-content').scrollTop;})()`);
      assert.ok(originalScroll > 1_000, 'target is genuinely below the top of the long list');
      await click(pet, selector); await click(pet, '#modal [data-do="pet-reason"][data-index="1"]'); await until(async () => (await state(main)).revision === before.revision + 1); await sleep(80);
      const after = await state(main); assert.equal(after.students[20].id, target.id); assert.equal(after.students[20].growth, target.growth + 2); assert.deepEqual(after.students[0], before.students[0]);
      const afterScroll = await js(pet, "document.querySelector('.floating-pet-content').scrollTop"); assert.ok(Math.abs(afterScroll - originalScroll) <= 1, JSON.stringify({ originalScroll, afterScroll }));
      await shot(pet, '13-floating-keeps-scroll'); return { originalScroll, afterScroll, studentIndex: 20 };
    });
    await check('All observed pet resources stay local and final tested source bytes are stable', async () => {
      assert.deepEqual(requests.filter(u => !u.startsWith('file:') && !u.startsWith('data:')), []);
      assert.deepEqual(manifest(sourceDir), testedSource, 'source changed during the run; rerun against final source');
      assert.deepEqual(consoleErrors, [], 'renderer console errors are not an acceptable green run');
      fs.writeFileSync(path.join(out, 'tested-pet-source-sha256.json'), JSON.stringify(testedSource, null, 2));
      return `${requests.length} local renderer requests, ${Object.keys(testedSource).length} source files`;
    });
    const result = { checks, consoleErrors, requests, source: mainPath, syntheticDataOnly: true, notes: ['Linux Electron offscreen; real main/preload/renderer IPC', 'Native dialogs return isolated synthetic fixture paths', 'DOM clicks and real Electron Escape keyboard events; not Windows OS/touch/high-DPI acceptance', 'All data reset/read/write restricted to .qa-pets and artifacts/qa-pets; no real classroom source read'] };
    fs.writeFileSync(path.join(out, 'qa-pets-results.json'), JSON.stringify(result, null, 2));
    console.log('QA_PETS_FINISHED', checks.filter(c => c.status === 'passed').length, 'passed', checks.filter(c => c.status === 'failed').length, 'failed');
    app.exit(checks.some(c => c.status === 'failed') ? 1 : 0);
  } catch (error) { console.error('QA_PETS_FATAL', error.stack); app.exit(2); }
});
setTimeout(() => { console.error('QA_PETS_TIMEOUT'); app.exit(3); }, 150_000);

async function captureRetry(w){for(let attempt=0;attempt<3;attempt++){try{return await w.webContents.capturePage();}catch(error){if(!String(error.message).includes('UnknownVizError')||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,150));}}}
