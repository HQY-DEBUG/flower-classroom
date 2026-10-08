'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Core=require('../src/core.cjs'),W=require('../src/score-rule-workbook.cjs'),fixtures=require('./fixtures/rc18-pending-workbook-transactions.json');
function setup(t,scenario='pending-before'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'flower-rc18-pending-upgrade-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const data=path.join(root,'数据'),backup=path.join(root,'备份');fs.mkdirSync(data);fs.mkdirSync(backup);
  for(const [name,value]of Object.entries(fixtures.cases[scenario]))if(value!==null){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from(value,'base64'));}
  const json=path.join(data,'classroom-v2.json'),book=path.join(root,W.FILE_NAME),receipt=book+'.flower-pending.json';
  const create=options=>W.createScoreRuleWorkbook({resourceDirectory:root,dataDirectory:data,backupDirectory:backup,...options});
  const bytes=()=>Object.fromEntries(Object.keys(fixtures.cases[scenario]).map(name=>[name,fs.existsSync(path.join(root,name))?fs.readFileSync(path.join(root,name)):null]));
  return {root,data,json,book,receipt,create,bytes,raw:()=>JSON.parse(fs.readFileSync(json)),state:()=>Core.validateState(JSON.parse(fs.readFileSync(json)))};
}
for(const scenario of ['pending-before','pending-after'])test('RC19 recognizes exact RC18 '+scenario+' receipt only against unchanged old durable state',t=>{
  const f=setup(t,scenario),old=f.raw(),upgraded=f.state(),json=fs.readFileSync(f.json),receipt=JSON.parse(fs.readFileSync(f.receipt)),afterBook=fs.readFileSync(f.book);
  assert.equal(Object.hasOwn(old,'petProgression'),false);assert.ok(upgraded.petProgression);
  const manager=f.create();assert.deepEqual(manager.recover(upgraded),{recovered:true,committed:scenario==='pending-after'});
  assert.deepEqual(fs.readFileSync(f.json),json);assert.deepEqual(fs.readFileSync(f.book),scenario==='pending-after'?afterBook:Buffer.from(receipt.beforeBytes,'base64'));
  assert.equal(fs.existsSync(f.receipt),false);const applied=f.bytes();assert.deepEqual(manager.recover(upgraded),{recovered:false});assert.deepEqual(f.bytes(),applied);
});

for(const kind of ['new-custom-global','new-explicit-default-global','cross-panel-setting','external-workbook','different-memory-state'])test('RC19 RC18 receipt rejects '+kind+' without rewriting classroom, workbook or evidence',t=>{
  const f=setup(t),raw=f.raw();let state;
  if(kind==='new-custom-global')raw.petProgression={version:1,costs:[6,10,15,20,20,20,20],repeatCost:20};
  if(kind==='new-explicit-default-global')raw.petProgression={version:1,costs:[5,10,15,20,20,20,20],repeatCost:20};
  if(kind==='cross-panel-setting')raw.panels.others[0].data.settings.scoreStep=4;
  if(kind!=='external-workbook')fs.writeFileSync(f.json,JSON.stringify(raw));else fs.appendFileSync(f.book,'synthetic external change');
  state=f.state();if(kind==='different-memory-state')state.students[0].score++;
  const before=f.bytes();assert.throws(()=>f.create().recover(state),/尚未完成/);assert.deepEqual(f.bytes(),before);assert.throws(()=>f.create().recover(state),/尚未完成/);assert.deepEqual(f.bytes(),before);
});

test('RC19 RC18 raw JSON changed at workbook replacement boundary leaves original workbook and receipt intact',t=>{
  const f=setup(t),state=f.state(),before=f.bytes(),changed=f.raw();changed.petProgression={version:1,costs:[7,10,15,20,20,20,20],repeatCost:21};let injected=false;
  const io=new Proxy(fs,{get(target,key){if(key==='openSync')return(file,...args)=>{if(!injected&&String(file).startsWith(f.book+'.flower-')){injected=true;fs.writeFileSync(f.json,JSON.stringify(changed));}return fs.openSync(file,...args);};return target[key];}});
  assert.throws(()=>f.create({fileSystem:io}).recover(state),/旧课堂文件已在事务核对后变化/);assert.equal(injected,true);
  assert.deepEqual(fs.readFileSync(f.book),before[W.FILE_NAME]);assert.deepEqual(fs.readFileSync(f.receipt),before[W.FILE_NAME+'.flower-pending.json']);assert.deepEqual(f.raw(),changed);
  const after=f.bytes();assert.throws(()=>f.create().recover(f.state()),/尚未完成/);assert.deepEqual(f.bytes(),after);
});

for(const kind of ['new-global','cross-panel'])test('RC19 old matching previous JSON cannot conceal '+kind+' edits in the current primary',t=>{
  const f=setup(t),stale=f.state(),raw=f.raw(),original=fs.readFileSync(f.json);fs.writeFileSync(f.json+'.previous',original);
  if(kind==='new-global')raw.petProgression={version:1,costs:[8,10,15,20,20,20,20],repeatCost:22};else raw.panels.others[0].data.settings.scoreStep=9;
  fs.writeFileSync(f.json,JSON.stringify(raw));const before=f.bytes();assert.throws(()=>f.create().recover(stale),/尚未完成/);assert.deepEqual(f.bytes(),before);assert.throws(()=>f.create().recover(stale),/尚未完成/);assert.deepEqual(f.bytes(),before);
});
