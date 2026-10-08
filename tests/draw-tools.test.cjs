'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const DrawTools = require('../src/draw-tools.js');
const { createInitialState, applyAction } = require('../src/core.cjs');
const source = fs.readFileSync(require.resolve('../src/draw-tools.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const decode = text => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function drawn(count = 5) { return applyAction(createInitialState(), { type: 'draw', count, mode: 'cycle' }); }
function harness(initial = drawn()) {
  let state = initial, current;
  const calls = [], messages = [], events = [];
  const document = {
    querySelector: selector => selector === '.dt-draw' ? current : null,
    getElementById: id => current?.fields.find(field => field.id === id)
  };
  const root = { document, OrganizationTools: require('../src/organization-tools.js'), Event: class Event { constructor(type, options) { this.type = type; Object.assign(this, options); } } };
  vm.runInNewContext(source, root);
  const tools = root.DrawTools;
  function mount(options = {}) {
    const html = tools.view(state, options);
    const key = decode(html.match(/data-draw-key="([^"]*)"/)[1]);
    const generation = html.match(/data-draw-generation="([^"]*)"/)[1];
    const fields = [...html.matchAll(/<input ([^>]+)>/g)].map(match => {
      const attr = name => decode(match[1].match(new RegExp(`(?:^| )${name}="([^"]*)"`))?.[1] || '');
      const scoreId = attr('data-draw-score');
      return { id: attr('id'), value: attr('value'), dataset: scoreId ? { drawScore: scoreId } : {}, disabled: / disabled(?: |$)/.test(match[1]), dispatchEvent: event => events.push({ type: event.type, bubbles: event.bubbles }) };
    });
    const buttons = [...html.matchAll(/<button ([^>]+)>/g)].map(match => ({ dataset: {}, disabled: / disabled(?: |$)/.test(match[1]) }));
    current = {
      dataset: { drawKey: key, drawGeneration: generation }, fields,
      querySelectorAll: selector => selector === '[data-draw-score]' ? fields.filter(field => field.dataset.drawScore) : [...fields, ...buttons],
      querySelector: selector => fields.find(field => '#' + field.id === selector),
      setAttribute: (name, value) => { current[name] = value; }
    };
    return html;
  }
  const context = {
    get state() { return state; },
    act: async action => { calls.push(plain(action)); state = applyAction(state, plain(action)); mount(); return true; },
    toast: message => messages.push(message), render: () => mount()
  };
  mount();
  return { tools, calls, messages, events, context, mount, get state() { return state; }, set state(next) { state = next; }, get current() { return current; }, set current(next) { current = next; }, field: id => document.getElementById(id), score: id => current.fields.find(field => field.dataset.drawScore === id) };
}

test('CommonJS and browser exports expose compatible standalone UI', () => {
  const h = harness();
  assert.deepEqual(Object.keys(h.tools), Object.keys(DrawTools));
  const html = h.mount();
  for (const action of ['draw', 'draw-reset', 'reward-picked', 'draw-reward', 'draw-reward-batch', 'draw-count-minus', 'draw-count-plus']) assert.ok(html.includes(`data-do="${action}"`), action);
  assert.equal((html.match(/data-draw-student=/g) || []).length, 5);
  assert.match(html, /id="draw-count"/); assert.match(html, /id="draw-mode"/);
  assert.match(html, /空白行会跳过/); assert.match(html, /继续抽取/);
  assert.doesNotMatch(h.mount({ role: 'draw' }), /data-do="open-draw"/);
});

test('score validation accepts only integers 1–100', () => {
  for (const value of [1, '1', ' 5 ', 100, '100']) assert.equal(DrawTools.validateDelta(value), Number(value));
  for (const value of ['', ' ', null, undefined, true, false, 0, -1, 101, 1.5, '1e2', '1.0', '+5', 'Infinity', 'abc', NaN, Infinity]) assert.throws(() => DrawTools.validateDelta(value));
});

test('row content and draft attributes are escaped', () => {
  const h = harness(drawn(1)), id = h.state.draw.lastIds[0];
  h.state.students.find(student => student.id === id).name = '<img src=x onerror=alert(1)>';
  h.state.students.find(student => student.id === id).group = '" onclick="bad';
  h.score(id).value = '" autofocus onfocus="bad';
  const html = h.mount();
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&quot; onclick=&quot;bad'));
  assert.ok(html.includes('&quot; autofocus onfocus=&quot;bad'));
  assert.doesNotMatch(html, /<img src=x|value="" autofocus/);
});

test('individual award adds requested score and growth only to the selected row, and is undoable', async () => {
  const h = harness(), id = h.state.draw.lastIds[1], other = h.state.draw.lastIds[0], expectedDraw=h.current.dataset.drawKey;
  h.score(id).value = '5'; h.score(other).value = '3';
  assert.equal(await h.tools.handle('draw-reward', { dataset: { id } }, h.context), true);
  assert.deepEqual(h.calls, [{ type: 'score', ids: [id], delta: 5, reason: '随机点名奖励', expectedDraw }]);
  assert.equal(h.state.students.find(student => student.id === id).score, 5);
  assert.equal(h.state.students.find(student => student.id === id).growth, 5);
  assert.equal(h.state.students.find(student => student.id === other).score, 0);
  assert.equal(h.score(id).value, ''); assert.equal(h.score(other).value, '3');
  assert.ok(h.messages.at(-1).includes('+5'));
  const reverted = applyAction(h.state, { type: 'undo', logId: h.state.logs.at(-1).id });
  assert.equal(reverted.students.find(student => student.id === id).score, 0);
});

test('mixed batch skips blanks and submits one atomic request with each row value', async () => {
  const h = harness(), ids = h.state.draw.lastIds, expectedDraw=h.current.dataset.drawKey;
  h.score(ids[0]).value = '2'; h.score(ids[1]).value = '5'; h.score(ids[2]).value = ' ';
  await h.tools.handle('draw-reward-batch', {}, h.context);
  assert.deepEqual(h.calls, [{ type: 'score.mixed', awards: [{ id: ids[0], delta: 2 }, { id: ids[1], delta: 5 }], reason: '随机点名奖励', expectedDraw }]);
  assert.equal(h.state.logs.length, 2);
  assert.equal(h.state.students.find(student => student.id === ids[0]).score, 2);
  assert.equal(h.state.students.find(student => student.id === ids[1]).score, 5);
  assert.equal(h.state.students.find(student => student.id === ids[2]).score, 0);
  assert.equal(h.score(ids[0]).value, ''); assert.equal(h.score(ids[1]).value, '');
});

test('empty or partly invalid batches never partially submit', async () => {
  const h = harness(), ids = h.state.draw.lastIds;
  await h.tools.handle('draw-reward-batch', {}, h.context);
  assert.equal(h.calls.length, 0); assert.match(h.messages.at(-1), /至少填写/);
  h.score(ids[0]).value = '5'; h.score(ids[1]).value = '101';
  await h.tools.handle('draw-reward-batch', {}, h.context);
  assert.equal(h.calls.length, 0); assert.match(h.messages.at(-1), /1–100/);
  assert.equal(h.score(ids[0]).value, '5'); assert.equal(h.score(ids[1]).value, '101');
});

test('unified reward keeps the legacy selector, defaults to +1, and permits +5', async () => {
  const h = harness();
  await h.tools.handle('reward-picked', {}, h.context);
  assert.equal(h.calls[0].delta, 1);
  h.field('draw-uniform-delta').value = '5';
  h.score(h.state.draw.lastIds[0]).value = '7';
  await h.tools.handle('reward-picked', {}, h.context);
  assert.equal(h.calls[1].delta, 5); assert.deepEqual(h.calls[1].ids, h.state.draw.lastIds);
  for (const id of h.state.draw.lastIds) assert.equal(h.state.students.find(student => student.id === id).score, 6);
  assert.equal(h.score(h.state.draw.lastIds[0]).value, '7');
  assert.equal(h.field('draw-uniform-delta').value, '5');
  assert.match(h.messages.at(-1), /5 位同学各 \+5 分成功/);
});

test('unrelated state broadcasts and temporary page removal retain row and uniform drafts', () => {
  const h = harness(), id = h.state.draw.lastIds[0];
  h.score(id).value = '9'; h.field('draw-uniform-delta').value = '5';
  h.tools.capture(); h.current = null;
  h.state = applyAction(h.state, { type: 'timer.set', seconds: 10 }); h.mount();
  assert.equal(h.score(id).value, '9'); assert.equal(h.field('draw-uniform-delta').value, '5');
  h.state = applyAction(h.state, { type: 'score', ids: [id], delta: 1 }); h.mount();
  assert.equal(h.score(id).value, '9');
});

test('new result resets row drafts, keeps unified value, and repeat of identical IDs also resets', () => {
  const h = harness(), id = h.state.draw.lastIds[0];
  h.score(id).value = '9'; h.field('draw-uniform-delta').value = '5';
  h.tools.resetResults(); h.mount();
  assert.equal(h.score(id).value, ''); assert.equal(h.field('draw-uniform-delta').value, '5');
  h.score(id).value = '6';
  h.state = applyAction(h.state, { type: 'draw', count: 5, mode: 'cycle' }); h.mount();
  assert.ok(h.current.fields.filter(field => field.dataset.drawScore).every(field => field.value === ''));
});

test('board reset ignores stale DOM and clears unified value', () => {
  const h = harness(), id = h.state.draw.lastIds[0];
  h.score(id).value = '9'; h.field('draw-uniform-delta').value = '5';
  h.tools.reset(); h.tools.capture(); h.mount();
  assert.equal(h.score(id).value, ''); assert.equal(h.field('draw-uniform-delta').value, '1');
});

test('in-flight reward blocks repeated individual, batch, unified, and new-draw requests', async () => {
  const h = harness(), id = h.state.draw.lastIds[0]; let release, calls = 0;
  h.score(id).value = '5';
  h.context.act = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const first = h.tools.handle('draw-reward', { dataset: { id } }, h.context);
  assert.ok(h.current.querySelectorAll('input, select, button').every(field => field.disabled));
  for (const action of ['draw-reward', 'draw-reward-batch', 'reward-picked', 'draw', 'draw-reset']) assert.equal(await h.tools.handle(action, { dataset: { id } }, h.context), true);
  assert.equal(calls, 1); release(true); await first;
  assert.equal(h.field('draw-uniform-delta').disabled, false);
  assert.equal(await h.tools.handle('draw', {}, h.context), false);
});

test('failed and thrown reward calls retain drafts, restore controls, and allow retry', async () => {
  const h = harness(), id = h.state.draw.lastIds[0];
  h.score(id).value = '5'; h.context.act = async () => false;
  await h.tools.handle('draw-reward', { dataset: { id } }, h.context);
  assert.equal(h.score(id).value, '5'); assert.equal(h.score(id).disabled, false);
  h.context.act = async () => { throw new Error('磁盘写入失败'); };
  await h.tools.handle('draw-reward', { dataset: { id } }, h.context);
  assert.equal(h.score(id).value, '5'); assert.match(h.messages.at(-1), /磁盘写入失败/);
  h.context.act = async () => true;
  await h.tools.handle('draw-reward', { dataset: { id } }, h.context);
  assert.equal(h.score(id).value, ''); assert.equal(h.score(id).disabled, false);
});

test('late reward response does not clear another board or newer draw drafts', async () => {
  const h = harness(), id = h.state.draw.lastIds[0]; let release;
  h.score(id).value = '5'; h.context.act = () => new Promise(resolve => { release = resolve; });
  const pending = h.tools.handle('draw-reward', { dataset: { id } }, h.context);
  h.tools.reset(); h.mount(); h.score(id).value = '8';
  release(true); await pending;
  assert.equal(h.score(id).value, '8'); assert.equal(h.messages.length, 0);
});

test('count stepper moves 1 to 5, clamps roster/20, and emits input plus change', async () => {
  const h = harness();
  // RC18 persists the last draw count (the harness drew 5). Start this stepper-only scenario at 1 explicitly.
  h.field('draw-count').value = '1';
  for (let n = 0; n < 4; n++) await h.tools.handle('draw-count-plus', {}, h.context);
  assert.equal(h.field('draw-count').value, '5');
  assert.deepEqual(h.events.map(event => event.type), ['input', 'change', 'input', 'change', 'input', 'change', 'input', 'change']);
  assert.ok(h.events.every(event => event.bubbles));
  for (let n = 0; n < 30; n++) await h.tools.handle('draw-count-plus', {}, h.context);
  assert.equal(h.field('draw-count').value, '12');
  for (let n = 0; n < 30; n++) await h.tools.handle('draw-count-minus', {}, h.context);
  assert.equal(h.field('draw-count').value, '1');
  h.field('draw-count').value = 'bad'; await h.tools.handle('draw-count-plus', {}, h.context);
  assert.equal(h.field('draw-count').value, '2');
});

test('animation, missing student, stale result, and empty class cannot award points', async () => {
  const h = harness(), id = h.state.draw.lastIds[0]; h.score(id).value = '5';
  h.mount({ animating: true }); await h.tools.handle('draw-reward', { dataset: { id } }, h.context);
  assert.equal(h.calls.length, 0);
  h.mount({ animating: false }); await h.tools.handle('draw-reward', { dataset: { id: 'foreign-id' } }, h.context);
  assert.equal(h.calls.length, 0); assert.match(h.messages.at(-1), /不在本次/);
  h.state = applyAction(h.state, { type: 'draw', count: 1, mode: 'cycle' });
  await h.tools.handle('reward-picked', {}, h.context);
  assert.equal(h.calls.length, 0); assert.match(h.messages.at(-1), /结果已更新/);
  h.state = createInitialState(); h.state.students = []; h.mount();
  await h.tools.handle('reward-picked', {}, h.context);
  assert.equal(h.calls.length, 0); assert.match(h.messages.at(-1), /先开始点名/);
  assert.match(h.mount(), /data-do="draw" disabled/);
  assert.equal(await h.tools.handle('unrelated-action', {}, h.context), false);
});

test('group rows show actual members and a per-group award is guarded and undoable',async()=>{
 const initial=applyAction(createInitialState(),{type:'draw',scope:'groups',count:2}),h=harness(initial),group=h.state.draw.groups[0];
 const html=h.mount();assert.match(html,/抽小组/);assert.equal((html.match(/data-draw-group=/g)||[]).length,2);assert.match(html,/2 组 · 6 位同学/);
 h.score('group:'+group.group).value='5';await h.tools.handle('draw-reward-group',{dataset:{group:group.group}},h.context);
 assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].ids,group.ids);assert.equal(typeof h.calls[0].expectedDraw,'string');assert.equal(h.state.logs[0].changes.length,3);assert.equal(h.score('group:'+group.group).value,'');
 for(const student of h.state.students)assert.equal(student.score,group.ids.includes(student.id)?5:0);
 h.state=applyAction(h.state,{type:'undo',logId:h.state.logs[0].id});assert.deepEqual(h.state.students,initial.students);
});
test('group batch expands group values atomically and retains drafts on a malformed group value',async()=>{
 const h=harness(applyAction(createInitialState(),{type:'draw',scope:'groups',count:2})),groups=h.state.draw.groups;
 h.score('group:'+groups[0].group).value='2';h.score('group:'+groups[1].group).value='101';await h.tools.handle('draw-reward-batch',null,h.context);assert.equal(h.calls.length,0);assert.equal(h.score('group:'+groups[0].group).value,'2');
 h.score('group:'+groups[1].group).value='5';await h.tools.handle('draw-reward-batch',null,h.context);assert.equal(h.calls.length,1);assert.equal(h.calls[0].awards.length,6);assert.equal(h.state.logs.length,2);for(const [index,group]of groups.entries())for(const id of group.ids)assert.equal(h.state.students.find(v=>v.id===id).score,[2,5][index]);
 assert.ok(groups.every(g=>h.score('group:'+g.group).value===''));assert.equal(await h.tools.handle('draw-reward-group',{dataset:{group:'missing'}},h.context),true);assert.equal(h.calls.length,1);
});
