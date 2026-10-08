'use strict';
// Fresh bounded cross-feature audit. Runtime is exclusively the delivered ASAR.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),out=path.join(root,'artifacts/reaudit-rc15/interactions');
const archive='/tmp/flower-classroom-workspace/flower-rc15-reaudit-20261007/payload/花伴课堂/resources/app.asar';
const entry=archive+'/src/main.cjs',expectedHash='193ae2b1be926229478b41dad5abf6222e6c7ca2df5e7d53e04b34aa85ee064a';
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'flower-fresh-interactions-'));
 for(const phase of ['audit','restart']){
  const p=require('node:child_process').spawnSync(require(path.join(root,'node_modules/electron')),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:220000,maxBuffer:8e6,env:{...process.env,FLOWER_HEADLESS_TEST:'1',FLOWER_DATA_DIR:data,FLOWER_EXTERNAL_RESOURCE_DIR:path.join(data,'resources'),FLOWER_AUDIT_PHASE:phase,XDG_CACHE_HOME:'/tmp/flower-interactions-cache'}});
  fs.writeFileSync(path.join(out,phase+'.log'),(p.stdout||'')+(p.stderr||''));console.log((p.stdout||'').split('\n').filter(l=>/^(PASS|FAIL|FATAL|SUMMARY)/.test(l)).join('\n'));if(p.status!==0)process.exitCode=1;
 }
}else{
 const {app,BrowserWindow,ipcMain,dialog,session}=require('electron');app.disableHardwareAcceleration();
 const hash=()=>crypto.createHash('sha256').update(require('original-fs').readFileSync(archive)).digest('hex');assert.equal(hash(),expectedHash);
 const phase=process.env.FLOWER_AUDIT_PHASE,checks=[],errors=[],requests=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
 require(path.join(root,'scripts/package-boundary.cjs'))(entry,path.join(out,phase+'-dependency-boundary.json'));
 const C=require(archive+'/src/core.cjs'),P=require(archive+'/src/pet-progress.js'),Art=require(archive+'/src/pet-art.js'),CT=require(archive+'/src/classroom-tools.js'),TX=require(archive+'/src/toolbox-extra.js');
 const {ensureToolControl,visibleControl,nativeClick}=require(path.join(root,'scripts/qa-tool-control.cjs'));
 let main,other,gate=null;const clone=v=>JSON.parse(JSON.stringify(v));
 let base=C.createInitialState();base.students=base.students.slice(0,4).map((s,i)=>({...s,id:'ix_'+i,name:'纯合成交互同学'+i,group:'合成'+(i<2?'甲':'乙')+'组',score:0,growth:0,photo:'',medals:3}));base.settings.className='纯合成交互审计';base=C.applyAction(base,{type:'pet.stage-rules',thresholds:[2,3,4,5,6,7]});
 if(phase==='audit')fs.writeFileSync(path.join(process.env.FLOWER_DATA_DIR,'classroom-v2.json'),JSON.stringify(base));
 const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(ch,fn)=>handle(ch,ch==='state:action'?async(e,a)=>{requests.push({sender:e.sender.id,action:a});if(gate&&gate.sender===e.sender.id&&gate.type===a.type){const g=gate;g.entered=true;if(g.phase==='before')await g.promise;const result=await fn(e,a);g.committed=true;if(g.phase==='after')await g.promise;if(g.phase==='lose')throw Error('SYNTHETIC_RESPONSE_LOSS_AFTER_COMMIT');return result;}return fn(e,a);}:fn);
 const js=(s,w=main)=>w.webContents.executeJavaScript(s,true),get=(w=main)=>js('classroom.get().then(r=>r.state)',w),disk=()=>JSON.parse(fs.readFileSync(path.join(process.env.FLOWER_DATA_DIR,'classroom-v2.json')));
 async function until(f,label='condition'){for(let i=0;i<200;i++){if(await f())return;await wait(20);}throw Error('Timeout '+label);}
 async function click(s,w=main){s=await ensureToolControl(w,s);const target=await visibleControl(w,s);assert.ok(target&&!target.disabled,'Visible enabled target '+s);const z=w.webContents.getZoomFactor();await nativeClick(w,{...target,x:target.x*z,y:target.y*z});await wait(60);}
 const fill=(s,v,w=main)=>js('(()=>{const e=document.querySelector('+JSON.stringify(s)+');if(!e)throw Error("Missing input");e.value='+JSON.stringify(String(v))+';e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));})()',w);
 async function close(w=main){for(let i=0;i<4;i++){if(!await js('!!document.querySelector("#modal .dialog,#pet-feedback .pet-celebration")',w))break;for(const type of ['keyDown','keyUp'])w.webContents.sendInputEvent({type,keyCode:'Escape'});await wait(40);}}
 async function action(a,w=other){const current=await get(w);a={...(a.type.startsWith('classroom.')?CT.expectation(current):a.type.startsWith('toolbox.')?TX.expectation(current):{}),panelId:C.panelId(current),...a};const s=await js('classroom.action('+JSON.stringify(a)+')',w);await wait(80);assert.deepEqual(disk(),s);return s;}
 async function restore(s=base){if(gate){gate.release();gate=null;}await close();await close(other);await js('classroom.file('+JSON.stringify({command:'restore-apply',state:s})+')',other);await wait(80);await click('[data-page=students]');}
 function delay(type,p='before'){let release;const promise=new Promise(r=>release=r);return gate={sender:main.webContents.id,type,phase:p,promise,release,entered:false,committed:false};}
 async function tool(name,child){await close();await click('[data-do=cw-toolbox]');await click('[data-do='+name+']');if(child)await click('[data-do='+child+']');}
 async function wallet(id='ix_0'){await close();await click('[data-page=pets]');await click('[data-do=pet-honors]');await click('[data-do=px-wallet]');if(await js('!!document.querySelector(".px-owner-list")'))await click('[data-do=px-wallet][data-id='+id+']');}
 function report(){fs.writeFileSync(path.join(out,phase+'-results.json'),JSON.stringify({phase,entry,archiveSha256:hash(),archiveUnchanged:hash()===expectedHash,syntheticOnly:true,windowsExecuted:false,platform:process.platform,electron:process.versions.electron,checks,errors,requests},null,2));}
 async function check(name,fn){const detail={};try{await fn(detail);checks.push({name,status:'passed',detail});console.log('PASS',name);}catch(e){checks.push({name,status:'failed',detail,error:e.stack,actual:e.actual,expected:e.expected});console.log('FAIL',name,e.message);try{fs.writeFileSync(path.join(out,'failure-'+checks.length+'.png'),(await main.webContents.capturePage()).toPNG());}catch{}main.webContents.setZoomFactor(1);main.setContentSize(1220,840);}report();}
 app.on('web-contents-created',(_e,w)=>w.on('console-message',e=>{if(e.level==='error')errors.push({id:w.id,message:e.message});}));
 require(entry);const timer=setTimeout(()=>{report();app.exit(3);},210000);
 app.whenReady().then(async()=>{try{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>{errors.push({unexpectedNetwork:d.url});cb({cancel:true});});
  await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return main&&!main.webContents.isLoading();});await until(()=>js('typeof state!=="undefined"&&!!state'));main.setContentSize(1220,840);
  if(phase==='restart'){await check('Fresh process preserves full final mixed ledger and ordinary-tool state exactly',async d=>{const expected=JSON.parse(fs.readFileSync(path.join(out,'expected-restart.json')));assert.deepEqual(await get(),expected);assert.deepEqual(disk(),expected);d.revision=expected.revision;d.students=expected.students.length;assert.equal(await js('!!document.querySelector("#modal .dialog")'),false);});clearTimeout(timer);report();app.exit(checks.some(c=>c.status==='failed')?1:0);return;}
  await js('classroom.window({command:"open",role:"panel"})');await until(()=>{other=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='panel');return other&&!other.webContents.isLoading();});await until(()=>js('typeof state!=="undefined"&&!!state',other));
  await check('40 species: mixed linked/independent cycles, uneven seven-stage thresholds, switch, graduate, redeem, re-adopt and old-history undo',async d=>{
   d.species=[];const names=Object.keys(Art.names);assert.equal(names.length,40);
   for(const [index,pet]of names.entries()){
    let s=C.createInitialState();s.students=s.students.slice(0,2).map((v,i)=>({...v,id:'mx_'+i,name:'合成'+pet+i,pet,score:0,growth:0,photo:''}));
    const a=x=>s=C.applyAction(s,{panelId:C.panelId(s),...x},1800000000000+index),p=id=>P.profile(s,id),ids=s.students.map(v=>v.id);
    a({type:'score',ids,delta:3,reason:'合成启用前混合'});const old=s.logs.at(-1).id;a({type:'pet.stage-rules',thresholds:[2,3,4,5,6,7]});
    a({type:'student.update',id:ids[1],adopted:false});a({type:'pet.adopt',id:ids[1],pet});
    // Explicitly adopted new students are independent; enabling inherited students stays linked.
    a({type:'student.add',name:'合成独立'+pet,pet,adopted:true});const independent=s.students.at(-1).id;
    const initialIndependent=p(independent).growth;a({type:'score',ids:[ids[0],independent],delta:4,reason:'合成混合积分'});const linkedScore=s.logs.at(-1).id;
    assert.equal(p(ids[0]).growth,7);assert.equal(p(independent).growth,initialIndependent);assert.equal(p(independent).isEgg,true);
    let total=0;for(const gain of [1,1,3,4,5,6,7]){total+=gain;a({type:'pet.growth',ids:[independent],delta:gain,reason:'合成分段'});assert.equal(p(independent).growth,total);assert.equal(p(independent).level,Math.min(7,[0,2,5,9,14,20,27].filter(v=>v<=total).length));}
    const previous=p(independent);a({type:'pet.switch',id:independent,pet:names[(index+13)%40],expectedPet:pet,expectedCycleId:previous.activeCycleId});assert.equal(p(independent).growth,27);
    const growthLog=s.petLogs.at(-1).id;a({type:'pet.graduate',id:independent});assert.equal(p(independent).medalTotal,1);const graduates=clone(p(independent).graduates);
    a({type:'pet.badge.redeem',id:independent,amount:1,reason:'合成兑换',requestId:'mx_redeem_'+index,expectedRevision:s.revision});const redemption=s.petAccounts.find(v=>v.studentId===independent).badgeTransactions[0].id;
    a({type:'pet.adopt',id:independent,pet});a({type:'pet.growth',ids:[independent],delta:1,reason:'合成新周期'});const newCycle=p(independent).activeCycleId;
    a({type:'pet.undo',logId:growthLog});a({type:'undo',logId:linkedScore});a({type:'undo',logId:old});assert.equal(p(ids[0]).growth,0);assert.equal(p(independent).growth,1);assert.equal(p(independent).activeCycleId,newCycle);assert.deepEqual(p(independent).graduates,graduates);assert.equal(p(independent).medalAvailable,0);
    a({type:'pet.badge.undo',id:independent,redemptionId:redemption,requestId:'mx_undo_'+index,expectedRevision:s.revision});assert.equal(p(independent).medalAvailable,1);assert.deepEqual(C.validateState(clone(s)),s);
    d.species.push({pet,revision:s.revision,level:p(independent).level,graduations:p(independent).graduates.length,newGrowth:p(independent).growth,medalAvailable:p(independent).medalAvailable});
   }
  });
  for(const variant of ['groups/single','students/single','groups/uniform','students/uniform','groups/batch','students/batch']){const [scope,kind]=variant.split('/');await check('Delayed '+scope+' '+kind+' draw reward versus another window resetting the draw',async d=>{
   await restore();await action({type:'draw',scope,count:1,mode:'cycle'});await click('[data-page=draw]');const before=await get(),picked=before.draw.lastIds;d.picked=picked;const row=scope==='groups'?'group:'+before.draw.groups[0].group:picked[0];await fill('[data-draw-score='+JSON.stringify(row)+']',3);
   if(kind==='uniform')await fill('#draw-uniform-delta',3);const g=delay(kind==='batch'?'score.mixed':'score');await click(kind==='batch'?'[data-do=draw-reward-batch]':kind==='uniform'?'[data-do=reward-picked]':scope==='groups'?'[data-do=draw-reward-group]':'[data-do=draw-reward][data-id='+picked[0]+']');await until(()=>g.entered);await action({type:'draw.reset'});const reset=await get();g.release();gate=null;await wait(200);d.resetRevision=reset.revision;d.after=await get();d.disk=disk();assert.deepEqual(d.disk,d.after);assert.deepEqual(d.after,reset,'A reward from the obsolete draw committed after reset');
  });}
  await check('Badge save response loss followed by unrelated attendance does not duplicate redemption',async d=>{
   await restore();await wallet();await fill('#px-wallet-form [name=reason]','纯合成响应丢失');const g=delay('pet.badge.redeem','lose');await click('#px-wallet-form [type=submit]');await until(()=>g.committed);gate=null;await wait(100);assert.equal(P.profile(await get(),'ix_0').medalAvailable,2);await tool('ct-attendance');await click('[data-do=ct-attendance-toggle][data-id=ix_1]');const s=await get();d.transactions=s.petAccounts[0].badgeTransactions;assert.equal(d.transactions.length,1);assert.deepEqual(CT.snapshot(s).attendance.presentIds,['ix_1']);assert.deepEqual(disk(),s);
  });
  await check('Pending wallet save closed by Escape preserves a replacement ordinary-tool draft',async d=>{
   await restore();await wallet();await fill('#px-wallet-form [name=reason]','纯合成迟返回');const g=delay('pet.badge.redeem','after');await click('#px-wallet-form [type=submit]');await until(()=>g.committed);await close();await tool('tx-homework');await click('[data-do=tx-task-new]');await fill('#tx-task-form [name=title]','纯合成稍后新作业');g.release();gate=null;await wait(180);d.newDraft=await js('document.querySelector("#tx-task-form [name=title]")?.value');assert.equal(d.newDraft,'纯合成稍后新作业');assert.equal(P.profile(await get(),'ix_0').medalAvailable,2);await close();
  });
  await check('Same-ID restore invalidates queued wallet redemption even when revision and balance coincide',async d=>{
   await restore();await wallet();await fill('#px-wallet-form [name=reason]','纯合成旧备份兑换');const g=delay('pet.badge.redeem');await click('#px-wallet-form [type=submit]');await until(()=>g.entered);const previous=await get();await js('classroom.file('+JSON.stringify({command:'restore-apply',state:previous})+')',other);const restored=await get();g.release();gate=null;await wait(180);assert.deepEqual(await get(),restored);d.toast=await js('document.querySelector("#toast").textContent');assert.equal(P.profile(restored,'ix_0').medalAvailable,3);
  });
  await check('Two windows redeem same displayed balance concurrently without overdraft',async d=>{
   await restore();const before=await get(),a={type:'pet.badge.redeem',id:'ix_0',amount:2,reason:'纯合成并发',expectedRevision:before.revision};const result=await Promise.allSettled([js('classroom.action('+JSON.stringify({...a,requestId:'ix_concurrent_a'})+')'),js('classroom.action('+JSON.stringify({...a,requestId:'ix_concurrent_b'})+')',other)]);d.results=result.map(r=>({status:r.status,error:r.reason?.message}));assert.equal(result.filter(r=>r.status==='fulfilled').length,1);const s=await get();assert.equal(P.profile(s,'ix_0').medalAvailable,1);assert.equal(s.petAccounts[0].badgeTransactions.length,1);assert.deepEqual(disk(),s);
  });
  await check('Ordinary tool nested views at 200 percent zoom have usable close and Escape without data writes',async d=>{
   await restore();const before=await get();main.setContentSize(960,680);d.views=[];
   for(const name of ['ct-vote','ct-attendance','tx-homework','tx-portal']){main.webContents.setZoomFactor(1);await tool(name);main.webContents.setZoomFactor(2);await wait(60);const v=await js('(()=>{const b=document.querySelector("#modal .dialog-header [data-do=modal-close]"),r=b.getBoundingClientRect(),d=document.querySelector("#modal .dialog");return {width:innerWidth,height:innerHeight,close:{x:r.x,y:r.y,w:r.width,h:r.height},dialogWidth:d.clientWidth,scrollWidth:d.scrollWidth}})()');d.views.push({name,...v});fs.writeFileSync(path.join(out,'200percent-'+name+'.png'),(await main.webContents.capturePage()).toPNG());assert.ok(v.close.y>=0&&v.close.y+v.close.h<=v.height,'Close button vertical visibility '+name);assert.ok(await visibleControl(main,'#modal .dialog-header [data-do=modal-close]'),'Close pointer target '+name);await close();assert.equal(await js('!!document.querySelector("#modal .dialog")'),false);}
   assert.deepEqual(await get(),before);fs.writeFileSync(path.join(out,'200percent-tools.png'),(await main.webContents.capturePage()).toPNG());main.webContents.setZoomFactor(1);main.setContentSize(1220,840);
  });
  await check('Canceled native roster dialog late completion leaves a replacement vote selection unchanged',async d=>{
   await restore();await click('[data-page=settings]');let release,entered=false;const original=dialog.showOpenDialog;dialog.showOpenDialog=async()=>{entered=true;return new Promise(r=>release=r);};
   try{await click('[data-do=import]');await until(()=>entered);await tool('ct-vote');await click('[data-do=ct-candidate][data-id=ix_0]');await click('[data-do=ct-candidate][data-id=ix_2]');const before=await get();release({canceled:true,filePaths:[]});await wait(180);d.selected=await js('[...document.querySelectorAll(".ct-selected")].map(e=>e.dataset.id)');assert.deepEqual(d.selected,['ix_0','ix_2']);assert.deepEqual(await get(),before);}finally{dialog.showOpenDialog=original;if(release)release({canceled:true,filePaths:[]});}
  });
  await check('Mixed ordinary tool and pet state persists with every final renderer converged',async d=>{
   await restore();await action({type:'pet.growth',ids:['ix_0'],delta:27,reason:'纯合成最终成长'});await action({type:'pet.graduate',id:'ix_0'});await action({type:'pet.adopt',id:'ix_0',pet:'dragon'});await action({type:'pet.growth',ids:['ix_0'],delta:1,reason:'纯合成新伙伴'});await action({type:'classroom.attendance.set',id:'ix_2',present:true});await action({type:'classroom.vote.start',ids:['ix_0','ix_2']});await action({type:'classroom.vote.adjust',id:'ix_0',delta:1});await action({type:'toolbox.homework.add',id:'ix_final_task',title:'纯合成持久作业',subject:'语文',date:'2026-10-07'});await action({type:'timer.set',seconds:1});await action({type:'timer.start'});await wait(1300);await close();const s=await get();assert.deepEqual(await get(other),s);assert.deepEqual(disk(),s);fs.writeFileSync(path.join(out,'expected-restart.json'),JSON.stringify(s,null,2));d.revision=s.revision;d.newCycle=P.profile(s,'ix_0').activeCycleId;
  });
  await check('ASAR unchanged and no renderer errors or external network',async()=>{assert.equal(hash(),expectedHash);assert.deepEqual(errors,[]);});
  console.log('SUMMARY',checks.filter(c=>c.status==='passed').length,'passed',checks.filter(c=>c.status==='failed').length,'failed');report();clearTimeout(timer);app.exit(checks.some(c=>c.status==='failed')?1:0);
 }catch(e){console.log('FATAL',e.stack);errors.push({fatal:e.stack});report();clearTimeout(timer);app.exit(2);}});
}
