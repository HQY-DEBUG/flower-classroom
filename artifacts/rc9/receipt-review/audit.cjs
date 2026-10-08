'use strict';
// Independent synthetic Electron IPC audit; never loads or modifies user data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),out=path.resolve(process.env.FLOWER_RECEIPT_OUT||__dirname),mainEntry=path.resolve(process.env.FLOWER_RECEIPT_MAIN||path.join(root,'src/main.cjs')),srcDir=path.dirname(mainEntry);fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'flower-receipt-review-'));
 const run=require('node:child_process').spawnSync(require(path.join(root,'node_modules/electron')),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:85000,maxBuffer:8*1024*1024,env:{...process.env,FLOWER_HEADLESS_TEST:'1',FLOWER_DATA_DIR:data}});
 fs.writeFileSync(path.join(out,'run.log'),(run.stdout||'')+(run.stderr||''));console.log(run.stdout);if(run.error)console.error(run.error);process.exitCode=run.error?2:run.status??2;
}else{
 const {app,BrowserWindow,ipcMain}=require('electron');app.disableHardwareAcceleration();
 require(path.join(root,'scripts/package-boundary.cjs'))(mainEntry,path.join(out,'dependency-boundary.json'));
 const Core=require(path.join(srcDir,'core.cjs')),handlers=new Map(),seen=[],fileSeen=[],fault={response:false,receipt:false,beforeReceipt:null};
 const handle=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(channel,handler)=>{handlers.set(channel,handler);handle(channel,(event,...args)=>{
  if(channel==='state:action')seen.push({owner:event.sender,action:args[0]});
  if(channel==='file:command')fileSeen.push({owner:event.sender,action:args[0]});
  if(channel==='state:receipt'){
   if(fault.beforeReceipt){const run=fault.beforeReceipt;fault.beforeReceipt=null;run();}
   if(fault.receipt){fault.receipt=false;throw Error('SYNTHETIC_RECEIPT_FAILURE');}
  }
  const result=handler(event,...args);
  if((channel==='state:action'&&fault.response===true)||(channel==='file:command'&&fault.response==='file')){fault.response=false;throw Error('SYNTHETIC_ACTION_RESPONSE_LOSS');}
  return result;
 });};
 const checks=[],limits=[],data=process.env.FLOWER_DATA_DIR,files=['action-receipts.cjs','preload.cjs','main.cjs'];
 const hashes=()=>Object.fromEntries(files.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(srcDir,f))).digest('hex')]));
 const beforeHashes=hashes();let main,other;
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=(code,w=main)=>w.webContents.executeJavaScript(code,true),get=(w=main)=>js('classroom.get().then(x=>x.state)',w),act=(a,w=main)=>js('classroom.action('+JSON.stringify(a)+')',w),file=(a,w=main)=>js('classroom.file('+JSON.stringify(a)+')',w);
 const event=(w=main)=>({sender:w.webContents,senderFrame:w.webContents.mainFrame});
 const invoke=(channel,request,w=main)=>handlers.get(channel)(event(w),request);
 const disk=()=>fs.readFileSync(path.join(data,'classroom-v2.json'),'utf8');
 async function until(fn,label='load'){for(let i=0;i<300;i++){if(await fn())return;await wait(20);}throw Error('Timed out '+label);}
 async function reset(){fault.response=false;fault.receipt=false;fault.beforeReceipt=null;await js('classroom.file('+JSON.stringify({command:'restore-apply',state:Core.createInitialState()})+')');}
 async function check(name,run){const c={name};try{await run(c);c.status='passed';console.log('PASS_RECEIPT '+name);}catch(e){c.status='failed';c.error=e.stack;console.log('FAIL_RECEIPT '+name+': '+e.message);}checks.push(c);}
 function report(){return {syntheticOnly:true,platform:process.platform,windowsExecuted:false,scope:'Independent review of new action receipt recovery using real Electron IPC and captured real handlers',mainEntry,codeHashes:beforeHashes,currentCodeHashes:hashes(),data,checks,limits};}
 require(mainEntry);
 const timeout=setTimeout(()=>{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report(),null,2));app.exit(3);},75000);
 app.whenReady().then(async()=>{try{
  await until(async()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return main&&!main.webContents.isLoading();});await until(()=>js('!!window.classroom'));
  await js('classroom.window({command:"open",role:"pets"})');await until(async()=>{other=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='pets');return other&&!other.webContents.isLoading();});
  await check('Normal preload action has UUID, plain-state response and no transport data in save',async c=>{
   await reset();const s=await get(),result=await act({type:'score',ids:[s.students[0].id],delta:2});c.transportId=seen.at(-1).action._transportId;assert.match(c.transportId,/^[0-9a-f-]{36}$/);assert.equal(result.students[0].score,2);assert.equal(result.revision,s.revision+1);assert.deepEqual(result,await get());assert.deepEqual(JSON.parse(disk()),result);assert.ok(!disk().includes('_transportId'));assert.ok(!disk().includes(c.transportId));
  });
  await check('Single committed response loss returns success without a second action invocation',async c=>{
   await reset();const s=await get(),count=seen.length;fault.response=true;const result=await act({type:'score',ids:[s.students[0].id],delta:3});assert.equal(seen.length,count+1);assert.equal(result.students[0].score,3);assert.equal(result.revision,s.revision+1);assert.deepEqual(JSON.parse(disk()),result);c.delta=result.students[0].score;
  });
  await check('Recovery returns newest state after another renderer commits between failure and receipt',async c=>{
   await reset();const s=await get(),id=s.students[0].id;fault.response=true;fault.beforeReceipt=()=>invoke('state:action',{type:'score',ids:[id],delta:5},other);const result=await act({type:'score',ids:[id],delta:3});assert.equal(result.students[0].score,8);assert.equal(result.revision,s.revision+2);assert.deepEqual(result,await get());c.returnedScore=8;
  });
  await check('Notification exception after durable save is recovered without repeating the commit',async()=>{
   await reset();const s=await get(),send=main.webContents.send.bind(main.webContents);let armed=true;main.webContents.send=(channel,...args)=>{if(channel==='state:changed'&&armed){armed=false;throw Error('SYNTHETIC_NOTIFY_FAILURE');}return send(channel,...args);};try{const result=await act({type:'score',ids:[s.students[0].id],delta:3});assert.equal(armed,false);assert.equal(result.students[0].score,3);assert.equal(result.revision,s.revision+1);assert.deepEqual(result,JSON.parse(disk()));}finally{main.webContents.send=send;}
  });
  await check('Validation rejection remains rejection and records no successful receipt',async()=>{
   await reset();const s=await get(),bytes=disk();await assert.rejects(act({type:'score',ids:['missing'],delta:3}));assert.deepEqual(await get(),s);assert.equal(disk(),bytes);assert.deepEqual(invoke('state:receipt',{transportId:seen.at(-1).action._transportId}),{known:true,committed:false});
  });
  await check('Disk failure is not classified as commit, and later user retry applies once',async()=>{
   await reset();const s=await get(),bytes=disk(),tmp=path.join(data,'classroom-v2.json.tmp'),a={type:'score',ids:[s.students[0].id],delta:3};fs.mkdirSync(tmp);try{await assert.rejects(act(a));assert.deepEqual(await get(),s);assert.equal(disk(),bytes);assert.equal(invoke('state:receipt',{transportId:seen.at(-1).action._transportId}).committed,false);}finally{fs.rmdirSync(tmp);}const result=await act(a);assert.equal(result.students[0].score,3);assert.equal(result.revision,s.revision+1);
  });
  await check('Same renderer replay is inert; changed payload rejects; another renderer cannot inspect it',async()=>{
   await reset();const s=await get(),a={type:'score',ids:[s.students[0].id],delta:3,_transportId:'independent_replay_receipt'};invoke('state:action',a);const saved=await get(),bytes=disk();assert.deepEqual(invoke('state:action',a),saved);assert.throws(()=>invoke('state:action',{...a,delta:4}),/不一致/);assert.equal(disk(),bytes);assert.deepEqual(invoke('state:receipt',{transportId:a._transportId},other),{known:false,committed:false});invoke('state:action',a,other);assert.equal((await get()).students[0].score,6);
  });
  await check('Locked actions and replay are rejected; receipt remains an inert existing read',async()=>{
   await reset();const s=await get(),a={type:'score',ids:[s.students[0].id],delta:3,_transportId:'independent_lock_receipt'};invoke('state:action',a);invoke('lock:command',{command:'setup',pin:'1234',repeat:'1234'});invoke('lock:command',{command:'lock'});const locked=await get(),bytes=disk();assert.throws(()=>invoke('state:action',a),/锁定/);await assert.rejects(act({type:'score',ids:[s.students[0].id],delta:4}),/锁定/);assert.equal(invoke('state:receipt',{transportId:a._transportId}).committed,true);assert.deepEqual(await get(),locked);assert.equal(disk(),bytes);assert.equal(invoke('lock:command',{command:'unlock',pin:'1234'}).ok,true);
  });
  await check('Both handlers reject a forged subframe, unregistered owner, and real wrong-origin frame',async()=>{
   const state=await get(),request={transportId:'independent_lock_receipt'},a={type:'score',ids:[state.students[0].id],delta:3};
   for(const channel of ['state:action','state:receipt'])assert.throws(()=>handlers.get(channel)({...event(),senderFrame:{url:main.webContents.mainFrame.url}},channel==='state:action'?a:request),/窗口/);
   const rogue=new BrowserWindow({show:false,webPreferences:{offscreen:true,sandbox:true}});for(const channel of ['state:action','state:receipt'])assert.throws(()=>handlers.get(channel)(event(rogue),channel==='state:action'?a:request),/窗口/);rogue.destroy();
   const trusted=main.webContents.getURL();await main.loadURL('about:blank');for(const channel of ['state:action','state:receipt'])assert.throws(()=>invoke(channel,channel==='state:action'?a:request),/页面/);await main.loadURL(trusted);await until(()=>js('!!window.classroom'));assert.deepEqual(await get(),state);
  });
  await check('Known receipt survives reload of its existing webContents and stays owner-scoped',async()=>{
   await reset();const s=await get();await act({type:'score',ids:[s.students[0].id],delta:3});const a=seen.at(-1).action,owner=main.webContents;main.webContents.reload();await until(()=>!main.webContents.isLoading());await until(()=>js('!!window.classroom'));assert.equal(main.webContents,owner);assert.equal(invoke('state:receipt',{transportId:a._transportId}).committed,true);const current=await get();assert.deepEqual(invoke('state:action',a),current);assert.deepEqual(invoke('state:receipt',{transportId:a._transportId},other),{known:false,committed:false});
  });
  await check('All four selected file mutation responses recover once and retain state response shape',async c=>{
   c.commands=[];
   for(const command of ['import-apply','restore-apply','archive','blank']){
    await reset();const s=await get(),request={command,panelId:Core.panelId(s),expectedRevision:s.revision};
    if(command==='import-apply')Object.assign(request,{rows:[{name:'合成回执导入',group:'合成组'}],mode:'append'});
    if(command==='restore-apply'){request.state=Core.createInitialState();request.state.settings.className='合成回执恢复';}
    const n=fileSeen.length;fault.response='file';const result=await file(request);assert.equal(fileSeen.length,n+1);assert.equal(result.revision,s.revision+1);assert.deepEqual(result,await get());assert.deepEqual(result,JSON.parse(disk()));assert.equal(invoke('state:receipt',{transportId:fileSeen.at(-1).action._transportId}).committed,true);
    if(command==='import-apply')assert.equal(result.students.length,s.students.length+1);
    if(command==='restore-apply')assert.equal(result.settings.className,'合成回执恢复');
    if(command==='archive')assert.deepEqual(result.logs,[]);
    if(command==='blank')assert.deepEqual(result.students,[]);
    c.commands.push({command,revisionDelta:result.revision-s.revision});
   }
  });
  await check('Selected async file dispatcher records synchronous post-commit notification rejection',async()=>{
   await reset();const s=await get(),send=main.webContents.send.bind(main.webContents);let armed=true;main.webContents.send=(channel,...args)=>{if(channel==='state:changed'&&armed){armed=false;throw Error('SYNTHETIC_FILE_NOTIFY_FAILURE');}return send(channel,...args);};try{const result=await file({command:'import-apply',mode:'append',rows:[{name:'合成通知异常'}]});assert.equal(armed,false);assert.equal(result.students.length,s.students.length+1);assert.equal(result.revision,s.revision+1);assert.deepEqual(result,JSON.parse(disk()));}finally{main.webContents.send=send;}
  });
  await check('Selected file stale-confirmation and disk errors reject without false committed receipt',async()=>{
   await reset();const s=await get(),bytes=disk();await assert.rejects(file({command:'archive',expectedRevision:s.revision-1}),/变化/);assert.equal(invoke('state:receipt',{transportId:fileSeen.at(-1).action._transportId}).committed,false);assert.equal(disk(),bytes);
   const tmp=path.join(data,'classroom-v2.json.tmp');fs.mkdirSync(tmp);try{await assert.rejects(file({command:'import-apply',rows:[{name:'合成失败导入'}]}));assert.deepEqual(await get(),s);assert.equal(disk(),bytes);assert.equal(invoke('state:receipt',{transportId:fileSeen.at(-1).action._transportId}).committed,false);}finally{fs.rmdirSync(tmp);}
  });
  await check('Selected file replay cannot bypass lock or create another protected backup',async()=>{
   await reset();const s=await get(),request={command:'archive',_transportId:'independent_archive_receipt'};await invoke('file:command',request);const saved=await get(),backups=fs.readdirSync(data).filter(n=>n.startsWith('before-archive-')).sort();assert.deepEqual(await invoke('file:command',request),saved);assert.deepEqual(fs.readdirSync(data).filter(n=>n.startsWith('before-archive-')).sort(),backups);invoke('lock:command',{command:'lock'});assert.throws(()=>invoke('file:command',request),/锁定/);assert.deepEqual(await get(),saved);assert.equal(invoke('lock:command',{command:'unlock',pin:'1234'}).ok,true);assert.equal(saved.revision,s.revision+1);
  });
  await check('Lost action response plus failed receipt retains uncertain intent and retry resolves without mutation',async c=>{
   await reset();const s=await get(),a={type:'score',ids:[s.students[0].id],delta:3};fault.response=true;fault.receipt=true;await assert.rejects(act(a),/暂时无法确认/);c.afterReportedFailure=(await get()).students[0].score;const failed=seen.at(-1).action._transportId,n=seen.length;assert.equal(c.afterReportedFailure,3);assert.equal(invoke('state:receipt',{transportId:failed}).committed,true);await act(a);c.afterUserRetry=(await get()).students[0].score;assert.equal(c.afterUserRetry,3);assert.equal(seen.length,n);assert.equal(seen.at(-1).action._transportId,failed);
  });
  await check('Different command after uncertain committed action is blocked once instead of being silently applied',async()=>{
   await reset();const s=await get(),a={type:'score',ids:[s.students[0].id],delta:3};fault.response=true;fault.receipt=true;await assert.rejects(act(a),/暂时无法确认/);const n=seen.length;await assert.rejects(act({...a,delta:5}),/上一笔操作已保存/);assert.equal(seen.length,n);assert.equal((await get()).students[0].score,3);await act({...a,delta:5});assert.equal((await get()).students[0].score,8);
  });
  await check('Concurrent retries of uncertain committed action never submit another mutation',async()=>{
   await reset();const s=await get(),a={type:'score',ids:[s.students[0].id],delta:3};fault.response=true;fault.receipt=true;await assert.rejects(act(a),/暂时无法确认/);const n=seen.length;await js('Promise.all([classroom.action('+JSON.stringify(a)+'),classroom.action('+JSON.stringify(a)+')])');assert.equal(seen.length,n);assert.equal((await get()).students[0].score,3);
  });
  await check('Concurrent explicit retries of uncertain confirmed failure commit only one retry',async c=>{
   await reset();const s=await get(),a={type:'score',ids:[s.students[0].id],delta:3},tmp=path.join(data,'classroom-v2.json.tmp');fs.mkdirSync(tmp);fault.receipt=true;try{await assert.rejects(act(a),/暂时无法确认/);}finally{fs.rmdirSync(tmp);}assert.equal((await get()).students[0].score,0);const n=seen.length;await js('Promise.all([classroom.action('+JSON.stringify(a)+'),classroom.action('+JSON.stringify(a)+')])');c.retryMutationCalls=seen.length-n;c.score=(await get()).students[0].score;assert.equal(c.retryMutationCalls,1,'Two concurrent retry calls each created a fresh mutation');assert.equal(c.score,3);
  });
  await check('Retention boundary: a renderer can evict its unresolved receipt with 128 later actions',async c=>{
   await reset();const s=await get(),id=s.students[0].id,first={type:'score',ids:[id],delta:1,_transportId:'independent_eviction_000'};invoke('state:action',first);for(let i=1;i<=128;i++)invoke('state:action',{...first,_transportId:'independent_eviction_'+String(i).padStart(3,'0')});assert.equal(invoke('state:receipt',{transportId:first._transportId}).committed,false);c.savedScore=(await get()).students[0].score;assert.equal(c.savedScore,129);limits.push({kind:'bounded-retention',detail:'128 successful actions per webContents; oldest receipt returns committed:false after eviction. No timestamp or unresolved-action protection.'});
  });
  await check('Expired unresolved receipt blocks repeat and different mutations until explicit reload',async()=>{
   await reset();const s=await get(),a={type:'score',ids:[s.students[0].id],delta:3};fault.response=true;fault.receipt=true;await assert.rejects(act(a),/暂时无法确认/);for(let i=0;i<128;i++)invoke('state:action',{type:'settings',className:'合成回执淘汰'+i,_transportId:'independent_expired_'+i});const n=seen.length,saved=await get();await assert.rejects(act(a),/暂时无法确认/);await assert.rejects(file({command:'archive'}),/暂时无法确认/);assert.equal(seen.length,n);assert.deepEqual(await get(),saved);main.webContents.reload();await until(()=>!main.webContents.isLoading());await until(()=>js('!!window.classroom'));assert.deepEqual(await get(),saved);limits.push({kind:'intent-lifetime',detail:'Unknown outcome remains blocked in the existing preload; reload intentionally loses the pending intent and requires checking the saved classroom before a new action.'});
  });
  assert.deepEqual(hashes(),beforeHashes,'Product files changed while independent audit ran');
 }catch(e){checks.push({name:'harness setup',status:'failed',error:e.stack});console.error(e.stack);}finally{clearTimeout(timeout);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report(),null,2));console.log('SUMMARY_RECEIPT '+checks.filter(c=>c.status==='passed').length+' passed, '+checks.filter(c=>c.status==='failed').length+' failed, '+limits.length+' characterized limits');app.exit(checks.some(c=>c.status==='failed')?1:0);}});
}
