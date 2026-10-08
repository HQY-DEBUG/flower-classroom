/* Panel-local classroom activities. Votes and attendance never alter score or pet ledgers. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ClassroomTools = api;
})(globalThis, function () {
  'use strict';
  const MAX_COUNT = 1_000_000_000;
  const MAX_REVISION = Number.MAX_SAFE_INTEGER - 1;
  const actionTypes = new Set(['classroom.vote.start', 'classroom.vote.adjust', 'classroom.attendance.set', 'classroom.attendance.reset']);
  const fail = message => { throw new Error(message); };
  function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label + '格式无效');
    return value;
  }
  function integer(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(label + '超出有效整数范围');
    return value;
  }
  function ids(value, roster, label, min = 0, max = 300) {
    if (!Array.isArray(value) || value.length < min || value.length > max) fail(label + (min === 2 ? '需选择2～4位学生' : '人数无效'));
    const seen = new Set();
    return value.map(id => {
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id) || seen.has(id) || !roster.has(id)) fail(label + '含重复或已移除的学生，请重新选择');
      seen.add(id);
      return id;
    });
  }
  const empty = () => ({ version: 1, revision: 0, vote: null, attendance: { presentIds: [] } });
  const panelId = state => state.panels?.activeId || 'panel_default';
  const hasNewFields = state => state.classroomTools !== undefined;
  // Names and groups matter to a reviewable roster as much as stable IDs do.
  const rosterKey = state => JSON.stringify(state.students.map(s => [s.id, s.name, s.group]));
  function validate(value, students) {
    const source = record(value, '课堂工具');
    if (source.version !== 1) fail('课堂工具版本无效');
    const roster = new Set(students.map(s => s.id));
    const attendance = record(source.attendance, '签到状态');
    const result = { version: 1, revision: integer(source.revision, 0, MAX_REVISION, '课堂工具版本'), vote: null,
      attendance: { presentIds: ids(attendance.presentIds, roster, '签到名单') } };
    if (source.vote !== null) {
      const vote = record(source.vote, '投票状态');
      if (!Array.isArray(vote.candidates)) fail('候选名单格式无效');
      const candidateIds = ids(vote.candidates.map(v => record(v, '候选学生').id), roster, '候选名单', 2, 4);
      result.vote = { candidates: vote.candidates.map((v, i) => ({ id: candidateIds[i], votes: integer(v.votes, 0, MAX_COUNT, '票数') })) };
    }
    return result;
  }
  function validateExtensions(source, result) {
    if (!hasNewFields(source)) return;
    if (source.version !== 2) fail('课堂工具数据需要 version 2 存档');
    result.classroomTools = validate(source.classroomTools, result.students);
  }
  const snapshot = state => hasNewFields(state) ? validate(state.classroomTools, state.students) : empty();
  function expectation(state) {
    return { panelId: panelId(state), expectedToolsRevision: snapshot(state).revision, expectedRoster: rosterKey(state) };
  }
  function assertCurrent(state, action, tools) {
    if (typeof action.panelId !== 'string' || action.panelId !== panelId(state)) fail('面板已切换，请重新打开课堂工具');
    if (action.expectedToolsRevision !== tools.revision) fail('课堂工具已在另一窗口更新，请重新确认');
    if (action.expectedRoster !== rosterKey(state)) fail('学生名单已变化，请重新选择');
  }
  // Mutates only after every check succeeds, matching core's validated-copy reducer contract.
  function apply(state, action) {
    record(action, '课堂工具操作');
    if (!actionTypes.has(action.type)) fail('未知课堂工具操作');
    const tools = snapshot(state);
    assertCurrent(state, action, tools);
    switch (action.type) {
      case 'classroom.vote.start': {
        const candidates = ids(action.ids, new Set(state.students.map(s => s.id)), '候选名单', 2, 4);
        if (tools.vote && action.confirmedNewVote !== true) fail('重新选择会清空当前票数，请确认后开始');
        tools.vote = { candidates: candidates.map(id => ({ id, votes: 0 })) };
        break;
      }
      case 'classroom.vote.adjust': {
        if (!tools.vote) fail('请先选择2～4位候选同学');
        const candidate = tools.vote.candidates.find(v => v.id === action.id);
        if (!candidate) fail('这位同学不在当前候选名单中');
        if (action.delta !== 1 && action.delta !== -1) fail('每次只能加1票或减1票');
        // Product default; the reference video does not establish a negative-vote boundary.
        if (candidate.votes + action.delta < 0) fail('花伴课堂的票数最低为0');
        candidate.votes = integer(candidate.votes + action.delta, 0, MAX_COUNT, '票数');
        break;
      }
      case 'classroom.attendance.set': {
        ids([action.id], new Set(state.students.map(s => s.id)), '签到名单', 1);
        if (typeof action.present !== 'boolean') fail('签到状态无效');
        const selected = new Set(tools.attendance.presentIds);
        if (selected.has(action.id) === action.present) fail('这位同学的签到状态已经更新，请勿重复提交');
        if (action.present) selected.add(action.id); else selected.delete(action.id);
        tools.attendance.presentIds = state.students.filter(s => selected.has(s.id)).map(s => s.id);
        break;
      }
      case 'classroom.attendance.reset':
        if (action.confirmed !== true) fail('请先确认清空本面板的签到记录');
        if (!tools.attendance.presentIds.length) fail('当前没有需要清空的签到记录');
        tools.attendance.presentIds = [];
        break;
    }
    tools.revision = integer(tools.revision + 1, 0, MAX_REVISION, '课堂工具版本');
    state.classroomTools = tools;
    state.version = 2;
    return state;
  }
  // Run in core.finish before final validation after remove/replace/clear roster operations.
  function prune(state) {
    if (!hasNewFields(state)) return state;
    const tools = state.classroomTools;
    const roster = new Set(state.students.map(s => s.id));
    const presentIds = tools.attendance.presentIds.filter(id => roster.has(id));
    let vote = tools.vote;
    let changed = presentIds.length !== tools.attendance.presentIds.length;
    if (vote) {
      const keep = vote.candidates.filter(v => roster.has(v.id));
      if (keep.length !== vote.candidates.length) {
        changed = true;
        vote = keep.length >= 2 ? { candidates: keep.map(v => ({ ...v })) } : null;
      }
    }
    if (changed) state.classroomTools = { ...tools, revision: integer(tools.revision + 1, 0, MAX_REVISION, '课堂工具版本'), vote, attendance: { presentIds } };
    return state;
  }
  function attendanceSummary(state) {
    const present = new Set(snapshot(state).attendance.presentIds);
    const groups = new Map();
    for (const student of state.students) {
      if (!groups.has(student.group)) groups.set(student.group, { name: student.group, students: [], present: [], absent: [] });
      const group = groups.get(student.group);
      group.students.push(student);
      group[present.has(student.id) ? 'present' : 'absent'].push(student);
    }
    const orderedGroups = [...groups.values()];
    if (Array.isArray(state.settings?.groupOrder)) {
      const order = new Map(state.settings.groupOrder.map((name, index) => [name, index]));
      orderedGroups.sort((a, b) => (order.get(a.name) ?? order.size) - (order.get(b.name) ?? order.size));
    }
    return { total: state.students.length, present: present.size, absent: state.students.length - present.size, groups: orderedGroups };
  }
  function voteStandings(state) {
    const candidates = snapshot(state).vote?.candidates || [];
    // Stable candidate positions and competition ties are explicit local product choices.
    return candidates.map(candidate => ({ ...candidate, rank: 1 + candidates.filter(other => other.votes > candidate.votes).length }));
  }
  return Object.freeze({ MAX_COUNT, hasNewFields, validate, validateExtensions, snapshot, expectation, rosterKey, panelId, apply, prune, reconcile: prune, attendanceSummary, voteStandings,
    handles: type => actionTypes.has(type) });
});
