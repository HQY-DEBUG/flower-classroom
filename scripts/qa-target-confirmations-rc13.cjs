'use strict';
// RC13 source regression: actual Electron UI, transaction gates and synthetic data only.
// Includes the independent RC12 eleven-case target matrix without changing its evidence.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const entry=process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs');
const out=path.resolve(process.env.FLOWER_CONFIRM_OUT||path.join(root,'artifacts/rc13-target-confirmations/electron'));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const {spawnSync}=require('node:child_process'),data=fs.mkdtempSync(path.join(os.tmpdir(),'flower-independent-confirm-'));
 const run=(label,dir,restart)=>{const result=spawnSync(require(path.join(root,'node_modules/electron')),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024,env:{...process.env,FLOWER_PACKAGE_MAIN:entry,FLOWER_CONFIRM_OUT:out,FLOWER_HEADLESS_TEST:'1',FLOWER_DATA_DIR:dir,FLOWER_CONFIRM_RESTART:restart||'',XDG_CACHE_HOME:'/tmp/flower-cache',ELECTRON_CACHE:'/tmp/flower-electron-cache'}});fs.writeFileSync(path.join(out,label+'.log'),(result.stdout||'')+(result.stderr||''));console.log((result.stdout||'').split('\n').filter(s=>/^(PASS|FAIL|FATAL|SUMMARY)_CONFIRM/.test(s)).join('\n'));return result.status;};
 const status=run('flows',data,'');const restarts=[];
 if(fs.existsSync(path.join(out,'snapshots')))for(const name of fs.readdirSync(path.join(out,'snapshots'))){const folder=path.join(out,'snapshots',name),target=fs.mkdtempSync(path.join(os.tmpdir(),'flower-independent-restart-'));fs.copyFileSync(path.join(folder,'after.json'),path.join(target,'classroom-v2.json'));restarts.push({name,status:run('restart-'+name,target,name)});}
 const flows=fs.existsSync(path.join(out,'flows.json'))?JSON.parse(fs.readFileSync(path.join(out,'flows.json'))):null,sourceChanged=!flows||JSON.stringify(flows.sourceAtStart)!==JSON.stringify(flows.sourceAtFinish);
 fs.writeFileSync(path.join(out,'run.json'),JSON.stringify({status,restarts,data,entry,sourceChanged,harnessSha256:hash(fs.readFileSync(__filename))},null,2));process.exitCode=status||sourceChanged||restarts.some(r=>r.status)?1:0;
}else{
 const {app,BrowserWindow,ipcMain}=require('electron');app.disableHardwareAcceleration();
 // Delay one request before the application's real transaction handler. This
 // lets the second real window change data after a visible confirmation click.
 let actionGate=null;const register=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(channel,handler)=>register(channel,channel==='state:action'?async(event,action)=>{const gate=actionGate;if(gate&&action.type===gate.type){actionGate=null;gate.action=action;gate.entered=true;await new Promise(resolve=>gate.resume=resolve);}return handler(event,action);}:handler);
 const src=path.dirname(entry),C=require(path.join(src,'core.cjs')),P=require(path.join(src,'pet-progress.js'));
 require(path.join(root,'scripts/package-boundary.cjs'))(entry,path.join(out,'boundary'+(process.env.FLOWER_CONFIRM_RESTART?'-'+process.env.FLOWER_CONFIRM_RESTART:'')+'.json'));
 const {ensureToolControl,visibleControl,nativeClick}=require(path.join(root,'scripts/qa-tool-control.cjs'));
 const data=process.env.FLOWER_DATA_DIR,restart=process.env.FLOWER_CONFIRM_RESTART,checks=[];
 const sourceHashes=()=>{const files=[];function visit(relative=''){for(const entry of fs.readdirSync(path.join(src,relative),{withFileTypes:true})){const name=path.join(relative,entry.name);if(entry.isDirectory())visit(name);else if(entry.isFile())files.push(name);}}visit();return Object.fromEntries(files.sort().map(name=>[name,hash(fs.readFileSync(path.join(src,name)))]));};
 const sourceAtStart=sourceHashes(),archive=entry.includes('.asar/')?entry.split('.asar/')[0]+'.asar':null;
 let main,other;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const js=(code,w=main)=>w.webContents.executeJavaScript(code,true),get=()=>js('classroom.get().then(x=>x.state)'),act=(a,w=other)=>js('classroom.action('+JSON.stringify(a)+')',w),file=(a,w=other)=>js('classroom.file('+JSON.stringify(a)+')',w);
 const disk=()=>fs.readFileSync(path.join(data,'classroom-v2.json'),'utf8');
 const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2));
 async function until(fn,label='condition'){for(let i=0;i<240;i++){if(await fn())return;await wait(25);}throw Error('Timeout '+label);}
 async function click(selector,w=main){selector=await ensureToolControl(w,selector);await nativeClick(w,await visibleControl(w,selector));}
 async function close(){if(await js('!!document.querySelector("#modal .modal-close")'))await click('#modal .modal-close');await wait(30);}
 function fixture(){let s=C.createInitialState();s.students=s.students.slice(0,3).map((v,i)=>({...v,id:'synthetic_'+i,name:'合成原同学'+i,group:'合成组',score:40}));s.settings.className='合成确认生命周期';s=C.applyAction(s,{type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]});s=C.applyAction(s,{type:'pet.growth',ids:['synthetic_0'],delta:30});s=C.applyAction(s,{type:'wheel.prizes',prizes:[{id:'synthetic_prize',name:'合成奖品',cost:10}]});return s;}
 if(!restart)fs.writeFileSync(path.join(data,'classroom-v2.json'),JSON.stringify(fixture()));
 async function reset(){await close();await file({command:'restore-apply',state:fixture()});await click('[data-page=students]');await until(()=>js('state.students[0]?.id==="synthetic_0"'));}
 async function sync(){const value=await get();await until(()=>js('state.revision==='+value.revision));return value;}
 async function remove(){await click('[data-do=edit-student][data-id=synthetic_0]');await click('[data-do=delete-student]');await until(()=>js('!!document.querySelector("#confirm-action")'));}
 async function wheel(){await click('[data-do=cw-prize][data-id=synthetic_0]');await click('[data-do=cw-spin]');await until(()=>js('!!document.querySelector("[data-do=cw-redeem]")'));}
 async function graduate(){await click('[data-page=pets]');await click('[data-do=pet-graduate][data-id=synthetic_0]');}
 async function checkpoint(name,before,detail){const after=await get(),bytes=disk();assert.deepEqual(JSON.parse(bytes),after,'actual disk must equal memory');const folder=path.join(out,'snapshots',name);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'before.json'),JSON.stringify(before,null,2));fs.writeFileSync(path.join(folder,'after.json'),bytes);write('snapshots/'+name+'/detail.json',{...detail,beforeRevision:before.revision,afterRevision:after.revision,beforeSha256:hash(JSON.stringify(before)),afterDiskSha256:hash(bytes),renderer:await js('({title:document.querySelector("#modal .dialog")?.innerText||"",toast:document.querySelector("#toast").textContent})')});fs.writeFileSync(path.join(folder,'after.png'),(await main.webContents.capturePage()).toPNG());return after;}
 async function check(name,fn){if(!restart&&process.env.FLOWER_CONFIRM_ONLY&&!name.startsWith(process.env.FLOWER_CONFIRM_ONLY))return;try{const detail=await fn();checks.push({name,status:'passed',detail});console.log('PASS_CONFIRM',name);}catch(error){checks.push({name,status:'failed',error:error.stack});console.log('FAIL_CONFIRM',name,error.message);try{fs.writeFileSync(path.join(out,'failure-'+checks.length+'.png'),(await main.webContents.capturePage()).toPNG());write('failure-'+checks.length+'.json',await js('({page,modal:document.querySelector("#modal").innerText,toast:document.querySelector("#toast").innerText,active:document.activeElement.outerHTML,students:state.students.map(v=>({id:v.id,name:v.name})),edit:[...document.querySelectorAll("[data-do=edit-student]")].map(e=>({id:e.dataset.id,rect:e.getBoundingClientRect().toJSON()}))})'));}catch{}}write(restart?'restart-'+restart+'.json':'flows.json',{entry,archiveSha256:archive?hash(require('original-fs').readFileSync(archive)):null,syntheticOnly:true,windowsExecuted:false,sourceAtStart,sourceAtFinish:sourceHashes(),checks});}
 require(entry);const timeout=setTimeout(()=>app.exit(3),165000);
 app.whenReady().then(async()=>{try{await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return main&&!main.webContents.isLoading();});await until(()=>js('typeof state!=="undefined"&&!!state'));
 if(restart){await check('Fresh process exactly retains '+restart,async()=>assert.deepEqual(await get(),JSON.parse(fs.readFileSync(path.join(out,'snapshots',restart,'after.json')))));}
 else{
 await js('classroom.window({command:"open",role:"panel"})');await until(()=>{other=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='panel');return other&&!other.webContents.isLoading();});await until(()=>js('typeof state!=="undefined"&&!!state',other));
 await check('Student removal rejects changed target name',async()=>{await reset();await remove();await act({type:'student.update',id:'synthetic_0',name:'合成新档案身份'});const before=await sync(),shown=await js('document.querySelector("#modal").innerText');await click('#confirm-action');await wait(150);const after=await checkpoint('remove-renamed-target',before,{shown,steps:'Open remove original student; other window renames target; confirm old remove dialog'});assert.deepEqual(after,before,'Old removal dialog deleted the renamed target');});
 await check('Student removal rejects changed target growth and newly earned honor',async()=>{await reset();await remove();await act({type:'pet.graduate',id:'synthetic_0'});const before=await sync();await click('#confirm-action');await wait(150);const after=await checkpoint('remove-new-graduation',before,{steps:'Open remove; other window graduates target; confirm old remove'});assert.deepEqual(after,before,'Old removal deleted student after unseen graduation');});
 await check('Student removal permits unrelated other-student update',async()=>{await reset();await remove();await act({type:'student.update',id:'synthetic_1',name:'合成其他同学新名'});const before=await sync();await click('#confirm-action');await until(async()=>(await get()).students.length===2);const after=await checkpoint('remove-unrelated-control',before,{});assert.equal(after.students.some(s=>s.id==='synthetic_0'),false);assert.equal(after.students.find(s=>s.id==='synthetic_1').name,'合成其他同学新名');assert.equal(after.revision,before.revision+1);});
 await check('Student removal after same-ID restore stays inert',async()=>{await reset();await remove();const incoming=await get();incoming.students[0].name='合成恢复档案';await file({command:'restore-apply',state:incoming});const before=await sync();await click('#confirm-action');await wait(120);assert.deepEqual(await get(),before);assert.deepEqual(JSON.parse(disk()),before);});
 await check('Student removal cancellation and failed-save double-click retry preserve exact data',async()=>{await reset();const initial=await get(),bytes=disk();await remove();await close();assert.deepEqual(await get(),initial);assert.equal(disk(),bytes);await remove();const original=fs.renameSync;let failures=0;fs.renameSync=function(from,to){if(to===path.join(data,'classroom-v2.json')){failures++;throw Object.assign(new Error('Synthetic ordinary save failure'),{code:'EIO'});}return original.apply(this,arguments);};try{await click('#confirm-action');await wait(120);assert.equal(failures,1);assert.deepEqual(await get(),initial);assert.equal(disk(),bytes);}finally{fs.renameSync=original;}await js('document.querySelector("#confirm-action").click();document.querySelector("#confirm-action")?.click()');await until(async()=>(await get()).students.length===2);assert.equal((await get()).revision,initial.revision+1);assert.deepEqual(JSON.parse(disk()),await get());});
 await check('Prize confirmation rejects same-ID same-score restore',async()=>{await reset();await wheel();const incoming=await get();incoming.students[0].name='合成恢复档案';await file({command:'restore-apply',state:incoming});const before=await sync(),shown=await js('document.querySelector("#cw-result")?.innerText');if(await js('!!document.querySelector("[data-do=cw-redeem]")'))await click('[data-do=cw-redeem]');await wait(120);const after=await checkpoint('wheel-restored-target',before,{shown,steps:'Draw prize for original student; restore archive with same ID and 40 points but changed name; press old Confirm Exchange'});assert.deepEqual(after,before,'Old wheel confirmation charged restored archive');});
 await check('Prize confirmation rejects renamed target with unchanged balance',async()=>{await reset();await wheel();await act({type:'student.update',id:'synthetic_0',name:'合成后来姓名'});const before=await sync(),shown=await js('document.querySelector("#cw-result")?.innerText');await click('[data-do=cw-redeem]');await wait(120);const after=await checkpoint('wheel-renamed-target',before,{shown,steps:'Draw prize for original student; other window renames target without score change; confirm old exchange'});assert.deepEqual(after,before,'Old wheel confirmation charged renamed target');});
 await check('Prize confirmation permits unrelated student update and commits once',async()=>{await reset();await wheel();await act({type:'student.update',id:'synthetic_1',name:'合成无关更新'});const before=await sync();await js('document.querySelector("[data-do=cw-redeem]").click();document.querySelector("[data-do=cw-redeem]")?.click()');await until(async()=>(await get()).students[0].score===30);const after=await checkpoint('wheel-unrelated-control',before,{});assert.equal(after.revision,before.revision+1);assert.equal(after.logs.filter(l=>l.kind==='redemption').length,1);assert.deepEqual(after.petAccounts,before.petAccounts);});

 await check('Removal failed-save retry rejects a later target rename and fresh review succeeds once',async()=>{
  await reset();await remove();const initial=await get(),bytes=disk(),rename=fs.renameSync;let failures=0;
  fs.renameSync=function(from,to){if(to===path.join(data,'classroom-v2.json')){failures++;throw Object.assign(new Error('Synthetic RC13 save failure'),{code:'EIO'});}return rename.apply(this,arguments);};
  try{await click('#confirm-action');await until(()=>failures===1);await until(()=>js('!document.querySelector("#confirm-action").disabled'));assert.deepEqual(await get(),initial);assert.equal(disk(),bytes);}finally{fs.renameSync=rename;}
  await act({type:'student.update',id:'synthetic_0',name:'合成失败后新姓名'});const before=await sync();await click('#confirm-action');await wait(100);assert.deepEqual(await get(),before);assert.deepEqual(JSON.parse(disk()),before);assert.match(await js('document.querySelector("#toast").textContent'),/档案或宠物/);assert.equal(await js('document.querySelector("#confirm-action").disabled'),false);
  await close();await remove();await js('document.querySelector("#confirm-action").click();document.querySelector("#confirm-action")?.click()');await until(async()=>(await get()).students.length===2);const after=await checkpoint('remove-failed-then-renamed-reopened',before,{});assert.equal(after.revision,before.revision+1);
 });
 await check('Wheel failed-save retry rejects an identical restore and fresh review charges once',async()=>{
  await reset();await wheel();const initial=await get(),bytes=disk(),rename=fs.renameSync;let failures=0;
  fs.renameSync=function(from,to){if(to===path.join(data,'classroom-v2.json')){failures++;throw Object.assign(new Error('Synthetic RC13 save failure'),{code:'EIO'});}return rename.apply(this,arguments);};
  try{await click('[data-do=cw-redeem]');await until(()=>failures===1);await until(()=>js('!document.querySelector("[data-do=cw-redeem]").disabled'));assert.deepEqual(await get(),initial);assert.equal(disk(),bytes);}finally{fs.renameSync=rename;}
  await file({command:'restore-apply',state:initial});const before=await sync();if(await js('!!document.querySelector("[data-do=cw-redeem]")'))await click('[data-do=cw-redeem]');await wait(100);assert.deepEqual(await get(),before);assert.deepEqual(JSON.parse(disk()),before);
  await close();await wheel();await js('document.querySelector("[data-do=cw-redeem]").click();document.querySelector("[data-do=cw-redeem]")?.click()');await until(async()=>(await get()).students[0].score===30);const after=await checkpoint('wheel-failed-then-identical-restored-reopened',before,{});assert.equal(after.revision,before.revision+1);assert.equal(after.logs.filter(v=>v.kind==='redemption').length,1);
 });
 await check('Removal rejects a target rename queued after the visible confirmation click',async()=>{
  await reset();await remove();const gate={type:'student.remove'};actionGate=gate;await click('#confirm-action');await until(()=>gate.entered);
  try{await act({type:'student.update',id:'synthetic_0',name:'合成排队后改名'});const before=await sync();gate.resume();await until(()=>js('!document.querySelector("#confirm-action").disabled'));const after=await checkpoint('remove-delayed-boundary',before,{expectedRemovalPresent:!!gate.action.expectedRemoval});assert.deepEqual(after,before);assert.ok(gate.action.expectedRemoval);}finally{gate.resume?.();actionGate=null;}
 });
 await check('Wheel rejects an identical restore queued after the visible confirmation click',async()=>{
  await reset();await wheel();const gate={type:'wheel.redeem'};actionGate=gate;await click('[data-do=cw-redeem]');await until(()=>gate.entered);
  try{await file({command:'restore-apply',state:await get()});const before=await sync();gate.resume();await wait(150);const after=await checkpoint('wheel-delayed-identical-restore',before,{expectedRestoreGeneration:gate.action.expectedRestoreGeneration});assert.deepEqual(after,before);assert.ok(Number.isSafeInteger(gate.action.expectedRestoreGeneration));assert.match(await js('document.querySelector("#toast").textContent'),/恢复|过期/);}finally{gate.resume?.();actionGate=null;}
 });
 await check('Restore during wheel animation discards the old result and a reloaded window can redeem',async()=>{
  await reset();await click('[data-do=cw-prize][data-id=synthetic_0]');await click('[data-do=cw-spin]');await file({command:'restore-apply',state:await get()});const before=await sync();await wait(1650);assert.equal(await js('!!document.querySelector("[data-do=cw-redeem]")'),false);assert.deepEqual(await get(),before);
  main.webContents.reload();await until(()=>!main.webContents.isLoading());await until(()=>js('typeof state!=="undefined"&&!!state'));const nativeContext=await js('classroom.get()');assert.equal(await js('restoreGeneration'),nativeContext.restoreGeneration);await wheel();await click('[data-do=cw-redeem]');await until(async()=>(await get()).students[0].score===30);const after=await checkpoint('wheel-reloaded-generation',before,{});assert.equal(after.revision,before.revision+1);
 });

 await check('A newer ordinary notification expires old removal before a delayed older restore notification',async()=>{
  await reset();await remove();const wc=main.webContents,send=wc.send,held=[];
  wc.send=function(...args){if(args[0]==='state:changed'&&args[2]?.restored){held.push(args);return;}return send.apply(this,args);};
  try{
   await file({command:'restore-apply',state:await get()});assert.equal(held.length,1);await act({type:'score',ids:['synthetic_1'],delta:3});const before=await sync(),context=await js('classroom.get()');assert.equal(await js('restoreGeneration'),context.restoreGeneration);
   await click('#confirm-action');await wait(100);assert.deepEqual(await get(),before);assert.deepEqual(JSON.parse(disk()),before);
   wc.send=send;send.apply(wc,held[0]);await wait(100);assert.deepEqual(await js('state'),before,'A delayed older restore notice must never roll the renderer back');
   await close();if(await js('!!document.querySelector("#pet-feedback [data-do=pet-feedback-close]")'))await click('#pet-feedback [data-do=pet-feedback-close]');await remove();await click('#confirm-action');await until(async()=>(await get()).students.length===2);const after=await checkpoint('remove-reordered-notification-reopened',before,{});assert.equal(after.revision,before.revision+1);assert.equal(after.students.find(v=>v.id==='synthetic_1').score,43);
  }finally{wc.send=send;}
 });
 await check('Equal-revision authoritative restore metadata expires old wheel and permits fresh review',async()=>{
  await reset();await wheel();const wc=main.webContents,send=wc.send,held=[];
  wc.send=function(...args){if(args[0]==='state:changed'&&args[2]?.restored){held.push(args);return;}return send.apply(this,args);};
  try{
   await file({command:'restore-apply',state:await get()});assert.equal(held.length,1);const before=await get();
   // A response can carry current state before its change metadata. Exercise
   // the actual renderer acceptance path, then deliver the delayed IPC notice.
   await js('acceptState('+JSON.stringify(before)+',{type:"data"})');assert.equal(await js('state.revision'),before.revision);
   wc.send=send;send.apply(wc,held[0]);await until(()=>js('restoreGeneration==='+held[0][2].restoreGeneration));assert.deepEqual(await js('state'),before);assert.equal(await js('!!document.querySelector("[data-do=cw-redeem]")'),false);assert.deepEqual(JSON.parse(disk()),before);
   await close();await wheel();await click('[data-do=cw-redeem]');await until(async()=>(await get()).students[0].score===30);const after=await checkpoint('wheel-equal-revision-metadata-reopened',before,{});assert.equal(after.revision,before.revision+1);assert.equal(after.logs.filter(v=>v.kind==='redemption').length,1);
  }finally{wc.send=send;}
 });

 await check('Late authoritative restore metadata advances epoch without rolling back newer renderer state',async()=>{
  await reset();await wheel();const wc=main.webContents,send=wc.send,held=[];
  wc.send=function(...args){if(args[0]==='state:changed'){if(args[2]?.restored){held.push(args);return;}const change={...args[2]};delete change.restoreGeneration;args[2]=change;}return send.apply(this,args);};
  try{
   await file({command:'restore-apply',state:await get()});await act({type:'score',ids:['synthetic_1'],delta:4});const before=await sync();assert.ok(before.revision>held[0][1].revision);assert.ok(await js('restoreGeneration<'+held[0][2].restoreGeneration));
   wc.send=send;send.apply(wc,held[0]);await until(()=>js('restoreGeneration==='+held[0][2].restoreGeneration));assert.deepEqual(await js('state'),before);assert.equal(await js('!!document.querySelector("[data-do=cw-redeem]")'),false);assert.deepEqual(JSON.parse(disk()),before);
   await close();await wheel();await click('[data-do=cw-redeem]');await until(async()=>(await get()).students[0].score===30);const after=await checkpoint('wheel-late-older-metadata-reopened',before,{});assert.equal(after.revision,before.revision+1);assert.equal(after.students[1].score,44);
  }finally{wc.send=send;}
 });
 await check('Graduation rejects same-ID same-cycle restored confirmation',async()=>{await reset();await graduate();const incoming=await get();incoming.students[1].name='合成恢复其他姓名';await file({command:'restore-apply',state:incoming});const before=await sync();await click('#confirm-action');await wait(120);assert.deepEqual(await get(),before);assert.deepEqual(JSON.parse(disk()),before);});
 await check('Graduation rejects changed target name while preserving latest archive',async()=>{await reset();await graduate();await act({type:'student.update',id:'synthetic_0',name:'合成毕业改名'});const before=await sync(),bytes=disk();await click('#confirm-action');await wait(100);assert.deepEqual(await get(),before);assert.equal(disk(),bytes);});
 await check('Graduation permits unrelated student change and double-click commits once',async()=>{await reset();await graduate();await act({type:'score',ids:['synthetic_1'],delta:2});const before=await sync();await js('document.querySelector("#confirm-action").click();document.querySelector("#confirm-action")?.click()');await until(async()=>P.profile(await get(),'synthetic_0').graduates.length===1);const after=await checkpoint('graduate-unrelated-control',before,{});assert.equal(after.revision,before.revision+1);assert.equal(P.profile(after,'synthetic_0').medalTotal,1);assert.equal(after.students[1].score,42);});
 }
 clearTimeout(timeout);console.log('SUMMARY_CONFIRM',checks.filter(c=>c.status==='passed').length,'passed',checks.filter(c=>c.status==='failed').length,'failed');app.exit(checks.some(c=>c.status==='failed')?1:0);
 }catch(error){console.log('FATAL_CONFIRM',error.stack);write('fatal.json',{error:error.stack,checks});clearTimeout(timeout);app.exit(2);}});
}
