'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const P=require('../src/folder-pristine.cjs');
const temporary=t=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'flower-pristine-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;};
test('only exactly recorded unused example permits migration',t=>{const dir=temporary(t),s={revision:0,students:[{id:'synthetic'}]};assert.equal(P.hasClassroomFiles(dir),false);assert.equal(P.allowedPristineFiles(dir,s),null);fs.writeFileSync(path.join(dir,'classroom-v2.json'),JSON.stringify(s));P.recordInitialState(dir,s);assert.ok(P.allowedPristineFiles(dir,s));assert.equal(P.allowedPristineFiles(dir,{...s,revision:1}),null);fs.writeFileSync(path.join(dir,'classroom-v2.json'),'changed');assert.equal(P.allowedPristineFiles(dir,s),null);});
test('new lock or unrecorded legacy classroom prevents pristine migration',t=>{const dir=temporary(t),s={revision:0};P.recordInitialState(dir,s);fs.writeFileSync(path.join(dir,'classroom-lock.json'),'synthetic');assert.equal(P.allowedPristineFiles(dir,s),null);assert.equal(P.hasClassroomFiles(dir),true);});
test('missing damaged or malformed marker never authorizes replacing data',t=>{const dir=temporary(t);fs.writeFileSync(path.join(dir,P.MARKER),'bad');assert.equal(P.allowedPristineFiles(dir,{}),null);fs.mkdirSync(path.join(dir,'classroom-v2.json'));assert.equal(P.hasClassroomFiles(dir),true);assert.equal(P.allowedPristineFiles(dir,{}),null);});
test('whole-folder relocation preserves unused-state proof without absolute references',t=>{const dir=temporary(t),dest=temporary(t),s={revision:0};fs.writeFileSync(path.join(dir,'classroom-v2.json'),'synthetic');P.recordInitialState(dir,s);fs.cpSync(dir,dest,{recursive:true});assert.deepEqual(P.allowedPristineFiles(dest,s),P.allowedPristineFiles(dir,s));});

for(const kind of ['missing','directory','oversize','read-failure'])test('unavailable ancillary workbook preserves first-run data marker: '+kind,t=>{
 const dir=temporary(t),resources=temporary(t),file=path.join(resources,'配置.xlsx'),state={revision:0,students:[{id:'synthetic'}]};
 fs.writeFileSync(path.join(dir,'classroom-v2.json'),JSON.stringify(state));
 if(kind==='directory')fs.mkdirSync(file);if(kind==='oversize')fs.writeFileSync(file,Buffer.alloc(5*1024*1024+1));if(kind==='read-failure')fs.writeFileSync(file,'synthetic');
 const original=fs.readFileSync;if(kind==='read-failure')fs.readFileSync=function(target,...args){if(target===file)throw Object.assign(new Error('synthetic EIO'),{code:'EIO'});return original.call(this,target,...args);};
 try{const marker=P.recordInitialState(dir,state,resources);assert.equal(Object.hasOwn(marker,'workbookHash'),false);assert.ok(P.allowedPristineFiles(dir,state));assert.equal(P.allowedPristineWorkbookHash(dir,state,resources),null);}finally{fs.readFileSync=original;}
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'classroom-v2.json'),'utf8')),state);
});
test('pristine workbook proof is exact and invalidates after later changes',t=>{
 const dir=temporary(t),resources=temporary(t),file=path.join(resources,'配置.xlsx'),state={revision:0};fs.writeFileSync(file,'synthetic');
 const marker=P.recordInitialState(dir,state,resources);assert.equal(P.allowedPristineWorkbookHash(dir,state,resources),marker.workbookHash);
 fs.writeFileSync(file,'different');assert.equal(P.allowedPristineWorkbookHash(dir,state,resources),null);
});
