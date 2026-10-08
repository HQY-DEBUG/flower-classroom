'use strict';
// QA provenance only. Records real dependencies, native BrowserWindow options,
// and subprocess outcomes without replacing any product implementation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),cp=require('node:child_process');
const out=process.env.CLASSROOM_OBSERVER_OUT,runtime=process.env.CLASSROOM_RUNTIME_ROOT,repo=process.env.FLOWER_QA_ROOT;
if(out&&runtime&&repo){
 fs.mkdirSync(out,{recursive:true});
 const began=new Date().toISOString(),sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),files=new Map(),violations=[],spawns=[],windows=[],preloads=new Map();
 const frozen=JSON.parse(fs.readFileSync(path.resolve(process.env.FLOWER_QA_FREEZE_FILE||path.join(repo,'artifacts/rc18/frozen-source.json')))),names=Object.keys({...frozen.files,...frozen.assetFiles});
 const canReadRuntime=process.versions.electron||!runtime.includes('.asar'),runtimeHashes=()=>canReadRuntime?Object.fromEntries(names.map(n=>[n,sha(path.join(runtime,n))])):null,before=runtimeHashes();
 if(before)for(const name of names)if(before[name]!==({...frozen.files,...frozen.assetFiles})[name])throw Error('FROZEN_RUNTIME_MISMATCH '+name);
 const nativeResolve=Module._resolveFilename,nativeLoad=Module._load;let electronHooked=false;
 Module._resolveFilename=function(request,parent,...rest){const resolved=nativeResolve.call(this,request,parent,...rest);if(path.isAbsolute(resolved)&&fs.existsSync(resolved)&&fs.statSync(resolved).isFile()){
  if(!files.has(resolved))files.set(resolved,{file:resolved,sha256Before:sha(resolved)});
  if(parent?.filename&&(parent.filename.startsWith(path.join(runtime,'src')+path.sep)||parent.filename.startsWith(path.join(runtime,'node_modules')+path.sep))&&!resolved.startsWith(runtime+path.sep)&&!(runtime===repo&&resolved.startsWith(fs.realpathSync(path.join(repo,'node_modules'))+path.sep))){violations.push({parent:parent.filename,request,resolved});throw Error('PRODUCT_DEPENDENCY_ESCAPE '+resolved);}
 }return resolved;};
 function snapshot(){const dependencies=[...files.values()].map(d=>({...d,sha256After:sha(d.file)})),after=runtimeHashes();fs.writeFileSync(path.join(out,process.pid+'-runtime.json'),JSON.stringify({pid:process.pid,argv:process.argv,electron:process.versions.electron||null,startedAt:began,completedAt:new Date().toISOString(),runtimeRoot:runtime,runtimeBefore:before,runtimeAfter:after,runtimeUnchanged:JSON.stringify(before)===JSON.stringify(after),dependencies,dependenciesUnchanged:dependencies.every(d=>d.sha256Before===d.sha256After),violations,spawns,windows,syntheticOnly:true,windowsExecuted:false},null,2));}
 Module._load=function(request,parent,...rest){let loaded=nativeLoad.call(this,request,parent,...rest);if(request==='electron'&&process.versions.electron&&loaded.app){
  if(!electronHooked){electronHooked=true;const app=loaded.app,exit=app.exit.bind(app);app.on('browser-window-created',(_e,w)=>w.webContents.on('did-finish-load',()=>{if(w.isDestroyed())return;const value={id:w.id,role:w.flowerRole||null,url:w.webContents.getURL(),preload:preloads.get(w.id)||null};const i=windows.findIndex(v=>v.id===w.id);if(i<0)windows.push(value);else windows[i]=value;}));app.exit=function(code){snapshot();return exit(code);};}
  if(parent?.filename?.startsWith(path.join(runtime,'src')+path.sep)){const Native=loaded.BrowserWindow;loaded={...loaded,BrowserWindow:new Proxy(Native,{construct(Target,args){const w=Reflect.construct(Target,args,Target);preloads.set(w.id,args[0]?.webPreferences?.preload||null);return w;}})};}
 }return loaded;};
 const spawn=cp.spawnSync;cp.spawnSync=function(...args){const startedAt=new Date().toISOString(),r=spawn.apply(this,args);spawns.push({command:args[0],args:args[1],startedAt,completedAt:new Date().toISOString(),exitCode:r.status,signal:r.signal,error:r.error?{name:r.error.name,message:r.error.message,code:r.error.code}:null});snapshot();return r;};
 process.on('exit',snapshot);
}
