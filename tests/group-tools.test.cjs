'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Groups=require('../src/group-tools.js');
function fixture(){return {version:1,settings:{className:'合成分组班'},students:[{id:'s1',name:'合成同学甲',group:'合成向日葵组',score:20,growth:35,leader:true,photo:'合成头像',pet:'owl'},{id:'s2',name:'合成同学乙',group:'合成向日葵组',score:100,growth:10,leader:false},{id:'s3',name:'合成同学丙',group:'合成四叶草组',score:50,growth:7}],groupBases:[{group:'合成空组',score:0},{group:'合成基础分组',score:12}],petAccounts:[{id:'s1',graduates:[{growthSnapshot:30}]}]};}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
test('group display order defaults to roster encounter order plus empty/base groups without migrating old data',()=>{
 const state=freeze(fixture()),before=JSON.stringify(state);
 assert.deepEqual(Groups.names(state),['合成向日葵组','合成四叶草组','合成空组','合成基础分组']);
 assert.equal(Groups.reconcileOrder(state),undefined);assert.equal(state.settings.groupOrder,undefined);assert.equal(JSON.stringify(state),before);
});
test('saved order resolves only current groups, keeps empty groups and appends newly encountered groups',()=>{
 const state=fixture();state.settings.groupOrder=['已失效小组','合成空组','合成四叶草组'];freeze(state);
 assert.deepEqual(Groups.names(state),['合成空组','合成四叶草组','合成向日葵组','合成基础分组']);
 assert.deepEqual(Groups.reconcileOrder(state),Groups.names(state));
 assert.deepEqual(state.settings.groupOrder,['已失效小组','合成空组','合成四叶草组']);
});
test('orderedGroups keeps roster member order and every student field while changing only group display order',()=>{
 const state=fixture();state.settings.groupOrder=['合成四叶草组','合成向日葵组'];state.students[1].leader=true;freeze(state);
 const rows=Groups.orderedGroups(state);assert.equal(rows[0].name,'合成四叶草组');assert.deepEqual(rows[1].students.map(s=>s.id),['s1','s2']);
 assert.strictEqual(rows[1].students[0],state.students[0]);assert.strictEqual(rows[1].students[1],state.students[1]);assert.equal(rows[1].memberTotal,120);
 assert.equal(rows[2].students.length,0);assert.equal(rows[2].memberTotal,0);assert.equal(rows[3].base,12);
});
test('ordering supplied rows returns a new array with original row references and does not sort by scores',()=>{
 const state=fixture();state.settings.groupOrder=['合成空组','合成向日葵组','合成四叶草组'];
 const input=freeze([{group:'合成四叶草组',score:999},{name:'合成向日葵组',score:8},{group:'合成空组',score:-12}]);
 const output=Groups.orderedGroups(state,input);assert.deepEqual(output.map(r=>r.group??r.name),state.settings.groupOrder);assert.strictEqual(output[0],input[2]);assert.notStrictEqual(output,input);assert.equal(input[0].score,999);
});
test('creating an empty group is a zero-base patch and preserves points, leaders, growth and graduation records',()=>{
 const state=freeze(fixture()),before=JSON.stringify(state),patch=Groups.createGroupPatch(state,'  合成新小组  ');
 assert.equal(patch.group,'合成新小组');assert.deepEqual(patch.groupBases.at(-1),{group:'合成新小组',score:0});
 assert.equal(patch.groupOrder,undefined);assert.equal(state.settings.groupOrder,undefined);assert.equal(JSON.stringify(state),before);
 assert.notStrictEqual(patch.groupBases,state.groupBases);assert.notStrictEqual(patch.groupBases[0],state.groupBases[0]);
});
test('creating a group appends to a chosen order, retaining existing empty groups',()=>{
 const state=fixture();state.settings.groupOrder=['合成空组','合成四叶草组','已失效小组','合成向日葵组','合成基础分组'];
 const patch=Groups.createGroupPatch(freeze(state),'合成新组');
 assert.deepEqual(patch.groupOrder,['合成空组','合成四叶草组','合成向日葵组','合成基础分组','合成新组']);
 assert.equal(patch.groupBases[0].group,'合成空组');
});
test('duplicate names, controls, blank names and excessive new base records are rejected',()=>{
 const state=fixture();for(const name of ['合成向日葵组','合成空组',' 合成空组 ','',null,1,'a\u0000b','😀'.repeat(41)])assert.throws(()=>Groups.createGroupPatch(state,name));
 assert.equal(Groups.groupName('😀'.repeat(40)),'😀'.repeat(40));
 state.groupBases=Array.from({length:300},(_,i)=>({group:'空'+i,score:0}));assert.throws(()=>Groups.createGroupPatch(state,'超限新组'),/300/);
});
test('all 300 member groups plus 300 separate historical/empty groups remain valid',()=>{
 const state={settings:{},students:Array.from({length:300},(_,i)=>({id:'s'+i,group:'成员组'+i,score:i})),groupBases:Array.from({length:300},(_,i)=>({group:'空组'+i,score:0}))};
 const order=Groups.names(state);assert.equal(order.length,600);assert.equal(Groups.validateOrder(order).length,600);
 const patch=Groups.orderPatch(state,[...order].reverse(),order);assert.equal(patch.groupOrder[0],'空组299');assert.equal(patch.groupOrder.at(-1),'成员组0');
 assert.throws(()=>Groups.validateOrder([...order,'第601组']));
});
test('order validation rejects malformed, duplicate, normalized-duplicate and unsafe names',()=>{
 for(const order of [null,{},'甲组',[3],['甲组','甲组'],['甲组',' 甲组 '],[''],['a\n组'],['😀'.repeat(41)]])assert.throws(()=>Groups.validateOrder(order));
 assert.deepEqual(Groups.validateOrder([' 甲组 ','乙组']),['甲组','乙组']);assert.deepEqual(Groups.validateOrder([]),[]);
});
test('saving order requires a matching complete snapshot and a permutation of every current group',()=>{
 const state=freeze(fixture()),current=Groups.names(state),next=[...current].reverse();
 assert.deepEqual(Groups.orderPatch(state,next,current),{groupOrder:next});
 assert.throws(()=>Groups.orderPatch(state,next));assert.throws(()=>Groups.orderPatch(state,next,[...current].reverse()),/已变化/);
 assert.throws(()=>Groups.orderPatch(state,next.slice(1),current),/名单已变化/);
 assert.throws(()=>Groups.orderPatch(state,['不存在的组',...next.slice(1)],current),/名单已变化/);
 assert.throws(()=>Groups.orderPatch(state,[...next,next[0]],current),/重复/);
});
test('another window adding or removing a group invalidates an opened order while point changes do not',()=>{
 const state=fixture(),order=Groups.names(state);state.students[0].score=999;
 assert.deepEqual(Groups.orderPatch(state,order,order).groupOrder,order);
 state.groupBases.push({group:'另一窗口新增',score:0});assert.throws(()=>Groups.orderPatch(state,order,order),/已变化/);
 state.groupBases.pop();state.groupBases.shift();assert.throws(()=>Groups.orderPatch(state,order,order),/已变化/);
});
test('left and right moves swap adjacent groups, respect boundaries and never mutate the source',()=>{
 const input=freeze(['甲组','乙组','丙组']);assert.deepEqual(Groups.move(input,0,1),['乙组','甲组','丙组']);assert.deepEqual(Groups.move(input,2,-1),['甲组','丙组','乙组']);
 assert.deepEqual(Groups.move(input,0,-1),input);assert.deepEqual(Groups.move(input,2,1),input);
 for(const [index,direction] of [[-1,1],[3,-1],[1.5,1],[0,0],[0,'1']])assert.throws(()=>Groups.move(input,index,direction));
});
test('assignment snapshots validate exact selected students and existing target, allowing unrelated point updates',()=>{
 const state=fixture(),ids=['s1','s3'],expected=ids.map(id=>({id,group:state.students.find(s=>s.id===id).group}));
 state.students[0].score=25;assert.equal(Groups.assertAssignments(freeze(state),ids,expected,'合成空组'),'合成空组');
 assert.throws(()=>Groups.assertAssignments(state,ids,expected,'已删除组'),/目标小组/);
 for(const bad of [[],['s1','s1'],['missing']])assert.throws(()=>Groups.assertAssignments(state,bad,expected,'合成空组'));
 for(const snapshot of [undefined,[],[{id:'s1',group:'旧组'},{id:'s3',group:'合成四叶草组'}],[expected[0],expected[0]],[null,expected[1]]])assert.throws(()=>Groups.assertAssignments(state,ids,snapshot,'合成空组'));
});
test('moving the twenty-point leader transfers totals from 120/50 to100/70 without ranking or roster mutation',()=>{
 const state=fixture(),before=structuredClone(state),expected=[{id:'s1',group:state.students[0].group}];
 const target=Groups.assertAssignments(state,['s1'],expected,'合成四叶草组');
 const after={...state,students:state.students.map(s=>s.id==='s1'?{...s,group:target}:s)};
 assert.deepEqual(Groups.orderedGroups(after).filter(g=>g.students.length).map(g=>[g.name,g.memberTotal]),[['合成四叶草组',70],['合成向日葵组',100]]);
 assert.deepEqual(after.students.map(s=>s.id),before.students.map(s=>s.id));
 const moved=after.students[0];assert.deepEqual({...moved,group:before.students[0].group},before.students[0]);assert.deepEqual(after.petAccounts,before.petAccounts);
 assert.deepEqual(state,before);
});
test('reconciliation removes obsolete member-only groups but retains empty/base groups after deletion or import',()=>{
 const state=fixture();state.settings.groupOrder=Groups.names(state);state.students=state.students.filter(s=>s.group!=='合成向日葵组');
 assert.deepEqual(Groups.reconcileOrder(state),['合成四叶草组','合成空组','合成基础分组']);
 state.students=[{id:'new',group:'替换名单新组',score:0}];delete state.groupBases;
 assert.deepEqual(Groups.reconcileOrder(state),['替换名单新组']);
 state.students=[];assert.deepEqual(Groups.reconcileOrder(state),[]);
});
test('core roundtrip leaves v1 order absent and only explicit group actions introduce v2 data',()=>{
 const Core=require('../src/core.cjs'),state=Core.createInitialState(),before=structuredClone(state);
 assert.deepEqual(Core.validateState(state),before);assert.equal(state.settings.groupOrder,undefined);
 const created=Core.applyAction(state,{type:'group.create',group:'明确创建的合成空组',panelId:Core.panelId(state)});
 assert.equal(created.version,2);assert.equal(created.settings.groupOrder,undefined);assert.deepEqual(created.students,before.students);
 assert.deepEqual(created.groupBases,[{group:'明确创建的合成空组',score:0}]);assert.deepEqual(state,before);
 const names=Groups.names(created),ordered=Core.applyAction(created,{type:'group.order',order:[...names].reverse(),expectedOrder:names,panelId:Core.panelId(created)});
 assert.deepEqual(Core.validateState(ordered),ordered);assert.deepEqual(ordered.students,before.students);
 assert.throws(()=>Core.validateState({...ordered,version:1}),/新版/);
});
test('core requires current panel for group actions and refuses stale complete-order snapshots atomically',()=>{
 const Core=require('../src/core.cjs'),state=Core.createInitialState(),before=structuredClone(state),order=Groups.names(state);
 for(const action of [{type:'group.create',group:'新组'},{type:'group.order',order,expectedOrder:order},{type:'group.create',group:'新组',panelId:'wrong'},{type:'group.order',order,expectedOrder:[...order].reverse(),panelId:Core.panelId(state)}])assert.throws(()=>Core.applyAction(state,action));
 assert.deepEqual(state,before);
});
test('core optional assignment guard protects changed selection while preserving legacy assignment API',()=>{
 const Core=require('../src/core.cjs');let state=Core.createInitialState();const student=state.students[0],snapshot={id:student.id,group:student.group};
 state=Core.applyAction(state,{type:'students.group',ids:[student.id],group:'旧API创建的合成小组'});
 assert.equal(state.students[0].group,'旧API创建的合成小组');const before=structuredClone(state);
 assert.throws(()=>Core.applyAction(state,{type:'students.group',ids:[student.id],group:state.students[3].group,expectedAssignments:[snapshot],requireExistingGroup:true,panelId:Core.panelId(state)}),/已变化/);
 assert.deepEqual(state,before);const moved=Core.applyAction(state,{type:'students.group',ids:[student.id],group:state.students[3].group,expectedAssignments:[{id:student.id,group:state.students[0].group}],requireExistingGroup:true,panelId:Core.panelId(state)});
 assert.deepEqual(moved.students.map(s=>({...s,group:''})),state.students.map(s=>({...s,group:''})));
});
test('core removes dead order references after roster edits while keeping a deliberately created empty group',()=>{
 const Core=require('../src/core.cjs');let state=Core.createInitialState();state.students=state.students.slice(0,1);
 const oldGroup=state.students[0].group;state=Core.applyAction(state,{type:'group.create',group:'保留的合成空组',panelId:Core.panelId(state)});
 const order=Groups.names(state);state=Core.applyAction(state,{type:'group.order',order:[...order].reverse(),expectedOrder:order,panelId:Core.panelId(state)});
 state=Core.applyAction(state,{type:'student.update',id:state.students[0].id,group:'合成新组'});assert.deepEqual(state.settings.groupOrder,['保留的合成空组','合成新组']);assert.ok(!state.settings.groupOrder.includes(oldGroup));
 state=Core.applyAction(state,{type:'student.remove',id:state.students[0].id});assert.deepEqual(state.settings.groupOrder,['保留的合成空组']);assert.deepEqual(state.groupBases,[{group:'保留的合成空组',score:0}]);
});
test('replace import preserves previously empty group names at zero base and appends new roster groups without mutating source records',()=>{
 const Core=require('../src/core.cjs');let state=Core.createInitialState();state.students=state.students.slice(0,2);
 state.students[0].photo=require('./pet-fixtures.cjs').SYNTHETIC_PNG;state.students[0].score=20;state.students[0].growth=35;state.students[0].leader=true;
 state=Core.applyAction(state,{type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]});state=Core.applyAction(state,{type:'pet.graduate',id:state.students[0].id});
 state=Core.applyAction(state,{type:'group.create',group:'合成非零空组',panelId:Core.panelId(state)});state=Core.applyAction(state,{type:'group.create',group:'合成零分空组',panelId:Core.panelId(state)});
 state=Core.applyAction(state,{type:'group.base',group:'合成非零空组',delta:17,reason:'合成空组基础分'});state=Core.applyAction(state,{type:'group.base',group:state.students[0].group,delta:33,reason:'合成有成员组基础分'});
 const oldGroup=state.students[0].group,order=Groups.names(state);state=Core.applyAction(state,{type:'group.order',order:['合成零分空组',oldGroup,'合成非零空组'],expectedOrder:order,panelId:Core.panelId(state)});
 const before=structuredClone(state);freeze(state);
 const replaced=Core.importRows([{name:'替换合成学生甲',group:'新名单甲组'},{name:'替换合成学生乙',group:'新名单乙组'}],state,'replace');
 assert.deepEqual(replaced.groupBases,[{group:'合成非零空组',score:0},{group:'合成零分空组',score:0}]);
 assert.deepEqual(replaced.settings.groupOrder,['合成零分空组','合成非零空组','新名单甲组','新名单乙组']);assert.deepEqual(replaced.groupLogs||[],[]);
 assert.ok(!Groups.names(replaced).includes(oldGroup));assert.equal(replaced.students.length,2);assert.ok(replaced.students.every(student=>student.score===0&&student.growth===0&&student.photo===''&&!before.students.some(old=>old.id===student.id)));
 assert.deepEqual(state,before);assert.equal(state.students[0].photo,before.students[0].photo);assert.deepEqual(state.petAccounts,before.petAccounts);
});
