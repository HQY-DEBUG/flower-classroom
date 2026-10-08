'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStore}=require('../src/storage.cjs');
const validate=s=>{if(!s||![1,2].includes(s.version)||!Number.isInteger(s.revision)||!Array.isArray(s.students))throw Error('invalid');return structuredClone(s);};
const initial=()=>({version:1,revision:0,students:[{name:'合成学生',score:0}]});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'flower-store-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,store:createStore(dir,{validate,initial})};}
test('v2 storage: opening legacy data never rewrites it and first actual save uses a new file',t=>{
 const {dir,store}=fixture(t),original=JSON.stringify({...initial(),revision:4});fs.writeFileSync(store.legacyPath,original);const loaded=store.load();assert.equal(loaded.state.revision,4);assert.equal(fs.readFileSync(store.legacyPath,'utf8'),original);assert.equal(fs.existsSync(store.modernPath),false);
 const next=store.save({...loaded.state,revision:5});assert.equal(next.version,2);assert.equal(store.path,store.modernPath);assert.equal(fs.readFileSync(store.legacyPath,'utf8'),original);assert.ok(fs.existsSync(store.markerPath));assert.ok(fs.readdirSync(dir).some(f=>f.startsWith('before-v2-migration-')));
});
test('v2 storage: an old program writing its own legacy file cannot overwrite or reimport over v2',t=>{
 const {dir,store}=fixture(t);fs.writeFileSync(store.legacyPath,JSON.stringify(initial()));store.load();const modern=store.save({...initial(),revision:8,students:[{name:'新周期合成学生',score:35}]});fs.writeFileSync(store.legacyPath,JSON.stringify({...initial(),revision:99,students:[{name:'旧程序分支',score:999}]}));const reopened=createStore(dir,{validate,initial}).load();assert.deepEqual(reopened.state,modern);
});
test('v2 storage: corrupt current uses only its v2 previous, never the old legacy branch',t=>{
 const {dir,store}=fixture(t);fs.writeFileSync(store.legacyPath,JSON.stringify(initial()));store.load();const first=store.save({...initial(),revision:1});store.save({...first,revision:2});fs.writeFileSync(store.modernPath,'broken');const reopened=createStore(dir,{validate,initial}).load();assert.deepEqual(reopened.state,first);assert.match(reopened.warning,/上一次/);assert.ok(fs.readdirSync(dir).some(f=>f.startsWith('classroom-v2.json.damaged')));
});
test('v2 storage: missing or corrupt modern chain is read-only until explicit restore',t=>{
 const {dir,store}=fixture(t);fs.writeFileSync(store.legacyPath,JSON.stringify(initial()));store.load();store.save({...initial(),revision:7});fs.unlinkSync(store.modernPath);fs.rmSync(store.modernPath+'.previous',{force:true});const reopened=createStore(dir,{validate,initial});assert.equal(reopened.load().readOnly,true);assert.throws(()=>reopened.save({...initial(),revision:9}),/恢复/);const restored=reopened.save({...initial(),revision:10},{restore:true});assert.equal(restored.version,2);assert.equal(reopened.blocked,false);assert.equal(reopened.load().state.revision,10);
});
test('v2 storage: malformed or oversized save does not switch paths or change either save',t=>{
 const {store}=fixture(t);fs.writeFileSync(store.legacyPath,JSON.stringify(initial()));store.load();const original=fs.readFileSync(store.legacyPath,'utf8');assert.throws(()=>store.save({version:1,revision:'bad',students:[]}));assert.throws(()=>store.save({...initial(),padding:'x'.repeat(90*1024*1024)}),/90MB/);assert.equal(fs.readFileSync(store.legacyPath,'utf8'),original);assert.equal(fs.existsSync(store.modernPath),false);assert.equal(store.path,store.legacyPath);
});
test('v2 storage: failed rename is atomic and a later retry commits once',t=>{
 const {store}=fixture(t);store.load();const first=store.save({...initial(),revision:1});const before=fs.readFileSync(store.modernPath,'utf8'),originalRename=fs.renameSync;
 fs.renameSync=function(a,b){if(b===store.modernPath)throw Error('SYNTHETIC_DISK_FAILURE');return originalRename.apply(this,arguments);};
 try{assert.throws(()=>store.save({...first,revision:2}),/SYNTHETIC_DISK_FAILURE/);assert.equal(fs.readFileSync(store.modernPath,'utf8'),before);assert.equal(store.load().state.revision,1);}finally{fs.renameSync=originalRename;}
 assert.equal(store.save({...first,revision:2}).revision,2);assert.equal(store.load().state.revision,2);
});
test('v2 storage: saving after recovery cannot replace the healthy previous file with corrupt primary',t=>{
 const {dir,store}=fixture(t);store.load();const good=store.save({...initial(),revision:1,students:[{name:'合成学生',score:10}]});store.save({...good,revision:2});fs.writeFileSync(store.modernPath,'broken-modern');
 const recovered=createStore(dir,{validate,initial});assert.equal(recovered.load().state.students[0].score,10);const previous=fs.readFileSync(store.modernPath+'.previous','utf8'),original=fs.renameSync;
 fs.renameSync=function(a,b){if(b===store.modernPath)throw Error('SYNTHETIC_RECOVERY_RENAME_FAILURE');return original.apply(this,arguments);};
 try{assert.throws(()=>recovered.save({...good,revision:2,students:[{name:'合成学生',score:11}]}),/SYNTHETIC_RECOVERY/);assert.equal(fs.readFileSync(store.modernPath+'.previous','utf8'),previous);}finally{fs.renameSync=original;}
 const reopened=createStore(dir,{validate,initial}).load();assert.equal(reopened.readOnly,false);assert.equal(reopened.state.students[0].score,10);
});
test('v2 storage: first migration rename failure still leaves a verified v2 recovery state',t=>{
 const {dir,store}=fixture(t);const old={...initial(),revision:3,students:[{name:'合成旧班',score:25}]};fs.writeFileSync(store.legacyPath,JSON.stringify(old));store.load();const original=fs.renameSync;
 fs.renameSync=function(a,b){if(b===store.modernPath)throw Error('SYNTHETIC_MIGRATION_RENAME_FAILURE');return original.apply(this,arguments);};
 try{assert.throws(()=>store.save({...old,revision:4}),/SYNTHETIC_MIGRATION/);}finally{fs.renameSync=original;}
 const reopened=createStore(dir,{validate,initial}).load();assert.equal(reopened.readOnly,false);assert.equal(reopened.state.students[0].score,25);assert.equal(reopened.state.revision,3);assert.equal(fs.readFileSync(store.legacyPath,'utf8'),JSON.stringify(old));
});
test('recovery: a missing legacy primary still loads its complete previous classroom',t=>{
 const {dir,store}=fixture(t),previous={...initial(),revision:11,students:[{name:'合成恢复同学',score:27}]};fs.writeFileSync(store.legacyPath+'.previous',JSON.stringify(previous));
 const loaded=store.load();assert.deepEqual(loaded.state,previous);assert.equal(loaded.readOnly,false);assert.match(loaded.warning,/上一次/);
 const bytes=fs.readFileSync(store.legacyPath+'.previous','utf8');store.save({...previous,revision:12});assert.equal(fs.readFileSync(store.legacyPath+'.previous','utf8'),bytes);assert.equal(createStore(dir,{validate,initial}).load().state.revision,12);
});
test('recovery: unreadable legacy chain never enables saving an example classroom',t=>{
 const {store}=fixture(t);fs.writeFileSync(store.legacyPath,'broken-primary');fs.writeFileSync(store.legacyPath+'.previous','broken-previous');
 const loaded=store.load();assert.equal(loaded.readOnly,true);assert.throws(()=>store.save({...loaded.state,revision:1}),/恢复备份/);assert.equal(fs.existsSync(store.modernPath),false);assert.equal(fs.readFileSync(store.legacyPath,'utf8'),'broken-primary');
 const restored=store.save({...initial(),revision:9},{restore:true});assert.equal(restored.revision,9);assert.equal(store.blocked,false);
});
for(const code of ['ENOSPC','EACCES'])test('recovery: failed damaged-copy '+code+' displays previous data and requires preserving it before restore',t=>{
 const {dir,store}=fixture(t),good={...initial(),version:2,revision:4};fs.writeFileSync(store.modernPath,'broken-primary');fs.writeFileSync(store.modernPath+'.previous',JSON.stringify(good));const original=fs.copyFileSync;let denied=true;
 fs.copyFileSync=function(from,to,...rest){if(denied&&from===store.modernPath&&String(to).includes('.damaged-')){const error=Error('synthetic copy failure');error.code=code;throw error;}return original.call(this,from,to,...rest);};
 try{
  const loaded=store.load();assert.deepEqual(loaded.state,good);assert.equal(loaded.readOnly,true);assert.match(loaded.warning,/保留副本未能保存/);assert.throws(()=>store.save({...good,revision:5}),/恢复/);assert.throws(()=>store.save({...good,revision:5},{restore:true}),/仍无法保留/);assert.equal(fs.readFileSync(store.modernPath,'utf8'),'broken-primary');assert.deepEqual(JSON.parse(fs.readFileSync(store.modernPath+'.previous')),good);
  denied=false;store.save({...good,revision:5},{restore:true});assert.equal(store.blocked,false);const damaged=fs.readdirSync(dir).find(n=>n.startsWith('classroom-v2.json.damaged-'));assert.equal(fs.readFileSync(path.join(dir,damaged),'utf8'),'broken-primary');assert.equal(createStore(dir,{validate,initial}).load().state.revision,5);
 }finally{fs.copyFileSync=original;}
});
test('recovery: failed preservation plus invalid restore never changes a file',t=>{
 const {dir,store}=fixture(t);fs.writeFileSync(store.modernPath,'broken-primary');fs.writeFileSync(store.modernPath+'.previous',JSON.stringify({...initial(),version:2}));const original=fs.copyFileSync;
 fs.copyFileSync=function(from,to,...rest){if(from===store.modernPath&&String(to).includes('.damaged-'))throw Error('synthetic unavailable');return original.call(this,from,to,...rest);};
 try{store.load();const names=fs.readdirSync(dir);assert.throws(()=>store.save({version:2,revision:'bad',students:[]},{restore:true}),/invalid/);assert.deepEqual(fs.readdirSync(dir),names);assert.equal(fs.readFileSync(store.modernPath,'utf8'),'broken-primary');}finally{fs.copyFileSync=original;}
});
