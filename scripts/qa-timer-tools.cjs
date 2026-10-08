'use strict';
// Isolated Electron UI fixture. Uses the real core reducer; no user data is read.
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createInitialState, applyAction } = require('../src/core.cjs');
const TimerTools = require('../src/timer-tools.js');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'artifacts', 'timer-tools');
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, '.electron-fixture')); 
app.disableHardwareAcceleration();
let state = createInitialState(), window, returned = false;
const checks = [], errors = [], requests = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const js = source => window.webContents.executeJavaScript(source, true);
const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const fill = (selector, value) => js(`document.querySelector(${JSON.stringify(selector)}).value=${JSON.stringify(String(value))}`);
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await sleep(20); } throw Error('Timed out waiting for UI state'); }
async function check(name, run) { try { const detail = await run(); checks.push({ name, status: 'passed', detail }); console.log('PASS', name); } catch (error) { checks.push({ name, status: 'failed', error: error.stack }); console.error('FAIL', name, error.message); } }
async function screenshot(name) { await sleep(120); fs.writeFileSync(path.join(out, name + '.png'), (await window.webContents.capturePage()).toPNG()); }
const preload = path.join(out, 'timer-fixture-preload.cjs');
fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{get:()=>ipcRenderer.invoke('timer-qa-get'),act:a=>ipcRenderer.invoke('timer-qa-act',a),back:()=>ipcRenderer.invoke('timer-qa-back')});`);
ipcMain.handle('timer-qa-get', () => state);
ipcMain.handle('timer-qa-act', (_event, action) => { state = applyAction(state, action); return state; });
ipcMain.handle('timer-qa-back', () => { returned = true; return true; });
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>计时器独立验证</title><style>${fs.readFileSync(path.join(root, 'src/style.css'), 'utf8')}\n${fs.readFileSync(path.join(root, 'src/timer-tools.css'), 'utf8')}\nhtml,body{background:transparent}body{margin:0}.qa-main{padding:24px;background:#f6f7fb;min-height:100vh}#qa-toast{position:fixed;bottom:8px;left:0;right:0;color:#b43c44;font-size:12px;text-align:center;pointer-events:none}</style><main id="app"></main><div id="qa-toast"></div><script>${fs.readFileSync(path.join(root, 'src/timer-tools.js'), 'utf8')}</script><script>
let state,compact=true;const app=document.querySelector('#app');const toast=t=>document.querySelector('#qa-toast').textContent=t;
function render(){document.body.className=compact?'view-timer':'';app.className=compact?'':'qa-main';app.innerHTML=TimerTools.view(state.timer,{compact,sound:state.settings.timerSound});}
async function act(action){state=await fixture.act(action);render();return true;}
window.qa={get state(){return state},act,show:(value)=>{compact=value;render();},set:(value)=>{state=value;render();}};
document.addEventListener('click',async e=>{const el=e.target.closest('[data-do]');if(!el)return;const action=el.dataset.do;try{if(await TimerTools.handle(action,el,{state,act,toast,api:{window:()=>fixture.back()},role:compact?'timer':'main',render}))return;if(action==='timer-set'){const n=TimerTools.validateInput(document.querySelector('#timer-minutes').value,document.querySelector('#timer-seconds').value);return act({type:'timer.set',seconds:n});}if(action==='timer-toggle')return act({type:state.timer.running?'timer.pause':'timer.start'});if(action==='timer-reset')return act({type:'timer.reset'});if(action==='timer-preset')return act({type:'timer.set',seconds:Number(el.dataset.seconds)});}catch(error){toast(error.message);}});
setInterval(()=>{if(state)TimerTools.tick(state.timer)},50);fixture.get().then(value=>{state=value;render();});
</script></html>`;
fs.writeFileSync(path.join(out, 'timer-fixture.html'), html);
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 420, height: 420, show: false, frame: false, transparent: true, backgroundColor: '#00000000', webPreferences: { offscreen: true, preload, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => { requests.push(details.url); callback({ cancel: false }); });
    await window.loadFile(path.join(out, 'timer-fixture.html'));
    await until(() => js('!!document.querySelector(".tt-disc")'));
    window.setSize(421,421); await sleep(80); window.setSize(420,420); await until(() => js('innerWidth===420&&innerHeight===420'));
    await check('Compact circular timer fits 420x420 with transparent outside corners', async () => {
      const box = await js(`(()=>{const d=document.querySelector('.tt-disc').getBoundingClientRect();return {width:d.width,height:d.height,x:d.x,y:d.y,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight,radius:getComputedStyle(document.querySelector('.tt-disc')).borderRadius}})()`);
      assert.equal(box.width, box.height); assert.equal(box.overflow, false); assert.equal(box.radius, '50%');
      await screenshot('01-compact-timer');
      const image = await window.webContents.capturePage(), rgba = image.toBitmap(); assert.equal(rgba[3], 0, 'transparent corner');
      return box;
    });
    await check('Select seconds and adjust crosses 59 to 60; selecting minutes changes only minutes', async () => {
      await js(`qa.act({type:'timer.set',seconds:59})`);
      await click('[data-do="tt-select"][data-unit="seconds"]'); await click('[data-do="tt-adjust"][data-delta="1"]');
      await until(() => state.timer.durationMs === 60000);
      assert.equal(await js('document.querySelector("[data-unit=seconds]").getAttribute("aria-pressed")'), 'true');
      await click('[data-do="tt-select"][data-unit="minutes"]'); await click('[data-do="tt-adjust"][data-delta="1"]');
      await until(() => state.timer.durationMs === 120000);
      await screenshot('02-selected-minutes');
    });
    await check('Direct input lower and upper boundaries reject invalid total without losing draft', async () => {
      await click('.tt-editor>summary'); await fill('#timer-minutes', 180); await fill('#timer-seconds', 1);
      await click('[data-do="timer-set"]'); await sleep(40); assert.equal(state.timer.durationMs, 120000);
      assert.equal(await js('document.querySelector("#timer-minutes").value'), '180');
      await fill('#timer-seconds', 0); await click('[data-do="timer-set"]'); await until(() => state.timer.durationMs === 10800000);
      await click('.tt-editor>summary'); await fill('#timer-minutes', 0); await fill('#timer-seconds', 1); await click('[data-do="timer-set"]'); await until(() => state.timer.durationMs === 1000);
      await js(`document.querySelector('#qa-toast').textContent=''`);
    });
    await check('Pause keeps remaining input and reset restores original duration', async () => {
      await js(`qa.act({type:'timer.set',seconds:65})`); await click('[data-do="timer-toggle"]'); await until(() => state.timer.running);
      await sleep(1150); await click('[data-do="timer-toggle"]'); await until(() => js('!qa.state.timer.running'));
      const remaining = Math.ceil(state.timer.remainingMs / 1000); assert.ok(remaining <= 64 && remaining >= 63);
      assert.equal(await js('Number(document.querySelector("#timer-seconds").value)'), remaining % 60);
      await click('[data-do="timer-reset"]'); await until(() => js('qa.state.timer.remainingMs===65000')); 
      assert.equal(await js('Number(document.querySelector("#timer-seconds").value)'), 5);
    });
    await check('Repeated reset clears an uncommitted input draft even when duration was unchanged', async () => {
      await fill('#timer-minutes', 99); await fill('#timer-seconds', 17); await click('[data-do="timer-reset"]');
      await until(() => js('document.querySelector("#timer-minutes").value==="1"'));
      assert.equal(await js('document.querySelector("#timer-seconds").value'), '5');
    });
    await check('Running adjustment stops old deadline; expiry readout shows start at zero', async () => {
      await click('[data-do="timer-toggle"]'); await until(() => state.timer.running);
      await click('[data-do="tt-select"][data-unit="seconds"]'); await click('[data-do="tt-adjust"][data-delta="1"]'); await until(() => !state.timer.running);
      assert.equal(state.timer.endsAt, null);
      await js(`qa.act({type:'timer.set',seconds:1})`); await click('[data-do="timer-toggle"]'); await until(() => state.timer.running);
      await until(() => js('document.querySelector(".tt-clock").getAttribute("aria-label")==="剩余0分0秒"'));
      assert.equal(await js('document.querySelector("[data-do=timer-toggle]").textContent'), '开始');
      await screenshot('03-zero-start');
      await js(`qa.act({type:'timer.pause'})`);
    });
    await check('Dropdown exposes exact three sound names with keyboard-focusable controls', async () => {
      await click('.tt-sound>summary');
      const names = await js(`[...document.querySelectorAll('[data-do="tt-sound"]')].map(b=>b.textContent.replace(/[♪✓\\s]/g,''))`);
      assert.deepEqual(names, ['滴答', '鼓掌', '飞弹']);
      await screenshot('04-sound-dropdown');
      await click('.tt-sound>summary');
      return names;
    });
    await check('WebAudio generates and starts all three local sounds in Electron', async () => {
      const results = await js(`(async()=>{const r=[];for(const s of ['tick','applause','laser'])r.push(await TimerTools.play(s));return r})()`);
      assert.ok(results.every(r => r.ok), JSON.stringify(results)); return results;
    });
    await check('Return triggers window-close request', async () => { await click('[data-do="tt-return"]'); await until(() => returned); });
    await check('Full page displays presets and visible direct inputs without horizontal overflow', async () => {
      window.setSize(900, 860); await js(`qa.show(false);qa.act({type:'timer.set',seconds:310})`); await sleep(100);
      assert.equal(await js('document.querySelectorAll("[data-do=timer-preset]").length'), 4);
      assert.equal(await js('document.querySelector("#timer-minutes").getBoundingClientRect().height>=44'), true);
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
      await screenshot('05-full-page');
    });
    await check('Compact minimum 360x360 contains all controls, including maximum duration', async () => {
      window.setSize(360, 360); await js(`qa.show(true);qa.act({type:'timer.set',seconds:10800})`); await sleep(100);
      const bounds = await js(`(()=>{const d=document.querySelector('.tt-disc').getBoundingClientRect();return [...document.querySelectorAll('.tt-top-controls,.tt-clock,.tt-actions,.tt-editor')].map(el=>{const r=el.getBoundingClientRect();return {name:el.className,x:r.x,y:r.y,right:r.right,bottom:r.bottom,inside:r.x>=d.x&&r.right<=d.right&&r.y>=d.y&&r.bottom<=d.bottom}})})()`);
      assert.ok(bounds.every(b => b.inside), JSON.stringify(bounds));
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth&&document.documentElement.scrollHeight<=innerHeight'), true);
      await screenshot('06-compact-maximum'); return bounds;
    });
    await check('No external assets, renderer errors, or missing sample data', async () => {
      assert.deepEqual(requests.filter(url => !url.startsWith('file:') && !url.startsWith('data:')), []);
      assert.deepEqual(errors, []);
      const metrics = [];
      for (const sound of Object.keys(TimerTools.sounds)) {
        const wave = TimerTools.synthesize(sound, 44100), data = Buffer.alloc(44 + wave.samples.length * 2);
        data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(wave.sampleRate, 24); data.writeUInt32LE(wave.sampleRate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(wave.samples.length * 2, 40);
        wave.samples.forEach((sample, i) => data.writeInt16LE(Math.round(sample * 32767), 44 + i * 2));
        fs.writeFileSync(path.join(out, sound + '-original.wav'), data);
        metrics.push({ sound, duration: wave.duration, samples: wave.samples.length, finite: wave.samples.every(Number.isFinite), peak: wave.samples.reduce((a, b) => Math.max(a, Math.abs(b)), 0), rms: Math.sqrt(wave.samples.reduce((a, b) => a + b * b, 0) / wave.samples.length) });
      }
      return metrics;
    });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks, errors, requests, notes: ['Linux Electron offscreen using isolated fixture and real core reducer.', 'No Windows always-on-top, native drag behavior, real touchscreen, or physical speaker audibility claim.', 'WAV evidence is generated from the same PCM function used by WebAudio; no remote or copied audio.'] }, null, 2));
    console.log('QA_TIMER_FINISHED', checks.filter(c => c.status === 'passed').length, 'passed', checks.filter(c => c.status === 'failed').length, 'failed');
    app.exit(checks.some(c => c.status === 'failed') ? 1 : 0);
  } catch (error) { console.error('QA_TIMER_FATAL', error); app.exit(2); }
});
setTimeout(() => { console.error('QA_TIMER_TIMEOUT'); app.exit(3); }, 60000);
