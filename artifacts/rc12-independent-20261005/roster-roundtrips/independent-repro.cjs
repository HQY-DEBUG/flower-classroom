'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),out=path.resolve(process.env.ROSTER_AUDIT_OUT||__dirname),entry=process.env.FLOWER_PACKAGE_MAIN||'/tmp/flower-classroom-workspace/flower-rc11-comprehensive-audit/FlowerClassroom-source/dist-rc12-final/win-unpacked/resources/app.asar/src/main.cjs',phase=process.env.ROSTER_AUDIT_PHASE||'flows';
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'flower-rc12-roster-new-')),runs=[];
 for(const p of ['flows','restart']){const r=require('node:child_process').spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:10*1024*1024,env:{...process.env,FLOWER_DATA_DIR:data,FLOWER_HEADLESS_TEST:'1',ROSTER_AUDIT_PHASE:p}});fs.writeFileSync(path.join(out,p+'.log'),(r.stdout||'')+(r.stderr||''));const report=path.join(out,p+'.json');runs.push({phase:p,exitCode:r.status,error:r.error?.message,report:fs.existsSync(report)?JSON.parse(fs.readFileSync(report)):null});console.log((r.stdout||'').split('\n').filter(v=>/^(PASS|FAIL|FATAL|SUMMARY)_NEW/.test(v)).join('\n'));}
 const archive=entry.includes('.asar/')?entry.slice(0,entry.indexOf('.asar/')+5):null;fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({entry,archive,archiveSha256:archive?sha(fs.readFileSync(archive)):null,harnessSha256:sha(fs.readFileSync(__filename)),data,syntheticOnly:true,windowsExecuted:false,runs},null,2));process.exitCode=runs.some(r=>r.exitCode!==0)?1:0;
}else{
 const {app,BrowserWindow,dialog,ipcMain}=require('electron');app.disableHardwareAcceleration();require(path.join(root,'scripts/package-boundary.cjs'))(entry,path.join(out,'dependency-boundary-'+phase+'.json'));
 const Core=require(path.join(path.dirname(entry),'core.cjs')),ExcelJS=require('exceljs');
 const data=process.env.FLOWER_DATA_DIR,saveFile=path.join(data,'classroom-v2.json'),checks=[],previews=[],errors=[],requests=[];let main;
 function initial(){let s=Core.createInitialState();s.students=s.students.slice(0,3).map((v,i)=>({...v,name:['合成同名','合成同名','合成原学生'][i],group:['001','002','三组'][i]}));s.settings.className='合成RC12新覆盖';s=Core.applyAction(s,{type:'score',ids:[s.students[0].id],delta:17});return s;}
 const original=initial();if(phase==='flows')fs.writeFileSync(saveFile,JSON.stringify(original));
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=c=>main.webContents.executeJavaScript(c,true),get=()=>js('classroom.get().then(r=>r.state)'),file=r=>js('classroom.file('+JSON.stringify(r)+')'),act=r=>js('classroom.action('+JSON.stringify(r)+')'),disk=()=>fs.readFileSync(saveFile,'utf8'),has=s=>js('!!document.querySelector('+JSON.stringify(s)+')');
 async function until(fn,label='condition'){for(let n=0;n<400;n++){if(await fn())return;await wait(15);}throw Error('Timed out '+label);}
 async function click(s){assert.ok(await has(s),'Control '+s);await js('document.querySelector('+JSON.stringify(s)+').click()');await wait(40);}
 async function close(){await js('closeModal()');await wait(20);}
 async function restore(s=original){await close();const next=await file({command:'restore-apply',state:s});await until(()=>js('state.revision==='+next.revision));await js('page="settings";render()');}
 function pick(p){dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});}
 async function preview(p,mode='append'){await close();await js('page="settings";render()');pick(p);await js('document.querySelector("#import-mode").value='+JSON.stringify(mode));const n=previews.length;await click('[data-do=import]');await until(()=>has('#confirm-action'),'confirmation');assert.equal(previews.length,n+1,'Exactly one new preview result');return previews.at(-1);}
 async function confirm(){await click('#confirm-action');await until(()=>js('!document.querySelector("#confirm-action")'),'confirmation closed');}
 const roster=(name,rows,headers=['姓名','小组','头像名称'])=>{const p=path.join(out,name+'.csv'),csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';fs.writeFileSync(p,'\ufeff'+[headers,...rows].map(r=>r.map(csv).join(',')).join('\r\n')+'\r\n');return p;};
 async function workbook(name,rows,headers=['姓名','小组','头像名称'],edit=()=>{}){const b=new ExcelJS.Workbook(),s=b.addWorksheet('名单');s.addRow(headers);s.addRows(rows);edit(s,b);const p=path.join(out,name+'.xlsx');await b.xlsx.writeFile(p);return p;}
 const report=()=>fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify({phase,entry,syntheticOnly:true,windowsExecuted:false,checks,errors,requests},null,2));
 async function check(name,fn){try{checks.push({name,status:'passed',detail:await fn()});console.log('PASS_NEW',name);}catch(e){checks.push({name,status:'failed',error:e.stack,actual:e.actual,expected:e.expected});console.log('FAIL_NEW',name,e.message);try{fs.writeFileSync(path.join(out,'failure-'+checks.length+'.png'),(await main.webContents.capturePage()).toPNG());}catch{}}report();}
 async function unchanged(before,bytes){assert.deepEqual(await get(),before);assert.equal(disk(),bytes);}
 const originalHandle=ipcMain.handle.bind(ipcMain);let held=null;
 ipcMain.handle=function(channel,handler){return originalHandle(channel,channel==='file:command'?async(event,request)=>{requests.push({command:request.command,mode:request.mode,rows:request.rows?.length});const result=await handler(event,request);if(request.command==='import-preview')previews.push(result);if(held?.command===request.command){const slot=held;held=null;slot.entered=true;return new Promise(resolve=>slot.release=()=>resolve(result));}return result;}:handler);};
 app.on('web-contents-created',(_e,w)=>w.on('console-message',(event,level,message)=>{if(event.level==='error'||level>=3)errors.push(event.message??message);}));
 require(entry);const deadline=setTimeout(()=>{report();app.exit(3);},230000);
 app.whenReady().then(async()=>{try{
  ipcMain.handle=originalHandle;await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return main&&!main.webContents.isLoading();});await until(()=>js('!!state'));main.setContentSize(1365,1000);
  if(phase==='restart'){
   await check('Actual next process reloads exact final roster, disk and photographed preview choices',async()=>{const expected=JSON.parse(fs.readFileSync(path.join(out,'expected-restart.json')));assert.deepEqual(await get(),expected);assert.deepEqual(JSON.parse(disk()),expected);return {students:expected.students.map(s=>({name:s.name,group:s.group,photoSha256:sha(s.photo)})),sha256:sha(disk())};});
  }else{
   const source=path.join(out,'openpyxl-formula.xlsx');
   await check('Independent openpyxl fixture reproduces missing formula row in committed Replace',async()=>{
    const before=await get(),oldFiles=new Set(fs.readdirSync(data));const p=await preview(source,'replace');
    assert.equal(p.count,2);await confirm();const after=await get();assert.deepEqual(after.students.map(s=>s.name),['合成可见甲','合成可见乙']);assert.deepEqual(JSON.parse(disk()),after);
    const backup=fs.readdirSync(data).find(n=>n.startsWith('before-replace-')&&!oldFiles.has(n));assert.ok(backup);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data,backup))),before);
    fs.writeFileSync(path.join(out,'formula-repro-evidence.json'),JSON.stringify({knownDefect:true,source,expectedAction:'Reject unresolved formula before creating a replacement preview',preview:p,before,after,recoveryBackup:backup},null,2));
    return {knownDefectReproduced:true,sourceTool:'openpyxl',inputStudentRows:3,committedStudentRows:after.students.length,protectionBackupExact:true};
   });
   const seeded=await file({command:'avatars-list'}),folder=path.join(data,'avatars');fs.copyFileSync(path.join(folder,seeded.items[0].fileName),path.join(folder,' 合成头像.png'));fs.copyFileSync(path.join(folder,seeded.items[1].fileName),path.join(folder,'合成头像.png'));
   await check('Wrong leading-space match commits a different accepted library image and survives full JSON backup restore',async()=>{
    const list=await file({command:'avatars-refresh'}),wanted=list.items.find(i=>i.fileName===' 合成头像.png'),other=list.items.find(i=>i.fileName==='合成头像.png');assert.notEqual(wanted.photo,other.photo);
    const p=await preview(roster('leading-space-independent',[['合成头像学生','组',' 合成头像.png']]));assert.equal(p.avatarMatches[0].fileName,'合成头像.png');assert.equal(p.rows[0].photo,other.photo);await confirm();const after=await get();assert.equal(after.students.at(-1).photo,other.photo);assert.notEqual(after.students.at(-1).photo,wanted.photo);assert.deepEqual(JSON.parse(disk()),after);
    const target=path.join(out,'synthetic-backup.json');dialog.showSaveDialog=async()=>({canceled:false,filePath:target});await file({command:'backup'});assert.deepEqual(JSON.parse(fs.readFileSync(target)),after);
    await act({type:'student.remove',id:after.students.at(-1).id});pick(target);const restored=await file({command:'restore-preview',withRevision:true});await file({command:'restore-apply',state:restored,expectedRevision:restored.expectedRevision});const actual=await get();assert.deepEqual({...actual,revision:after.revision},after);assert.deepEqual(JSON.parse(disk()),actual);
    fs.writeFileSync(path.join(out,'leading-space-repro-evidence.json'),JSON.stringify({knownDefect:true,wanted:{fileName:wanted.fileName,photoSha256:sha(wanted.photo)},actual:{fileName:other.fileName,photoSha256:sha(other.photo)},preview:p,after:actual,backupRoundtripExact:true},null,2));fs.writeFileSync(path.join(out,'expected-restart.json'),JSON.stringify(actual,null,2));return {knownDefectReproduced:true,backupRoundtripExact:true,students:actual.students.map(s=>s.name)};
   });
  }
  clearTimeout(deadline);report();console.log('SUMMARY_NEW',checks.filter(c=>c.status==='passed').length,'passed',checks.filter(c=>c.status==='failed').length,'failed');app.exit(checks.some(c=>c.status==='failed')?1:0);
 }catch(e){clearTimeout(deadline);checks.push({name:'fatal harness',status:'failed',error:e.stack});report();console.log('FATAL_NEW',e.stack);app.exit(2);}});
}
