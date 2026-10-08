(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetScoreProgression = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_VALUE = 1_000_000_000;
  const DEFAULT_PROGRESSION = Object.freeze({ version: 1, costs: Object.freeze([5, 10, 15, 20, 20, 20, 20]), repeatCost: 20 });
  const HISTORICAL_ACTION_MESSAGE = '宠物等级已统一按学生当前积分计算；独立成长操作已停用，暂不设置新的毕业方式。已有成长记录、毕业快照和徽章保留。请通过积分加减调整当前等级';
  function integer(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}需为 ${min}–${max} 的整数`);
    return value;
  }
  function validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('全局宠物进阶配置格式无效');
    if (Object.keys(value).some(key => !['version', 'costs', 'repeatCost'].includes(key)) || value.version !== 1) throw new Error('全局宠物进阶配置版本或字段无效');
    if (!Array.isArray(value.costs) || value.costs.length !== 7) throw new Error('全局宠物进阶需包含从 0→1 到 6→7 的七段积分');
    const costs = value.costs.map(cost => integer(cost, 1, MAX_VALUE, '进阶所需积分'));
    if (costs.reduce((sum, cost) => sum + cost, 0) > MAX_VALUE) throw new Error('七段进阶所需积分合计不能超过 1000000000');
    return { version: 1, costs, repeatCost: integer(value.repeatCost, 1, MAX_VALUE, '7 级以后每级所需积分') };
  }
  function get(state) { return validate(state?.petProgression === undefined ? DEFAULT_PROGRESSION : state.petProgression); }
  function key(state) { return JSON.stringify(get(state)); }
  function set(state, value, expectedKey) {
    if (expectedKey !== undefined && expectedKey !== key(state)) throw new Error('全局宠物进阶已在另一窗口修改，请重新打开并核对');
    state.petProgression = validate(value); state.version = 2;
    return state.petProgression;
  }
  function cumulative(value = DEFAULT_PROGRESSION) {
    let total = 0;
    return validate(value).costs.map(cost => (total += cost));
  }
  function progress(score, value = DEFAULT_PROGRESSION) {
    integer(score, -MAX_VALUE, MAX_VALUE, '学生当前积分');
    const progression = validate(value), usable = Math.max(0, score);
    let current = usable, level = 0, needed = progression.costs[0];
    for (const cost of progression.costs) {
      needed = cost;
      if (current < cost) return { level, current, needed, remainingToNext: needed - current + Math.max(0, -score), score, growth: usable, shape: Math.min(7, level), isEgg: level === 0, maxed: false, overflow: 0 };
      current -= cost; level++;
    }
    // Numeric progression never stops; the artwork has seven grown forms.
    level += Math.floor(current / progression.repeatCost);
    const overflow = current;
    current %= progression.repeatCost;
    return { level, current, needed: progression.repeatCost, remainingToNext: progression.repeatCost - current, score, growth: usable, shape: 7, isEgg: false, maxed: false, overflow };
  }
  return Object.freeze({ MAX_VALUE, DEFAULT_PROGRESSION, defaults: DEFAULT_PROGRESSION, HISTORICAL_ACTION_MESSAGE, validate, get, key, set, cumulative, progress });
});
