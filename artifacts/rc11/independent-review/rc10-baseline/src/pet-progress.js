(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_VALUE = 1_000_000_000;
  const DEFAULT_THRESHOLDS = Object.freeze([5, 10, 15, 20, 25, 30]);
  function integer(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}需为 ${min}–${max} 的整数`);
    return value;
  }
  function thresholds(value) {
    if (!Array.isArray(value) || value.length !== 6) throw new Error('宠物升级规则需包含六段成长值');
    const result = value.map(v => integer(v, 1, MAX_VALUE, '每段成长值'));
    if (result.reduce((n, v) => n + v, 0) > MAX_VALUE) throw new Error('六段成长值合计不能超过 1000000000');
    return result;
  }
  function progress(growth, costs) {
    integer(growth, 0, MAX_VALUE, '宠物成长值');
    const steps = thresholds(costs);
    let remaining = growth, level = 1;
    for (const cost of steps) {
      if (remaining < cost) return { level, current: remaining, needed: cost, maxed: false, shape: level, growth, overflow: 0 };
      remaining -= cost; level++;
    }
    return { level: 7, current: 0, needed: null, maxed: true, shape: 7, growth, overflow: remaining };
  }
  // These are explicit Flower Classroom rules inferred for this application, not claims about a reference product's internal logic.
  function growthFloor(state) { return state.settings.petRules?.growthFloor || 'reject'; }
  function badgeBalance(account, legacyMedals = 0) {
    const total = (account?.legacyMedals ?? legacyMedals) + (account?.badgeEvents || []).reduce((n, v) => n + v.amount, 0);
    const spent = (account?.badgeTransactions || []).reduce((n, v) => n + (v.type === 'redeem' ? v.amount : -v.amount), 0);
    return { total, spent, available: total - spent };
  }
  function profile(state, studentOrId) {
    const student = typeof studentOrId === 'string' ? state.students.find(v => v.id === studentOrId) : studentOrId;
    if (!student || !state.students.some(v => v.id === student.id)) throw new Error('找不到这位学生');
    const account = state.petAccounts?.find(v => v.studentId === student.id);
    const legacyMedals = account ? account.legacyMedals : (student.medals || 0);
    const balance = badgeBalance(account, legacyMedals), medalTotal = balance.total;
    const shared = { legacyMedals, medalTotal, medalTotalIncludesLegacy: legacyMedals > 0, medalAvailable: account ? balance.available : null, medalSpent: balance.spent, medalBalanceKnown: !!account,
      graduates: account?.graduations || [], lifetimeNetGrowth: account?.lifetimeNetGrowth ?? student.growth,
      unassignedGrowth: account?.unassignedGrowth || 0, activeCycleId: account?.activeCycleId || null,
      hideLateForms: state.settings.hideLateForms === true };
    if (!state.settings.petRules || !account) {
      const step = integer(state.settings.petStep ?? 20, 1, 100, '每级成长值');
      const growth = integer(student.growth, 0, MAX_VALUE, '成长值'), level = Math.floor(growth / step) + 1;
      return { ...shared, enabled: false, mode: 'legacy-linked', level, current: growth % step, needed: step,
        maxed: false, shape: Math.min(7, level), growth, overflow: 0, adopted: student.adopted !== false, pet: student.pet };
    }
    const cycle = account.cycles.find(v => v.id === account.activeCycleId);
    return { ...shared, ...progress(cycle?.netGrowth || 0, state.settings.petRules.thresholds), enabled: true,
      mode: account.mode, adopted: !!cycle && cycle.status === 'active' && student.adopted !== false,
      pet: cycle?.pet || student.pet };
  }
  function batchPreview(state, options = {}) {
    if (!['growth', 'adopt', 'switch', 'graduate'].includes(options.operation)) throw new Error('批量宠物操作无效');
    if (!Array.isArray(options.ids) || options.ids.length > 300 || new Set(options.ids).size !== options.ids.length) throw new Error('批量名单格式无效或重复');
    if (options.operation === 'growth') { integer(options.delta, -100, 100, '宠物成长增减'); if (!options.delta) throw new Error('宠物成长增减不能为零'); }
    const rows = options.ids.map(id => {
      const student = state.students.find(v => v.id === id);
      if (!student) return { id, name: '已移除学生', eligible: false, reason: '学生已移除' };
      const p = profile(state, student); let reason = '';
      if (!p.enabled) reason = '请先启用六段成长规则';
      else if (options.operation === 'adopt' && p.adopted) reason = '已有正在成长的伙伴';
      else if (options.operation !== 'adopt' && !p.adopted) reason = '尚未领养伙伴';
      else if (options.operation === 'graduate' && !p.maxed) reason = '尚未达到 LV.7';
      else if (options.operation === 'switch' && options.pet === p.pet) reason = '已经是该伙伴';
      else if (options.operation === 'growth' && p.growth + options.delta < 0 && growthFloor(state) === 'reject') reason = '扣减后低于 0，当前规则拒绝';
      else if (options.operation === 'growth' && p.growth + options.delta > MAX_VALUE) reason = '成长值将超过上限';
      const afterGrowth = options.operation === 'growth' ? Math.max(0, p.growth + options.delta) : p.growth;
      return { id, name: student.name, group: student.group, eligible: !reason, reason, pet: p.pet, cycleId: p.activeCycleId,
        growth: p.growth, level: p.level, afterGrowth, actualDelta: afterGrowth - p.growth,
        afterLevel: p.enabled ? progress(afterGrowth, state.settings.petRules.thresholds).level : p.level };
    });
    return { operation: options.operation, expectedRevision: state.revision, rows, eligibleIds: rows.filter(v => v.eligible).map(v => v.id), excluded: rows.filter(v => !v.eligible) };
  }
  function honorCard(state, studentId) {
    const student = state.students.find(v => v.id === studentId); if (!student) throw new Error('找不到这位学生');
    const p = profile(state, student), account = state.petAccounts?.find(v => v.studentId === studentId);
    return { title: '成长荣誉卡', className: state.settings.className, studentId: student.id, studentName: student.name, groupName: student.group,
      pet: p.pet, shape: p.shape, adopted: p.adopted, level: p.level, growth: p.growth, totalHonors: p.medalTotal, availableBadges: p.medalAvailable,
      netSpent: p.medalSpent, legacyMedals: p.legacyMedals, graduationCount: p.graduates.length,
      graduations: p.graduates.map(g => ({ id: g.id, pet: g.petSnapshot, graduatedAt: g.graduatedAt, growth: g.growthSnapshot,
        studentName: g.studentName, groupName: g.groupName, level: g.levelSnapshot, thresholds: [...g.ruleSnapshot.thresholds] })),
      transactions: (account?.badgeTransactions || []).map(t => ({ ...t })),
      ruleNote: '花伴课堂规则：总荣誉永久保留，可用徽章＝总荣誉－本账本净兑换。旧奖章作为启用时荣誉基数，不虚构此前兑换或毕业记录。' };
  }
  // Only the selected dimension determines ties. The reference has not established a compound sort.
  function studentRankings(state, options = {}) {
    const sortBy = typeof options === 'string' ? options : (options.sortBy || 'medals');
    if (!['medals', 'level'].includes(sortBy)) throw new Error('宠物排行方式无效');
    const key = sortBy === 'level' ? 'level' : 'medalTotal';
    const rows = state.students.map(student => ({ student, id: student.id, name: student.name, group: student.group, ...profile(state, student) }));
    rows.sort((a, b) => b[key] - a[key]);
    rows.forEach((row, i) => { row.rank = i && row[key] === rows[i - 1][key] ? rows[i - 1].rank : i + 1; });
    return rows;
  }
  function groupRankings(state) {
    const groups = new Map();
    for (const student of state.students) {
      if (!groups.has(student.group)) groups.set(student.group, { group: student.group, count: 0, medalTotal: 0 });
      const row = groups.get(student.group); row.count++; row.medalTotal += profile(state, student).medalTotal;
    }
    const rows = [...groups.values()].map(v => ({ ...v, averageMedals: v.medalTotal / v.count }));
    rows.sort((a, b) => b.medalTotal * a.count - a.medalTotal * b.count);
    rows.forEach((row, i) => { const prev = rows[i - 1]; row.rank = i && row.medalTotal * prev.count === prev.medalTotal * row.count ? prev.rank : i + 1; });
    return rows;
  }
  return Object.freeze({ DEFAULT_THRESHOLDS, thresholds, progress, profile, studentRankings, groupRankings, growthFloor, badgeBalance, batchPreview, honorCard });
});
