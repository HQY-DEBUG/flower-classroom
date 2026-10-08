'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const TimerTools = require('../src/timer-tools.js');
const { createInitialState, applyAction } = require('../src/core.cjs');
const source = fs.readFileSync(require.resolve('../src/timer-tools.js'), 'utf8');
const NOW = 1_000_000;
const timer = (seconds = 300) => ({ durationMs: seconds * 1000, remainingMs: seconds * 1000, endsAt: null, running: false });
function browser(extra = {}) { const root = { Date, ...extra }; vm.runInNewContext(source, root); return root; }
function inputValue(html, id) { return Number(html.match(new RegExp(`id="${id}"[^>]*value="([^"]*)"`))[1]); }

test('browser global and CommonJS expose the same UI API', () => {
  const global = browser();
  assert.deepEqual(Object.keys(global.TimerTools), Object.keys(TimerTools));
  for (const compact of [false, true]) {
    const html = TimerTools.view(timer(310), { compact, sound: 'applause' });
    for (const action of ['timer-set', 'timer-toggle', 'timer-reset', 'tt-adjust', 'tt-select', 'tt-sound', 'tt-return']) assert.ok(html.includes(`data-do="${action}"`), action);
    for (const name of ['滴答', '鼓掌', '飞弹']) assert.ok(html.includes(name));
    assert.ok(html.includes('role="timer" aria-label="剩余5分10秒"'));
    assert.equal(inputValue(html, 'timer-minutes'), 5); assert.equal(inputValue(html, 'timer-seconds'), 10);
    assert.equal(html.includes('tt-compact'), compact);
  }
});

test('minute/second validation permits 1s and 180m and rejects ambiguous or outside values', () => {
  for (const [m, s, total] of [[0, 1, 1], ['0', '59', 59], [1, 0, 60], [179, 59, 10799], [180, 0, 10800]]) assert.equal(TimerTools.validateInput(m, s), total);
  for (const pair of [[0, 0], [180, 1], [-1, 59], [0, 60], [1.5, 0], [NaN, 1], [Infinity, 0], ['', '1'], [null, 1], ['x', 1], ['1e2', 1], ['1.2', 1]]) assert.throws(() => TimerTools.validateInput(...pair));
});

test('adjustment changes only the selected unit, carries seconds and clamps total bounds', () => {
  assert.equal(TimerTools.adjustedSeconds(timer(59), 'seconds', 1), 60);
  assert.equal(TimerTools.adjustedSeconds(timer(60), 'seconds', -1), 59);
  assert.equal(TimerTools.adjustedSeconds(timer(310), 'minutes', 1), 370);
  assert.equal(TimerTools.adjustedSeconds(timer(310), 'minutes', -1), 250);
  assert.equal(TimerTools.adjustedSeconds(timer(1), 'seconds', -1), 1);
  assert.equal(TimerTools.adjustedSeconds(timer(10), 'minutes', -1), 1);
  assert.equal(TimerTools.adjustedSeconds(timer(10800), 'seconds', 1), 10800);
  assert.equal(TimerTools.adjustedSeconds(timer(10799), 'minutes', 1), 10800);
  assert.throws(() => TimerTools.adjustedSeconds(timer(), 'hours', 1));
  assert.throws(() => TimerTools.adjustedSeconds(timer(), 'seconds', 2));
});

test('wall-clock readout handles pauses, expiry, sleep elapsed time, and backwards clock', () => {
  const running = { ...timer(60), running: true, endsAt: NOW + 5000 };
  assert.equal(TimerTools.secondsLeft(running, NOW), 5);
  assert.equal(TimerTools.secondsLeft(running, NOW + 1), 5);
  assert.equal(TimerTools.secondsLeft(running, NOW + 120000), 0);
  assert.equal(TimerTools.secondsLeft(running, NOW - 120000), 60);
  assert.equal(TimerTools.secondsLeft({ ...timer(60), remainingMs: 1550 }, NOW), 2);
  assert.deepEqual(TimerTools.tick(running, NOW + 5000), { seconds: 0, text: '00:00', accessible: '剩余0分0秒' });
});

test('pause displays remaining inputs; reset restores configured time; expiry offers start', () => {
  let s = applyAction(createInitialState(), { type: 'timer.set', seconds: 65 }, NOW);
  s = applyAction(s, { type: 'timer.start' }, NOW);
  s = applyAction(s, { type: 'timer.pause' }, NOW + 1600);
  let html = TimerTools.view(s.timer);
  assert.equal(inputValue(html, 'timer-minutes'), 1); assert.equal(inputValue(html, 'timer-seconds'), 4);
  s = applyAction(s, { type: 'timer.reset' }, NOW + 2000);
  html = TimerTools.view(s.timer);
  assert.equal(inputValue(html, 'timer-minutes'), 1); assert.equal(inputValue(html, 'timer-seconds'), 5);
  html = TimerTools.view({ ...s.timer, remainingMs: 0 });
  assert.match(html, /data-do="timer-toggle">开始</);
  assert.match(html, /时间到啦/);
});

test('draft input survives unrelated render but resets when timer state changes', () => {
  const t = timer(65), fields = { '#timer-minutes': { value: '2' }, '#timer-seconds': { value: '07' } };
  const widget = { dataset: { timerState: '65000|65000||false' }, querySelector: s => fields[s] };
  const tools = browser({ document: { querySelector: () => widget } }).TimerTools;
  assert.equal(inputValue(tools.view(t), 'timer-minutes'), 2);
  assert.equal(inputValue(tools.view(t), 'timer-seconds'), 7);
  assert.equal(inputValue(tools.view(timer(66)), 'timer-minutes'), 1);
  assert.equal(inputValue(tools.view(timer(66)), 'timer-seconds'), 6);
});

test('repeated reset or same preset discards a dirty draft even when timer values stay unchanged', async () => {
  const t = timer(65), fields = { '#timer-minutes': { value: '2' }, '#timer-seconds': { value: '07' } };
  const widget = { dataset: { timerState: '65000|65000||false' }, querySelector: s => fields[s] };
  const tools = browser({ document: { querySelector: () => widget, querySelectorAll: () => [widget] } }).TimerTools;
  for (const action of ['timer-reset', 'timer-preset']) {
    widget.dataset.timerState = '65000|65000||false';
    assert.equal(await tools.handle(action, {}, {}), false);
    const html = tools.view(t);
    assert.equal(inputValue(html, 'timer-minutes'), 1); assert.equal(inputValue(html, 'timer-seconds'), 5);
  }
});

test('adjust action delegates to timer.set and stops old timer through existing reducer', async () => {
  let s = applyAction(createInitialState(), { type: 'timer.set', seconds: 65 }, Date.now());
  s = applyAction(s, { type: 'timer.start' }, Date.now());
  const tools = browser().TimerTools, calls = [];
  const context = { state: s, act: async a => { calls.push(a); s = applyAction(s, JSON.parse(JSON.stringify(a)), Date.now()); return true; } };
  await tools.handle('tt-select', { dataset: { unit: 'seconds' } }, context);
  assert.equal(await tools.handle('tt-adjust', { dataset: { delta: '1' } }, context), true);
  assert.equal(calls[0].type, 'timer.set'); assert.equal(calls[0].seconds, 66);
  assert.equal(s.timer.running, false); assert.equal(s.timer.endsAt, null); assert.equal(s.timer.remainingMs, 66000);
  assert.equal(await tools.handle('timer-toggle', {}, context), false);
});

test('concurrent adjustment is bounded during IPC; failures release its lock', async () => {
  const tools = browser().TimerTools; let resolve, count = 0;
  const context = { state: { timer: timer() }, act: () => { count++; return new Promise(r => { resolve = r; }); } };
  const first = tools.handle('tt-adjust', { dataset: { delta: '1' } }, context);
  await tools.handle('tt-adjust', { dataset: { delta: '1' } }, context); assert.equal(count, 1);
  resolve(false); await first;
  context.act = async () => { count++; throw Error('IPC failed'); };
  await assert.rejects(() => tools.handle('tt-adjust', { dataset: { delta: '1' } }, context));
  context.act = async () => { count++; return true; };
  await tools.handle('tt-adjust', { dataset: { delta: '1' } }, context); assert.equal(count, 3);
});

test('sound selector sends the exact persistent ID and reports unavailable audio', async () => {
  const tools = browser().TimerTools, actions = [], notices = [];
  const context = { state: { timer: timer() }, act: async a => { actions.push(a); return true; }, toast: s => notices.push(s) };
  for (const sound of Object.keys(TimerTools.sounds)) await tools.handle('tt-sound', { dataset: { sound } }, context);
  assert.equal(JSON.stringify(actions), JSON.stringify(['tick', 'applause', 'laser'].map(sound => ({ type: 'timer.sound', sound }))));
  assert.equal(notices.length, 3); assert.ok(notices.every(s => s.includes('无法播放响铃')));
  await tools.handle('tt-sound', { dataset: { sound: 'bad' } }, context); assert.equal(actions.length, 3);
});

test('return closes floating timer and returns main view via navigation', async () => {
  const actions = []; const tools = browser().TimerTools;
  await tools.handle('tt-return', {}, { role: 'timer', api: { window: async a => actions.push(a) } });
  assert.equal(JSON.stringify(actions), '[{"command":"close"}]');
  let clicked = false; const mainTools = browser({ document: { querySelector: () => ({ click: () => { clicked = true; } }) } }).TimerTools;
  await mainTools.handle('tt-return', {}, { role: 'main' }); assert.equal(clicked, true);
});

test('all three original bells are complete, deterministic, finite, nonempty, bounded, and distinct', () => {
  const hashes = [];
  for (const sound of Object.keys(TimerTools.sounds)) {
    for (const sampleRate of [8000, 44100, 48000, 192000]) {
      const wave = TimerTools.synthesize(sound, sampleRate);
      assert.equal(wave.samples.length, Math.ceil(wave.duration * sampleRate));
      assert.ok(wave.duration >= 1 && wave.duration <= 2);
      assert.ok(wave.samples.every(Number.isFinite));
      assert.ok(wave.samples.every(v => Math.abs(v) <= .62));
      const power = wave.samples.reduce((sum, v) => sum + v * v, 0) / wave.samples.length;
      assert.ok(power > .001, `${sound} audible nonzero signal`);
      assert.equal(wave.samples[0], 0); assert.equal(Math.abs(wave.samples.at(-1)), 0);
      if (sampleRate === 44100) hashes.push(crypto.createHash('sha256').update(Buffer.from(wave.samples.buffer)).digest('hex'));
    }
    assert.deepEqual(TimerTools.synthesize(sound).samples, TimerTools.synthesize(sound).samples);
  }
  assert.equal(new Set(hashes).size, 3);
  for (const bad of [0, Infinity, 1.2, 192001]) assert.throws(() => TimerTools.synthesize('tick', bad));
  assert.throws(() => TimerTools.synthesize('other'));
});

test('WebAudio playback receives complete generated buffers, resumes, and replaces prior sound', async () => {
  const buffers = [], sources = []; let resumed = 0;
  class AudioContext {
    constructor() { this.state = 'suspended'; this.sampleRate = 44100; this.destination = {}; }
    async resume() { resumed++; this.state = 'running'; }
    createBuffer(channels, length, rate) { const buffer = { channels, length, rate, copyToChannel: data => { buffer.data = data; } }; buffers.push(buffer); return buffer; }
    createBufferSource() { const source = { connect() {}, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; } }; sources.push(source); return source; }
  }
  const tools = browser({ AudioContext }).TimerTools;
  for (const sound of ['tick', 'applause', 'laser']) { const result = await tools.play(sound); assert.equal(result.ok, true); }
  assert.equal(resumed, 1); assert.equal(buffers.length, 3);
  buffers.forEach(b => { assert.equal(b.data.length, b.length); assert.equal(b.channels, 1); assert.ok(b.data.some(v => v !== 0)); });
  assert.ok(sources.every(s => s.started)); assert.ok(sources[0].stopped); assert.ok(sources[1].stopped);
  sources[2].onended(); assert.ok(sources[2].disconnected);
});

test('suspended/failed WebAudio returns an explicit failure instead of claiming playback', async () => {
  class AudioContext { constructor() { this.state = 'suspended'; } async resume() { throw Error('audio denied'); } }
  const tools = browser({ AudioContext }).TimerTools;
  const result = await tools.play('tick'); assert.equal(result.ok, false); assert.equal(result.error, 'audio denied');
});
