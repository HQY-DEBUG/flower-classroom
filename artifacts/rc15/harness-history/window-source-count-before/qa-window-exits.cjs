'use strict';
// Real production windows, isolated synthetic profile, native hit-tested pointer input.
// Page JS only observes layout and sets deterministic scroll positions, never invokes handlers.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),variant=process.env.FLOWER_PACKAGE_MAIN?'packaged':'source',suffix=process.env.FLOWER_WINDOW_LABEL||'',stem='window-exits-'+variant+(suffix?'-'+suffix:''),out=path.join(root,'artifacts/rc9');
fs.mkdirSync(out,{recursive:true});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),q=JSON.stringify;
const hashes=dir=>Object.fromEntries(fs.readdirSync(dir).sort().filter(f=>fs.statSync(path.join(dir,f)).isFile()).map(f=>[f,hash(fs.readFileSync(path.join(dir,f)))]));
const inventory=[
 {role:'main',frame:true,exit:'Operating-system titlebar close and application menu Quit',close:null,header:'.topbar',sizes:[[900,640],[1280,840]],scope:'No operating-system titlebar observation claimed'},
 {role:'draw',frame:true,exit:'App return/close plus operating-system titlebar',close:'[data-do="close-window"]',header:'.standalone-window-header',sizes:[[700,580],[1020,740]],fullscreen:true},
 {role:'pets',frame:true,exit:'App close plus operating-system titlebar',close:'.pet-stage-top [data-do="close-window"]',header:'.pet-stage-top',sizes:[[700,580],[1280,840]],fullscreen:true},
 {role:'panel',frame:false,exit:'App header close',close:'.utility-title [data-do="close-window"]',header:'.utility-title',sizes:[[240,480],[450,690]],scrollRequired:true},
 {role:'sidebar',frame:false,exit:'App fixed bottom close',close:'.sidebar-close',header:'.utility-title',sizes:[[320,480],[320,1000]],scrollRequired:true},
 {role:'pet',frame:false,exit:'App header close',close:'.utility-title [data-do="close-window"]',header:'.utility-title',sizes:[[300,560],[340,590]],scrollRequired:true},
 {role:'timer',frame:false,exit:'App 返回 button',close:'[data-do="tt-return"]',header:null,sizes:[[360,360],[430,430]],compact:true},
 {role:'flower',frame:false,exit:'Native context-menu 退出, quits whole application',close:null,header:null,sizes:[[110,146]],compact:true,globalQuit:true}
];
if(!process.versions.electron){
 const Core=require('../src/core.cjs');let fixture=Core.createInitialState();fixture.settings.className='合成独立窗口验收班';
 fixture.students=Array.from({length:52},(_,i)=>({...fixture.students[0],id:'window_s_'+i,name:'合成同学'+String(i+1).padStart(2,'0'),group:'合成小组'+(i%6+1),score:20+i,growth:4,photo:'',adopted:true}));fixture.logs=[];
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'flower-window-qa-'));fs.writeFileSync(path.join(data,'classroom-v2.json'),q(fixture));
 const sourceAtStart=hashes(path.join(root,'src')),harnessAtStart=hash(fs.readFileSync(__filename));fs.copyFileSync(__filename,path.join(out,stem+'-executed.cjs'));
 const run=require('node:child_process').spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:600000,maxBuffer:12*1024*1024,env:{...process.env,FLOWER_HEADLESS_TEST:'1',FLOWER_DATA_DIR:data,XDG_CACHE_HOME:'/tmp/flower-window-qa-cache'}});
 fs.writeFileSync(path.join(out,stem+'.log'),(run.stdout||'')+(run.stderr||''));console.log((run.stdout||'').split('\n').filter(s=>/^(PASS_WINDOW|FAIL_WINDOW|RESULT_WINDOW)/.test(s)).join('\n'));
 const file=path.join(out,stem+'-results.json'),report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null,sourceAtFinish=hashes(path.join(root,'src'));
 fs.writeFileSync(path.join(out,stem+'-run.json'),q({sourceAtStart,sourceAtFinish,sourceFileCount:Object.keys(sourceAtStart).length,harnessAtStart,harnessAtFinish:hash(fs.readFileSync(__filename)),harnessChanged:harnessAtStart!==hash(fs.readFileSync(__filename)),sourceChanged:q(sourceAtStart)!==q(sourceAtFinish),exitCode:run.status,error:run.error?.message,report},null,2));
 process.exitCode=run.status===0&&report?.failed===0&&q(sourceAtStart)===q(sourceAtFinish)&&harnessAtStart===hash(fs.readFileSync(__filename))?0:1;
}else{
 const {app,BrowserWindow,Menu}=require('electron');app.disableHardwareAcceleration();
 const entry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs'));
 require('./package-boundary.cjs')(entry,path.join(out,stem+'-dependency-boundary.json'));
 const checks=[],errors=[],inputs=[],contextMenus=[];let main,active,reportWritten=false;
 // Retain real native menu objects/callbacks. OS menu presentation is unavailable headlessly.
 const fullscreenRequests=[];const setFullScreen=BrowserWindow.prototype.setFullScreen;BrowserWindow.prototype.setFullScreen=function(value){fullscreenRequests.push({role:this.flowerRole,value});return setFullScreen.call(this,value);};
 const popup=Menu.prototype.popup;Menu.prototype.popup=function(options){contextMenus.push({menu:this,windowId:options?.window?.id,labels:this.items.map(i=>i.label),nativeMenuDisplayed:false});};
 require(entry);
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),js=(s,w=active)=>w.webContents.executeJavaScript(s,true),state=()=>js('classroom.get().then(v=>v.state)',main),persisted=()=>hash(fs.readFileSync(path.join(process.env.FLOWER_DATA_DIR,'classroom-v2.json')));
 async function until(f,label){for(let i=0;i<200;i++){if(await f())return;await sleep(25)}throw Error('Timeout '+label)}
 async function point(selector){return js('(()=>{const e=document.querySelector('+q(selector)+');if(!e)return null;const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return {x,y,top:r.top,left:r.left,right:r.right,bottom:r.bottom,width:r.width,height:r.height,visible:!!e.getClientRects().length&&r.left>=-.5&&r.top>=-.5&&r.right<=innerWidth+.5&&r.bottom<=innerHeight+.5,hit:h===e||e.contains(h),disabled:e.disabled,text:e.textContent,aria:e.getAttribute("aria-label")}})()')}
 async function click(selector,{scroll=false,button='left'}={}){if(scroll){await js('document.querySelector('+q(selector)+')?.scrollIntoView({block:"center",inline:"nearest"})');await sleep(30)}const p=await point(selector);assert.ok(p?.visible&&p.hit&&!p.disabled,'Control inaccessible '+selector+' '+q(p));const z=active.webContents.getZoomFactor(),x=Math.round(p.x*z),y=Math.round(p.y*z);active.show();active.focus();active.webContents.sendInputEvent({type:'mouseMove',x,y});for(const type of ['mouseDown','mouseUp'])active.webContents.sendInputEvent({type,x,y,button,clickCount:1});inputs.push({role:active.flowerRole,selector,button,zoom:z,point:p});await sleep(70);return p;}
 async function escape(){active.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});active.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await sleep(30)}
 async function prepareMain(){active=main;main.webContents.setZoomFactor(1);main.setContentSize(900,640);await sleep(50);if(await js('!!document.querySelector("#modal .dialog")'))await escape();await click('#nav-students',{scroll:true});}
 async function ready(role){await until(()=>{const w=BrowserWindow.getAllWindows().find(w=>w.flowerRole===role);if(!w||w.isDestroyed()||w.webContents.isLoading())return false;active=w;return true},role+' opened');await until(()=>js('!!document.querySelector("#app button")'),role+' rendered');}
 async function openRole(role){if(role==='main'){await prepareMain();return;}await prepareMain();await click('#classroom-tools-button',{scroll:true});await click('[data-do="open-'+(role==='panel'?'sidebar':role)+'"]',{scroll:true});if(role==='panel'){await ready('sidebar');active.webContents.setZoomFactor(1);await click('[data-do="open-panel"]',{scroll:true});}await ready(role);}
 async function layout(size,zoom){active.webContents.setZoomFactor(zoom);active.setContentSize(...size);await sleep(100);}
 async function scrollAll(end){const [w,h]=active.getContentSize();active.webContents.sendInputEvent({type:'mouseWheel',x:Math.round(w/2),y:Math.round(h*.6),deltaX:0,deltaY:end==='bottom'?-100000:100000,canScroll:true});await sleep(30);await js('(()=>{const d=document.scrollingElement,els=[...document.querySelectorAll("#app *")].filter(e=>["auto","scroll"].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1);for(const e of [d,...els])e.scrollTop='+(end==='bottom'?'e.scrollHeight':'0')+';})()');await sleep(45);}
 async function geometry(s){return js('(()=>{const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};const d=document.scrollingElement,scroll=[d,...[...document.querySelectorAll("#app *")].filter(e=>["auto","scroll"].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight+1)].map(e=>({element:e===d?"document":e.className,scroll:e.scrollTop,max:Math.max(0,e.scrollHeight-e.clientHeight),width:e.clientWidth,scrollWidth:e.scrollWidth}));return {viewport:[innerWidth,innerHeight],close:rect(document.querySelector('+q(s.close)+')),header:rect(document.querySelector('+q(s.header)+')),scroll,horizontalOverflow:d.scrollWidth>innerWidth+1,compactControls:'+(s.role==='timer'?'[...document.querySelectorAll(".tt-top-controls,.tt-clock,.tt-actions,.tt-editor")].map(e=>({name:e.className,...rect(e)}))':'null')+',bodyOverflow:getComputedStyle(document.body).overflow,bodyClass:document.body.className,flower:rect(document.querySelector(".flower-window")),flowerButton:rect(document.querySelector(".flower-button")),flowerLabel:rect(document.querySelector(".flower-label"))}})()');}
 const inside=(r,g)=>r&&r.left>=-.5&&r.top>=-.5&&r.right<=g.viewport[0]+.5&&r.bottom<=g.viewport[1]+.5;
 async function screenshot(name){if(active&&!active.isDestroyed())fs.writeFileSync(path.join(out,stem+'-'+name+'.png'),(await active.webContents.capturePage()).toPNG());}
 async function check(name,fn){try{const detail=await fn();checks.push({name,status:'passed',detail});console.log('PASS_WINDOW',name);}catch(e){const observed=active&&!active.isDestroyed()?await geometry(inventory.find(s=>s.role===active.flowerRole)||inventory[0]).catch(()=>null):null;checks.push({name,status:'failed',error:e.stack,observed});console.log('FAIL_WINDOW',name,e.message);try{await screenshot('failure-'+checks.length)}catch{}}}
 async function roleLayout(s,size,zoom,narrow){
  if(!narrow)return layout(size,zoom);
  await layout(s.sizes[0],1);if(await js('document.body.classList.contains("is-narrow")'))await click('[data-do="narrow"]');
  active.webContents.setZoomFactor(zoom);await sleep(80);await click('[data-do="narrow"]');await until(()=>js('document.body.classList.contains("is-narrow")'),'narrow mode');
  const [width]=active.getContentSize();active.setContentSize(width,size[1]);await sleep(100);
 }
 async function closeCycle(s,size,zoom,{narrow=false,fullscreen=false}={}){
  await openRole(s.role);await roleLayout(s,size,zoom,narrow);const id=active.id,before=await state(),diskBefore=persisted(),actualContentSize=active.getContentSize();
  let fullscreenObserved=null;if(fullscreen){const requestsBefore=fullscreenRequests.length;await click('[data-do="fullscreen"]',{scroll:true});await sleep(150);assert.ok(fullscreenRequests.length>requestsBefore&&fullscreenRequests.at(-1).value===true,'Native fullscreen command requested');fullscreenObserved=active.isFullScreen();}
  await scrollAll('top');const top=await geometry(s);assert.ok(inside(top.close,top),'Close fits at top '+q(top));
  await scrollAll('bottom');const bottom=await geometry(s),p=await point(s.close);
  await screenshot(s.role+(narrow?'-narrow':'')+(fullscreen?'-fullscreen':'')+'-'+size.join('x')+'-z'+zoom+'-bottom');
  assert.ok(inside(bottom.close,bottom),'Close fits at bottom '+q(bottom));assert.ok(p?.hit,'Close hit tested at bottom');
  assert.ok(bottom.close.width>=44&&bottom.close.height>=44,'App exit has 44x44 CSS-px target '+q(bottom.close));
  if(!['pets','draw'].includes(s.role))assert.ok(Math.abs(top.close.top-bottom.close.top)<1,'Exit stays at fixed vertical position '+q({top:top.close,bottom:bottom.close}));
  if(s.header){assert.ok(inside(top.header,top)&&inside(bottom.header,bottom),'Window header remains visible '+q(bottom));if(!['pets','draw'].includes(s.role))assert.ok(Math.abs(top.header.top-bottom.header.top)<1,'Header position stable');else assert.ok(bottom.header.top>=0&&bottom.header.top<=top.header.top,'Sticky header settles at top');}
  if(s.scrollRequired&&!narrow)assert.ok(bottom.scroll.some(r=>r.max>0&&r.scroll>0),'Long synthetic content actually scrolled');
  assert.ok(bottom.scroll.every(r=>Math.abs(r.max-r.scroll)<=2),'All scroll areas reached bottom '+q(bottom.scroll));
  await click(s.close);await until(()=>!BrowserWindow.fromId(id),'Native app exit closes only that role');assert.ok(!main.isDestroyed());assert.deepEqual(await state(),before,'Close preserves all classroom state');assert.equal(persisted(),diskBefore,'Close does not rewrite synthetic saved data');
  await openRole(s.role);await roleLayout(s,size,zoom,narrow);await scrollAll('top');const reopened=await geometry(s);assert.ok(inside(reopened.close,reopened),'Reopened exit fits at top');const reopenedId=active.id;assert.notEqual(reopenedId,id,'Reopen creates fresh role window');await click(s.close);await until(()=>!BrowserWindow.fromId(reopenedId),'Native app exit closes reopened window');assert.deepEqual(await state(),before);assert.equal(persisted(),diskBefore);
  return {role:s.role,size,actualContentSize,zoom,narrow,fullscreen,fullscreenObserved,top,bottom,reopened,nativeBottomExit:true,nativeTopExit:true,freshWindowId:reopenedId,unchanged:true};
 }
 function writeReport(extra={}){const loadedSource=hashes(path.dirname(entry)),source=hashes(path.join(root,'src'));const r={version:require('../package.json').version,entry,variant,inventory,syntheticOnly:true,syntheticStudentCount:52,sourceFileCount:Object.keys(source).length,sourceHashes:source,loadedSourceHashes:loadedSource,loadedSourceMatchesWorkingSource:q(source)===q(loadedSource),nativePointerInputCount:inputs.length,fullscreenRequests,inputs,checks,errors,limitations:['Linux Electron offscreen rendering and native sendInputEvent only','No Windows operating-system titlebar button, PPT foreground, physical touch, or physical DPI claim','Native context-menu construction uses a native right click; production menu callback invoked through Electron API because OS menu cannot be observed headlessly','Zoom is renderer zoom 100%, 125%, 200%; native fullscreen requests are verified but fullscreenObserved is false on Linux headless, so actual OS full-screen is not validated'],passed:checks.filter(c=>c.status==='passed').length,failed:checks.filter(c=>c.status==='failed').length,...extra};fs.writeFileSync(path.join(out,stem+'-results.json'),q(r,null,2));reportWritten=true;console.log('RESULT_WINDOW',r.passed,r.failed);return r;}
 app.whenReady().then(async()=>{try{
  await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');active=main;return main&&!main.webContents.isLoading()},'main');await until(()=>js('!!document.querySelector("#nav-students")'),'main rendered');
  app.on('web-contents-created',(_e,w)=>w.on('console-message',e=>{if(e.level==='error')errors.push(e.message)}));
  const filter=process.env.FLOWER_WINDOW_ROLES?new Set(process.env.FLOWER_WINDOW_ROLES.split(',')):null;
  await check('Loaded production entry matches all 54 frozen source files',async()=>{const source=hashes(path.join(root,'src')),loaded=hashes(path.dirname(entry));assert.equal(Object.keys(source).length,54);assert.deepEqual(loaded,source);return {sourceFileCount:54,allHashesMatch:true};});
  await check('All independent window roles inventoried from production allowlist',async()=>{const source=fs.readFileSync(entry,'utf8'),match=source.match(/if\s*\(!\[([^\]]+)\]\.includes\(role\)\)/);assert.ok(match,'Production window-command allowlist found');const roles=[...match[1].matchAll(/'([^']+)'/g)].map(m=>m[1]).sort();assert.deepEqual(inventory.map(s=>s.role).sort(),roles);return {roles,count:roles.length};});

  fs.writeFileSync(path.join(out,'window-role-inventory.json'),q({inventory,source:'src/main.cjs showWindow and windowCommand; src/app.js render; src/timer-tools.js handle',method:'Production BrowserWindows and synthetic 52-student profile'},null,2));
  if(!filter||filter.has('main'))for(const size of inventory[0].sizes)for(const zoom of [1,1.25,2])await check('main inventory '+size.join('x')+' zoom '+zoom,async()=>{await prepareMain();await layout(size,zoom);await scrollAll('bottom');const g=await geometry(inventory[0]);assert.equal(await js('document.querySelectorAll("#app [data-do=close-window]").length'),0);assert.ok(Menu.getApplicationMenu().items.some(i=>i.submenu?.items.some(x=>x.label==='退出')));await screenshot('main-'+size.join('x')+'-z'+zoom);return {...g,frame:true,nativeCloseNotClaimed:true,applicationQuitMenuPresent:true};});
  for(const s of inventory.filter(s=>s.close&&(!filter||filter.has(s.role))))for(const size of s.sizes)for(const zoom of [1,1.25,2])await check(s.role+' '+size.join('x')+' zoom '+zoom,()=>closeCycle(s,size,zoom));
  if(!filter||filter.has('sidebar'))for(const zoom of [1,1.25,2])await check('sidebar narrow base64x480 with native width fit zoom '+zoom,()=>closeCycle(inventory.find(s=>s.role==='sidebar'),[64,480],zoom,{narrow:true}));
  for(const s of inventory.filter(s=>s.fullscreen&&(!filter||filter.has(s.role))))for(const zoom of [1,1.25,2])await check(s.role+' fullscreen request (headless state recorded) zoom '+zoom,()=>closeCycle(s,s.sizes[0],zoom,{fullscreen:true}));
  if(!filter||filter.has('sidebar'))await check('sidebar production zoom menu grows narrow window and reset restores it',async()=>{
   const s=inventory.find(s=>s.role==='sidebar');await openRole('sidebar');await roleLayout(s,[64,480],1,true);const before=await state(),diskBefore=persisted();
   active.show();active.focus();await sleep(50);assert.equal(BrowserWindow.getFocusedWindow()?.id,active.id,'Sidebar receives menu focus');
   const display=Menu.getApplicationMenu().items.find(i=>i.label==='显示').submenu,plus=display.items.find(i=>i.label==='放大10%'),reset=display.items.find(i=>i.label==='默认大小'),sizes=[];
   for(let i=0;i<10;i++){plus.click(plus,active,{});await sleep(35);sizes.push({zoom:active.webContents.getZoomFactor(),content:active.getContentSize()});}
   assert.equal(active.webContents.getZoomFactor(),2);assert.equal(active.getContentSize()[0],128);await scrollAll('bottom');const enlarged=await geometry(s);assert.ok(enlarged.close.width>=44&&enlarged.close.height>=44);assert.ok((await point(s.close)).hit);await screenshot('sidebar-menu-200-bottom');
   reset.click(reset,active,{});await sleep(80);assert.equal(active.webContents.getZoomFactor(),1);assert.equal(active.getContentSize()[0],64);await click(s.close);assert.deepEqual(await state(),before);assert.equal(persisted(),diskBefore);return {sizes,enlarged,nativeMenuCallbacks:true,resetRestored64:true,nativeExit:true,unchanged:true};
  });
  if(!filter||filter.has('timer'))await check('timer 200% unsaved duration draft closes without mutation',async()=>{
   await openRole('timer');await layout([360,360],2);const before=await state(),diskBefore=persisted(),initial=await js('document.querySelector("#timer-minutes").value');
   await click('.tt-editor>summary',{scroll:true});await click('#timer-minutes',{scroll:true});
   await until(()=>js('document.activeElement===document.querySelector("#timer-minutes")'),'native input focus');
   active.webContents.sendInputEvent({type:'keyDown',keyCode:'a',modifiers:['control']});active.webContents.sendInputEvent({type:'keyUp',keyCode:'a',modifiers:['control']});await sleep(60);
   active.webContents.sendInputEvent({type:'keyDown',keyCode:'Backspace'});active.webContents.sendInputEvent({type:'keyUp',keyCode:'Backspace'});
   await until(()=>js('document.querySelector("#timer-minutes").value===""'),'native draft cleared');
   await active.webContents.insertText('99');await until(()=>js('document.querySelector("#timer-minutes").value==="99"'),'native draft exact text');
   assert.equal(await js('document.querySelector("#timer-minutes").value'),'99');await scrollAll('bottom');const bottom=await geometry(inventory.find(s=>s.role==='timer'));await screenshot('timer-open-editor-200-bottom');const id=active.id;await click('[data-do="tt-return"]');await until(()=>!BrowserWindow.fromId(id),'timer draft exit');assert.deepEqual(await state(),before);assert.equal(persisted(),diskBefore);await openRole('timer');assert.equal(await js('document.querySelector("#timer-minutes").value'),initial);await layout([360,360],2);await click('[data-do="tt-return"]');return {bottom,nativeDraftEdit:true,nativeClose:true,draftDiscarded:true,unchanged:true};
  });
  if(!filter||filter.has('flower')){
   for(const zoom of [1,1.25,2])await check('flower compact context route zoom '+zoom,async()=>{await openRole('flower');await layout([110,146],zoom);await scrollAll('bottom');const g=await geometry(inventory.find(s=>s.role==='flower')),before=await state(),menuCount=contextMenus.length,z=active.webContents.getZoomFactor();assert.ok(inside(g.flower,g)&&inside(g.flowerButton,g)&&inside(g.flowerLabel,g),'Entire launcher remains visible '+q(g));assert.ok(!g.horizontalOverflow&&g.scroll.every(r=>r.max===0),'Launcher has no hidden overflow');active.show();active.focus();for(const type of ['mouseDown','mouseUp'])active.webContents.sendInputEvent({type,x:Math.round(10*z),y:Math.round(25*z),button:'right',clickCount:1});await until(()=>contextMenus.length>menuCount,'flower native context-menu');const menu=contextMenus.at(-1);assert.ok(menu.labels.includes('退出')&&menu.labels.includes('返回主界面'));assert.deepEqual(await state(),before);await screenshot('flower-z'+zoom);return {geometry:g,menuLabels:menu.labels,nativeRightClick:true,menuCallbackQuitDeferred:true};});
  }
  await check('No renderer errors',async()=>assert.deepEqual(errors,[]));
  if((!filter||filter.has('flower'))&&contextMenus.length){
   const menu=contextMenus.at(-1).menu,item=menu.items.find(i=>i.label==='退出'),diskBefore=persisted();
   if(item){
    app.once('will-quit',()=>{const empty=BrowserWindow.getAllWindows().length===0,unchanged=persisted()===diskBefore;checks.push({name:'Flower native menu callback quits synthetic app last',status:empty&&unchanged?'passed':'failed',detail:{menuItemClickViaElectronApi:true,beforeQuitObserved:app.isQuitting,willQuitObserved:true,allWindowsClosed:empty,unchanged}});const result=writeReport();Menu.prototype.popup=popup;app.exit(result.failed?1:0);});
    item.click(item,BrowserWindow.getAllWindows().find(w=>w.flowerRole==='flower'),{});return;
   }
  }
  const result=writeReport();Menu.prototype.popup=popup;app.exit(result.failed?1:0);
 }catch(e){writeReport({fatal:e.stack,failed:1});console.error(e);app.exit(2)}});
 setTimeout(()=>{if(!reportWritten)writeReport({fatal:'Harness timeout',failed:1});app.exit(3)},590000);
}
