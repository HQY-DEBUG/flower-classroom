'use strict';
const {ensureToolControl,visibleControl,nativeClick}=require('./qa-tool-control.cjs');
// Frozen-source, synthetic-only verification of classroom tools in the real 240px score panel.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),suffix=process.env.FLOWER_PACKAGE_MAIN?'-packaged':'',out=path.join(root,'artifacts/qa-classroom-tools-240'+suffix),dir=path.join(root,'.qa-classroom-tools-240'+suffix);
const hashes=()=>Object.fromEntries(fs.readdirSync(path.join(root,'src')).sort().map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src',name))).digest('hex')]));
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
 const Core=require('../src/core.cjs');let fixture=require('../tests/pet-fixtures.cjs').legacyState();
 fixture=Core.importRows(Array.from({length:296},(_,i)=>({name:i===295?'合成长姓名用于检查窄窗换行的虚构同学末位':`合成同学${i+5}`,group:i>289?'合成长小组名称用于检查窄窗标题换行':`合成第${i%6+1}组`})),fixture,'append');
 fs.writeFileSync(path.join(dir,'classroom.json'),JSON.stringify(fixture));
 const before=hashes(),run=require('node:child_process').spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,FLOWER_HEADLESS_TEST:'1',FLOWER_DATA_DIR:dir,XDG_CACHE_HOME:'/tmp/flower-classroom-tools-240-cache'}});
 const after=hashes(),reportPath=path.join(out,'results.json'),report=fs.existsSync(reportPath)?JSON.parse(fs.readFileSync(reportPath)):{};
 fs.writeFileSync(path.join(out,'run.log'),(run.stdout||'')+(run.stderr||''));
 fs.writeFileSync(reportPath,JSON.stringify({...report,createdAt:new Date().toISOString(),syntheticOnly:true,testScriptSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),sourceAtStart:before,sourceAtFinish:after,sourceChanged:JSON.stringify(before)!==JSON.stringify(after),exitCode:run.status,signal:run.signal,error:run.error?.message},null,2));
 console.log((run.stdout||'').split('\n').filter(line=>/^(PASS|FAIL|RESULT)/.test(line)).join('\n'));
 if(run.error)console.error(run.error.message);
 process.exitCode=run.status===0&&JSON.stringify(before)===JSON.stringify(after)?0:1;
}else{
 const {app,BrowserWindow}=require('electron');app.disableHardwareAcceleration();
 const checks=[],probes=[],controls=[],errors=[];let main,panel;
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),js=(code,w=panel)=>w.webContents.executeJavaScript(code,true);
 const state=()=>js('classroom.get().then(x=>x.state)');
 async function until(fn,label){for(let i=0;i<180;i++){if(await fn())return;await sleep(25);}throw Error('Timed out '+label);}
 async function shot(name){await sleep(120);const image=await panel.webContents.capturePage();assert.equal(image.getSize().width,240);fs.writeFileSync(path.join(out,name+'.png'),image.toPNG());}
 async function check(name,fn){try{await fn();checks.push({name,status:'passed'});console.log('PASS_CT240',name);}catch(error){checks.push({name,status:'failed',error:error.stack});console.log('FAIL_CT240',name,error.message);try{await shot('failure-'+checks.length);}catch{}}}
 async function measure(stage){
  const value=await js(`(()=>{const dialog=document.querySelector('#modal .dialog'),rect=dialog.getBoundingClientRect(),nodes=[dialog,...dialog.querySelectorAll('*')];const overflow=nodes.filter(node=>!['INPUT','TEXTAREA'].includes(node.tagName)&&node.clientWidth>0&&node.scrollWidth>node.clientWidth+1).map(node=>({tag:node.tagName,className:node.className,action:node.dataset.do||'',width:node.clientWidth,scrollWidth:node.scrollWidth,text:node.innerText?.slice(0,65)}));return {viewport:innerWidth,height:innerHeight,dialogWidth:dialog.clientWidth,dialogScrollWidth:dialog.scrollWidth,left:rect.left,right:rect.right,overflowCount:overflow.length,overflow:overflow.slice(0,25),scrollContainers:nodes.filter(node=>['auto','scroll'].includes(getComputedStyle(node).overflowY)).map(node=>({className:node.className,width:node.clientWidth,scrollWidth:node.scrollWidth,height:node.clientHeight,scrollHeight:node.scrollHeight}))};})()`);
  probes.push({stage,...value});fs.writeFileSync(path.join(out,'layout-probes.json'),JSON.stringify({probes,controls},null,2));await shot('240px-'+stage);
  assert.equal(value.overflowCount,0,stage+' has horizontal overflow: '+JSON.stringify(value.overflow));assert.ok(value.left>=0&&value.right<=value.viewport+1,stage+' modal fits viewport');
 }
 async function reachable(selector){
  const result=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect(),x=(r.left+r.right)/2,y=(r.top+r.bottom)/2,hit=document.elementFromPoint(x,y);return {selector:${JSON.stringify(selector)},left:r.left,right:r.right,top:r.top,bottom:r.bottom,x,y,viewport:innerWidth,height:innerHeight,disabled:e.disabled===true,hit:!!hit&&(hit===e||e.contains(hit))};})()`);
  controls.push(result);assert.ok(result.left>=0&&result.right<=result.viewport+1&&result.top>=0&&result.bottom<=result.height&&result.hit,'Control is fully reachable '+JSON.stringify(result));return result;
 }
 async function click(selector){selector=await ensureToolControl(panel,selector);const r=await reachable(selector);assert.equal(r.disabled,false,'Control enabled '+selector);panel.webContents.sendInputEvent({type:'mouseDown',x:Math.floor(r.x),y:Math.floor(r.y),button:'left',clickCount:1});panel.webContents.sendInputEvent({type:'mouseUp',x:Math.floor(r.x),y:Math.floor(r.y),button:'left',clickCount:1});await sleep(45);}
 async function close(){await js('document.querySelector("#modal [data-do=modal-close]")?.click()');}
 async function toolbox(){await close();await click('[data-do=cw-toolbox]');}
 const mainEntry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs'));
 require('./package-boundary.cjs')(mainEntry,path.join(out,'dependency-boundary.json'));require(mainEntry);
 app.whenReady().then(async()=>{
  await until(async()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return main&&!main.webContents.isLoading()&&await js('!!document.querySelector("#app")?.innerText',main);},'main ready');
  await js('classroom.window({command:"open",role:"panel"})',main);
  await until(async()=>{panel=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='panel');return panel&&!panel.webContents.isLoading()&&await js('!!document.querySelector(".utility")');},'panel ready');
  panel.webContents.on('console-message',(_event,detail)=>{if(detail.level==='error')errors.push(detail.message);});panel.setSize(240,640);await until(()=>js('innerWidth===240'),'240px resize');
  const original=await state(),ids=[original.students[0].id,original.students[1].id,original.students.at(-1).id];
  await check('240px toolbox has no inner horizontal overflow',async()=>{await toolbox();await measure('toolbox');});
  await check('All five toolbox buttons are scroll-reachable',async()=>{for(const action of ['ct-vote','ct-attendance','open-timer','open-draw','cw-challenge'])await reachable('.ct-root [data-do='+action+']');});
  await check('240px candidate chooser including 300 students and long names has no inner overflow',async()=>{await click('[data-do=ct-vote]');assert.equal(await js('document.querySelectorAll("[data-do=ct-candidate]").length'),300);await measure('candidates');});
  await check('Candidate last member and submit are reachable and persist three choices via pointer input',async()=>{for(const id of ids)await click('[data-do=ct-candidate][data-id="'+id+'"]');await reachable('[data-do=ct-back]');await click('#ct-vote-form [type=submit]');await until(async()=>(await state()).classroomTools?.vote?.candidates.length===3,'three candidates persisted');});
  await check('240px vote page has no inner horizontal overflow',async()=>{await measure('vote');});
  await check('All three vote controls are scroll-reachable and actual plus/minus persist correctly',async()=>{for(const id of ids){await click('[data-do=ct-vote-plus][data-id="'+id+'"]');await until(async()=>(await state()).classroomTools.vote.candidates.find(v=>v.id===id).votes===1,'plus saved');await click('[data-do=ct-vote-minus][data-id="'+id+'"]');await until(async()=>(await state()).classroomTools.vote.candidates.find(v=>v.id===id).votes===0,'minus saved');}await reachable('[data-do=ct-reselect]');await reachable('[data-do=ct-close]');});
  await check('240px attendance page has no inner horizontal overflow',async()=>{await toolbox();await click('[data-do=ct-attendance]');assert.equal(await js('document.querySelectorAll("[data-do=ct-attendance-toggle]").length'),300);await measure('attendance');});
  await check('First and last attendance members are reachable and real pointer toggles persist',async()=>{for(const id of [ids[0],ids[2]]){await click('[data-do=ct-attendance-toggle][data-id="'+id+'"]');await until(async()=>(await state()).classroomTools.attendance.presentIds.includes(id),'attendance saved');}await reachable('[data-do=ct-reset]');await reachable('[data-do=ct-close]');});
  await check('240px absent list has no inner overflow and return/close actions remain reachable',async()=>{await click('[data-do=ct-absent]');assert.equal(await js('document.querySelectorAll(".ct-absent-person").length'),298);await measure('absent');await reachable('[data-do=ct-attendance-back]');await reachable('[data-do=ct-close]');});
  await check('240px challenge wheel opened from toolbox has no inner overflow and key actions are reachable',async()=>{await toolbox();await click('.ct-root [data-do=cw-challenge]');await measure('challenge-wheel');await reachable('#modal [data-do=cw-spin]');await reachable('#modal [data-do=cw-config]');await reachable('#modal [data-do=modal-close]');});
  await check('240px challenge configuration has no inner overflow and fields/delete/save/cancel are reachable',async()=>{await click('#modal [data-do=cw-config]');await measure('challenge-config');for(const selector of ['.cw-edit-row:first-child input[name=label]','.cw-edit-row:last-child input[name=label]','.cw-edit-row:first-child [data-do=cw-remove]','.cw-edit-row:last-child [data-do=cw-remove]','#cw-config-form [type=submit]','#cw-config-form [data-do=modal-close]'])await reachable(selector);await close();});
  await check('Vote and attendance did not alter photos, points, growth, pet ledger or score history',async()=>{const final=await state();assert.deepEqual(final.students,original.students);assert.deepEqual(final.logs,original.logs);assert.deepEqual(final.petAccounts,original.petAccounts);assert.deepEqual(errors,[]);});
  fs.writeFileSync(path.join(out,'layout-probes.json'),JSON.stringify({probes,controls},null,2));
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({syntheticOnly:true,scope:'Real Electron 240px score-panel UI, native pointer input and IPC; no source edits',checks,probes,controls,errors},null,2));
  console.log('RESULT_CT240',checks.filter(c=>c.status==='passed').length+'/'+checks.length);app.exit(checks.some(c=>c.status==='failed')?1:0);
 }).catch(error=>{console.error(error.stack);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,probes,controls,error:error.stack}));app.exit(2);});
}
