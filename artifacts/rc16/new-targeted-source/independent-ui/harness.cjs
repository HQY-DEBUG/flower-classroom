'use strict';
// Novel synthetic RC10 renderer lifecycle scenarios against an untouched delivered
// RC9 ASAR or the editable source. Linux Electron, not Windows physical execution.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),out=path.resolve(process.env.FLOWER_UI_OUT||path.join(root,'artifacts/rc10/ui-review/source')),entry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs')),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'flower-ui-lifecycle-rc10-'));
 fs.copyFileSync(__filename,path.join(out,'harness.cjs'));
 const run=require('node:child_process').spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:150000,maxBuffer:8*1024*1024,env:{...process.env,FLOWER_DATA_DIR:data,FLOWER_HEADLESS_TEST:'1'}});
 fs.writeFileSync(path.join(out,'electron.log'),(run.stdout||'')+(run.stderr||''));
 console.log((run.stdout||'').split('\n').filter(s=>/^(PASS|FAIL|FATAL|SUMMARY)_UI/.test(s)).join('\n'));
 if(run.error)console.error(run.error.message);process.exitCode=run.status===null?2:run.status;
}else{
 const {app,BrowserWindow,ipcMain}=require('electron'),{ensureToolControl,visibleControl,nativeClick}=require(path.join(root,'scripts/qa-tool-control.cjs'));app.disableHardwareAcceleration();
 require(path.join(root,'scripts/package-boundary.cjs'))(entry,path.join(out,'dependency-boundary.json'));
 const src=path.dirname(entry),C=require(path.join(src,'core.cjs')),T=require(path.join(src,'toolbox-extra.js')),data=process.env.FLOWER_DATA_DIR;
 const archive=entry.includes('.asar/')?entry.slice(0,entry.indexOf('.asar/')+5):null,archiveSha256=archive?sha(require('original-fs').readFileSync(archive)):null;
 const hashes=()=>Object.fromEntries(['app.js','toolbox-extra-ui.js','classroom-tools-ui.js','pet-extra-ui.js','draw-tools.js','modal-shell.css'].map(n=>[n,sha(fs.readFileSync(path.join(src,n)))])),initialHashes=hashes(),checks=[],errors=[];
 function baseline(){let s=C.createInitialState();s.students=s.students.slice(0,4).map((v,i)=>({...v,name:'合成生命周期'+(i+1),group:'合成组'+(i%2+1)}));s.settings.className='合成UI生命周期';for(const a of [{type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]},{type:'toolbox.link.add',id:'base_link',title:'合成原网址',url:'https://example.org/'},{type:'toolbox.homework.add',id:'base_task',title:'合成原作业',subject:'语文',date:'2026-10-03'}])s=C.applyAction(s,{...a,...T.expectation(s)});return s;}
 fs.writeFileSync(path.join(data,'classroom-v2.json'),JSON.stringify(baseline()));
 let main,other,heldType='',entered=false,release;
 const originalHandle=ipcMain.handle.bind(ipcMain);ipcMain.handle=function(channel,handler){return originalHandle(channel,channel==='state:action'?async(event,action)=>{const result=await handler(event,action);if(action.type===heldType){entered=true;return new Promise(resolve=>{release=()=>resolve(result);});}return result;}:handler);};
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=(code,w=main)=>w.webContents.executeJavaScript(code,true),get=(w=main)=>js('classroom.get().then(r=>r.state)',w),act=(a,w=other)=>js('classroom.action('+JSON.stringify(a)+')',w),file=r=>js('classroom.file('+JSON.stringify(r)+')'),disk=()=>fs.readFileSync(path.join(data,'classroom-v2.json'),'utf8');
 async function until(fn,label='condition'){for(let n=0;n<400;n++){if(await fn())return;await wait(20);}throw Error('Timed out '+label);}
 async function click(selector,w=main){selector=await ensureToolControl(w,selector);const c=await visibleControl(w,selector);assert.ok(c,'Visible '+selector);const zoom=w.webContents.getZoomFactor();await nativeClick(w,{...c,x:c.x*zoom,y:c.y*zoom});}
 async function key(keyCode,modifiers=[],w=main){for(const type of ['keyDown','keyUp'])w.webContents.sendInputEvent({type,keyCode,modifiers});await wait(50);}
 async function close(){if(await js('!!document.querySelector("#pet-feedback .pet-celebration")'))await key('Escape');if(await js('!!document.querySelector("#modal .dialog")'))await key('Escape');}
 const fill=(selector,value)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const shot=async name=>fs.writeFileSync(path.join(out,name+'.png'),(await main.webContents.capturePage()).toPNG());
 async function reset(){heldType='';release?.();release=null;await close();await file({command:'restore-apply',state:baseline()});await wait(60);await click('[data-page=students]');}
 async function tool(...actions){await click('[data-do=cw-toolbox]');for(const action of actions)await click('[data-do='+action+']');}
 function report(){fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({entry,archiveSha256,archiveUnchanged:!archive||sha(require('original-fs').readFileSync(archive))===archiveSha256,syntheticOnly:true,windowsExecuted:false,data,initialHashes,finalHashes:hashes(),checks,errors},null,2));}
 async function check(name,fn){const detail={};try{await fn(detail);checks.push({name,status:'passed',detail});console.log('PASS_UI',name);}catch(e){checks.push({name,status:'failed',detail,error:e.stack,actual:e.actual,expected:e.expected});console.log('FAIL_UI',name,e.message);try{await shot('failure-'+checks.length);}catch{}}report();}
 const cases=[
 {name:'new link',route:['tx-portal','tx-link-new'],form:'tx-link-form',fields:{title:'合成待保存网址',url:'https://example.org/draft'},type:'toolbox.link.add',verify:s=>s.toolboxExtra.links.some(v=>v.title==='合成待保存网址'&&v.url==='https://example.org/draft')},
 {name:'existing link',route:['tx-portal','tx-link-edit'],form:'tx-link-form',fields:{title:'合成修改网址',url:'https://example.org/changed'},type:'toolbox.link.update',verify:s=>s.toolboxExtra.links.find(v=>v.id==='base_link').title==='合成修改网址'},
 {name:'new homework',route:['tx-homework','tx-task-new'],form:'tx-task-form',fields:{title:'合成待保存作业',subject:'数学',date:'2026-10-04'},type:'toolbox.homework.add',verify:s=>s.toolboxExtra.homework.tasks.some(v=>v.title==='合成待保存作业'&&v.subject==='数学'&&v.date==='2026-10-04')},
 {name:'existing homework',route:['tx-homework','tx-task-edit'],form:'tx-task-form',fields:{title:'合成修改作业',subject:'数学',date:'2026-10-05'},type:'toolbox.homework.update',verify:s=>s.toolboxExtra.homework.tasks.find(v=>v.id==='base_task').title==='合成修改作业'},
 {name:'subject list',route:['tx-homework','tx-subjects'],form:'tx-subject-form',fields:{subjects:'语文\n数学\n合成新增科目'},type:'toolbox.homework.subjects',verify:s=>s.toolboxExtra.homework.subjects.includes('合成新增科目')}
 ];
 async function draft(c){await tool(...c.route);for(const [name,value]of Object.entries(c.fields))await fill('#'+c.form+' [name='+name+']',value);}
 const values=c=>js('Object.fromEntries([...document.querySelectorAll('+JSON.stringify('#'+c.form+' [name]')+')].map(e=>[e.name,e.value]))');
 require(entry);const timeout=setTimeout(()=>{report();app.exit(3);},140000);
 app.whenReady().then(async()=>{try{await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return main&&!main.webContents.isLoading();});
  // Async workbook bootstrap registers native IPC before creating the main window.
  ipcMain.handle=originalHandle;await until(()=>js('!!state'));main.webContents.on('console-message',e=>{if(e.level==='error')errors.push(e.message);});await js('classroom.window({command:"open",role:"pets"})');await until(()=>{other=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='pets');return other&&!other.webContents.isLoading();});await until(()=>js('!!state',other));
  for(const c of [cases[0],cases[2]])await check('Independent late acknowledgment preserves same-kind replacement '+c.name+' editor',async d=>{await reset();await draft(c);heldType=c.type;entered=false;try{await click('#'+c.form+' [type=submit]');await until(()=>entered);await key('Escape');await tool(...c.route);for(const [name,value]of Object.entries(c.fields))await fill('#'+c.form+' [name='+name+']',name==='title'?'合成替代草稿':value);d.before=await values(c);const saved=await get();heldType='';release();await wait(150);assert.deepEqual(await values(c),d.before);assert.equal(await js('document.querySelector("#'+c.form+' [type=submit]").disabled'),false);assert.deepEqual(await get(),saved);}finally{heldType='';release?.();}});
  await check('Independent failed-save keyboard path remains usable and modal-bound',async d=>{await reset();await draft(cases[0]);const tmp=path.join(data,'classroom-v2.json.tmp');fs.mkdirSync(tmp);try{await click('#tx-link-form [type=submit]');await until(()=>js('!!document.querySelector(".tx-error:not([hidden])")'));d.focusImmediately=await js('({tag:document.activeElement.tagName,name:document.activeElement.name||null,inDialog:!!document.activeElement.closest("#modal .dialog")})');for(let i=0;i<8;i++){await key('Tab');assert.equal(await js('!!document.activeElement.closest("#modal .dialog")'),true);}await key('Escape');assert.equal(await js('document.querySelector("#app").inert'),false);assert.equal(await js('!!document.activeElement.closest("#app")'),true);}finally{fs.rmdirSync(tmp);}});
  await check('Independent stale-draft keyboard path cannot resubmit after subject removal',async d=>{await reset();const c=cases[2];await draft(c);const before=await get();await act({type:'toolbox.homework.subjects',subjects:['语文','英语'],...T.expectation(before)});await until(()=>js('!!document.querySelector(".tx-warning")'));const saved=await get();await key('Return');for(let i=0;i<5;i++){await key('Tab');assert.equal(await js('!!document.activeElement.closest("#modal .dialog")'),true);}assert.deepEqual(await values(c),c.fields);assert.deepEqual(await get(),saved);await key('Escape');assert.equal(await js('document.querySelector("#app").inert'),false);});
  clearTimeout(timeout);report();console.log('SUMMARY_UI',checks.filter(c=>c.status==='passed').length,'passed',checks.filter(c=>c.status==='failed').length,'failed');app.exit(checks.some(c=>c.status==='failed')||errors.length?1:0);
 }catch(e){clearTimeout(timeout);checks.push({name:'fatal harness',status:'failed',error:e.stack});console.log('FATAL_UI',e.stack);report();app.exit(2);}});
}
