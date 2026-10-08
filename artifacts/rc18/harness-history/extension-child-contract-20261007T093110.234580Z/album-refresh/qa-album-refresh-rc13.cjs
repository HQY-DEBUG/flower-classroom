'use strict';
// Ordinary read-only album UI regression checks against the real main/preload/
// renderer, with native keyboard input and synthetic classroom data only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),entry=process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs');
const out=path.resolve(process.env.ALBUM_AUDIT_OUT||path.join(root,'artifacts/rc13-album-refresh'));
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'flower-album-refresh-'));
 const r=require('node:child_process').spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,env:{...process.env,FLOWER_HEADLESS_TEST:'1',FLOWER_DATA_DIR:data,XDG_CACHE_HOME:'/tmp/flower-album-refresh-cache'},encoding:'utf8',timeout:150000,maxBuffer:8*1024*1024});
 fs.writeFileSync(path.join(out,'run.log'),(r.stdout||'')+(r.stderr||'')+(r.error?'\n'+r.error.stack:''));console.log((r.stdout||'').split('\n').filter(line=>/^(PASS|FAIL|FATAL|SUMMARY)/.test(line)).join('\n'));process.exitCode=r.status===0?0:1;
}else{
 const {app,BrowserWindow}=require('electron');app.disableHardwareAcceleration();
 require('./package-boundary.cjs')(entry,path.join(out,'dependency-boundary.json'));
 const src=path.dirname(entry),C=require(path.join(src,'core.cjs'));
 const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const files=['app.js','pet-progress.js','pet-art.js','pet-extra-ui.js','modal-shell.css','egg-pet.css'];
 const hashes=()=>Object.fromEntries(files.map(file=>[file,sha(path.join(src,file))]));const beforeHashes=hashes();
 let base=C.createInitialState();base.students=base.students.slice(0,3).map((s,i)=>({...s,id:'album_'+i,name:'合成相册同学'+i,group:'合成相册组',pet:'owl',score:0,growth:0,startFromEgg:true,photo:''}));base.settings.className='合成相册班';base=C.applyAction(base,{type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]});
 fs.writeFileSync(path.join(process.env.FLOWER_DATA_DIR,'classroom-v2.json'),JSON.stringify(base));
 const checks=[],errors=[],wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));let main,other;
 const js=(text,w=main)=>w.webContents.executeJavaScript(text,true),get=()=>js('classroom.get().then(result=>result.state)');
 const report=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({entry,syntheticOnly:true,platform:process.platform,windowsExecuted:false,beforeHashes,afterHashes:hashes(),checks,errors},null,2));
 async function until(fn){for(let i=0;i<250;i++){if(await fn())return;await wait(20);}throw Error('Timed out waiting for app state');}
 async function key(keyCode){main.focus();main.webContents.focus();for(const type of ['keyDown',...(keyCode==='Enter'?['char']:[]),'keyUp'])main.webContents.sendInputEvent({type,keyCode:type==='char'?'\r':keyCode});await wait(100);}
 async function click(selector){selector=await require('./qa-tool-control.cjs').ensureToolControl(main,selector);const p=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,h=document.elementFromPoint(x,y);return h===e||e.contains(h)?{x,y}:null;})()`);assert.ok(p,'Visible clickable target: '+selector);main.focus();main.webContents.focus();const scale=main.webContents.getZoomFactor();for(const type of ['mouseDown','mouseUp'])main.webContents.sendInputEvent({type,x:Math.floor(p.x*scale),y:Math.floor(p.y*scale),button:'left',clickCount:1});await wait(100);}
 const focus=selector=>js(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`);
 const focused=()=>js(`(()=>{const e=document.activeElement;return {tag:e.tagName,action:e.dataset.do||'',arrow:e.getAttribute('aria-label'),level:e.dataset.level||'',feedback:!!e.closest('#pet-feedback'),text:e.innerText};})()`);
 async function act(action){const latest=await js('classroom.action('+JSON.stringify(action)+')',other);await until(()=>js('state.revision>='+latest.revision));await wait(160);assert.deepEqual(await get(),JSON.parse(fs.readFileSync(path.join(process.env.FLOWER_DATA_DIR,'classroom-v2.json'))));return latest;}
 async function restore(state){await js('classroom.file('+JSON.stringify({command:'restore-apply',state})+')',other);await wait(200);}
 async function close(){for(let i=0;i<3;i++)if(await js('!!document.querySelector("#modal .dialog,#pet-feedback .pet-celebration")'))await key('Escape');}
 async function reset(state=base){await close();await restore(state);main.setContentSize(950,640);await click('[data-page=pets]');}
 const staged=(ids=['album_0'],delta=1)=>C.applyAction(base,{type:'pet.growth',ids,delta,reason:'合成相册测试'});
 const graduated=()=>C.applyAction(staged(['album_0'],30),{type:'pet.graduate',id:'album_0'});
 const album=()=>click('[data-do=pet-album][data-id=album_0]');
 const honors=id=>click('[data-do=pet-honors]'+(id?'[data-id='+id+']':''));
 const stats=()=>js('[...document.querySelectorAll(".honor-stats strong")].map(e=>e.innerText)');
 async function check(name,fn){try{await fn();checks.push({name,status:'passed'});console.log('PASS_ALBUM',name);}catch(e){checks.push({name,status:'failed',error:e.stack});console.log('FAIL_ALBUM',name,e.message);fs.writeFileSync(path.join(out,'failure-'+checks.length+'.png'),(await main.webContents.capturePage()).toPNG());}report();}
 app.on('web-contents-created',(_e,w)=>w.on('console-message',event=>{if(event.level==='error')errors.push(event.message);}));
 require(entry);const deadline=setTimeout(()=>{report();app.exit(3);},140000);
 app.whenReady().then(async()=>{try{
  await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return main&&!main.webContents.isLoading();});await until(()=>js('typeof state!=="undefined"&&!!state'));
  await js('classroom.window({command:"open",role:"pets"})');await until(()=>{other=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='pets');return other&&!other.webContents.isLoading();});await until(()=>js('typeof state!=="undefined"&&!!state',other));
  await check('Native repeated forward and backward Enter keeps the same arrow node and never writes state',async()=>{
   await reset();await album();const before=await get();await key('Tab');assert.equal((await focused()).arrow,'下一形态');await js('window.testArrow=document.activeElement');await key('Enter');await key('Enter');assert.equal(await js('petPreviewLevel'),2);assert.equal(await js('window.testArrow===document.activeElement'),true);await focus('.album-arrow[aria-label="上一形态"]');await js('window.testArrow=document.activeElement');await key('Enter');assert.equal(await js('petPreviewLevel'),1);assert.equal(await js('window.testArrow===document.activeElement'),true);assert.deepEqual(await get(),before);
  });
  await check('Live owner and growth refresh preserves next-arrow, selected tile, close and both scroll positions',async()=>{
   await reset(staged());await album();await focus('.album-arrow[aria-label="下一形态"]');await act({type:'pet.growth',ids:['album_0'],delta:1});assert.equal((await focused()).arrow,'下一形态');await key('Enter');assert.equal(await js('petPreviewLevel'),2);await click('.album-tile[data-level="5"]');await js('document.querySelector(".dialog-content").scrollTop=100;document.querySelector(".album-track").scrollLeft=130');const scroll=await js('[document.querySelector(".dialog-content").scrollTop,document.querySelector(".album-track").scrollLeft]');await act({type:'student.update',id:'album_0',name:'合成相册新姓名'});assert.equal((await focused()).level,'5');assert.equal(await js('document.activeElement.classList.contains("album-tile")'),true);assert.equal(await js('petPreviewLevel'),5);assert.deepEqual(await js('[document.querySelector(".dialog-content").scrollTop,document.querySelector(".album-track").scrollLeft]'),scroll);await focus('.modal-close');await act({type:'pet.growth',ids:['album_0'],delta:1});assert.equal((await focused()).action,'modal-close');
  });
  await check('Replacement feedback stays topmost after album refresh and Enter dismisses only feedback',async()=>{
   await reset(staged());await album();await act({type:'pet.growth',ids:['album_0'],delta:4});await focus('#pet-feedback .celebration-close');await act({type:'pet.growth',ids:['album_0'],delta:5});assert.equal((await focused()).feedback,true);await key('Enter');assert.equal(await js('!!document.querySelector("#pet-feedback .pet-celebration")'),false);assert.equal(await js('!!document.querySelector("#album-preview")'),true);
  });
  await check('Class honors refreshes batch graduation and retains explicit class scope',async()=>{
   await reset(staged(['album_0','album_1'],30));await honors();let s=await get();await act({type:'pet.batch',operation:'graduate',ids:['album_0','album_1'],expectedRevision:s.revision,requestId:'album_batch'});await key('Escape');assert.deepEqual(await stats(),['2','2','2']);assert.equal(await js('document.querySelectorAll(".graduation-snapshots article").length'),2);await act({type:'pet.focus',id:'album_2'});assert.match(await js('document.querySelector(".album-title p").innerText'),/合成相册班/);fs.writeFileSync(path.join(out,'class-honors-refreshed.png'),(await main.webContents.capturePage()).toPNG());
  });
  await check('Individual honors refreshes balance and current owner while historical snapshot remains unchanged',async()=>{
   await reset(graduated());await honors('album_0');let s=await get();await act({type:'pet.badge.redeem',id:'album_0',amount:1,reason:'合成兑换',requestId:'album_redeem',expectedRevision:s.revision});await act({type:'student.update',id:'album_0',name:'合成现任姓名'});assert.deepEqual(await stats(),['1','0','1']);assert.match(await js('document.querySelector(".album-title p").innerText'),/合成现任姓名/);assert.match(await js('document.querySelector(".graduation-snapshots h4").innerText'),/合成相册同学0/);
  });
  await check('Honors retains scroll and focused action while unrelated state changes leave its DOM intact',async()=>{
   await reset(graduated());await honors('album_0');await focus('.honors-dialog [data-do=px-wallet]');await js('document.querySelector(".dialog-content").scrollTop=230');const scroll=await js('document.querySelector(".dialog-content").scrollTop');await act({type:'student.update',id:'album_0',name:'合成保留焦点'});assert.equal((await focused()).action,'px-wallet');assert.equal(await js('document.querySelector(".dialog-content").scrollTop'),scroll);await js('window.testDialog=document.querySelector(".honors-dialog")');await act({type:'score',ids:['album_1'],delta:2});await act({type:'timer.set',seconds:17});assert.equal(await js('window.testDialog===document.querySelector(".honors-dialog")'),true);
  });
  await check('Restore refreshes same-owner honors from current state and closes removed explicit targets',async()=>{
   await reset(graduated());await honors('album_0');await restore(base);assert.deepEqual(await stats(),['0','0','0']);assert.equal(await js('document.querySelectorAll(".graduation-snapshots article").length'),0);const removed=C.applyAction(base,{type:'student.remove',id:'album_0'});await restore(removed);assert.equal(await js('!!document.querySelector(".honors-dialog")'),false);assert.equal(await js('document.querySelector("#app").inert'),false);
  });
  await check('Removed explicit evolution owner closes album and later broadcasts do not reopen it',async()=>{
   await reset();await album();await act({type:'student.remove',id:'album_0'});assert.equal(await js('!!document.querySelector("#album-preview")'),false);await act({type:'timer.set',seconds:23});assert.equal(await js('!!document.querySelector("#modal .dialog")'),false);
  });
  await check('Class honors excludes removed owner and an explicitly closed honors view remains closed',async()=>{
   await reset(graduated());await honors();await act({type:'student.remove',id:'album_0'});assert.deepEqual(await stats(),['0','0','0']);await key('Escape');await act({type:'settings',className:'合成另一个班名'});assert.equal(await js('!!document.querySelector(".honors-dialog")'),false);
  });
  await check('Unrelated editable draft and focus survive honors-relevant broadcasts',async()=>{
   await reset(graduated());await click('[data-page=students]');await click('[data-do=edit-student][data-id=album_1]');await js('document.querySelector("#student-form [name=name]").value="合成未保存草稿"');await focus('#student-form [name=name]');await act({type:'student.update',id:'album_0',name:'合成其他改名'});assert.equal(await js('document.activeElement===document.querySelector("#student-form [name=name]")'),true);assert.equal(await js('document.querySelector("#student-form [name=name]").value'),'合成未保存草稿');
  });
  await check('Renderer errors absent and read-only tested source files unchanged during run',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(hashes(),beforeHashes);});
  report();clearTimeout(deadline);console.log('SUMMARY_ALBUM',checks.filter(c=>c.status==='passed').length,'passed',checks.filter(c=>c.status==='failed').length,'failed');app.exit(checks.some(c=>c.status==='failed')?1:0);
 }catch(e){checks.push({name:'harness',status:'failed',error:e.stack});report();console.log('FATAL_ALBUM',e.stack);clearTimeout(deadline);app.exit(2);}});
}
