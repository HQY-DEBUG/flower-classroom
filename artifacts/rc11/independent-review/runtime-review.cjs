'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),out=__dirname,prefix=process.env.FLOWER_PACKAGE_MAIN?'packaged-':'';
const sha=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
if(!process.versions.electron){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'flower-independent-'));
 const c=require(path.join(root,'src/core.cjs'));let state=c.createInitialState();state.students=state.students.slice(0,3);state.settings.className='独立复核合成班';
 fs.writeFileSync(path.join(data,'classroom.json'),JSON.stringify(state));fs.writeFileSync(path.join(data,'review-backup.json'),JSON.stringify(state));
 const roster=path.join(data,'roster.csv');fs.writeFileSync(roster,'姓名,小组,头像名称\n独立合成导入,合成组,\n');fs.writeFileSync(path.join(data,'newer.csv'),'姓名,小组,头像名称\n更新合成导入,合成组,\n');
 const run=require('node:child_process').spawnSync(require(path.join(root,'node_modules/electron')),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:60000,env:{...process.env,FLOWER_HEADLESS_TEST:'1',FLOWER_DATA_DIR:data,FLOWER_REVIEW_ROSTER:roster}});
 fs.writeFileSync(path.join(out,prefix+'runtime.log'),(run.stdout||'')+(run.stderr||''));console.log(run.stdout);process.exitCode=run.status||0;
}else{
 const {app,BrowserWindow,dialog,ipcMain}=require('electron');app.disableHardwareAcceleration();let main,delay=false,resolveResponse,pending,nextRoster=process.env.FLOWER_REVIEW_ROSTER,cancelNext=false;
 dialog.showOpenDialog=async()=>{if(cancelNext){cancelNext=false;return {canceled:true,filePaths:[]};}return {canceled:false,filePaths:[nextRoster]};};
 const realHandle=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(channel,fn)=>realHandle(channel,channel==='file:command'?async(event,req)=>{const value=await fn(event,req);if(delay&&['import-preview','restore-preview'].includes(req.command)){delay=false;pending=value;return new Promise(resolve=>{resolveResponse=()=>resolve(value);});}return value;}:fn);
 const entry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs')),runtimeSrc=path.dirname(entry);
 const files=['core.cjs','pet-ledger.cjs','pet-progress.js','avatar-ui.js','avatar-library.cjs','io.cjs','app.js','main.cjs','pet-art.js'];
 const hashes=()=>Object.fromEntries(files.map(name=>['src/'+name,sha(fs.readFileSync(path.join(runtimeSrc,name)))]));const sourceAtStart=hashes();
 require(path.join(root,'scripts/package-boundary.cjs'))(entry,path.join(out,prefix+'dependency-boundary.json'));require(entry);
 const results=[];const js=s=>main.webContents.executeJavaScript(s,true);const wait=ms=>new Promise(r=>setTimeout(r,ms));async function until(fn,label){for(let i=0;i<200;i++){if(await fn())return;await wait(20);}throw Error('timeout '+label);}
 async function check(name,fn){try{results.push({name,status:'passed',detail:await fn()});}catch(e){results.push({name,status:'failed',error:e.message,actual:e.actual,expected:e.expected});}console.log(JSON.stringify(results.at(-1)));}
 app.whenReady().then(async()=>{try{
 await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return main&&!main.webContents.isLoading();},'main');await until(()=>js('!!state'),'state');ipcMain.handle=realHandle;main.setSize(1280,960);
 await check('Import delayed after newer modal opens and closes must stay dismissed',async()=>{
  await js('handleDo("tools-import",{dataset:{}})');const before=await js('JSON.stringify(state)');delay=true;
  await js('void handleDo("import",document.querySelector("[data-do=import]"))');await until(()=>!!resolveResponse,'delayed real preview');
  await js('editStudent(state.students[0].id)');assert.equal(await js('!!document.querySelector("#student-form")'),true);
  await js('closeModal()');resolveResponse();resolveResponse=null;await wait(250);
  const actual=await js('({hasPreview:!!document.querySelector("#confirm-action"),title:document.querySelector("#dialog-heading")?.textContent,state:JSON.stringify(state)})');assert.equal(actual.state,before);
  fs.writeFileSync(path.join(out,prefix+'delayed-preview-after-newer-dialog.png'),(await main.webContents.capturePage()).toPNG());
  assert.equal(actual.hasPreview,false,'Earlier roster preview reopened after a newer dialog was opened then canceled');return {...actual,state:undefined};
 });
 await js('closeModal()');
 await check('Repeated imports show only newest request regardless of response order',async()=>{
  await js('closeModal();handleDo("tools-import",{dataset:{}})');const before=await js('JSON.stringify(state)');
  nextRoster=process.env.FLOWER_REVIEW_ROSTER;delay=true;await js('void handleDo("import",document.querySelector("[data-do=import]"))');await until(()=>!!resolveResponse,'first preview prepared');const first=resolveResponse;resolveResponse=null;
  nextRoster=path.join(process.env.FLOWER_DATA_DIR,'newer.csv');delay=true;await js('void handleDo("import",document.querySelector("[data-do=import]"))');await until(()=>!!resolveResponse,'second preview prepared');const second=resolveResponse;resolveResponse=null;
  first();await wait(150);const staleVisible=await js('!!document.querySelector("#confirm-action")');second();await wait(150);
  const actual=await js('({text:document.querySelector("#modal .dialog-content")?.textContent,state:JSON.stringify(state)})');assert.equal(actual.state,before);assert.equal(staleVisible,false,'Older preview became visible while a newer import was pending');assert.ok(actual.text.includes('更新合成导入'));return {newestNameVisible:true};
 });
 await js('closeModal()');
 await check('Canceling a newer native chooser suppresses an older pending import',async()=>{
  await js('closeModal();handleDo("tools-import",{dataset:{}})');const before=await js('JSON.stringify(state)');nextRoster=process.env.FLOWER_REVIEW_ROSTER;delay=true;
  await js('void handleDo("import",document.querySelector("[data-do=import]"))');await until(()=>!!resolveResponse,'old import');const old=resolveResponse;resolveResponse=null;
  cancelNext=true;await js('handleDo("import",document.querySelector("[data-do=import]"))');old();await wait(150);
  assert.equal(await js('!!document.querySelector("#confirm-action")'),false);assert.equal(await js('JSON.stringify(state)'),before);return {noPreview:true,noMutation:true};
 });
 await check('Navigation away and back cannot revive a delayed import preview',async()=>{
  await js('closeModal();handleDo("tools-import",{dataset:{}})');nextRoster=process.env.FLOWER_REVIEW_ROSTER;delay=true;
  await js('void handleDo("import",document.querySelector("[data-do=import]"))');await until(()=>!!resolveResponse,'delayed import');
  await js('document.querySelector("[data-page=pets]").click();document.querySelector("[data-page=settings]").click()');resolveResponse();resolveResponse=null;await wait(150);
  assert.equal(await js('!!document.querySelector("#confirm-action")'),false);return {noPreview:true};
 });
 await check('Delayed restore preview stays closed after a newer dialog opens and closes',async()=>{
  await js('closeModal();handleDo("tools-import",{dataset:{}})');const before=await js('JSON.stringify(state)');nextRoster=path.join(process.env.FLOWER_DATA_DIR,'review-backup.json');delay=true;
  await js('void handleDo("restore",{dataset:{}})');await until(()=>!!resolveResponse,'restore preview');
  await js('editStudent(state.students[0].id);closeModal()');resolveResponse();resolveResponse=null;await wait(150);
  assert.equal(await js('!!document.querySelector("#confirm-action")'),false);assert.equal(await js('JSON.stringify(state)'),before);return {noPreview:true,noMutation:true};
 });
 await check('A newer canceled import also suppresses an older restore preview',async()=>{
  await js('closeModal();handleDo("tools-import",{dataset:{}})');nextRoster=path.join(process.env.FLOWER_DATA_DIR,'review-backup.json');delay=true;
  await js('void handleDo("restore",{dataset:{}})');await until(()=>!!resolveResponse,'restore preview');const old=resolveResponse;resolveResponse=null;
  cancelNext=true;await js('handleDo("import",document.querySelector("[data-do=import]"))');old();await wait(150);
  assert.equal(await js('!!document.querySelector("#confirm-action")'),false);return {noPreview:true};
 });
 await check('Current restore preview still opens and Cancel preserves exact memory and disk',async()=>{
  await js('closeModal();handleDo("tools-import",{dataset:{}})');const before=await js('JSON.stringify(state)'),disk=fs.readFileSync(path.join(process.env.FLOWER_DATA_DIR,'classroom.json'),'utf8');nextRoster=path.join(process.env.FLOWER_DATA_DIR,'review-backup.json');
  await js('handleDo("restore",{dataset:{}})');assert.equal(await js('!!document.querySelector("#confirm-action")'),true);assert.match(await js('document.querySelector("#modal .dialog-content").textContent'),/独立复核合成班/);await js('closeModal()');assert.equal(await js('JSON.stringify(state)'),before);assert.equal(fs.readFileSync(path.join(process.env.FLOWER_DATA_DIR,'classroom.json'),'utf8'),disk);return {previewVisible:true,noMutation:true};
 });
 await check('Restore while quick library loads retains its invalidation message and disabled choices',async()=>{
  const before=await js('classroom.get().then(r=>r.state)');
  // Render the real UI with a deferred list response to exercise callback order.
  await js('window.reviewResolve=null; window.reviewContext={...moduleContext(),api:{...api,file: r=>r.command==="avatars-list"?new Promise(resolve=>window.reviewResolve=resolve):api.file(r)}}; void AvatarUI.handle("quick-avatar",{dataset:{id:state.students[0].id}},window.reviewContext)');
  await until(()=>js('!!window.reviewResolve'),'deferred list');
  await js('AvatarUI.sync(state,{restored:true})');
  const noteBefore=await js('document.querySelector(".avatar-draft-status").textContent');
  const library=await js('classroom.file({command:"avatars-list"})');
  await js('window.reviewResolve('+JSON.stringify(library)+')');await wait(100);
  const actual=await js('({enabledChoices:[...document.querySelectorAll("[data-do=pick-avatar]")].filter(b=>!b.disabled).length,saveDisabled:document.querySelector("[data-do=avatar-save]").disabled,note:document.querySelector(".avatar-draft-status").textContent})');
  assert.equal(actual.note,noteBefore);assert.equal(actual.saveDisabled,true);assert.equal(actual.enabledChoices,0,'Late list result visually enabled choices in an invalidated avatar draft');return actual;
 });
 await check('Student form library retains restore explanation after its late list arrives',async()=>{
  await js('closeModal();editStudent(state.students[0].id);window.reviewResolve=null;window.reviewContext={...moduleContext(),api:{...api,file:r=>r.command==="avatars-list"?new Promise(resolve=>window.reviewResolve=resolve):api.file(r)}};void AvatarUI.handle("avatar-library",{dataset:{}},window.reviewContext)');await until(()=>js('!!window.reviewResolve'),'form delayed list');await js('AvatarUI.sync(state,{restored:true})');
  const note=await js('document.querySelector(".avatar-library-status").textContent'),library=await js('classroom.file({command:"avatars-list"})');await js('window.reviewResolve('+JSON.stringify(library)+')');await wait(100);assert.equal(await js('document.querySelector(".avatar-library-status").textContent'),note,'Late library list erased why the form is unavailable');return {invalidationMessagePreserved:true};
 });
 const sourceAtFinish=hashes();fs.writeFileSync(path.join(out,prefix+'runtime-results.json'),JSON.stringify({results,entry,sourceAtStart,sourceAtFinish,sourceChanged:JSON.stringify(sourceAtStart)!==JSON.stringify(sourceAtFinish),syntheticOnly:true,realElectronMainPreload:true,nativeChoosersMocked:true,programmaticUIActions:true,windowsExecuted:false},null,2));app.exit(results.some(r=>r.status!=='passed')?1:0);
 }catch(e){fs.writeFileSync(path.join(out,prefix+'runtime-fatal.txt'),e.stack);app.exit(2);}});setTimeout(()=>app.exit(3),55000);
}
