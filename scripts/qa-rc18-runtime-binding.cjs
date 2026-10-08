'use strict';
// QA-only binding and provenance. Never substitutes product modules or mutates product files.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const ordered=value=>Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
const mapHash=value=>sha(JSON.stringify(ordered(value)));
function archiveFor(entry){const match=entry.match(/^(.*?\.asar)(?:[\\/]|$)/);return match?match[1]:null;}
function archiveHash(archive){if(!archive)return null;const disk=process.versions.electron?require('original-fs'):fs;return sha(disk.readFileSync(archive));}
function freeze(root){const filename=process.env.FLOWER_QA_FREEZE_FILE?path.resolve(root,process.env.FLOWER_QA_FREEZE_FILE):path.resolve(root,process.env.FLOWER_FREEZE_DIR||'artifacts/rc18','frozen-source.json');return {filename,sha256:sha(fs.readFileSync(filename)),data:JSON.parse(fs.readFileSync(filename,'utf8'))};}
function readHashes(base,names){return ordered(Object.fromEntries(names.map(name=>[name,sha(fs.readFileSync(path.join(base,name)))])));}
function sourceSnapshot(root,frozen){const names=[...new Set([...Object.keys(frozen.files),...Object.keys(frozen.assetFiles),...Object.keys(frozen.packageFiles)])];const hashes=readHashes(root,names),expected={...frozen.files,...frozen.assetFiles,...frozen.packageFiles};return {sha256:mapHash(hashes),runtimeSha256:mapHash(readHashes(root,Object.keys(frozen.files))),fileCount:names.length,hashes,mismatches:names.filter(name=>hashes[name]!==expected[name])};}
function beginRun(root,out,entry,harness,{allowUnfrozen=false}={}){
 const frozen=freeze(root),startedAt=new Date().toISOString(),started=process.hrtime.bigint(),runId=crypto.randomUUID(),archive=archiveFor(entry),before=sourceSnapshot(root,frozen.data),asarBefore=archiveHash(archive);
 if(before.mismatches.length&&!allowUnfrozen)throw Error('Frozen source mismatch before UI QA: '+before.mismatches.join(', '));
 const identity={runId,startedAt,entry,provisionalRuntime:allowUnfrozen,mode:archive?'packaged-asar':'source',archive,archiveSha256:asarBefore,frozenSourceFile:frozen.filename,frozenSourceManifestSha256:frozen.sha256,frozenAt:frozen.data.frozenAt,harnessPath:harness,harnessSha256:sha(fs.readFileSync(harness)),bindingSha256:sha(fs.readFileSync(__filename)),sourceBefore:before,evidenceFiles:[path.join(out,'results.json')],evidenceDirectory:out,plannedBeforeExecution:true,syntheticOnly:true,windowsExecuted:false};
 fs.writeFileSync(path.join(out,'run-start.json'),JSON.stringify(identity,null,2));
 return {env:{FLOWER_QA_RUN_ID:runId,FLOWER_QA_STARTED_AT:startedAt},complete(child){
  const after=sourceSnapshot(root,frozen.data),asarAfter=archiveHash(archive),endedAt=new Date().toISOString(),runtimeFile=path.join(out,'runtime-binding.json');let runtime=null,report=null;
  if(fs.existsSync(runtimeFile))runtime=JSON.parse(fs.readFileSync(runtimeFile,'utf8'));
  if(fs.existsSync(path.join(out,'results.json')))report=JSON.parse(fs.readFileSync(path.join(out,'results.json'),'utf8'));
  const matching=runtime?.runId===runId&&report?.runId===runId,passed=child.status===0&&matching&&before.sha256===after.sha256&&asarBefore===asarAfter&&(allowUnfrozen||!after.mismatches.length)&&runtime?.passed===true&&!(report?.checks||[]).some(check=>check.status!=='passed')&&!(report?.errors||[]).length;
  const envelope={...identity,endedAt,elapsedMilliseconds:Number(process.hrtime.bigint()-started)/1e6,sourceAfter:after,sourceUnchanged:before.sha256===after.sha256,archiveSha256After:asarAfter,archiveUnchanged:asarBefore===asarAfter,childExitCode:child.status,childSignal:child.signal||null,childError:child.error?.message||null,matchingRunIdentity:matching,checkCount:report?.checks?.length||0,passedCheckCount:report?.checks?.filter(c=>c.status==='passed').length||0,rendererErrorCount:report?.errors?.length||0,runtimeBinding:runtimeFile,passed};
  fs.writeFileSync(path.join(out,'run-envelope.json'),JSON.stringify(envelope,null,2));return envelope;
 }};
}
function bindRuntime(root,out,entry,suite,{allowUnfrozen=false,faultInjection}={}){
 if(faultInjection!==undefined&&(!Array.isArray(faultInjection)||faultInjection.some(value=>typeof value!=='string')))throw Error('faultInjection metadata must be an array of strings');
 if(!process.versions.electron)throw Error('Runtime binding requires the real Electron process');
 const {app}=require('electron'),src=path.dirname(entry),appRoot=path.dirname(src),archive=archiveFor(entry),frozen=freeze(root),runId=process.env.FLOWER_QA_RUN_ID||crypto.randomUUID(),startedAt=new Date().toISOString(),start=process.hrtime.bigint();
 const expected={...frozen.data.files,...frozen.data.assetFiles},before=readHashes(appRoot,Object.keys(expected)),mismatches=Object.keys(expected).filter(name=>before[name]!==expected[name]);
 if(mismatches.length&&!allowUnfrozen)throw Error('Selected product runtime differs from frozen source: '+mismatches.join(', '));
 const requiredModels=[],dependencies=[],violations=[],windows=[],preloads=new Map();let finalReport;
 const originalLoad=Module._load,electronModule=require('electron'),ObservedBrowserWindow=new Proxy(electronModule.BrowserWindow,{construct(Target,args){const window=Reflect.construct(Target,args,Target);preloads.set(window.id,{path:args[0]?.webPreferences?.preload||null,observation:'Actual BrowserWindow constructor options, passed through unchanged'});return window;}});
 Module._load=function(request,parent,...args){const loaded=originalLoad.call(this,request,parent,...args);if(request==='electron'&&parent?.filename?.startsWith(src+path.sep))return {...loaded,BrowserWindow:ObservedBrowserWindow};return loaded;};
 const original=Module._resolveFilename;Module._resolveFilename=function(request,parent,...args){const result=original.call(this,request,parent,...args);const owned=archive?parent?.filename?.startsWith(archive+path.sep):parent?.filename?.startsWith(src+path.sep);if(owned&&path.isAbsolute(result)){dependencies.push({parent:parent.filename,request,resolved:result});if(archive&&!result.startsWith(archive+path.sep)){violations.push({parent:parent.filename,request,resolved:result});throw Error('PACKAGED_DEPENDENCY_ESCAPE '+request+' -> '+result);}}return result;};
 app.on('browser-window-created',(_event,window)=>{const capture=()=>{if(window.isDestroyed())return;const record={id:window.id,role:window.flowerRole||null,url:window.webContents.getURL(),preload:preloads.get(window.id)?.path||null,preloadObservation:preloads.get(window.id)?.observation||null,preferences:window.webContents.getLastWebPreferences()};const existing=windows.findIndex(item=>item.id===window.id);if(existing<0)windows.push(record);else windows[existing]=record;};window.webContents.on('did-finish-load',capture);});
 const version=JSON.parse(fs.readFileSync(path.join(appRoot,'package.json'),'utf8')).version;if(version!==frozen.data.candidateVersion)throw Error('Product version does not match frozen candidate');
 const originalExit=app.exit.bind(app);app.exit=function(code){
  if(finalReport)return originalExit(code);
  const after=readHashes(appRoot,Object.keys(expected)),endedAt=new Date().toISOString(),rendererViolations=windows.filter(w=>{let file;try{file=decodeURIComponent(new URL(w.url).pathname);}catch{return true;}return !file.startsWith(src+path.sep+'index.html')||w.preload!==path.join(src,'preload.cjs');});
  finalReport={runId,suite,provisionalRuntime:allowUnfrozen,mode:archive?'packaged-asar':'source',startedAt,endedAt,elapsedMilliseconds:Number(process.hrtime.bigint()-start)/1e6,entry,src,appRoot,version,archive,archiveSha256:archiveHash(archive),runtimeSourceSha256:mapHash(Object.fromEntries(Object.keys(frozen.data.files).map(name=>[name,before[name]]))),runtimeAllTrackedFilesSha256:mapHash(before),runtimeFilesBefore:before,runtimeFilesAfter:after,runtimeUnchanged:mapHash(before)===mapHash(after),frozenManifestSha256:frozen.sha256,frozenAt:frozen.data.frozenAt,frozenSourceMatches:!mismatches.length,requiredModels,dependencies,dependencyViolations:violations,windows,rendererViolations,realElectronMainPreloadRenderer:true,syntheticOnly:true,windowsExecuted:false,faultInjection:faultInjection??(suite==='layout-shared-rules'?['shell.openPath returns successful stub','delay actual workbook preview completion','temporary fs.renameSync EPERM for selected synthetic workbook']:['temporary fs.renameSync EPERM for selected synthetic workbook']),passed:code===0&&!violations.length&&!rendererViolations.length&&windows.length>=2&&mapHash(before)===mapHash(after)};
  fs.writeFileSync(path.join(out,'runtime-binding.json'),JSON.stringify(finalReport,null,2));return originalExit(finalReport.passed?code:code||1);
 };
 return {runId,entry,src,appRoot,archive,mode:archive?'packaged-asar':'source',require(name){const filename=path.join(src,name);requiredModels.push(filename);return require(filename);},dependency(name){const filename=path.join(appRoot,'node_modules',name);requiredModels.push(filename);return require(filename);}};
}
module.exports={beginRun,bindRuntime};
