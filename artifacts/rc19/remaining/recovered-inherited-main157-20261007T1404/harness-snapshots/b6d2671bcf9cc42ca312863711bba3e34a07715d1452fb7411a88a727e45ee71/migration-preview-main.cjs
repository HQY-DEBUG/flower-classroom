'use strict';
require('./observe.cjs');
// Full main/preload/renderer reproduction of the ordinary source-save interleaving.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../..'),entry=process.env.FLOWER_PACKAGE_MAIN||path.join(repo,'src/main.cjs'),src=path.dirname(entry);
const out=path.resolve(process.env.FLOWER_MIGRATION_MAIN_OUT||path.join(repo,'artifacts/reaudit-rc16/migration/preview-main')),phase=process.env.FLOWER_MIGRATION_MAIN_PHASE||'preview';
const expectCoherent=process.env.FLOWER_MIGRATION_EXPECT_COHERENT==='1';
const root=path.join(out,'destination'),source=path.join(out,'source'),sourceFile=path.join(source,'classroom.json');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),save=(file,x)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof x==='string'?x:JSON.stringify(x,null,2));};
const {app,BrowserWindow,dialog}=require('electron');app.disableHardwareAcceleration();
process.env.FLOWER_HEADLESS_TEST='1';process.env.FLOWER_FOLDER_ROOT=root;process.env.FLOWER_DATA_DIR='';process.env.FLOWER_EXTERNAL_RESOURCE_DIR='';process.env.FLOWER_MIGRATION_NO_RELAUNCH='1';
require('../package-boundary.cjs')(entry,path.join(out,phase+'-dependency-boundary.json'));
const C=require(path.join(src,'core.cjs')),S=require(path.join(src,'storage.cjs'));let injected=false,newer,preview;
if(phase==='preview'){
 const initial=C.validateState(require('../../tests/pet-fixtures.cjs').legacyState());newer=C.applyAction(initial,{type:'panel.create',mode:'copy',name:'合成同时新增面板'},1770000000000);save(sourceFile,initial);save(path.join(out,'expected-newer-state.json'),newer);
 const read=fs.readFileSync;fs.readFileSync=function(file,...rest){const result=read.call(this,file,...rest);if(!injected&&file===sourceFile){injected=true;const oldStore=S.createStore(source,{validate:C.validateState,initial:C.createInitialState});oldStore.load();oldStore.save(newer);}return result;};
}else newer=JSON.parse(fs.readFileSync(path.join(out,'expected-newer-state.json')));
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[source]});
const startedAt=new Date().toISOString(),checks=[];let finished=false;
function finish(error){if(finished)return;finished=true;const result={phase,startedAt,finishedAt:new Date().toISOString(),entry,moduleSha256:hash(fs.readFileSync(path.join(src,'legacy-migration.cjs'))),checks,error:error?String(error.stack||error):null,syntheticOnly:true,windowsExecuted:false,layer:'Real Electron main/preload/renderer IPC; deterministic ordinary external-save timing'};save(path.join(out,phase+'-result.json'),result);console.log(JSON.stringify(result));app.exit(error?1:0);}
process.on('unhandledRejection',finish);require(entry);
app.whenReady().then(async()=>{try{
 let main;for(let i=0;i<500;i++){main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');if(main&&!main.webContents.isLoading()){try{await main.webContents.executeJavaScript('classroom.get()');break;}catch{}}await new Promise(r=>setTimeout(r,20));}assert.ok(main);
 const js=code=>main.webContents.executeJavaScript(code,true),file=request=>js('classroom.file('+JSON.stringify(request)+')');
 const until=async(code)=>{for(let i=0;i<200;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,10));}throw Error('UI condition timeout: '+code);};
 const click=selector=>js('document.querySelector('+JSON.stringify(selector)+').click()');
 if(phase==='preview'){
  if(expectCoherent){
   const prior=await js('classroom.get()');let rejected;try{await file({command:'legacy-migration-preview'});}catch(e){rejected=e.message;}assert.ok(rejected&&rejected.includes('变化'));assert.deepEqual((await js('classroom.get()')).state,prior.state);checks.push({name:'Actual migration IPC rejects source store.save upgrade during preview and keeps active classroom unchanged',status:'passed',error:rejected});
   const abandoned=await file({command:'legacy-migration-preview'});await file({command:'legacy-migration-cancel',token:abandoned.token});await assert.rejects(file({command:'legacy-migration-apply',token:abandoned.token,approvedResourcePaths:abandoned.externalResources.map(x=>x.path)}));
   await click('#nav-settings');await click('[data-do="folder-manage"]');await until('!!document.querySelector("[data-do=folder-migrate]")');await click('[data-do="folder-migrate"]');await until('!!document.querySelector("[data-do=folder-migration-confirm]")');assert.ok((await js('document.querySelector(".rule-refresh-summary").textContent')).includes('2 个面板'));await js('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');await new Promise(r=>setTimeout(r,150));fs.writeFileSync(path.join(out,'coherent-migration-preview.png'),(await main.webContents.capturePage()).toPNG());await click('[data-do="folder-migration-cancel"]');await until('!document.querySelector("#modal .dialog")');assert.deepEqual((await js('classroom.get()')).state,prior.state);checks.push({name:'Real folder UI shows the fresh two-panel summary and Cancel closes it without changing the classroom',status:'passed'});
   preview=await file({command:'legacy-migration-preview'});assert.equal(preview.summary.panels,2);const imported=await file({command:'legacy-migration-apply',token:preview.token,approvedResourcePaths:preview.externalResources.map(x=>x.path)});assert.equal(imported.migrated,true);assert.deepEqual(S.createStore(path.join(root,'数据'),{validate:C.validateState,initial:C.createInitialState}).load().state,newer);checks.push({name:'Fresh preview can be canceled, re-previewed, and committed with coherent two-panel classroom',status:'passed'});
  }else{
  preview=await file({command:'legacy-migration-preview'});const imported=await file({command:'legacy-migration-apply',token:preview.token,approvedResourcePaths:preview.externalResources.map(x=>x.path)});
  const actual=S.createStore(path.join(root,'数据'),{validate:C.validateState,initial:C.createInitialState}).load().state;assert.equal(injected,true);assert.equal(imported.migrated,true);assert.equal(preview.summary.panels,1);assert.equal(1+actual.panels.others.length,2);checks.push({name:'Actual migration IPC accepts stale 1-panel preview after real createStore.save upgrades source to 2-panel v2',status:'confirmed-defect',previewPanels:preview.summary.panels,copiedPanels:1+actual.panels.others.length});
  }
 }else{
  if(expectCoherent){
   const current=await js('classroom.get()');assert.deepEqual(current.state,newer);const refreshed=await file({command:'rules-workbook-refresh-preview'});assert.ok(refreshed.token);const W=require(path.join(src,'score-rule-workbook.cjs')),panels=await W.parseBytes(fs.readFileSync(path.join(root,W.FILE_NAME)),current.state);assert.equal(panels.length,2);checks.push({name:'Restart loads the migrated two-panel classroom and generated workbook refresh succeeds',status:'passed',panels:panels.length});
  }else{
  const current=await js('classroom.get()');assert.deepEqual(current.state,newer);let failure;try{await file({command:'rules-workbook-refresh-preview'});}catch(e){failure=e.message;}assert.ok(failure&&failure.includes('1–100'));checks.push({name:'Full application restart loads two-panel classroom but workbook refresh cannot parse its generated workbook',status:'confirmed-defect',panels:1+current.state.panels.others.length,workbookRefreshError:failure});
  }
  const image=await main.webContents.capturePage();fs.writeFileSync(path.join(out,'restart-screen.png'),image.toPNG());
 }finish();
}catch(e){finish(e);}});setTimeout(()=>finish(Error('Migration main harness timeout')),25000);
