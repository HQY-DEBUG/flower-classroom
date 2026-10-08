/* Original local timer controls and synthesized bells. No network/audio assets. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TimerTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const LIMIT = 10800;
  const sounds = Object.freeze({ tick: '滴答', applause: '鼓掌', laser: '飞弹' });
  let selectedUnit = 'minutes';
  let audioContext;
  let activeSource;
  const pending = new Set();
  const resetDrafts = new WeakMap();
  const doc = () => root.document;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const timerKey = timer => [timer.durationMs, timer.remainingMs, timer.endsAt, !!timer.running].join('|');
  function secondsLeft(timer, now = Date.now()) {
    const ms = timer.running ? Math.max(0, Math.min(timer.durationMs, timer.endsAt - now)) : timer.remainingMs;
    return Math.max(0, Math.min(LIMIT, Math.ceil((Number(ms) || 0) / 1000)));
  }
  function parts(seconds) { return { minutes: Math.floor(seconds / 60), seconds: seconds % 60 }; }
  function label(seconds) { const p = parts(seconds); return `${p.minutes}分${p.seconds}秒`; }
  function format(seconds) { const p = parts(seconds); return `${String(p.minutes).padStart(2, '0')}:${String(p.seconds).padStart(2, '0')}`; }
  function validateInput(minutes, seconds) {
    // Reject blank strings, decimals, infinity, and implicit coercion such as null.
    const number = value => typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
    const m = number(minutes), s = number(seconds), total = m * 60 + s;
    if (!Number.isInteger(m) || !Number.isInteger(s) || m < 0 || m > 180 || s < 0 || s > 59 || total < 1 || total > LIMIT) {
      throw new Error('请输入 1 秒到 180 分钟的时间，秒数为 0–59');
    }
    return total;
  }
  function adjustedSeconds(timer, unit, direction, now = Date.now()) {
    if (!['minutes', 'seconds'].includes(unit) || ![-1, 1].includes(direction)) throw new Error('计时调整无效');
    return Math.max(1, Math.min(LIMIT, secondsLeft(timer, now) + direction * (unit === 'minutes' ? 60 : 1)));
  }
  function view(timer, options = {}) {
    const compact = !!options.compact;
    const defaultSeconds=Number.isInteger(options.defaultSeconds)&&options.defaultSeconds>=1&&options.defaultSeconds<=LIMIT?options.defaultSeconds:Math.ceil(timer.durationMs/1000);
    const sound = Object.hasOwn(sounds, options.sound) ? options.sound : 'tick';
    const left = secondsLeft(timer), p = parts(left), key = timerKey(timer);
    const old = doc()?.querySelector('.tt-timer');
    const same = old?.dataset.timerState === key;
    const m = same ? old.querySelector('#timer-minutes')?.value ?? p.minutes : p.minutes;
    const s = same ? old.querySelector('#timer-seconds')?.value ?? p.seconds : p.seconds;
    const editorOpen = compact && same && old?.querySelector('.tt-editor')?.open;
    const status = timer.running && left ? '专注中' : left === 0 ? '时间到啦' : timer.remainingMs < timer.durationMs ? '已暂停' : '准备就绪';
    const editor = `<div class="tt-editor-fields"><label>分<input id="timer-minutes" type="number" inputmode="numeric" min="0" max="180" step="1" value="${escape(m)}" aria-label="自定义分钟"></label><label>秒<input id="timer-seconds" type="number" inputmode="numeric" min="0" max="59" step="1" value="${escape(s)}" aria-label="自定义秒"></label><button class="button" data-do="timer-set">设定</button><span class="tt-editor-note">1 秒–180 分钟 · 设定后停止旧计时</span></div>`;
    return `<section class="tt-timer ${compact ? 'tt-compact' : 'tt-full'}" data-timer-state="${escape(key)}" data-selected-unit="${selectedUnit}" aria-label="课堂计时器">
      ${compact ? '' : '<div class="pill">◷ 给专注一点时间</div><h2>一段专心投入的时光</h2>'}
      <div class="tt-disc">
        <div class="tt-drag" aria-hidden="true">${compact ? '⠿ 拖动计时器' : '课堂计时'}</div>
        <div class="tt-top-controls" aria-label="调整计时与响铃">
          <button class="tt-control" data-do="tt-adjust" data-delta="-1" aria-label="减少选中的${selectedUnit === 'minutes' ? '分钟' : '秒'}">−</button>
          <button class="tt-control" data-do="tt-adjust" data-delta="1" aria-label="增加选中的${selectedUnit === 'minutes' ? '分钟' : '秒'}">＋</button>
          <details class="tt-sound"><summary aria-label="选择响铃，当前${sounds[sound]}" title="选择响铃"><span aria-hidden="true">♪</span><span class="tt-sound-name">${sounds[sound]}</span><span class="tt-caret" aria-hidden="true">⌄</span></summary><div class="tt-sound-menu" role="group" aria-label="到时响铃">${Object.entries(sounds).map(([id, name]) => `<button data-do="tt-sound" data-sound="${id}" aria-pressed="${sound === id}" class="${sound === id ? 'selected' : ''}"><span aria-hidden="true">♪</span> ${name}<span aria-hidden="true">${sound === id ? '✓' : ''}</span></button>`).join('')}<button class="tt-preview" data-do="tt-preview" data-sound="${sound}">试听当前响铃</button></div></details>
        </div>
        <div class="tt-clock" role="timer" aria-label="剩余${label(left)}" aria-live="off">
          <button class="tt-part ${selectedUnit === 'minutes' ? 'selected' : ''}" data-do="tt-select" data-unit="minutes" aria-pressed="${selectedUnit === 'minutes'}" aria-label="选择分钟，当前${p.minutes}分"><span class="tt-minutes">${p.minutes}</span><small>分</small></button>
          <span class="tt-colon" aria-hidden="true">:</span>
          <button class="tt-part ${selectedUnit === 'seconds' ? 'selected' : ''}" data-do="tt-select" data-unit="seconds" aria-pressed="${selectedUnit === 'seconds'}" aria-label="选择秒，当前${p.seconds}秒"><span class="tt-seconds">${String(p.seconds).padStart(2, '0')}</span><small>秒</small></button>
        </div>
        <strong class="timer-digits tt-sr-only">${format(left)}</strong>
        <p class="tt-status" role="status" aria-live="polite">${status}</p>
        <div class="tt-actions">
          <button class="button primary" data-do="timer-toggle">${timer.running && left ? '暂停' : '开始'}</button>
          <button class="button" data-do="timer-reset" title="重置为默认 ${label(defaultSeconds)}">重置为默认</button>
          <button class="button" data-do="tt-return">返回</button>
        </div>
        ${compact ? `<details class="tt-editor" ${editorOpen ? 'open' : ''}><summary>输入时长</summary>${editor}</details>` : '<span class="tt-disc-hint">点选分或秒，再用 − / ＋ 调整</span>'}
      </div>
      ${compact ? '' : `<div class="tt-config">${editor}<div class="timer-presets">${[1, 3, 5, 10].map(m => `<button class="button" data-do="timer-preset" data-seconds="${m * 60}">${m} 分钟</button>`).join('')}</div><button class="text-button" data-do="open-timer">打开悬浮计时器 ↗</button><p class="tt-note">按实际时间倒计时，隐藏窗口后仍继续；暂停保留剩余时间；重置使用已保存默认 ${label(defaultSeconds)}，设定时长会同步保存为默认</p></div>`}
    </section>`;
  }
  function selectUnit(unit) {
    if (!['minutes', 'seconds'].includes(unit)) return;
    selectedUnit = unit;
    for (const widget of doc()?.querySelectorAll('.tt-timer') || []) {
      widget.dataset.selectedUnit = unit;
      for (const el of widget.querySelectorAll('[data-do="tt-select"]')) {
        const chosen = el.dataset.unit === unit;
        el.classList.toggle('selected', chosen); el.setAttribute('aria-pressed', String(chosen));
      }
      for (const el of widget.querySelectorAll('[data-do="tt-adjust"]')) el.setAttribute('aria-label', `${Number(el.dataset.delta) < 0 ? '减少' : '增加'}选中的${unit === 'minutes' ? '分钟' : '秒'}`);
    }
  }
  async function handle(action, el, context) {
    // A reset or repeated preset can leave timer values unchanged, but still
    // intentionally discards an unsaved duration draft. The existing handler
    // remains responsible for the actual timer action.
    if (action === 'timer-reset' || action === 'timer-preset') {
      for (const widget of doc()?.querySelectorAll('.tt-timer') || []){resetDrafts.set(widget,{key:widget.dataset.timerState,minutes:widget.querySelector('#timer-minutes')?.value,seconds:widget.querySelector('#timer-seconds')?.value});widget.dataset.timerState = '';}
      return false;
    }
    if (!action.startsWith('tt-')) return false;
    const { state, act, toast = () => {}, api, role } = context;
    if (action === 'tt-select') { selectUnit(el.dataset.unit); return true; }
    if (action === 'tt-return') {
      if (role === 'timer') await api.window({ command: 'close' });
      else { const back = doc()?.querySelector('[data-page="students"]'); if (back) back.click(); else await api.window({ command: 'open', role: 'main' }); }
      return true;
    }
    if (action === 'tt-adjust') {
      // Bound repeated pointer events while a timer mutation is in flight.
      if (pending.has('adjust')) return true;
      pending.add('adjust');
      try { await act({ type: 'timer.set', seconds: adjustedSeconds(state.timer, selectedUnit, Number(el.dataset.delta)) }); }
      finally { pending.delete('adjust'); }
      return true;
    }
    if (action === 'tt-sound') {
      const sound = el.dataset.sound;
      if (!Object.hasOwn(sounds, sound)) { toast('请选择滴答、鼓掌或飞弹'); return true; }
      if (pending.has('sound')) return true;
      pending.add('sound');
      try {
        const ok = await act({ type: 'timer.sound', sound });
        if (ok !== false) {
          const menu = el.closest?.('details'); if (menu) menu.open = false;
          const result = await play(sound); if (!result.ok) toast(result.error);
        }
      } finally { pending.delete('sound'); }
      return true;
    }
    if (action === 'tt-preview') { const result = await play(el.dataset.sound || state.settings?.timerSound || 'tick'); if (!result.ok) toast(result.error); return true; }
    return false;
  }
  function settleReset(ok){
    for(const widget of doc()?.querySelectorAll('.tt-timer')||[]){const draft=resetDrafts.get(widget);if(!draft)continue;resetDrafts.delete(widget);if(ok!==false)continue;widget.dataset.timerState=draft.key;for(const [id,value]of [['timer-minutes',draft.minutes],['timer-seconds',draft.seconds]]){const field=widget.querySelector('#'+id);if(field&&value!==undefined)field.value=value;}}
  }
  function tick(timer, now = Date.now()) {
    const left = secondsLeft(timer, now), p = parts(left);
    for (const widget of doc()?.querySelectorAll('.tt-timer') || []) {
      const put = (selector, value) => { const el = widget.querySelector(selector); if (el && el.textContent !== value) el.textContent = value; };
      put('.tt-minutes', String(p.minutes)); put('.tt-seconds', String(p.seconds).padStart(2, '0'));
      put('.timer-digits', format(left));
      const clock = widget.querySelector('.tt-clock'); clock?.setAttribute('aria-label', `剩余${label(left)}`);
      widget.querySelector('[data-unit="minutes"]')?.setAttribute('aria-label', `选择分钟，当前${p.minutes}分`);
      widget.querySelector('[data-unit="seconds"]')?.setAttribute('aria-label', `选择秒，当前${p.seconds}秒`);
      put('.tt-status', timer.running && left ? '专注中' : left === 0 ? '时间到啦' : timer.remainingMs < timer.durationMs ? '已暂停' : '准备就绪');
      put('[data-do="timer-toggle"]', timer.running && left ? '暂停' : '开始');
    }
    return { seconds: left, text: format(left), accessible: `剩余${label(left)}` };
  }
  function synthesize(sound, sampleRate = 44100) {
    if (!Object.hasOwn(sounds, sound)) throw new Error('响铃类型无效');
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('响铃采样率无效');
    const duration = { tick: 1.15, applause: 1.8, laser: 1.4 }[sound];
    const samples = new Float32Array(Math.ceil(duration * sampleRate));
    let seed = 0x63e1af4b;
    const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2147483648 - 1; };
    for (let i = 0; i < samples.length; i++) {
      const t = i / sampleRate;
      let value = 0;
      if (sound === 'tick') {
        // Alternating dry wood-like clicks, entirely synthesized.
        for (const [j, start] of [0, .26, .52, .78].entries()) {
          const u = t - start;
          if (u >= 0 && u < .17) value += (Math.sin(2 * Math.PI * (j % 2 ? 1050 : 1450) * u) * .7 + noise() * .3) * Math.exp(-u * 47) * Math.min(1, u * 1800);
        }
      } else if (sound === 'applause') {
        // Layered, irregular broadband clap bursts with short room tails.
        for (const start of [0, .075, .19, .27, .4, .47, .6, .72, .79, .94, 1.07, 1.2, 1.28, 1.43]) {
          const u = t - start;
          if (u >= 0 && u < .31) value += noise() * Math.exp(-u * 24) * Math.min(1, u * 1200) * .48;
        }
      } else {
        // Three descending chirps create a clear arcade-style launch sound.
        for (const start of [0, .4, .8]) {
          const u = t - start;
          if (u >= 0 && u < .49) {
            const phase = 2 * Math.PI * (1400 * .105 * (1 - Math.exp(-u / .105)) + 95 * u);
            value += (Math.sin(phase) + Math.sin(phase * 2) * .18) * Math.exp(-u * 7) * Math.min(1, u * 180);
          }
        }
      }
      const fadeOut = Math.min(1, (samples.length - 1 - i) / (sampleRate * .025));
      samples[i] = Math.tanh(value) * .62 * Math.max(0, fadeOut);
    }
    return { sound, sampleRate, duration, samples };
  }
  async function play(sound = 'tick') {
    try {
      const Audio = root.AudioContext || root.webkitAudioContext;
      if (!Audio) throw new Error('当前环境无法播放响铃；时间到时仍会显示提示');
      if (!audioContext || audioContext.state === 'closed') audioContext = new Audio();
      if (audioContext.state === 'suspended') await audioContext.resume();
      if (audioContext.state !== 'running') throw new Error('响铃未能启动，请点击试听后重试；时间到时仍会显示提示');
      const wave = synthesize(sound, audioContext.sampleRate);
      const buffer = audioContext.createBuffer(1, wave.samples.length, wave.sampleRate);
      buffer.copyToChannel(wave.samples, 0);
      // Stop a previous preview in this renderer to avoid stacked sounds.
      if (activeSource) { activeSource.onended = null; try { activeSource.stop(); } catch (_) {} activeSource.disconnect(); }
      const source = audioContext.createBufferSource(); source.buffer = buffer; source.connect(audioContext.destination);
      source.onended = () => { source.disconnect(); if (activeSource === source) activeSource = null; };
      activeSource = source; source.start();
      return { ok: true, sound, duration: wave.duration };
    } catch (error) {
      return { ok: false, sound, error: error?.message || '响铃播放失败；时间到时仍会显示提示' };
    }
  }
  return Object.freeze({ view, handle, settleReset, tick, play, synthesize, sounds, validateInput, secondsLeft, adjustedSeconds });
});
