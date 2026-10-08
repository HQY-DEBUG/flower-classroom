'use strict';
// Focused RC12 renderer regressions. All state and names are synthetic.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.FLOWER_PET_FEEDBACK_OUT||path.join(root,'artifacts/rc12/pet-fixes/focused-source'));
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'flower-pet-feedback-rc12-'));
 const run=require('node:child_process').spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,FLOWER_HEADLESS_TEST:'1',FLOWER_DATA_DIR:data,XDG_CACHE_HOME:'/tmp/flower-pet-feedback-rc12-cache'}});
 fs.writeFileSync(path.join(out,'run.log'),(run.stdout||'')+(run.stderr||''));
 console.log((run.stdout||'').split('\n').filter(line=>/^(PASS|FAIL|SUMMARY|FATAL)_PF/.test(line)).join('\n'));process.exitCode=run.status===0?0:1;
}else{
 const {app,BrowserWindow}=require('electron');app.disableHardwareAcceleration();
 const entry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs')),src=path.dirname(entry),Core=require(path.join(src,'core.cjs')),P=require(path.join(src,'pet-progress.js')),Art=require(path.join(src,'pet-art.js'));
 const clone=value=>JSON.parse(JSON.stringify(value)),ap=(s,a)=>Core.applyAction(s,a,9000000),checks=[],errors=[];let main,other;
 function fixture(){let s=Core.createInitialState();s.students=Object.keys(Art.names).map((pet,i)=>({id:'pf_'+i,name:'合成伙伴同学'+i,group:'合成测试组',pet,score:0,growth:0,photo:'',startFromEgg:true}));s.logs=[];return ap(s,{type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]});}
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),js=(code,w=main)=>w.webContents.executeJavaScript(code,true),get=()=>js('classroom.get().then(value=>value.state)');
 async function until(fn,label){for(let i=0;i<250;i++){if(await fn())return;await wait(15);}throw Error('Timed out: '+label);}
 async function act(action,w=other||main){const s=await js('classroom.action('+JSON.stringify(action)+')',w);await until(()=>js('state.revision==='+s.revision),'main state');assert.deepEqual(JSON.parse(fs.readFileSync(path.join(process.env.FLOWER_DATA_DIR,'classroom-v2.json'),'utf8')),s);return s;}
 async function clear(){await js('handleDo("pet-feedback-close");closeModal()');}
 async function restore(s=fixture(),keepModal=false){if(!keepModal)await clear();const next=await js('classroom.file('+JSON.stringify({command:'restore-apply',state:s})+')');await until(()=>js('state.revision==='+next.revision),'restored state');return next;}
 async function shot(name){await wait(450);fs.writeFileSync(path.join(out,name+'.png'),(await main.webContents.capturePage()).toPNG());}
 async function check(name,fn){try{const detail=await fn();checks.push({name,status:'passed',detail});console.log('PASS_PF',name);}catch(error){checks.push({name,status:'failed',error:error.stack});console.log('FAIL_PF',name,error.stack);await shot('failure-'+checks.length);}}
 async function rows(){return js('[...document.querySelectorAll("#pet-feedback [data-feedback-student]")].map(el=>({id:el.dataset.feedbackStudent,group:el.closest("[data-feedback-direction]")?.dataset.feedbackDirection,text:el.innerText}))');}
 async function closeGeometry(name){await wait(450);const result=await js('(()=>{const card=document.querySelector("#pet-feedback .pet-celebration"),content=card.querySelector(".celebration-content"),close=card.querySelector(".celebration-close");content.scrollTop=content.scrollHeight;const r=close.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,outerScroll:card.scrollTop,contentScroll:content.scrollTop,horizontalOverflow:content.scrollWidth>content.clientWidth+1}})()');assert.ok(result.top>=0&&result.bottom<=result.viewportHeight&&result.left>=0&&result.right<=result.viewportWidth);assert.ok(result.width>=44&&result.height>=44);assert.equal(result.outerScroll,0);assert.equal(result.horizontalOverflow,false);assert.ok(result.contentScroll>0);await shot(name);return result;}
 fs.writeFileSync(path.join(process.env.FLOWER_DATA_DIR,'classroom-v2.json'),JSON.stringify(fixture()));
 app.on('web-contents-created',(_event,contents)=>contents.on('console-message',(event,level,message)=>{if(event.level==='error'||level>=3)errors.push(event.message??message);}));
 require(entry);const deadline=setTimeout(()=>app.exit(3),110000);
 app.whenReady().then(async()=>{try{
  await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return main&&!main.webContents.isLoading();},'main');await until(()=>js('!!state'),'state');main.setContentSize(1200,820);
  await js('page="pets";render();classroom.window({command:"open",role:"pet"})');await until(()=>{other=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='pet');return other&&!other.webContents.isLoading();},'other window');await until(()=>js('!!state',other),'other state');
  await check('Mixed feedback includes each exact transition once, with same-level growth alongside it',async()=>{
   let s=fixture();for(const [id,delta]of [['pf_1',1],['pf_2',5],['pf_3',1],['pf_4',2]])s=ap(s,{type:'pet.growth',ids:[id],delta});await restore(s);
   await act({type:'pet.growth.mixed',awards:[{ids:['pf_0'],delta:6},{ids:['pf_1'],delta:5},{ids:['pf_2'],delta:-1},{ids:['pf_3'],delta:-1},{ids:['pf_4'],delta:1}]});
   const result=await rows();assert.equal(result.length,5);assert.equal(new Set(result.map(row=>row.id)).size,5);
   for(const [id,group,text]of [['pf_0','hatch','初生蛋 → LV.2 · 成长 0 → 6'],['pf_1','up','LV.1 → LV.2 · 成长 1 → 6'],['pf_2','down','LV.2 → LV.1 · 成长 5 → 4'],['pf_3','egg','LV.1 → 初生蛋 · 成长 1 → 0'],['pf_4','growth','LV.1 → LV.1 · 成长 2 → 3']]){const row=result.find(row=>row.id===id);assert.equal(row.group,group);assert.ok(row.text.includes(text),row.text);}
   assert.equal(await js('document.querySelectorAll("#pet-feedback .pet-celebration").length'),1);await shot('mixed-exact-transitions');return result;
  });
  await check('Forty simultaneous hatches have no omitted names and retain a close control at 200 percent',async()=>{
   let s=await restore();await act({type:'pet.growth',ids:s.students.map(s=>s.id),delta:1});const result=await rows();assert.equal(result.length,40);for(let i=0;i<40;i++)assert.equal(result.filter(row=>row.id==='pf_'+i).length,1);
   main.setContentSize(900,640);main.webContents.setZoomFactor(2);const geometry=await closeGeometry('forty-hatches-200pct');await js('document.querySelector("#pet-feedback .celebration-close").click()');assert.equal(await js('!!document.querySelector("#pet-feedback .pet-celebration")'),false);main.webContents.setZoomFactor(1);main.setContentSize(1200,820);return {names:40,geometry};
  });
  await check('Batch results survive timers and zero-change writes, then dismiss on newer same-level growth without losing focus',async()=>{
   let s=await restore();await act({type:'pet.growth-policy',growthFloor:'clamp'});await act({type:'pet.growth',ids:['pf_0','pf_1'],delta:1});
   const original=await rows();await js('document.querySelector("#pet-feedback .celebration-close").focus()');
   await act({type:'timer.set',seconds:90});assert.deepEqual(await rows(),original);assert.equal(await js('document.activeElement.matches("#pet-feedback .celebration-close")'),true);
   await act({type:'pet.growth',ids:['pf_2'],delta:-1});assert.deepEqual(await rows(),original);assert.equal(await js('document.activeElement.matches("#pet-feedback .celebration-close")'),true);
   s=await get();await act({type:'pet.batch',operation:'growth',ids:['pf_2'],delta:-1,requestId:'pf_zero_change',expectedRevision:s.revision});assert.deepEqual(await rows(),original);
   s=await act({type:'pet.growth',ids:['pf_0'],delta:1});assert.equal(P.profile(s,'pf_0').growth,2);assert.equal(await js('!!document.querySelector("#pet-feedback .pet-celebration")'),false);assert.equal(await js('document.activeElement.id'),'nav-pets');
   await act({type:'pet.growth',ids:['pf_0','pf_1'],delta:4});await js('document.querySelector("#pet-feedback .celebration-close").focus()');await act({type:'pet.growth',ids:['pf_0'],delta:5});assert.equal(await js('document.activeElement.matches("#pet-feedback .celebration-close")'),true);assert.match(await js('document.querySelector("#pet-feedback").textContent'),/成长 6 → 11/);
   await js('document.querySelector("#nav-pets").focus()');await act({type:'pet.growth',ids:['pf_0'],delta:1});assert.equal(await js('!!document.querySelector("#pet-feedback .pet-celebration")'),false);assert.equal(await js('document.activeElement.id'),'nav-pets');return {timerPreserved:true,clampedZeroPreserved:true,newGrowthDismissed:true,focusPreservedOnDismissAndReplacement:true};
  });
  await check('Album retains selected preview and scrolling as rules, species and hidden forms change',async()=>{
   let s=fixture();s=ap(s,{type:'pet.growth',ids:['pf_0'],delta:5});await restore(s);main.setContentSize(900,640);main.webContents.setZoomFactor(1.5);await js('petModalId="pf_0";petPreviewLevel=7;albumDialog()');await wait(80);const scroll=await js(`(()=>{const c=document.querySelector('#modal .dialog-content');c.scrollTop=120;document.querySelector('.album-tile[data-level="7"]').focus({preventScroll:true});return c.scrollTop})()`);
   await act({type:'pet.stage-rules',thresholds:[10,10,10,10,10,10]});assert.equal(await js('petPreviewLevel'),7);assert.equal(await js('document.querySelector("#modal .dialog-content").scrollTop'),scroll);assert.match(await js('document.querySelector(".album-foot").textContent'),/LV\.1/);
   await act({type:'student.update',id:'pf_0',pet:'fox'});assert.equal(await js('document.querySelector("#album-preview svg").dataset.pet'),'fox');assert.equal(await js('petPreviewLevel'),7);
   await act({type:'pet.visibility',hideLateForms:true});assert.equal(await js('petPreviewLevel'),7);assert.equal(await js('!!document.querySelector("#album-preview .pet-form-mystery")'),true);assert.equal(await js(`document.querySelectorAll('.album-tile[data-level="6"] svg,.album-tile[data-level="7"] svg').length`),0);
   await act({type:'timer.set',seconds:120});assert.equal(await js('petPreviewLevel'),7);assert.equal(await js('!!document.querySelector("#album-preview .pet-form-mystery")'),true);
   await shot('album-live-selection-hidden');main.webContents.setZoomFactor(1);main.setContentSize(1200,820);return {previewLevel:7,scrollPreserved:true,species:'fox',hiddenFormsPreserved:true};
  });
  await check('Same-ID restore refreshes album; removed student closes the album safely',async()=>{
   let s=fixture();s=ap(s,{type:'pet.growth',ids:['pf_0'],delta:5});await restore(s);await js('petModalId="pf_0";petPreviewLevel=2;albumDialog()');await restore(fixture(),true);assert.equal(await js('petPreviewLevel'),2);assert.match(await js('document.querySelector(".album-foot").textContent'),/待破壳/);assert.doesNotMatch(await js('document.querySelector("#album-preview").textContent'),/当前形态/);
   s=await get();await act({type:'student.remove',id:'pf_0',confirmed:true,expectedRevision:s.revision});assert.equal(await js('!!document.querySelector("#album-preview")'),false);assert.equal(await js('document.querySelector("#app").inert'),false);return {restoreRefreshed:true,missingStudentClosed:true};
  });
  await check('Two graduate awards show the full total and route each adoption to that pupil',async()=>{
   let s=fixture();s=ap(s,{type:'pet.growth',ids:['pf_0','pf_1'],delta:30});s=await restore(s);s=await act({type:'pet.batch',operation:'graduate',ids:['pf_0','pf_1'],requestId:'pf_two_graduates',expectedRevision:s.revision});const snapshots=clone(s.petAccounts.map(account=>account.graduations));
   assert.equal(await js('document.querySelector("#pet-feedback h2").textContent'),'+2 永久荣誉徽章');const result=await rows();assert.equal(result.length,2);for(const row of result)assert.match(row.text,/\+1 永久荣誉徽章/);assert.equal(await js('document.querySelectorAll("#pet-feedback [data-do=pet-feedback-adopt]").length'),2);await shot('two-graduate-medals');
   await js('document.querySelector("#pet-feedback [data-do=pet-feedback-adopt][data-id=pf_1]").click()');assert.equal(await js('document.querySelector("#pet-adopt-form").dataset.id'),'pf_1');assert.equal(await js('!!document.querySelector("#pet-feedback .pet-celebration")'),false);assert.deepEqual((await get()).petAccounts.map(account=>account.graduations),snapshots);return {total:2,each:1,adoptionTarget:'pf_1',snapshotsUnchanged:true};
  });
  await check('Forty graduation rows remain scrollable with an easy exit at 200 percent',async()=>{
   let s=fixture();s=ap(s,{type:'pet.growth',ids:s.students.map(s=>s.id),delta:30});s=await restore(s);await act({type:'pet.batch',operation:'graduate',ids:s.students.map(s=>s.id),requestId:'pf_forty_graduates',expectedRevision:s.revision});assert.equal((await rows()).length,40);assert.equal(await js('document.querySelector("#pet-feedback h2").textContent'),'+40 永久荣誉徽章');main.setContentSize(900,640);main.webContents.setZoomFactor(2);const geometry=await closeGeometry('forty-graduations-200pct');await js('document.querySelector("#pet-feedback .celebration-close").click()');main.webContents.setZoomFactor(1);main.setContentSize(1200,820);return {graduates:40,geometry};
  });
  await check('Paused cycle detail states retained growth while completed cycle states a new egg',async()=>{
   let s=fixture();s=ap(s,{type:'pet.growth',ids:['pf_0'],delta:9});s=ap(s,{type:'student.update',id:'pf_0',adopted:false});await restore(s);await js('page="pets";petDetailId="pf_0";render()');const paused=await js('document.querySelector(".pet-unadopted-detail").textContent');assert.match(paused,/保留 9 点成长/);assert.doesNotMatch(paused,/从 0 成长的蛋开始/);
   await act({type:'pet.adopt',id:'pf_0',pet:'owl'});s=await act({type:'pet.growth',ids:['pf_0'],delta:21});await act({type:'pet.graduate',id:'pf_0'});const fresh=await js('document.querySelector(".pet-unadopted-detail").textContent');assert.match(fresh,/从 0 成长的蛋开始/);assert.equal(P.profile(await get(),'pf_0').activeCycleId,null);return {paused,fresh};
  });
  await check('No renderer errors',async()=>{assert.deepEqual(errors,[]);return {rendererErrors:0};});
  clearTimeout(deadline);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({entry,syntheticOnly:true,createdAt:new Date().toISOString(),sourceSha256:Object.fromEntries(['app.js','egg-pet.css'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(src,name))).digest('hex')])),checks,errors,limits:['Linux headless Electron; native Windows interaction remains unverified']},null,2));console.log('SUMMARY_PF',checks.filter(c=>c.status==='passed').length,'passed',checks.filter(c=>c.status==='failed').length,'failed');app.exit(checks.some(c=>c.status==='failed')?1:0);
 }catch(error){clearTimeout(deadline);console.log('FATAL_PF',error.stack);fs.writeFileSync(path.join(out,'fatal.json'),JSON.stringify({error:error.stack,checks},null,2));app.exit(2);}});
}
