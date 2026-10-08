'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const repo=path.resolve(__dirname,'../../..'),archive=repo,mode=process.env.AUDIT_BOOT_MODE,base=process.env.AUDIT_BOOT_ROOT;
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
if(!process.versions.electron){
 const C=require('./before/src/core.cjs'),W=require('./before/src/score-rule-workbook.cjs');
 (async()=>{
 const results=[];
 for(const which of ['valid','malformed','oversize','read-failed','directory','missing','initial','badconfig','duplicateconfig','boundsconfig','invalidutf8config']){
  const dir=path.join(__dirname,'fixtures','boot-'+which),data=path.join(dir,'数据');fs.mkdirSync(data,{recursive:true});
  let s=C.createInitialState();s=C.applyAction(s,{type:'score',ids:[s.students[0].id],delta:17,reason:'独立审计合成历史'});s=C.validateState({...s,version:2});
  fs.writeFileSync(path.join(data,'classroom-v2.json'),JSON.stringify(s));fs.writeFileSync(path.join(dir,'expected-state.json'),JSON.stringify(s));
  const file=path.join(dir,W.FILE_NAME);if(which==='directory')fs.mkdirSync(file);else if(which!=='missing')fs.writeFileSync(file,which==='initial'?await W.buildInitialBytes():which==='malformed'?Buffer.from('ordinary invalid XLSX preserved'):which==='oversize'?Buffer.alloc(W.MAX_BYTES+1,65):await W.buildBytes(s));
  const conf=path.join(dir,'配置.txt');fs.writeFileSync(conf,which==='badconfig'?'windowWidth:900\n':which==='duplicateconfig'?'initialZoom=1\ninitialZoom=1.25\n':which==='boundsconfig'?'windowHeight=639\n':which==='invalidutf8config'?Buffer.from([0xff,0xfe]):'initialZoom=1.25\nwindowWidth=900\nwindowHeight=640\nstartMinimized=false\n');
  const prior={stateHash:sha(fs.readFileSync(path.join(data,'classroom-v2.json'))),configHash:sha(fs.readFileSync(conf)),workbookHash:fs.existsSync(file)&&fs.statSync(file).isFile()?sha(fs.readFileSync(file)):null};
  const run=require('child_process').spawnSync(require(path.join(repo,'node_modules/electron')),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:repo,encoding:'utf8',timeout:15000,maxBuffer:2*1024*1024,env:{...process.env,AUDIT_BOOT_MODE:which,AUDIT_BOOT_ROOT:dir,FLOWER_HEADLESS_TEST:'1',FLOWER_FOLDER_ROOT:dir,FLOWER_DATA_DIR:data,FLOWER_EXTERNAL_RESOURCE_DIR:dir}});
  fs.writeFileSync(path.join(__dirname,'boot-'+which+'.log'),(run.stdout||'')+(run.stderr||''));
  const observation=fs.existsSync(path.join(dir,'observation.json'))?JSON.parse(fs.readFileSync(path.join(dir,'observation.json'))):{};
  results.push({mode:which,...observation,exitCode:run.status,signal:run.signal,stateBytesPreserved:sha(fs.readFileSync(path.join(data,'classroom-v2.json')))===prior.stateHash,configBytesPreserved:sha(fs.readFileSync(conf))===prior.configHash,workbookBytesPreserved:prior.workbookHash?fs.statSync(file).isFile()&&sha(fs.readFileSync(file))===prior.workbookHash:null});
  fs.writeFileSync(path.join(__dirname,'boot-results.json'),JSON.stringify({archive,sourceMainSha256:sha(fs.readFileSync(path.join(archive,'src/main.cjs'))),syntheticOnly:true,windowsExecuted:false,results},null,2));console.log(JSON.stringify(results.at(-1)));
 }
 })().catch(e=>{console.error(e);process.exitCode=2;});
}else{
 const {app,BrowserWindow}=require('electron');app.disableHardwareAcceleration();
 require(path.join(repo,'scripts/package-boundary.cjs'))(archive+'/src/main.cjs',path.join(base,'dependency-boundary.json'));
 const originalExit=app.exit.bind(app),obs={mode,mainWindowCreated:false};app.exit=function(code){fs.writeFileSync(path.join(base,'observation.json'),JSON.stringify({...obs,exitCode:code},null,2));return originalExit(code);};
 if(mode==='read-failed'){const read=fs.readFileSync;fs.readFileSync=function(file,...args){if(file===path.join(base,'计分卡片.xlsx'))throw Object.assign(Error('SYNTHETIC workbook read failure'),{code:'EIO'});return read.call(this,file,...args);};}
 require(archive+'/src/main.cjs');
 const timer=setTimeout(()=>{obs.error='No main window within 9 seconds';app.exit(5);},9000);
 app.whenReady().then(async()=>{
  try{for(let i=0;i<400;i++){const main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');if(main&&!main.webContents.isLoading()){
   obs.mainWindowCreated=true;const r=await main.webContents.executeJavaScript('classroom.get()');obs.warning=r.warning;obs.workbookWarning=r.workbookWarning;obs.readOnly=r.readOnly;obs.stateEqualsExpected=JSON.stringify(r.state)===fs.readFileSync(path.join(base,'expected-state.json'),'utf8');obs.zoom=main.webContents.getZoomFactor();obs.bounds=main.getBounds();clearTimeout(timer);app.exit(0);return;}
   await new Promise(r=>setTimeout(r,20));}
  }catch(e){obs.error=e.stack;clearTimeout(timer);app.exit(2);}
 });
}
