'use strict';
// Real Electron main/preload/renderer/IPC. Every name and roster is synthetic.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const electron = require('electron');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'artifacts', 'qa-draw');
fs.mkdirSync(out, { recursive: true });
if (typeof electron === 'string') {
  const { spawnSync } = require('node:child_process');
  const flags = process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] : [];
  const run = spawnSync(electron, [...flags, __filename], { cwd: root, encoding: 'utf8', timeout: 100_000, maxBuffer: 10 * 1024 * 1024 });
  const log = (run.stdout || '') + (run.stderr || ''); fs.writeFileSync(path.join(out, 'electron.log'), log);
  console.log(log.split('\n').filter(line => /^(PASS_DRAW|FAIL_DRAW|QA_DRAW|FATAL_DRAW)/.test(line)).join('\n'));
  if (run.error) console.error(run.error);
  process.exitCode = run.status === 0 && !run.error ? 0 : 1;
} else {
  runElectron(electron);
}
function runElectron({ app, BrowserWindow }) {
  const { createInitialState } = require('../src/core.cjs');
  const synthetic = createInitialState();
  synthetic.settings.className = '点名功能 · 纯合成测试班';
  synthetic.students = Array.from({ length: 25 }, (_, i) => ({ id: `s_draw_${i + 1}`, name: `合成同学${String(i + 1).padStart(2, '0')}`, group: `合成${i % 3 + 1}组`, score: 0, growth: 0, pet: ['owl', 'fox', 'bunny', 'cat'][i % 4], photo: '' }));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'flower-qa-draw-'));
  fs.writeFileSync(path.join(data, 'classroom.json'), JSON.stringify(synthetic));
  process.env.FLOWER_HEADLESS_TEST = '1'; process.env.FLOWER_DATA_DIR = data;
  app.disableHardwareAcceleration();
  const checks = [], errors = []; let main, draw;
  app.on('web-contents-created', (_event, contents) => contents.on('console-message', (event, level, message) => {
    const severity = event.level ?? level; if (severity === 'error' || severity >= 3) errors.push(event.message ?? message);
  }));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = (source, w = draw) => w.webContents.executeJavaScript(source, true);
  const state = () => js('classroom.get().then(data=>data.state)');
  const until = async (fn, label) => { for (let n = 0; n < 180; n++) { if (await fn()) return; await sleep(30); } throw Error('Timed out: ' + label); };
  const click = (selector, repetitions = 1) => js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Missing control');for(let n=0;n<${repetitions};n++)el.click();return true;})()`);
  const fill = (selector, value) => js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  const value = selector => js(`document.querySelector(${JSON.stringify(selector)})?.value`);
  const scoreSelector = id => `[data-draw-score="${id}"]`;
  const ready = w => until(() => js('!!window.classroom && !!document.querySelector("#app")?.innerText.trim()', w).catch(() => false), 'ready');
  const settle = () => until(() => js('!document.querySelector(".dt-draw")?.matches("[aria-busy=true]")'), 'draw controls enabled');
  const shot = async name => { await sleep(100); fs.writeFileSync(path.join(out, name + '.png'), (await draw.webContents.capturePage()).toPNG()); };
  async function check(name, run) {
    try { const detail = await run(); checks.push({ name, status: 'passed', detail }); console.log('PASS_DRAW', name); }
    catch (error) { checks.push({ name, status: 'failed', error: error.stack }); console.error('FAIL_DRAW', name, error.message); try { await shot('failure-' + checks.length); } catch {} }
  }
  require('../src/main.cjs');
  app.whenReady().then(async () => {
    try {
      await until(() => BrowserWindow.getAllWindows().length > 0, 'main');
      main = BrowserWindow.getAllWindows().find(window => window.flowerRole === 'main'); await ready(main);
      await js("classroom.window({command:'open',role:'draw'})", main);
      draw = BrowserWindow.getAllWindows().find(window => window.flowerRole === 'draw'); await ready(draw);
      draw.setContentSize(1020, 700); await sleep(100);
      await check('Real isolated draw window loads only synthetic roster', async () => {
        assert.equal(await js('typeof require'), 'undefined'); assert.equal(await js('typeof DrawTools'), 'object');
        assert.equal((await state()).students.length, 25); assert.ok((await state()).students.every(student => student.name.startsWith('合成同学')));
      });
      await check('Count 1 to 5 survives unrelated broadcast and input drafts', async () => {
        for (let n = 0; n < 4; n++) await click('[data-do="draw-count-plus"]');
        assert.equal(await value('#draw-count'), '5');
        await js("classroom.action({type:'timer.set',seconds:65})", main); await sleep(80);
        assert.equal(await value('#draw-count'), '5');
      });
      let ids;
      await check('Repeated draw clicks produce one five-person animated selection', async () => {
        await click('[data-do="draw"]', 3); await until(async () => (await state()).draw.lastIds.length === 5, 'five results'); await settle();
        ids = (await state()).draw.lastIds;
        assert.equal(new Set(ids).size, 5); assert.equal((await state()).draw.bag.length, 20);
        assert.equal(await js('document.querySelectorAll(".dt-result-row").length'), 5);
        assert.equal(await value('#draw-count'), '5'); await shot('01-five-results-1020x700');
      });
      await check('Individual +5 duplicate click commits once and preserves another row draft', async () => {
        await fill(scoreSelector(ids[0]), '5'); await fill(scoreSelector(ids[1]), '2');
        const before = (await state()).logs.length;
        await click(`[data-do="draw-reward"][data-id="${ids[0]}"]`, 3);
        await until(async () => (await state()).logs.length === before + 1, 'individual award'); await settle();
        assert.equal((await state()).students.find(student => student.id === ids[0]).score, 5);
        assert.equal((await state()).students.find(student => student.id === ids[0]).growth, 5);
        assert.equal(await value(scoreSelector(ids[0])), ''); assert.equal(await value(scoreSelector(ids[1])), '2');
        assert.match(await js('document.querySelector("#toast").innerText'), /\+5 分成功/); await shot('02-individual-plus5');
      });
      await check('Batch validates all rows then submits mixed values atomically, skipping blanks', async () => {
        await fill(scoreSelector(ids[2]), '5'); await fill(scoreSelector(ids[3]), '101');
        const before = (await state()).logs.length;
        await click('[data-do="draw-reward-batch"]'); await sleep(80);
        assert.equal((await state()).logs.length, before); assert.equal(await value(scoreSelector(ids[1])), '2');
        await fill(scoreSelector(ids[3]), ''); await click('[data-do="draw-reward-batch"]', 3);
        await until(async () => (await state()).logs.length === before + 2, 'mixed awards'); await settle();
        const s = await state(); assert.equal(s.students.find(student => student.id === ids[1]).score, 2);
        assert.equal(s.students.find(student => student.id === ids[2]).score, 5); assert.equal(s.students.find(student => student.id === ids[3]).score, 0);
        assert.equal(await value(scoreSelector(ids[1])), ''); assert.equal(await value(scoreSelector(ids[2])), '');
      });
      await check('Uniform +5 applies to each drawn student once and retains independent drafts', async () => {
        await fill('#draw-uniform-delta', '5'); await fill(scoreSelector(ids[4]), '7');
        const before = await state(); await click('[data-do="reward-picked"]', 3);
        await until(async () => (await state()).logs.length === before.logs.length + 1, 'uniform award'); await settle();
        const after = await state();
        for (const id of ids) assert.equal(after.students.find(student => student.id === id).score, before.students.find(student => student.id === id).score + 5);
        assert.equal(await value(scoreSelector(ids[4])), '7'); assert.equal(await value('#draw-uniform-delta'), '5');
        assert.match(await js('document.querySelector("#toast").innerText'), /5 位同学各 \+5 分成功/); await shot('03-uniform-plus5');
      });
      await check('Cross-window timer and score broadcasts preserve current drafts', async () => {
        await js(`classroom.action({type:'score',ids:[${JSON.stringify(ids[0])}],delta:1})`, main);
        await js("classroom.action({type:'timer.set',seconds:66})", main); await sleep(80);
        assert.equal(await value(scoreSelector(ids[4])), '7'); assert.equal(await value('#draw-uniform-delta'), '5');
      });
      await check('Continue draw finishes all 25 without repeating this round', async () => {
        const seen = new Set(ids);
        for (let batch = 0; batch < 4; batch++) {
          const before = (await state()).revision; await click('[data-do="draw"]');
          await until(async () => (await state()).revision > before, 'continue draw'); await settle();
          const next = (await state()).draw.lastIds;
          for (const id of next) { assert.equal(seen.has(id), false); seen.add(id); }
          assert.equal(await value('#draw-uniform-delta'), '5');
          assert.ok(await js('[...document.querySelectorAll("[data-draw-score]")].every(input=>input.value==="")'));
        }
        assert.equal(seen.size, 25); assert.equal((await state()).draw.bag.length, 0);
        assert.match(await js('document.querySelector(".dt-footer").innerText'), /本轮已结束/);
      });
      await check('Twenty-row result at 700x700 scrolls internally without horizontal overflow', async () => {
        await click('[data-do="draw-reset"]'); await until(async () => !(await state()).draw.lastIds.length, 'reset');
        await fill('#draw-count', '20'); await click('[data-do="draw"]');
        await until(async () => (await state()).draw.lastIds.length === 20, 'twenty results'); await settle();
        draw.setContentSize(700, 700); await sleep(140);
        const layout = await js(`(()=>{const list=document.querySelector('.dt-result-list');const footer=document.querySelector('.dt-footer');return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,listWidth:list.getBoundingClientRect().width,listRight:list.getBoundingClientRect().right,scrollHeight:list.scrollHeight,listHeight:list.clientHeight,footerBottom:footer.getBoundingClientRect().bottom,rows:document.querySelectorAll('.dt-result-row').length};})()`);
        assert.equal(layout.rows, 20); assert.ok(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));
        assert.ok(layout.listRight <= layout.width, JSON.stringify(layout)); assert.ok(layout.scrollHeight > layout.listHeight, JSON.stringify(layout));
        assert.ok(layout.footerBottom <= layout.height, JSON.stringify(layout)); await shot('04-twenty-results-700x700');
        await js("document.querySelector('.dt-result-list').scrollTop=10000"); await shot('05-twenty-results-scrolled');
        return layout;
      });
      await check('Integrated renderer produced no console errors', async () => { assert.deepEqual(errors, []); });
      const summary = { passed: checks.filter(check => check.status === 'passed').length, failed: checks.filter(check => check.status === 'failed').length, checks, syntheticDataOnly: true, environment: 'Linux real Electron with native main/preload/renderer IPC; headless display', dataPath: data };
      fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(summary, null, 2));
      console.log('QA_DRAW_COMPLETE', summary.passed, 'passed', summary.failed, 'failed'); app.exit(summary.failed ? 1 : 0);
    } catch (error) { console.error('FATAL_DRAW', error.stack); app.exit(2); }
  });
}
