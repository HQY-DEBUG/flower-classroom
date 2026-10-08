'use strict';
const qaChild=require('./qa-feature-child.cjs');
const expectedCaseNames=["A delayed refresh from a closed chooser cannot overwrite the newly opened student preview","An unavailable real avatar directory reports failure at its original path without opening a fallback","Avatar interactions produce no renderer errors","Closed quick chooser ignores a delayed open failure after a newer student dialog replaces it","Explicit refresh sees add/remove files while the selected snapshot and full backup stay intact","Folder controls, path and close remain usable at 1024x640 / 150%","Folder controls, path and close remain usable at 1280x720 / 125%","Folder controls, path and close remain usable at 900x640 / 100%","Folder controls, path and close remain usable at 900x640 / 200%","Full student editor keeps edited text and keyboard focus, and Enter on the path cannot submit","OS open failures and exceptions remain visible without a false success notification","Quick chooser exposes the same path above search and saves an embedded selected snapshot","Restore invalidates a quick draft and suppresses its pending folder result","Settings delayed success cannot alter a newer dialog after navigation","Settings exposes an immediately selectable actual path plus open and refresh without scanning","Settings manager uses its own folder controls while background settings stay unchanged","Settings opens exactly the displayed directory; refresh explicitly loads all 120 bundled avatars","Startup and folder-info only resolve the persistent avatar path without creating or scanning it"];
let completed=false;
// Synthetic end-to-end checks against the actual Electron main and preload.
// Native shell/chooser calls are mocked; directory IO, decoding and persistence are real.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const variant = /\.asar[\\/]/.test(process.env.FLOWER_PACKAGE_MAIN||'') ? 'packaged' : 'source';
const out = process.env.FLOWER_AVATAR_ACCESS_OUT || path.join(root, 'artifacts/rc15/avatar-access-' + variant);
fs.mkdirSync(out, { recursive: true });
const write = (name, value) => fs.writeFileSync(path.join(out, name), JSON.stringify(value, null, 2));
if (!process.versions.electron) {
  const fixtureLayout=qaChild.fixture('flower-rc18-avatar-access-'),temporary=fixtureLayout.root,data=fixtureLayout.data,resources=fixtureLayout.root;
  qaChild.prepare(out,['results.json','execution.json','failure.json']);
  const startedAt=new Date().toISOString();
  const fixture = require('../src/core.cjs').createInitialState();
  fixture.settings.className = '合成课堂 · 头像文件夹'; fixture.logs = [];
  fixture.students = fixture.students.slice(0, 3).map((student, index) => ({ ...student, name: ['合成小禾', '合成星野', '合成小满'][index], group: '向日葵组', photo: '' }));
  fs.writeFileSync(path.join(data, 'classroom.json'), JSON.stringify(fixture));
  const run = require('node:child_process').spawnSync(require('electron'), ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu', __filename], {
    cwd: root, encoding: 'utf8', timeout: 150000, maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, FLOWER_HEADLESS_TEST: '1', FLOWER_DATA_DIR: data, FLOWER_EXTERNAL_RESOURCE_DIR: resources, FLOWER_AVATAR_ACCESS_TEMP: temporary, XDG_CACHE_HOME: '/tmp/flower-rc15-avatar-cache',...fixtureLayout.env }
  });
  fs.writeFileSync(path.join(out, 'run.log'), (run.stdout || '') + (run.stderr || ''));
  console.log(run.stdout || '');
  const record=qaChild.capture(run,path.join(out,'results.json'),'avatar-access',{expectedCaseNames,requireCompleted:true});
  if(record.report&&JSON.stringify(record.report.sourceAtStart)!==JSON.stringify(record.report.sourceAtFinish)){record.exitCode=1;record.evidenceErrors.push('Runtime source changed during execution');}
  write('execution.json',{startedAt,completedAt:new Date().toISOString(),requiredPhases:['avatar-access'],actualPhases:['avatar-access'],...record});process.exitCode=record.exitCode;
} else {
  const { app, BrowserWindow, shell, dialog } = require('electron'); app.disableHardwareAcceleration();
  const checks = [], rendererErrors = [], opened = [], scans = [];
  let main, delayedOpen = null, nextShell = '', nextSave = null, delayNextScan=false, delayedScan=null;
  shell.openPath = async target => {
    opened.push(target); const behavior = nextShell; nextShell = '';
    if (behavior === 'DELAY') return new Promise(resolve => { delayedOpen = resolve; });
    if (behavior === 'REJECT') throw new Error('合成系统文件管理器错误');
    return behavior;
  };
  dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  dialog.showSaveDialog = async () => { const filePath = nextSave; nextSave = null; return filePath ? { canceled: false, filePath } : { canceled: true }; };
  for (const method of ['opendir', 'readdir']) {
    const original = fs.promises[method];
    fs.promises[method] = async function(target, ...args) { if (String(target).endsWith(path.sep + '头像')) { scans.push(String(target)); if(delayNextScan){delayNextScan=false;await new Promise(resolve=>{delayedScan=resolve;});} } return original.call(this, target, ...args); };
  }
  const entry = path.resolve(process.env.FLOWER_PACKAGE_MAIN || path.join(root, 'src/main.cjs'));
  const sourceHashes=()=>Object.fromEntries(['main.cjs','preload.cjs','app.js','avatar-ui.js','avatar-ui.css','avatar-library.cjs'].map(name=>[name,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(path.dirname(entry),name))).digest('hex')]));
  const sourceAtStart=sourceHashes();
  require('./package-boundary.cjs')(entry, path.join(out, 'dependency-boundary.json'));if(!qaChild.load(entry,app))return;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = code => main.webContents.executeJavaScript(code, true);
  const exists = selector => js('!!document.querySelector(' + JSON.stringify(selector) + ')');
  const state = () => js('classroom.get().then(result=>result.state)');
  const file = request => js('classroom.file(' + JSON.stringify(request) + ')');
  const until = async (fn, name) => { for (let n = 0; n < 300; n++) { if (await fn()) return; await wait(20); } throw new Error('Timeout: ' + name); };
  async function point(selector, scroll = true) { return js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;${scroll ? "e.scrollIntoView({block:'center',inline:'nearest'});" : ''}const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return{x,y,top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&(h===e||e.contains(h)),disabled:!!e.disabled};})()`); }
  async function click(selector, repeat = 1) { await point(selector); await wait(70); const p = await point(selector, false); assert.ok(p?.visible && !p.disabled, selector + ' ' + JSON.stringify(p)); main.show(); main.focus(); const zoom = main.webContents.getZoomFactor(); for (let n = 0; n < repeat; n++) for (const type of ['mouseDown', 'mouseUp']) main.webContents.sendInputEvent({ type, x: Math.round(p.x * zoom), y: Math.round(p.y * zoom), button: 'left', clickCount: 1 }); await wait(100); }
  async function key(code, modifiers = []) { main.focus(); const keyCode = code === 'Enter' ? 'Return' : code; main.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); if (code === 'Enter') main.webContents.sendInputEvent({ type: 'char', keyCode: '\r', modifiers }); main.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await wait(70); }
  async function type(selector, value) { await click(selector); await key('a', ['control']); main.webContents.insertText(value); await wait(70); }
  async function shot(name) { await wait(180); fs.writeFileSync(path.join(out, name + '.png'), (await main.webContents.capturePage()).toPNG()); }
  async function close() { if (await exists('#modal .dialog')) await click('#modal .dialog-header [data-do=modal-close]'); await until(() => exists('#modal .dialog').then(value => !value), 'close modal'); }
  async function page(name) { await close(); await js(`document.querySelector('#nav-${name}').focus()`); await key('Enter'); }
  async function quick(index = 0) { await page('students'); const id = (await state()).students[index].id; await click(`[data-do=quick-avatar][data-id="${id}"]`); await until(() => exists('#quick-avatar-editor'), 'quick avatar'); await until(() => js('!document.querySelector("#quick-avatar-editor [data-do=avatars-refresh]").disabled'), 'quick list'); }
  async function check(name, body) { try { const detail = await body(); checks.push({ name, status: 'passed', detail }); console.log('PASS', name); } catch (error) { checks.push({ name, status: 'failed', error: error.stack }); try { await shot('failure-' + checks.length); } catch {} throw error; } finally { write('results.json', { completed,variant,entry,syntheticOnly:true,windowsExecuted:false,nativeShellMocked:true,actualMainPreload:true,sourceAtStart,sourceAtFinish:sourceHashes(),checks,rendererErrors }); } }
  const timeout = setTimeout(() => app.exit(3), 140000);
  app.whenReady().then(async () => { try {
    await until(async () => { main = BrowserWindow.getAllWindows().find(win => win.flowerRole === 'main'); return main && !main.webContents.isLoading(); }, 'main');
    main.webContents.on('console-message', (_event, level, message) => { if (level === 'error' || level >= 3) rendererErrors.push(message); });
    await until(() => exists('[data-do=quick-avatar]'), 'student cards'); main.setSize(1440, 1000); main.webContents.setZoomFactor(1); await wait(80);
    let directory;
    await check('Startup and folder-info only resolve the persistent avatar path without creating or scanning it', async () => {
      const info = await file({ command: 'avatar-folder-info' }); directory = info.directory;
      assert.ok(directory.startsWith(process.env.FLOWER_AVATAR_ACCESS_TEMP + path.sep), 'All fixture writes must be isolated');
      assert.equal(path.basename(directory), '头像'); assert.equal(fs.existsSync(directory), false); assert.equal(scans.length, 0);
      return { directory };
    });
    await check('Settings exposes an immediately selectable actual path plus open and refresh without scanning', async () => {
      const before = await state(); await page('settings'); await until(() => js('document.querySelector("#avatar-settings-folder .avatar-folder-path")?.value').then(value => value === directory), 'settings folder path');
      assert.equal(fs.existsSync(directory), false); assert.equal(scans.length, 0);
      await click('#avatar-settings-folder .avatar-folder-path'); await key('a', ['control']);
      assert.equal(await js('document.activeElement.readOnly'), true);
      assert.equal(await js('document.activeElement.selectionEnd-document.activeElement.selectionStart'), directory.length);
      await key('Enter'); assert.deepEqual(await state(), before);
      await js('render()'); await wait(100); assert.equal(await js('document.activeElement.id'),'avatar-settings-path');assert.equal(await js('document.activeElement.selectionEnd-document.activeElement.selectionStart'),directory.length);
      assert.ok((await point('#avatar-settings-folder [data-do=avatar-open-folder]')).visible);
      assert.ok((await point('#avatar-settings-folder [data-do=avatars-refresh]')).visible);
      await js('document.querySelector(".settings-avatar-library").scrollIntoView({block:"center"})'); await shot('01-settings-avatar-folder');
    });
    await check('Settings opens exactly the displayed directory; refresh explicitly loads all 120 bundled avatars', async () => {
      const before = await state(); await click('#avatar-settings-folder [data-do=avatar-open-folder]'); await until(() => js('document.querySelector("#avatar-settings-folder .avatar-folder-status").textContent').then(text => text.includes('已打开')), 'folder success');
      assert.deepEqual(opened, [directory]); assert.equal(scans.length, 0, 'Opening the folder must not scan image contents');
      await click('#avatar-settings-folder [data-do=avatars-refresh]', 3); await until(() => js('!document.querySelector("#avatar-settings-folder [data-do=avatars-refresh]").disabled'), 'settings refreshed');
      assert.match(await js('document.querySelector("#avatar-settings-folder .avatar-folder-status").textContent'), /120 个头像/);
      assert.deepEqual(await state(), before); assert.equal((await file({ command: 'avatars-list' })).items.length, 120);
    });
    await check('OS open failures and exceptions remain visible without a false success notification', async () => {
      for (const behavior of ['Synthetic OS shell failure', 'REJECT']) {
        nextShell = behavior; await click('#avatar-settings-folder [data-do=avatar-open-folder]');
        await until(() => js('!document.querySelector("#avatar-settings-folder [data-do=avatar-open-folder]").disabled'), 'open failure');
        const status = await js('document.querySelector("#avatar-settings-folder .avatar-folder-status").textContent');
        assert.match(status, /无法打开|系统文件管理器错误/); assert.doesNotMatch(status, /已打开/);
        assert.equal(await js('document.querySelector("#avatar-settings-folder .avatar-folder-path").value'), directory);
      }
      await shot('02-folder-open-error');
    });
    await check('An unavailable real avatar directory reports failure at its original path without opening a fallback', async () => {
      const parked=directory+'-synthetic-parked', calls=opened.length,before=await state();fs.renameSync(directory,parked);fs.writeFileSync(directory,'synthetic blocking file');
      try{await click('#avatar-settings-folder [data-do=avatar-open-folder]');await until(()=>js('!document.querySelector("#avatar-settings-folder [data-do=avatar-open-folder]").disabled'),'blocked folder result');
        assert.match(await js('document.querySelector("#avatar-settings-folder .avatar-folder-status").textContent'),/无法|不是普通文件夹|路径/);assert.equal(opened.length,calls);assert.equal(await js('document.querySelector("#avatar-settings-folder .avatar-folder-path").value'),directory);assert.deepEqual(await state(),before);
      }finally{fs.unlinkSync(directory);fs.renameSync(parked,directory);}
    });
    await check('Settings manager uses its own folder controls while background settings stay unchanged', async () => {
      const before=await state(), background=await js('document.querySelector("#avatar-settings-folder .avatar-folder-status").textContent');
      await click('[data-do=avatar-manage]'); await until(()=>js('document.querySelectorAll("#avatar-manager .avatar-option").length===120'),'manager library');
      assert.equal(await js('document.querySelector("#avatar-manager .avatar-folder-path").value'),directory);
      assert.equal(await js('[...document.querySelectorAll("#avatar-manager .avatar-option")].every(button=>button.disabled)'),true);
      await click('#avatar-manager [data-do=avatar-open-folder]'); await click('#avatar-manager [data-do=avatars-refresh]');
      await until(()=>js('!document.querySelector("#avatar-manager [data-do=avatars-refresh]").disabled'),'manager refresh');
      assert.equal(await js('document.querySelector("#avatar-settings-folder .avatar-folder-status").textContent'),background);
      await js('document.querySelector("#modal .dialog-content").scrollTop=0'); await shot('03-settings-library-manager'); await close(); assert.deepEqual(await state(),before);
    });
    await check('Quick chooser exposes the same path above search and saves an embedded selected snapshot', async () => {
      await quick(); assert.equal(await js('document.querySelector("#quick-avatar-editor .avatar-folder-path").value'), directory);
      assert.equal(await js('document.querySelectorAll("#quick-avatar-editor .avatar-option").length'), 120);
      assert.equal(await js('Boolean(document.querySelector(".avatar-folder-panel").compareDocumentPosition(document.querySelector("#avatar-search"))&Node.DOCUMENT_POSITION_FOLLOWING)'), true);
      await js('document.querySelector("#modal .dialog-content").scrollTop=0'); await shot('03-quick-chooser-folder');
      await type('#avatar-search', '竹叶熊猫'); await click('#quick-avatar-editor [data-pet=panda]'); const photo = await js('document.querySelector("#quick-avatar-preview img").src');
      await click('#quick-avatar-editor [data-do=avatar-save]'); await until(() => exists('#quick-avatar-editor').then(value => !value), 'avatar saved');
      assert.equal((await state()).students[0].photo, photo); assert.match(photo, /^data:image\/jpeg;base64,/);
    });
    await check('Closed quick chooser ignores a delayed open failure after a newer student dialog replaces it', async () => {
      await quick(); const priorCalls=opened.length;nextShell = 'DELAY'; await click('#quick-avatar-editor [data-do=avatar-open-folder]', 3); await until(() => !!delayedOpen, 'delayed shell');
      const callCount = opened.length;assert.equal(callCount,priorCalls+1,'Repeated clicks must open the OS folder only once while pending'); await close(); await quick(1);
      const before = await js('({html:document.querySelector("#quick-avatar-editor").innerHTML,toast:document.querySelector("#toast").textContent})');
      const resolve = delayedOpen; delayedOpen = null; resolve('Synthetic late shell error'); await wait(160);
      assert.deepEqual(await js('({html:document.querySelector("#quick-avatar-editor").innerHTML,toast:document.querySelector("#toast").textContent})'), before);
      assert.equal(opened.length, callCount); await close();
    });
    await check('Settings delayed success cannot alter a newer dialog after navigation', async () => {
      await page('settings'); await until(() => exists('#avatar-settings-folder'), 'settings'); nextShell = 'DELAY'; await click('#avatar-settings-folder [data-do=avatar-open-folder]'); await until(() => !!delayedOpen, 'settings delayed shell');
      await quick(); const before = await js('document.querySelector("#quick-avatar-editor").innerHTML');
      const resolve = delayedOpen; delayedOpen = null; resolve(''); await wait(160); assert.equal(await js('document.querySelector("#quick-avatar-editor").innerHTML'), before); await close();
    });
    await check('A delayed refresh from a closed chooser cannot overwrite the newly opened student preview', async () => {
      await quick(); delayNextScan=true; await click('#quick-avatar-editor [data-do=avatars-refresh]'); await until(()=>!!delayedScan,'delayed refresh'); await close();
      const before=await state(), id=before.students[1].id; await click(`[data-do=quick-avatar][data-id="${id}"]`); await until(()=>exists('#quick-avatar-editor'),'new quick dialog');
      const preview=await js('document.querySelector("#quick-avatar-preview").innerHTML'); const resolve=delayedScan;delayedScan=null;resolve();
      await until(()=>js('!document.querySelector("#quick-avatar-editor [data-do=avatars-refresh]").disabled'),'new dialog list');
      assert.equal(await js('document.querySelector("#quick-avatar-preview").innerHTML'),preview);assert.match(await js('document.querySelector("#modal h2").textContent'),/合成星野/);assert.deepEqual(await state(),before);await close();
    });
    await check('Full student editor keeps edited text and keyboard focus, and Enter on the path cannot submit', async () => {
      await page('students'); const before = await state(), id = before.students[0].id; await click(`[data-do=edit-student][data-id="${id}"]`); await type('#student-form [name=name]', '合成尚未保存'); await click('#student-form [data-do=avatar-library]');
      await until(() => js('document.querySelectorAll("#avatar-library .avatar-option").length===120'), 'full editor library'); await click('#avatar-library .avatar-folder-path'); await key('Enter');
      assert.deepEqual(await state(), before); assert.equal(await exists('#student-form'), true); await type('#avatar-search', '星核机甲'); await click('#avatar-library [data-pet=robot]');
      assert.equal(await js('document.querySelector("#avatar-library").hidden'), true); assert.equal(await js('document.activeElement.dataset.do'), 'avatar-library');
      assert.equal(await js('document.querySelector("#student-form [name=name]").value'), '合成尚未保存'); assert.deepEqual(await state(), before); await close();
    });
    await check('Explicit refresh sees add/remove files while the selected snapshot and full backup stay intact', async () => {
      const before = await state(), library = await file({ command: 'avatars-list' }), selected = library.items.find(item => item.photo === before.students[0].photo); assert.ok(selected);
      fs.unlinkSync(path.join(directory, selected.fileName)); fs.copyFileSync(path.join(directory, library.items.find(item => item.id !== selected.id).fileName), path.join(directory, '合成新增头像.png'));
      assert.equal((await file({ command: 'avatars-list' })).items.some(item => item.id === selected.id), true);
      await quick(); await click('#quick-avatar-editor [data-do=avatars-refresh]'); await until(() => js('!document.querySelector("#quick-avatar-editor [data-do=avatars-refresh]").disabled'), 'new avatar refresh');
      const refreshed = await file({ command: 'avatars-list' }); assert.equal(refreshed.items.length, 120); assert.equal(refreshed.items.some(item => item.id === selected.id), false); assert.equal(refreshed.items.some(item => item.fileName === '合成新增头像.png'), true);
      assert.equal(await js('document.querySelector("#quick-avatar-preview img").src'), before.students[0].photo); assert.deepEqual(await state(), before); await close();
      nextSave = path.join(out, 'synthetic-avatar-backup.json'); await file({ command: 'backup' }); assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'synthetic-avatar-backup.json'))), before);
    });
    await check('Restore invalidates a quick draft and suppresses its pending folder result', async () => {
      await quick(); const before = await state(); nextShell = 'DELAY'; await click('#quick-avatar-editor [data-do=avatar-open-folder]'); await until(() => !!delayedOpen, 'restore pending shell');
      await file({ command: 'restore-apply', state: before }); await until(() => js('document.querySelector("#quick-avatar-editor [data-do=avatar-save]").disabled'), 'restore disabled save');
      const draft = await js('document.querySelector("#quick-avatar-preview").innerHTML'); const resolve = delayedOpen; delayedOpen = null; resolve(''); await wait(150);
      assert.equal(await js('document.querySelector("#quick-avatar-preview").innerHTML'), draft); assert.match(await js('document.querySelector(".avatar-draft-status").textContent'), /档案或备份/); assert.doesNotMatch(await js('document.querySelector(".avatar-folder-status").textContent'), /已打开/); await close();
    });
    for (const [width, height, zoom] of [[900, 640, 1], [1280, 720, 1.25], [1024, 640, 1.5], [900, 640, 2]]) await check(`Folder controls, path and close remain usable at ${width}x${height} / ${zoom * 100}%`, async () => {
      main.setSize(width, height); main.webContents.setZoomFactor(zoom); await wait(100); await quick();
      for (const selector of ['#quick-avatar-editor [data-do=avatar-open-folder]', '#quick-avatar-editor [data-do=avatars-refresh]', '#quick-avatar-editor .avatar-folder-path']) { await point(selector); await wait(50); assert.ok((await point(selector, false)).visible, selector); }
      await js('document.querySelector("#quick-avatar-editor .avatar-folder-panel").scrollIntoView({block:"start"})'); await shot('folder-' + Math.round(zoom * 100) + 'pct');if(zoom===2){await point('#quick-avatar-editor .avatar-folder-path');await shot('folder-200pct-path');}
      assert.ok((await point('#modal .dialog-header [data-do=modal-close]', false)).visible); await close();
    });
    await check('Avatar interactions produce no renderer errors', async () => assert.deepEqual(rendererErrors, []));
    completed=true;write('results.json', { completed,variant,entry,syntheticOnly:true,windowsExecuted:false,nativeShellMocked:true,actualMainPreload:true,sourceAtStart,sourceAtFinish:sourceHashes(),checks,rendererErrors });clearTimeout(timeout); console.log('AVATAR_ACCESS_RC14_PASS', checks.length); app.exit(0);
  } catch (error) { console.error(error.stack); clearTimeout(timeout); write('failure.json', { error: error.stack, checks, rendererErrors }); app.exit(1); } });
}
