'use strict';
// Synthetic end-to-end regression. Runs the actual main process and sandboxed
// preload; only OS dialogs, shell opening, and a copy pause are instrumented.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'..'),entry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(repo,'src/main.cjs')),src=path.dirname(entry);
const out=path.resolve(process.env.FLOWER_FOLDER_UI_OUT||path.join(repo,'artifacts/rc15/folder-ui-'+(entry.includes('.asar/')?'packaged':'source')));
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function tree(root,{activeOnly=false}={}){const found={};function visit(directory){if(!fs.existsSync(directory))return;for(const item of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,item.name),relative=path.relative(root,file);if(activeOnly&&/^(?:数据[\\/])?(?:运行缓存|\.folder-pristine)/.test(relative))continue;if(item.isDirectory())visit(file);else if(item.isFile())found[relative]=digest(fs.readFileSync(file));}}visit(root);return found;}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value));}
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 (async()=>{
  const fingerprint=()=>entry.includes('.asar/')?{asar:digest(fs.readFileSync(entry.slice(0,entry.indexOf('.asar/')+5)))}:Object.fromEntries(['main.cjs','preload.cjs','app.js','folder-ui.js','folder-ui.css','folder-layout.cjs','folder-pristine.cjs','legacy-migration.cjs','storage.cjs','portable-config.cjs','score-rule-workbook.cjs'].map(name=>[name,digest(fs.readFileSync(path.join(src,name)))]));
  const startedAt=new Date().toISOString(),startHashes=fingerprint();
  const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'flower-rc15-folder-ui-')),template=path.join(fixture,'template'),legacy=path.join(fixture,'old-data'),resources=path.join(fixture,'old-program');
  const {prepareFolderResources}=require('./prepare-folder-resources.cjs');await prepareFolderResources({appOutDir:template});
  const C=require('../src/core.cjs'),W=require('../src/score-rule-workbook.cjs'),{legacyState}=require('../tests/pet-fixtures.cjs');
  let old=C.applyAction(legacyState(),{type:'pet.stage-rules',thresholds:[5,7,9,11,13,15]},4000000);
  old=C.applyAction(old,{type:'pet.growth',ids:[old.students[0].id],delta:65,reason:'合成迁移成长'},4000001);
  old=C.applyAction(old,{type:'pet.graduate',id:old.students[0].id},4000002);
  old.settings.className='合成迁移班 · 双面板';old.settings.scoreRules=[{id:'synthetic_rule',label:'合成自定义鼓励',delta:7,growthDelta:3,enabled:true}];
  old.panels={activeId:'synthetic_main_panel',others:[{id:'synthetic_other_panel',data:C.validateState(legacyState())}]};old=C.validateState(old);
  fs.mkdirSync(legacy);fs.cpSync(template,resources,{recursive:true});
  write(path.join(legacy,'classroom-v2.json'),old);write(path.join(legacy,'classroom-v2.enabled'),'format 2');write(path.join(legacy,'before-restore-synthetic.json'),old);
  write(path.join(legacy,'avatar-location-v2.json'),{version:2,directory:path.join(resources,'头像'),seededFiles:require('../assets/avatar-defaults/manifest.json').files.map(x=>x.fileName)});
  write(path.join(legacy,'customrules','synthetic-rule.json'),{reason:'合成课堂资料',points:7});write(path.join(legacy,'photos','synthetic-photo.png'),Buffer.from(require('../tests/pet-fixtures.cjs').SYNTHETIC_PNG.split(',')[1],'base64'));
  write(path.join(resources,'计分卡片.xlsx'),await W.buildBytes(old));require('../src/classroom-lock.cjs').createClassroomLock(legacy).setup('1357','1357');
  const sourceBefore={legacy:tree(legacy),resources:tree(resources)},results=[];
  for(const scenario of ['management','newer-window','same-id-restore','pending-close','pending-replace','commit','restart','config','bad-config']){
   const root=path.join(fixture,scenario==='restart'?'commit':scenario);if(scenario!=='restart')fs.cpSync(template,root,{recursive:true});
   if(scenario==='config')write(path.join(root,'配置.txt'),'initialZoom=1.5\nwindowWidth=1024\nwindowHeight=720\nstartMinimized=true\n');
   if(scenario==='bad-config'){write(path.join(root,'配置.txt'),'initialZoom=2\ninitialZoom=1\n');fs.cpSync(legacy,path.join(root,'数据'),{recursive:true});}
   const beforeBad=scenario==='bad-config'?tree(root,{activeOnly:true}):null;
   const result=require('node:child_process').spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:repo,encoding:'utf8',timeout:110000,maxBuffer:8*1024*1024,env:{...process.env,FLOWER_HEADLESS_TEST:scenario==='config'?'0':'1',FLOWER_EXTERNAL_RESOURCE_DIR:root,FLOWER_DATA_DIR:'',FLOWER_FOLDER_ROOT:'',FLOWER_FOLDER_UI_OUT:out,FLOWER_FOLDER_UI_FIXTURE:fixture,FLOWER_FOLDER_UI_SCENARIO:scenario,FLOWER_MIGRATION_NO_RELAUNCH:'1',FLOWER_PACKAGE_MAIN:entry,XDG_CACHE_HOME:path.join(root,'数据','运行缓存','缓存')}});
   write(path.join(out,scenario+'.log'),(result.stdout||'')+(result.stderr||''));const reportFile=path.join(out,scenario+'.json'),report=fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile)):null;
   results.push({scenario,exitCode:result.status,error:result.error?.message,report});console.log('FOLDER_UI',scenario,result.status,report?.checks.filter(x=>x.status==='failed')||'no report');
   if(beforeBad)assert.deepEqual(tree(root,{activeOnly:true}),beforeBad,'Bad config launch must preserve every classroom, lock, resource, and config file');
  }
  const sourceUnchanged=JSON.stringify({legacy:tree(legacy),resources:tree(resources)})===JSON.stringify(sourceBefore);
  const endHashes=fingerprint();const codeUnchanged=JSON.stringify(startHashes)===JSON.stringify(endHashes);
  const report={entry,fixture,startedAt,finishedAt:new Date().toISOString(),startHashes,endHashes,codeUnchanged,results,sourceUnchanged,sourceBefore,sourceAfter:{legacy:tree(legacy),resources:tree(resources)},syntheticOnly:true,windowsExecuted:false,limits:['Linux Electron with headless Ozone; native Windows execution remains unverified','OS file dialogs and shell responses are synthetic','Minimized startup uses real Linux show/minimize hooks with synthetic layout, offscreen BrowserWindow, and single-instance test substitutions; no native desktop minimize claim','No specialist security tests were run']};write(path.join(out,'results.json'),report);process.exitCode=codeUnchanged&&sourceUnchanged&&results.every(x=>x.exitCode===0)?0:1;
 })().catch(error=>{console.error(error.stack);process.exitCode=2;});
}else{
 const {app,BrowserWindow,dialog,shell,ipcMain}=require('electron');app.disableHardwareAcceleration();
 const scenario=process.env.FLOWER_FOLDER_UI_SCENARIO,fixture=process.env.FLOWER_FOLDER_UI_FIXTURE,root=process.env.FLOWER_EXTERNAL_RESOURCE_DIR,legacy=path.join(fixture,'old-data'),resources=path.join(fixture,'old-program');
 require('./package-boundary.cjs')(entry,path.join(out,'dependency-boundary-'+scenario+'.json'));
 const checks=[],errors=[],opened=[],dialogs=[],commands=[],nativeHooks=[],screenshots=[];let main,finished=false,chosen=legacy,shellResult='',copyGate=null,copyEntered=false;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const nativeExit=app.exit.bind(app);function finish(code){if(finished)return;finished=true;write(path.join(out,scenario+'.json'),{scenario,entry,root,checks,errors,opened,dialogs,commands,nativeHooks,screenshots,syntheticOnly:true,windowsExecuted:false});nativeExit(code??(errors.length||checks.some(x=>x.status==='failed')?1:0));}
 const check=async(name,fn)=>{try{await fn();checks.push({name,status:'passed'});console.log('PASS',name);}catch(error){checks.push({name,status:'failed',error:String(error.stack||error)});console.error('FAIL',name,error.message);}};
 const js=(code,win=main)=>win.webContents.executeJavaScript(code,true),get=win=>js('classroom.get()',win),file=(request,win)=>js('classroom.file('+JSON.stringify(request)+')',win),act=(request,win)=>js('classroom.action('+JSON.stringify(request)+')',win);
 async function until(test,label,ms=9000){const start=Date.now();while(Date.now()-start<ms){try{if(await test())return;}catch{}await wait(30);}throw Error('Timed out: '+label);}
 const visible=selector=>js('!!document.querySelector('+JSON.stringify(selector)+')');
 async function click(selector){await until(()=>visible(selector),'find '+selector);await js(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(el.disabled)throw Error('Disabled '+${JSON.stringify(selector)});el.scrollIntoView({block:'center'});el.focus();el.click();return true})()`);await wait(60);}
 async function capture(name){await wait(140);const file=path.join(out,name+'.png');fs.writeFileSync(file,(await main.webContents.capturePage()).toPNG());screenshots.push(file);}
 async function management(){await click('[data-page="settings"]');await click('[data-do="folder-manage"]');await until(()=>visible('.folder-management-dialog'),'management');}
 async function preview(){await click('[data-do="folder-migrate"]');await until(()=>visible('[data-do="folder-migration-confirm"]'),'confirmation');}
 const status=()=>js('document.querySelector(".folder-operation-status")?.textContent||""');
 const activeTree=()=>tree(path.join(root,'数据'),{activeOnly:true});
 const originalOpen=dialog.showOpenDialog;dialog.showOpenDialog=async(...args)=>{dialogs.push(args.at(-1));return chosen?{canceled:false,filePaths:[chosen]}:{canceled:true,filePaths:[]};};
 dialog.showSaveDialog=async(...args)=>{dialogs.push(args.at(-1));return {canceled:true,filePath:''};};
 dialog.showMessageBox=async(...args)=>{dialogs.push(args.at(-1));return {response:1};};dialog.showErrorBox=(title,message)=>dialogs.push({title,message});
 shell.openPath=async file=>{opened.push(file);return shellResult;};
 const originalCopy=fs.promises.copyFile.bind(fs.promises);fs.promises.copyFile=async(...args)=>{if(copyGate&&String(args[0]).startsWith(legacy+path.sep)){copyEntered=true;const pending=copyGate;copyGate=null;await pending;}return originalCopy(...args);};
 const originalHandle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(channel,handler)=>originalHandle(channel,async(event,request,...rest)=>{const logged={channel,command:request?.command||request?.type||'',owner:BrowserWindow.fromWebContents(event.sender)?.flowerRole};if(channel==='file:command')commands.push(logged);try{const result=await handler(event,request,...rest);if(request?.command?.startsWith('legacy-migration-'))logged.result=result;return result;}catch(error){logged.error=error.message;throw error;}});
 if(scenario==='config'){
  app.requestSingleInstanceLock=()=>true; // Synthetic single process; sandbox disallows singleton socket.
  const ConfigWindow=new Proxy(BrowserWindow,{construct(target,[options]){nativeHooks.push({method:'construct',width:options.width,height:options.height});return new target({...options,webPreferences:{...options.webPreferences,offscreen:true}});}});
  const Module=require('node:module'),load=Module._load,electron=require('electron');
  const instrumented=new Proxy(electron,{get(target,key){return key==='BrowserWindow'?ConfigWindow:Reflect.get(target,key);}});
  Module._load=function(request,parent,...rest){return request==='electron'&&parent?.filename===entry?instrumented:load.call(this,request,parent,...rest);};
  // Keep main.cjs and its non-headless ready-to-show branch unchanged. Only
  // supply the synthetic root to the existing startup-layout function.
  const layout=require(path.join(src,'folder-layout.cjs')),bootstrap=layout.bootstrapFolderApp;
  layout.bootstrapFolderApp=options=>bootstrap({...options,env:{...process.env,FLOWER_HEADLESS_TEST:'1'}});
  for(const method of ['show','minimize']){const original=BrowserWindow.prototype[method];BrowserWindow.prototype[method]=function(...args){nativeHooks.push({method,role:this.flowerRole});return original.apply(this,args);};}
 }
 if(scenario==='bad-config'){
  const originalError=console.error;console.error=(...args)=>{errors.push(args.map(String).join(' '));originalError(...args);};
  app.exit=code=>{checks.push({name:'Malformed config blocks before creating a window',status:code===1&&BrowserWindow.getAllWindows().length===0?'passed':'failed'});checks.push({name:'Malformed config reports duplicate setting and preserved data',status:errors.some(x=>/重复/.test(x)&&/没有被重置/.test(x))?'passed':'failed'});const captured=[...errors];errors.length=0;dialogs.push({startupErrors:captured});finish();};
 }
 process.on('unhandledRejection',error=>{errors.push(String(error.stack||error));});process.on('uncaughtException',error=>{errors.push(String(error.stack||error));finish(2);});
 try{require(entry);}catch(error){errors.push(String(error.stack||error));finish(2);}
 app.whenReady().then(async()=>{if(scenario==='bad-config')return;try{
  await until(async()=>{main=BrowserWindow.getAllWindows().find(x=>x.flowerRole==='main');return main&&!main.webContents.isLoading()&&await js('!!document.querySelector("[data-page=settings]")');},'real renderer startup',30000);
  if(scenario==='config'){
   await check('Configured dimensions reach BrowserWindow and actual renderer zoom is applied',async()=>{assert.equal(main.webContents.getZoomFactor(),1.5);const b=nativeHooks.find(x=>x.method==='construct');assert.equal(b.width,1024);assert.equal(b.height,720);nativeHooks.push({method:'actualBounds',bounds:main.getBounds()});});
   await check('Configured minimized startup reaches real show/minimize hooks',async()=>{await until(()=>nativeHooks.some(x=>x.method==='minimize'&&x.role==='main'),'minimize hook');assert.deepEqual(nativeHooks.filter(x=>x.role==='main').map(x=>x.method).slice(0,2),['show','minimize']);});return finish();
  }
  if(scenario==='restart'){
   await check('Restart retains the configured original classroom password',async()=>{const result=await js('classroom.lock({command:"status"})');assert.equal(result.configured,true);assert.equal(result.locked,true);const unlock=await js('classroom.lock({command:"unlock",pin:"1357"})');assert.equal(unlock.ok,true);});
   await check('Restart restores the complete migrated state exactly',async()=>{const expected=require(path.join(src,'core.cjs')).validateState(JSON.parse(fs.readFileSync(path.join(legacy,'classroom-v2.json'))));assert.deepEqual((await get()).state,expected);});
   await check('Restart exposes all 120 exact original avatar images',async()=>{const list=await file({command:'avatars-list'});assert.equal(list.items.length,120);assert.deepEqual(tree(path.join(root,'头像')),tree(path.join(resources,'头像')));});
   await check('Migrated workbook is bound to both panels and custom scoring rules',async()=>{const current=(await get()).state,W=require(path.join(src,'score-rule-workbook.cjs'));const parsed=await W.parseBytes(fs.readFileSync(path.join(root,'计分卡片.xlsx')),current);assert.equal(parsed.length,2);assert.ok(JSON.stringify(parsed).includes('合成自定义鼓励'));});
   await check('Restart closes migration eligibility after real classroom import',async()=>assert.equal((await file({command:'folder-info'})).migrationEligible,false));return finish();
  }
  const initial=(await get()).state;main.setBounds({x:0,y:0,width:1280,height:1040});await management();await file({command:'avatar-folder-info'});let before=activeTree();
  if(scenario==='management'){
   await check('Settings opens management with complete selectable locations',async()=>{const fields=await js('[...document.querySelectorAll(".folder-location input")].map(x=>({value:x.value,readOnly:x.readOnly,type:x.type}))');assert.equal(fields.length,5);for(const suffix of ['', '头像','数据','备份','计分卡片.xlsx'])assert.ok(fields.some(x=>x.value===path.join(root,suffix)&&x.readOnly&&x.type==='text'));await js('document.querySelector(".folder-location input").select()');assert.equal(await js('document.querySelector(".folder-location input").selectionEnd'),root.length);});
   await capture('01-folder-management');
   await check('Every folder/config opener uses its displayed absolute path',async()=>{for(const [action,target]of [['folder-root',root],['folder-data',path.join(root,'数据')],['folder-backups',path.join(root,'备份')],['folder-avatars',path.join(root,'头像')],['folder-config',path.join(root,'配置.txt')]]){await click('[data-do="'+action+'"]');assert.equal(opened.at(-1),target);assert.match(await status(),/已打开/);}});
   await check('Shell failure shows useful error without stale success claim',async()=>{shellResult='synthetic no association';await click('[data-do="folder-config"]');assert.match(await status(),/无法打开/);assert.doesNotMatch(await status(),/已打开/);shellResult='';});
   before=activeTree();
   await check('Canceled directory chooser preserves management and class',async()=>{chosen=null;await click('[data-do="folder-migrate"]');chosen=legacy;assert.equal(await visible('[data-do="folder-migration-confirm"]'),false);assert.deepEqual((await get()).state,initial);assert.deepEqual(activeTree(),before);chosen=legacy;});
   await preview();await capture('02-migration-confirmation');
   await check('Confirmation identifies source destination resources and original lock',async()=>{const text=await js('document.querySelector(".dialog-content").innerText');assert.match(text,/2 个面板/);assert.match(text,/8 位学生/);assert.match(text,/2 张已存头像/);assert.match(text,/一并保留/);const paths=await js('[...document.querySelectorAll(".folder-location input")].map(x=>x.value)');for(const p of [legacy,path.join(root,'数据'),path.join(resources,'头像'),path.join(resources,'头像-初始化-v2.txt'),path.join(resources,'计分卡片.xlsx')])assert.ok(paths.includes(p));});
   await check('Confirmation cancel discards preview and restores trigger focus',async()=>{await click('[data-do="folder-migration-cancel"]');await until(()=>js('!document.querySelector("#modal .dialog")'),'cancel closes');assert.equal(await js('document.activeElement?.dataset.do'),'folder-manage');assert.deepEqual(activeTree(),before);});
   await management();await preview();
   await check('Small window at 200% retains fixed close header and keyboard focus',async()=>{main.setMinimumSize(400,300);main.setBounds({x:0,y:0,width:900,height:640});main.webContents.setZoomFactor(2);await wait(150);const box=()=>js('(()=>{const c=document.querySelector(".modal-close").getBoundingClientRect(),h=document.querySelector(".dialog-header").getBoundingClientRect();return {x:c.x,y:c.y,right:c.right,bottom:c.bottom,headerY:h.y,w:innerWidth,h:innerHeight}})()');const one=await box();await js('document.querySelector(".dialog-content").scrollTop=10000');await wait(70);const two=await box();assert.equal(two.headerY,one.headerY);assert.ok(two.x>=0&&two.y>=0&&two.right<=two.w&&two.bottom<=two.h);await js('document.querySelector(".modal-close").focus()');main.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab',modifiers:['shift']});main.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab',modifiers:['shift']});await wait(40);assert.equal(await js('document.querySelector("#modal .dialog").contains(document.activeElement)'),true);await capture('03-confirmation-200pct');main.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});main.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await until(()=>js('!document.querySelector("#modal .dialog")'),'Escape closes');assert.equal(await js('document.activeElement?.dataset.do'),'folder-manage');assert.deepEqual(activeTree(),before);});
   await check('Cancellation creates no committed migration receipt',async()=>assert.equal(fs.existsSync(path.join(root,'数据','legacy-migration-receipt-v1.json')),false));return finish();
  }
  await preview();
  if(scenario==='newer-window'||scenario==='same-id-restore'){
   await file({command:'folder-info'});await js('classroom.window({command:"open",role:"panel"})');let second;await until(async()=>{second=BrowserWindow.getAllWindows().find(x=>x.flowerRole==='panel');return second&&!second.webContents.isLoading()&&await js('typeof classroom!=="undefined"',second);},'second window');
   if(scenario==='newer-window')await act({type:'settings',className:'来自第二窗口的新课堂名'},second);else await file({command:'restore-apply',state:initial,expectedRevision:initial.revision},second);
   const changed=(await get()).state,changedFiles=activeTree();await click('[data-do="folder-migration-confirm"]');
   await check(scenario==='newer-window'?'Newer second-window changes invalidate explicit migration confirmation':'Same-ID restore invalidates explicit migration confirmation',async()=>{await until(async()=>/变化|过期|恢复|失效/.test((await status())+await js('document.querySelector("#toast").textContent')),'stale message');assert.deepEqual((await get()).state,changed);assert.deepEqual(activeTree(),changedFiles);assert.equal(fs.existsSync(path.join(root,'数据','legacy-migration-receipt-v1.json')),false);assert.doesNotMatch(await status(),/复制完成/);});return finish();
  }
  if(scenario==='pending-close'||scenario==='pending-replace'){
   let release;copyGate=new Promise(resolve=>{release=resolve;});await click('[data-do="folder-migration-confirm"]');await until(()=>copyEntered,'async copy entered');if(scenario==='pending-replace'){main.webContents.send('ui:command','panel-create');await until(()=>visible('#panel-create-form'),'replacement dialog');}else await click('[data-do="modal-close"]');release();
   await check((scenario==='pending-replace'?'Replacing a dialog':'Close')+' during asynchronous prepare cancels without a late commit',async()=>{await until(()=>commands.some(x=>x.command==='legacy-migration-apply'&&x.error),'copy cancellation reply');assert.equal(await visible('#modal .dialog'),scenario==='pending-replace');if(scenario==='pending-replace')assert.equal(await visible('#panel-create-form'),true);assert.deepEqual((await get()).state,initial);assert.deepEqual(activeTree(),before);assert.equal(fs.existsSync(path.join(root,'数据','legacy-migration-receipt-v1.json')),false);await until(()=>!fs.readdirSync(path.join(root,'备份')).some(x=>x.startsWith('.legacy-migration-')),'staging cleanup');});return finish();
  }
  if(scenario==='commit'){
   await js('(()=>{const b=document.querySelector("[data-do=folder-migration-confirm]");b.click();b.click();})()');await until(()=>commands.some(x=>x.command==='legacy-migration-apply'&&(x.result?.migrated||x.error)),'migration outcome',30000);
   await check('Double-click commits once with a successful durable migration response',async()=>{const applied=commands.filter(x=>x.command==='legacy-migration-apply');assert.equal(applied.length,1);assert.equal(applied[0].result?.migrated,true,applied[0].error);assert.equal(applied[0].result.restartRequired,true);assert.match(await status(),/复制完成/);const receipt=JSON.parse(fs.readFileSync(path.join(root,'数据','legacy-migration-receipt-v1.json')));assert.ok(receipt);assert.equal(fs.readdirSync(path.join(root,'备份')).filter(x=>x.startsWith('旧版迁移-')).length,1);});
   await check('Committed active file preserves exact state and original password file',async()=>{assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'数据','classroom-v2.json'))),JSON.parse(fs.readFileSync(path.join(legacy,'classroom-v2.json'))));assert.equal(digest(fs.readFileSync(path.join(root,'数据','classroom-lock.json'))),digest(fs.readFileSync(path.join(legacy,'classroom-lock.json'))));});
   await check('Original custom-rule and photo resources remain archived intact',async()=>{const archive=commands.find(x=>x.command==='legacy-migration-apply').result.archiveDirectory;assert.deepEqual(tree(path.join(archive,'旧版数据')),tree(legacy));});
   await check('Post-commit reads are gated pending an actual restart',async()=>{await assert.rejects(()=>get(),/重新启动|迁移已完成/);const committedFiles=activeTree();await assert.rejects(()=>act({type:'settings',className:'must never save'}),/重新启动|迁移|暂时无法确认/);assert.deepEqual(activeTree(),committedFiles);});return finish();
  }
 }catch(error){errors.push(String(error.stack||error));finish(2);}});
 setTimeout(()=>{errors.push('Harness timeout');finish(3);},90000);
}
