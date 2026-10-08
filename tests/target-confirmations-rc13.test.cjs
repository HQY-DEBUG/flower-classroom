'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../src/core.cjs'),W=require('../src/classroom-wheels.js'),P=require('../src/pet-progress.js');
const clone=structuredClone,run=(s,a)=>C.applyAction(s,a,1_000_000);
const archived=name=>C.validateState(require('./rc18-regression-fixtures.cjs').historical(name));
const make=()=>archived('enabled');
const removal=(s,id=s.students[0].id)=>({type:'student.remove',id,expectedRemoval:clone({student:s.students.find(v=>v.id===id),petAccount:s.petAccounts?.find(v=>v.studentId===id)||null})});
const redemption=s=>({type:'wheel.redeem',id:s.students[0].id,prizeId:W.list(s)[0].id,expectedPrize:W.list(s)[0],expectedScore:s.students[0].score,expectedStudent:W.studentIdentity(s.students[0]),allowDebt:true,redemptionId:'synthetic_rc13_redemption'});
const reject=(latest,action,pattern)=>{const before=clone(latest);assert.throws(()=>run(latest,action),pattern);assert.deepEqual(latest,before);};

test('Student removal binds the entire reviewed target profile and score atomically',()=>{
 const s=make(),a=removal(s),id=a.id;
 for(const change of [{type:'student.update',id,name:'合成新姓名'},{type:'student.update',id,group:'合成新组'},{type:'student.update',id,leader:true},{type:'student.update',id,pet:'fox'},{type:'student.update',id,adopted:false},{type:'score',ids:[id],delta:3}])reject(run(s,change),a,/档案或宠物/);
 for(const expectedRemoval of [null,{},[],{student:s.students[0]}])reject(s,{...a,expectedRemoval},/档案或宠物/);
});

test('Student removal rejects restored historical growth, graduation honors and replacement cycles',()=>{
 const initial=make(),id=initial.students[0].id,a=removal(initial);
 const grown=archived('grown');reject(grown,a,/档案或宠物/);
 const beforeGraduation=removal(grown),graduated=archived('graduated');reject(graduated,beforeGraduation,/档案或宠物/);
 assert.equal(P.profile(graduated,id).medalTotal,1);
 const readopted=archived('readopted');reject(readopted,a,/档案或宠物/);
 const redeemed=run(graduated,{type:'pet.badge.redeem',id,amount:1,reason:'合成兑换',expectedRevision:graduated.revision,panelId:C.panelId(graduated),requestId:'synthetic_rc13_badge'});
 reject(redeemed,removal(graduated),/档案或宠物/);
});

test('Student removal allows unrelated student, score, pet, settings and timer changes',()=>{
 let s=make();const a=removal(s),other=s.students[1].id;
 for(const change of [{type:'student.update',id:other,name:'合成其他同学'},{type:'score',ids:[other],delta:5},{type:'student.update',id:other,pet:'fox'},{type:'settings',className:'合成班级改名'},{type:'timer.set',seconds:60}])s=run(s,change);
 const saved=run(s,a);assert.equal(saved.students.length,s.students.length-1);assert.deepEqual(saved.students[0],s.students[1]);assert.deepEqual(saved.logs,s.logs);assert.deepEqual(saved.petAccounts,s.petAccounts);
 assert.throws(()=>run(saved,a),/找不到/);assert.equal(saved.revision,s.revision+1);
});

test('Student removal keeps legacy saves and snapshot-free callers compatible',()=>{
 const s=C.createInitialState(),a=removal(s);assert.equal(a.expectedRemoval.petAccount,null);assert.equal(run(s,a).students.length,s.students.length-1);assert.doesNotThrow(()=>run(s,{type:'student.remove',id:a.id}));
});

test('Wheel redemption rejects changed identity independently of score and preserves the full state',()=>{
 const s=make(),a=redemption(s),id=a.id;
 for(const patch of [{name:'合成另一个姓名'},{group:'合成另一个组'},{photo:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRj8AAAAASUVORK5CYII='}])reject(run(s,{type:'student.update',id,...patch}),a,/兑换学生档案/);
 for(const expectedStudent of [null,{},[],{id}])reject(s,{...a,expectedStudent},/兑换学生档案/);
});

test('Wheel redemption allows unrelated students and target species edits while charging reviewed price once',()=>{
 let s=make();const a=redemption(s),other=s.students[1].id;
 for(const change of [{type:'student.update',id:other,name:'合成别的同学'},{type:'score',ids:[other],delta:5},{type:'student.update',id:a.id,pet:'fox'},{type:'settings',className:'合成班级改名'}])s=run(s,change);
 const saved=run(s,a);assert.equal(saved.students[0].score,s.students[0].score-a.expectedPrize.cost);assert.deepEqual(saved.petAccounts,s.petAccounts);assert.deepEqual(saved.students[1],s.students[1]);assert.equal(saved.logs.filter(v=>v.kind==='redemption').length,1);reject(saved,a,/已经处理/);
});

test('Wheel redemption retains price, balance, debt, missing target and undo safeguards',()=>{
 const s=make(),a=redemption(s);
 reject(run(s,{type:'score',ids:[a.id],delta:1}),a,/积分已改变/);
 reject(run(s,{type:'wheel.prizes',prizes:W.list(s).map(p=>({...p,cost:p.cost+1}))}),a,/价格已改变/);
 reject(s,{...a,allowDebt:false},/强制兑换/);
 const removed=run(s,{type:'student.remove',id:a.id});reject(run(removed,{type:'student.add',name:s.students[0].name}),a,/学生已移除/);
 const saved=run(s,a),undone=run(saved,{type:'undo',logId:saved.logs.at(-1).id});assert.equal(undone.students[0].score,s.students[0].score);reject(undone,a,/已经处理/);
 assert.deepEqual(C.validateState(clone(saved)),saved);
});

test('Panel rename binds only the reviewed panel name and keeps other classroom changes',()=>{
 const s=make(),action={type:'settings',className:'合成草稿名称',expectedClassName:s.settings.className};
 reject(run(s,{type:'settings',className:'合成另窗名称'}),action,/面板名称/);
 const scored=run(s,{type:'score',ids:[s.students[0].id],delta:5}),saved=run(scored,action);
 assert.equal(saved.settings.className,action.className);assert.deepEqual(saved.students,scored.students);assert.deepEqual(saved.logs,scored.logs);
 assert.doesNotThrow(()=>run(s,{type:'settings',className:'合成兼容旧调用'}));
});
