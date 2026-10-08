'use strict';
const {ensureToolControl,visibleControl,nativeClick}=require('./qa-tool-control.cjs');
// v1.2 independent UI regression. `node scripts/qa-catalog.cjs` runs a real
// Electron process, closes it, and starts a second process to verify persistence.
// FLOWER_PACKAGE_MAIN targets the final app.asar/src/main.cjs without extraction.
// No real classroom files are used. Only .qa-catalog and artifacts/qa-catalog.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const electron = require('electron');
const root = path.resolve(__dirname, '..');
const variant = process.env.FLOWER_PACKAGE_MAIN ? 'packaged' : 'source';
const out = process.env.FLOWER_CATALOG_OUT ? path.resolve(process.env.FLOWER_CATALOG_OUT) : path.join(root, 'artifacts', 'qa-catalog', variant), data = path.join(root, '.qa-catalog', variant);
const CLASSIC = ['owl', 'fox', 'bunny', 'cat', 'penguin', 'panda', 'bear', 'dog', 'deer', 'squirrel', 'hedgehog', 'raccoon', 'koala', 'elephant', 'lion', 'tiger', 'dragon', 'unicorn', 'otter', 'seal'];
const ADVENTURE = ['robot','rover','mechcrab','mechbeetle','mechdragonfly','rex','raptor','triceratops','stegosaurus','ankylosaurus','pteranodon','mammoth','rhino','gorilla','wolf','boar','eagle','shark','orca','phoenix'];
const EXPECTED = [...CLASSIC,...ADVENTURE];
const clone = x => JSON.parse(JSON.stringify(x));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const noRevision = s => { const c = clone(s); delete c.revision; return c; };
function manifest(dir, prefix = '') { return Object.fromEntries(fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? Object.entries(manifest(path.join(dir, d.name), prefix + d.name + '/')) : [[prefix + d.name, sha(fs.readFileSync(path.join(dir, d.name)))]])); }

if (typeof electron === 'string') {
  fs.mkdirSync(out, { recursive: true });
  for (const f of ['suite-results.json', 'restart-results.json', 'qa-catalog-results.json']) fs.rmSync(path.join(out, f), { force: true });
  const args = process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [];
  let failed = false;
  for (const phase of ['suite', 'restart']) {
    const run = spawnSync(electron, [...args, __filename], { cwd: root, encoding: 'utf8', timeout: 240_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, FLOWER_CATALOG_PHASE: phase } });
    const log = (run.stdout || '') + (run.stderr || '');
    fs.writeFileSync(path.join(out, phase + '.log'), log);
    console.log(log.split('\n').filter(s => /^(PASS_CATALOG|FAIL_CATALOG|QA_CATALOG)/.test(s)).join('\n'));
    if (run.error) console.error(run.error);
    if (run.error || run.status !== 0) { failed = true; if (phase === 'suite') break; }
  }
  const all = ['suite', 'restart'].flatMap(phase => {
    const f = path.join(out, phase + '-results.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)).checks : [];
  });
  fs.writeFileSync(path.join(out, 'qa-catalog-results.json'), JSON.stringify({ variant, passed: all.filter(c => c.status === 'passed').length, failed: all.filter(c => c.status === 'failed').length, processFailure: failed, checks: all, syntheticDataOnly: true, actualProcessRestart: !failed, notes: ['Linux real Electron main/preload/renderer IPC; not Windows or physical touch acceptance', 'Native dialogs return paths of synthetic fixtures only', 'Source and packaged repetitions are the same scenarios and must not be counted twice'] }, null, 2));
  console.log('QA_CATALOG_COMPLETE', variant, all.filter(c => c.status === 'passed').length, 'passed', all.filter(c => c.status === 'failed').length, 'failed');
  process.exitCode = failed ? 1 : 0;
} else {
  runElectron(electron);
}

function runElectron({ app, BrowserWindow, dialog, session }) {
  const phase = process.env.FLOWER_CATALOG_PHASE || 'suite';
  const { legacyState, legacyJSON, SYNTHETIC_PNG } = require('../tests/pet-fixtures.cjs');
  const mainPath = process.env.FLOWER_PACKAGE_MAIN ? path.resolve(process.env.FLOWER_PACKAGE_MAIN) : path.join(root, 'src', 'main.cjs');
  const sourceDir = path.dirname(mainPath), sourceHash = manifest(sourceDir);
  const packageRoot = process.env.FLOWER_PACKAGE_MAIN && path.dirname(sourceDir).endsWith('.asar') ? path.dirname(sourceDir) : null;
  const resolvedPackageModules = [], externalPackageModules = [];
  if (packageRoot) {
    // Observe the real application module chain, not the QA harness dependencies.
    const Module = require('node:module'), originalResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, parent, ...rest) {
      const resolved = originalResolve.call(this, request, parent, ...rest);
      if (parent?.filename?.startsWith(packageRoot + path.sep)) {
        const record = { request, parent: parent.filename, resolved };
        resolvedPackageModules.push(record);
        if (path.isAbsolute(resolved) && !resolved.startsWith(packageRoot + path.sep)) externalPackageModules.push(record);
      }
      return resolved;
    };
  }
  const { validateState, petLevel } = require(path.join(sourceDir, 'core.cjs'));
  const Rules = require(path.join(sourceDir, 'score-rules.js')), Config = require(path.join(sourceDir, 'configuration-model.js'));
  const configured = (input, current) => { const value = validateState(input); if (!value.appConfig && current?.appConfig) value.appConfig = JSON.parse(JSON.stringify(current.appConfig)); if (!value.sharedScoreRules) Rules.confirmShared(value, Rules.previewShared(value).expectedKey); Config.apply(value, Config.snapshot(value)); return value; };
  const art = require(path.join(sourceDir, 'pet-art.js'));
  const baselineFiles = ['tests/core.test.cjs', 'tests/io.test.cjs', 'tests/qa-io.test.cjs', 'tests/pet.test.cjs', 'scripts/qa-electron.cjs', 'scripts/qa-pets.cjs'];
  const originalTestHash = Object.fromEntries(baselineFiles.map(f => [f, sha(fs.readFileSync(path.join(root, f)))]));
  fs.mkdirSync(out, { recursive: true });
  if (phase === 'suite') {
    // Fixed private fixture directory only. Never touch the application's normal userData.
    assert.equal(path.dirname(data), path.join(root, '.qa-catalog'));
    fs.rmSync(data, { recursive: true, force: true }); fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, 'classroom.json'), legacyJSON());
    for (const f of ['restart-results.json', 'expected-restart.json']) fs.rmSync(path.join(out, f), { force: true });
  }
  process.env.FLOWER_HEADLESS_TEST = '1'; process.env.FLOWER_DATA_DIR = data;
  app.disableHardwareAcceleration();
  let main, panel, pets, pet, openPath, savePath, fullCatalogState;
  const checks = [], requests = [], consoleErrors = [];
  dialog.showOpenDialog = async () => openPath ? { canceled: false, filePaths: [openPath] } : { canceled: true, filePaths: [] };
  dialog.showSaveDialog = async () => savePath ? { canceled: false, filePath: savePath } : { canceled: true };
  app.on('web-contents-created', (_e, wc) => wc.on('console-message', (event, level, message) => {
    const severity = event.level ?? level; if (severity === 'error' || severity >= 3) consoleErrors.push({ window: wc.id, message: event.message ?? message });
  }));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const js = (w, s) => w.webContents.executeJavaScript(s, true);
  const until = async (fn, label = 'condition') => { for (let i = 0; i < 180; i++) { if (await fn()) return; await sleep(40); } throw Error('Timed out: ' + label); };
  const state = (w = main) => js(w, 'classroom.get().then(x=>x.state)');
  const action = (a, w = main) => js(w, `classroom.action(${JSON.stringify(a)})`);
  const file = (a, w = main) => js(w, `classroom.file(${JSON.stringify(a)})`);
  const exists = (sel, w = main) => js(w, `!!document.querySelector(${JSON.stringify(sel)})`);
  const content = (sel = '#app', w = main) => js(w, `document.querySelector(${JSON.stringify(sel)})?.innerText||''`);
  const click=async(sel,w=main)=>{sel=await ensureToolControl(w,sel);let control;await until(async()=>{control=await visibleControl(w,sel);return control&&!control.disabled;},'settled visible enabled control '+sel);assert.ok(control&&!control.disabled,'Visible enabled control: '+sel);await nativeClick(w,control);};
  const fill = (sel, value, w = main) => js(w, `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('Missing input: '+${JSON.stringify(sel)});e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  const submit = (twice = false, w = main) => js(w, `(()=>{const f=document.querySelector('#student-form');if(!f)throw Error('Missing form');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));${twice ? "f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));" : ''}return true;})()`);
  const checkedPet = (w = main) => js(w, `document.querySelector('#student-form [name=pet]:checked')?.value`);
  const visibleChoiceIds = () => js(main, `[...document.querySelectorAll('#student-form .pet-choice')].filter(e=>!e.hidden).map(e=>e.dataset.pet)`);
  const catalogIds = (w = main) => js(w, `[...document.querySelectorAll('#modal .catalog-card')].map(e=>e.dataset.catalogPet)`);
  const disk = () => fs.readFileSync(activeDataFile(data), 'utf8');
  const key = async (keyCode, w = main) => { w.webContents.sendInputEvent({ type: 'keyDown', keyCode }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode }); await sleep(80); };
  async function ready(w) { await until(() => js(w, '!!window.classroom&&!!document.querySelector("#app")?.innerText.trim()').catch(() => false), 'renderer ready'); await sleep(80); assert.equal(await exists('.fatal', w), false); }
  async function shot(name, w = main) { await sleep(100); fs.writeFileSync(path.join(out, name + '.png'), (await captureRetry(w)).toPNG()); }
  async function check(name, fn) { try { const detail = await fn(); checks.push({ name, status: 'passed', detail }); console.log('PASS_CATALOG', name, detail ?? ''); } catch (error) { checks.push({ name, status: 'failed', error: error.stack }); console.error('FAIL_CATALOG', name, error.message); try { await shot('failure-' + checks.length); } catch {} } }
  async function close(w = main) { if (await exists('#modal .dialog', w)) await click('#modal [data-do="modal-close"]', w); }
  async function clearFeedback(w = main) { if (await exists('[data-do="pet-feedback-close"]', w)) await click('[data-do="pet-feedback-close"]', w); }
  async function go(page = 'pets') { await close(); await click(`[data-page="${page}"]`); }
  const applyRestorePreview = incoming => file({command:'restore-apply',state:incoming,restoreToken:incoming.restoreToken,expectedRevision:incoming.expectedRevision});
  let fixtureNumber = 0;
  async function restore(s = legacyState()) {
    await close(); const before=await state(),previousPath=openPath,fixturePath=path.join(out,'restore-fixture-'+(++fixtureNumber)+'.json'),bytes=JSON.stringify(s);fs.writeFileSync(fixturePath,bytes);openPath=fixturePath;
    try {
      const preview=await file({command:'restore-preview'});assert.deepEqual(validateState(preview),validateState(s));assert.equal(typeof preview.restoreToken,'string');assert.equal(preview.expectedRevision,before.revision);assert.ok(preview.restoreConfiguration);assert.deepEqual(await state(),before);
      await applyRestorePreview(preview);assert.deepEqual(noRevision(await state()),noRevision(configured(s,before)));assert.equal(fs.readFileSync(fixturePath,'utf8'),bytes);
    } finally {openPath=previousPath;}
    await sleep(80);await clearFeedback();
  }
  async function detail(id) { await go(); await click(`[data-do="pet-detail"][data-id="${id}"]`); }
  async function edit(id) { await detail(id); await click(`[data-do="edit-student"][data-id="${id}"]`); }
  async function open(role) { await js(main, `classroom.window({command:'open',role:${JSON.stringify(role)}})`); const w = BrowserWindow.getAllWindows().find(w => w.flowerRole === role); assert.ok(w); await ready(w); return w; }
  const v11 = () => ({ ...legacyState(), settings: { className: '纯合成1.1兼容班', petStep: 5, petFocusId: 's_legacy_bunny' } });
  function catalogFixture(count = EXPECTED.length, growth = 4) {
    const s = v11(); s.students = Array.from({ length: count }, (_, i) => ({ id: 's_catalog_' + i, name: '纯合成伙伴' + String(i + 1).padStart(3, '0'), group: '纯合成组' + (i % 10), score: growth, growth, pet: EXPECTED[i % EXPECTED.length], photo: i === 0 ? SYNTHETIC_PNG : '' }));
    s.logs = []; s.draw = { mode: 'cycle', bag: [], lastIds: [], round: 0 }; s.settings.petFocusId = s.students.at(-1).id; return s;
  }
  require(mainPath);
  app.whenReady().then(async () => {
    try {
      session.defaultSession.webRequest.onCompleted(d => requests.push(d.url));
      await until(() => BrowserWindow.getAllWindows().some(w => w.flowerRole === 'main'));
      main = BrowserWindow.getAllWindows().find(w => w.flowerRole === 'main'); await ready(main); main.setSize(1440, 1000);
      if (phase === 'restart') {
        await check('A completely new Electron process reloads all forty UI-selected species, photos, rules and history exactly', async () => {
          const expected = JSON.parse(fs.readFileSync(path.join(out, 'expected-restart.json'))), loaded = await js(main, 'classroom.get()');
          assert.equal(loaded.warning, ''); assert.deepEqual(loaded.state, expected); assert.equal(loaded.state.version, 2);
          assert.deepEqual(loaded.state.students.map(s => s.pet), EXPECTED); assert.equal(new Set(loaded.state.students.map(s => s.pet)).size, EXPECTED.length);
          assert.equal(disk(), JSON.stringify(expected)); await go(); assert.equal(await js(main, 'document.querySelectorAll("[data-do=pet-detail]").length'), EXPECTED.length);
          for (const s of expected.students) { await edit(s.id); assert.equal(await checkedPet(), s.pet); await close(); }
          await shot('15-restarted-all-forty');
        });
      } else {
        await check('Raw handwritten v1.0 retains exact legacy bytes and four pets alongside the declared v2 configuration cache', async () => {
          const loaded = await js(main, 'classroom.get()'); assert.equal(loaded.warning, ''); assert.deepEqual(loaded.state, configured(legacyState())); assert.equal(loaded.workbookWarning, ''); assert.equal(fs.readFileSync(path.join(data,'classroom.json'),'utf8'), legacyJSON()); assert.deepEqual(JSON.parse(disk()), loaded.state);
          assert.deepEqual(loaded.state.students, validateState(legacyState()).students); assert.deepEqual(loaded.state.logs, legacyState().logs);
          const backups=(await file({command:'folder-info'})).backup; assert.ok(fs.readdirSync(backups).filter(n=>n.startsWith('before-v2-migration')).some(n=>fs.readFileSync(path.join(backups,n),'utf8')===legacyJSON()));
          assert.equal(await js(main, 'typeof require'), 'undefined'); assert.equal(await js(main, 'typeof process'), 'undefined');
          assert.deepEqual(Object.keys(art.names), EXPECTED);
        });
        await check('Student form has forty named visual radio choices, one selection and no long pet dropdown', async () => {
          await go('students'); await click('[data-do="add-student"]');
          assert.equal(await js(main, 'document.querySelectorAll("#student-form .pet-choice").length'), EXPECTED.length);
          assert.equal(await js(main, 'document.querySelectorAll("#student-form input[type=radio][name=pet]").length'), EXPECTED.length);
          assert.equal(await js(main, 'document.querySelectorAll("#student-form [name=pet]:checked").length'), 1);
          assert.equal(await exists('#student-form select[name=pet]'), false); assert.equal(await checkedPet(), 'owl');
          const cards = await js(main, `[...document.querySelectorAll('#student-form .pet-choice')].map(e=>({id:e.dataset.pet,label:e.querySelector('input').getAttribute('aria-label'),svg:!!e.querySelector('svg')}))`);
          assert.deepEqual(cards.map(c => c.id), EXPECTED); assert.ok(cards.every(c => c.svg && c.label === art.names[c.id])); await shot('01-forty-choices'); await close();
        });
        await check('Chooser Chinese, English, uppercase, whitespace and zero-result searches keep selection and data intact', async () => {
          await edit('s_legacy_owl'); const before = await state();
          for (const [query, id] of [['企鹅', 'penguin'], ['dragon', 'dragon'], [' UNICORN ', 'unicorn'], ['海豹', 'seal']]) { await fill('#pet-choice-search', query); assert.deepEqual(await visibleChoiceIds(), [id]); }
          await click('.pet-choice[data-pet="seal"]'); assert.equal(await checkedPet(), 'seal');
          await fill('#pet-choice-search', 'NO_MATCH_纯合成'); assert.deepEqual(await visibleChoiceIds(), []); assert.match(await content('#pet-choice-count'), /0\s*\/\s*40/);
          assert.equal(await js(main, 'document.querySelector("#pet-choice-empty").hidden'), false); assert.equal(await checkedPet(), 'seal');
          await fill('#pet-choice-search', ''); assert.deepEqual(await visibleChoiceIds(), EXPECTED); assert.equal(await checkedPet(), 'seal');
          assert.match(await content('#pet-choice-summary'), new RegExp(art.names.seal)); assert.deepEqual(await state(), before); await shot('02-search-selection'); await close(); assert.deepEqual(await state(), before);
        });
        await check('Chooser family filters partition classic/adventure forty choices, intersect search and preserve selection without saving', async () => {
          await edit('s_legacy_owl'); const before=await state(),bytes=disk();
          for(const [family,ids] of [['classic',CLASSIC],['adventure',ADVENTURE],['all',EXPECTED]]){
            await click('[data-do=pet-choice-family][data-family='+family+']');assert.deepEqual(await visibleChoiceIds(),ids);
            assert.equal(await js(main,`document.querySelector('[data-do=pet-choice-family][data-family="${family}"]').getAttribute('aria-pressed')`),'true');
            assert.equal(await checkedPet(),'owl');
          }
          await fill('#pet-choice-search','恐龙');const dinosaurs=['rex','raptor','triceratops','stegosaurus','ankylosaurus','pteranodon'];assert.deepEqual(await visibleChoiceIds(),dinosaurs);
          await click('[data-do=pet-choice-family][data-family=classic]');assert.deepEqual(await visibleChoiceIds(),[]);
          await click('[data-do=pet-choice-family][data-family=adventure]');assert.deepEqual(await visibleChoiceIds(),dinosaurs);await shot('02b-adventure-dinosaur-filter');
          await fill('#pet-choice-search','dragon');assert.deepEqual(await visibleChoiceIds(),[]);
          await click('[data-do=pet-choice-family][data-family=all]');assert.deepEqual(await visibleChoiceIds(),['dragon']);
          await close();assert.deepEqual(await state(),before);assert.equal(disk(),bytes);return {all:40,classic:20,adventure:20,dinosaurIds:dinosaurs,exactDragon:['dragon']};
        });
        await check('Random choice only previews; cancel and Escape release modal focus without writing a student', async () => {
          await edit('s_legacy_owl'); const before = await state(), bytes = disk();
          for(const [family,ids] of [['all',EXPECTED],['classic',CLASSIC],['adventure',ADVENTURE]]){
            await click('[data-do=pet-choice-family][data-family='+family+']');await fill('#pet-choice-search','NO_MATCH_纯合成');
            for(let i=0;i<30;i++){await click('[data-do="pet-choice-random"]');assert.ok(ids.includes(await checkedPet()),family+' random stays in family');assert.equal(await js(main,'document.querySelectorAll("#student-form [name=pet]:checked").length'),1);assert.equal(await js(main,'document.querySelector("#pet-choice-search").value'),'');}
            assert.deepEqual(await visibleChoiceIds(),ids);
          }
          await shot('02c-adventure-random-preview');
          assert.deepEqual(await state(), before); await close(); assert.equal(disk(), bytes);
          await edit('s_legacy_owl'); await click('.pet-choice[data-pet="dragon"]'); await key('Escape');
          assert.equal(await exists('#modal .dialog'), false); assert.equal(await js(main, 'document.querySelector("#app").inert'), false); assert.deepEqual(await state(), before); assert.equal(disk(), bytes);
          await edit('s_legacy_owl'); assert.equal(await checkedPet(), 'owl'); await close();
        });
        await check('Enter in the chooser search cannot submit; keyboard Tab stays in the modal and Escape releases it', async () => {
          await go('students'); await click('[data-do="add-student"]'); await fill('#student-form [name=name]', '纯合成回车保护'); await fill('#pet-choice-search', 'penguin');
          const before = await state(); await js(main, 'document.querySelector("#pet-choice-search").focus()'); await key('Enter'); assert.deepEqual(await state(), before); assert.ok(await exists('#student-form'));
          await js(main, 'document.querySelector("#student-form [type=submit]").focus()'); await key('Tab'); assert.equal(await js(main, 'document.activeElement===document.querySelector("#modal button")'), true);
          await key('Escape'); assert.equal(await js(main, 'document.querySelector("#app").inert'), false);
        });
        await check('All forty choices save through normal UI submit and reopen checked; repeated submit adds only one student', async () => {
          await file({ command: 'blank' }); await go('students');
          for (const [i, id] of EXPECTED.entries()) {
            await click('[data-do="add-student"]'); await fill('#student-form [name=name]', '纯合成已选' + id); await fill('#student-form [name=group]', '合成全部伙伴'); await click(`.pet-choice[data-pet="${id}"]`);await until(async()=>await checkedPet()===id,'native choice selected '+id);
            const before = await state(); await submit(true); await until(async () => (await state()).students.length === i + 1); await sleep(30);
            const saved = await state(); assert.equal(saved.revision, before.revision + 1); assert.equal(saved.students.at(-1).pet, id);
            await edit(saved.students.at(-1).id); assert.equal(await checkedPet(), id); await close(); await go('students');
          }
          fullCatalogState = await state(); assert.deepEqual(fullCatalogState.students.map(s => s.pet), EXPECTED); assert.deepEqual(validateState(JSON.parse(disk())), fullCatalogState); await shot('03-all-forty-saved');
        });
        await check('Changing a legacy student through every choice retains photos, full growth, scores and old records', async () => {
          await restore(v11()); const original = await state(), student = original.students[0];
          for (const id of EXPECTED) {
            await edit(student.id); await click(`.pet-choice[data-pet="${id}"]`); const revision = (await state()).revision; await submit(true); await until(async () => (await state()).revision === revision + 1);
            const after = await state(); assert.deepEqual(after.students[0], { ...student, pet: id }); assert.deepEqual(after.students.slice(1), original.students.slice(1));
            for (const key of ['logs', 'settings', 'timer', 'draw']) assert.deepEqual(after[key], original[key]);
          }
        });
        await check('Read-only catalog displays all forty species at stages 1, 4 and 7 without changing data', async () => {
          await go(); const before = await state(); await click('[data-do="pet-catalog"]'); await sleep(3500);
          for (const level of [1, 4, 7]) { await click(`[data-do="catalog-stage"][data-level="${level}"]`); assert.deepEqual(await catalogIds(), EXPECTED); assert.equal(await js(main, `document.querySelectorAll('#catalog-grid .catalog-card svg[data-stage="${level}"]').length`), EXPECTED.length); assert.match(await content('#catalog-count'), /40/); await shot('04-catalog-stage-' + level); }
          assert.deepEqual(await state(), before); await close();
        });
        await check('Catalog search handles Chinese/English/no match and keeps filtering across stage changes', async () => {
          await go(); const before = await state(); await click('[data-do="pet-catalog"]');
          for (const [query, id] of [['企鹅', 'penguin'], [' DRAGON ', 'dragon'], ['海豹', 'seal']]) { await fill('#pet-catalog-search', query); assert.deepEqual(await catalogIds(), [id]); await click('[data-do="catalog-stage"][data-level="7"]'); assert.deepEqual(await catalogIds(), [id]); }
          await fill('#pet-catalog-search', 'NO_MATCH_纯合成'); assert.deepEqual(await catalogIds(), []); assert.match(await content('#catalog-count'), /0/); assert.match(await content('#modal'), /没有|未找到/); await shot('05-catalog-no-results');
          await fill('#pet-catalog-search', ''); assert.deepEqual(await catalogIds(), EXPECTED); await key('Escape'); assert.equal(await exists('#modal .dialog'), false); assert.equal(await js(main, 'document.querySelector("#app").inert'), false); assert.deepEqual(await state(), before);
        });
        await check('Catalog family filters and stage changes retain exact search intersection for all forty species', async () => {
          await go();const before=await state();await click('[data-do=pet-catalog]');
          for(const [family,ids] of [['classic',CLASSIC],['adventure',ADVENTURE],['all',EXPECTED]]){
            await click('[data-do=catalog-family][data-family='+family+']');assert.deepEqual(await catalogIds(),ids);
            await click('[data-do=catalog-stage][data-level="7"]');assert.deepEqual(await catalogIds(),ids);
            assert.equal(await js(main,`document.querySelectorAll('#catalog-grid svg[data-stage="7"]').length`),ids.length);
          }
          await fill('#pet-catalog-search','恐龙');const dinosaurs=['rex','raptor','triceratops','stegosaurus','ankylosaurus','pteranodon'];assert.deepEqual(await catalogIds(),dinosaurs);
          await click('[data-do=catalog-family][data-family=adventure]');await click('[data-do=catalog-stage][data-level="1"]');assert.deepEqual(await catalogIds(),dinosaurs);await shot('05b-dinosaurs-family-stage1');
          await click('[data-do=catalog-family][data-family=classic]');assert.deepEqual(await catalogIds(),[]);
          await fill('#pet-catalog-search',' DRAGON ');assert.deepEqual(await catalogIds(),['dragon']);
          await click('[data-do=catalog-family][data-family=adventure]');assert.deepEqual(await catalogIds(),[]);
          await click('[data-do=catalog-family][data-family=all]');assert.deepEqual(await catalogIds(),['dragon']);
          await fill('#pet-catalog-search','');assert.deepEqual(await catalogIds(),EXPECTED);await close();assert.deepEqual(await state(),before);
          return {all:40,classic:20,adventure:20,dinosaurIds:dinosaurs,stages:[1,7],exactDragon:['dragon']};
        });
        await check('Every species exposes all seven album forms and previewing all 280 never awards growth', async () => {
          await restore(catalogFixture()); const before = await state();
          for (const student of before.students) {
            await detail(student.id); await click(`[data-do="pet-album"][data-id="${student.id}"]`); assert.equal(await js(main, 'document.querySelectorAll("#modal .album-tile[data-do=pet-preview]").length'), 8);
            assert.equal(await js(main, 'document.querySelectorAll("#modal .album-tile[data-level=\\"0\\"] svg.pet-egg[data-pet-stage=egg]").length'), 1);
            await click('.album-tile[data-do="pet-preview"][data-level="0"]'); assert.ok(await exists('#album-preview svg.pet-egg[data-pet-stage=egg]'));
            for (let level = 1; level <= 7; level++) { await click(`.album-tile[data-do="pet-preview"][data-level="${level}"]`); await until(()=>js(main, `document.querySelector('#album-preview svg')?.dataset.stage===${JSON.stringify(String(level))}`),`album stage ${level}`); assert.equal(await js(main, `document.querySelector('#album-preview svg').dataset.stage`), String(level)); }
            await close();
          }
          assert.deepEqual(await state(), before); await shot('06-final-new-species-detail');
        });
        await check('Both handwritten v1.0 and v1.1 backups restore exact old pets, fields and correct rule defaults', async () => {
          for (const [name, input] of [['v1.0', legacyState()], ['v1.1', v11()]]) {
            openPath = path.join(out, 'synthetic-' + name + '.json'); fs.writeFileSync(openPath, JSON.stringify(input)); const incoming = await file({ command: 'restore-preview' }); assert.deepEqual(validateState(incoming), validateState(input));
            const prior=await state();await applyRestorePreview(incoming); assert.deepEqual(noRevision(await state()), noRevision(configured(input,prior))); assert.equal(await content('#pet-feedback'), '');
          }
          openPath = null; const before = await state(); assert.equal(await file({ command: 'restore-preview' }), null); assert.deepEqual(await state(), before);
        });
        await check('Pre-adventure twenty-species backup restores exact classic IDs, fields, photographs and old rules', async () => {
          const old=catalogFixture(CLASSIC.length);assert.deepEqual(old.students.map(s=>s.pet),CLASSIC);
          openPath=path.join(out,'synthetic-classic-twenty-backup.json');fs.writeFileSync(openPath,JSON.stringify(old));
          const bytes=fs.readFileSync(openPath),before=await state(),preview=await file({command:'restore-preview'});assert.deepEqual(validateState(preview),validateState(old));assert.deepEqual(await state(),before);
          await applyRestorePreview(preview);assert.deepEqual(noRevision(await state()),noRevision(configured(old,before)));assert.deepEqual(fs.readFileSync(openPath),bytes);
          assert.deepEqual((await state()).students.map(s=>s.pet),CLASSIC);openPath=null;return {originalSpecies:20,sourceBackupUnchanged:true};
        });
        await check('Native backup/restore round-trip all new species, synthetic photo, focus, scores, history and protected version=2', async () => {
          await restore(catalogFixture()); await action({ type: 'score', ids: (await state()).students.map(s => s.id), delta: 2, reason: '纯合成备份积分' }); await clearFeedback();
          const before = await state(); savePath = path.join(out, 'synthetic-forty-backup.json'); assert.equal(await file({ command: 'backup' }), true); assert.deepEqual(JSON.parse(fs.readFileSync(savePath)), before);
          await action({ type: 'student.update', id: before.students.at(-1).id, pet: 'owl' }); await action({type:'petProgression.update',petProgression:{...before.petProgression,repeatCost:100}});
          openPath = savePath; const incoming = await file({ command: 'restore-preview' }); assert.deepEqual(validateState(incoming), before); await applyRestorePreview(incoming);
          assert.deepEqual(noRevision(await state()), noRevision(before)); assert.equal((await state()).version, 2); assert.equal(await content('#pet-feedback'), '');
          const restored=await state();await action({type:'petProgression.update',petProgression:{...restored.petProgression,repeatCost:99}});assert.deepEqual((await state()).students,restored.students);assert.deepEqual((await state()).logs,restored.logs); openPath = null; savePath = null;
        });
        await check('Unknown species rejects in IPC add/update/backup restore without altering live data, disk or recovery files', async () => {
          const before = await state(), bytes = disk(), backups = (await file({ command: 'folder-info' })).backup;
          const jsonFiles = () => Object.fromEntries([data, backups].map(directory => [directory, Object.fromEntries(fs.readdirSync(directory).filter(n => n.endsWith('.json')).sort().map(name => [name, sha(fs.readFileSync(path.join(directory, name)))]))]));
          const files = jsonFiles();
          for (const bad of ['unknown-pet', '__proto__', 'constructor', '<img src=x onerror=alert(1)>']) {
            await assert.rejects(action({ type: 'student.update', id: before.students[0].id, pet: bad }));
            await assert.rejects(action({ type: 'student.add', name: '纯合成非法宠物', group: '合成组', pet: bad }));
            const invalid = clone(before); invalid.students.at(-1).pet = bad; await assert.rejects(file({ command: 'restore-apply', state: invalid }));
            openPath = path.join(out, 'synthetic-invalid-pet.json'); fs.writeFileSync(openPath, JSON.stringify(invalid)); await assert.rejects(file({ command: 'restore-preview' }));
          }
          openPath = null; assert.deepEqual(await state(), before); assert.equal(disk(), bytes); assert.deepEqual(jsonFiles(), files);
        });
        await check('A tampered radio value cannot overwrite a student, and the same form can recover and save a valid choice', async () => {
          const before = await state(), target = before.students[0]; await edit(target.id);
          await js(main, `document.querySelector('#student-form [name=pet]:checked').value='unknown-pet';true`); await submit(); await sleep(100);
          assert.deepEqual(await state(), before); assert.ok(await exists('#student-form')); assert.equal(await js(main, 'document.querySelector("#student-form [type=submit]").disabled'), false);
          await click('.pet-choice[data-pet="unicorn"]'); await submit(true); await until(async () => (await state()).revision === before.revision + 1); assert.deepEqual((await state()).students[0], { ...target, pet: 'unicorn' });
        });
        await check('Forty-species UI batch award creates one upgrade transaction and repeated click cannot double-award', async () => {
          await restore(catalogFixture()); await go(); const before = await state(); await click('[data-do="select-all"]'); assert.equal(await js(main, 'document.querySelectorAll(".pet-select.checked").length'), EXPECTED.length);
          await click('.pet-batch-bar [data-do="pet-reward"]'); await js(main, `(()=>{const b=document.querySelector('#modal [data-do="pet-reason"][data-index="0"]');b.click();b.click();return true;})()`);
          await until(async () => (await state()).revision === before.revision + 1); await sleep(100); const after = await state(); assert.equal(after.logs.length, 1); assert.equal(after.logs[0].changes.length, EXPECTED.length);
          for (const s of after.students) { assert.equal(s.score, 5); assert.equal(s.growth, 4); assert.equal(petLevel(s,after.petProgression).level, 1); }
          assert.equal(await js(main, 'document.querySelector("#pet-feedback h2").textContent'), '每位伙伴的成长都已同步');assert.equal(await js(main, 'document.querySelectorAll("#pet-feedback [data-feedback-direction=hatch] [data-feedback-student]").length'),40);assert.deepEqual(await js(main, 'state.students.map(s=>{const p=PetProgress.profile(state,s);return [p.pet,p.level,p.growth,p.isEgg];})'), EXPECTED.map(pet=>[pet,1,5,false]));assert.equal(await js(main, 'document.querySelectorAll(".pet-student-card .pet-scene svg[data-pet]").length'), EXPECTED.length); await sleep(500); await shot('07-all-species-upgrade');
        });
        await check('UI undo of the batch restores all forty pets and their levels with explicit rollback feedback', async () => {
          const before = await state(), log = before.logs.at(-1); await clearFeedback(); await click('[data-page="logs"]'); await click(`[data-do="undo"][data-id="${log.id}"]`); await until(async () => (await state()).logs.at(-1).undone);
          const after = await state(); assert.ok(after.students.every(s => s.growth === 4 && s.score === 4 && petLevel(s,after.petProgression).level === 0)); assert.deepEqual(after.students.map(s => s.pet), EXPECTED); assert.match(await content('#toast') + await content('#pet-feedback'), /撤销|回退|恢复/);
        });
        await check('Four real windows render all forty species and concurrent actions converge without lost updates', async () => {
          await restore(catalogFixture()); panel = await open('panel'); pets = await open('pets'); pet = await open('pet'); pets.setSize(1280, 840); const before = await state();
          const windows = [main, panel, pet, pets]; await Promise.all(EXPECTED.map((_, i) => action({ type: 'score', ids: [before.students[i].id], delta: 1, reason: '纯合成多物种并发' }, windows[i % 4])));
          const after = await state(); assert.equal(after.revision, before.revision + EXPECTED.length); assert.equal(after.logs.length, EXPECTED.length); assert.ok(after.students.every(s => s.score === 5 && s.growth === 4));
          for (const w of windows) assert.deepEqual(await state(w), after); assert.equal(await js(pets, 'document.querySelectorAll("[data-do=pet-detail]").length'), EXPECTED.length); assert.equal(await js(pet, 'document.querySelectorAll(".pet-student-card").length'), EXPECTED.length); await clearFeedback(pets); await shot('08-all-species-classroom', pets);
        });
        await check('An open unsaved chooser keeps its selection while another window changes current score; save retains concurrent points', async () => {
          const target = (await state()).students[0]; await edit(target.id); await fill('#student-form [name=name]', '纯合成并发编辑'); await fill('#pet-choice-search', 'dragon'); await click('.pet-choice[data-pet="dragon"]');
          await action({ type: 'score', ids: [target.id], delta: 2, reason: '纯合成编辑期间加分' }, panel); assert.equal(await checkedPet(), 'dragon'); assert.equal(await js(main, 'document.querySelector("#student-form [name=name]").value'), '纯合成并发编辑');
          await submit(); await until(async () => (await state()).students[0].pet === 'dragon'); const after = (await state()).students[0]; assert.equal(after.score, target.score + 2); assert.equal(after.growth, target.growth); assert.equal(after.name, '纯合成并发编辑'); assert.equal(after.photo, target.photo);
        });
        await check('The catalog stays read-only while other windows change points and its close never rolls back newer data', async () => {
          await go(); await click('[data-do="pet-catalog"]'); await fill('#pet-catalog-search', 'unicorn'); const before = await state(); await action({ type: 'score', ids: [before.students[0].id], delta: 1, reason: '纯合成图鉴期间加分' }, pet);
          assert.deepEqual(await catalogIds(), ['unicorn']); await click('[data-do="catalog-stage"][data-level="7"]'); await close(); assert.equal((await state()).revision, before.revision + 1); assert.equal((await state()).students[0].score, before.students[0].score + 1);
        });
        await check('A 300-student class distributes all forty species, batch upgrades and undo without slowdowns or overflow', async () => {
          const start = Date.now(); await restore(catalogFixture(300)); await go(); assert.equal(await js(main, 'document.querySelectorAll("[data-do=pet-detail]").length'), 300); assert.equal(await js(pets, 'document.querySelectorAll("[data-do=pet-detail]").length'), 300);
          const before = await state(); await action({ type: 'score', ids: before.students.map(s => s.id), delta: 1, reason: '纯合成300人全物种升级' }, panel); const after = await state(); assert.equal(after.logs.at(-1).changes.length, 300); assert.ok(after.students.every(s => s.score === 5 && s.growth === 4)); assert.equal(new Set(after.students.map(s => s.pet)).size, EXPECTED.length);
          await clearFeedback(); await shot('09-300-mixed-species'); await action({ type: 'undo', logId: after.logs.at(-1).id }, panel); assert.deepEqual((await state()).students, before.students); assert.equal(await js(main, 'document.documentElement.scrollWidth<=innerWidth'), true);
          assert.ok(Date.now() - start < 15_000, '300 mixed-species award/render/undo exceeds 15 seconds'); return Date.now() - start + ' ms including screenshot';
        });
        await check('Minimum main/classroom/floating windows keep catalog, chooser, long names and final card reachable', async () => {
          await restore(catalogFixture()); await action({ type: 'settings', className: 'C'.repeat(80) }); await action({ type: 'student.update', id: 's_catalog_0', name: 'W'.repeat(40), group: 'G'.repeat(40) }); main.setSize(900, 640); pets.setSize(700, 580); pet.setSize(300, 560);
          const sizes = [];
          for (const w of [main, pets, pet]) { sizes.push({ role: w.flowerRole, ...await js(w, '({width:innerWidth,scroll:document.documentElement.scrollWidth})') }); assert.equal(await js(w, 'document.documentElement.scrollWidth<=innerWidth'), true); }
          await go(); await click('[data-do="pet-catalog"]'); await sleep(3500); assert.equal(await js(main, 'document.documentElement.scrollWidth<=innerWidth'), true); await js(main, `document.querySelector('.catalog-card[data-catalog-pet="phoenix"]').scrollIntoView({block:'center'});true`); await sleep(100);
          assert.equal(await js(main, `(()=>{const e=document.querySelector('.catalog-card[data-catalog-pet="phoenix"]'),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`), true); await shot('10-narrow-catalog-last'); await close();
          await edit('s_catalog_0'); await sleep(100); await fill('#pet-choice-search', 'seal'); await click('.pet-choice[data-pet="seal"]'); await js(main, `document.querySelector('#student-form [type=submit]').scrollIntoView({block:'center'});true`); await sleep(100); assert.equal(await js(main, 'document.documentElement.scrollWidth<=innerWidth'), true);
          assert.equal(await js(main, `(()=>{const e=document.querySelector('#student-form [type=submit]'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`), true); await shot('11-narrow-choice-save'); await close();
          await click('[data-do="pet-catalog"]', pets); await sleep(100); assert.equal(await js(pets, 'document.documentElement.scrollWidth<=innerWidth'), true); await shot('12-narrow-classroom-catalog', pets);
          const searchHeight = await js(pets, 'document.querySelector("#pet-catalog-search").getBoundingClientRect().height'); assert.ok(searchHeight >= 40, 'Narrow catalog search collapsed to ' + searchHeight + 'px'); await close(pets);
          main.setSize(1440, 1000); pets.setSize(1280, 840); return sizes;
        });
        await check('Malicious search strings stay plain text and every new SVG is free of executable or remote nodes', async () => {
          await go('students'); await click('[data-do="add-student"]'); const before = await state(); await fill('#pet-choice-search', '<img src=x onerror=alert(1)>');
          assert.deepEqual(await visibleChoiceIds(), []); assert.equal(await js(main, 'document.querySelectorAll("#modal script,#modal img,#modal [onerror],#modal [onload]").length'), 0); await close();
          await go(); await click('[data-do="pet-catalog"]'); await fill('#pet-catalog-search', '"><svg onload=alert(1)>'); assert.deepEqual(await catalogIds(), []); assert.equal(await js(main, 'document.querySelectorAll("#modal script,#modal [onerror],#modal [onload]").length'), 0); await close();
          for (const id of EXPECTED) for (let level = 1; level <= 7; level++) assert.doesNotMatch(art.render(id, level), /<script|<image|<foreignObject|\s(?:href|src|id|on[a-z]+)=|url\(/i);
          const parsed = await js(main, `(()=>{const markup=PetArt.render('dragon',1,{className:'\"><img src=x onerror=alert(1)>'});const doc=new DOMParser().parseFromString(markup,'image/svg+xml');return {bad:doc.querySelectorAll('parsererror,img,script,[onerror],[onload]').length,root:doc.documentElement.tagName};})()`); assert.deepEqual(parsed, { bad: 0, root: 'svg' });
          assert.deepEqual(await state(), before);
        });
        await check('Final save for process restart preserves the forty choices originally selected through UI', async () => {
          assert.ok(fullCatalogState); await restore(fullCatalogState); await action({ type: 'student.update', id: fullCatalogState.students[0].id, photo: SYNTHETIC_PNG }); await action({ type: 'pet.focus', id: fullCatalogState.students.at(-1).id }); await action({ type: 'score', ids: fullCatalogState.students.map(s => s.id), delta: 6, reason: '纯合成重启保存' });
          const saved = await state(); assert.deepEqual(saved.students.map(s => s.pet), EXPECTED); fs.writeFileSync(path.join(out, 'expected-restart.json'), JSON.stringify(saved)); assert.deepEqual(JSON.parse(disk()), saved); await clearFeedback();
        });
      }
      await check('No remote renderer requests, console errors, tested source mutations or original-test edits occur during this run', async () => {
        assert.deepEqual(requests.filter(u => !u.startsWith('file:') && !u.startsWith('data:')), []); assert.deepEqual(consoleErrors, []);
        assert.deepEqual(manifest(sourceDir), sourceHash, 'Implementation changed while QA ran; rerun final code');
        assert.deepEqual(Object.fromEntries(baselineFiles.map(f => [f, sha(fs.readFileSync(path.join(root, f)))])), originalTestHash);
        if (packageRoot) { assert.ok(resolvedPackageModules.length > 0); assert.deepEqual(externalPackageModules, [], 'Packaged application borrowed an external dependency'); fs.writeFileSync(path.join(out, phase + '-package-module-resolution.json'), JSON.stringify({ packageRoot, resolvedPackageModules, externalPackageModules }, null, 2)); }
        fs.writeFileSync(path.join(out, 'tested-source-sha256.json'), JSON.stringify(sourceHash, null, 2)); fs.writeFileSync(path.join(out, 'tested-original-tests-sha256.json'), JSON.stringify(originalTestHash, null, 2));
        return { rendererRequests: requests.length, sourceFiles: Object.keys(sourceHash).length, ...(packageRoot ? { packageModulesResolved: resolvedPackageModules.length, externalPackageModules: externalPackageModules.length } : {}) };
      });
      fs.writeFileSync(path.join(out, phase + '-results.json'), JSON.stringify({ phase, source: mainPath, checks, consoleErrors, requests, syntheticDataOnly: true }, null, 2));
      console.log('QA_CATALOG_PHASE', phase, checks.filter(c => c.status === 'passed').length, 'passed', checks.filter(c => c.status === 'failed').length, 'failed'); app.exit(checks.some(c => c.status === 'failed') ? 1 : 0);
    } catch (error) { console.error('QA_CATALOG_FATAL', error.stack); app.exit(2); }
  });
  setTimeout(() => { console.error('QA_CATALOG_TIMEOUT'); app.exit(3); }, 210_000);
}

async function captureRetry(w){for(let attempt=0;attempt<3;attempt++){try{return await w.webContents.capturePage();}catch(error){if(!String(error.message).includes('UnknownVizError')||attempt===2)throw error;await new Promise(resolve=>setTimeout(resolve,150));}}}

function activeDataFile(directory){const modern=path.join(directory,'classroom-v2.json');return fs.existsSync(modern)?modern:path.join(directory,'classroom.json');}
