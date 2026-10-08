/* Original Chinese classroom-tools interface. Host owns state persistence and its modal. */
(function (root) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = selector => document.querySelector(selector);
  const tools = () => root.ClassroomTools;
  let draft = null;
  let serial = 0;
  const handles = action => typeof action === 'string' && action.startsWith('ct-');
  const dispose = () => { serial++; draft = null; };
  const changed = (expected, state) => expected.panelId !== tools().panelId(state) || expected.expectedToolsRevision !== tools().snapshot(state).revision || expected.expectedRoster !== tools().rosterKey(state);
  const closeButton = () => '<button type="button" class="ct-button" data-do="ct-close">关闭</button>';
  const header = (title, text) => `<h2 id="dialog-heading">${title}</h2><p class="ct-intro">${text}</p>`;
  function guardView() {
    return draft.stale ? '<div class="ct-warning" role="status">名单或课堂工具已在另一窗口更新。请重新打开后确认。<button type="button" class="ct-button" data-do="ct-refresh">重新打开</button></div>' : '';
  }
  function initial(kind, state, context) {
    draft = { serial: ++serial, kind, state, context, panelId: tools().panelId(state), expected: tools().expectation(state), selected: new Set(), stale: false, pending: false, error: '' };
    if (kind === 'select') draft.selected = new Set(tools().snapshot(state).vote?.candidates.map(v => v.id) || []);
    render(true);
  }
  function groupedStudents(state, selected) {
    const groups = tools().attendanceSummary(state).groups;
    return groups.map(group => `<section class="ct-group"><h3>${esc(group.name)}<span>${group.students.length}人</span></h3><div class="ct-member-grid">${group.students.map(s => `<button type="button" class="ct-person${selected.has(s.id) ? ' ct-selected' : ''}" data-do="ct-candidate" data-id="${esc(s.id)}" role="checkbox" aria-checked="${selected.has(s.id)}" ${draft.stale ? 'disabled' : ''}><span class="ct-person-name">${esc(s.name)}</span><span class="ct-selection" aria-hidden="true">${selected.has(s.id) ? '✓' : '+'}</span></button>`).join('')}</div></section>`).join('');
  }
  function selectionView(state) {
    const existing = tools().snapshot(state).vote;
    return `${header('投票选人', '请选择2～4位候选同学，确认后开始计票。')}${guardView()}<form id="ct-vote-form"><div class="ct-selection-summary" aria-live="polite">已选 <strong>${draft.selected.size}</strong> 位 / 最多4位</div><div class="ct-scroll ct-roster">${state.students.length ? groupedStudents(state, draft.selected) : '<p class="ct-empty">班里还没有同学，请先添加学生。</p>'}</div>${existing ? '<p class="ct-warning">重新选人并开始后，当前票数将清空，所有候选人从0票开始。</p>' : ''}<div class="ct-actions"><button type="button" class="ct-button" data-do="ct-back">${existing ? '返回当前投票' : '返回百宝箱'}</button><button type="submit" class="ct-button ct-primary" ${draft.selected.size < 2 || draft.selected.size > 4 || draft.stale ? 'disabled' : ''}>${existing ? '清空票数并开始' : '确认开启投票'}</button></div></form>`;
  }
  function voteView(state) {
    const vote = tools().snapshot(state).vote;
    if (!vote) return `${header('投票选人', '当前没有进行中的投票。')}<p class="ct-empty">请选择2～4位候选同学。</p><div class="ct-actions"><button class="ct-button ct-primary" data-do="ct-reselect">选择候选人</button>${closeButton()}</div>`;
    const revision = tools().snapshot(state).revision;
    return `${header('班级投票', '听听大家的想法，为每一位候选同学记录票数。')}<div class="ct-vote-grid" data-ct-candidates="${vote.candidates.length}">${tools().voteStandings(state).map(candidate => {
      const student = state.students.find(s => s.id === candidate.id);
      return `<article class="ct-vote-card" data-ct-candidate="${esc(candidate.id)}"><span class="ct-rank" data-ct-rank="${candidate.rank}">第${['一', '二', '三', '四'][candidate.rank - 1]}名</span><div class="ct-vote-flower" aria-hidden="true">✿</div><h3>${esc(student.name)}</h3><p>${esc(student.group)}</p><strong class="ct-votes" data-ct-count="${esc(candidate.id)}" aria-label="${esc(student.name)}，${candidate.votes}票">${candidate.votes}<small>票</small></strong><div class="ct-vote-actions"><button type="button" class="ct-button" data-do="ct-vote-minus" data-id="${esc(candidate.id)}" data-ct-revision="${revision}" aria-label="${esc(student.name)}减1票" ${candidate.votes === 0 ? 'disabled' : ''}>− 减1票</button><button type="button" class="ct-button ct-primary" data-do="ct-vote-plus" data-id="${esc(candidate.id)}" data-ct-revision="${revision}" aria-label="${esc(student.name)}加1票" ${candidate.votes === tools().MAX_COUNT ? 'disabled' : ''}>＋ 加1票</button></div></article>`;
    }).join('')}</div><p class="ct-note">花伴课堂约定：票数最低为0；候选位置保持不变，同票并列，后续名次按人数顺延。移除学生会清理其投票；候选不足2人时结束本轮。投票独立保存，不计入积分或宠物成长。</p><div class="ct-actions"><button type="button" class="ct-button" data-do="ct-reselect">重选候选人</button>${closeButton()}</div>`;
  }
  function attendanceView(state, absentOnly = false) {
    const summary = tools().attendanceSummary(state), present = new Set(tools().snapshot(state).attendance.presentIds), revision = tools().snapshot(state).revision;
    return `${header(absentOnly ? `未到明细统计（${summary.absent}人）` : '班级签到', absentOnly ? '以下同学尚未标记为已到，请老师核对。' : '点击成员标记已到，再点一次可取消。')}<div class="ct-attendance-summary"><span>全班 <strong>${summary.total}</strong></span><span>已到 <strong>${summary.present}</strong></span><span>未到 <strong>${summary.absent}</strong></span></div><div class="ct-scroll ct-roster">${summary.groups.map(group => {
      const members = absentOnly ? group.absent : group.students;
      if (!members.length && absentOnly) return '';
      return `<section class="ct-group"><h3>${esc(group.name)}<span>${absentOnly ? `未到${members.length}人` : `${group.students.length}人 · 已到${group.present.length}人`}</span></h3><div class="ct-member-grid">${members.map(s => absentOnly ? `<div class="ct-absent-person">${esc(s.name)}</div>` : `<button type="button" class="ct-person${present.has(s.id) ? ' ct-present' : ''}" data-do="ct-attendance-toggle" data-id="${esc(s.id)}" data-ct-revision="${revision}" aria-pressed="${present.has(s.id)}" aria-label="${esc(s.name)}，${present.has(s.id) ? '已到，点击取消签到' : '未到，点击签到'}"><span class="ct-person-name">${esc(s.name)}</span><span class="ct-selection" aria-hidden="true">${present.has(s.id) ? '✓' : ''}</span></button>`).join('')}</div></section>`;
    }).join('') || `<p class="ct-empty">${summary.total ? '全班已到齐 🌷' : '班里还没有同学，请先添加学生。'}</p>`}</div><p class="ct-note">签到保留在当前面板，需手动重置；不会自动按日期清空，也不改变积分或宠物成长。</p><div class="ct-actions">${absentOnly ? '<button type="button" class="ct-button" data-do="ct-attendance-back">返回签到</button>' : `<button type="button" class="ct-button" data-do="ct-absent">统计未到</button><button type="button" class="ct-button" data-do="ct-reset" ${!summary.present ? 'disabled' : ''}>重置清空</button>`}${closeButton()}</div>`;
  }
  function contents() {
    const state = draft.state;
    if (draft.kind === 'select') return selectionView(state);
    if (draft.kind === 'vote') return voteView(state);
    if (draft.kind === 'attendance' || draft.kind === 'absent') return attendanceView(state, draft.kind === 'absent');
    if (draft.kind === 'reset') return `${header('重置本面板签到？', `将清空本面板 ${tools().attendanceSummary(state).present} 位同学的已到标记。`)}${guardView()}<p class="ct-warning">确认后，所有同学恢复为未签到。此操作不能撤销，请先核对。</p><div class="ct-actions"><button type="button" class="ct-button" data-do="ct-attendance-back">取消</button><button type="button" class="ct-button ct-danger" data-do="ct-reset-confirm" ${draft.stale ? 'disabled' : ''}>确认清空签到</button></div>`;
    return `${header('班级百宝箱', '为讨论、选择和每一次到齐，留出轻松的课堂时刻。')}<div class="ct-tool-grid"><button type="button" class="ct-tool-card" data-do="ct-vote"><span aria-hidden="true">✿</span><strong>投票选人</strong><small>选择2～4位同学，独立记录票数</small></button><button type="button" class="ct-tool-card" data-do="ct-attendance"><span aria-hidden="true">✓</span><strong>班级签到</strong><small>按小组签到，统计未到成员</small></button><button type="button" class="ct-tool-card" data-do="open-timer"><span aria-hidden="true">◷</span><strong>课堂计时器</strong><small>打开课堂计时窗口</small></button><button type="button" class="ct-tool-card" data-do="open-draw"><span aria-hidden="true">✦</span><strong>随机点名</strong><small>打开随机点名窗口</small></button><button type="button" class="ct-tool-card" data-do="cw-challenge"><span aria-hidden="true">◈</span><strong>惩罚大转盘</strong><small>趣味挑战，可自愿跳过</small></button>${globalThis.ToolboxExtraUI?.cards()||''}</div><div class="ct-actions">${closeButton()}</div>`;
  }
  function render(first = false) {
    if (!draft) return;
    const scroll = $('.ct-scroll')?.scrollTop || 0;
    const focused = document.activeElement;
    const focusAction = focused?.dataset?.do, focusId = focused?.dataset?.id;
    const html = contents() + `<p class="ct-error" role="status" ${draft.error ? '' : 'hidden'}>${esc(draft.error)}</p>`;
    if (first || !$('.ct-root')) draft.context.modal(`<div class="ct-root" data-ct-session="${draft.serial}">${html}</div>`);
    else $('.ct-root').innerHTML = html;
    $('.ct-root')?.setAttribute('aria-busy', String(draft.pending));
    $('#modal .dialog')?.classList.add('ct-dialog');
    if ($('.ct-scroll')) $('.ct-scroll').scrollTop = scroll;
    if (draft.pending) $('.ct-root')?.querySelectorAll('button,input').forEach(el => { el.disabled = true; });
    if (focusAction) [...($('.ct-root')?.querySelectorAll('[data-do]') || [])].find(el => el.dataset.do === focusAction && el.dataset.id === focusId)?.focus({ preventScroll: true });
  }
  function sync(state, context = {}) {
    if (!draft) return;
    if (draft.panelId !== tools().panelId(state)) {
      const close = context.closeModal || draft.context.closeModal;
      dispose();
      close?.();
      return;
    }
    if (!$('.ct-root')) { dispose(); return; }
    const previous = draft.state;
    draft.state = state;
    draft.context = { ...draft.context, ...context };
    // A restored backup may reuse the same tool counter and roster for a different branch.
    if ((draft.kind === 'select' || draft.kind === 'reset') && (context.restored === true || changed(draft.expected, state))) draft.stale = true;
    // Unrelated score/timer actions need not disrupt a live roster or focused button.
    if (context.restored === true || tools().snapshot(previous).revision !== tools().snapshot(state).revision || tools().rosterKey(previous) !== tools().rosterKey(state) || JSON.stringify(previous.settings?.groupOrder) !== JSON.stringify(state.settings?.groupOrder)) render();
  }
  async function commit(action, context, afterKind) {
    const current = draft;
    if (!current || current.pending) return;
    current.pending = true;
    current.error = '';
    render();
    try {
      const ok = await context.act({ ...action, ...current.expected });
      if (draft !== current || !$('.ct-root')) return;
      if (ok === false) current.error = '本次操作未保存。请核对最新状态后重试。';
      else {
        // The host must sync persisted state in acceptState before resolving act.
        if (changed(current.expected, current.state)) {
          current.kind = afterKind || current.kind;
          current.stale = false;
          current.expected = tools().expectation(current.state);
        } else current.error = '尚未收到保存后的状态，请关闭并重新打开确认。';
      }
    } catch (error) {
      if (draft === current) { current.error = error.message || '本次操作未保存'; context.toast?.(current.error); }
    } finally {
      current.pending = false;
      if (draft === current && $('.ct-root')) render();
    }
  }
  async function handle(action, el, context) {
    if (!handles(action)) return false;
    try {
      if (action === 'ct-close') { dispose(); context.closeModal(); return true; }
      if (draft?.pending) return true;
      if (action === 'ct-toolbox' || action === 'ct-vote' || action === 'ct-attendance') {
        initial(action === 'ct-toolbox' ? 'toolbox' : action === 'ct-attendance' ? 'attendance' : tools().snapshot(context.state).vote ? 'vote' : 'select', context.state, context);
        return true;
      }
      if (!draft || draft.panelId !== tools().panelId(context.state)) throw Error('面板已切换，请重新打开课堂工具');
      if (el?.isConnected === false) throw Error('页面已更新，请在当前页面重新操作');
      const viewChanged = changed(tools().expectation(draft.state), context.state);
      sync(context.state, context);
      if (!draft) return true;
      if (viewChanged && ['ct-vote-plus', 'ct-vote-minus', 'ct-attendance-toggle', 'ct-reset-confirm'].includes(action)) throw Error('课堂工具或名单已更新，请核对后重新操作');
      if (el?.dataset?.ctRevision !== undefined && Number(el.dataset.ctRevision) !== tools().snapshot(context.state).revision) throw Error('课堂工具已更新，请核对后重新操作');
      if (action === 'ct-reselect' || action === 'ct-refresh') {
        initial(action === 'ct-refresh' && draft.kind === 'reset' ? 'attendance' : 'select', context.state, context);
        return true;
      }
      if (action === 'ct-back') { initial(tools().snapshot(context.state).vote ? 'vote' : 'toolbox', context.state, context); return true; }
      if (action === 'ct-candidate') {
        if (draft.kind !== 'select' || draft.stale) throw Error('名单已变化，请重新选择候选同学');
        const id = el.dataset.id;
        if (!context.state.students.some(s => s.id === id)) throw Error('这位同学已移除，请重新选择');
        if (draft.selected.has(id)) draft.selected.delete(id);
        else { if (draft.selected.size >= 4) throw Error('最多选择4位候选同学'); draft.selected.add(id); }
        render();
        return true;
      }
      if (action === 'ct-absent' || action === 'ct-attendance-back') { initial(action === 'ct-absent' ? 'absent' : 'attendance', context.state, context); return true; }
      if (action === 'ct-reset') { initial('reset', context.state, context); return true; }
      if (action === 'ct-reset-confirm') {
        if (draft.kind !== 'reset' || draft.stale || changed(draft.expected, context.state)) throw Error('签到状态已变化，请重新确认清空');
        await commit({ type: 'classroom.attendance.reset', confirmed: true }, context, 'attendance');
        return true;
      }
      if (action === 'ct-vote-plus' || action === 'ct-vote-minus') {
        if (draft.kind !== 'vote') throw Error('投票页面已变化，请重新打开');
        draft.expected = tools().expectation(context.state);
        await commit({ type: 'classroom.vote.adjust', id: el.dataset.id, delta: action === 'ct-vote-plus' ? 1 : -1 }, context);
        return true;
      }
      if (action === 'ct-attendance-toggle') {
        if (draft.kind !== 'attendance') throw Error('签到页面已变化，请重新打开');
        draft.expected = tools().expectation(context.state);
        await commit({ type: 'classroom.attendance.set', id: el.dataset.id, present: !tools().snapshot(context.state).attendance.presentIds.includes(el.dataset.id) }, context);
        return true;
      }
      throw Error('课堂工具操作无效');
    } catch (error) { context.toast(error.message); }
    return true;
  }
  async function submit(event, context) {
    if (event.target.id !== 'ct-vote-form') return false;
    event.preventDefault();
    if (draft?.pending) return true;
    try {
      if (!draft || draft.kind !== 'select' || draft.stale || changed(draft.expected, context.state)) throw Error('候选名单已过期，请重新选择');
      if (event.target.isConnected === false) throw Error('投票页面已关闭，请重新打开');
      const ids = context.state.students.filter(s => draft.selected.has(s.id)).map(s => s.id);
      if (ids.length < 2 || ids.length > 4) throw Error('请选择2～4位候选同学');
      await commit({ type: 'classroom.vote.start', ids, confirmedNewVote: !!tools().snapshot(context.state).vote }, context, 'vote');
    } catch (error) { context.toast(error.message); }
    return true;
  }
  root.ClassroomToolsUI = Object.freeze({ handles, handle, submit, sync, dispose });
})(globalThis);
