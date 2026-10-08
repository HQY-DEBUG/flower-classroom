'use strict';

const { randomUUID, randomInt } = require('node:crypto');
const PetLedger = require('./pet-ledger.cjs');
const PetProgress = require('./pet-progress.js');
const PetScoreProgression = require('./pet-score-progression.js');
const ScoreRules = require('./score-rules.js');
const ClassroomWheels = require('./classroom-wheels.js');
const ClassroomTools = require('./classroom-tools.js');
const GroupTools = require('./group-tools.js');
const OrganizationTools = require('./organization-tools.js');
const ToolboxExtra = require('./toolbox-extra.js');
const Configuration = require('./configuration-model.js');
const MAX_STUDENTS = 300;
const MAX_VALUE = 1_000_000_000;
const MAX_TIMER = 180 * 60 * 1000;
const MAX_PHOTO = 2 * 1024 * 1024;
const MAX_LOGS = 20_000;
const MAX_CHANGES = 100_000;
const MAX_STATE_BYTES = 90 * 1024 * 1024;
// One shared catalog drives validation, imports and every renderer choice.
const PETS = Object.keys(require('./pet-art.js').names);
// Cache only verified immutable photo strings; avoid re-decoding every roster photo on each point click.
const verifiedPhotos = new Map();
let verifiedPhotoBytes = 0;

function fail(message) { throw new Error(message); }
function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${label}格式无效`);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}需为 ${min}–${max} 的整数`);
  return value;
}
function text(value, max, label, allowEmpty = false) {
  if (typeof value !== 'string') fail(`${label}必须是文字`);
  const result = value.trim();
  if ((!allowEmpty && !result) || [...result].length > max || /[\u0000-\u001f\u007f]/u.test(result)) fail(`${label}${allowEmpty ? '' : '不能为空，且'}最多 ${max} 字`);
  return result;
}
function identifier(value, label = '编号') {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail(`${label}无效`);
  return value;
}
function photo(value) {
  if (value === '') return '';
  if (typeof value !== 'string' || value.length > MAX_PHOTO) fail('照片数据不能超过 2 MB');
  if (verifiedPhotos.has(value)) return value;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) fail('照片仅支持本地 PNG、JPEG、WebP 图片');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) fail('照片编码无效');
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : match[1] === 'jpeg' ? bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!valid) fail('照片内容与文件格式不符');
  while (verifiedPhotos.size >= MAX_STUDENTS || verifiedPhotoBytes + value.length > 50 * 1024 * 1024) {
    const oldest = verifiedPhotos.keys().next().value;
    verifiedPhotoBytes -= oldest.length; verifiedPhotos.delete(oldest);
  }
  verifiedPhotos.set(value, true); verifiedPhotoBytes += value.length;
  return value;
}
function student(input) {
  const s = record(input, '学生');
  if (!PETS.includes(s.pet)) fail('宠物类型无效');
  const result = { id: identifier(s.id, '学生编号'), name: text(s.name, 40, '姓名'), group: text(s.group, 40, '小组'),
    score: integer(s.score, -MAX_VALUE, MAX_VALUE, '积分'), growth: integer(s.growth, 0, MAX_VALUE, '成长值'), pet: s.pet, photo: photo(s.photo) };
  if (s.leader !== undefined) { if (typeof s.leader !== 'boolean') fail('组长标记无效'); result.leader = s.leader; }
  if (s.gender !== undefined) { if (!['', '男', '女'].includes(s.gender)) fail('性别仅支持男、女或留空'); result.gender = s.gender; }
  if (s.adopted !== undefined) { if (typeof s.adopted !== 'boolean') fail('领养状态无效'); result.adopted = s.adopted; }
  // Optional on old saves: absence preserves their existing zero-growth form.
  if (Object.hasOwn(s, 'startFromEgg')) { if (typeof s.startFromEgg !== 'boolean') fail('宠物蛋起始标记无效'); result.startFromEgg = s.startFromEgg; }
  if (s.medals !== undefined) result.medals = integer(s.medals, 0, MAX_VALUE, '奖章数');
  return result;
}
function idList(value, label, allowed, { empty = true } = {}) {
  if (!Array.isArray(value) || value.length > MAX_STUDENTS || (!empty && !value.length)) fail(`${label}需包含${empty ? '最多' : '1–'}300 位学生`);
  const result = value.map(id => identifier(id, label));
  if (new Set(result).size !== result.length) fail(`${label}不能重复`);
  if (allowed && result.some(id => !allowed.has(id))) fail(`${label}包含不存在的学生`);
  return result;
}
function timestamp(value) { return integer(value, 0, Number.MAX_SAFE_INTEGER - MAX_TIMER, '时间'); }

function validateState(input, nestedPanel = false, sharedRules = undefined) {
  const s = record(input, '备份');
  if (nestedPanel && s.sharedScoreRules !== undefined) fail('共享计分卡片只能保存在完整存档根部');
  if (nestedPanel && s.appConfig !== undefined) fail('启动显示设置只能保存在完整存档根部');
  if (nestedPanel && s.petProgression !== undefined) fail('全局宠物进阶只能保存在完整存档根部');
  const shared = !nestedPanel && s.sharedScoreRules !== undefined ? ScoreRules.validateShared(s.sharedScoreRules) : undefined;
  const canonicalRules = shared?.rules || sharedRules;
  if (canonicalRules && s.version !== 2) fail('共享计分卡片须使用新版存档格式');
  if (![1, 2].includes(s.version)) fail('不支持此备份版本');
  const revision = integer(s.revision, 0, Number.MAX_SAFE_INTEGER - 1, '数据版本');
  const rawSettings = record(s.settings, '班级设置');
  if ((s.appConfig !== undefined || rawSettings.toolDefaults !== undefined) && s.version !== 2) fail('统一配置需要新版存档格式');
  // Additive v1 migration: old classrooms keep the original 20-point rule.
  const settings = { className: text(rawSettings.className, 80, '班级名称'),
    petStep: rawSettings.petStep === undefined ? 20 : integer(rawSettings.petStep, 1, 100, '每级成长值'),
    petFocusId: rawSettings.petFocusId === undefined || rawSettings.petFocusId === '' ? '' : identifier(rawSettings.petFocusId, '展示宠物的学生编号') };
  if (rawSettings.showAvatars !== undefined) {
    if (typeof rawSettings.showAvatars !== 'boolean') fail('头像显示设置无效');
    settings.showAvatars = rawSettings.showAvatars;
  }
  if (rawSettings.timerSound !== undefined) {
    if (!['tick', 'applause', 'laser'].includes(rawSettings.timerSound)) fail('计时器响铃无效');
    settings.timerSound = rawSettings.timerSound;
  }
  if(rawSettings.groupOrder!==undefined){if(s.version!==2)fail('小组排序数据需要新版存档格式');settings.groupOrder=GroupTools.validateOrder(rawSettings.groupOrder);}
  if (rawSettings.scoreStep !== undefined) settings.scoreStep = integer(rawSettings.scoreStep, 1, 100, '快捷加减分值');
  if (rawSettings.toolDefaults !== undefined) settings.toolDefaults = Configuration.validateToolDefaults(rawSettings.toolDefaults);
  if (rawSettings.scoreRules !== undefined) settings.scoreRules = canonicalRules ? ScoreRules.validateSharedRules(rawSettings.scoreRules) : ScoreRules.validateRules(rawSettings.scoreRules);
  if (canonicalRules && (!settings.scoreRules || !ScoreRules.same(settings.scoreRules, canonicalRules))) fail('共享计分卡片与面板镜像不一致，请使用完整备份恢复');
  if(rawSettings.wheelPrizes!==undefined)settings.wheelPrizes=ClassroomWheels.prizes(rawSettings.wheelPrizes);
  if(rawSettings.challengeOptions!==undefined)settings.challengeOptions=ClassroomWheels.options(rawSettings.challengeOptions);
  if (!Array.isArray(s.students) || s.students.length > MAX_STUDENTS) fail('学生人数不能超过 300');
  let photoBytes = 0;
  const students = s.students.map(input => {
    const result = student(input);
    photoBytes += result.photo.length;
    if (photoBytes > 50 * 1024 * 1024) fail('全部照片数据不能超过 50 MB，请先压缩照片');
    return result;
  });
  const ids = new Set(students.map(v => v.id));
  if (ids.size !== students.length) fail('学生编号不能重复');
  if (settings.petFocusId && !ids.has(settings.petFocusId)) settings.petFocusId = '';
  if (!Array.isArray(s.logs) || s.logs.length > MAX_LOGS) fail('积分记录数量超过上限');
  let changeCount = 0;
  const logIds = new Set();
  const logs = s.logs.map(item => {
    const l = record(item, '积分记录');
    const id = identifier(l.id, '记录编号');
    if (logIds.has(id)) fail('积分记录编号不能重复');
    logIds.add(id);
    const redemption=l.kind==='redemption';
    if(l.kind!==undefined&&!redemption)fail('积分记录类型无效');
    const delta = integer(l.delta, redemption?-1000000:-100, redemption?-1:100, '分值');
    if (delta === 0) fail('分值不能为零');
    const customGrowth = Object.hasOwn(l, 'growthDelta');
    if (customGrowth && redemption) fail('兑换记录不能自定义成长值');
    const growthDelta = customGrowth ? integer(l.growthDelta, 0, 100, '记录成长值') : Math.max(0, delta);
    if (typeof l.undone !== 'boolean') fail('撤销状态无效');
    if (!Array.isArray(l.changes) || !l.changes.length || l.changes.length > MAX_STUDENTS) fail('积分变动记录无效');
    changeCount += l.changes.length;
    if (changeCount > MAX_CHANGES) fail('积分变动记录数量超过上限');
    const seen = new Set();
    const changes = l.changes.map(item => {
      const c = record(item, '学生积分变动');
      const cid = identifier(c.id, '学生编号');
      if (seen.has(cid)) fail('同一笔积分记录不能重复包含学生');
      seen.add(cid);
      const result = { id: cid, name: text(c.name, 40, '记录中的姓名'),
        beforeScore: integer(c.beforeScore, -MAX_VALUE, MAX_VALUE, '变动前积分'), afterScore: integer(c.afterScore, -MAX_VALUE, MAX_VALUE, '变动后积分'),
        beforeGrowth: integer(c.beforeGrowth, 0, MAX_VALUE, '变动前成长值'), afterGrowth: integer(c.afterGrowth, 0, MAX_VALUE, '变动后成长值') };
      if (result.afterScore - result.beforeScore !== delta || result.afterGrowth - result.beforeGrowth !== growthDelta) fail('积分记录前后数值不一致');
      if (Object.hasOwn(c, 'petEffect')) result.petEffect = PetLedger.validateScoreEffect(c.petEffect);
      return result;
    });
    const result={ id, timestamp: timestamp(l.timestamp), delta, reason: text(l.reason, 120, '积分原因', true), undone: l.undone, changes };
    if (customGrowth) result.growthDelta = growthDelta;
    if(redemption){if(changes.length!==1)fail('兑换记录只能包含一位学生');result.kind='redemption';result.redemptionId=identifier(l.redemptionId,'兑换编号');result.prize=ClassroomWheels.prizes([l.prize])[0];if(result.prize.cost!==-delta)fail('兑换价格与记录不一致');}
    return result;
  });
  if (s.version !== 2 && (settings.scoreRules?.some(rule => Object.hasOwn(rule, 'growthDelta')) || logs.some(log => Object.hasOwn(log, 'growthDelta')))) fail('自定义规则成长值须使用新版存档格式');
  const redemptionIds=logs.filter(l=>l.kind==='redemption').map(l=>l.redemptionId);if(new Set(redemptionIds).size!==redemptionIds.length)fail('兑换编号不能重复');
  if(s.version!==2&&(settings.wheelPrizes||settings.challengeOptions||redemptionIds.length))fail('轮盘数据须使用新版存档格式');
  const draw = OrganizationTools.validateDraw(s.draw, students);
  const t = record(s.timer, '计时状态');
  const timer = { durationMs: integer(t.durationMs, 1000, MAX_TIMER, '计时长度'), remainingMs: integer(t.remainingMs, 0, MAX_TIMER, '剩余时间'), endsAt: t.endsAt, running: t.running };
  if (timer.remainingMs > timer.durationMs || typeof timer.running !== 'boolean') fail('计时状态无效');
  if (timer.running) {
    timestamp(timer.endsAt);
    if (!timer.remainingMs) fail('运行中的计时器需有剩余时间');
  } else if (timer.endsAt !== null) fail('暂停的计时器不能包含结束时间');
  const result = { version: s.version, revision, settings, students, logs, draw, timer };
  if (!nestedPanel) { result.petProgression = PetScoreProgression.get(s); result.version = 2; }
  if (!nestedPanel && s.appConfig !== undefined) result.appConfig = Configuration.appConfig(s.appConfig);
  PetLedger.validateExtensions(s, result);
  ClassroomTools.validateExtensions(s, result);
  OrganizationTools.validateExtensions(s, result);
  ToolboxExtra.validateExtensions(s, result);
  if (s.groupBases !== undefined) {
    if (!Array.isArray(s.groupBases) || s.groupBases.length > MAX_STUDENTS) fail('小组基础分记录无效');
    const seen = new Set();
    result.groupBases = s.groupBases.map(item => {
      record(item, '小组基础分'); const group = text(item.group, 40, '小组');
      if(seen.has(group))fail('小组基础分不能重复');seen.add(group);
      return {group,score:integer(item.score,-MAX_VALUE,MAX_VALUE,'小组基础分')};
    });
  }
  if (s.groupLogs !== undefined) {
    if (!Array.isArray(s.groupLogs) || s.groupLogs.length > MAX_LOGS) fail('小组历史超过上限');
    const seen = new Set();
    result.groupLogs = s.groupLogs.map(item => {
      record(item, '小组历史');const id=identifier(item.id,'记录编号');
      if(seen.has(id))fail('小组记录编号重复');seen.add(id);
      const delta=integer(item.delta,-100,100,'小组分值'),before=integer(item.before,-MAX_VALUE,MAX_VALUE,'原基础分'),after=integer(item.after,-MAX_VALUE,MAX_VALUE,'新基础分');
      if(!delta||after-before!==delta||typeof item.undone!=='boolean')fail('小组积分记录不一致');
      return {id,group:text(item.group,40,'小组'),delta,before,after,reason:text(item.reason,120,'原因',true),timestamp:timestamp(item.timestamp),undone:item.undone};
    });
  }
  if (s.panels !== undefined) {
    if (nestedPanel) fail('面板备份不能嵌套');
    const panels = record(s.panels, '面板集合');
    const activeId = identifier(panels.activeId, '当前面板编号');
    if (!Array.isArray(panels.others) || panels.others.length > 19) fail('最多保留20个面板');
    const seen = new Set([activeId]);
    const others = panels.others.map(item => {
      record(item, '其他面板');
      const id = identifier(item.id, '面板编号');
      if (seen.has(id)) fail('面板编号不能重复');
      seen.add(id);
      const data = validateState(item.data, true, canonicalRules);
      photoBytes += data.students.reduce((n, item) => n + item.photo.length, 0);
      if (photoBytes > 50 * 1024 * 1024) fail('全部面板照片不能超过50MB');
      return { id, data };
    });
    result.panels = { activeId, others };
    if (s.version !== 2 && others.some(p => p.data.version === 2)) fail('包含新版宠物数据的面板集合必须使用 version 2');
  }
  if (shared) result.sharedScoreRules = shared;
  if (!nestedPanel) assertStateCapacity(result);
  return result;
}

function assertStateCapacity(state, { maxBytes = MAX_STATE_BYTES } = {}) {
  integer(maxBytes, 1, MAX_STATE_BYTES, '存档容量上限');
  const bytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
  if (bytes > maxBytes) fail(`完整存档超过 ${Math.floor(maxBytes / 1024 / 1024)} MiB 安全容量上限，请先备份并整理历史；本次操作未保存`);
  return bytes;
}

function makeStudent(name, group, pet = 'owl', image = '') {
  return student({ id: `s_${randomUUID()}`, name, group, score: 0, growth: 0, pet, photo: image, startFromEgg: true });
}
function createInitialState() {
  const groups = ['向日葵组', '四叶草组', '郁金香组', '彩虹组'];
  return { version: 2, revision: 0, petProgression: PetScoreProgression.get(), settings: { className: '阳光示例班', petStep: 20, petFocusId: '' },
    students: Array.from({ length: 12 }, (_, i) => makeStudent(`示例同学${String(i + 1).padStart(2, '0')}`, groups[Math.floor(i / 3)], PETS[i % PETS.length])),
    logs: [], draw: { mode: 'cycle', bag: [], lastIds: [], round: 0 },
    timer: { durationMs: 5 * 60 * 1000, remainingMs: 5 * 60 * 1000, endsAt: null, running: false } };
}
function remainingMs(timer, now = Date.now()) {
  record(timer, '计时状态'); timestamp(now);
  return timer.running ? Math.max(0, Math.min(timer.durationMs, timer.endsAt - now)) : timer.remainingMs;
}
function petLevel(s, progression = PetScoreProgression.DEFAULT_PROGRESSION) {
  const p = PetScoreProgression.progress(record(s, '学生').score, progression);
  return { level: p.level, current: p.current, needed: p.needed };
}
function shuffled(ids) {
  const result = [...ids];
  for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function resetDraw(s) { OrganizationTools.resetDraw(s, true); PetLedger.resetDraw(s); }
function finish(s) {
  ClassroomTools.reconcile(s);
  OrganizationTools.reconcile(s);
  ToolboxExtra.reconcile(s);
  if(s.settings.groupOrder!==undefined)s.settings.groupOrder=GroupTools.reconcileOrder(s);
  if (s.appConfig !== undefined || s.settings.toolDefaults !== undefined || OrganizationTools.hasNewFields(s) || ToolboxExtra.hasNewFields(s) || s.settings.groupOrder!==undefined || ClassroomTools.hasNewFields(s) || s.settings.wheelPrizes || s.settings.challengeOptions || s.settings.scoreRules?.some(rule => Object.hasOwn(rule, 'growthDelta')) || s.logs.some(l=>l.kind==='redemption' || Object.hasOwn(l, 'growthDelta')) || PetLedger.hasNewFields(s) || s.panels?.others.some(p => p.data.version === 2)) s.version = 2;
  s.revision += 1; return validateState(s);
}
function panelId(s) { return s.panels?.activeId || 'panel_default'; }
function withoutPanels(s) { const result = { ...s }; delete result.panels; delete result.sharedScoreRules; delete result.appConfig; delete result.petProgression; return result; }
function panelList(s) { return [{ id: panelId(s), name: s.settings.className, count: s.students.length }, ...(s.panels?.others || []).map(p => ({ id: p.id, name: p.data.settings.className, count: p.data.students.length }))]; }
function writeScore(s, ids, delta, reason, now) {
  integer(delta, -100, 100, '分值');
  if (delta === 0) fail('分值不能为零');
  // RC19 points own current progression. Historical growth ledgers are frozen
  // for new score actions, including old cards with growthDelta metadata.
  const growthDelta = 0;
  const selected = new Set(idList(ids, '积分名单', new Set(s.students.map(item => item.id)), { empty: false }));
  const changes = [];
  for (const item of s.students) if (selected.has(item.id)) {
    const beforeScore = item.score, beforeGrowth = item.growth;
    item.score += delta; item.growth += growthDelta;
    const change = { id: item.id, name: item.name, beforeScore, afterScore: item.score, beforeGrowth, afterGrowth: item.growth };
    const petEffect = PetLedger.scoreEffect(s, item, growthDelta);
    if (petEffect !== undefined) change.petEffect = petEffect;
    changes.push(change);
  }
  s.logs.push({ id: `l_${randomUUID()}`, timestamp: now, delta, reason: text(reason ?? '课堂表现', 120, '积分原因', true), undone: false, changes,
    growthDelta });
}

function selectedRule(s, a) {
  if (a.expectedRule === undefined) return undefined;
  const expected = ScoreRules.validateRules([a.expectedRule])[0];
  const current = ScoreRules.list(s).find(rule => rule.id === expected.id);
  if (!current || !ScoreRules.same([expected], [current])) fail('规则已在另一窗口修改，请重新选择原因');
  const delta = a.type === 'pet.growth' ? ScoreRules.effectiveGrowth(current, true) : current.delta;
  if (a.delta !== delta || a.reason !== current.label) fail('评分内容与所选规则不一致，请重新选择原因');
  return current;
}

function assertPetScoreTargets(s, a, ids) {
  if(a.expectedPetDraw!==undefined)idList(ids,'宠物抽取积分名单',new Set(s.petDraw?.lastIds||[]),{empty:false});
  if (a.expectedCycles === undefined) return;
  const targets=idList(ids,'宠物积分名单',new Set(s.students.map(v=>v.id)),{empty:false});
  if(!Array.isArray(a.expectedCycles)||a.expectedCycles.length!==targets.length)fail('宠物积分目标快照不完整，请重新选择');
  const seen=new Set();
  for(const raw of a.expectedCycles){
    const expected=record(raw,'宠物积分目标快照'),studentId=identifier(expected.id,'学生编号');
    if(seen.has(studentId)||!targets.includes(studentId))fail('宠物积分目标快照重复或包含无效学生');
    seen.add(studentId);
    const cycleId=expected.cycleId===null?null:identifier(expected.cycleId,'宠物周期编号');
    const current=PetProgress.profile(s,studentId);
    if(!current.adopted||current.activeCycleId!==cycleId)fail('宠物已在另一窗口更换或暂停领养，请重新选择积分目标');
  }
}
function applyAction(state, action, now = Date.now()) {
  const s = validateState(state);
  const a = record(action, '操作');
  timestamp(now);
  if (a.panelId !== undefined && a.panelId !== panelId(s)) fail('当前面板已切换，请重新选择学生');
  if (a.expectedProgressionKey !== undefined && a.expectedProgressionKey !== PetScoreProgression.key(s)) fail('全局宠物进阶已在另一窗口修改，请重新打开并核对');
  for (const field of ['expectedKey', 'expectedRulesKey']) if (a[field] !== undefined && a[field] !== ScoreRules.key(s)) fail('共享规则或面板已在另一窗口修改，请重新打开并核对');
  if (a.sharedRevision !== undefined && a.sharedRevision !== s.sharedScoreRules?.revision) fail('共享规则已在另一窗口修改，请重新打开');
  if(a.expectedDraw!==undefined&&a.expectedDraw!==OrganizationTools.drawKey(s))fail('点名结果已变化，请重新确认奖励');
  if(a.expectedPetDraw!==undefined&&a.expectedPetDraw!==OrganizationTools.petDrawKey(s))fail('宠物抽取结果已变化，请重新确认成长奖励');
  if(['panel.remove','panel.clear'].includes(a.type)&&a.expectedRevision!==undefined&&a.expectedRevision!==s.revision)fail('面板资料已更新，请重新核对后确认清理');
  if(ClassroomTools.handles(a.type)){ClassroomTools.apply(s,a);return finish(s);}
  if(ToolboxExtra.handles(a.type)){ToolboxExtra.apply(s,a,now);return finish(s);}
  switch (a.type) {
    case 'panel.create': {
      if (!['blank', 'copy', 'full'].includes(a.mode)) fail('新面板方式无效');
      const others = s.panels?.others || [];
      if (others.length >= 19) fail('最多保留20个面板，请先备份并整理');
      ScoreRules.promoteShared(s);
      // Roster/history IDs belong to each panel; shared card IDs never do.
      const copySource = withoutPanels(s);
      copySource.settings = { ...copySource.settings }; delete copySource.settings.scoreRules;
      const next = a.mode === 'full' ? OrganizationTools.copyPanel(copySource,()=>`copy_${randomUUID()}`) : createInitialState();
      next.settings.className = text(a.name, 80, '面板名称');
      if(a.mode!=='full'){
       next.settings.petStep = a.mode === 'copy' ? s.settings.petStep : 5;
       next.students = a.mode === 'copy' ? s.students.map((v, i) => ({...makeStudent(v.name, v.group, PETS[i % PETS.length]), ...(v.gender !== undefined ? {gender: v.gender} : {})})) : [];
       PetLedger.enable(next, a.mode === 'copy' && s.settings.petRules ? s.settings.petRules.thresholds : [5, 5, 5, 5, 5, 5], now, false);
      }
      next.revision = s.revision;
      next.panels = { activeId: `p_${randomUUID()}`, others: [...others, { id: panelId(s), data: withoutPanels(s) }] };
      next.sharedScoreRules = s.sharedScoreRules; ScoreRules.mirrorShared(next);
      next.petProgression = s.petProgression;
      if (s.appConfig !== undefined) next.appConfig = s.appConfig;
      return finish(next);
    }
    case 'panel.switch': {
      const target = (s.panels?.others || []).find(p => p.id === a.id);
      if (!target) fail('找不到要切换的面板');
      const next = { ...target.data, revision: s.revision, panels: { activeId: target.id, others: [...s.panels.others.filter(p => p.id !== a.id), { id: panelId(s), data: withoutPanels(s) }] } };
      if (s.sharedScoreRules) { next.sharedScoreRules = s.sharedScoreRules; ScoreRules.mirrorShared(next); }
      next.petProgression = s.petProgression;
      if (s.appConfig !== undefined) next.appConfig = s.appConfig;
      return finish(next);
    }
    case 'panel.remove': {
      const target = s.panels?.others[0];
      if (!target) fail('至少需要保留一个面板');
      const next = { ...target.data, revision: s.revision, panels: { activeId: target.id, others: s.panels.others.slice(1) } };
      if (s.sharedScoreRules) { next.sharedScoreRules = s.sharedScoreRules; ScoreRules.mirrorShared(next); }
      next.petProgression = s.petProgression;
      if (s.appConfig !== undefined) next.appConfig = s.appConfig;
      return finish(next);
    }
    case 'panel.clear':
      s.students=[];s.logs=[];delete s.groupBases;delete s.groupLogs;
      if(s.petAccounts)s.petAccounts=[];if(s.petLogs)s.petLogs=[];
      delete s.petOperations;
      s.settings.petFocusId='';resetDraw(s);break;
    case 'points.clear': {
      const options=a.options===undefined?{scores:true,groupScores:true,petGrowth:false,history:true,petHistory:false}:record(a.options,'清零选项');
      if(Object.keys(options).some(key=>!['scores','groupScores','petGrowth','history','petHistory'].includes(key))||['scores','groupScores','petGrowth','history','petHistory'].some(key=>typeof options[key]!=='boolean')||!Object.values(options).some(Boolean))fail('请明确选择至少一个清零项目');
      if(a.options!==undefined&&(a.expectedRevision!==s.revision||a.confirmed!==true))fail('数据已更新或尚未确认，请重新查看清零范围');
      if(options.scores)s.students.forEach(item=>{item.score=0;});
      if(options.groupScores&&s.groupBases)s.groupBases.forEach(item=>{item.score=0;});
      if(options.petGrowth)fail(PetScoreProgression.HISTORICAL_ACTION_MESSAGE);
      if(options.history){s.logs=[];if(s.groupLogs)s.groupLogs=[];}if(options.petHistory&&s.petLogs)s.petLogs=[];
      break;
    }
    case 'students.sort':
      if(!Object.hasOwn(OrganizationTools.sorts,a.mode))fail('成员排序方式无效');s.settings.studentSort=a.mode;break;
    case 'students.order':
      if(typeof a.panelId!=='string'||a.panelId!==panelId(s))fail('请在当前面板重新打开成员排序');OrganizationTools.setOrder(s,a);break;
    case 'photos.batch': {
      if (!Array.isArray(a.updates) || !a.updates.length || a.updates.length > MAX_STUDENTS) fail('没有可应用的头像');
      idList(a.updates.map(item => record(item, '头像更新').id), '头像名单', new Set(s.students.map(item => item.id)), { empty: false });
      const updates = new Map(a.updates.map(item => [item.id, photo(item.photo)]));
      s.students.forEach(item => { if (updates.has(item.id)) item.photo = updates.get(item.id); });
      break;
    }
    case 'photos.visibility':
      if (typeof a.value !== 'boolean') fail('头像显示设置无效');
      s.settings.showAvatars = a.value; break;
    case 'timer.sound':
      if (!['tick', 'applause', 'laser'].includes(a.sound)) fail('计时器响铃无效');
      s.settings.timerSound = a.sound; break;
    case 'tools.defaults': Configuration.setToolDefaults(s, a.toolDefaults, a.expectedToolDefaults); break;
    case 'score.step': s.settings.scoreStep = integer(a.value, 1, 100, '快捷加减分值'); break;
    case 'rules.save':
      if (a.expectedRules !== undefined && !ScoreRules.same(a.expectedRules, ScoreRules.list(s))) fail('规则已在另一窗口修改，请重新打开');
      ScoreRules.setShared(s, a.rules); break;
    case 'rules.share':
      if (a.confirmed !== true) fail('请先预览并明确确认合并共享计分卡片');
      ScoreRules.confirmShared(s, a.expectedKey ?? a.expectedRulesKey); break;
    case 'group.create': {
      if(typeof a.panelId!=='string'||a.panelId!==panelId(s))fail('请在当前面板重新创建小组');
      const patch=GroupTools.createGroupPatch(s,a.group);s.groupBases=patch.groupBases;if(patch.groupOrder!==undefined)s.settings.groupOrder=patch.groupOrder;s.version=2;break;
    }
    case 'group.order': {
      if(typeof a.panelId!=='string'||a.panelId!==panelId(s))fail('请在当前面板重新打开小组排序');
      s.settings.groupOrder=GroupTools.orderPatch(s,a.order,a.expectedOrder).groupOrder;s.version=2;break;
    }
    case 'group.base': {
      const group = text(a.group,40,'小组'),delta=integer(a.delta,-100,100,'小组分值');
      if(!delta)fail('分值不能为零');
      if(!s.students.some(v=>v.group===group)&&!s.groupBases?.some(v=>v.group===group))fail('找不到这个小组');
      s.groupBases ||= [];s.groupLogs ||= [];
      let target=s.groupBases.find(v=>v.group===group);
      if(!target){target={group,score:0};s.groupBases.push(target);}
      const before=target.score;target.score+=delta;
      s.groupLogs.push({id:`g_${randomUUID()}`,group,delta,before,after:target.score,reason:text(a.reason??'小组基础分',120,'原因',true),timestamp:now,undone:false});
      break;
    }
    case 'group.undo': {
      const log=s.groupLogs?.find(v=>v.id===a.logId);if(!log)fail('找不到小组记录');if(log.undone)fail('记录已撤销');
      const target=s.groupBases?.find(v=>v.group===log.group);if(!target)fail('找不到小组基础分');
      target.score-=log.delta;log.undone=true;break;
    }
    case 'students.group.create': {
      if(typeof a.panelId!=='string'||a.panelId!==panelId(s))fail('请在当前面板重新打开分配窗口');
      const patch=GroupTools.createAndAssignPatch(s,a.ids,a.expectedAssignments,a.group),ids=new Set(a.ids);
      s.groupBases=patch.groupBases;if(patch.groupOrder!==undefined)s.settings.groupOrder=patch.groupOrder;
      s.students.forEach(item=>{if(ids.has(item.id))item.group=patch.group;});
      s.version=2;OrganizationTools.resetDraw(s,true,true);PetLedger.resetDraw(s);break;
    }
    case 'students.group': {
      const ids = new Set(idList(a.ids, '分组名单', new Set(s.students.map(item => item.id)), { empty: false }));
      const group = a.expectedAssignments!==undefined||a.requireExistingGroup===true?GroupTools.assertAssignments(s,[...ids],a.expectedAssignments,a.group):text(a.group, 40, '小组');
      s.students.forEach(item => { if (ids.has(item.id)) item.group = group; });
      OrganizationTools.resetDraw(s,true,true);
      PetLedger.resetDraw(s);
      break;
    }
    case 'student.add':
      if (s.students.length >= MAX_STUDENTS) fail('每班最多 300 位学生');
      s.students.push(makeStudent(a.name, a.group == null || a.group === '' ? '未分组' : a.group, a.pet ?? 'owl', a.photo ?? ''));
      if (a.leader !== undefined) s.students[s.students.length - 1] = student({...s.students[s.students.length - 1],leader:a.leader});
      if (a.adopted !== undefined) s.students[s.students.length - 1] = student({...s.students[s.students.length - 1],adopted:a.adopted});
      if (a.gender !== undefined) s.students[s.students.length - 1] = student({...s.students[s.students.length - 1],gender:a.gender});
      PetLedger.addStudent(s, s.students[s.students.length - 1], now);
      resetDraw(s);
      break;
    case 'student.update': {
      const index = s.students.findIndex(item => item.id === a.id);
      if (index < 0) fail('找不到这位学生');
      const previous = s.students[index];
      const patch = {};
      for (const key of ['name', 'group', 'pet', 'photo', 'leader', 'adopted', 'gender']) if (Object.hasOwn(a, key)) patch[key] = a[key];
      if (patch.group === '') patch.group = '未分组';
      const updated = student({ ...previous, ...patch });
      const fieldValue = (value,key) => key === 'leader' ? value.leader === true : key === 'adopted' ? value.adopted !== false : key === 'gender' ? (value.gender || '') : value[key];
      // Modern editors send only fields the teacher changed. Compare those
      // fields atomically; unrelated scores, photos or roster edits can survive.
      // Older action callers remain supported without a snapshot.
      if (a.expectedStudent !== undefined) {
        const expected = record(a.expectedStudent, '学生档案快照');
        if (Object.keys(expected).sort().join(',') !== Object.keys(patch).sort().join(',')) fail('学生档案快照不完整，请关闭后重新打开编辑窗口');
        for (const key of Object.keys(patch)) {
          if (fieldValue(previous,key) !== expected[key] && fieldValue(previous,key) !== fieldValue(updated,key)) fail('学生档案已在另一窗口变化，请关闭后重新打开编辑窗口，再核对并保存');
        }
      }
      if (a.expectedPetContext !== undefined) {
        const expected = record(a.expectedPetContext, '宠物周期快照'), current = PetProgress.profile(s,previous);
        if (Object.keys(expected).sort().join(',') !== 'adopted,cycleId,enabled,pet' || typeof expected.enabled !== 'boolean' || typeof expected.adopted !== 'boolean' || !(expected.cycleId === null || typeof expected.cycleId === 'string')) fail('宠物周期快照格式无效');
        if (expected.enabled !== current.enabled || expected.cycleId !== current.activeCycleId || expected.pet !== previous.pet || expected.adopted !== (previous.adopted !== false)) fail('宠物或成长周期已在另一窗口变化，请关闭后重新打开编辑窗口');
      }
      s.students[index] = updated;
      const groupChanged = previous.group !== updated.group, adoptedChanged = (previous.adopted !== false) !== (updated.adopted !== false);
      if (previous.pet !== updated.pet || adoptedChanged) PetLedger.syncStudent(s, updated, now);
      if (groupChanged) OrganizationTools.resetDraw(s,true,true);
      if (groupChanged || adoptedChanged) PetLedger.resetDraw(s);
      break;
    }
    case 'student.remove': {
      const index = s.students.findIndex(item => item.id === a.id);
      if (index < 0) fail('找不到这位学生');
      // Confirm the reviewed target at the transaction boundary. Its complete
      // account includes new cycles, graduations and permanent honors; changes
      // to another student's profile or account do not expire this confirmation.
      if (a.expectedRemoval !== undefined && !ClassroomWheels.same(a.expectedRemoval, {
        student: s.students[index], petAccount: s.petAccounts?.find(v => v.studentId === a.id) || null
      })) fail('学生档案或宠物成长、荣誉已变化，请关闭后重新核对并确认移除');
      s.students.splice(index, 1); resetDraw(s);
      break;
    }
    case 'settings':
      if(a.expectedClassName!==undefined&&a.expectedClassName!==s.settings.className)fail('面板名称已在另一窗口修改，请关闭后重新核对');
      s.settings.className = text(a.className, 80, '班级名称'); break;
    case 'petProgression.update': PetScoreProgression.set(s, a.petProgression, a.expectedProgressionKey); break;
    case 'pet.rules': fail(PetScoreProgression.HISTORICAL_ACTION_MESSAGE); break;
    case 'pet.switch': {
      if(a.panelId!==panelId(s))fail('面板已切换，请重新选择伙伴');
      const student=s.students.find(v=>v.id===a.id);if(!student)fail('找不到这位学生');
      const profile=PetProgress.profile(s,student);
      if(!profile.adopted)fail('当前伙伴尚未领养，请使用领养入口');
      if(student.pet!==a.expectedPet||(profile.activeCycleId||null)!==(a.expectedCycleId||null))fail('伙伴或成长周期已经变化，请重新选择');
      if(!PETS.includes(a.pet))fail('宠物类型无效');
      student.pet=a.pet;PetLedger.syncStudent(s,student);break;
    }
    case 'pet.stage-rules': case 'pet.growth': case 'pet.growth.mixed': case 'pet.undo': case 'pet.graduate': case 'pet.adopt': case 'pet.visibility': case 'pet.draw': case 'pet.draw.reset': case 'pet.batch': case 'pet.growth-policy': case 'pet.badge.redeem': case 'pet.badge.undo':
      if (a.type === 'pet.growth') selectedRule(s, a);
      PetLedger.apply(s, a, now);
      if (a.type === 'pet.draw') Configuration.setToolDefaults(s, {petDrawScope: s.petDraw.scope, petDrawMode: s.petDraw.mode, petDrawCount: a.count ?? 1});
      break;
    case 'pet.focus': {
      const id = identifier(a.id, '展示宠物的学生编号');
      if (!s.students.some(item => item.id === id)) fail('找不到这位学生');
      s.settings.petFocusId = id;
      break;
    }
    case 'wheel.prizes': {
      if(a.expected!==undefined&&!ClassroomWheels.same(a.expected,ClassroomWheels.list(s)))fail('奖品设置已被其他窗口修改，请重新打开');
      s.settings.wheelPrizes=ClassroomWheels.prizes(a.prizes);break;
    }
    case 'wheel.challenges': {
      if(a.expected!==undefined&&!ClassroomWheels.same(a.expected,ClassroomWheels.challengeList(s)))fail('挑战设置已被其他窗口修改，请重新打开');
      s.settings.challengeOptions=ClassroomWheels.options(a.options);break;
    }
    case 'wheel.redeem': {
      const student=s.students.find(v=>v.id===a.id);if(!student)fail('学生已移除，请重新选择');
      const token=identifier(a.redemptionId,'兑换编号');if(s.logs.some(l=>l.redemptionId===token))fail('这次兑换已经处理，请查看积分记录');
      const prize=ClassroomWheels.list(s).find(p=>p.id===a.prizeId);if(!prize||!ClassroomWheels.same(prize,a.expectedPrize))fail('奖品或价格已改变，请重新抽取');
      if(a.expectedScore!==student.score)fail('学生积分已改变，请重新确认兑换');
      if(a.expectedStudent!==undefined&&!ClassroomWheels.same(a.expectedStudent,ClassroomWheels.studentIdentity(student)))fail('兑换学生档案已变化，请重新抽取并确认');
      if(student.score<prize.cost&&a.allowDebt!==true)fail('当前积分不足，请明确确认强制兑换');
      const before=student.score;student.score-=prize.cost;
      s.logs.push({id:`l_${randomUUID()}`,kind:'redemption',redemptionId:token,prize:{...prize},timestamp:now,delta:-prize.cost,reason:'兑换奖品：'+prize.name,undone:false,changes:[{id:student.id,name:student.name,beforeScore:before,afterScore:student.score,beforeGrowth:student.growth,afterGrowth:student.growth,...(s.settings.petRules?{petEffect:null}:{})}]});
      break;
    }
    case 'score': {
      assertPetScoreTargets(s, a, a.ids);
      selectedRule(s, a);
      if (Object.hasOwn(a, 'growthDelta') && a.growthDelta !== 0) fail('当前计分只更改学生积分，旧独立成长参数已停用，请刷新后重新选择积分原因');
      writeScore(s, a.ids, a.delta, a.reason, now);
      break;
    }
    case 'score.mixed': {
      const sourceDraw=a.expectedPetDraw!==undefined?s.petDraw:s.draw;
      if(!sourceDraw)fail('点名结果已变化，请重新确认奖励');
      const maximum=sourceDraw.scope==='groups'?MAX_STUDENTS:20;
      if (!Array.isArray(a.awards) || !a.awards.length || a.awards.length > maximum) fail(`单次点名奖励需包含1–${maximum}位学生`);
      const awardIds=idList(a.awards.map(item => record(item, '点名奖励').id), '点名奖励名单', new Set(sourceDraw.lastIds), { empty: false });
      assertPetScoreTargets(s, a, awardIds);
      const groups = new Map();
      for (const award of a.awards) {
        const delta = integer(award.delta, a.expectedPetDraw!==undefined?-100:1, 100, '奖励分值');
        if(delta===0)fail('分值不能为零');
        if (!groups.has(delta)) groups.set(delta, []);
        groups.get(delta).push(award.id);
      }
      for (const [delta, ids] of groups) writeScore(s, ids, delta, a.reason ?? '随机点名奖励', now);
      break;
    }
    case 'undo': {
      const log = s.logs.find(item => item.id === a.logId);
      if (!log) fail('找不到这笔积分记录');
      if (log.undone) fail('这笔积分已经撤销');
      const byId = new Map(s.students.map(item => [item.id, item]));
      if (log.changes.some(c => !byId.has(c.id))) fail('记录包含已移除学生，无法整笔撤销；请先恢复对应备份');
      for (const change of log.changes) {
        const item = byId.get(change.id);
        item.score -= change.afterScore - change.beforeScore;
        item.growth -= change.afterGrowth - change.beforeGrowth;
        PetLedger.undoScoreEffect(s, change);
      }
      log.undone = true;
      break;
    }
    case 'draw':
      OrganizationTools.draw(s,a,shuffled);
      Configuration.setToolDefaults(s, {drawScope: s.draw.scope || 'students', drawMode: s.draw.mode, drawCount: a.count ?? 1}); break;
    case 'draw.select':
      OrganizationTools.selectDraw(s,a.scope??s.draw.scope??'students',a.mode??s.draw.mode);
      Configuration.setToolDefaults(s, {drawScope: s.draw.scope || 'students', drawMode: s.draw.mode}); break;
    case 'draw.reset': OrganizationTools.resetDraw(s);break;
    case 'timer.set': {
      const durationMs = integer(a.seconds, 1, MAX_TIMER / 1000, '计时秒数') * 1000;
      Configuration.setToolDefaults(s, {timerDurationSeconds: a.seconds});
      s.timer = { durationMs, remainingMs: durationMs, endsAt: null, running: false }; break;
    }
    case 'timer.start':
      if (!s.timer.running) {
        if (s.timer.remainingMs === 0) s.timer.remainingMs = s.timer.durationMs;
        s.timer.endsAt = now + s.timer.remainingMs; s.timer.running = true;
      }
      break;
    case 'timer.pause':
      s.timer.remainingMs = remainingMs(s.timer, now); s.timer.endsAt = null; s.timer.running = false;
      break;
    case 'timer.reset':
      if (s.settings.toolDefaults !== undefined) s.timer.durationMs = Configuration.toolDefaults(s).timerDurationSeconds * 1000;
      s.timer.remainingMs = s.timer.durationMs; s.timer.endsAt = null; s.timer.running = false;
      break;
    default: fail('未知操作');
  }
  return finish(s);
}

function importRows(rows, existingState, mode = 'append') {
  const s = validateState(existingState);
  if (!['append', 'replace'].includes(mode)) fail('名单导入模式无效');
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_STUDENTS) fail('名单需包含 1–300 位学生');
  const incoming = rows.map((row, i) => {
    const r = record(row, `第 ${i + 1} 行`);
    const name = r['姓名'] ?? r.name;
    const group = r['小组'] ?? r['组号'] ?? r.group ?? '未分组';
    // Import preparation resolves optional avatar names to bounded local image
    // snapshots. Persist the snapshot only, never a folder path or filename.
    try { const incoming = makeStudent(name, typeof group === 'string' && !group.trim() ? '未分组' : group, PETS[i % PETS.length], Object.hasOwn(r, 'photo') ? r.photo : ''); const gender = r['性别'] ?? r.gender; return gender === undefined ? incoming : student({...incoming, gender}); }
    catch (error) { fail(`第 ${i + 1} 行：${error.message}`); }
  });
  if (mode === 'replace') { const emptyGroups=(s.groupBases||[]).filter(g=>!s.students.some(student=>student.group===g.group)).map(g=>({group:g.group,score:0}));s.students = incoming; s.logs = []; if(emptyGroups.length)s.groupBases=emptyGroups;else delete s.groupBases; delete s.groupLogs; if(s.petAccounts)s.petAccounts=[];if(s.petLogs)s.petLogs=[]; delete s.petOperations; }
  else s.students.push(...incoming);
  for (const student of incoming) PetLedger.addStudent(s, student, Date.now());
  if (s.students.length > MAX_STUDENTS) fail('导入后学生人数不能超过 300');
  resetDraw(s);
  return finish(s);
}

module.exports = { createInitialState, validateState, applyAction, remainingMs, petLevel, importRows, panelId, panelList,
  petProfile: PetProgress.profile, petProgression: PetScoreProgression.get, assertStateCapacity, MAX_STATE_BYTES };
