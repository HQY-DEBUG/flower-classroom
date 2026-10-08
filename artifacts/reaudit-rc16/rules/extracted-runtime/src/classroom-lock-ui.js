/* Local application lock; independent from app.js rendering and classroom data. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.ClassroomLockUI = api; api.init(); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const document = root.document;
  let initialized = false, overlay, card, mode = '', busy = false, inFlight = false, status = null;
  let digits = [], activeField = '', previousFocus, observer, resizeCompact;
  let eventRevision = 0;
  const protectedSiblings = new Map();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const bridge = () => root.classroom;
  const isProtected = () => !!mode;
  const compact = () => root.innerWidth < 280 || root.innerHeight < 340;

  function shuffledDigits(previous = []) {
    const next = Array.from({ length: 10 }, (_, index) => String(index));
    const random = max => {
      if (root.crypto?.getRandomValues) {
        const buffer = new Uint32Array(1), limit = 0x100000000 - (0x100000000 % max);
        do { root.crypto.getRandomValues(buffer); } while (buffer[0] >= limit);
        return buffer[0] % max;
      }
      return Math.floor(Math.random() * max);
    };
    for (let index = next.length - 1; index > 0; index--) {
      const other = random(index + 1); [next[index], next[other]] = [next[other], next[index]];
    }
    // Each new lock visibly changes the arrangement, even in the rare case of
    // an identical random permutation. The keypad is a convenience, not crypto.
    if (next.join('') === previous.join('')) [next[0], next[1]] = [next[1], next[0]];
    return next;
  }
  function isolate() {
    if (!overlay || !isProtected()) return;
    if (!overlay.isConnected) document.body.append(overlay);
    for (const sibling of document.body.children) {
      if (sibling === overlay || ['SCRIPT', 'LINK', 'STYLE'].includes(sibling.tagName)) continue;
      if (!protectedSiblings.has(sibling)) protectedSiblings.set(sibling, { inert: sibling.inert, hidden: sibling.getAttribute('aria-hidden') });
      if (!sibling.inert) sibling.inert = true;
      if (sibling.getAttribute('aria-hidden') !== 'true') sibling.setAttribute('aria-hidden', 'true');
    }
  }
  function restore() {
    for (const [sibling, prior] of protectedSiblings) {
      if (!sibling.isConnected) continue;
      sibling.inert = prior.inert;
      if (prior.hidden === null) sibling.removeAttribute('aria-hidden');
      else sibling.setAttribute('aria-hidden', prior.hidden);
    }
    protectedSiblings.clear();
  }
  function focusable() {
    return [...(overlay?.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]') || [])].filter(el => el.getClientRects().length && !el.closest('[hidden]'));
  }
  function focusFirst() {
    const target = overlay?.querySelector('input:not(:disabled)') || focusable()[0] || card;
    target?.focus({ preventScroll: true });
  }
  function notice(message = '') {
    const target = overlay?.querySelector('.cl-message');
    if (target) { target.textContent = message; target.classList.toggle('cl-error', !!message); }
  }
  function clearSecrets() {
    for (const input of overlay?.querySelectorAll('input') || []) input.value = '';
  }
  function setBusy(value) {
    busy = value;
    card?.setAttribute('aria-busy', String(value));
    for (const element of overlay?.querySelectorAll('input,button') || []) element.disabled = value;
    const submit = overlay?.querySelector('[data-lock-action="submit"]');
    if (submit) submit.textContent = value ? '正在验证…' : mode === 'setup' ? '设置并锁定' : mode === 'change' ? '保存新密码' : '解锁课堂';
  }
  function close() {
    clearSecrets(); mode = ''; busy = false;
    overlay.hidden = true;
    document.body.classList.remove('classroom-lock-visible');
    restore();
    if (previousFocus?.isConnected && !previousFocus.inert) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
  }
  const field = (id, label, autocomplete) => `<label class="cl-field" for="${id}"><span>${label}</span><input id="${id}" type="password" inputmode="numeric" pattern="[0-9]{4,12}" minlength="4" maxlength="12" autocomplete="${autocomplete}" spellcheck="false" autocapitalize="off" aria-label="${label}" placeholder="4–12 位数字"></label>`;
  function keypad() {
    return `<div class="cl-keypad" aria-label="随机数字键盘">${digits.slice(0, 9).map(digit => `<button type="button" data-lock-digit="${digit}" aria-label="数字 ${digit}">${digit}</button>`).join('')}<button type="button" class="cl-key-action" data-lock-action="clear" aria-label="清空密码">清空</button><button type="button" data-lock-digit="${digits[9]}" aria-label="数字 ${digits[9]}">${digits[9]}</button><button type="button" class="cl-key-action" data-lock-action="backspace" aria-label="删除最后一位">⌫</button></div>`;
  }
  function render() {
    if (!mode) return;
    const small = compact();
    resizeCompact = small;
    overlay.dataset.mode = mode;
    overlay.classList.toggle('cl-compact', small);
    const locked = mode === 'locked';
    const settings = mode === 'setup' || mode === 'change';
    overlay.classList.toggle('cl-settings', settings);
    let body;
    if (mode === 'pending') body = '<h2 id="cl-heading">正在确认课堂状态</h2><p class="cl-description">请稍候…</p>';
    else if (mode === 'blocked') body = '<h2 id="cl-heading">课堂保持保护</h2><p class="cl-description">课堂锁配置暂时无法读取。请保留数据目录并联系管理员检查。</p><button type="button" class="cl-primary" data-lock-action="refresh">重新检查</button>';
    else if (mode === 'unavailable') body = '<h2 id="cl-heading">课堂暂时无法打开</h2><p class="cl-description">应用未能完成启动通信，课堂仍保持保护。请重新检查或重新启动应用，课堂数据和密码不会被重置。</p><button type="button" class="cl-primary" data-lock-action="refresh">重新检查</button>';
    else if (small) body = `${settings ? '' : '<h2 id="cl-heading">课堂已锁定</h2>'}<p class="cl-description">请到主窗口${locked ? '解锁' : '设置'}</p><button type="button" class="cl-primary" data-lock-action="main">主窗${locked ? '解锁' : '设置'}</button>`;
    else if (locked) body = `<span class="cl-eyebrow">安心专注 · 课堂暂停操作</span><h2 id="cl-heading">课堂已锁定</h2><p class="cl-description">输入课堂密码，回到我们的课堂</p>${field('cl-pin', '课堂密码', 'off')}${keypad()}<button type="button" class="cl-primary" data-lock-action="submit">解锁课堂</button><p class="cl-note">仅保护本应用 · 不会锁定电脑</p>`;
    else body = `<span class="cl-eyebrow">老师专属 · 课堂密码</span><p class="cl-description">${mode === 'setup' ? '首次使用请自行设置 4–12 位数字密码' : '验证当前密码后，设置新的数字密码'}</p>${mode === 'change' ? field('cl-old-pin', '当前密码', 'off') : ''}${field('cl-new-pin', '新密码', 'new-password')}${field('cl-repeat-pin', '再次输入新密码', 'new-password')}${keypad()}<div class="cl-form-actions"><button type="button" class="cl-cancel" data-lock-action="cancel">取消</button><button type="button" class="cl-primary" data-lock-action="submit">${mode === 'setup' ? '设置并锁定' : '保存新密码'}</button></div><p class="cl-note">请妥善记住密码 · 课堂备份不包含密码</p>`;
    const header = settings ? `<header class="cl-settings-header"><h2 id="cl-heading">${mode === 'setup' ? '设置课堂密码' : '修改课堂密码'}</h2><button type="button" class="cl-cancel cl-header-cancel" data-lock-action="cancel" aria-label="取消${mode === 'setup' ? '设置' : '修改'}课堂密码">取消</button></header>` : '';
    card.innerHTML = `${header}${settings ? '<div class="cl-settings-content">' : ''}<div class="cl-lock-mark" aria-hidden="true"><svg viewBox="0 0 32 36" fill="none"><rect x="5" y="15" width="22" height="17" rx="5" stroke="currentColor" stroke-width="2.3"/><path d="M10 15V9a6 6 0 0 1 12 0v6" stroke="currentColor" stroke-width="2.3"/><circle cx="16" cy="23" r="2" fill="currentColor"/><path d="M16 25v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>${body}<p class="cl-message" role="status" aria-live="polite"></p>${settings ? '</div>' : ''}`;
    activeField = card.querySelector('input')?.id || '';
    isolate(); focusFirst();
  }
  function show(nextMode, reshuffle = true) {
    if (!mode) previousFocus = document.activeElement;
    clearSecrets(); mode = nextMode; busy = inFlight;
    if (reshuffle) digits = shuffledDigits(digits);
    overlay.hidden = false;
    document.body.classList.add('classroom-lock-visible');
    render(); if (inFlight) setBusy(true);
  }
  function accept(next) {
    if (!next || typeof next.locked !== 'boolean' || typeof next.configured !== 'boolean' || typeof next.blocked !== 'boolean') { status = null; show('unavailable', false); return; }
    const wasLocked = status?.locked; status = { configured: next.configured, locked: next.locked, blocked: next.blocked };
    if (status.blocked) { if (mode !== 'blocked') show('blocked', false); }
    else if (status.locked) { if (mode !== 'locked' || !wasLocked) show('locked'); }
    else if (mode === 'locked' || mode === 'pending' || mode === 'blocked' || mode === 'unavailable') close();
  }
  async function refresh() {
    if (!initialized) return;
    const revision = eventRevision;
    try {
      const next = await bridge().lock({ command: 'status' });
      if (revision === eventRevision) accept(next);
    } catch (_) { if (revision === eventRevision) { status = null; show('unavailable', false); } }
  }
  async function openForm(nextMode) {
    if (!initialized || busy || inFlight) return;
    await refresh();
    if (!status || status.blocked || status.locked) return;
    if (nextMode === 'setup' && status.configured) nextMode = 'change';
    if (nextMode === 'change' && !status.configured) nextMode = 'setup';
    show(nextMode);
  }
  function inputValue(id) { return overlay.querySelector('#' + id)?.value || ''; }
  function edit(value) {
    if (busy) return;
    const input = overlay.querySelector('#' + activeField) || overlay.querySelector('input');
    if (!input) return;
    const start = input.selectionStart ?? input.value.length, end = input.selectionEnd ?? start;
    if (value === 'clear') input.value = '';
    else if (value === 'backspace') {
      input.value = input.value.slice(0, Math.max(0, start - (start === end ? 1 : 0))) + input.value.slice(end);
      input.setSelectionRange(Math.max(0, start - 1), Math.max(0, start - 1));
    } else {
      const next = input.value.slice(0, start) + value + input.value.slice(end);
      if (next.length <= 12) { input.value = next; input.setSelectionRange(start + value.length, start + value.length); }
    }
    input.focus({ preventScroll: true }); notice();
  }
  async function submit() {
    if (busy || inFlight || !['locked', 'setup', 'change'].includes(mode)) return;
    const submittingMode = mode;
    const command = mode === 'locked' ? 'unlock' : mode;
    const request = { command };
    if (mode === 'locked') request.pin = inputValue('cl-pin');
    else { request.pin = inputValue('cl-new-pin'); request.newPin = request.pin; request.repeat = inputValue('cl-repeat-pin'); if (mode === 'change') request.oldPin = inputValue('cl-old-pin'); }
    if (!/^[0-9]{4,12}$/.test(request.pin)) { notice('请输入 4–12 位数字密码'); return; }
    if (mode !== 'locked' && request.pin !== request.repeat) { notice('两次输入不一致，请重新输入'); return; }
    const startedRevision = eventRevision;
    inFlight = true; setBusy(true); notice();
    try {
      const result = await bridge().lock(request);
      // A response from this window can arrive after another window has locked
      // the classroom again. Never replace a newer broadcast with that result.
      if (eventRevision === startedRevision) accept(result);
      else await refresh();
      if (result?.ok) {
        if (command === 'change' && mode === submittingMode && status && !status.locked && !status.blocked) close();
      } else {
        clearSecrets();
        notice(result?.message || '操作未完成，请重试');
      }
    } catch (_) { clearSecrets(); notice('操作未完成，课堂状态没有改变。请重试'); }
    finally {
      // Remove secret properties as soon as the IPC call finishes.
      for (const key of ['pin', 'repeat', 'newPin', 'oldPin']) delete request[key];
      inFlight = false; setBusy(false); if (mode) focusFirst();
    }
  }
  function cancel() { if (!busy && (mode === 'setup' || mode === 'change')) close(); }
  function onKey(event) {
    if (!isProtected()) return;
    // No application hotkeys behind the lock, including Escape to close a modal.
    event.stopImmediatePropagation();
    if (event.key === 'Tab') {
      const targets = focusable(), first = targets[0], last = targets.at(-1);
      if (!first) { event.preventDefault(); card.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
    if (busy) { event.preventDefault(); return; }
    if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[0-9]$/.test(event.key)) { event.preventDefault(); edit(event.key); }
    else if (event.key === 'Backspace') { event.preventDefault(); edit('backspace'); }
    else if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') { event.preventDefault(); void submit(); }
  }
  function init() {
    if (initialized || !document?.body || typeof bridge()?.lock !== 'function') return false;
    initialized = true;
    overlay = document.createElement('div'); overlay.id = 'classroom-lock-overlay'; overlay.className = 'cl-overlay'; overlay.hidden = true;
    card = document.createElement('section'); card.className = 'cl-card'; card.tabIndex = -1;
    card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true'); card.setAttribute('aria-labelledby', 'cl-heading');
    overlay.append(card); document.body.append(overlay);
    overlay.addEventListener('click', event => {
      const target = event.target.closest('button'); if (!target || busy) return;
      if (target.hasAttribute('data-lock-digit')) { edit(target.dataset.lockDigit); return; }
      const action = target.dataset.lockAction;
      if (action === 'submit') void submit();
      else if (action === 'cancel') cancel();
      else if (action === 'clear' || action === 'backspace') edit(action);
      else if (action === 'refresh') void refresh();
      else if (action === 'main') bridge().window({ command: 'open', role: 'main' }).catch(() => notice('请从任务栏打开课堂主窗口'));
    });
    overlay.addEventListener('focusin', event => { if (event.target.tagName === 'INPUT') activeField = event.target.id; });
    overlay.addEventListener('input', event => { if (event.target.tagName === 'INPUT') { event.target.value = event.target.value.replace(/[^0-9]/g, '').slice(0, 12); notice(); } });
    overlay.addEventListener('copy', event => { if (event.target.tagName === 'INPUT') event.preventDefault(); });
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', event => { if (isProtected() && !overlay.contains(event.target)) focusFirst(); }, true);
    observer = new root.MutationObserver(isolate);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert', 'aria-hidden'] });
    root.addEventListener('resize', () => { if (mode && compact() !== resizeCompact && !busy) { clearSecrets(); render(); } });
    bridge().onLock?.(next => { eventRevision++; accept(next); });
    bridge().onCommand?.(command => { if (command === 'lock-setup') void openForm('setup'); else if (command === 'lock-change') void openForm('change'); });
    show('pending', false); void refresh();
    return true;
  }
  return Object.freeze({ init, refresh, openSetup: () => openForm('setup'), openChange: () => openForm('change'), shuffledDigits });
});
