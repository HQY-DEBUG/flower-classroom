'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../../..'),out=path.resolve(process.env.IMPORT_FORMAT_OUT||path.join(__dirname,'format-baseline')),entry=process.env.FLOWER_PACKAGE_MAIN||path.join(root,'src/main.cjs'),sha=v=>crypto.createHash('sha256').update(v).digest('hex');fs.mkdirSync(out,{recursive:true});
const qaChild=require(path.join(root,'scripts/qa-feature-child.cjs')),casePlan=require(path.join(root,'scripts/qa-extension-cases.json'))['rc12-format'];
let completed=false;
if(!process.versions.electron){
 const layout=qaChild.fixture('flower-extension-rc12-format-'),data=layout.data;qaChild.prepare(out,['results.json','execution.json','provenance.json']);
 const expectedCaseNames=casePlan.flows;
 const result=require('node:child_process').spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{cwd:root,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024,env:{...process.env,...layout.env}});
 fs.writeFileSync(path.join(out,'run.log'),(result.stdout||'')+(result.stderr||''));const record=qaChild.capture(result,path.join(out,'results.json'),'flows',{expectedCaseNames,requireCompleted:true});
 const provenance={entry,data,syntheticOnly:true,windowsExecuted:false,requiredPhases:['flows'],actualPhases:['flows'],...record};fs.writeFileSync(path.join(out,'execution.json'),JSON.stringify(provenance,null,2));fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify(provenance,null,2));console.log((result.stdout||'').split('\n').filter(line=>/^(PASS|FAIL|FATAL|SUMMARY)/.test(line)).join('\n'));process.exitCode=record.exitCode;
}else{
 const rendererErrors=[];
 const {app,BrowserWindow,dialog,ipcMain}=require('electron');app.disableHardwareAcceleration();require(path.join(root,'scripts/package-boundary.cjs'))(entry,path.join(out,'dependency-boundary.json'));
 const Core=require(path.join(path.dirname(entry),'core.cjs')),ExcelJS=require('exceljs'),data=process.env.FLOWER_DATA_DIR,saveFile=path.join(data,'classroom-v2.json'),checks=[],calls=[];let main,lastPreview,lastError;
 const initial=Core.createInitialState();initial.students=initial.students.slice(0,3);fs.writeFileSync(saveFile,JSON.stringify(initial));
 const wait=ms=>new Promise(r=>setTimeout(r,ms)),js=c=>main.webContents.executeJavaScript(c,true),get=()=>js('classroom.get().then(r=>r.state)'),file=r=>js('classroom.file('+JSON.stringify(r)+')');
 async function until(fn,label){for(let n=0;n<300;n++){if(await fn())return;await wait(15);}throw Error('Timed out '+label);}
 async function reset(){await js('closeModal()');const s=await file({command:'restore-apply',state:initial});await until(()=>js('state.revision==='+s.revision));await js('page="settings";render()');}
 async function preview(target,mode='append'){dialog.showOpenDialog=async()=>({canceled:false,filePaths:[target]});lastPreview=null;lastError=null;await js('document.querySelector("#import-mode").value='+JSON.stringify(mode)+';document.querySelector("[data-do=import]").click()');await until(()=>lastPreview||lastError,'preview or error');await wait(35);if(lastError)throw Error(lastError);return lastPreview;}
 const report=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({entry,completed,checks,calls,rendererErrors,syntheticOnly:true,windowsExecuted:false},null,2));
 async function check(name,fn){const detail={};try{await fn(detail);checks.push({name,status:'passed',detail});console.log('PASS_FORMAT',name);}catch(e){checks.push({name,status:'failed',detail,error:e.stack,actual:e.actual,expected:e.expected});console.log('FAIL_FORMAT',name,e.message);try{fs.writeFileSync(path.join(out,'failure-'+checks.length+'.png'),(await main.webContents.capturePage()).toPNG());}catch{}}report();}
 const originalHandle=ipcMain.handle.bind(ipcMain);ipcMain.handle=function(channel,handler){return originalHandle(channel,channel==='file:command'?async(event,request)=>{try{const r=await handler(event,request);if(request.command==='import-preview')lastPreview=r;calls.push({command:request.command,preview:r?.avatarMatches?{rows:r.rows,statuses:r.avatarMatches.map(v=>v.status)}:undefined});return r;}catch(e){if(request.command==='import-preview')lastError=e.message;throw e;}}:handler);};
 app.on('web-contents-created',(_e,w)=>w.on('console-message',(event,level,message)=>{if(event.level==='error'||level>=3)rendererErrors.push(event.message??message);}));
 if(!qaChild.load(entry,app))return;const timeout=setTimeout(()=>{report();app.exit(3);},80000);
 app.whenReady().then(async()=>{try{await until(()=>{main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');return main&&!main.webContents.isLoading();});
  // Async workbook bootstrap registers native IPC before creating the main window.
  ipcMain.handle=originalHandle;await until(()=>js('!!state'));main.setContentSize(1365,1000);
 const library=await file({command:'avatars-list'}),folder=library.directory,png=fs.readFileSync(path.join(folder,library.items[0].fileName));for(const n of ['001.png','Hero.PNG','12.30.png'])fs.writeFileSync(path.join(folder,n),png);
 const rich=t=>({richText:[{text:t.slice(0,2),font:{bold:true}},{text:t.slice(2)}]});
 const fixtures=[
  {name:'CSV preserves leading-zero avatar stem and group',ext:'csv',rows:[['合成数字头像','001','001']],expected:[['合成数字头像','001','001','matched']]},
  {name:'CSV preserves quoted numeric-looking student name',ext:'csv',rows:[['0001','0002','001.png']],expected:[['0001','0002','001.png','matched']]},
  {name:'CSV preserves decimal-looking avatar stem',ext:'csv',rows:[['合成小数头像','组','12.30']],expected:[['合成小数头像','组','12.30','matched']]},
  {name:'CSV complete numeric filename remains valid control',ext:'csv',rows:[['合成完整头像','组','001.png']],expected:[['合成完整头像','组','001.png','matched']]},
  {name:'XLSX rich-text student name is imported as visible text',ext:'xlsx',rows:[[rich('合成彩色同学'),'组','Hero.PNG']],expected:[['合成彩色同学','组','Hero.PNG','matched']]},
  {name:'XLSX rich-text group retains visible group instead of defaulting',ext:'xlsx',rows:[['合成彩色分组',rich('合成彩色组'),'Hero.PNG']],expected:[['合成彩色分组','合成彩色组','Hero.PNG','matched']]},
  {name:'XLSX rich-text avatar retains filename and selected image',ext:'xlsx',rows:[['合成彩色头像','组',rich('Hero.PNG')]],expected:[['合成彩色头像','组','Hero.PNG','matched']]},
  {name:'XLSX rich-text required header is treated as visible header',ext:'xlsx',head:[rich('姓名'),'小组','头像名称'],rows:[['合成彩色表头','组','Hero.PNG']],expected:[['合成彩色表头','组','Hero.PNG','matched']]},
  {name:'XLSX rich-text name-only row is not silently omitted during replace',ext:'xlsx',rows:[['合成普通同学','',''],[rich('合成仅姓名'),'','']],mode:'replace',expected:[['合成普通同学','未分组','','default'],['合成仅姓名','未分组','','default']]},
  {name:'XLSX plain strings and numeric stem remain valid control',ext:'xlsx',rows:[['0001','0002','001']],expected:[['0001','0002','001','matched']]},
 ];
 for(let i=0;i<fixtures.length;i++){const f=fixtures[i];await check(f.name,async d=>{await reset();const target=path.join(out,'fixture-'+(i+1)+'.'+f.ext),head=f.head||['姓名','小组','头像名称'];d.target=target;d.input=f.rows;d.expected=f.expected;if(f.ext==='csv'){const q=s=>'"'+String(s).replaceAll('"','""')+'"';fs.writeFileSync(target,'\ufeff'+[head,...f.rows].map(r=>r.map(q).join(',')).join('\r\n'));}else{const b=new ExcelJS.Workbook(),s=b.addWorksheet('名单');s.addRow(head);s.addRows(f.rows);await b.xlsx.writeFile(target);}const before=await get(),bytes=fs.readFileSync(saveFile,'utf8');let p;try{p=await preview(target,f.mode);}catch(e){d.rejection=e.message;assert.deepEqual(await get(),before);assert.equal(fs.readFileSync(saveFile,'utf8'),bytes);throw e;}d.preview={count:p.count,rows:p.rows,matches:p.avatarMatches.map(v=>({requested:v.requested,status:v.status,fileName:v.fileName}))};await js('document.querySelector("#confirm-action").click()');await until(()=>js('!document.querySelector("#confirm-action")'),'confirmation close');const saved=await get(),added=f.mode==='replace'?saved.students:saved.students.slice(before.students.length);d.saved=added.map(v=>({name:v.name,group:v.group,photoSha256:v.photo?sha(v.photo):null}));d.otherStudentsPreserved=f.mode==='replace'?null:JSON.stringify(saved.students.slice(0,before.students.length))===JSON.stringify(before.students);const actual=added.map((v,j)=>[v.name,v.group,p.avatarMatches[j].requested,p.avatarMatches[j].status]);assert.deepEqual(actual,f.expected);assert.deepEqual(JSON.parse(fs.readFileSync(saveFile)),saved);});}
 completed=true;clearTimeout(timeout);report();console.log('SUMMARY_FORMAT',checks.filter(c=>c.status==='passed').length,'passed',checks.filter(c=>c.status==='failed').length,'failed');app.exit(checks.some(c=>c.status==='failed')||rendererErrors.length?1:0);
 }catch(e){clearTimeout(timeout);checks.push({name:'fatal harness',status:'failed',error:e.stack});report();console.log('FATAL_FORMAT',e.stack);app.exit(2);}});
}
