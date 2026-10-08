'use strict';
// New RC10 audit: recoverable legacy chains and a failed preservation copy.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.FLOWER_STORAGE_OUT||path.join(root,'artifacts/rc10/storage-review'));
fs.mkdirSync(out,{recursive:true});
const phases=['legacy-previous-only','legacy-corrupt-chain','preservation-enospc','preservation-eacces'];
if(!process.versions.electron){
 const results=[];
 for(const phase of phases){
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'flower-storage-rc10-'));
  const r=require('node:child_process').spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:35000,maxBuffer:4*1024*1024,env:{...process.env,FLOWER_DATA_DIR:data,FLOWER_HEADLESS_TEST:'1',FLOWER_STORAGE_PHASE:phase}});
  fs.writeFileSync(path.join(out,phase+'.log'),(r.stdout||'')+(r.stderr||''));
  const resultFile=path.join(out,phase+'.json');results.push({phase,exitCode:r.status,result:fs.existsSync(resultFile)?JSON.parse(fs.readFileSync(resultFile)):null});
  console.log(phase,r.status);
 }
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({syntheticOnly:true,windowsExecuted:false,results},null,2));process.exitCode=results.some(r=>r.exitCode!==0)?1:0;
}else{
 const {app,BrowserWindow}=require('electron');app.disableHardwareAcceleration();
 const entry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs')),src=path.dirname(entry),phase=process.env.FLOWER_STORAGE_PHASE,data=process.env.FLOWER_DATA_DIR;
 require('./package-boundary.cjs')(entry,path.join(out,'boundary-'+phase+'.json'));
 const C=require(path.join(src,'core.cjs'));let expected=C.createInitialState();expected.students=expected.students.slice(0,2).map((s,i)=>({...s,name:'合成恢复同学'+(i+1),score:14+i,growth:20+i}));expected.settings.className='合成恢复检查班';expected.revision=16;
 const legacy=path.join(data,'classroom.json'),modern=path.join(data,'classroom-v2.json');
 if(phase==='legacy-previous-only')fs.writeFileSync(legacy+'.previous',JSON.stringify(expected));
 if(phase==='legacy-corrupt-chain'){fs.writeFileSync(legacy,'{SYNTHETIC_BAD_PRIMARY');fs.writeFileSync(legacy+'.previous','{SYNTHETIC_BAD_PREVIOUS');}
 const originalCopy=fs.copyFileSync;
 if(phase.startsWith('preservation-')){
  expected.version=2;fs.writeFileSync(modern,'{SYNTHETIC_BAD_PRIMARY');fs.writeFileSync(modern+'.previous',JSON.stringify(expected));
  fs.copyFileSync=function(from,to,...rest){if(from===modern&&String(to).includes('.damaged-')){const err=Error('Synthetic preservation failure');err.code=phase.endsWith('enospc')?'ENOSPC':'EACCES';throw err;}return originalCopy.call(this,from,to,...rest);};
 }
 const checks=[],errors=[];process.on('unhandledRejection',e=>errors.push(String(e?.stack||e)));
 const check=async(name,fn)=>{try{await fn();checks.push({name,status:'passed'});}catch(e){checks.push({name,status:'failed',error:e.message,actual:e.actual,expected:e.expected});}};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));let main;
 const save=()=>fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify({phase,entry,checks,errors,files:fs.readdirSync(data).filter(n=>n.startsWith('classroom')),syntheticOnly:true,windowsExecuted:false},null,2));
 require(entry);
 app.whenReady().then(async()=>{try{
  for(let i=0;i<150;i++){main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');if(main&&!main.webContents.isLoading())break;await wait(20);}
  await check('Main window opens even if damaged-file preservation cannot complete',()=>assert.ok(main,'No main window was created'));
  if(main){
   const js=code=>main.webContents.executeJavaScript(code,true);let loaded;
   for(let i=0;i<150;i++){try{loaded=await js('classroom.get()');if(await js('!!state'))break;}catch{}await wait(20);}
   if(phase==='legacy-corrupt-chain'){
    await check('Corrupt legacy chain opens read-only recovery instead of a writable example classroom',()=>assert.equal(loaded.readOnly,true));
    await check('A score cannot migrate example data over the unreadable legacy classroom',async()=>{const before=fs.readFileSync(legacy,'utf8');await assert.rejects(js('classroom.action('+JSON.stringify({type:'score',ids:[loaded.state.students[0].id],delta:1})+')'),/恢复|存档/);assert.equal(fs.existsSync(modern),false);assert.equal(fs.readFileSync(legacy,'utf8'),before);});
   }else{
    await check('Last complete classroom is shown, including names and nonzero scores',()=>assert.deepEqual(loaded.state,phase==='legacy-previous-only'?require('./qa-rc18-inherited-contract.cjs').bootstrapExpected(expected,src):expected));
    await check('Recovery warning is displayed',()=>assert.ok(loaded.warning));
    if(phase.startsWith('preservation-')){
     await check('Preservation failure keeps mutation blocked and both input files unchanged',async()=>{assert.equal(loaded.readOnly,true);await assert.rejects(js('classroom.action('+JSON.stringify({type:'score',ids:[expected.students[0].id],delta:1})+')'),/恢复|存档/);assert.equal(fs.readFileSync(modern,'utf8'),'{SYNTHETIC_BAD_PRIMARY');assert.deepEqual(JSON.parse(fs.readFileSync(modern+'.previous')),expected);});
    }else await check('Recovered legacy previous can migrate safely with the previous bytes retained',async()=>{const prior=fs.readFileSync(legacy+'.previous','utf8');await js('classroom.action('+JSON.stringify({type:'score',ids:[expected.students[0].id],delta:1})+')');assert.equal(JSON.parse(fs.readFileSync(modern)).students[0].score,15);assert.equal(fs.readFileSync(legacy+'.previous','utf8'),prior);});
   }
   fs.writeFileSync(path.join(out,phase+'.png'),(await main.webContents.capturePage()).toPNG());
  }
  save();app.exit(checks.some(c=>c.status==='failed')?1:0);
 }catch(e){errors.push(e.stack);save();app.exit(2);}});
 setTimeout(()=>{errors.push('Harness timeout');save();app.exit(3);},30000);
}
