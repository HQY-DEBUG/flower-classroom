'use strict';
// Independent directory architecture QA. Synthetic cloud fixtures only.
// Uses real Linux Electron; native Windows behavior is deliberately unclaimed.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'..'),entry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(repo,'src/main.cjs')),src=path.dirname(entry),out=path.resolve(process.env.FLOWER_FOLDER_REVIEW_OUT||path.join(repo,'artifacts/rc15-independent-review/runtime'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const inside=(root,file)=>file===root||file.startsWith(root+path.sep);
function tree(root,{runtime=true}={}){const result={};function visit(dir){if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name),relative=path.relative(root,file);if(!runtime&&/^(?:数据[\\/])?(?:运行|runtime|session|Cache)/i.test(relative))continue;if(item.isDirectory())visit(file);else if(item.isFile())result[relative]=hash(fs.readFileSync(file));}}visit(root);return result;}
if(!process.versions.electron){
 fs.mkdirSync(out,{recursive:true});
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'flower-rc15-directory-independent-')),folder=path.join(fixture,'folder A 中文'),moved=path.join(fixture,'folder B relocated'),cwd1=path.join(fixture,'cwd-one'),cwd2=path.join(fixture,'cwd-two');
 fs.mkdirSync(folder);fs.mkdirSync(cwd1);fs.mkdirSync(cwd2);
 const payload=process.env.FLOWER_FOLDER_PAYLOAD;
 function seed(target){fs.mkdirSync(target,{recursive:true});if(payload){for(const name of ['头像','配置.txt','计分卡片.xlsx','头像-初始化-v2.txt','数据','备份']){const from=path.join(payload,name);if(fs.existsSync(from))fs.cpSync(from,path.join(target,name),{recursive:true});}}}
 seed(folder);
 const results=[];
 function run(scenario,root,cwd){const result=require('node:child_process').spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd,encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024,env:{...process.env,FLOWER_HEADLESS_TEST:'1',FLOWER_EXTERNAL_RESOURCE_DIR:root,FLOWER_FOLDER_REVIEW_OUT:out,FLOWER_FOLDER_SCENARIO:scenario,FLOWER_FOLDER_FIXTURE:fixture,FLOWER_PACKAGE_MAIN:entry,FLOWER_DATA_DIR:'',XDG_CACHE_HOME:path.join(root,'数据','运行','xdg-cache')}});fs.writeFileSync(path.join(out,scenario+'.log'),(result.stdout||'')+(result.stderr||''));const report=path.join(out,scenario+'.json');results.push({scenario,exitCode:result.status,error:result.error?.message,report:fs.existsSync(report)?JSON.parse(fs.readFileSync(report)):null});console.log('FOLDER_INDEPENDENT',scenario,result.status);}
 run('initial',folder,cwd1);run('restart',folder,cwd2);
 fs.cpSync(folder,moved,{recursive:true});const prior=tree(folder),hiddenOriginal=path.join(fixture,'original-relocated-out-of-reach');fs.renameSync(folder,hiddenOriginal);run('relocated',moved,cwd2);assert.deepEqual(tree(hiddenOriginal),prior,'Running copied folder must not alter original');
 const blocked=path.join(fixture,'write-denied');seed(blocked);run('blocked-eacces',blocked,cwd1);
 const result={entry,fixture,payload:payload||null,results,cwdTrees:[tree(cwd1),tree(cwd2)],syntheticOnly:true,windowsExecuted:false,limits:['Linux Electron offscreen','Node-fs instrumentation covers application calls; it is not an OS-wide filesystem trace','No security-specialist or lock behavior tests run']};
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));process.exitCode=results.some(r=>r.exitCode!==0)||Object.keys(tree(cwd1)).length||Object.keys(tree(cwd2)).length?1:0;
}else{
 const {app,BrowserWindow,dialog,shell}=require('electron');app.disableHardwareAcceleration();
 const root=path.resolve(process.env.FLOWER_EXTERNAL_RESOURCE_DIR),scenario=process.env.FLOWER_FOLDER_SCENARIO,fixture=process.env.FLOWER_FOLDER_FIXTURE,sentinel=path.join(fixture,'outside-appdata'),legacy=path.join(sentinel,'FlowerClassroom');
 fs.mkdirSync(legacy,{recursive:true});fs.writeFileSync(path.join(legacy,'classroom.json'),'{"SYNTHETIC_SENTINEL_DO_NOT_READ":true}');app.setPath('appData',sentinel);
 require('./package-boundary.cjs')(entry,path.join(out,'dependency-boundary-'+scenario+'.json'));
 const original={};const writes=[],legacyAccess=[],errors=[],dialogs=[],opened=[],checks=[];let capture=true,main,finished=false;const descriptors=new Map();
 function pathname(value){if(typeof value==='number')return descriptors.get(value)||'descriptor:'+value;if(value instanceof URL)return require('node:url').fileURLToPath(value);if(Buffer.isBuffer(value))value=value.toString();return typeof value==='string'?path.resolve(value):String(value);}
 function note(op,args,write){if(!capture)return;const paths=args.map(pathname);if(write)writes.push({operation:op,paths});for(const file of paths)if(inside(sentinel,file))legacyAccess.push({operation:op,path:file});}
 const sync={mkdirSync:[0],writeFileSync:[0],appendFileSync:[0],copyFileSync:[1],renameSync:[0,1],unlinkSync:[0],rmSync:[0],rmdirSync:[0],truncateSync:[0]};
 for(const [name,indexes]of Object.entries(sync)){original[name]=fs[name];fs[name]=function(...args){note(name,indexes.map(i=>args[i]),true);if(scenario==='blocked-eacces'&&indexes.some(i=>inside(root,pathname(args[i])))){const error=Error('Synthetic blocked portable directory');error.code='EACCES';throw error;}return original[name].apply(this,args);};}
 original.openSync=fs.openSync;fs.openSync=function(file,flags,...rest){const mut=typeof flags==='string'?/[wax+]/.test(flags):!!(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT));note('openSync',[file],mut);if(scenario==='blocked-eacces'&&mut&&inside(root,pathname(file))){const error=Error('Synthetic blocked portable directory');error.code='EACCES';throw error;}const fd=original.openSync.call(this,file,flags,...rest);descriptors.set(fd,pathname(file));return fd;};
 for(const name of ['readFileSync','statSync','lstatSync','existsSync','readdirSync']){original[name]=fs[name];fs[name]=function(file,...rest){note(name,[file],false);return original[name].call(this,file,...rest);};}
 for(const name of ['mkdir','writeFile','appendFile','copyFile','rename','unlink','rm','rmdir','readFile','stat','lstat','readdir','access','opendir','open']){if(typeof fs.promises[name]!=='function')continue;const native=fs.promises[name].bind(fs.promises);fs.promises[name]=async function(...args){const mut=!['readFile','stat','lstat','readdir','access','opendir','open'].includes(name)||name==='open'&&typeof args[1]==='string'&&/[wax+]/.test(args[1]);note('promises.'+name,name==='copyFile'?[args[1]]:name==='rename'?args.slice(0,2):[args[0]],mut);const result=await native(...args);if(name==='open'&&result&&mut){for(const method of ['write','writeFile','truncate']){const fn=result[method]?.bind(result);if(fn)result[method]=async(...a)=>{note('FileHandle.'+method,[args[0]],true);return fn(...a);};}}return result;};}
 const errorBoxes=[];dialog.showErrorBox=(title,content)=>errorBoxes.push({title,content});dialog.showMessageBox=async(_owner,options)=>{const x=options||_owner;errorBoxes.push(x);return{response:0};};
 let selectedSave=null;
 dialog.showOpenDialog=async(_owner,options)=>{dialogs.push({kind:'open',...(options||_owner)});return{canceled:true,filePaths:[]};};
 dialog.showSaveDialog=async(_owner,options)=>{dialogs.push({kind:'save',...(options||_owner)});return selectedSave?{canceled:false,filePath:selectedSave}:{canceled:true,filePath:''};};
 shell.openPath=async file=>{opened.push(file);return '';};
 process.on('unhandledRejection',error=>errors.push(String(error?.stack||error)));process.on('uncaughtException',error=>{errors.push(String(error?.stack||error));finish(2);});
 const terminalExit=app.exit.bind(app);app.exit=function(code){if(scenario==='blocked-eacces')return finish();return terminalExit(code);};const originalConsoleError=console.error;console.error=function(...args){if(scenario==='blocked-eacces')errorBoxes.push({content:args.map(String).join(' ')});return originalConsoleError.apply(this,args);};
 const nativeQuit=app.quit.bind(app);app.quit=function(){if(scenario==='blocked-eacces'){setTimeout(()=>finish(),30);return;}return nativeQuit();};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const check=async(name,fn)=>{try{await fn();checks.push({name,status:'passed'});}catch(error){checks.push({name,status:'failed',error:String(error.stack||error)});}};
 const js=code=>main.webContents.executeJavaScript(code,true),get=()=>js('classroom.get()'),file=request=>js('classroom.file('+JSON.stringify(request)+')'),act=request=>js('classroom.action('+JSON.stringify(request)+')');
 function paths(){const result={};for(const name of ['appData','userData','sessionData','logs','crashDumps','temp']){try{result[name]=app.getPath(name);}catch(error){result[name]='ERROR:'+error.message;}}return result;}
 function finish(forced){if(finished)return;finished=true;capture=false;if(scenario==='blocked-eacces'){checks.push({name:'Unwritable folder blocks startup before application window',status:BrowserWindow.getAllWindows().length===0?'passed':'failed'});checks.push({name:'Blocked startup gives useful relocation/write message',status:errorBoxes.some(e=>/可写|权限|移动|写入/.test(JSON.stringify(e)))?'passed':'failed'});checks.push({name:'Blocked startup makes no legacy reads or alternate app writes',status:legacyAccess.length===0&&writes.every(item=>item.paths.every(target=>inside(root,target)))?'passed':'failed'});checks.push({name:'Blocked startup creates no classroom save',status:!fs.existsSync(path.join(root,'数据','classroom-v2.json'))&&!fs.existsSync(path.join(root,'数据','classroom.json'))?'passed':'failed'});}const configured=scenario==='blocked-eacces'?{}:paths();const report={scenario,entry,root,configured,checks,errors,errorBoxes,dialogs,opened,writes,legacyAccess,files:tree(root),syntheticOnly:true,windowsExecuted:false};fs.writeFileSync(path.join(out,scenario+'.json'),JSON.stringify(report,null,2));terminalExit(forced||checks.some(c=>c.status!=='passed')||errors.length?1:0);}
 try{require(entry);}catch(error){errors.push(String(error.stack||error));finish(2);}
 app.whenReady().then(async()=>{if(scenario==='blocked-eacces')return;try{
  for(let i=0;i<500;i++){main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');if(main&&!main.webContents.isLoading()){try{if(await js('typeof classroom!=="undefined"'))break;}catch{}}await wait(20);}assert.ok(main,'Main window did not open');
  const first=await get();
  await check('Electron writable paths resolve under current folder',()=>{for(const [name,target]of Object.entries(paths()))assert.ok(inside(root,target),name+': '+target);});
  await check('No old AppData fixture was read',()=>assert.deepEqual(legacyAccess,[]));
  await check('Required visible sidecars exist after initialization',()=>{for(const name of ['头像','配置.txt','计分卡片.xlsx','数据','备份'])assert.ok(fs.existsSync(path.join(root,name)),name);});
  const avatars=await file({command:'avatars-list'});
  await check('Avatar library resolves exclusively in current folder',()=>{assert.equal(avatars.directory,path.join(root,'头像'));assert.equal(avatars.items.length,scenario==='initial'?120:119);});
  const workbook=await file({command:'rules-workbook-refresh-preview'});
  await check('Initial workbook recognizes current classroom IDs',()=>assert.ok(workbook.token));
  if(scenario==='initial'){
   await check('Score persists to sibling data directory',async()=>{await act({type:'score',ids:[first.state.students[0].id],delta:3,reason:'合成目录检查'});const saved=JSON.parse(fs.readFileSync(path.join(root,'数据','classroom-v2.json')));assert.equal(saved.students[0].score,first.state.students[0].score+3);});
   await act({type:'settings',className:'独立目录合成班'});
   await check('Canceled imports and exports have absolute local defaults',async()=>{const before=writes.length;for(const command of ['import-preview','photo','photos-batch','restore-preview','template','backup','summary-export'])await file({command});await file({command:'rankings-export',mode:'students'});const current=await get();await file({command:'export-category',category:'students',panelId:current.state.panels?.activeId||'panel_default',expectedRevision:current.state.revision});for(const d of dialogs)assert.ok(typeof d.defaultPath==='string'&&inside(root,path.resolve(d.defaultPath)),d.title+': '+d.defaultPath);assert.equal(writes.length,before,'Canceled dialogs must not write');});
   await check('Selected backup export matches current class and defaults to 备份',async()=>{selectedSave=path.join(root,'备份','independent-export.json');const state=(await get()).state;await file({command:'backup'});assert.deepEqual(JSON.parse(fs.readFileSync(selectedSave)),state);assert.ok(inside(path.join(root,'备份'),dialogs.at(-1).defaultPath));selectedSave=null;});
   await check('Protective snapshots stay under sibling backup folder',async()=>{await file({command:'archive'});const files=fs.readdirSync(path.join(root,'备份'));assert.ok(files.some(n=>n.startsWith('before-archive-')));assert.equal(fs.readdirSync(path.join(root,'数据')).some(n=>n.startsWith('before-archive-')),false);});
   capture=false;fs.unlinkSync(path.join(root,'头像',avatars.items[0].fileName||avatars.items[0].file));capture=true;
   await check('Manually deleted avatar is not restored on refresh',async()=>assert.equal((await file({command:'avatars-refresh'})).items.length,119));
  }else{
   await check('Restart or relocation retains the same classroom',()=>assert.equal(first.state.settings.className,'独立目录合成班'));
   if(scenario==='relocated')await act({type:'settings',className:'独立移动副本班'});
  }
  await file({command:'data-folder'});
  await check('Open data folder uses current copy',()=>assert.equal(opened.at(-1),path.join(root,'数据')));
  await check('Observed app writes stay under portable root',()=>{for(const item of writes)for(const target of item.paths)assert.ok(inside(root,target),item.operation+': '+target);});
  await check('Normal flow never consulted legacy AppData',()=>assert.deepEqual(legacyAccess,[]));
  finish();
 }catch(error){errors.push(String(error.stack||error));finish(2);}});
 setTimeout(()=>{errors.push('Harness timeout');finish(3);},70000);
}
