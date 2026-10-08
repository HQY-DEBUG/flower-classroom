/* Local draw rewards. Uses the existing draw/cycle reducer and animation. */
(function (root, factory) {
  'use strict';
  const api = factory(root, typeof module === 'object' && module.exports ? require('./organization-tools.js') : root.OrganizationTools);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DrawTools = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root, OrganizationTools) {
  'use strict';
  const REASON = '随机点名奖励';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const doc = () => root.document;
  const widget = () => doc()?.querySelector('.dt-draw');
  const rows = new Map();
  let activeKey = '', uniform = '1', busy = false, animating = false, generation = 0;
  const keyFor = state => OrganizationTools.drawKey(state);
  const candidates = (state,scope=state.draw.scope||'students') => scope==='groups'?[...new Set(state.students.map(v=>v.group))]:state.students.map(v=>v.id);
  function pickedStudents(state) {
    const byId = new Map(state.students.map(student => [student.id, student]));
    return state.draw.lastIds.map(id => byId.get(id)).filter(Boolean);
  }
  function validateDelta(value) {
    const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    const delta = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(delta) || delta < 1 || delta > 100) throw new Error('加分需为 1–100 的整数');
    return delta;
  }
  function capture() {
    const el = widget();
    if (!el || el.dataset.drawKey !== activeKey || el.dataset.drawGeneration !== String(generation)) return;
    for (const input of el.querySelectorAll('[data-draw-score]')) rows.set(input.dataset.drawScore, input.value);
    const all = el.querySelector('#draw-uniform-delta');
    if (all) uniform = all.value;
  }
  // Call before replacing a board. Stale DOM cannot refill a cleared draft.
  function reset() { rows.clear(); uniform = '1'; activeKey = ''; generation++; }
  // Also call after a successful new draw: repeat mode can return the same IDs.
  function resetResults() { capture(); rows.clear(); activeKey = ''; generation++; }
  function view(state, options = {}) {
    capture();
    const key = keyFor(state);
    if (key !== activeKey) { rows.clear(); activeKey = key; }
    animating = !!options.animating;
    const esc = options.esc || escape;
    const avatar = options.avatar || (student => `<span class="avatar initials">${esc(student.name.slice(-2))}</span>`);
    const petSvg = options.petSvg || (() => '<span class="dt-empty-star" aria-hidden="true">✦</span>');
    const picked = pickedStudents(state), locked = busy || animating, disabled = locked ? ' disabled' : '';
    const isGroups=state.draw.scope==='groups',unit=isGroups?'组':'人',groupRows=state.draw.groups||[];
    const maxCount = Math.max(1, Math.min(candidates(state).length, 20));
    const remaining = state.draw.mode === 'repeat' ? '允许跨次重复' : state.draw.bag.length ? `本轮待抽：${state.draw.bag.length} ${unit}` : state.draw.round ? '本轮已结束 · 下次开始新一轮' : `本轮待抽：${candidates(state).length} ${unit}`;
    const resultRows=isGroups?groupRows.map((group,index)=>`<section class="dt-group-result" role="listitem" data-draw-group="${esc(group.group)}"><div class="dt-group-result-title"><strong>${esc(group.group)}</strong><span>${group.ids.length} 位同学</span><label class="dt-score-field"><span class="dt-sr-only">给${esc(group.group)}每位成员加分</span><input id="draw-group-score-${index}" data-draw-score="${esc('group:'+group.group)}" type="number" inputmode="numeric" min="1" max="100" step="1" placeholder="每人加分" value="${esc(rows.get('group:'+group.group)||'')}"${disabled}></label><button class="button dt-confirm" data-do="draw-reward-group" data-group="${esc(group.group)}"${disabled}>全组确认</button></div><div class="dt-member-chips">${group.ids.map(id=>{const student=picked.find(v=>v.id===id);return `<span>${avatar(student)}${esc(student.name)}</span>`;}).join('')}</div></section>`).join(''):picked.map((student, index) => `<div class="draw-person dt-result-row" role="listitem" data-draw-student="${esc(student.id)}">${avatar(student)}<h3 title="${esc(student.name)}">${esc(student.name)}</h3><span class="dt-group" title="${esc(student.group)}">${esc(student.group || '未分组')}</span><label class="dt-score-field"><span class="dt-sr-only">给${esc(student.name)}加分</span><input id="draw-score-${index}" data-draw-score="${esc(student.id)}" type="number" inputmode="numeric" min="1" max="100" step="1" placeholder="输入加分数" value="${esc(rows.get(student.id) || '')}"${disabled}></label><button class="button dt-confirm" data-do="draw-reward" data-id="${esc(student.id)}" aria-label="确认给${esc(student.name)}加分"${disabled}>确认</button></div>`).join('');
    return `<section class="draw-view dt-draw" data-draw-key="${esc(key)}" data-draw-generation="${generation}" aria-label="随机点名" aria-busy="${locked}">
      <div class="dt-heading"><div><div class="pill">✦ 每个声音，都值得被听见</div><h2>${picked.length ? '这些幸运星请起立' : '下一位闪亮的同学是谁？'}</h2></div><p class="muted">${state.draw.mode === 'cycle' ? '一轮不重复 · 每位同学都有机会' : '允许跨次重复 · 每次多人抽选仍不重复'}</p></div>
      <div class="draw-controls dt-controls"><select id="draw-target" aria-label="抽取对象"${disabled}><option value="students" ${isGroups?'':'selected'}>抽学生</option><option value="groups" ${isGroups?'selected':''}>抽小组</option></select><label class="dt-count-label" for="draw-count">抽选${isGroups?'组数':'人数'}</label><div class="dt-stepper"><button class="button" data-do="draw-count-minus" aria-label="减少抽选人数"${disabled}>−</button><input id="draw-count" type="number" inputmode="numeric" min="1" max="${maxCount}" step="1" value="1" aria-label="抽选${isGroups?'组数':'人数'}"${disabled}><button class="button" data-do="draw-count-plus" aria-label="增加抽选人数"${disabled}>＋</button></div><select id="draw-mode" aria-label="点名重复策略"${disabled}><option value="cycle" ${state.draw.mode === 'cycle' ? 'selected' : ''}>一轮不重复</option><option value="repeat" ${state.draw.mode === 'repeat' ? 'selected' : ''}>允许跨次重复</option></select><button class="button primary large-button" data-do="draw"${locked || !state.students.length ? ' disabled' : ''}>${animating ? '正在抽选…' : picked.length ? '✦ 继续抽取' : '✦ 开始点名'}</button><button class="button" data-do="draw-reset"${disabled}>重开一轮</button></div>
      <div class="draw-stage dt-stage ${animating ? 'shuffling' : ''}">${picked.length ? `<div class="dt-result-heading"><strong>点名结果 <span>${isGroups?`${groupRows.length} 组 · `:''}${picked.length} 位同学</span></strong><button class="button dt-batch" data-do="draw-reward-batch"${disabled}>批量确认</button></div><div class="dt-result-list" role="list" aria-label="本次点名结果">${resultRows}</div><div class="dt-uniform"><label for="draw-uniform-delta">统一加分 <small>为本次 ${picked.length} 位同学各加</small></label><input id="draw-uniform-delta" type="number" inputmode="numeric" min="1" max="100" step="1" value="${esc(uniform)}" aria-label="统一加分数"${disabled}><span>分</span><button class="button primary" data-do="reward-picked" aria-label="确认统一加分"${disabled}>确认</button></div>` : `<div class="draw-placeholder">${petSvg('fox', true)}<h3>${state.students.length ? '准备好，开启今天的小惊喜' : '请先添加学生，再开始点名'}</h3></div>`}</div>
      ${picked.length ? `<p class="dt-reward-note">${isGroups?'按组填写每位成员的分数后可批量确认':'逐人填写分数后可批量确认'}，空白行会跳过 · 奖励计入普通积分，可在积分记录撤销</p>` : ''}
      <div class="draw-footer dt-footer"><span>${remaining}</span>${(options.role || 'main') === 'main' ? '<button class="text-button" data-do="open-draw">打开独立点名窗口 ↗</button>' : ''}</div>
    </section>`;
  }
  function setBusy(value) {
    const current = widget();
    if (!current) return;
    current.setAttribute('aria-busy', String(value || animating));
    for (const el of current.querySelectorAll('input, select, button')) {
      if (value) { el.dataset.drawWasDisabled = el.disabled ? '1' : '0'; el.disabled = true; }
      else if ('drawWasDisabled' in el.dataset) { el.disabled = el.dataset.drawWasDisabled === '1'; delete el.dataset.drawWasDisabled; }
    }
  }
  function clearRows(ids) {
    for (const id of ids) rows.delete(id);
    for (const input of widget()?.querySelectorAll('[data-draw-score]') || []) if (ids.includes(input.dataset.drawScore)) input.value = '';
  }
  async function handle(action, el, context) {
    const supported = ['draw-count-minus', 'draw-count-plus', 'draw-reward', 'draw-reward-group', 'draw-reward-batch', 'draw-reward-all', 'reward-picked'];
    // These remain owned by app.js; prevent a new draw during an IPC reward.
    if (action === 'draw' || action === 'draw-reset') return busy;
    if (!supported.includes(action)) return false;
    if (busy || animating) return true;
    const { state, act, toast = () => {}, render = () => {} } = context;
    if (action === 'draw-count-minus' || action === 'draw-count-plus') {
      const input = doc()?.getElementById('draw-count');
      if (!input) return true;
      const maximum = Math.max(1, Math.min(20, candidates(state).length));
      const old = Number(input.value), base = Number.isInteger(old) && old >= 1 ? old : 1;
      input.value = String(Math.max(1, Math.min(maximum, base + (action === 'draw-count-plus' ? 1 : -1))));
      for (const event of ['input', 'change']) input.dispatchEvent(new root.Event(event, { bubbles: true }));
      return true;
    }
    capture();
    const picked = pickedStudents(state);
    if (!picked.length) { toast('请先开始点名'); return true; }
    // Reject clicks from an old view after a remote draw, roster or board change.
    if (activeKey !== keyFor(state)) { toast('点名结果已更新，请重新确认'); render(); return true; }
    let request, awarded, message;
    try {
      if (action === 'draw-reward-group') {
        const group=(state.draw.groups||[]).find(v=>v.group===el?.dataset?.group);if(!group)throw new Error('这个小组已不在本次点名结果中');
        const delta=validateDelta(rows.get('group:'+group.group));awarded=['group:'+group.group];request={type:'score',ids:group.ids,delta,reason:'随机小组点名奖励'};message=`${group.group}的 ${group.ids.length} 位同学各 +${delta} 分成功`;
      } else if (action === 'draw-reward') {
        const student = picked.find(student => student.id === el?.dataset?.id);
        if (!student) throw new Error('这位同学不在本次点名结果中');
        const delta = validateDelta(rows.get(student.id));
        awarded = [student.id]; request = { type: 'score', ids: awarded, delta, reason: REASON };
        message = `${student.name} +${delta} 分成功`;
      } else if (action === 'draw-reward-batch') {
        const awards = [];
        for (const student of state.draw.scope==='groups'?(state.draw.groups||[]).map(g=>({id:'group:'+g.group,name:g.group,ids:g.ids})):picked) {
          const raw = String(rows.get(student.id) ?? '').trim();
          if (!raw) continue;
          try { const delta=validateDelta(raw);for(const id of student.ids||[student.id])awards.push({id,delta}); }
          catch (_) { throw new Error(`${student.name}的加分需为 1–100 的整数`); }
        }
        if (!awards.length) throw new Error('请至少填写一位同学的加分数');
        awarded = state.draw.scope==='groups'?(state.draw.groups||[]).filter(g=>awards.some(a=>g.ids.includes(a.id))).map(g=>'group:'+g.group):awards.map(item => item.id); request = { type: 'score.mixed', awards, reason: REASON };
        message = awards.every(item => item.delta === awards[0].delta) ? `${awards.length} 位同学各 +${awards[0].delta} 分成功` : `已按填写的分数，为 ${awards.length} 位同学加分成功`;
      } else {
        const delta = validateDelta(uniform);
        awarded = picked.map(student => student.id); request = { type: 'score', ids: awarded, delta, reason: REASON };
        message = `${awarded.length} 位同学各 +${delta} 分成功`;
      }
    } catch (error) { toast(error.message); return true; }
    request.expectedDraw=keyFor(state);
    busy = true; setBusy(true);
    const startedGeneration = generation, startedKey = activeKey;
    try {
      const ok = await act(request);
      if (ok !== false && generation === startedGeneration && activeKey === startedKey) {
        // Individual drafts are independent from a uniform award.
        if (['draw-reward','draw-reward-group','draw-reward-batch'].includes(action)) clearRows(awarded);
        toast(message);
      }
    } catch (error) { toast(error?.message || '加分未成功，请重试'); }
    finally { busy = false; setBusy(false); render(); }
    return true;
  }
  async function change(event,context){
    if(!['draw-target','draw-mode'].includes(event?.target?.id))return false;
    if(busy||animating){context.render?.();return true;}
    const scope=doc()?.getElementById('draw-target')?.value||context.state.draw.scope||'students',mode=doc()?.getElementById('draw-mode')?.value||context.state.draw.mode;
    const count=doc()?.getElementById('draw-count');if(count){const value=Number(count.value);count.value=String(Math.max(1,Math.min(Number.isInteger(value)?value:1,20,Math.max(1,candidates(context.state,scope).length))));}
    busy=true;setBusy(true);try{await context.act({type:'draw.select',scope,mode});resetResults();}finally{busy=false;setBusy(false);context.render?.();}return true;
  }
  return Object.freeze({ view, handle, change, candidates, capture, reset, resetResults, validateDelta });
});
