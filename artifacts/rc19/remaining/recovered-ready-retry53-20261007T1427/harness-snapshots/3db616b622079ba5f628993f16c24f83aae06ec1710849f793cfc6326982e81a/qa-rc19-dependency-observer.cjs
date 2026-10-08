'use strict';
// QA launch provenance only: never substitutes production modules or assertions.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const out=process.env.FLOWER_RC19_DEPENDENCY_OUT;
if(out){
 const repo=path.resolve(process.env.FLOWER_RC19_REPO),mode=process.env.FLOWER_RC19_MODE,archive=process.env.FLOWER_QA_ASAR,extracted=process.env.FLOWER_RC19_EXTRACTED;
 const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),inside=(p,root)=>p===root||p.startsWith(root+path.sep);
 let seed=null,seedFiles=null;
 if(!process.versions.electron&&process.argv[2]==='--seed'&&process.env.FLOWER_RC19_SEED_CONTRACT){
  const spec=JSON.parse(fs.readFileSync(process.env.FLOWER_RC19_SEED_CONTRACT));
  if(process.argv.length!==5||path.resolve(process.argv[1])!==path.join(repo,'scripts/qa-rc19-workbook-main-migration.cjs')||sha(process.argv[1])!==spec.harnessSha256||!Object.hasOwn(spec.perScenarioExpectedExitCodes,process.argv[3])||path.resolve(process.argv[4])!==path.join(path.resolve(process.env.FLOWER_RC19_WORKBOOK_MAIN_OUT),process.argv[3],'program')||path.resolve(process.env.FLOWER_RC18_SOURCE)!==spec.oldRoot)throw Error('RC19_SEED_IDENTITY_MISMATCH');
  seedFiles={...spec.staticRelativeRequireClosure,...spec.additionalInputHashes};for(const[n,h]of Object.entries(seedFiles))if(sha(path.join(spec.oldRoot,n))!==h)throw Error('RC19_SEED_SOURCE_MISMATCH '+n);
  seed=spec;
 }
 const startup=process.env.FLOWER_STARTUP_MAIN?.match(/^(.*?\.asar)(?:[\\/]|$)/)?.[1];
 if(startup){const disk=process.versions.electron?require('original-fs'):fs;const actual=crypto.createHash('sha256').update(disk.readFileSync(startup)).digest('hex');if(actual!==process.env.FLOWER_QA_ASAR_SHA256)throw Error('RC19_STARTUP_COPY_MISMATCH');}
 const sourceDependencies=mode==='source'?fs.realpathSync(path.join(repo,'node_modules')):null;
 const permitted=(mode==='source'?[repo,sourceDependencies]:[archive,extracted,startup]).filter(Boolean).map(p=>path.resolve(p));
 const production=p=>!!(sourceDependencies&&inside(p,sourceDependencies))||permitted.some(root=>inside(p,path.join(root,'src'))||inside(p,path.join(root,'node_modules')));
 const entries=new Map(),fixtureEntries=new Map(),violations=[],startedAt=new Date().toISOString(),id=process.pid+'-'+crypto.randomUUID();
 fs.mkdirSync(out,{recursive:true});
 let frozenFixture=null,asarReader=null;
 const qaParent=p=>['scripts','tests','artifacts'].some(folder=>inside(p,path.join(repo,folder)))&&!p.includes(path.sep+'node_modules'+path.sep);
 function verifyFixture(file,parent){
  if(!qaParent(parent)&&!fixtureEntries.has(parent))throw Error('RC19_UNIDENTIFIED_FIXTURE_PARENT '+parent);
  if(!frozenFixture){const filename=process.env.FLOWER_QA_FREEZE_FILE;if(sha(filename)!==process.env.FLOWER_QA_FREEZE_SHA256)throw Error('RC19_FIXTURE_FREEZE_IDENTITY');frozenFixture=JSON.parse(fs.readFileSync(filename));asarReader=require(path.join(repo,'node_modules/@electron/asar'));const disk=process.versions.electron?require('original-fs'):fs;if(crypto.createHash('sha256').update(disk.readFileSync(archive)).digest('hex')!==process.env.FLOWER_QA_ASAR_SHA256)throw Error('RC19_FIXTURE_ASAR_IDENTITY');}
  const relative=path.relative(repo,file).split(path.sep).join('/');if(['src/main.cjs','src/preload.cjs','src/app.js'].includes(relative))throw Error('RC19_PRODUCT_ENTRY_CANNOT_BE_FIXTURE '+relative);const expected=frozenFixture.files[relative],actual=sha(file);if(!expected||actual!==expected||crypto.createHash('sha256').update(asarReader.extractFile(archive,relative)).digest('hex')!==expected)throw Error('RC19_FIXTURE_SOURCE_ASAR_MISMATCH '+relative);
  if(!fixtureEntries.has(file))fixtureEntries.set(file,{file,parent,relative,sha256Before:actual,selectedAsar:archive,selectedAsarSha256:process.env.FLOWER_QA_ASAR_SHA256,sourceToAsarEqual:true,role:'frozen-QA-fixture-source'});
 }
 const rawResolve=Module._resolveFilename;
 Module._resolveFilename=function(request,parent,...rest){const resolved=rawResolve.call(this,request,parent,...rest);
  if(path.isAbsolute(resolved)&&fs.existsSync(resolved)&&fs.statSync(resolved).isFile()){
   const parentFile=parent?.filename||'',isProduct=production(parentFile),isOld=seed&&inside(resolved,path.join(seed.oldRoot,'src'));
   if(seed){
    if(isOld&&!Object.hasOwn(seed.staticRelativeRequireClosure,path.relative(seed.oldRoot,resolved)))throw Error('RC19_UNDECLARED_SEED_MODULE '+resolved);
    if(/\/flower-rc1[5678][^/]*\/FlowerClassroom-source\/(?:src|scripts)\//.test(resolved)&&!isOld)throw Error('RC19_UNDECLARED_HISTORICAL_SEED_CODE '+resolved);
    if(!entries.has(resolved))entries.set(resolved,{file:resolved,sha256Before:sha(resolved)});
   }else{
    if(isProduct&&!permitted.some(root=>inside(resolved,root))){violations.push({parent:parentFile,request,resolved});throw Error('RC19_PRODUCT_DEPENDENCY_ESCAPE '+resolved);}
    if(isProduct||production(resolved))if(!entries.has(resolved))entries.set(resolved,{file:resolved,sha256Before:sha(resolved)});
    if(mode==='packaged'&&inside(resolved,path.join(repo,'src'))){try{verifyFixture(resolved,parentFile);}catch(error){violations.push({parent:parentFile,request,resolved,error:error.message});throw error;}}
    if(/\/flower-rc1[5678][^/]*\/FlowerClassroom-source\/(?:src|scripts)\//.test(resolved)){violations.push({parent:parentFile,request,resolved});throw Error('RC19_HISTORICAL_RUNTIME_FALLBACK '+resolved);}
   }
  }
  return resolved;
 };
 function flush(code){
  const fixtureImports=[...fixtureEntries.values()].map(v=>({...v,sha256After:sha(v.file)}));if(fixtureImports.some(v=>v.sha256Before!==v.sha256After))violations.push({kind:'frozen-fixture-bytes-changed'});
  const dependencies=[...entries.values()].map(v=>({...v,sha256After:sha(v.file)})),seedSourcesUnchanged=seed?Object.entries(seedFiles).every(([n,h])=>sha(path.join(seed.oldRoot,n))===h):null;
  fs.writeFileSync(path.join(out,id+'.json'),JSON.stringify({schema:'rc19-dependency-observer-v1',pid:process.pid,argv:process.argv,mode,role:seed?'fixture-seed':process.versions.electron?'rc19-electron':'rc19-node',startedAt,completedAt:new Date().toISOString(),observedExitCode:code??null,permittedRoots:permitted,fixtureImports,fixtureImportsUnchanged:fixtureImports.every(v=>v.sha256Before===v.sha256After),dependencies,dependenciesUnchanged:dependencies.every(v=>v.sha256Before===v.sha256After),violations,...(seed?{scenario:process.argv[3],expectedSeedExitCode:seed.perScenarioExpectedExitCodes[process.argv[3]],seedSourcesUnchanged,seedSourceHashes:seedFiles}:{}),syntheticOnly:true,windowsExecuted:false},null,2));
 }
 process.on('exit',flush);
 const rawLoad=Module._load;let hooked=false;
 Module._load=function(request,...rest){const value=rawLoad.call(this,request,...rest);if(request==='electron'&&process.versions.electron&&value.app&&!hooked){hooked=true;const appExit=value.app.exit.bind(value.app);value.app.exit=function(code){flush(code);return appExit(code);};}return value;};
}
