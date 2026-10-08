'use strict';
// Synthetic-only rendered Electron journeys. Controls use real pointer/keyboard
// input; direct API calls are reserved for concurrent-window/restore fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {ensureToolControl,visibleControl,nativeClick}=require('./qa-tool-control.cjs');
const root=path.resolve(__dirname,'..'),suffix=process.env.FLOWER_PACKAGE_MAIN?'-packaged':'',out=path.join(root,'artifacts/qa-group-create-assign-rc19'+suffix),dir=path.join(root,'.qa-group-create-assign-rc19'+suffix),mainEntry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs'));
const phase=process.argv.includes('--restart')?'restart':'journeys';
const hashes=()=>Object.fromEntries(['group-tools.js','group-tools-ui.js','group-tools.css','core.cjs','app.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src',name))).digest('hex')]));
if(!process.versions.electron){
 fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(out,{recursive:true});
 for(const filename of fs.readdirSync(out))if(/^failure-\d+\.png$/.test(filename))fs.unlinkSync(path.join(out,filename));
 const before=hashes(),results=[],{spawnSync}=require('node:child_process');
 for(const args of [[],['--restart']]){
  const result=spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename,...args],{cwd:root,env:{...process.env,FLOWER_HEADLESS_TEST:'1',FLOWER_DATA_DIR:dir,ELECTRON_CACHE:'/tmp/flower-group-rc19-electron-cache',XDG_CACHE_HOME:'/tmp/flower-group-rc19-cache'},encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
  const name=args.length?'restart':'journeys';process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');fs.writeFileSync(path.join(out,name+'.log'),(result.stdout||'')+(result.stderr||''));
  const filename=path.join(out,name+'.json');results.push({phase:name,exitCode:result.status,error:result.error?.message,report:fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename)):null});if(result.status!==0)break;
 }
 const after=hashes();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({syntheticOnly:true,mainEntry,createdAt:new Date().toISOString(),sourceAtStart:before,sourceAtFinish:after,sourceChanged:JSON.stringify(before)!==JSON.stringify(after),results},null,2));process.exitCode=results.some(r=>r.exitCode!==0)?1:0;
}else{
 const {app,BrowserWindow}=require('electron');require('./package-boundary.cjs')(mainEntry,path.join(out,'dependency-boundary-'+phase+'.json'));const appRequire=require('node:module').createRequire(mainEntry),Core=appRequire('./core.cjs');app.disableHardwareAcceleration();
 if(phase==='journeys'){
  // A frozen synthetic RC18 archive carries real historical graduation records.
  // Loading it exercises migration without invoking retired growth controls.
  const s=Core.validateState(require('../tests/fixtures/group-history-rc19.json'));
  fs.writeFileSync(path.join(dir,'classroom-v2.json'),JSON.stringify(s));
 }
 require(mainEntry);
 let win;const checks=[],errors=[],sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const js=code=>win.webContents.executeJavaScript(code,true),get=()=>js('classroom.get().then(r=>r.state)'),act=a=>js('classroom.action('+JSON.stringify(a)+')');
 async function until(fn,label){for(let i=0;i<180;i++){if(await fn())return;await sleep(30);}throw Error('Timed out: '+label);}
 async function click(selector){selector=await ensureToolControl(win,selector);await nativeClick(win,await visibleControl(win,selector));}
 async function key(keyCode,modifiers=[]){win.focus();win.webContents.focus();win.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});if(keyCode==='Enter')win.webContents.sendInputEvent({type:'char',keyCode:'\r',modifiers});win.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await sleep(25);}
 async function type(selector,text){await click(selector);await key('A',['control']);await win.webContents.insertText(text);await sleep(30);}
 async function shot(name){await sleep(80);fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());}
 const checked=()=>js('[...document.querySelectorAll("#bulk-group-form [name=student]:checked")].map(e=>e.value)');
 async function close(){if(await js('!!document.querySelector("#modal .dialog")'))await click('#modal [data-do=modal-close]');}
 async function open(){await close();await click('[data-do=bulk-group]');await until(()=>js('!!document.querySelector("#bulk-group-form")'),'assignment form');}
 async function fresh(name){await open();await click('[data-do=gt-new-target]');await type('[name=newGroup]',name);}
 async function check(name,fn){try{await fn();checks.push({name,status:'passed'});console.log('PASS_RC19_GROUP',name);}catch(error){checks.push({name,status:'failed',error:error.stack});console.error('FAIL_RC19_GROUP',name,error.stack);try{await shot('failure-'+checks.length);await close();}catch{}}}
 const stable=s=>s.students.map(({group,...v})=>v);
 app.whenReady().then(async()=>{
  await until(async()=>{win=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return win&&!win.webContents.isLoading();},'main');
  win.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  await until(()=>js('typeof GroupToolsUI!=="undefined"&&!!document.querySelector("[data-page=students]")'),'renderer');
  if(phase==='restart'){
   await check('A new Electron process restores the entire committed classroom including the newly created groups and assignments',async()=>assert.deepEqual(await get(),JSON.parse(fs.readFileSync(path.join(out,'expected-restart.json')))));
  }else{
   const initial=await get(),ids=initial.students.slice(0,2).map(v=>v.id),panelId=Core.panelId(initial);
   await check('Teacher selects two student cards and opens bulk assignment; the new-group control is directly visible',async()=>{
    await click('[data-page=students]');for(const id of ids)await click('[data-student="'+id+'"] h3');await open();
    assert.deepEqual(await checked(),ids);assert.match(await js('document.querySelector(".gt-selected-count").textContent'),/2 \/ 12/);
    assert.ok(await visibleControl(win,'[data-do=gt-new-target]'));await shot('01-existing-target-new-group-entry');
   });
   await check('Switching between new and existing target keeps all selected students and typed name; cancel creates nothing',async()=>{
    const before=await get();await click('[data-do=gt-new-target]');assert.equal(await js('document.activeElement.name'),'newGroup');await type('[name=newGroup]','取消的合成小组');
    await click('[data-do=gt-new-target]');assert.deepEqual(await checked(),ids);await click('[data-do=gt-new-target]');assert.equal(await js('document.querySelector("[name=newGroup]").value'),'取消的合成小组');assert.deepEqual(await checked(),ids);
    await close();assert.deepEqual(await get(),before);
   });
   await check('Blank, whitespace and duplicate names cannot save; inline duplicate message is accessible and preserves selection',async()=>{
    const before=await get();await open();await click('[data-do=gt-new-target]');assert.equal(await js('document.querySelector("#bulk-group-form [type=submit]").disabled'),true);
    await type('[name=newGroup]','   ');assert.equal(await js('document.querySelector("#bulk-group-form [type=submit]").disabled'),true);
    await type('[name=newGroup]',' 合成向日葵组 ');assert.match(await js('document.querySelector(".gt-name-error").textContent'),/同名/);assert.equal(await js('document.querySelector("[name=newGroup]").getAttribute("aria-invalid")'),'true');assert.deepEqual(await checked(),ids);
    await key('Enter');assert.deepEqual(await get(),before);await shot('02-duplicate-name-validation');await close();
   });
   await check('One native Save creates and assigns both students atomically; rapid repeat clicks yield one revision and preserve pet history',async()=>{
    const before=await get();await fresh('合成新建向阳组');assert.deepEqual(await checked(),ids);await shot('03-create-and-assign-two-of-twelve');
    const control=await visibleControl(win,'#bulk-group-form [type=submit]');for(let i=0;i<2;i++)for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,x:Math.floor(control.x),y:Math.floor(control.y),button:'left',clickCount:1});
    await until(()=>js('!document.querySelector("#bulk-group-form")'),'save closes modal');const after=await get();assert.equal(after.revision,before.revision+1);assert.equal(after.groupBases.filter(v=>v.group==='合成新建向阳组').length,1);assert.ok(after.students.filter(v=>ids.includes(v.id)).every(v=>v.group==='合成新建向阳组'));
    assert.deepEqual(stable(after),stable(before));for(const k of ['logs','petAccounts','petLogs','groupLogs'])assert.deepEqual(after[k],before[k]);assert.ok(after.petAccounts[0].graduations.length);await shot('04-assigned-students-result');
   });
   await check('A failed disk save leaves no phantom group, retains the name and chosen students, and a native retry commits once',async()=>{
    await fresh('合成失败重试组');const before=await get(),temp=path.join(dir,'classroom-v2.json.tmp');fs.mkdirSync(temp);
    try{await click('#bulk-group-form [type=submit]');await until(()=>js('!!document.querySelector("#bulk-group-form")&&!document.querySelector("#bulk-group-form").dataset.saving'),'failed save releases controls');assert.deepEqual(await get(),before);assert.deepEqual(await checked(),ids);assert.equal(await js('document.querySelector("[name=newGroup]").value'),'合成失败重试组');}finally{fs.rmdirSync(temp);}
    await click('#bulk-group-form [type=submit]');await until(()=>js('!document.querySelector("#bulk-group-form")'),'retry closes');assert.equal((await get()).revision,before.revision+1);
   });
   await check('Concurrent score updates keep selection and name usable; the create transaction retains the latest scores and logs',async()=>{
    await fresh('合成实时积分组');const before=await get();await act({type:'score',ids:[ids[0]],delta:3,reason:'合成另一窗口加分',panelId});await until(()=>js('document.querySelector("#bulk-group-form [name=student]").closest("label").querySelector("b").textContent==='+JSON.stringify((before.students[0].score+3)+' 分')),'live score');
    assert.deepEqual(await checked(),ids);assert.equal(await js('document.querySelector("[name=newGroup]").value'),'合成实时积分组');assert.equal(await js('document.querySelector(".gt-stale").hidden'),true);const latest=await get();await click('#bulk-group-form [type=submit]');await until(()=>js('!document.querySelector("#bulk-group-form")'),'score flow saved');assert.deepEqual(stable(await get()),stable(latest));assert.deepEqual((await get()).logs,latest.logs);
   });
   await check('Concurrent reassignment invalidates the draft and cannot create a phantom group',async()=>{
    await fresh('不应创建的过期组');await act({type:'students.group',ids:[ids[0]],group:'合成向日葵组',panelId});await until(()=>js('!document.querySelector(".gt-stale").hidden'),'stale warning');assert.equal(await js('document.querySelector("#bulk-group-form [type=submit]").disabled'),true);const before=await get();await key('Enter');assert.deepEqual(await get(),before);assert.equal(before.groupBases.some(v=>v.group==='不应创建的过期组'),false);await close();
   });
   await check('A concurrently created duplicate group makes the draft stale and does not move students',async()=>{
    await fresh('合成并发同名组');await act({type:'group.create',group:'合成并发同名组',panelId});await until(()=>js('!document.querySelector(".gt-stale").hidden'),'duplicate invalidation');const before=await get();assert.equal(await js('document.querySelector("#bulk-group-form [type=submit]").disabled'),true);await key('Enter');assert.deepEqual(await get(),before);await close();
   });
   await check('Panel navigation closes the old draft; switching back does not create the typed group or reassign students',async()=>{
    await fresh('不应创建的旧面板组');const before=await get();await act({type:'panel.create',mode:'blank',name:'合成第二面板'});await until(()=>js('!document.querySelector("#bulk-group-form")'),'panel closes draft');await act({type:'panel.switch',id:panelId});const after=await get();assert.deepEqual(after.students,before.students);assert.deepEqual(after.groupBases,before.groupBases);
   });
   await check('Restoring the same IDs/groups still invalidates the old create draft and blocks stale IPC requests by restore epoch',async()=>{
    await open();for(const id of ids)await click('#bulk-group-form [name=student][value="'+id+'"]');await click('[data-do=gt-new-target]');await type('[name=newGroup]','不应创建的恢复前小组');const before=await get(),epoch=await js('classroom.get().then(r=>r.restoreGeneration)');
    await js('classroom.file('+JSON.stringify({command:'restore-apply',state:before})+')');await until(()=>js('!!document.querySelector(".dialog-stale-notice")'),'restore draft notice');const restored=await get();await key('Enter');assert.deepEqual(await get(),restored);
    const rejection=await js('classroom.action('+JSON.stringify({type:'students.group.create',ids,expectedAssignments:before.students.filter(v=>ids.includes(v.id)).map(({id,group})=>({id,group})),group:'不应创建的恢复前小组',panelId,expectedRestoreGeneration:epoch})+').then(()=>"unexpected",e=>e.message)');assert.match(rejection,/备份已恢复/);assert.deepEqual(await get(),restored);await shot('05-restore-invalidates-draft');await close();
   });
   await check('At 360×420, keyboard users can open inline creation, type a name, tab to selected students and Save without horizontal overflow',async()=>{
    await until(()=>js('!document.querySelector("#toast").classList.contains("show")'),'prior restore feedback clears');win.setMinimumSize(240,360);win.setSize(360,420);await until(()=>js('innerWidth===360&&innerHeight===420'),'short viewport');await open();
    await js('document.querySelector("[data-do=gt-new-target]").focus()');await key('Enter');assert.equal(await js('document.activeElement.name'),'newGroup');await win.webContents.insertText('合成窄窗键盘组');await key('Tab');await key('Tab');await key('Tab');assert.equal(await js('document.activeElement.name'),'student');await key('Space');await key('Tab');await key('Space');assert.deepEqual(await checked(),ids);
    let reached=false;for(let i=0;i<20;i++){if(await js('document.activeElement.matches("#bulk-group-form [type=submit]")')){reached=true;break;}await key('Tab');}assert.equal(reached,true);
    const metrics=await js('(()=>{const dialog=document.querySelector("#modal .dialog"),b=document.activeElement.getBoundingClientRect();return {width:innerWidth,height:innerHeight,dialogWidth:dialog.clientWidth,dialogScrollWidth:dialog.scrollWidth,save:{left:b.left,right:b.right,top:b.top,bottom:b.bottom},overflow:[...dialog.querySelectorAll(".gt-target-tools,.gt-new-target,.gt-student-list,.gt-student-choice")].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className)}})()');
    assert.ok(metrics.dialogScrollWidth<=metrics.dialogWidth+1);assert.deepEqual(metrics.overflow,[]);assert.ok(metrics.save.left>=0&&metrics.save.right<=360&&metrics.save.top>=0&&metrics.save.bottom<=420);fs.writeFileSync(path.join(out,'short-viewport-metrics.json'),JSON.stringify(metrics,null,2));await shot('06-short-viewport-keyboard-save');const before=await get();await key('Enter');await until(()=>js('!document.querySelector("#bulk-group-form")'),'keyboard save');assert.equal((await get()).revision,before.revision+1);assert.ok((await get()).students.filter(v=>ids.includes(v.id)).every(v=>v.group==='合成窄窗键盘组'));
   });
   await check('Existing target assignment still works after using new-group mode',async()=>{
    win.setSize(1100,800);await until(()=>js('innerWidth===1100'),'normal viewport');await open();for(const id of ids)await click('#bulk-group-form [name=student][value="'+id+'"]');await click('[data-do=gt-new-target]');await type('[name=newGroup]','不应创建的切换组');await click('[data-do=gt-new-target]');
    await click('[name=group]');await key('Home');await key('Down');await key('Enter');const target=await js('document.querySelector("[name=group]").value');assert.ok(target);const before=await get();await click('#bulk-group-form [type=submit]');await until(()=>js('!document.querySelector("#bulk-group-form")'),'existing target save');const after=await get();assert.ok(after.students.filter(v=>ids.includes(v.id)).every(v=>v.group===target));assert.deepEqual(after.groupBases,before.groupBases);
   });
   assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'expected-restart.json'),JSON.stringify(await get()));
  }
  fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify({phase,checks,errors},null,2));app.exit(checks.some(c=>c.status==='failed')?1:0);
 }).catch(error=>{fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify({phase,checks,errors,error:error.stack},null,2));console.error(error.stack);app.exit(2);});
}
