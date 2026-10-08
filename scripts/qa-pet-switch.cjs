'use strict';
const {visibleControl,nativeClick}=require('./qa-tool-control.cjs');
// Isolated, synthetic Electron UI/IPC/storage QA; no source-video images or real student data.
// node scripts/qa-pet-switch.cjs
// FLOWER_PACKAGE_MAIN=/absolute/app.asar/src/main.cjs node scripts/qa-pet-switch.cjs
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),mode=process.env.FLOWER_PACKAGE_MAIN?'packaged':'source';
const out=path.join(root,'artifacts/qa-pet-switch',mode),dataDir=path.join(out,'synthetic-data');
const phase=process.argv.find(v=>v.startsWith('--phase='))?.slice(8);
const mainEntry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs'));
const clone=v=>JSON.parse(JSON.stringify(v)),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const hashes=dir=>Object.fromEntries(fs.readdirSync(dir).sort().filter(n=>fs.statSync(path.join(dir,n)).isFile()).map(n=>[n,sha(fs.readFileSync(path.join(dir,n)))]));
const treeHash=h=>sha(JSON.stringify(h));
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2));
const read=name=>JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));
const id='s_switch_a',idB='s_switch_b',panelId=s=>s.panels?.activeId||'panel_default';
const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALUlEQVR4nGOsWHCCgZaAiaamj1owasGoBaMWjFowasGoBaMWjFowasGoBVQEAEl4AiCcDJG+AAAAAElFTkSuQmCC';
const fixture=()=>({version:1,revision:0,settings:{className:'纯合成换宠专项班',petStep:5,petFocusId:id},students:[
 {id,name:'合成学生A',group:'合成一组',pet:'owl',score:17,growth:0,medals:0,photo},
 {id:idB,name:'合成学生B',group:'合成二组',pet:'cat',score:-3,growth:7,medals:2,photo:''}
],logs:[],draw:{mode:'cycle',bag:[idB],lastIds:[id],round:2},timer:{durationMs:300000,remainingMs:115000,endsAt:null,running:false}});
const independentFixture=()=>{const value=fixture();value.version=2;value.settings.petRules={thresholds:[5,5,5,5,5,5]};value.petLogs=[];value.petAccounts=value.students.map((student,i)=>({id:'pa_switch_'+i,studentId:student.id,mode:'independent',activeCycleId:'pc_switch_'+i,legacyMedals:student.medals||0,unassignedGrowth:0,lifetimeNetGrowth:student.growth,cycles:[{id:'pc_switch_'+i,pet:student.pet,status:'active',netGrowth:student.growth,openedAt:1000000,origin:'explicit-adoption'}],graduations:[],badgeEvents:[]}));return value;};
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 (async()=>{
  fs.rmSync(dataDir,{recursive:true,force:true});fs.mkdirSync(dataDir,{recursive:true});
  fs.writeFileSync(path.join(dataDir,'classroom.json'),JSON.stringify(fixture(),null,2));
  write('legacy-fixture.json',fixture());
  const before=hashes(path.join(root,'src')),results=[],{spawn}=require('node:child_process');
  for(const name of ['flows','restart']){
   const child=spawn(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename,'--phase='+name],{cwd:root,env:{...process.env,FLOWER_HEADLESS_TEST:'1',FLOWER_DATA_DIR:dataDir,XDG_CACHE_HOME:path.join(out,'cache')},stdio:['ignore','pipe','pipe']});
   let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{log+=b;process.stdout.write(b);});
   const exitCode=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});
   fs.writeFileSync(path.join(out,name+'.log'),log);results.push({phase:name,exitCode,report:fs.existsSync(path.join(out,name+'.json'))?read(name+'.json'):null});
   if(exitCode!==0)break;
  }
  const after=hashes(path.join(root,'src')),checks=results.flatMap(r=>r.report?.checks||[]),sourceChanged=JSON.stringify(before)!==JSON.stringify(after);
  const evidence=JSON.parse(fs.readFileSync(path.join(root,'artifacts/reference/supplemental-followup-evidence.json'),'utf8'));
  const result={syntheticOnly:true,createdAt:new Date().toISOString(),mode,mainEntry,execution:'Linux real Electron main/preload/renderer; offscreen UI; native storage; fresh-process restart',results,passed:checks.filter(c=>c.status==='passed').length,failed:checks.filter(c=>c.status==='failed').length,sourceAtStart:before,sourceAtFinish:after,sourceTreeHashAtStart:treeHash(before),sourceTreeHashAtFinish:treeHash(after),sourceChanged,reference:{evidenceId:'F008',source:evidence.sources.episode29,...evidence.evidence.find(e=>e.id==='F008'),interpretation:'Reproduces same-student LV1, initial growth 0/5, badges0 -> reason dialog yellow switch entry -> choose and confirm -> changed appearance, still LV1 and badges0. This app uses original animal artwork, not copied pig artwork. Reference result growth was obscured. Nonzero growth/honors retention is this app compatibility policy, not proven reference behavior. Episode29 is later than target; exact version unknown.'},limits:['Linux Electron offscreen does not establish Windows native, touch, PowerPoint, audio, or physical high-DPI behavior','Reference F008 is the existing anonymized audit record; no new source-video viewing or original student images are claimed','Source hash changes during execution require another frozen-source run','Synthetic full backups remain local in this artifact directory']};
  write('results.json',result);
  fs.writeFileSync(path.join(out,'report.md'),[
   '# 花伴课堂 rc.3 换宠物真实 Electron 专项', '',
   `结果：${result.passed} 项通过，${result.failed} 项失败；${results.length}/2 个新进程阶段完成。`,
   `运行目标：${mainEntry}`,`源码起始 SHA-256：${result.sourceTreeHashAtStart}`,`源码结束 SHA-256：${result.sourceTreeHashAtFinish}`,`测试期间源码变化：${sourceChanged?'是，需冻结后复验':'否'}`, '',
   '所有操作使用真实 main、preload、renderer 与磁盘存档。学生、照片、积分及备份均为隔离合成数据。', '',
   '## 检查',...checks.map(c=>`- ${c.status==='passed'?'通过':'失败'}：${c.name}${c.error?' — '+c.error.split('\n')[0]:''}`),'',
   '## 原片证据边界',
   'F008：第29集 01:29.82→01:32.26→01:37.26→01:42.26，同一学生原小猪形象、LV1、0/5、徽章0；原因弹窗黄色换宠物入口；确认后外形变化，仍LV1、徽章0。本应用用原创猫头鹰→小龙复现此交互闭环，不复制原片小猪图像。',
   '原片结果成长被遮挡；不能把本应用保留非零成长及非零荣誉的兼容策略描述为原版确证。第29集晚于目标，准确版号未知。本次引用既有脱敏审计记录，未重看或保存原片。', '',
   '## 运行边界',...result.limits.map(x=>'- '+x),'',
   '截图对应文件名与逐项数据见 flows.json、restart.json、results.json。人工实际看图记录单独保存于 visual-review.json。',''
  ].join('\n'));
  console.log('PET_SWITCH_RESULT',result.passed,'passed',result.failed,'failed',sourceChanged?'SOURCE_CHANGED':'SOURCE_STABLE');
  process.exitCode=results.length===2&&results.every(r=>r.exitCode===0)&&!sourceChanged?0:1;
 })().catch(e=>{console.error(e.stack);process.exitCode=2;});
}else{
 const {app,BrowserWindow,dialog,session}=require('electron');app.disableHardwareAcceleration();
 const Config=require(path.join(path.dirname(mainEntry),'configuration-model.js'));
 const initialHashes=hashes(path.dirname(mainEntry)),checks=[],errors=[],requests=[],shots=[];let main,pet,pets;
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const js=(code,w=main)=>w.webContents.executeJavaScript(code,true);
 const state=()=>js('classroom.get().then(x=>x.state)');
 const profile=target=>js(`classroom.get().then(x=>PetProgress.profile(x.state,${JSON.stringify(target)}))`);
 const act=(a,w=main)=>js(`classroom.action(${JSON.stringify(a)})`,w);
 const file=a=>js(`classroom.file(${JSON.stringify(a)})`);
 const exists=(selector,w=main)=>js(`!!document.querySelector(${JSON.stringify(selector)})`,w);
 const text=(selector,w=main)=>js(`document.querySelector(${JSON.stringify(selector)})?.innerText||''`,w);
 const click=(selector,w=main)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Absent/disabled '+${JSON.stringify(selector)});e.click();})()`,w);
 const fill=(selector,value,w=main)=>js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Absent input '+${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`,w);
 async function until(fn,label){for(let n=0;n<200;n++){if(await fn())return;await sleep(30);}throw Error('Timed out: '+label);}
 async function close(w=main){await js('document.querySelector("#modal [data-do=modal-close]")?.click();document.querySelector("[data-do=pet-feedback-close]")?.click()',w);}
 async function shot(name,w=main){await Promise.race([js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',w),sleep(500)]);await sleep(180);const image=await w.webContents.capturePage();assert.ok(image.getSize().width>1);const filename=phase+'-'+name+'.png';fs.writeFileSync(path.join(out,filename),image.toPNG());shots.push({name,filename,role:w.flowerRole,width:image.getSize().width,height:image.getSize().height});}
 async function cardShot(name,w=main){await js(`document.querySelector('[data-pet-student="${id}"]')?.scrollIntoView({block:'center'})`,w);await shot(name,w);}
 async function check(name,fn){try{const detail=await fn();checks.push({name,status:'passed',detail});console.log('PASS_PET_SWITCH',name);}catch(e){checks.push({name,status:'failed',error:e.stack});console.error('FAIL_PET_SWITCH',name,e.stack);try{await shot('failure-'+checks.length);}catch{}}}
 async function openWindow(role){await js(`classroom.window({command:'open',role:${JSON.stringify(role)}})`);let w;await until(async()=>{w=BrowserWindow.getAllWindows().find(v=>v.flowerRole===role);return w&&!w.webContents.isLoading()&&await text('#app',w);},'window '+role);return w;}
 async function go(){await close();await click('[data-page=pets]');await click('[data-do=pet-tab][data-tab=students]');}
 async function restore(value){await close();await file({command:'restore-apply',state:value});await go();}
 async function switchDialog(target=id,w=main){await close(w);if(w===main)await go();await click(`[data-do=pet-reward][data-id="${target}"]`,w);await click(`#modal [data-do=pet-switch][data-id="${target}"]`,w);await until(()=>exists('#pet-switch-form',w),'switch form');}
 async function select(kind,w=main){const control=await visibleControl(w,`#pet-switch-form .pet-choice[data-pet="${kind}"]`);assert.ok(control&&!control.disabled,"visible pet choice "+kind);await nativeClick(w,control);await until(()=>js(`document.querySelector("#pet-switch-form [name=pet]:checked")?.value===${JSON.stringify(kind)}`,w),"selected "+kind);}
 async function save(w=main,double=false){await js(`(()=>{const b=document.querySelector('#pet-switch-form [type=submit]');b.click();${double?'b.click();':''}})()`,w);}
 const currentCycle=(s,target=id)=>{const a=s.petAccounts?.find(a=>a.studentId===target);return a?.cycles.find(c=>c.id===a.activeCycleId);};
 function onlyPetChanged(before,after,kind,target=id){const expected=clone(before);expected.version=after.version;expected.revision=before.revision+1;expected.students.find(s=>s.id===target).pet=kind;const cycle=currentCycle(expected,target);if(cycle)cycle.pet=kind;assert.deepEqual(after,expected);}
 async function saved(before,kind,w=main){await until(async()=>(await state()).revision===before.revision+1,'saved once');await until(()=>exists('#pet-switch-form',w).then(x=>!x),'form closes');const after=await state();onlyPetChanged(before,after,kind);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dataDir,'classroom-v2.json'),'utf8')),after);return after;}
 async function staleRejected(before,match,w=main){await save(w);await until(()=>text('#toast',w).then(t=>match.test(t)),'stale rejection');assert.deepEqual(await state(),before);assert.equal(await js('document.querySelector("#pet-switch-form [type=submit]").disabled',w),false);return text('#toast',w);}
 app.on('web-contents-created',(_event,w)=>w.on('console-message',(event,level,message)=>{const severity=event.level??level;if(severity==='error'||severity>=3)errors.push(event.message??message);}));
 require('./package-boundary.cjs')(mainEntry,path.join(out,phase+'-dependency-boundary.json'));require(mainEntry);
 app.whenReady().then(async()=>{try{
  session.defaultSession.webRequest.onCompleted(d=>requests.push(d.url));
  await until(async()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return main&&!main.webContents.isLoading()&&await exists('[data-page=pets]');},'main bootstrap');main.setSize(1440,1000);
  if(phase==='restart'){
   await check('真实新Electron进程恢复换宠后的全部面板、成长、荣誉与照片',async()=>{const expected=read('expected-restart.json'),loaded=await state();assert.deepEqual(loaded,expected);assert.equal((await profile(id)).pet,read('expected-restart-profile.json').pet);assert.deepEqual(await profile(id),read('expected-restart-profile.json'));assert.equal(sha(fs.readFileSync(path.join(dataDir,'classroom.json'))),read('legacy-original-sha.json').sha256);await go();pet=await openWindow('pet');pets=await openWindow('pets');for(const w of [pet,pets])assert.deepEqual(await js('classroom.get().then(x=>x.state)',w),loaded);await cardShot('01-restored-main');await shot('02-restored-floating',pet);});
  }else{
   write('legacy-original-sha.json',{sha256:sha(fs.readFileSync(path.join(dataDir,'classroom.json')))});
   await check('F008交互闭环：同学生LV1、0/5、徽章0，经可见换宠入口确认后形象变而LV1/徽章0保留',async()=>{
    await go();const before=await state(),p=await profile(id);assert.equal(p.level,1);assert.equal(p.current,0);assert.equal(p.needed,5);assert.equal(p.medalTotal,0);const beforeArt=await js(`document.querySelector('[data-pet-student="${id}"] .pet-scene svg').outerHTML`);await cardShot('01-reference-lv1-before');
    await click(`[data-do=pet-reward][data-id="${id}"]`);assert.equal(await text('.reward-students'),'合成学生A');assert.equal(await text('.pet-switch-entry'),'换宠物');const color=await js('getComputedStyle(document.querySelector(".pet-switch-entry")).backgroundColor');assert.equal(color,'rgb(255, 255, 255)');const entry=await visibleControl(main,'.pet-switch-entry');assert.ok(entry&&!entry.disabled,'visible enabled switch entry');await shot('02-reference-secondary-entry');
    await nativeClick(main,await visibleControl(main,'.pet-switch-entry'));await select('dragon');await shot('03-reference-choice');await save();const after=await saved(before,'dragon'),next=await profile(id);assert.equal(next.level,1);assert.equal(next.medalTotal,0);assert.equal(next.growth,0);assert.notEqual(await js(`document.querySelector('[data-pet-student="${id}"] .pet-scene svg').outerHTML`),beforeArt);await cardShot('04-reference-lv1-after');write('reference-before.json',before);write('reference-after.json',after);return {before:{pet:p.pet,level:p.level,current:p.current,needed:p.needed,medals:p.medalTotal},after:{pet:next.pet,level:next.level,current:next.current,needed:next.needed,medals:next.medalTotal},referenceResultGrowthObscured:true,sourceVersionUnknown:true,entryStyle:{reference:"yellow",actual:color,authorizedDifference:"User requested UI hierarchy redesign; secondary white button keeps the named action and complete business flow"}};
   });
   await check('40种卡片逐一浏览与选择、搜索/无结果/清空恢复；取消不写内存或磁盘',async()=>{
    const before=await state(),bytes=fs.readFileSync(path.join(dataDir,'classroom-v2.json'));await switchDialog();const cards=await js('[...document.querySelectorAll("#pet-switch-form .pet-choice")].map(e=>({pet:e.dataset.pet,name:e.querySelector("strong").textContent}))');assert.equal(cards.length,40);assert.equal(new Set(cards.map(c=>c.pet)).size,40);assert.deepEqual(cards.slice(0,20).map(c=>c.pet),['owl','fox','bunny','cat','penguin','panda','bear','dog','deer','squirrel','hedgehog','raccoon','koala','elephant','lion','tiger','dragon','unicorn','otter','seal']);
    for(const card of cards){await js(`document.querySelector('.pet-choice[data-pet="${card.pet}"]').scrollIntoView({block:'nearest'})`);await select(card.pet);assert.equal(await js('document.querySelector("#pet-switch-form input:checked").value'),card.pet);assert.equal(await js('document.querySelector("#pet-switch-form .pet-choice.chosen").dataset.pet'),card.pet);assert.match(await text('#pet-choice-summary'),new RegExp(card.name));}
    await shot('05-all40-last-row');await fill('#pet-choice-search','小龙');assert.equal(await js('document.querySelectorAll(".pet-choice:not([hidden])").length'),1);assert.equal(await js('document.querySelector(".pet-choice:not([hidden])").dataset.pet'),'dragon');await shot('06-search');await fill('#pet-choice-search','不存在的合成物种');assert.equal(await js('document.querySelectorAll(".pet-choice:not([hidden])").length'),0);assert.equal(await js('document.querySelector("#pet-choice-empty").hidden'),false);await fill('#pet-choice-search','');assert.equal(await js('document.querySelectorAll(".pet-choice:not([hidden])").length'),40);await close();assert.deepEqual(await state(),before);assert.deepEqual(fs.readFileSync(path.join(dataDir,'classroom-v2.json')),bytes);return cards;
   });
   await check('重复确认只保存一次，旧版非零成长与积分照片及其他学生完整保留',async()=>{await switchDialog(idB);const before=await state(),p=await profile(idB);await select('seal');await save(main,true);await until(async()=>(await state()).revision===before.revision+1,'double save');await sleep(180);onlyPetChanged(before,await state(),'seal',idB);const after=await profile(idB);for(const key of ['growth','level','current','needed','medalTotal'])assert.equal(after[key],p[key]);return {before:p,after};});
   await check('真实存档失败显示错误、保留选择且可重试；重试只换宠一次',async()=>{
    await switchDialog();await select('penguin');const before=await state(),filename=path.join(dataDir,'classroom-v2.json'),bytes=fs.readFileSync(filename);fs.mkdirSync(filename+'.tmp');try{await save();await until(()=>text('#toast').then(t=>/EISDIR/.test(t)),'visible EISDIR');assert.deepEqual(await state(),before);assert.deepEqual(fs.readFileSync(filename),bytes);assert.equal(await js('document.querySelector("#pet-switch-form [type=submit]").disabled'),false);assert.equal(await js('document.querySelector("#pet-switch-form input:checked").value'),'penguin');await shot('07-failed-save-retry');}finally{fs.rmdirSync(filename+'.tmp');}await save(main,true);await saved(before,'penguin');
   });
   // Build a nonzero independent account with one immutable graduation through real IPC.
   await restore(independentFixture());assert.equal((await profile(id)).mode,'independent');await act({type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]});await act({type:'pet.growth',ids:[id],delta:30,reason:'合成首轮毕业成长'});await act({type:'pet.graduate',id});await act({type:'pet.adopt',id,pet:'fox'});await act({type:'pet.growth',ids:[id],delta:8,reason:'合成第二轮成长'});await act({type:'score',ids:[id],delta:4,reason:'合成普通积分'});await go();const independent=await state();write('independent-baseline.json',independent);
   pet=await openWindow('pet');pets=await openWindow('pets');
   await check('独立模式换宠只改student.pet和当前cycle.pet，保留非零成长等级、普通积分、徽章、历史与毕业快照',async()=>{
    const before=await state(),p=await profile(id);assert.equal(p.growth,8);assert.equal(p.level,2);assert.equal(p.medalTotal,1);assert.equal(p.graduates.length,1);await switchDialog();await select('seal');await save(main,true);const after=await saved(before,'seal'),next=await profile(id);for(const key of ['growth','level','current','needed','medalTotal','lifetimeNetGrowth','activeCycleId','graduates'])assert.deepEqual(next[key],p[key],key);await cardShot('08-nonzero-preserved');write('nonzero-before.json',before);write('nonzero-after.json',after);return {compatibilityPolicy:true,before:p,after:next};
   });
   await check('打开选择后另一真实窗口追加成长，提交保留最新成长与等级',async()=>{
    await restore(independent);await switchDialog();await select('dragon');const opened=await profile(id);await act({type:'pet.growth',ids:[id],delta:5,reason:'合成另窗追加成长'},pet);const before=await state();assert.equal((await profile(id)).growth,opened.growth+5);await save();await saved(before,'dragon');assert.equal((await profile(id)).growth,13);assert.equal((await profile(id)).level,3);for(const w of [pet,pets])assert.deepEqual(await js('classroom.get().then(x=>x.state)',w),await state());return {growthAtOpen:8,growthAtSubmit:13,finalGrowth:13};
   });
   await check('另一真实窗口先换宠，旧弹窗拒绝覆盖，保留另窗结果',async()=>{
    await restore(independent);await switchDialog();await select('dragon');await switchDialog(id,pet);await select('panda',pet);const initial=await state();await save(pet);await saved(initial,'panda',pet);const before=await state();const message=await staleRejected(before,/伙伴或成长周期已经变化/);await shot('09-stale-pet-rejected');return {message,pet:(await profile(id)).pet};
   });
   await check('另一窗毕业导致旧弹窗拒绝，随后同物种新周期仍拒绝旧周期提交',async()=>{
    await restore(independent);await switchDialog();await select('dragon');const oldCycle=(await profile(id)).activeCycleId;await act({type:'pet.growth',ids:[id],delta:22,reason:'合成另窗达到毕业'},pet);await act({type:'pet.graduate',id},pet);const graduated=await state();await js('document.querySelector("[data-do=pet-feedback-close]")?.click()');const first=await staleRejected(graduated,/尚未领养/);await act({type:'pet.adopt',id,pet:'fox'},pet);const adopted=await state();assert.notEqual((await profile(id)).activeCycleId,oldCycle);const second=await staleRejected(adopted,/伙伴或成长周期已经变化/);assert.equal((await profile(id)).growth,0);await shot('10-stale-cycle-rejected');return {graduationRejection:first,newCycleRejection:second,oldCycle,newCycle:(await profile(id)).activeCycleId};
   });
   await check('跨面板切换关闭所有旧选择弹窗，旧请求被主进程拒绝且两面板数据不串写',async()=>{
    await restore(independent);await switchDialog();await switchDialog(id,pet);const old=await state(),p=await profile(id),stale={type:'pet.switch',id,pet:'dragon',panelId:panelId(old),expectedPet:p.pet,expectedCycleId:p.activeCycleId};await act({type:'panel.create',mode:'copy',name:'纯合成换宠副板'},pets);await until(async()=>!await exists('#pet-switch-form')&&!await exists('#pet-switch-form',pet),'all old modals closed');const before=await state();await assert.rejects(act(stale,pet),/面板已切换/);assert.deepEqual(await state(),before);const otherId=panelId(before);await act({type:'panel.switch',id:panelId(old)},pet);const restored=await state();assert.deepEqual(restored.students,old.students);assert.deepEqual(restored.petAccounts,old.petAccounts);assert.deepEqual(restored.panels.others.find(p=>p.id===otherId).data.students,before.students);assert.deepEqual(restored.panels.others.find(p=>p.id===otherId).data.petAccounts,before.petAccounts);return {originalPanel:panelId(old),copyPanel:otherId};
   });
   await check('300像素悬浮宠物窗可浏览搜索并真实保存，700像素课堂展示窗可打开取消',async()=>{
    pet.setSize(300,590);pets.setSize(700,680);await switchDialog(id,pet);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth',pet),true);await fill('#pet-choice-search','海豹',pet);assert.equal(await js('document.querySelectorAll(".pet-choice:not([hidden])").length',pet),1);await select('seal',pet);await until(()=>js('!document.querySelector("#toast").classList.contains("show")',pet),'floating toast naturally expires');await shot('11-floating300-picker',pet);const before=await state();await save(pet);await saved(before,'seal',pet);await switchDialog(id,pets);assert.equal(await js('document.documentElement.scrollWidth<=innerWidth',pets),true);await shot('12-classroom700-picker',pets);const canceled=await state();await close(pets);assert.deepEqual(await state(),canceled);
   });
   await check('真实完整备份与恢复保持所有换宠数据，准备新进程重启且原旧档字节不变',async()=>{
    await go();const before=await state(),backup=path.join(out,'complete-backup.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:backup});await file({command:'backup'});assert.deepEqual(read('complete-backup.json'),before);await switchDialog();await select('unicorn');await save();await saved(before,'unicorn');dialog.showOpenDialog=async()=>({canceled:false,filePaths:[backup]});
    const current=await state(),backupBytes=fs.readFileSync(backup),diskBytes=fs.readFileSync(path.join(dataDir,'classroom-v2.json'));
    const preview=await file({command:'restore-preview'}),{restoreToken,restoreConfiguration,expectedRevision,...incoming}=preview;
    assert.deepEqual(incoming,before);assert.equal(typeof restoreToken,'string');assert.ok(restoreToken.length);assert.equal(restoreConfiguration.kind,'restore');assert.equal(expectedRevision,current.revision);
    assert.deepEqual(await state(),current);assert.deepEqual(fs.readFileSync(path.join(dataDir,'classroom-v2.json')),diskBytes);assert.deepEqual(fs.readFileSync(backup),backupBytes);
    const result=await file({command:'restore-apply',state:incoming,restoreToken,expectedRevision});
    // RC18 materializes only effective configuration defaults on copied panels.
    // Full-state equality below still covers every student, photo, ledger and history field.
    const expected=Config.apply(clone(before),Config.snapshot(before));expected.revision=current.revision+1;assert.deepEqual(result,expected);assert.deepEqual(fs.readFileSync(backup),backupBytes);assert.deepEqual(await state(),result);assert.equal(sha(fs.readFileSync(path.join(dataDir,'classroom.json'))),read('legacy-original-sha.json').sha256);write('expected-restart.json',result);write('expected-restart-profile.json',await profile(id));await cardShot('13-backup-restored');return {backup:'complete-backup.json',panels:1+(result.panels?.others.length||0),pet:(await profile(id)).pet,growth:(await profile(id)).growth,medals:(await profile(id)).medalTotal};
   });
  }
  await check('无renderer错误、无远程资源请求，应用源码起止哈希一致',async()=>{assert.deepEqual(errors,[]);assert.deepEqual(requests.filter(u=>!u.startsWith('file:')&&!u.startsWith('data:')),[]);assert.deepEqual(hashes(path.dirname(mainEntry)),initialHashes);return {sourceTreeSha256:treeHash(initialHashes)};});
  write(phase+'.json',{phase,mode,mainEntry,checks,errors,requests,shots,syntheticOnly:true,sourceAtStart:initialHashes,sourceAtFinish:hashes(path.dirname(mainEntry)),sourceTreeHashAtStart:treeHash(initialHashes),sourceTreeHashAtFinish:treeHash(hashes(path.dirname(mainEntry)))});app.exit(checks.some(c=>c.status==='failed')?1:0);
 }catch(e){write(phase+'.json',{phase,mode,checks,errors,shots,fatal:e.stack,sourceAtStart:initialHashes,sourceAtFinish:hashes(path.dirname(mainEntry))});console.error('FATAL_PET_SWITCH',e.stack);app.exit(2);}});
 setTimeout(()=>{console.error('TIMEOUT_PET_SWITCH',phase);app.exit(3);},150000);
}
