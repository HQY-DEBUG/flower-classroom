/* The editable configuration projection. Classroom records and live tool sessions stay in state. */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./classroom-wheels.js') : root.ClassroomWheels,
    node ? require('./toolbox-extra.js') : root.ToolboxExtra,
    node ? require('./organization-tools.js') : root.OrganizationTools);
  if (node) module.exports = api; else root.ConfigurationModel = api;
})(globalThis, function (Wheels, Toolbox, Organization) {
  'use strict';
  const APP_DEFAULTS = Object.freeze({initialZoom: 1, windowWidth: 1280, windowHeight: 840, startMinimized: false});
  const TOOL_DEFAULTS = Object.freeze({timerDurationSeconds: 300, drawScope: 'students', drawMode: 'cycle', drawCount: 1,
    petDrawScope: 'students', petDrawMode: 'cycle', petDrawCount: 1, bombSeconds: 30});
  const APP_KEYS = Object.keys(APP_DEFAULTS), TOOL_KEYS = Object.keys(TOOL_DEFAULTS);
  const PANEL_KEYS = ['id', 'name', 'showAvatars', 'scoreStep', 'studentSort', 'hideLateForms', 'timerSound', 'toolDefaults', 'wheelPrizes', 'challengeOptions', 'links', 'subjects'];
  // These actions may change this projection or the workbook-owned rules/progression.
  // The adapter compares the resulting complete signature before staging a write.
  const actionTypes = Object.freeze(['settings', 'photos.visibility', 'score.step', 'students.sort', 'students.order',
    'timer.sound', 'timer.set', 'tools.defaults', 'draw.select', 'draw', 'pet.draw', 'pet.visibility',
    'wheel.prizes', 'wheel.challenges', 'toolbox.link.add', 'toolbox.link.update', 'toolbox.link.remove', 'toolbox.link.move',
    'toolbox.homework.subjects', 'rules.save', 'rules.share', 'pet.rules', 'pet.stage-rules', 'pet.growth-policy',
    'panel.create', 'panel.remove', 'points.clear']);
  const fail = message => { throw Error(message); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(label + '格式无效');
    return value;
  }
  function keys(value, allowed, label, complete = true) {
    record(value, label);
    if (Object.keys(value).some(key => !allowed.includes(key)) || (complete && allowed.some(key => !Object.hasOwn(value, key)))) fail(label + '字段不完整或含不支持的字段');
    return value;
  }
  function integer(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(label + '需为 ' + min + '–' + max + ' 的整数');
    return value;
  }
  function boolean(value, label) { if (typeof value !== 'boolean') fail(label + '需为布尔值'); return value; }
  function choice(value, allowed, label) { if (!allowed.includes(value)) fail(label + '无效'); return value; }
  function text(value, max, label) {
    if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(label + '需填写1–' + max + '字');
    return value.trim();
  }
  function id(value, label) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail(label + '无效'); return value; }
  function appConfig(value = APP_DEFAULTS) {
    keys(value, APP_KEYS, '启动显示设置');
    if (typeof value.initialZoom !== 'number' || !Number.isFinite(value.initialZoom) || value.initialZoom < 0.5 || value.initialZoom > 2) fail('初始界面缩放需在0.5–2之间');
    return {initialZoom: value.initialZoom, windowWidth: integer(value.windowWidth, 900, 3840, '主窗口初始宽度'),
      windowHeight: integer(value.windowHeight, 640, 2160, '主窗口初始高度'), startMinimized: boolean(value.startMinimized, '启动后最小化')};
  }
  function validateToolDefaults(value) {
    keys(value, TOOL_KEYS, '工具默认设置');
    return {timerDurationSeconds: integer(value.timerDurationSeconds, 1, 10800, '计时默认秒数'),
      drawScope: choice(value.drawScope, ['students', 'groups'], '点名默认对象'), drawMode: choice(value.drawMode, ['cycle', 'repeat'], '点名默认策略'),
      drawCount: integer(value.drawCount, 1, 20, '点名默认数量'),
      petDrawScope: choice(value.petDrawScope, ['students', 'groups'], '宠物默认对象'), petDrawMode: choice(value.petDrawMode, ['cycle', 'repeat'], '宠物默认策略'),
      petDrawCount: integer(value.petDrawCount, 1, 20, '宠物默认数量'), bombSeconds: integer(value.bombSeconds, 10, 180, '挑战默认秒数')};
  }
  function toolDefaults(state) {
    if (state?.settings?.toolDefaults !== undefined) return validateToolDefaults(state.settings.toolDefaults);
    // Migrate only choices that were actually saved by previous versions. Counts
    // and challenge duration were local UI values and cannot be inferred from results.
    const value = {...TOOL_DEFAULTS};
    const seconds = state?.timer?.durationMs / 1000;
    if (Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 10800) value.timerDurationSeconds = seconds;
    if (state?.draw) { value.drawScope = state.draw.scope || 'students'; value.drawMode = state.draw.mode; }
    if (state?.petDraw) { value.petDrawScope = state.petDraw.scope; value.petDrawMode = state.petDraw.mode; }
    return validateToolDefaults(value);
  }
  function setToolDefaults(state, patch, expected) {
    keys(patch, TOOL_KEYS, '工具默认设置', false);
    if (!Object.keys(patch).length) fail('请选择要修改的工具默认设置');
    const current = toolDefaults(state);
    if (expected !== undefined && !same(validateToolDefaults(expected), current)) fail('工具默认设置已在另一窗口修改，请重新打开');
    const next = validateToolDefaults({...current, ...patch});
    state.settings.toolDefaults = next; state.version = 2;
    return next;
  }
  function panels(state) {
    return [{id: state.panels?.activeId || 'panel_default', data: state}, ...(state.panels?.others || [])];
  }
  function validatePanel(value) {
    keys(value, PANEL_KEYS, '面板配置');
    if (!Array.isArray(value.wheelPrizes)) fail('奖品格式无效');
    value.wheelPrizes.forEach(item => keys(item, ['id', 'name', 'cost'], '奖品'));
    if (!Array.isArray(value.links)) fail('网址格式无效');
    value.links.forEach(item => keys(item, ['id', 'title', 'url'], '网址'));
    const extra = Toolbox.empty(); extra.links = value.links; extra.homework.subjects = value.subjects;
    const checkedExtra = Toolbox.validate(extra, []);
    return {id: id(value.id, '面板编号'), name: text(value.name, 80, '面板名称'),
      showAvatars: boolean(value.showAvatars, '显示头像'), scoreStep: integer(value.scoreStep, 1, 100, '快捷分值'),
      studentSort: choice(value.studentSort, Object.keys(Organization.sorts), '成员排序'), hideLateForms: boolean(value.hideLateForms, '隐藏后两级'),
      timerSound: choice(value.timerSound, ['tick', 'applause', 'laser'], '计时响铃'), toolDefaults: validateToolDefaults(value.toolDefaults),
      wheelPrizes: Wheels.prizes(value.wheelPrizes), challengeOptions: Wheels.options(value.challengeOptions),
      links: checkedExtra.links, subjects: checkedExtra.homework.subjects};
  }
  function validate(value) {
    keys(value, ['appConfig', 'panels'], '统一配置');
    record(value.appConfig, '启动显示设置');
    if (!Array.isArray(value.panels) || !value.panels.length || value.panels.length > 20) fail('面板配置需包含1–20个面板');
    // Panel identity, rather than the currently open panel or worksheet row,
    // determines its position in a configuration signature. Ordered lists
    // inside each panel keep their original order.
    const result = {appConfig: appConfig(value.appConfig), panels: value.panels.map(validatePanel).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)};
    if (new Set(result.panels.map(panel => panel.id)).size !== result.panels.length) fail('面板配置编号不能重复');
    return result;
  }
  function snapshot(state) {
    return validate({appConfig: appConfig(state.appConfig), panels: panels(state).map(({id, data}) => {
      const settings = data.settings, extra = Toolbox.snapshot(data);
      return {id, name: settings.className, showAvatars: settings.showAvatars ?? true, scoreStep: settings.scoreStep ?? 1,
        studentSort: settings.studentSort ?? 'natural', hideLateForms: settings.hideLateForms ?? false, timerSound: settings.timerSound ?? 'tick',
        toolDefaults: toolDefaults(data), wheelPrizes: Wheels.list(data), challengeOptions: Wheels.challengeList(data),
        links: extra.links, subjects: extra.homework.subjects};
    })});
  }
  function apply(state, value) {
    const configuration = validate(value), targets = panels(state), byId = new Map(targets.map(panel => [panel.id, panel.data]));
    if (targets.length !== configuration.panels.length || byId.size !== targets.length || configuration.panels.some(panel => !byId.has(panel.id))) fail('面板集合已变化，请重新读取配置');
    // Stage every panel first: a conflict in the last panel must not partially
    // apply settings, startup choices, or another panel's links.
    const staged = configuration.panels.map(panel => {
      const data = byId.get(panel.id), previous = Toolbox.snapshot(data);
      if (previous.homework.tasks.some(task => !panel.subjects.includes(task.subject))) fail('请保留进行中任务使用的科目');
      const changed = !same(previous.links, panel.links) || !same(previous.homework.subjects, panel.subjects);
      let extra;
      if (changed) {
        const source = data.toolboxExtra || previous;
        extra = {...source, revision: integer(source.revision + 1, 0, Number.MAX_SAFE_INTEGER - 1, '百宝箱版本'),
          links: panel.links, homework: {...source.homework, subjects: panel.subjects}};
      }
      const settings = {...data.settings, className: panel.name, showAvatars: panel.showAvatars, scoreStep: panel.scoreStep,
        studentSort: panel.studentSort, hideLateForms: panel.hideLateForms, timerSound: panel.timerSound,
        toolDefaults: panel.toolDefaults, wheelPrizes: panel.wheelPrizes, challengeOptions: panel.challengeOptions};
      return {data, settings, extra};
    });
    for (const patch of staged) {
      patch.data.settings = patch.settings; patch.data.version = 2;
      if (patch.extra) patch.data.toolboxExtra = patch.extra;
    }
    state.appConfig = configuration.appConfig; state.version = 2;
    return state;
  }
  return Object.freeze({APP_DEFAULTS, TOOL_DEFAULTS, actionTypes, appConfig, validateToolDefaults, toolDefaults, setToolDefaults, validate, snapshot, apply});
});
