'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../src/core.cjs');
const Config = require('../src/configuration-model.js');
const Toolbox = require('../src/toolbox-extra.js');
const Rules = require('../src/score-rules.js');
const Wheels = require('../src/classroom-wheels.js');
const Organization = require('../src/organization-tools.js');
const Workbook = require('../src/score-rule-workbook.cjs');
const NOW = 18000000;
const clone = value => JSON.parse(JSON.stringify(value));
const act = (state, action) => Core.applyAction(state, action, NOW);
const configured = () => Config.apply(Core.createInitialState(), Config.snapshot(Core.createInitialState()));
function rejectsUnchanged(state, config, pattern) {
  const before = clone(state); assert.throws(() => Config.apply(state, config), pattern); assert.deepEqual(state, before);
}
function extraAction(state, action) { return act(state, {...Toolbox.expectation(state), ...action}); }

test('RC18 config: legacy projection is inert, supplies effective defaults, and excludes classroom records and includes one global progression', () => {
  const state = Core.createInitialState(), before = clone(state), snapshot = Config.snapshot(state);
  assert.deepEqual(state, before); assert.deepEqual(Core.validateState(state), before);
  assert.equal(state.appConfig, undefined); assert.equal(state.settings.toolDefaults, undefined);
  assert.deepEqual(snapshot.appConfig, Config.APP_DEFAULTS);
  assert.deepEqual(snapshot.panels[0].toolDefaults, Config.TOOL_DEFAULTS);
  assert.deepEqual(Object.keys(snapshot), ['appConfig', 'petProgression', 'panels']);
  assert.deepEqual(Object.keys(snapshot.panels[0]), ['id', 'name', 'showAvatars', 'scoreStep', 'studentSort', 'hideLateForms', 'timerSound', 'toolDefaults', 'wheelPrizes', 'challengeOptions', 'links', 'subjects']);
  assert.equal(snapshot.panels[0].showAvatars, true); assert.equal(snapshot.panels[0].hideLateForms, false);
  assert.deepEqual(snapshot.panels[0].links, []); assert.deepEqual(snapshot.panels[0].subjects, ['语文', '数学', '英语']);
  assert.equal(JSON.stringify(snapshot).includes(state.students[0].id), false);
  snapshot.panels[0].wheelPrizes[0].name = '修改副本'; assert.equal(Wheels.list(state)[0].name, Wheels.defaults[0].name);
});

test('RC18 config: previous saved timer and draw selections migrate, count and challenge defaults never infer from results', () => {
  let state = act(Core.createInitialState(), {type: 'timer.set', seconds: 407});
  state = act(state, {type: 'draw', scope: 'groups', mode: 'repeat', count: 3});
  state = act(state, {type: 'pet.draw', scope: 'groups', mode: 'repeat', count: 2});
  delete state.settings.toolDefaults;
  const before = clone(state), defaults = Config.toolDefaults(state);
  assert.deepEqual(defaults, {...Config.TOOL_DEFAULTS, timerDurationSeconds: 407, drawScope: 'groups', drawMode: 'repeat', petDrawScope: 'groups', petDrawMode: 'repeat'});
  assert.deepEqual(state, before); assert.equal(Core.validateState(state).settings.toolDefaults, undefined);
  state.timer.durationMs = 407001; assert.equal(Config.toolDefaults(state).timerDurationSeconds, 300);
});

for (const [field, min, max] of [['initialZoom', 0.5, 2], ['windowWidth', 900, 3840], ['windowHeight', 640, 2160]]) {
  test(`RC18 config: ${field} boundaries are exact`, () => {
    for (const value of [min, max]) { const config = Config.snapshot(Core.createInitialState()); config.appConfig[field] = value; assert.equal(Config.validate(config).appConfig[field], value); }
    for (const value of [min - 1, max + 1, null, `${min}`, NaN, Infinity, ...(field === 'initialZoom' ? [] : [min + 0.5])]) {
      const state = Core.createInitialState(), config = Config.snapshot(state); config.appConfig[field] = value; rejectsUnchanged(state, config);
    }
  });
}
for (const [field, min, max] of [['timerDurationSeconds', 1, 10800], ['drawCount', 1, 20], ['petDrawCount', 1, 20], ['bombSeconds', 10, 180]]) {
  test(`RC18 config: ${field} limits apply to snapshot, state, and actions`, () => {
    for (const value of [min, max]) {
      const state = act(Core.createInitialState(), {type: 'tools.defaults', toolDefaults: {[field]: value}});
      assert.equal(Config.snapshot(Core.validateState(state)).panels[0].toolDefaults[field], value);
    }
    for (const value of [min - 1, max + 1, min + 0.5, null, `${min}`, NaN, Infinity]) {
      const state = configured(), config = Config.snapshot(state); config.panels[0].toolDefaults[field] = value;
      rejectsUnchanged(state, config);
      const invalid = clone(state); invalid.settings.toolDefaults[field] = value; assert.throws(() => Core.validateState(invalid));
      assert.throws(() => act(state, {type: 'tools.defaults', toolDefaults: {[field]: value}}));
    }
  });
}

test('RC18 config: booleans, choice fields and score steps use exact values without coercion', () => {
  const state = Core.createInitialState();
  for (const field of ['showAvatars', 'hideLateForms']) {
    for (const value of [true, false]) { const config = Config.snapshot(state); config.panels[0][field] = value; assert.equal(Config.validate(config).panels[0][field], value); }
    for (const value of ['true', 'false', 1, 0, null]) { const config = Config.snapshot(state); config.panels[0][field] = value; rejectsUnchanged(state, config); }
  }
  for (const value of ['true', 1, 0, null]) { const config = Config.snapshot(state); config.appConfig.startMinimized = value; rejectsUnchanged(state, config); }
  for (const [field, choices] of [['timerSound', ['tick', 'applause', 'laser']], ['studentSort', Object.keys(Organization.sorts)]]) {
    for (const value of choices) { const config = Config.snapshot(state); config.panels[0][field] = value; assert.equal(Config.validate(config).panels[0][field], value); }
    const config = Config.snapshot(state); config.panels[0][field] = 'unknown'; rejectsUnchanged(state, config);
  }
  for (const [field, choices] of [['drawScope', ['students', 'groups']], ['petDrawScope', ['students', 'groups']], ['drawMode', ['cycle', 'repeat']], ['petDrawMode', ['cycle', 'repeat']]]) {
    for (const value of choices) assert.equal(Config.validateToolDefaults({...Config.TOOL_DEFAULTS, [field]: value})[field], value);
    for (const value of ['unknown', null, 1]) assert.throws(() => Config.validateToolDefaults({...Config.TOOL_DEFAULTS, [field]: value}));
  }
  for (const value of [1, 100]) { const config = Config.snapshot(state); config.panels[0].scoreStep = value; assert.equal(Config.validate(config).panels[0].scoreStep, value); }
  for (const value of [0, 101, 1.5, '1']) { const config = Config.snapshot(state); config.panels[0].scoreStep = value; rejectsUnchanged(state, config); }
});

test('RC18 config: text and collections retain source bounds, order and URL safety', () => {
  const state = Core.createInitialState();
  const config = Config.snapshot(state), panel = config.panels[0];
  panel.name = '  ' + '班'.repeat(80) + '  '; panel.wheelPrizes = Array.from({length: 24}, (_, i) => ({id: 'p_' + i, name: '奖'.repeat(60), cost: i ? 1 : 1000000}));
  panel.challengeOptions = Array(24).fill('问'.repeat(80));
  panel.links = Array.from({length: 60}, (_, i) => ({id: 'l_' + i, title: '网'.repeat(60), url: 'https://example.com/' + i}));
  panel.subjects = Array.from({length: 20}, (_, i) => String(i) + '科'.repeat(38));
  const valid = Config.validate(config); assert.equal(valid.panels[0].name, '班'.repeat(80)); assert.deepEqual(valid.panels[0].links, panel.links);
  const cases = [p => {p.name = '班'.repeat(81);}, p => {p.name = '\n';}, p => {p.name = 'a\u0000';},
    p => {p.wheelPrizes = [];}, p => {p.wheelPrizes.push({...p.wheelPrizes[0], id: 'extra'});}, p => {p.wheelPrizes[1].id = p.wheelPrizes[0].id;},
    p => {p.wheelPrizes[0].cost = 0;}, p => {p.wheelPrizes[0].cost = 1000001;}, p => {p.wheelPrizes[0].cost = 1.5;}, p => {p.wheelPrizes[0].name += '超';},
    p => {p.challengeOptions = [];}, p => {p.challengeOptions.push('多');}, p => {p.challengeOptions[0] += '多';},
    p => {p.links.push({id: 'extra', title: '多', url: 'https://example.com'});}, p => {p.links[1].id = p.links[0].id;}, p => {p.links[0].title += '多';},
    p => {p.subjects = [];}, p => {p.subjects.push('额外');}, p => {p.subjects[1] = p.subjects[0];}, p => {p.subjects[0] = '科'.repeat(41);}];
  for (const edit of cases) { const bad = clone(config); edit(bad.panels[0]); rejectsUnchanged(state, bad); }
  for (const url of ['javascript:alert(1)', 'file:///tmp/file', 'https://user:password@example.com', 'https://example.com/a b', 'https://example.com/\\abc', 'https://example.com/' + 'a'.repeat(2048)]) {
    const bad = clone(config); bad.panels[0].links[0].url = url; rejectsUnchanged(state, bad);
  }
  const empty = clone(config); empty.panels[0].links = []; assert.deepEqual(Config.validate(empty).panels[0].links, []);
  const reversed = clone(config); reversed.panels[0].links.reverse(); assert.notDeepEqual(Config.validate(reversed).panels[0].links, panel.links);
});

test('RC18 config: complete schema rejects unknown state/ledger keys, missing fields, forged identities and unsupported versions', () => {
  const state = Core.createInitialState(), valid = Config.snapshot(state);
  const badConfigs = [c => {delete c.appConfig;}, c => {c.appConfig = undefined;}, c => {c.appConfig.apiKey = 'not-a-real-key';}, c => {c.students = [];},
    c => {c.panels = [];}, c => {c.panels.push(clone(c.panels[0]));}, c => {c.panels[0].id = 'missing';},
    c => {delete c.panels[0].links;}, c => {c.panels[0].petRules = {thresholds: [1, 1, 1, 1, 1, 1]};}, c => {c.panels[0].growthFloor = 'clamp';},
    c => {c.panels[0].toolDefaults.running = true;}, c => {delete c.panels[0].toolDefaults.drawMode;}, c => {c.panels[0].wheelPrizes[0].students = [];},
    c => {c.panels[0].links = [{id: 'x', title: 'x', url: 'https://example.com', password: 'fake'}];}];
  for (const edit of badConfigs) { const config = clone(valid); edit(config); rejectsUnchanged(state, config); }
  const config = configured(); config.version = 1; assert.throws(() => Core.validateState(config), /新版存档/);
  const old = Core.createInitialState(); old.version = 1; old.settings.toolDefaults = {...Config.TOOL_DEFAULTS}; assert.throws(() => Core.validateState(old), /新版存档/);
  for (const extra of [{}, {initialZoom: 1}, {...Config.APP_DEFAULTS, windowWidth: '1280'}, {...Config.APP_DEFAULTS, extra: true}]) {
    const bad = configured(); bad.appConfig = extra; assert.throws(() => Core.validateState(bad));
  }
});

test('RC18 config: external refresh preserves running timer, draw pools/results/identity, every record and existing shared catalog', () => {
  let state = act(Core.createInitialState(), {type: 'rules.save', rules: Rules.list()});
  state = act(state, {type: 'score', ids: [state.students[0].id], delta: 3});
  state = act(state, {type: 'score', ids: [state.students[1].id], delta: 2});
  state = act(state, {type: 'draw', scope: 'groups', mode: 'cycle', count: 2});
  state = act(state, {type: 'pet.draw', scope: 'students', mode: 'cycle', count: 3});
  state = act(state, {type: 'timer.set', seconds: 480}); state = act(state, {type: 'timer.start'});
  state = extraAction(state, {type: 'toolbox.homework.add', id: 'synthetic_hw', title: '合成作业', subject: '数学', date: '2026-10-07'});
  state = extraAction(state, {type: 'toolbox.homework.archive', id: 'synthetic_hw', confirmed: true, historyId: 'history_1'});
  const before = clone(state), config = Config.snapshot(state); config.appConfig.windowWidth = 1400;
  Object.assign(config.panels[0], {name: '修改班名', scoreStep: 9, timerSound: 'laser', showAvatars: false, hideLateForms: true, studentSort: 'custom', links: [{id: 'new_link', title: '示例', url: 'https://example.com/'}]});
  config.panels[0].toolDefaults = {...Config.TOOL_DEFAULTS, timerDurationSeconds: 99, drawMode: 'repeat', petDrawScope: 'groups', bombSeconds: 60};
  const next = Config.apply(clone(state), config);
  for (const field of ['students', 'logs', 'petAccounts', 'petLogs', 'draw', 'drawSessions', 'petDraw', 'timer', 'sharedScoreRules']) assert.deepEqual(next[field], before[field], field);
  assert.deepEqual(next.toolboxExtra.homework.tasks, before.toolboxExtra.homework.tasks); assert.deepEqual(next.toolboxExtra.homework.history, before.toolboxExtra.homework.history);
  assert.deepEqual(next.settings.petRules, before.settings.petRules); assert.equal(next.revision, before.revision);
  assert.equal(next.toolboxExtra.revision, before.toolboxExtra.revision + 1); assert.deepEqual(Core.validateState(next), next);
  assert.deepEqual(state, before); assert.deepEqual(Config.snapshot(next), Config.validate(config));
  const reset = act(next, {type: 'timer.reset'}); assert.deepEqual(reset.timer, {durationMs: 99000, remainingMs: 99000, endsAt: null, running: false});
});

test('RC18 config: workbook configuration cannot enable a legacy pet ledger', () => {
  const state = Core.createInitialState(), next = Config.apply(clone(state), Config.snapshot(state));
  assert.equal(next.settings.petRules, undefined); assert.equal(next.petAccounts, undefined); assert.equal(next.settings.petStep, state.settings.petStep);
  assert.deepEqual(next.students, state.students); assert.deepEqual(Core.validateState(next), next);
});

test('RC18 config: all-panel staging checks active subjects and revision overflow before any mutation', () => {
  let state = act(Core.createInitialState(), {type: 'panel.create', mode: 'blank', name: '第二班'});
  state = extraAction(state, {type: 'toolbox.homework.add', id: 'hw', title: '未完成', subject: '数学', date: '2026-10-07'});
  const current = Core.panelId(state); state = act(state, {type: 'panel.switch', id: state.panels.others[0].id});
  const config = Config.snapshot(state); config.panels[0].name = '不应写入'; config.appConfig.initialZoom = 1.2;
  config.panels.find(p => p.id === current).subjects = ['语文']; rejectsUnchanged(state, config, /进行中任务/);
  const overflow = clone(state); overflow.panels.others[0].data.toolboxExtra.revision = Number.MAX_SAFE_INTEGER - 1;
  const changed = Config.snapshot(overflow); changed.panels[0].name = '不应写入'; changed.panels.find(p => p.id === current).subjects.push('自然'); rejectsUnchanged(overflow, changed, /百宝箱版本/);
});

test('RC18 config: toolbox revision changes only for real link/subject changes, explicit empty links work', () => {
  let state = Core.createInitialState(); const noExtra = Config.apply(clone(state), Config.snapshot(state)); assert.equal(noExtra.toolboxExtra, undefined);
  state = extraAction(state, {type: 'toolbox.link.add', id: 'link', title: '示例', url: 'https://example.com/'});
  const same = Config.snapshot(state); same.panels[0].name = '合成新班名';
  const next = Config.apply(clone(state), same); assert.deepEqual(next.toolboxExtra, state.toolboxExtra);
  const clear = Config.snapshot(next); clear.panels[0].links = [];
  const cleared = Config.apply(clone(next), clear); assert.deepEqual(cleared.toolboxExtra.links, []); assert.equal(cleared.toolboxExtra.revision, state.toolboxExtra.revision + 1);
  assert.equal(Config.apply(clone(cleared), clear).toolboxExtra.revision, cleared.toolboxExtra.revision);
  assert.throws(() => extraAction(cleared, {...Toolbox.expectation(state), type: 'toolbox.link.add', id: 'stale', title: '旧窗口', url: 'https://example.com/'}), /另一窗口/);
});

test('RC18 config: tool actions persist chosen defaults while standalone default changes preserve operational sessions', () => {
  let state = act(Core.createInitialState(), {type: 'timer.set', seconds: 71});
  assert.equal(Config.toolDefaults(state).timerDurationSeconds, 71);
  state = act(state, {type: 'draw.select', scope: 'groups', mode: 'repeat'});
  assert.equal(Config.toolDefaults(state).drawScope, 'groups'); assert.equal(Config.toolDefaults(state).drawMode, 'repeat');
  state = act(state, {type: 'draw', scope: 'students', mode: 'cycle', count: 4}); assert.equal(Config.toolDefaults(state).drawCount, 4);
  state = act(state, {type: 'pet.draw', scope: 'groups', mode: 'repeat', count: 2}); assert.equal(Config.toolDefaults(state).petDrawCount, 2);
  state = act(state, {type: 'timer.start'});
  const before = clone(state), expected = Config.toolDefaults(state);
  state = act(state, {type: 'tools.defaults', toolDefaults: {drawCount: 20, timerDurationSeconds: 11, bombSeconds: 180}, expectedToolDefaults: expected});
  for (const field of ['timer', 'draw', 'drawSessions', 'petDraw', 'students', 'logs', 'petAccounts', 'petLogs']) assert.deepEqual(state[field], before[field], field);
  assert.throws(() => act(state, {type: 'tools.defaults', toolDefaults: {bombSeconds: 60}, expectedToolDefaults: expected}), /另一窗口/);
  assert.throws(() => act(state, {type: 'tools.defaults', toolDefaults: {}}), /请选择/);
  assert.throws(() => act(state, {type: 'tools.defaults', toolDefaults: {running: false}}), /字段/);
});

test('RC18 config: root startup configuration survives panel lifecycle, roster import, and backup validation without nested copies', () => {
  const source = configured(); source.appConfig = {initialZoom: 1.25, windowWidth: 1600, windowHeight: 900, startMinimized: true};
  const originalId = Core.panelId(source);
  for (const mode of ['blank', 'copy', 'full']) {
    let next = act(source, {type: 'panel.create', mode, name: '合成新班'});
    assert.deepEqual(next.appConfig, source.appConfig); assert.equal(next.panels.others[0].data.appConfig, undefined);
    if (mode === 'full') assert.deepEqual(next.settings.toolDefaults, source.settings.toolDefaults);
    const beforeSwitch = Config.snapshot(next), beforeSignature = Workbook.signature(next);
    next = act(next, {type: 'panel.switch', id: originalId}); assert.deepEqual(next.appConfig, source.appConfig);
    assert.deepEqual(Config.snapshot(next), beforeSwitch);
    assert.equal(Workbook.signature(next), beforeSignature);
    assert.ok(next.panels.others.every(panel => panel.data.appConfig === undefined));
    next = Core.importRows([{name: '合成新成员', group: '测试组'}], next, 'replace'); assert.deepEqual(next.appConfig, source.appConfig);
    next = act(next, {type: 'panel.clear'}); assert.deepEqual(next.appConfig, source.appConfig);
    assert.deepEqual(Core.validateState(clone(next)), next);
    const forged = clone(next); forged.panels.others[0].data.appConfig = source.appConfig; assert.throws(() => Core.validateState(forged), /完整存档根部/);
    next = act(next, {type: 'panel.remove'}); assert.deepEqual(next.appConfig, source.appConfig);
  }
  const unchanged = Core.createInitialState(); assert.equal(act(unchanged, {type: 'panel.create', mode: 'blank', name: '旧格式'}).appConfig, undefined);
});

test('RC18 config: browser and Node project identical configuration and expose enumerable adapter action coverage', () => {
  const root = {URL};
  for (const module of ['pet-score-progression.js', 'pet-progress.js', 'organization-tools.js', 'classroom-wheels.js', 'toolbox-extra.js', 'configuration-model.js']) vm.runInNewContext(fs.readFileSync(require.resolve('../src/' + module), 'utf8'), root);
  const stateJson = JSON.stringify(Core.createInitialState());
  const browserSnapshot = vm.runInNewContext('ConfigurationModel.snapshot(JSON.parse(' + JSON.stringify(stateJson) + '))', root);
  assert.deepEqual(clone(browserSnapshot), Config.snapshot(JSON.parse(stateJson)));
  assert.deepEqual(Object.keys(root.ConfigurationModel), Object.keys(Config));
  for (const type of ['settings', 'photos.visibility', 'score.step', 'students.sort', 'students.order', 'pet.visibility', 'timer.sound', 'timer.set', 'tools.defaults', 'draw', 'draw.select', 'pet.draw', 'wheel.prizes', 'wheel.challenges', 'toolbox.link.add', 'toolbox.link.update', 'toolbox.link.move', 'toolbox.link.remove', 'toolbox.homework.subjects', 'pet.growth-policy', 'panel.create', 'panel.remove', 'rules.save', 'rules.share']) assert.ok(Config.actionTypes.includes(type), type);
  assert.equal(new Set(Config.actionTypes).size, Config.actionTypes.length);
});
