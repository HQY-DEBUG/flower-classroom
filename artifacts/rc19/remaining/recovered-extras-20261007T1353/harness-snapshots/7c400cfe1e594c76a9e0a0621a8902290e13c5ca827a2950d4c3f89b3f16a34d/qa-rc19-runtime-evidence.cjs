'use strict';
// QA-only provenance and strict completion checks. No product substitution.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function sourceSnapshot(root,harness){
 const files={};
 function visit(folder){for(const entry of fs.readdirSync(path.join(root,folder),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const relative=path.join(folder,entry.name);if(entry.isDirectory())visit(relative);else if(entry.isFile())files[relative]=sha(fs.readFileSync(path.join(root,relative)));}}
 for(const folder of ['src','assets'])visit(folder);
 for(const name of ['package.json','package-lock.json',path.relative(root,harness),'scripts/qa-tool-control.cjs','scripts/package-boundary.cjs','scripts/qa-rc19-runtime-evidence.cjs'])if(fs.existsSync(path.join(root,name)))files[name]=sha(fs.readFileSync(path.join(root,name)));
 const ordered=Object.fromEntries(Object.entries(files).sort(([a],[b])=>a.localeCompare(b)));return {sha256:sha(JSON.stringify(ordered)),fileCount:Object.keys(ordered).length,files:ordered};
}
function archiveFor(entry){return entry.match(/^(.*?\.asar)(?:[\\/]|$)/)?.[1]||null;}
function evaluate({child,report,runtime,boundary,identity,after,archiveAfter}){
 const expected=[...identity.expectedCases].sort(),actual=(report?.checks||[]).map(c=>c.name).sort(),marker=`FLOWER_QA_COMPLETE ${identity.runId} ${expected.length}`;
 const reasons=[];
 if(child.error||child.signal||child.status!==0)reasons.push('child did not exit cleanly');
 if(!report||report.runId!==identity.runId||report.complete!==true||report.entry!==identity.entry)reasons.push('missing or unmatched completion report');
 if(JSON.stringify(actual)!==JSON.stringify(expected)||(report?.checks||[]).some(c=>c.status!=='passed'))reasons.push('expected journey set was incomplete or failed');
 if(!Array.isArray(report?.errors)||report.errors.length)reasons.push('renderer errors or missing renderer error report');
 if(!String(child.stdout||'').split(/\r?\n/).includes(marker))reasons.push('completion marker missing');
 if(!runtime||runtime.runId!==identity.runId||runtime.entry!==identity.entry||runtime.passed!==true)reasons.push('runtime provenance failed or missing');
 if(identity.archive&&(!boundary||boundary.archive!==identity.archive||boundary.status!=='passed'||boundary.violations?.length))reasons.push('packaged dependency boundary failed or missing');
 if(identity.sourceBefore.sha256!==after.sha256)reasons.push('source, assets or harness changed during run');
 if(identity.archiveSha256!==archiveAfter)reasons.push('selected archive changed during run');
 return {passed:!reasons.length,reasons};
}
function beginRun(root,out,entry,harness,expectedCases){
 const runId=crypto.randomUUID(),archive=archiveFor(entry),startedAt=new Date().toISOString(),started=process.hrtime.bigint();
 const identity={runId,startedAt,entry,mode:archive?'packaged-asar':'source',archive,archiveSha256:archive?sha(fs.readFileSync(archive)):null,expectedCases:[...expectedCases],sourceBefore:sourceSnapshot(root,harness),harnessPath:harness,syntheticOnly:true,windowsExecuted:false};
 fs.writeFileSync(path.join(out,'run-start.json'),JSON.stringify(identity,null,2));
 return {env:{FLOWER_QA_RUN_ID:runId},complete(child){
  const read=name=>{try{return JSON.parse(fs.readFileSync(path.join(out,name),'utf8'));}catch{return null;}};
  const report=read('results.json'),runtime=read('runtime-binding.json'),boundary=read('dependency-boundary.json'),after=sourceSnapshot(root,harness),archiveAfter=archive?sha(fs.readFileSync(archive)):null;
  const validation=evaluate({child,report,runtime,boundary,identity,after,archiveAfter});
  const envelope={...identity,endedAt:new Date().toISOString(),elapsedMilliseconds:Number(process.hrtime.bigint()-started)/1e6,sourceAfter:after,archiveSha256After:archiveAfter,childExitCode:child.status,childSignal:child.signal||null,childError:child.error?.message||null,reportCheckCount:report?.checks?.length||0,rendererErrorCount:report?.errors?.length??null,...validation};
  fs.writeFileSync(path.join(out,'run-envelope.json'),JSON.stringify(envelope,null,2));return envelope;
 }};
}
function bindRuntime(entry,out){
 if(!process.versions.electron)throw Error('Real Electron runtime required');
 const {app,BrowserWindow}=require('electron'),runId=process.env.FLOWER_QA_RUN_ID,src=path.dirname(entry),requiredModels=[],preloads=new Map(),startedAt=new Date().toISOString();
 if(!runId)throw Error('Run identity missing');
 require('./package-boundary.cjs')(entry,path.join(out,'dependency-boundary.json'));
 const originalLoad=Module._load,electronModule=require('electron'),ObservedBrowserWindow=new Proxy(BrowserWindow,{construct(Target,args){const window=Reflect.construct(Target,args,Target);preloads.set(window.id,args[0]?.webPreferences?.preload||null);return window;}});
 Module._load=function(request,parent,...args){const loaded=originalLoad.call(this,request,parent,...args);return request==='electron'&&parent?.filename?.startsWith(src+path.sep)?{...electronModule,BrowserWindow:ObservedBrowserWindow}:loaded;};
 const appRequire=Module.createRequire(entry);
 return {runId,load(name){const resolved=appRequire.resolve(name);requiredModels.push(resolved);return appRequire(name);},finish(){
  const windows=BrowserWindow.getAllWindows().map(window=>({id:window.id,role:window.flowerRole,url:window.webContents.getURL(),preload:preloads.get(window.id)||null}));
  const invalid=windows.filter(window=>{try{return decodeURIComponent(new URL(window.url).pathname)!==path.join(src,'index.html')||window.preload!==path.join(src,'preload.cjs');}catch{return true;}});
  const runtime={runId,entry,startedAt,endedAt:new Date().toISOString(),archive:archiveFor(entry),requiredModels,windows,invalidWindows:invalid,actualMainSha256:sha(fs.readFileSync(entry)),actualPreloadSha256:sha(fs.readFileSync(path.join(src,'preload.cjs'))),passed:requiredModels.length>=4&&windows.length>=2&&!invalid.length,realElectronMainPreloadRenderer:true};
  fs.writeFileSync(path.join(out,'runtime-binding.json'),JSON.stringify(runtime,null,2));return runtime;
 }};
}
module.exports={sourceSnapshot,evaluate,beginRun,bindRuntime};
