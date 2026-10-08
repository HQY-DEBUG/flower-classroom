'use strict';
// Abrupt process termination around real save boundaries; not a power-loss claim.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.FLOWER_CRASH_OUT||path.join(root,'artifacts/rc10/crash-review'));
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const results=[];
 for(const boundary of ['temp-fsynced','before-rename','after-rename','before-notify']){
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'flower-crash-rc10-'));
  for(const phase of ['terminate','reopen']){
   const r=require('node:child_process').spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,env:{...process.env,FLOWER_DATA_DIR:data,FLOWER_HEADLESS_TEST:'1',FLOWER_CRASH_BOUNDARY:boundary,FLOWER_CRASH_PHASE:phase}});
   fs.writeFileSync(path.join(out,boundary+'-'+phase+'.log'),(r.stdout||'')+(r.stderr||''));
   const resultFile=path.join(out,boundary+'-'+phase+'.json');results.push({boundary,phase,exitCode:r.status,signal:r.signal,expectedExit:phase==='terminate'?null:0,expectedSignal:phase==='terminate'?'SIGKILL':null,result:fs.existsSync(resultFile)?JSON.parse(fs.readFileSync(resultFile)):null});
   console.log(boundary,phase,r.status);
  }
 }
 const record={syntheticOnly:true,windowsExecuted:false,scope:'Abrupt application process exit, not filesystem power loss',results};fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(record,null,2));process.exitCode=results.some(r=>r.exitCode!==r.expectedExit||r.signal!==r.expectedSignal)?1:0;
}else{
 const {app,BrowserWindow}=require('electron');app.disableHardwareAcceleration();const entry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs')),src=path.dirname(entry),boundary=process.env.FLOWER_CRASH_BOUNDARY,phase=process.env.FLOWER_CRASH_PHASE,data=process.env.FLOWER_DATA_DIR;
 require('./package-boundary.cjs')(entry,path.join(out,'boundary-'+boundary+'-'+phase+'.json'));
 const C=require(path.join(src,'core.cjs')),file=path.join(data,'classroom-v2.json'),fixture=path.join(data,'synthetic-fixture.json'),checks=[];
 let initial;
 if(phase==='terminate'){
  initial=C.createInitialState();initial.students=initial.students.slice(0,3).map((s,i)=>({...s,name:'合成重启同学'+(i+1)}));initial.settings.className='合成重启原班';initial=C.applyAction(initial,{type:'score',ids:[initial.students[0].id],delta:7});initial=C.applyAction(initial,{type:'panel.create',mode:'full',name:'合成重启副班'});initial=C.applyAction(initial,{type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]});initial.version=2;
  fs.writeFileSync(file,JSON.stringify(initial));fs.writeFileSync(fixture,JSON.stringify(initial));
 }else initial=JSON.parse(fs.readFileSync(fixture));
 // Initialization happens before the injection is armed. Keep the raw fixture
 // and compare against only the declared configuration migration additions.
 initial=require('./qa-rc18-inherited-contract.cjs').bootstrapExpected(initial,src);
 const snapshot=()=>fs.writeFileSync(path.join(out,boundary+'-'+phase+'.json'),JSON.stringify({entry,boundary,phase,checks,syntheticOnly:true,windowsExecuted:false},null,2));
 const stop=()=>{snapshot();process.kill(process.pid,'SIGKILL');throw Error('Unreachable after self-termination');};let armed=false;
 if(phase==='terminate'){
  const open=fs.openSync,fsync=fs.fsyncSync,rename=fs.renameSync;const descriptors=new Map();
  fs.openSync=function(p,...args){const fd=open.call(this,p,...args);descriptors.set(fd,p);return fd;};
  fs.fsyncSync=function(fd){const r=fsync.call(this,fd);if(armed&&boundary==='temp-fsynced'&&descriptors.get(fd)===file+'.tmp')stop();return r;};
  fs.renameSync=function(from,to){if(armed&&to===file&&boundary==='before-rename')stop();const r=rename.call(this,from,to);if(armed&&to===file&&boundary==='after-rename')stop();return r;};
 }
 const wait=ms=>new Promise(r=>setTimeout(r,ms));let main;const js=code=>main.webContents.executeJavaScript(code,true),get=()=>js('classroom.get().then(r=>r.state)'),act=a=>js('classroom.action('+JSON.stringify(a)+')');
 const check=async(name,fn)=>{try{await fn();checks.push({name,status:'passed'});}catch(e){checks.push({name,status:'failed',error:e.stack});}};
 require(entry);
 app.whenReady().then(async()=>{try{
  for(let i=0;i<250;i++){main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');if(main&&!main.webContents.isLoading()){try{if(await js('!!state'))break;}catch{}}await wait(20);}
  if(phase==='terminate'){
   assert.deepEqual(await get(),initial,'The complete initialized classroom must match before the crash fault is armed');
   if(boundary==='before-notify'){const send=main.webContents.send.bind(main.webContents);main.webContents.send=(channel,...args)=>{if(armed&&channel==='state:changed')stop();return send(channel,...args);};}
   armed=true;await act({type:'score',panelId:C.panelId(initial),ids:[initial.students[0].id],delta:3,reason:'合成崩溃边界'});throw Error('Termination injection did not run');
  }
  const committed=['after-rename','before-notify'].includes(boundary),loaded=await get();
  await check('Restart reads one complete old or committed classroom at '+boundary,()=>{assert.equal(loaded.revision,initial.revision+(committed?1:0));assert.equal(loaded.students[0].score,initial.students[0].score+(committed?3:0));assert.equal(loaded.students[0].growth,initial.students[0].growth+(committed?3:0));assert.equal(loaded.logs.length,initial.logs.length+(committed?1:0));assert.deepEqual(C.validateState(loaded),loaded);assert.deepEqual(JSON.parse(fs.readFileSync(file)),loaded);});
  await check('Other panels, existing logs, names and pet accounts remain intact',()=>{assert.deepEqual(loaded.panels,initial.panels);assert.deepEqual(loaded.students.slice(1),initial.students.slice(1));assert.deepEqual(loaded.logs.slice(0,initial.logs.length),initial.logs);if(!committed)assert.deepEqual(loaded,initial);});
  await check('Fresh process never resends an old operation; one new explicit score applies once',async()=>{await wait(200);assert.deepEqual(await get(),loaded);await act({type:'score',panelId:C.panelId(loaded),ids:[loaded.students[0].id],delta:1,reason:'合成重启后明确新操作'});const next=await get();assert.equal(next.students[0].score,loaded.students[0].score+1);assert.equal(next.logs.length,loaded.logs.length+1);assert.deepEqual(JSON.parse(fs.readFileSync(file)),next);});
  snapshot();app.exit(checks.some(c=>c.status==='failed')?1:0);
 }catch(e){checks.push({name:'Harness',status:'failed',error:e.stack});snapshot();app.exit(2);}});
 setTimeout(()=>{checks.push({name:'Harness deadline',status:'failed'});snapshot();app.exit(3);},40000);
}
