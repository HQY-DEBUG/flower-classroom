'use strict';
const {ensureToolControl,visibleControl,nativeClick}=require('./qa-tool-control.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),suffix=process.env.FLOWER_PACKAGE_MAIN?'-packaged':'',out=path.join(root,'artifacts/qa-group-tools'+suffix),dir=path.join(root,'.qa-group-tools'+suffix);
const phase=process.argv.includes('--restart')?'restart':'flows';
const hashes=()=>Object.fromEntries(fs.readdirSync(path.join(root,'src')).sort().map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src',name))).digest('hex')]));
if(!process.versions.electron){
 fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(out,{recursive:true});
 for(const name of fs.readdirSync(out))if(/^failure-\d+\.png$/.test(name))fs.unlinkSync(path.join(out,name));
 const before=hashes(),results=[],{spawnSync}=require('node:child_process');
 for(const args of [[],['--restart']]){
  const result=spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename,...args],{cwd:root,env:{...process.env,FLOWER_HEADLESS_TEST:'1',FLOWER_DATA_DIR:dir,ELECTRON_CACHE:'/tmp/flower-group-electron-cache',XDG_CACHE_HOME:'/tmp/flower-group-cache'},encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
  const label=args.length?'restart':'flows';process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
  fs.writeFileSync(path.join(out,label+'.log'),(result.stdout||'')+(result.stderr||''));
  const reportFile=path.join(out,label+'.json');results.push({phase:label,exitCode:result.status,error:result.error?.message,report:fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile)):null});if(result.status)break;
 }
 const after=hashes();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({version:require('../package.json').version,createdAt:new Date().toISOString(),syntheticOnly:true,sourceAtStart:before,sourceAtFinish:after,sourceChanged:JSON.stringify(before)!==JSON.stringify(after),results},null,2));process.exitCode=results.some(result=>result.exitCode)?1:0;
}else{
 const {app,BrowserWindow,dialog}=require('electron'),Core=require('../src/core.cjs'),Groups=require('../src/group-tools.js');app.disableHardwareAcceleration();
 if(phase==='flows'){
  let state=Core.createInitialState();state.settings.className='纯合成小组验收班';state.students=state.students.slice(0,3);
  state.students.forEach((student,index)=>{student.name='合成学生'+(index+1);student.group=index<2?'合成向日葵组':'合成四叶草组';student.score=[20,100,50][index];student.growth=index===0?35:7;student.leader=index===0;});
  state.students[0].photo=require('../tests/pet-fixtures.cjs').SYNTHETIC_PNG;
  state=Core.applyAction(state,{type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]});
  state=Core.applyAction(state,{type:'pet.graduate',id:state.students[0].id});
  state=Core.applyAction(state,{type:'pet.adopt',id:state.students[0].id,pet:'cat'});
  state=Core.applyAction(state,{type:'pet.growth',ids:[state.students[0].id],delta:4,reason:'合成成长记录'});
  fs.writeFileSync(path.join(dir,'classroom-v2.json'),JSON.stringify(state));fs.writeFileSync(path.join(out,'baseline.json'),JSON.stringify(state));
 }
 const mainEntry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs'));require('./package-boundary.cjs')(mainEntry,path.join(out,'dependency-boundary-'+phase+'.json'));require(mainEntry);
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let main;const checks=[],errors=[];
 const js=async(code,win=main)=>{try{return await win.webContents.executeJavaScript(code,true);}catch(error){throw Error(error.message+' Script: '+code);}},get=()=>js('classroom.get().then(result=>result.state)'),act=action=>js(`classroom.action(${JSON.stringify(action)})`);
 const click=async selector=>{selector=await ensureToolControl(main,selector);return js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing control '+${JSON.stringify(selector)});node.click();})()`);};
 const fill=(selector,value)=>js(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)throw Error('Missing field '+${JSON.stringify(selector)});node.value=${JSON.stringify(String(value))};node.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const submit=selector=>js(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`);
 async function until(fn,label){for(let i=0;i<180;i++){if(await fn())return;await sleep(30);}throw Error('Timed out '+label);}
 async function shot(name){await sleep(100);fs.writeFileSync(path.join(out,name+'.png'),(await main.webContents.capturePage()).toPNG());}
 async function close(){await click('#modal [data-do=modal-close]');}
 async function manage(){await click('[data-page=groups]');await click('[data-do=gt-manage]');}
 async function check(name,fn){try{await fn();checks.push({name,status:'passed'});console.log('PASS_GROUP',name);}catch(error){checks.push({name,status:'failed',error:error.stack});console.error('FAIL_GROUP',name,error.stack);try{await shot('failure-'+checks.length);await js('document.querySelector("#modal [data-do=modal-close]")?.click()');}catch{}}}
 const immutableStudent=student=>{const copy={...student};delete copy.group;return copy;};
 app.whenReady().then(async()=>{
  await until(async()=>{main=BrowserWindow.getAllWindows().find(win=>win.flowerRole==='main');return main&&!main.webContents.isLoading();},'main window');
  main.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message);});
  await until(()=>js('typeof GroupToolsUI!=="undefined"&&!!document.querySelector("[data-page=groups]")'),'group UI integration');
  if(phase==='flows'){
   const baseline=JSON.parse(fs.readFileSync(path.join(out,'baseline.json'))),student=baseline.students[0],oldPanel=Core.panelId(baseline);
   await check('Opening legacy order/group UI and cancelling writes no fields and preserves every student record',async()=>{
    assert.equal((await get()).settings.groupOrder,undefined);await manage();assert.match(await js('document.querySelector("#modal").innerText'),/添加新小组.*小组排序.*批量分配学生/s);
    await click('[data-do=gt-create]');await fill('#gt-create-form [name=group]','取消的合成小组');await close();assert.deepEqual(await get(),baseline);
   });
   await check('Double submitting empty-group creation writes one zero-base group and preserves IDs/photos/scores/graduation',async()=>{
    await manage();await click('[data-do=gt-create]');await fill('#gt-create-form [name=group]','合成空组');
    const revision=(await get()).revision;await js('{const form=document.querySelector("#gt-create-form");form.requestSubmit();form.requestSubmit();}');
    await until(async()=>!(await js('!!document.querySelector("#gt-create-form")')),'created');const saved=await get();
    assert.equal(saved.revision,revision+1);assert.deepEqual(saved.groupBases,[{group:'合成空组',score:0}]);assert.deepEqual(saved.students,baseline.students);assert.deepEqual(saved.petAccounts,baseline.petAccounts);assert.deepEqual(saved.petLogs,baseline.petLogs);assert.equal(saved.settings.groupOrder,undefined);
    assert.match(await js('document.querySelector(".group-grid").innerText'),/合成空组.*0 位伙伴/s);await shot('01-empty-group');
   });
   await check('Keyboard arrow changes layout preview; cancel preserves state, save synchronizes main/panel/pet group order',async()=>{
    const before=await get();await manage();await click('[data-do=gt-order]');
    await js('{const arrow=document.querySelector("[data-do=gt-right][data-index=\\"0\\"]");arrow.focus();arrow.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));}');
    assert.deepEqual(await js('[...document.querySelectorAll(".gt-order-row strong")].map(node=>node.textContent)'),['合成四叶草组','合成向日葵组','合成空组']);
    await click('[data-do=gt-left][data-index="1"]');assert.deepEqual(await js('[...document.querySelectorAll(".gt-order-row strong")].map(node=>node.textContent)'),Groups.names(before));
    await click('[data-do=gt-right][data-index="0"]');assert.deepEqual(await js('[...document.querySelectorAll(".gt-order-row strong")].map(node=>node.textContent)'),['合成四叶草组','合成向日葵组','合成空组']);await close();assert.deepEqual(await get(),before);
    await manage();await click('[data-do=gt-order]');await click('[data-do=gt-right][data-index="0"]');await submit('#gt-order-form');await until(async()=>(await get()).settings.groupOrder?.[0]==='合成四叶草组','saved order');
    assert.deepEqual(await js('[...document.querySelectorAll(".group-card>h2")].map(node=>node.textContent)'),['合成四叶草组','合成向日葵组','合成空组']);
    await js('classroom.window({command:"open",role:"panel"})');const panel=BrowserWindow.getAllWindows().find(win=>win.flowerRole==='panel');await until(()=>js('!!document.querySelector(".quick-list")',panel),'panel rendering');
    assert.deepEqual(await js('GroupTools.names(state)',panel),(await get()).settings.groupOrder);
    assert.deepEqual(await js('[...document.querySelectorAll(".quick-group-heading")].map(node=>node.textContent)',panel),['合成四叶草组','合成向日葵组']);
    await click('[data-page=pets]');await click('[data-do=pet-tab][data-tab=groups]');assert.deepEqual(await js('[...document.querySelectorAll(".pet-group>.section-label h3")].map(node=>node.childNodes[0].textContent.trim())'),['合成四叶草组','合成向日葵组']);
    await click('[data-page=groups]');assert.deepEqual((await get()).students,baseline.students);await shot('02-ordered-groups');
   });
   await check('Order save failure keeps arrows/form usable and retry commits once with double submission',async()=>{
    await manage();await click('[data-do=gt-order]');await click('[data-do=gt-right][data-index="0"]');const before=await get(),temp=path.join(dir,'classroom-v2.json.tmp');fs.mkdirSync(temp);
    try{await submit('#gt-order-form');await until(()=>js('!!document.querySelector("#gt-order-form")&&!document.querySelector("#gt-order-form").dataset.saving'),'failed save released');assert.deepEqual(await get(),before);assert.equal(await js(`document.querySelector('[data-do=gt-left][data-index="0"]').disabled`),true);}finally{fs.rmdirSync(temp);}
    await js('{const form=document.querySelector("#gt-order-form");form.requestSubmit();form.requestSubmit();}');await until(async()=>(await get()).revision===before.revision+1,'retry once');await until(()=>js('!document.querySelector("#gt-order-form")'),'retry close');
   });
   await check('Concurrent group creation invalidates open ordering, prevents stale save, and offers refresh',async()=>{
    await manage();await click('[data-do=gt-order]');await act({type:'group.create',group:'另一窗口合成空组',panelId:oldPanel});await until(()=>js('!document.querySelector(".gt-stale").hidden'),'stale notice');const before=await get();
    await js('document.querySelector("#gt-order-form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');await sleep(80);assert.deepEqual(await get(),before);
    await click('[data-do=gt-refresh]');assert.equal(await js('document.querySelectorAll(".gt-order-row").length'),4);await close();
   });
   await check('Assignment all/none controls and individual selection move20-point leader120/50 to100/70',async()=>{
    const before=await get();await click('[data-page=students]');await click('[data-do=bulk-group]');await click('[data-do=gt-select-all]');assert.equal(await js('document.querySelectorAll("#bulk-group-form [name=student]:checked").length'),3);
    await click('[data-do=gt-select-none]');assert.equal(await js('document.querySelectorAll("#bulk-group-form [name=student]:checked").length'),0);
    await click(`#bulk-group-form [name=student][value="${student.id}"]`);await fill('#bulk-group-form [name=group]','合成四叶草组');await shot('03-manual-assignment');
    await submit('#bulk-group-form');await until(async()=>(await get()).students[0].group==='合成四叶草组','leader moved');const after=await get(),rows=Groups.orderedGroups(after);
    assert.equal(rows.find(group=>group.name==='合成向日葵组').memberTotal,100);assert.equal(rows.find(group=>group.name==='合成四叶草组').memberTotal,70);
    assert.deepEqual(after.students.map(immutableStudent),before.students.map(immutableStudent));assert.deepEqual(after.petAccounts,before.petAccounts);assert.deepEqual(after.petLogs,before.petLogs);assert.deepEqual(after.groupBases,before.groupBases);assert.deepEqual(after.settings.groupOrder,before.settings.groupOrder);
    await click('[data-page=groups]');assert.match(await js(`document.querySelector('[data-group-member="${student.id}"]').innerText`),/组长/);
   });
   await check('Concurrent reassignment makes open selection stale and leaves later student group intact',async()=>{
    await manage();await click('[data-do=gt-assign]');await click(`#bulk-group-form [value="${student.id}"]`);await fill('#bulk-group-form [name=group]','合成空组');
    await act({type:'students.group',ids:[student.id],group:'合成向日葵组',panelId:oldPanel});await until(()=>js('!document.querySelector(".gt-stale").hidden'),'assignment stale');const before=await get();
    await js('document.querySelector("#bulk-group-form").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}))');await sleep(80);assert.deepEqual(await get(),before);await close();
   });
   await check('Assignment save failure retains selected students and target and can retry exactly once',async()=>{
    await manage();await click('[data-do=gt-assign]');await click(`#bulk-group-form [value="${student.id}"]`);await fill('#bulk-group-form [name=group]','合成四叶草组');const before=await get(),temp=path.join(dir,'classroom-v2.json.tmp');fs.mkdirSync(temp);
    try{await submit('#bulk-group-form');await until(()=>js('!!document.querySelector("#bulk-group-form")&&!document.querySelector("#bulk-group-form").dataset.saving'),'assignment save failed');assert.deepEqual(await get(),before);assert.equal(await js('document.querySelectorAll("#bulk-group-form [name=student]:checked").length'),1);assert.equal(await js('document.querySelector("#bulk-group-form [name=group]").value'),'合成四叶草组');}finally{fs.rmdirSync(temp);}
    await js('{const form=document.querySelector("#bulk-group-form");form.requestSubmit();form.requestSubmit();}');await until(async()=>(await get()).revision===before.revision+1,'assignment retried');assert.equal((await get()).students[0].group,'合成四叶草组');
   });
   await check('Another window score change refreshes displayed points without discarding selected students or target',async()=>{
    await manage();await click('[data-do=gt-assign]');await click(`#bulk-group-form [value="${student.id}"]`);await fill('#bulk-group-form [name=group]','合成向日葵组');const before=await get();
    await act({type:'score',ids:[student.id],delta:3,reason:'另一窗口合成加分',panelId:oldPanel});
    await until(()=>js(`document.querySelector('#bulk-group-form [value="${student.id}"]').closest('label').querySelector('b').textContent==='${before.students[0].score+3} 分'`),'live points');
    assert.equal(await js(`document.querySelector('#bulk-group-form [value="${student.id}"]').checked`),true);assert.equal(await js('document.querySelector("#bulk-group-form [name=group]").value'),'合成向日葵组');assert.equal(await js('document.querySelector(".gt-stale").hidden'),true);
    const latest=await get();await submit('#bulk-group-form');await until(async()=>(await get()).students[0].group==='合成向日葵组','assignment preserves latest points');const after=await get();
    assert.equal(after.students[0].score,before.students[0].score+3);assert.deepEqual(after.students.map(immutableStudent),latest.students.map(immutableStudent));assert.deepEqual(after.petAccounts,latest.petAccounts);
   });
   await check('Panel switch closes old group editor; all panels retain independent orders, students and graduated pets',async()=>{
    await manage();await click('[data-do=gt-order]');const previous=await get();await act({type:'panel.create',mode:'blank',name:'另一合成面板'});await until(()=>js('!document.querySelector("#gt-order-form")'),'editor closed');const nextPanel=Core.panelId(await get());assert.equal((await get()).settings.groupOrder,undefined);
    await act({type:'group.create',group:'独立面板空组',panelId:nextPanel});await act({type:'group.order',order:['独立面板空组'],expectedOrder:['独立面板空组'],panelId:nextPanel});await act({type:'panel.switch',id:oldPanel});
    const after=await get();assert.deepEqual(after.students,previous.students);assert.deepEqual(after.petAccounts,previous.petAccounts);assert.deepEqual(after.settings.groupOrder,previous.settings.groupOrder);assert.deepEqual(after.panels.others.find(panel=>panel.id===nextPanel).data.settings.groupOrder,['独立面板空组']);
   });
   await check('Full native backup/restore retains every panel order, empty group and individual graduation snapshot',async()=>{
    const filename=path.join(out,'synthetic-group-backup.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:filename});await js('classroom.file({command:"backup"})');const saved=JSON.parse(fs.readFileSync(filename));
    await act({type:'group.create',group:'恢复前临时空组',panelId:oldPanel});await js(`classroom.file({command:'restore-apply',state:${JSON.stringify(saved)}})`);const restored=await get();
    assert.deepEqual(restored.students,saved.students);assert.deepEqual(restored.groupBases,saved.groupBases);assert.deepEqual(restored.settings.groupOrder,saved.settings.groupOrder);assert.deepEqual(restored.petAccounts,saved.petAccounts);assert.deepEqual(restored.panels,saved.panels);
   });
   await check('Replace import preserves empty names at zero base, removes member-only old groups and archives original full data',async()=>{
    const original=await get();
    try{
     await act({type:'group.base',group:'合成空组',delta:17,reason:'合成空组非零基础分',panelId:oldPanel});await act({type:'group.base',group:'合成向日葵组',delta:33,reason:'合成有成员组基础分',panelId:oldPanel});
     const before=await get(),backups=(await js('classroom.file({command:"folder-info"})')).backup,files=new Set(fs.readdirSync(backups)),emptyNames=before.groupBases.filter(group=>!before.students.some(student=>student.group===group.group)).map(group=>group.group);
     await js(`classroom.file({command:'import-apply',mode:'replace',rows:[{name:'替换合成学生',group:'替换名单新小组'}],panelId:${JSON.stringify(oldPanel)}})`);
     const after=await get();assert.deepEqual(after.groupBases,emptyNames.map(group=>({group,score:0})));assert.deepEqual(after.settings.groupOrder,[...before.settings.groupOrder.filter(group=>emptyNames.includes(group)),'替换名单新小组']);assert.deepEqual(after.panels,before.panels);assert.equal(after.students.length,1);assert.equal(after.students[0].score,0);
     const archiveName=fs.readdirSync(backups).find(name=>name.startsWith('before-replace-')&&!files.has(name));assert.ok(archiveName);const archive=JSON.parse(fs.readFileSync(path.join(backups,archiveName)));
     assert.deepEqual(archive,before);assert.ok(archive.students[0].photo);assert.equal(archive.students[0].leader,true);assert.ok(archive.petAccounts[0].graduations.length);
    }finally{await js(`classroom.file({command:'restore-apply',state:${JSON.stringify(original)}})`);}
   });
   await check('Group controls fit 700px viewport with long names and keyboard focus stays on moved row',async()=>{
    await act({type:'group.create',group:'合成小组名称较长用于检查窗口换行和按钮边界',panelId:oldPanel});main.setMinimumSize(360,500);main.setSize(700,700);await until(()=>js('window.innerWidth===700'),'renderer resize to700px');assert.equal(await js('window.innerWidth'),700);await manage();await click('[data-do=gt-order]');
    await click('[data-do=gt-right][data-index="0"]');assert.equal(await js('document.activeElement.closest("[data-gt-index]").dataset.gtIndex'),'1');
    const focusProbe={immediate:await js('({tag:document.activeElement.tagName,action:document.activeElement.dataset.do,row:document.activeElement.closest("[data-gt-index]")?.dataset.gtIndex})')};await sleep(100);focusProbe.after100ms=await js('({tag:document.activeElement.tagName,action:document.activeElement.dataset.do,row:document.activeElement.closest("[data-gt-index]")?.dataset.gtIndex})');fs.writeFileSync(path.join(out,'focus-probe.json'),JSON.stringify(focusProbe,null,2));assert.equal(focusProbe.after100ms.row,'1','deferred modal autofocus must preserve moved-arrow focus');
    assert.equal(await js('document.querySelector("#modal .dialog").scrollWidth<=document.querySelector("#modal .dialog").clientWidth+1'),true);await shot('04-order-700px');await close();
    await manage();await click('[data-do=gt-assign]');assert.equal(await js('document.querySelector("#modal .dialog").scrollWidth<=document.querySelector("#modal .dialog").clientWidth+1'),true);await shot('05-assignment-700px');await close();assert.deepEqual(errors,[]);
   });
   await check('240px score panel exposes group management and reachable order/assignment controls without horizontal overflow',async()=>{
    const panel=BrowserWindow.getAllWindows().find(win=>win.flowerRole==='panel');panel.setSize(240,640);await until(()=>js('window.innerWidth===240',panel),'panel resize to240px');
    const pclick=async selector=>{selector=await ensureToolControl(panel,selector);return js(`document.querySelector(${JSON.stringify(selector)}).click()`,panel);},probes=[],controls=[];
    async function reachable(selector){const rect=await js(`(()=>{const button=document.querySelector(${JSON.stringify(selector)});button.scrollIntoView({block:'center'});const rect=button.getBoundingClientRect();return {selector:${JSON.stringify(selector)},left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,height:innerHeight};})()`,panel);controls.push(rect);assert.ok(rect.left>=0&&rect.right<=240&&rect.top>=0&&rect.bottom<=rect.height,'control can be scrolled fully into view: '+selector);}
    async function measure(stage){
     const metrics=await js('(()=>{const dialog=document.querySelector("#modal .dialog"),rect=dialog.getBoundingClientRect();return {viewport:innerWidth,width:dialog.clientWidth,scrollWidth:dialog.scrollWidth,left:rect.left,right:rect.right,innerOverflow:[...dialog.querySelectorAll(".gt-summary,.gt-order-list,.gt-order-row,.gt-student-list,.gt-student-choice")].filter(node=>node.scrollWidth>node.clientWidth+1).map(node=>({class:node.className,width:node.clientWidth,scrollWidth:node.scrollWidth}))};})()',panel);probes.push({stage,...metrics});await sleep(100);
     fs.writeFileSync(path.join(out,'240px-'+stage+'.png'),(await panel.webContents.capturePage()).toPNG());
    }
    await pclick('[data-do=gt-manage]');await measure('manage');
    await pclick('[data-do=gt-order]');await measure('order');await pclick('[data-do=gt-right][data-index="0"]');
    const beforeCancel=await get();await reachable('#gt-order-form [data-do=gt-manage]');await pclick('#gt-order-form [data-do=gt-manage]');assert.deepEqual(await get(),beforeCancel);
    await pclick('[data-do=gt-order]');await pclick('[data-do=gt-right][data-index="0"]');await reachable('#gt-order-form [type=submit]');await pclick('#gt-order-form [type=submit]');await until(async()=>(await get()).revision===beforeCancel.revision+1,'panel order saved');assert.deepEqual((await get()).settings.groupOrder,Groups.move(beforeCancel.settings.groupOrder,0,1));
    await pclick('[data-do=gt-manage]');
    await pclick('[data-do=gt-assign]');await measure('assign');
    await reachable('#bulk-group-form [data-do=gt-manage]');await pclick('#bulk-group-form [data-do=gt-manage]');await pclick('[data-do=gt-assign]');
    await pclick(`#bulk-group-form [value="${student.id}"]`);await js('(()=>{const select=document.querySelector("#bulk-group-form [name=group]");select.value="合成四叶草组";select.dispatchEvent(new Event("change",{bubbles:true}));})()',panel);await reachable('#bulk-group-form [type=submit]');const beforeAssign=await get();await pclick('#bulk-group-form [type=submit]');await until(async()=>(await get()).revision===beforeAssign.revision+1,'panel assignment saved');const afterAssign=await get();assert.equal(afterAssign.students[0].group,'合成四叶草组');assert.deepEqual(afterAssign.students.map(immutableStudent),beforeAssign.students.map(immutableStudent));
    await pclick('[data-do=gt-manage]');await pclick('[data-do=gt-create]');await measure('create');await reachable('#gt-create-form [data-do=gt-manage]');await reachable('#gt-create-form [type=submit]');await pclick('#modal [data-do=modal-close]');
    fs.writeFileSync(path.join(out,'240px-layout.json'),JSON.stringify({probes,controls},null,2));
    for(const probe of probes){assert.ok(probe.scrollWidth<=probe.width+1,probe.stage+' dialog horizontal overflow '+JSON.stringify(probe));assert.ok(probe.left>=0&&probe.right<=probe.viewport+1,probe.stage+' dialog exceeds viewport');assert.deepEqual(probe.innerOverflow,[],probe.stage+' inner list/row horizontal overflow');}
   });
   fs.writeFileSync(path.join(out,'expected-restart.json'),JSON.stringify(await get()));
  }else await check('New Electron process preserves full multi-panel order, empty groups, IDs/photos/points and pet history',async()=>{assert.deepEqual(await get(),JSON.parse(fs.readFileSync(path.join(out,'expected-restart.json'))));});
  fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify({phase,checks,errors},null,2));app.exit(checks.some(check=>check.status==='failed')?1:0);
 }).catch(error=>{fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify({phase,checks,error:error.stack}));console.error(error.stack);app.exit(2);});
}
