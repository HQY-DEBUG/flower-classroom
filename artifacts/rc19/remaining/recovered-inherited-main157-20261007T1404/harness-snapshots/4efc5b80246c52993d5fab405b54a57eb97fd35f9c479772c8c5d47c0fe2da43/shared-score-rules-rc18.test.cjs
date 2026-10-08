'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../src/core.cjs');
const Rules = require('../src/score-rules.js');
const clone = value => JSON.parse(JSON.stringify(value));
const act = (state, action) => Core.applyAction(state, action, 18_000_000);
const save = (state, rules) => act(state, {type: 'rules.save', rules, expectedRules: Rules.list(state), expectedKey: Rules.key(state), sharedRevision: state.sharedScoreRules?.revision});
const share = state => act(state, {type: 'rules.share', confirmed: true, expectedKey: Rules.previewShared(state).expectedKey});
const values = state => { const next = clone(state); delete next.settings.scoreRules; delete next.sharedScoreRules; delete next.panels; delete next.petProgression; delete next.version; delete next.revision; return next; };
function legacyPanels(collections) {
  const panels = collections.map((rules, i) => {
    const data = Core.createInitialState(); data.students = []; data.settings.className = `合成旧面板${i}`;
    if (i > 0) delete data.petProgression;
    if (rules !== undefined) data.settings.scoreRules = clone(rules);
    if (rules?.some(rule => Object.hasOwn(rule, 'growthDelta'))) data.version = 2;
    return {id: `panel_${i}`, data};
  });
  const result = panels[0].data;
  result.version = panels.some(panel => panel.data.version === 2) ? 2 : result.version;
  result.panels = {activeId: panels[0].id, others: panels.slice(1)};
  return Core.validateState(result);
}
const rule = (id, delta, growthDelta) => ({id, label: `合成卡片${id}`, delta, ...(growthDelta === undefined ? {} : {growthDelta})});
function rejects(state, action, pattern) {
  const before = clone(state); assert.throws(() => act(state, action), pattern); assert.deepEqual(state, before);
}

test('RC18 shared rules: read/restore of differing legacy panels remains inert; save/create require explicit merge', () => {
  const state = legacyPanels([[rule('same', 2)], [rule('same', 7, 0)]]), before = clone(state);
  assert.deepEqual(Core.validateState(clone(state)), before);
  const preview = Rules.previewShared(state);
  assert.equal(preview.required, true); assert.equal(preview.shared, false); assert.equal(preview.rules.length, 2);
  assert.deepEqual(state, before);
  rejects(state, {type: 'rules.save', rules: Rules.list(state)}, /预览.*确认/);
  for (const mode of ['blank', 'copy', 'full']) rejects(state, {type: 'panel.create', mode, name: '合成新面板'}, /预览.*确认/);
  rejects(state, {type: 'rules.share', expectedKey: preview.expectedKey}, /明确确认/);
  rejects(state, {type: 'rules.share', confirmed: true, expectedKey: 'stale'}, /另一窗口|重新预览/);
  const switched = act(state, {type: 'panel.switch', id: 'panel_1'});
  assert.equal(switched.sharedScoreRules, undefined);
  assert.deepEqual(Rules.list(switched), state.panels.others[0].data.settings.scoreRules);
  assert.equal(Rules.previewShared(switched).expectedKey, preview.expectedKey);
});

test('RC18 shared rules: union retains same-ID conflicts, same-name values, zero versus omitted growth and original snapshots', () => {
  const state = legacyPanels([
    [{id: 'collision', label: '合成同名', delta: 2}, rule('shared_0001', 3), rule('unique_a', -1)],
    [{id: 'collision', label: '合成同名', delta: 2, growthDelta: 0}, {id: 'other_id', label: '合成同名', delta: 7}, rule('unique_b', 9)],
    [{id: 'collision', label: '合成同名', delta: 2, growthDelta: 0}]
  ]);
  const preview = Rules.previewShared(state), again = Rules.previewShared(clone(state));
  assert.deepEqual(preview, again); assert.equal(preview.rules.length, 6);
  assert.equal(new Set(preview.rules.map(item => item.id)).size, 6);
  assert.equal(preview.mappings.find(item => item.panelId === 'panel_1' && item.ruleId === 'collision').sharedRuleId, 'shared_0002');
  assert.equal(preview.mappings.find(item => item.panelId === 'panel_2').sharedRuleId, 'shared_0002');
  assert.ok(preview.conflicts.some(item => item.kind === 'id' && item.id === 'collision'));
  assert.ok(preview.conflicts.some(item => item.kind === 'label' && item.label === '合成同名'));
  assert.ok(preview.conflicts.every(item => item.variants.every(variant => variant.sources.every(source => source.panelName.startsWith('合成旧面板')))));
  const next = share(state);
  assert.deepEqual(next.sharedScoreRules.migration, {panels: preview.panels, mappings: preview.mappings});
  assert.deepEqual(Rules.list(next), preview.rules);
  for (const panel of next.panels.others) assert.deepEqual(panel.data.settings.scoreRules, preview.rules);
  assert.deepEqual(values(next), values(state));
  assert.deepEqual(Core.validateState(clone(next)), next);
  const changed = clone(next); changed.sharedScoreRules.migration.mappings[0].sharedRuleId = 'wrong';
  assert.throws(() => Core.validateState(changed), /映射/);
});

test('RC18 shared rules: equal legacy collections promote losslessly and preserve implicit defaults and rule order', () => {
  const state = legacyPanels([undefined, Rules.list()]);
  assert.equal(Rules.previewShared(state).required, false);
  const next = save(state, Rules.list(state));
  assert.equal(next.sharedScoreRules.migration.panels[0].explicit, false);
  assert.equal(next.sharedScoreRules.migration.panels[1].explicit, true);
  assert.deepEqual(Rules.list(next), Rules.list(state));
  const reversed = legacyPanels([[rule('a', 1), rule('b', 2)], [rule('b', 2), rule('a', 1)]]);
  assert.equal(Rules.previewShared(reversed).required, true);
});

test('RC18 shared rules: all 2000 legacy variants survive merge, nested validation, editing, switching and JSON backup', () => {
  const collections = Array.from({length: 20}, (_, panel) => Array.from({length: 100}, (_, index) => rule(`rule_${index}`, panel + 1)));
  const state = legacyPanels(collections), preview = Rules.previewShared(state);
  assert.equal(preview.rules.length, 2000); assert.equal(preview.mappings.length, 2000);
  let next = share(state); assert.equal(Rules.list(next).length, 2000);
  assert.ok(next.panels.others.every(panel => panel.data.settings.scoreRules.length === 2000));
  const changed = Rules.list(next); changed[1999].label = '合成第2000张修改'; next = save(next, changed);
  next = act(next, {type: 'panel.switch', id: 'panel_19'});
  assert.equal(Rules.list(next)[1999].label, '合成第2000张修改');
  assert.deepEqual(Core.validateState(clone(next)), next);
  const noRoot = clone(next); delete noRoot.sharedScoreRules;
  assert.throws(() => Core.validateState(noRoot), /1–100/);
  assert.throws(() => Rules.validateSharedRules([...changed, rule('one_too_many', 1)]), /1–2000/);
  assert.throws(() => Rules.validateRules(changed.slice(0, 101)), /1–100/);
});

test('RC18 shared rules: create blank/roster/full, switch, remove and clear keep one shared identity and independent score histories', () => {
  let state = Core.createInitialState();
  state = save(state, [rule('persistent_card', 3, 2)]);
  const id = state.students[0].id;
  state = act(state, {type: 'score', ids: [id], delta: 3, reason: '合成卡片persistent_card', expectedRule: Rules.list(state)[0]});
  const history = clone(state.logs), originalId = Core.panelId(state), migration = clone(state.sharedScoreRules.migration);
  for (const mode of ['blank', 'copy', 'full']) {
    let next = act(state, {type: 'panel.create', mode, name: `合成${mode}`});
    assert.deepEqual(next.sharedScoreRules, state.sharedScoreRules);
    assert.deepEqual(next.petProgression,state.petProgression);
    assert.equal(Rules.list(next)[0].id, 'persistent_card');
    assert.equal(next.panels.others[0].data.sharedScoreRules, undefined);
    assert.deepEqual(next.panels.others[0].data.logs, history);
    assert.deepEqual(values(next.panels.others[0].data), values(state));
    if (mode === 'full') { assert.notEqual(next.logs[0].id, history[0].id); assert.equal(next.logs[0].delta, 3); assert.equal(next.logs[0].growthDelta, 0); }
    else assert.deepEqual(next.logs, []);
    next = save(next, [{...Rules.list(next)[0], label: '合成全局修改', delta: 8, growthDelta: 0}]);
    next = act(next, {type: 'panel.switch', id: originalId});
    assert.equal(Rules.list(next)[0].delta, 8); assert.deepEqual(next.logs, history);
    next = act(next, {type: 'undo', logId: history[0].id});
    assert.equal(next.students[0].score, 0); assert.equal(next.students[0].growth, 0);
    next = act(next, {type: 'panel.remove', expectedRevision: next.revision});
    assert.equal(Rules.list(next)[0].delta, 8); assert.deepEqual(next.sharedScoreRules.migration, migration);
    const cleared = act(next, {type: 'panel.clear', expectedRevision: next.revision});
    assert.deepEqual(cleared.sharedScoreRules, next.sharedScoreRules);
    assert.deepEqual(Core.validateState(clone(cleared)), cleared);
  }
});

test('RC18 shared rules: root/mirror divergence, nested shared metadata and version downgrade reject without rewriting', () => {
  const state = act(save(Core.createInitialState(), [rule('shared_card', 2)]), {type: 'panel.create', mode: 'blank', name: '合成第二面板'});
  for (const mutate of [
    s => { s.settings.scoreRules[0].delta = 3; },
    s => { s.panels.others[0].data.settings.scoreRules[0].label = '合成外来覆盖'; },
    s => { delete s.settings.scoreRules; },
    s => { s.panels.others[0].data.sharedScoreRules = clone(s.sharedScoreRules); },
    s => { s.version = 1; },
    s => { s.panels.others[0].data.version = 1; },
    s => { s.sharedScoreRules.version = 99; }
  ]) {
    const invalid = clone(state); mutate(invalid); const before = clone(invalid);
    assert.throws(() => Core.validateState(invalid)); assert.deepEqual(invalid, before);
  }
});

test('RC18 shared rules: cross-panel editor and selected-card snapshots reject stale values, ABA and wrong revisions', () => {
  let state = save(Core.createInitialState(), [rule('shared_card', 2)]);
  const firstId = Core.panelId(state), selected = Rules.list(state)[0], oldKey = Rules.key(state), oldRevision = state.sharedScoreRules.revision;
  const command = {type: 'score', ids: [state.students[0].id], delta: 2, reason: selected.label, expectedRule: selected, panelId: firstId};
  state = act(state, {type: 'panel.create', mode: 'full', name: '合成第二面板'});
  state = save(state, [{...selected, delta: 7}]);
  state = act(state, {type: 'panel.switch', id: firstId});
  rejects(state, command, /另一窗口/);
  rejects(state, {type: 'rules.save', rules: [selected], expectedRules: [selected]}, /另一窗口/);
  state = save(state, [selected]);
  assert.deepEqual(Rules.list(state), [selected]);
  rejects(state, {type: 'rules.save', rules: [selected], expectedRules: [selected], expectedKey: oldKey}, /另一窗口/);
  rejects(state, {type: 'rules.save', rules: [selected], sharedRevision: oldRevision}, /另一窗口/);
  rejects(state, {...command, expectedRulesKey: oldKey}, /另一窗口/);
  const fresh = act(state, {...command, expectedKey: Rules.key(state)});
  assert.equal(fresh.students[0].score, 2);
});

test('RC18 shared rules: merge preview expires on rename/rule/panel collection changes and preserves originals after later imports', () => {
  const state = legacyPanels([[rule('a', 1)], [rule('a', 2)]]), expectedKey = Rules.previewShared(state).expectedKey;
  const renamed = act(state, {type: 'settings', className: '合成改名'});
  rejects(renamed, {type: 'rules.share', confirmed: true, expectedKey}, /另一窗口/);
  const removed = act(state, {type: 'panel.remove'});
  rejects(removed, {type: 'rules.share', confirmed: true, expectedKey}, /另一窗口/);
  const shared = share(state), firstMigration = clone(shared.sharedScoreRules.migration);
  const incoming = Rules.previewShared(legacyPanels([[rule('old_external', -3)], [rule('old_external', 7, 0)]]));
  const next = clone(shared); Rules.setShared(next, incoming.rules, {migration: {panels: incoming.panels, mappings: incoming.mappings}});
  assert.deepEqual(next.sharedScoreRules.migration, firstMigration);
  assert.deepEqual(next.sharedScoreRules.migrationHistory, [{panels: incoming.panels, mappings: incoming.mappings}]);
  Rules.setShared(next, incoming.rules, {migration: {panels: incoming.panels, mappings: incoming.mappings}});
  assert.equal(next.sharedScoreRules.migrationHistory.length, 1);
  assert.deepEqual(Core.validateState(clone(next)), next);
});

test('RC18 shared rules: browser/CommonJS preview and shared key stay deterministic', () => {
  const state = legacyPanels([[rule('a', 2)], [rule('a', 2, 0)]]);
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(require.resolve('../src/score-rules.js'), 'utf8'), context);
  vm.runInContext(`state=${JSON.stringify(state)}`, context);
  const preview = clone(vm.runInContext('ScoreRules.previewShared(state)', context));
  assert.deepEqual(preview, Rules.previewShared(state));
  vm.runInContext('ScoreRules.confirmShared(state,ScoreRules.previewShared(state).expectedKey)', context);
  const shared = share(state);
  assert.equal(vm.runInContext('ScoreRules.key(state)', context), Rules.key(shared));
});
