'use strict';

const { randomUUID, randomInt } = require('node:crypto');
const Progress = require('./pet-progress.js');
const PETS = Object.keys(require('./pet-art.js').names);
const MAX_VALUE = 1_000_000_000, MAX_RECORDS = 20_000, MAX_CHANGES = 100_000;
const MAX_TIME = Number.MAX_SAFE_INTEGER - 180 * 60 * 1000;
const has = (v, key) => Object.hasOwn(v, key);
const fail = message => { throw new Error(message); };
function record(v, label) { if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail(`${label}格式无效`); return v; }
function int(v, min, max, label) { if (!Number.isSafeInteger(v) || v < min || v > max) fail(`${label}需为 ${min}–${max} 的整数`); return v; }
function id(v, label = '宠物编号') { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(v)) fail(`${label}无效`); return v; }
function text(v, max, label, empty = false) { if (typeof v !== 'string' || (!empty && !v.trim()) || [...v.trim()].length > max || /[\u0000-\u001f\u007f]/u.test(v)) fail(`${label}无效`); return v.trim(); }
function list(v, label, max = MAX_RECORDS) { if (!Array.isArray(v) || v.length > max) fail(`${label}数量超过上限或格式无效`); return v; }
function pet(v) { if (!PETS.includes(v)) fail('宠物类型无效'); return v; }
function time(v) { return int(v, 0, MAX_TIME, '宠物记录时间'); }
function unique(set, value, label) { if (set.has(value)) fail(`${label}不能重复`); set.add(value); return value; }
function exists(s) { return !!s.settings.petRules; }
function accountFor(s, studentId) { return s.petAccounts?.find(v => v.studentId === studentId); }
function cycleFor(account, cycleId) { return account.cycles.find(v => v.id === cycleId); }
function updateTotal(account) { account.lifetimeNetGrowth = account.unassignedGrowth + account.cycles.reduce((n, c) => n + c.netGrowth, 0); int(account.lifetimeNetGrowth, 0, MAX_VALUE, '宠物生涯净成长'); }
function ensureEnabled(s) { if (!exists(s)) fail('请先保存并启用六段宠物成长规则'); }

function validateScoreEffect(value) {
  if (value === null) return null;
  const e = record(value, '积分的宠物归属');
  return { accountId: id(e.accountId, '宠物账户编号'), cycleId: e.cycleId === null ? null : id(e.cycleId, '宠物周期编号'), delta: int(e.delta, 1, 100, '关联成长值') };
}
function hasNewFields(s) {
  return has(s.settings, 'petRules') || has(s.settings, 'hideLateForms') || has(s, 'petAccounts') || has(s, 'petLogs') || has(s, 'petDraw') || has(s, 'petOperations') || s.logs.some(l => l.changes.some(c => has(c, 'petEffect')));
}
function validateExtensions(raw, result) {
  if (hasNewFields(raw) && raw.version !== 2) fail('新增宠物数据必须使用 version 2，不能作为旧格式保存');
  if (has(raw.settings, 'hideLateForms')) {
    if (typeof raw.settings.hideLateForms !== 'boolean') fail('后期形态显示设置无效');
    result.settings.hideLateForms = raw.settings.hideLateForms;
  }
  if (!has(raw.settings, 'petRules')) {
    if (has(raw, 'petAccounts') || has(raw, 'petLogs') || has(raw, 'petDraw') || has(raw, 'petOperations') || result.logs.some(l => l.changes.some(c => has(c, 'petEffect')))) fail('宠物账本缺少六段成长规则');
    return;
  }
  record(raw.settings.petRules, '宠物升级规则');
  result.settings.petRules = { thresholds: Progress.thresholds(raw.settings.petRules.thresholds) };
  if (has(raw.settings.petRules, 'growthFloor')) {
    if (!['reject', 'clamp'].includes(raw.settings.petRules.growthFloor)) fail('成长下限规则无效');
    result.settings.petRules.growthFloor = raw.settings.petRules.growthFloor;
  }
  const transactionIds = new Set(); let transactionCount = 0;
  const accountIds = new Set(), studentIds = new Set(), cycleIds = new Set(), graduationIds = new Set(), badgeIds = new Set(), actionIds = new Set();
  let cycleCount = 0, graduationCount = 0, badgeCount = 0;
  result.petAccounts = list(raw.petAccounts, '宠物账户').map(value => {
    const a = record(value, '宠物账户');
    const account = { id: unique(accountIds, id(a.id, '宠物账户编号'), '宠物账户编号'), studentId: unique(studentIds, id(a.studentId, '学生编号'), '宠物账户的学生编号'),
      mode: a.mode, activeCycleId: a.activeCycleId === null ? null : id(a.activeCycleId, '当前宠物周期编号'),
      legacyMedals: int(a.legacyMedals, 0, MAX_VALUE, '旧奖章数'), unassignedGrowth: int(a.unassignedGrowth, 0, MAX_VALUE, '未分配成长值'),
      lifetimeNetGrowth: int(a.lifetimeNetGrowth, 0, MAX_VALUE, '宠物生涯净成长') };
    if (!['legacy-linked', 'independent'].includes(account.mode)) fail('宠物成长模式无效');
    account.cycles = list(a.cycles, '宠物周期').map(value => {
      const c = record(value, '宠物周期'); if (++cycleCount > MAX_RECORDS) fail('宠物周期数量超过上限');
      if (!['active', 'dormant', 'graduated'].includes(c.status) || !['legacy-import', 'explicit-adoption'].includes(c.origin)) fail('宠物周期状态或来源无效');
      if (has(c, 'startFromEgg') && typeof c.startFromEgg !== 'boolean') fail('宠物周期的蛋起始标记无效');
      return { id: unique(cycleIds, id(c.id, '宠物周期编号'), '宠物周期编号'), pet: pet(c.pet), status: c.status,
        netGrowth: int(c.netGrowth, 0, MAX_VALUE, '宠物周期净成长'), openedAt: c.openedAt === null ? null : time(c.openedAt), origin: c.origin,
        ...(has(c, 'startFromEgg') ? { startFromEgg: c.startFromEgg } : {}) };
    });
    const byCycle = new Map(account.cycles.map(c => [c.id, c]));
    if (account.activeCycleId !== null && (!byCycle.has(account.activeCycleId) || byCycle.get(account.activeCycleId).status === 'graduated')) fail('当前宠物周期引用无效');
    if (account.cycles.some(c => c.status !== 'graduated' && c.id !== account.activeCycleId)) fail('宠物账户只能有一个未毕业周期');
    const graduatedCycles = new Set();
    account.graduations = list(a.graduations, '宠物毕业记录').map(value => {
      const g = record(value, '宠物毕业记录'); if (++graduationCount > MAX_RECORDS) fail('宠物毕业记录数量超过上限');
      const cycleId = unique(graduatedCycles, id(g.cycleId, '毕业周期编号'), '同一周期的毕业记录');
      if (!byCycle.has(cycleId) || byCycle.get(cycleId).status !== 'graduated') fail('毕业记录的周期引用无效');
      record(g.ruleSnapshot, '毕业规则快照');
      const ruleSnapshot = { thresholds: Progress.thresholds(g.ruleSnapshot.thresholds) };
      const growthSnapshot = int(g.growthSnapshot, 0, MAX_VALUE, '毕业成长快照');
      if (!Progress.progress(growthSnapshot, ruleSnapshot.thresholds).maxed || g.levelSnapshot !== 7 || g.shapeSnapshot !== 7) fail('毕业快照未达到当时的满级规则');
      const petSnapshot = pet(g.petSnapshot); if (petSnapshot !== byCycle.get(cycleId).pet) fail('毕业宠物快照不一致');
      return { id: unique(graduationIds, id(g.id, '毕业记录编号'), '毕业记录编号'), cycleId, graduatedAt: time(g.graduatedAt),
        petSnapshot, ruleSnapshot, growthSnapshot, levelSnapshot: 7, shapeSnapshot: 7,
        studentName: text(g.studentName, 40, '毕业姓名'), groupName: text(g.groupName, 40, '毕业小组'),
        sourceActionId: unique(actionIds, id(g.sourceActionId, '毕业操作编号'), '毕业操作编号') };
    });
    if (account.cycles.some(c => c.status === 'graduated' && !graduatedCycles.has(c.id))) fail('毕业周期缺少毕业快照');
    const ownGraduations = new Map(account.graduations.map(g => [g.id, g])), rewardedGraduations = new Set();
    account.badgeEvents = list(a.badgeEvents, '永久荣誉记录').map(value => {
      const b = record(value, '永久荣誉记录'); if (++badgeCount > MAX_RECORDS) fail('永久荣誉记录数量超过上限');
      const graduationId = unique(rewardedGraduations, id(b.graduationId, '荣誉来源编号'), '毕业荣誉来源');
      const graduation = ownGraduations.get(graduationId);
      if (!graduation || b.amount !== 1 || b.type !== 'graduation' || b.timestamp !== graduation.graduatedAt) fail('永久荣誉记录与毕业来源不一致');
      return { id: unique(badgeIds, id(b.id, '永久荣誉编号'), '永久荣誉编号'), type: 'graduation', graduationId, amount: 1, timestamp: time(b.timestamp) };
    });
    if (rewardedGraduations.size !== ownGraduations.size) fail('毕业记录缺少永久荣誉事件');
    if (account.legacyMedals + account.badgeEvents.length > MAX_VALUE) fail('总徽章数超过上限');
    if (has(a, 'badgeTransactions')) {
      const redemptions = new Map(), reversed = new Set(); let spent = 0, previousTime = 0;
      account.badgeTransactions = list(a.badgeTransactions, '徽章兑换账本').map(value => {
        const t = record(value, '徽章兑换记录'); if (++transactionCount > MAX_RECORDS) fail('徽章兑换记录数量超过上限');
        const entry = { id: unique(transactionIds, id(t.id, '徽章交易编号'), '徽章交易编号'), type: t.type,
          amount: int(t.amount, 1, MAX_VALUE, '兑换徽章数'), timestamp: time(t.timestamp), reason: text(t.reason, 120, '徽章兑换说明') };
        if (entry.timestamp < previousTime) fail('徽章交易时间顺序无效'); previousTime = entry.timestamp;
        if (entry.type === 'redeem') { redemptions.set(entry.id, entry); spent += entry.amount; }
        else if (entry.type === 'undo') {
          entry.redemptionId = unique(reversed, id(t.redemptionId, '原兑换编号'), '徽章兑换撤销');
          const original = redemptions.get(entry.redemptionId);
          if (!original || original.amount !== entry.amount) fail('徽章撤销与原兑换不一致'); spent -= entry.amount;
        } else fail('徽章交易类型无效');
        if (spent < 0 || spent > account.legacyMedals + account.badgeEvents.length) fail('徽章兑换会导致可用余额低于 0');
        return entry;
      });
    }
    if (account.lifetimeNetGrowth !== account.unassignedGrowth + account.cycles.reduce((n, c) => n + c.netGrowth, 0)) fail('宠物生涯净成长与各周期不一致');
    return account;
  });
  const byStudent = new Map(result.petAccounts.map(a => [a.studentId, a]));
  const byAccount = new Map(result.petAccounts.map(a => [a.id, a]));
  for (const student of result.students) {
    const account = byStudent.get(student.id); if (!account) fail('学生缺少宠物账户');
    if (account.legacyMedals !== (student.medals || 0)) fail('旧奖章来源值不能被改写');
    const cycle = cycleFor(account, account.activeCycleId);
    if (cycle && (cycle.pet !== student.pet || (cycle.status === 'active') !== (student.adopted !== false))) fail('当前宠物与学生领养状态不一致');
    if (!cycle && student.adopted !== false) fail('没有当前周期的学生不能标为已领养');
  }
  for (const log of result.logs) for (const change of log.changes) {
    if (!has(change, 'petEffect')) fail('新版积分记录缺少明确的宠物成长归属');
    const effect = change.petEffect;
    const growthDelta = log.growthDelta ?? Math.max(0, log.delta);
    if (effect === null) {
      if (growthDelta > 0 && byStudent.get(change.id)?.mode === 'legacy-linked') fail('关联模式的正向积分不能缺少原宠物周期归属');
      continue;
    }
    const account = byAccount.get(effect.accountId);
    if (!account || account.studentId !== change.id || account.mode !== 'legacy-linked' || effect.delta !== growthDelta) fail('积分的宠物成长归属不一致');
    if (effect.cycleId !== null && !cycleFor(account, effect.cycleId)) fail('积分记录引用的宠物周期不存在');
  }
  const logIds = new Set(); let changeCount = 0;
  result.petLogs = list(raw.petLogs, '宠物成长记录').map(value => {
    const l = record(value, '宠物成长记录');
    const reset = l.kind === 'reset';
    if (has(l, 'kind') && !reset) fail('宠物成长记录类型无效');
    const delta = int(l.delta, -100, 100, '宠物成长增减'); if ((reset ? delta !== 0 : !delta) || typeof l.undone !== 'boolean') fail('宠物成长记录状态无效');
    if (has(l, 'floorPolicy') && l.floorPolicy !== 'clamp') fail('成长记录下限规则无效');
    const seen = new Set(), changes = list(l.changes, '宠物成长变动', 300).map(value => {
      if (++changeCount > MAX_CHANGES) fail('宠物成长变动数量超过上限');
      const c = record(value, '宠物成长变动'), studentId = unique(seen, id(c.id, '学生编号'), '同一成长记录的学生编号');
      const accountId = id(c.accountId, '宠物账户编号'), cycleId = id(c.cycleId, '宠物周期编号');
      const account = byAccount.get(accountId); if (!account || account.studentId !== studentId || !cycleFor(account, cycleId)) fail('宠物成长记录引用的账户或周期不存在');
      const beforeGrowth = int(c.beforeGrowth, 0, MAX_VALUE, '变动前宠物成长'), afterGrowth = int(c.afterGrowth, 0, MAX_VALUE, '变动后宠物成长');
      const expectedAfter = reset ? 0 : l.floorPolicy === 'clamp' ? Math.max(0, beforeGrowth + delta) : beforeGrowth + delta;
      if (afterGrowth !== expectedAfter) fail('宠物成长记录前后数值不一致');
      const out = { id: studentId, name: text(c.name, 40, '成长记录姓名'), accountId, cycleId, beforeGrowth, afterGrowth };
      if (reset || l.floorPolicy === 'clamp' || has(c, 'actualDelta')) {
        out.actualDelta = int(c.actualDelta, -MAX_VALUE, MAX_VALUE, '实际成长差额');
        if (out.actualDelta !== afterGrowth - beforeGrowth) fail('实际成长差额不一致');
      }
      return out;
    });
    if (!changes.length) fail('宠物成长记录不能为空');
    return { id: unique(logIds, id(l.id, '宠物成长记录编号'), '宠物成长记录编号'), timestamp: time(l.timestamp), delta,
      reason: text(l.reason, 120, '宠物成长原因', true), undone: l.undone, changes, ...(reset ? {kind: 'reset'} : {}), ...(l.floorPolicy === 'clamp' ? {floorPolicy: 'clamp'} : {}) };
  });
  if (has(raw, 'petDraw')) result.petDraw = validateDraw(raw.petDraw, result);
  if (has(raw, 'petOperations')) {
    const seen = new Set();
    result.petOperations = list(raw.petOperations, '宠物操作凭据').map(value => {
      const op = record(value, '宠物操作凭据');
      if (!['batch.growth', 'batch.adopt', 'batch.switch', 'batch.graduate', 'badge.redeem', 'badge.undo'].includes(op.kind)) fail('宠物操作凭据类型无效');
      return { id: unique(seen, id(op.id, '宠物操作凭据编号'), '宠物操作凭据编号'), kind: op.kind, timestamp: time(op.timestamp) };
    });
  }
}

function newAccount(student, mode, now, legacy) {
  const cycle = { id: `pc_${randomUUID()}`, pet: student.pet, status: student.adopted === false ? 'dormant' : 'active',
    netGrowth: legacy ? student.growth : 0, openedAt: legacy ? null : now, origin: legacy ? 'legacy-import' : 'explicit-adoption',
    ...(!legacy ? { startFromEgg: true } : has(student, 'startFromEgg') ? { startFromEgg: student.startFromEgg } : {}) };
  return { id: `pa_${randomUUID()}`, studentId: student.id, mode, activeCycleId: cycle.id, legacyMedals: student.medals || 0,
    unassignedGrowth: 0, lifetimeNetGrowth: cycle.netGrowth, cycles: [cycle], graduations: [], badgeEvents: [] };
}
function enable(s, costs, now, legacy = true) {
  const rules = { thresholds: Progress.thresholds(costs), ...(s.settings.petRules?.growthFloor ? {growthFloor: s.settings.petRules.growthFloor} : {}) };
  if (!exists(s)) {
    s.petAccounts = s.students.map(student => newAccount(student, legacy ? 'legacy-linked' : 'independent', now, legacy)); s.petLogs = [];
    for (const log of s.logs) for (const change of log.changes) {
      const account = accountFor(s, change.id);
      const growthDelta = log.growthDelta ?? Math.max(0, log.delta);
      change.petEffect = account && account.mode === 'legacy-linked' && growthDelta > 0 ? { accountId: account.id, cycleId: account.activeCycleId, delta: growthDelta } : null;
    }
  }
  s.settings.petRules = rules; s.version = 2;
}
function addStudent(s, student, now) { if (exists(s)) s.petAccounts.push(newAccount(student, 'independent', now, false)); }
function adopt(s, student, kind, now) {
  ensureEnabled(s); pet(kind);
  const account = accountFor(s, student.id), existing = cycleFor(account, account.activeCycleId);
  if (existing?.status === 'active') fail('这位学生已有正在成长的宠物');
  if (existing) { existing.pet = kind; existing.status = 'active'; }
  else {
    const cycle = { id: `pc_${randomUUID()}`, pet: kind, status: 'active', netGrowth: 0, openedAt: now, origin: 'explicit-adoption', startFromEgg: true };
    account.cycles.push(cycle); account.activeCycleId = cycle.id;
  }
  student.pet = kind; student.adopted = true;
}
function syncStudent(s, student, now) {
  if (!exists(s)) return;
  const account = accountFor(s, student.id), cycle = cycleFor(account, account.activeCycleId);
  if (cycle) { cycle.pet = student.pet; cycle.status = student.adopted === false ? 'dormant' : 'active'; }
  else if (student.adopted !== false) fail('已毕业后请使用重新领养入口，不能直接修改领养标记');
}
function adjust(account, cycleId, delta) {
  const cycle = cycleId === null ? null : cycleFor(account, cycleId);
  if (cycleId !== null && !cycle) fail('原宠物周期不存在，无法完成整笔操作');
  const before = cycle ? cycle.netGrowth : account.unassignedGrowth, after = before + delta;
  if (after < 0) fail('宠物成长将低于 0，整笔操作未执行；请调整分值后重试');
  int(after, 0, MAX_VALUE, '宠物成长');
  if (cycle) cycle.netGrowth = after; else account.unassignedGrowth = after;
  updateTotal(account);
}
function scoreEffect(s, student, delta) {
  if (!exists(s)) return undefined;
  const account = accountFor(s, student.id);
  if (delta <= 0 || account.mode !== 'legacy-linked') return null;
  const effect = { accountId: account.id, cycleId: account.activeCycleId, delta };
  adjust(account, effect.cycleId, delta); return effect;
}
function undoScoreEffect(s, change) {
  if (!change.petEffect) return;
  const effect = change.petEffect, account = s.petAccounts.find(v => v.id === effect.accountId);
  if (!account || account.studentId !== change.id) fail('原宠物账户不存在，无法整笔撤销');
  adjust(account, effect.cycleId, -effect.delta);
}
function eligible(s) { return s.students.filter(student => { const account = accountFor(s, student.id); return student.adopted !== false && account && cycleFor(account, account.activeCycleId)?.status === 'active'; }); }
function resetDraw(s) {
  if (s.petDraw) s.petDraw = { scope: s.petDraw.scope, mode: s.petDraw.mode, bag: [], lastIds: [], lastGroups: [], groups: [], round: 0 };
}
function validateDraw(raw, s) {
  const d = record(raw, '宠物点名状态');
  if (!['students', 'groups'].includes(d.scope) || !['cycle', 'repeat'].includes(d.mode)) fail('宠物点名模式无效');
  const roster = eligible(s), allowedIds = new Set(roster.map(v => v.id)), allowedGroups = new Set(roster.map(v => v.group));
  function values(v, label, check, allowed) { const out = list(v, label, 300).map(check); if (new Set(out).size !== out.length || out.some(v => !allowed.has(v))) fail(`${label}包含重复或无效目标`); return out; }
  const lastIds = values(d.lastIds, '宠物点名结果', v => id(v, '学生编号'), allowedIds);
  const lastGroups = values(d.lastGroups, '宠物点名小组', v => text(v, 40, '小组'), allowedGroups);
  const bag = d.scope === 'students' ? values(d.bag, '宠物待抽名单', v => id(v, '学生编号'), allowedIds) : values(d.bag, '宠物待抽小组', v => text(v, 40, '小组'), allowedGroups);
  const seen = new Set();
  const groups = list(d.groups, '宠物点名小组快照', 20).map(value => {
    record(value, '宠物点名小组快照'); const group = unique(seen, text(value.group, 40, '小组'), '点名小组');
    const ids = values(value.ids, '小组宠物名单', v => id(v, '学生编号'), allowedIds);
    if (!ids.length || ids.some(studentId => roster.find(v => v.id === studentId).group !== group)) fail('宠物点名小组成员无效');
    return { group, ids };
  });
  if (d.scope === 'students' && (groups.length || lastGroups.length || lastIds.length > 20)) fail('宠物学生点名状态无效');
  if (d.scope === 'groups' && (lastGroups.length > 20 || JSON.stringify(groups.map(v => v.group)) !== JSON.stringify(lastGroups) || JSON.stringify(groups.flatMap(v => v.ids)) !== JSON.stringify(lastIds))) fail('宠物小组点名快照不一致');
  if (d.mode === 'repeat' && bag.length) fail('重复宠物点名不应含待抽名单');
  if (d.mode === 'cycle' && bag.some(v => (d.scope === 'students' ? lastIds : lastGroups).includes(v))) fail('宠物点名结果不能仍在待抽名单中');
  return { scope: d.scope, mode: d.mode, bag, lastIds, lastGroups, groups, round: int(d.round, 0, Number.MAX_SAFE_INTEGER - 1, '宠物点名轮次') };
}
function shuffle(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function draw(s, a) {
  const scope = a.scope ?? s.petDraw?.scope ?? 'students', mode = a.mode ?? s.petDraw?.mode ?? 'cycle';
  if (!['students', 'groups'].includes(scope) || !['cycle', 'repeat'].includes(mode)) fail('宠物点名模式无效');
  const roster = eligible(s), candidates = scope === 'students' ? roster.map(v => v.id) : [...new Set(roster.map(v => v.group))];
  if (!candidates.length) fail('没有已领养宠物的可抽目标');
  const count = int(a.count ?? 1, 1, Math.min(20, candidates.length), '宠物点名数量');
  if (!s.petDraw || s.petDraw.scope !== scope || s.petDraw.mode !== mode) s.petDraw = { scope, mode, bag: [], lastIds: [], lastGroups: [], groups: [], round: 0 };
  const d = s.petDraw; let selected;
  if (mode === 'repeat') { d.bag = []; selected = shuffle(candidates).slice(0, count); }
  else { if (!d.bag.length) { d.bag = shuffle(candidates); d.round++; } selected = d.bag.splice(0, Math.min(count, d.bag.length)); }
  if (scope === 'students') { d.lastIds = selected; d.lastGroups = []; d.groups = []; }
  else { d.lastGroups = selected; d.groups = selected.map(group => ({ group, ids: roster.filter(v => v.group === group).map(v => v.id) })); d.lastIds = d.groups.flatMap(v => v.ids); }
}
function assertRequest(s, a) {
  const requestId = id(a.requestId, '宠物操作凭据编号');
  if ((s.petOperations || []).some(v => v.id === requestId)) fail('这笔宠物操作已保存，请勿重复提交');
  if (int(a.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1, '宠物预览版本') !== s.revision) fail('课堂数据已变化，请刷新预览后重新操作');
  if ((s.petOperations || []).length >= MAX_RECORDS) fail('宠物操作凭据数量已达上限，请备份并新建面板');
  return requestId;
}
function saveRequest(s, requestId, kind, now) { (s.petOperations ||= []).push({ id: requestId, kind, timestamp: now }); }
function clearCurrentGrowth(s, now) {
  if (!exists(s)) return;
  const changes = [];
  for (const student of s.students) {
    const account = accountFor(s, student.id), cycle = cycleFor(account, account.activeCycleId);
    if (!cycle || !cycle.netGrowth) continue;
    const beforeGrowth = cycle.netGrowth; adjust(account, cycle.id, -beforeGrowth);
    changes.push({ id: student.id, name: student.name, accountId: account.id, cycleId: cycle.id, beforeGrowth, afterGrowth: 0, actualDelta: -beforeGrowth });
  }
  if (changes.length) s.petLogs.push({ id: `pg_${randomUUID()}`, timestamp: now, kind: 'reset', delta: 0, reason: '清零当前宠物成长', undone: false, changes });
}
function apply(s, a, now) {
  if (a.type === 'pet.stage-rules') { enable(s, a.thresholds, now); return; }
  if (a.type === 'pet.visibility') {
    if (typeof a.hideLateForms !== 'boolean') fail('后期形态显示设置无效');
    s.settings.hideLateForms = a.hideLateForms; s.version = 2; return;
  }
  ensureEnabled(s);
  if (a.type === 'pet.growth-policy') {
    if (!['reject', 'clamp'].includes(a.growthFloor)) fail('成长下限规则无效');
    if (has(a, 'expectedRevision') && a.expectedRevision !== s.revision) fail('课堂数据已变化，请重新打开规则');
    s.settings.petRules.growthFloor = a.growthFloor; return;
  }
  if (a.type === 'pet.batch') {
    const requestId = assertRequest(s, a);
    const preview = Progress.batchPreview(s, a);
    if (!preview.rows.length || preview.excluded.length) fail('批量名单包含不符合资格的学生，请重新预览');
    if (a.operation === 'adopt' || a.operation === 'switch') pet(a.pet);
    if (a.operation === 'growth') apply(s, { type: 'pet.growth', ids: a.ids, delta: a.delta, reason: a.reason }, now);
    else for (const studentId of a.ids) {
      const student = s.students.find(v => v.id === studentId);
      if (a.operation === 'switch') { student.pet = a.pet; syncStudent(s, student, now); }
      else apply(s, { type: a.operation === 'adopt' ? 'pet.adopt' : 'pet.graduate', id: studentId, pet: a.pet }, now);
    }
    saveRequest(s, requestId, `batch.${a.operation}`, now); return;
  }
  if (a.type === 'pet.badge.redeem' || a.type === 'pet.badge.undo') {
    const requestId = assertRequest(s, a), student = s.students.find(v => v.id === a.id);
    if (!student) fail('找不到这位学生');
    const account = accountFor(s, student.id), transactions = account.badgeTransactions || [], balance = Progress.badgeBalance(account);
    if (transactions.length >= MAX_RECORDS) fail('徽章兑换记录数量已达上限');
    let transaction;
    if (a.type === 'pet.badge.redeem') {
      const amount = int(a.amount, 1, MAX_VALUE, '兑换徽章数');
      if (amount > balance.available) fail('可用徽章不足，兑换未执行');
      transaction = { id: `br_${randomUUID()}`, type: 'redeem', amount, timestamp: now, reason: text(a.reason, 120, '徽章兑换说明') };
    } else {
      const original = transactions.find(v => v.id === a.redemptionId && v.type === 'redeem');
      if (!original) fail('找不到原徽章兑换记录');
      if (transactions.some(v => v.type === 'undo' && v.redemptionId === original.id)) fail('这笔徽章兑换已经撤销');
      transaction = { id: `bu_${randomUUID()}`, type: 'undo', redemptionId: original.id, amount: original.amount, timestamp: now, reason: '撤销兑换：' + original.reason.slice(0, 100) };
    }
    (account.badgeTransactions ||= []).push(transaction); saveRequest(s, requestId, a.type === 'pet.badge.redeem' ? 'badge.redeem' : 'badge.undo', now); return;
  }
  if (a.type === 'pet.draw') { draw(s, a); return; }
  if (a.type === 'pet.draw.reset') { resetDraw(s); return; }
  if (a.type === 'pet.growth.mixed') {
    list(a.awards, '批量宠物成长奖励', 20); if (!a.awards.length) fail('批量宠物成长奖励不能为空');
    const seen = new Set();
    for (const award of a.awards) {
      record(award, '批量宠物成长奖励'); list(award.ids, '成长名单', 300);
      for (const studentId of award.ids) unique(seen, id(studentId, '学生编号'), '同一批成长奖励的学生');
    }
    for (const award of a.awards) apply(s, { type: 'pet.growth', ids: award.ids, delta: award.delta, reason: a.reason, expectedCycles: award.expectedCycles }, now);
    return;
  }
  if (a.type === 'pet.growth') {
    const delta = int(a.delta, -100, 100, '宠物成长增减'); if (!delta) fail('宠物成长增减不能为零');
    list(a.ids, '宠物成长名单', 300); if (!a.ids.length || new Set(a.ids).size !== a.ids.length) fail('宠物成长名单不能为空或重复');
    const selected = a.ids.map(value => { const student = s.students.find(v => v.id === id(value, '学生编号')); if (!student) fail('宠物成长名单包含不存在的学生'); return student; });
    if (a.expectedCycles !== undefined) {
      list(a.expectedCycles, '宠物成长目标快照', 300);
      const seen = new Set();
      if (a.expectedCycles.length !== selected.length) fail('宠物成长目标快照不完整，请重新选择');
      for (const expected of a.expectedCycles) {
        record(expected, '宠物成长目标快照'); unique(seen, id(expected.id, '学生编号'), '宠物成长目标快照');
        if (!a.ids.includes(expected.id) || accountFor(s, expected.id)?.activeCycleId !== id(expected.cycleId, '宠物周期编号')) fail('宠物已在另一窗口更换或毕业，请重新选择成长目标');
      }
    }
    const changes = selected.map(student => {
      const account = accountFor(s, student.id), cycle = cycleFor(account, account.activeCycleId);
      if (!cycle || cycle.status !== 'active' || student.adopted === false) fail('成长名单包含尚未领养宠物的学生');
      const beforeGrowth = cycle.netGrowth, actualDelta = Progress.growthFloor(s) === 'clamp' ? Math.max(0, beforeGrowth + delta) - beforeGrowth : delta;
      adjust(account, cycle.id, actualDelta);
      return { id: student.id, name: student.name, accountId: account.id, cycleId: cycle.id, beforeGrowth, afterGrowth: cycle.netGrowth,
        ...(Progress.growthFloor(s) === 'clamp' ? {actualDelta} : {}) };
    });
    s.petLogs.push({ id: `pg_${randomUUID()}`, timestamp: now, delta, reason: text(a.reason ?? '宠物成长', 120, '宠物成长原因', true), undone: false, changes, ...(Progress.growthFloor(s) === 'clamp' ? {floorPolicy: 'clamp'} : {}) }); return;
  }
  if (a.type === 'pet.undo') {
    const log = s.petLogs.find(v => v.id === a.logId); if (!log) fail('找不到这笔宠物成长记录'); if (log.undone) fail('这笔宠物成长已经撤销');
    if (log.changes.some(c => !s.students.some(v => v.id === c.id))) fail('记录包含已移除学生，无法整笔撤销；请先恢复对应备份');
    for (const change of log.changes) adjust(s.petAccounts.find(v => v.id === change.accountId), change.cycleId, change.beforeGrowth - change.afterGrowth);
    log.undone = true; return;
  }
  const student = s.students.find(v => v.id === a.id); if (!student) fail('找不到这位学生');
  if (has(a, 'expectedCycleId') && accountFor(s, student.id).activeCycleId !== (a.expectedCycleId === null ? null : id(a.expectedCycleId, '宠物周期编号'))) fail('宠物已在另一窗口更换或毕业，请重新打开');
  if (a.type === 'pet.adopt') { adopt(s, student, a.pet, now); resetDraw(s); return; }
  if (a.type === 'pet.graduate') {
    const account = accountFor(s, student.id), cycle = cycleFor(account, account.activeCycleId);
    if (!cycle || cycle.status !== 'active' || student.adopted === false) fail('这位学生没有可以毕业的当前宠物');
    if (has(a, 'expectedGraduation')) {
      const expected = record(a.expectedGraduation, '毕业确认快照');
      if (expected.pet !== cycle.pet || expected.growth !== cycle.netGrowth || expected.studentName !== student.name || expected.groupName !== student.group ||
          !Array.isArray(expected.thresholds) || expected.thresholds.length !== 6 || s.settings.petRules.thresholds.some((value, index) => value !== expected.thresholds[index])) {
        fail('毕业资料已在另一窗口变化，请重新打开毕业确认，核对伙伴、成长与规则');
      }
    }
    if (!Progress.progress(cycle.netGrowth, s.settings.petRules.thresholds).maxed) fail('宠物达到 LV7 满级后才能安排毕业');
    const graduation = { id: `gr_${randomUUID()}`, cycleId: cycle.id, graduatedAt: now, petSnapshot: cycle.pet,
      ruleSnapshot: { thresholds: [...s.settings.petRules.thresholds] }, growthSnapshot: cycle.netGrowth, levelSnapshot: 7, shapeSnapshot: 7,
      studentName: student.name, groupName: student.group, sourceActionId: `ga_${randomUUID()}` };
    account.graduations.push(graduation);
    account.badgeEvents.push({ id: `pb_${randomUUID()}`, type: 'graduation', graduationId: graduation.id, amount: 1, timestamp: now });
    cycle.status = 'graduated'; account.activeCycleId = null; student.adopted = false; resetDraw(s); return;
  }
  fail('未知宠物操作');
}

module.exports = { validateScoreEffect, validateExtensions, hasNewFields, enable, addStudent, syncStudent, scoreEffect, undoScoreEffect, resetDraw, clearCurrentGrowth, apply };
