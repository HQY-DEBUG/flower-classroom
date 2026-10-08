'use strict';
// Standalone synthetic renderer QA. It does not start the production app or read user data.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'artifacts/qa-classroom-tools');
fs.mkdirSync(out, { recursive: true });
if (!process.versions.electron) {
  const run = require('node:child_process').spawnSync(require('electron'), ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu', __filename], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, XDG_CACHE_HOME: '/tmp/flower-classroom-tools-cache' }
  });
  fs.writeFileSync(path.join(out, 'run.log'), (run.stdout || '') + (run.stderr || ''));
  console.log((run.stdout || '').split('\n').filter(line => /^(PASS|FAIL|RESULT)/.test(line)).join('\n'));
  if (run.status !== 0 || run.error) console.error(run.error?.message || run.stderr);
  process.exitCode = run.status === 0 ? 0 : 1;
} else {
  const { app, BrowserWindow } = require('electron');
  app.disableHardwareAcceleration();
  app.setPath('userData', path.join(out, 'synthetic-electron-profile'));
  const checks = [], rendererErrors = [];
  let win;
  const js = code => win.webContents.executeJavaScript(code, true);
  const click = selector => js(`(async()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Missing/disabled '+${JSON.stringify(selector)});e.click();await window.qaLast;})()`);
  const open = kind => js(`window.ClassroomToolsUI.handle('ct-${kind}',null,window.qaContext())`);
  const state = () => js('window.qaState');
  const external = action => js(`window.qaExternal(${JSON.stringify(action)})`);
  const submit = () => js('(async()=>{document.querySelector("#ct-vote-form").requestSubmit();await window.qaLast;})()');
  const close = () => js('window.qaClose()');
  const shot = async name => {
    win.webContents.startPainting(); win.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 120));
    let image = await win.webContents.capturePage();
    if (image.getSize().width <= 1) {
      const [width, height] = win.getSize(); win.setSize(420, height); await new Promise(resolve => setTimeout(resolve, 100));
      win.setSize(width, height); await new Promise(resolve => setTimeout(resolve, 100)); image = await win.webContents.capturePage();
    }
    assert.ok(image.getSize().width > 1, 'Screenshot must contain real pixels');
    fs.writeFileSync(path.join(out, name + '.png'), image.toPNG());
  };
  async function check(name, fn) {
    try { await fn(); checks.push({ name, status: 'passed' }); console.log('PASS_CT', name); }
    catch (error) { checks.push({ name, status: 'failed', error: error.stack }); console.log('FAIL_CT', name, error.message); await shot('failure-' + checks.length); }
  }
  app.whenReady().then(async () => {
    win = new BrowserWindow({ show: false, width: 1100, height: 860, minWidth: 1100, minHeight: 860, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true } });
    win.webContents.on('console-message', (_event, detail) => { if (detail.level === 'error') rendererErrors.push(detail.message); });
    const { pathToFileURL } = require('node:url');
    const file = name => pathToFileURL(path.join(root, 'src', name)).href;
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>合成课堂工具验收</title><link rel="stylesheet" href="${file('style.css')}"><link rel="stylesheet" href="${file('classroom-tools.css')}"></head><body><main id="app"><button id="qa-entry">合成验收入口</button></main><div id="modal"></div><div id="toast"></div><script src="${file('render-focus.js')}"></script><script src="${file('classroom-tools.js')}"></script><script src="${file('classroom-tools-ui.js')}"></script></body></html>`;
    const harness = path.join(out, 'synthetic-harness.html'); fs.writeFileSync(harness, html); await win.loadFile(harness);
    await js(`(()=>{
      window.qaState={version:1,revision:0,settings:{className:'合成课堂工具测试班'},students:Array.from({length:300},(_,i)=>({id:'s_'+i,name:'合成同学'+String(i+1).padStart(3,'0'),group:'合成第'+(i%5+1)+'组',score:5,growth:10,photo:''})),logs:[],petAccounts:[{id:'synthetic-account'}]};
      window.qaLast=Promise.resolve();window.qaCalls=0;window.qaFail=false;window.qaDelay=0;
      window.qaClose=()=>{ClassroomToolsUI.dispose();document.querySelector('#modal').innerHTML='';document.querySelector('#app').inert=false;};
      window.qaModal=html=>{document.querySelector('#app').inert=true;document.querySelector('#modal').innerHTML='<div class="modal-backdrop"><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-heading"><button class="modal-close icon-button" data-do="modal-close" aria-label="关闭">×</button>'+html+'</section></div>';};
      window.qaToast=message=>{document.querySelector('#toast').textContent=message;};
      window.qaContext=()=>({state:window.qaState,modal:window.qaModal,toast:window.qaToast,closeModal:window.qaClose,act:window.qaAct});
      window.qaAct=async action=>{window.qaCalls++;if(window.qaDelay)await new Promise(r=>setTimeout(r,window.qaDelay));const next=structuredClone(window.qaState);try{ClassroomTools.apply(next,action);if(window.qaFail){window.qaFail=false;throw Error('合成磁盘写入失败');}next.revision++;window.qaState=next;ClassroomToolsUI.sync(next,window.qaContext());return true;}catch(error){window.qaToast(error.message);return false;}};
      window.qaExternal=action=>{const next=structuredClone(window.qaState);ClassroomTools.apply(next,{...action,...ClassroomTools.expectation(next)});next.revision++;window.qaState=next;ClassroomToolsUI.sync(next,window.qaContext());};
      document.addEventListener('click',event=>{const el=event.target.closest('[data-do]');if(!el)return;if(el.dataset.do==='modal-close'){window.qaClose();return;}if(ClassroomToolsUI.handles(el.dataset.do))window.qaLast=ClassroomToolsUI.handle(el.dataset.do,el,window.qaContext());});
      document.addEventListener('submit',event=>{window.qaLast=ClassroomToolsUI.submit(event,window.qaContext());});
    })()`);
    const original = await state();
    await check('Toolbox exposes all five implemented activity entries', async () => {
      await open('toolbox'); assert.equal(await js('document.querySelectorAll(".ct-tool-card").length'), 5); await shot('01-toolbox');
    });
    await check('300-student candidate roster scrolls; only two to four candidates may start', async () => {
      await click('[data-do=ct-vote]');
      assert.equal(await js('document.querySelectorAll("[data-do=ct-candidate]").length'), 300);
      assert.equal(await js('document.querySelector(".ct-scroll").scrollHeight>document.querySelector(".ct-scroll").clientHeight'), true);
      assert.equal(await js('document.querySelector("#ct-vote-form [type=submit]").disabled'), true);
      await click('[data-do=ct-candidate][data-id=s_0]');
      assert.equal(await js('document.querySelector("#ct-vote-form [type=submit]").disabled'), true);
      for (const i of [1, 2, 3]) await click('[data-do=ct-candidate][data-id=s_' + i + ']');
      await click('[data-do=ct-candidate][data-id=s_4]');
      assert.equal(await js('document.querySelectorAll(".ct-selected").length'), 4);
      assert.match(await js('document.querySelector("#toast").textContent'), /最多选择4/);
      await shot('02-candidates-300'); await submit();
      assert.equal((await state()).classroomTools.vote.candidates.length, 4);
    });
    await check('Vote +1/-1 works with zero lower bound and double clicks save once', async () => {
      assert.equal(await js('document.querySelector("[data-do=ct-vote-minus]").disabled'), true);
      await js('window.qaDelay=50;(()=>{const el=document.querySelector("[data-do=ct-vote-plus][data-id=s_0]");el.click();el.click();})()');
      await js('window.qaLast'); await js('window.qaDelay=0');
      assert.equal((await state()).classroomTools.vote.candidates[0].votes, 1);
      await click('[data-do=ct-vote-minus][data-id=s_0]'); assert.equal((await state()).classroomTools.vote.candidates[0].votes, 0);
      await shot('03-vote');
    });
    await check('Failed vote save keeps counts and enables one safe retry', async () => {
      const before = await state(); await js('window.qaFail=true'); await click('[data-do=ct-vote-plus][data-id=s_1]');
      assert.deepEqual(await state(), before); assert.match(await js('document.querySelector(".ct-error").textContent'), /未保存/);
      assert.equal(await js('document.querySelector("[data-do=ct-vote-plus][data-id=s_1]").disabled'), false);
      await click('[data-do=ct-vote-plus][data-id=s_1]'); assert.equal((await state()).classroomTools.vote.candidates[1].votes, 1);
    });
    await check('Remote voting refreshes count, invalidates detached controls, and permits current retry', async () => {
      await js('window.qaOldVote=document.querySelector("[data-do=ct-vote-plus][data-id=s_1]")');
      await external({ type: 'classroom.vote.adjust', id: 's_1', delta: 1 });
      assert.match(await js('document.querySelector("[data-ct-count=s_1]").textContent'), /2/);
      await js('ClassroomToolsUI.handle("ct-vote-plus",window.qaOldVote,window.qaContext())');
      assert.equal((await state()).classroomTools.vote.candidates[1].votes, 2);
      await click('[data-do=ct-vote-plus][data-id=s_1]'); assert.equal((await state()).classroomTools.vote.candidates[1].votes, 3);
    });
    await check('Remote activity invalidates open candidate selection; reselect warns before clearing', async () => {
      await click('[data-do=ct-reselect]'); assert.match(await js('document.querySelector(".ct-root").textContent'), /票数将清空/);
      await external({ type: 'classroom.attendance.set', id: 's_10', present: true });
      assert.equal(await js('document.querySelector("#ct-vote-form [type=submit]").disabled'), true);
      const before = await state(); await js('ClassroomToolsUI.submit({target:document.querySelector("#ct-vote-form"),preventDefault(){}},window.qaContext())'); assert.deepEqual(await state(), before);
      await click('[data-do=ct-refresh]'); await submit(); assert.equal((await state()).classroomTools.vote.candidates.every(v => v.votes === 0), true);
    });
    await check('Attendance marks red checks by group; absent list is complete and independently scrolls', async () => {
      await open('attendance'); assert.equal(await js('document.querySelectorAll(".ct-group").length'), 5);
      await click('[data-do=ct-attendance-toggle][data-id=s_0]'); await click('[data-do=ct-attendance-toggle][data-id=s_299]');
      assert.equal(await js('document.querySelectorAll(".ct-present").length'), 3);
      await shot('04-attendance-300'); await click('[data-do=ct-absent]');
      assert.equal(await js('document.querySelectorAll(".ct-absent-person").length'), 297);
      assert.match(await js('document.querySelector("h2").textContent'), /297/); await shot('05-absent');
      await external({ type: 'classroom.attendance.set', id: 's_298', present: true });
      assert.equal(await js('document.querySelectorAll(".ct-absent-person").length'), 296);
    });
    await check('Verified 1/6/0 three-candidate vote displays second/first/third without moving candidates', async () => {
      await close();
      await external({ type: 'classroom.vote.start', ids: ['s_0', 's_1', 's_2'], confirmedNewVote: true });
      await external({ type: 'classroom.vote.adjust', id: 's_0', delta: 1 });
      for (let i = 0; i < 6; i++) await external({ type: 'classroom.vote.adjust', id: 's_1', delta: 1 });
      await open('vote');
      assert.deepEqual(await js('[...document.querySelectorAll(".ct-vote-card")].map(e=>[e.dataset.ctCandidate,e.querySelector(".ct-rank").textContent,e.querySelector(".ct-votes").textContent])'), [['s_0', '第二名', '1票'], ['s_1', '第一名', '6票'], ['s_2', '第三名', '0票']]);
      await shot('03b-reference-vote-1-6-0'); await open('attendance');
    });
    await check('Reset cancellation and stale confirmation do not clear, explicit fresh confirmation does', async () => {
      await open('attendance'); await click('[data-do=ct-reset]');
      const before = await state(); await click('[data-do=ct-attendance-back]'); assert.deepEqual(await state(), before);
      await click('[data-do=ct-reset]'); await external({ type: 'classroom.attendance.set', id: 's_297', present: true });
      assert.equal(await js('document.querySelector("[data-do=ct-reset-confirm]").disabled'), true);
      await click('[data-do=ct-refresh]'); await click('[data-do=ct-reset]'); await click('[data-do=ct-reset-confirm]');
      assert.deepEqual((await state()).classroomTools.attendance.presentIds, []);
    });
    await check('Unrelated score and timer revisions leave candidate selection and attendance usable', async () => {
      await open('vote'); await click('[data-do=ct-reselect]');
      await js('window.qaState={...window.qaState,revision:window.qaState.revision+10};ClassroomToolsUI.sync(window.qaState,window.qaContext())');
      assert.equal(await js('document.querySelector("#ct-vote-form [type=submit]").disabled'), false); await close();
    });
    await check('Group layout changes reorder an open candidate list without losing selection', async () => {
      await open('vote'); await click('[data-do=ct-reselect]');
      await js('window.qaState={...window.qaState,settings:{...window.qaState.settings,groupOrder:["合成第5组","合成第1组"]}};ClassroomToolsUI.sync(window.qaState,window.qaContext())');
      assert.match(await js('document.querySelector(".ct-group h3").textContent'), /^合成第5组/);
      assert.equal(await js('document.querySelector("#ct-vote-form [type=submit]").disabled'), false);
      assert.equal(await js('document.querySelectorAll(".ct-selected").length'), 3); await close();
    });
    await check('Close during a pending save never reopens; switching panel rejects old pending action', async () => {
      await open('attendance'); await js('window.qaDelay=70;document.querySelector("[data-do=ct-attendance-toggle][data-id=s_0]").click();window.qaClose()');
      await js('window.qaLast'); assert.equal(await js('document.querySelector(".ct-root")===null'), true);
      await js('window.qaDelay=0'); assert.deepEqual((await state()).classroomTools.attendance.presentIds, ['s_0']);
      await open('attendance');
      await js('window.qaDelay=70;document.querySelector("[data-do=ct-attendance-toggle][data-id=s_1]").click();window.qaState={...window.qaState,panels:{activeId:"panel_new",others:[]}};ClassroomToolsUI.sync(window.qaState,window.qaContext())');
      await js('window.qaLast'); assert.equal(await js('document.querySelector(".ct-root")===null'), true);
      assert.deepEqual((await state()).classroomTools.attendance.presentIds, ['s_0']); await js('window.qaDelay=0');
    });
    await check('Names escape HTML; 420px and 1100px layouts fit with all 300 roster members', async () => {
      await js('window.qaState.students[0].name="<img src=x onerror=alert(1)>合成";window.qaState.students[0].group="合成超长小组名称".repeat(5)');
      for (const width of [420, 1100]) {
        win.setMinimumSize(width, 820); win.setSize(width, 820); await open('attendance');
        assert.equal(await js('document.querySelectorAll(".ct-root img").length'), 0);
        assert.equal(await js('document.querySelector(".ct-dialog").scrollWidth<=document.querySelector(".ct-dialog").clientWidth+1'), true);
        assert.equal(await js('document.querySelectorAll("[data-do=ct-attendance-toggle]").length'), 300);
        await shot('06-attendance-' + width);
      }
    });
    await check('Activity operations preserve protected point/growth/photo/ledger fields and emit no renderer errors', async () => {
      const final = await state();
      assert.deepEqual(final.students.map(s => [s.id, s.score, s.growth, s.photo]), original.students.map(s => [s.id, s.score, s.growth, s.photo]));
      assert.deepEqual(final.logs, original.logs); assert.deepEqual(final.petAccounts, original.petAccounts); assert.deepEqual(rendererErrors, []);
    });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ syntheticOnly: true, scope: 'Isolated renderer and pure reducer harness; native IPC, durable storage and restart are validated by parent integration QA', checks, rendererErrors }, null, 2));
    console.log('RESULT_CT', checks.filter(c => c.status === 'passed').length + '/' + checks.length);
    app.exit(checks.some(c => c.status === 'failed') ? 1 : 0);
  }).catch(error => { console.error(error.stack); app.exit(2); });
}
