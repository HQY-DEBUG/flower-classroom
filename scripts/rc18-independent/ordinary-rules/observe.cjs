'use strict';
// Read-only evidence instrumentation, inherited by every actual Node/Electron child.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),cp=require('node:child_process');
const out=process.env.RULE_AUDIT_OBSERVER_OUT,sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),dependencies=new Map(),violations=[],spawns=[];
if(out){
 fs.mkdirSync(out,{recursive:true});
 const roots=[process.env.RULE_AUDIT_RUNTIME,process.env.RULE_AUDIT_ENTRY_ROOT,...(process.env.FLOWER_RULE_MODE==='source'?[fs.realpathSync(path.join(process.env.RULE_AUDIT_REPO,'node_modules'))]:[])].filter(Boolean),inside=p=>roots.some(r=>p.startsWith(r+path.sep));
 const resolve=Module._resolveFilename,load=Module._load;
 Module._resolveFilename=function(request,parent,...rest){const value=resolve.call(this,request,parent,...rest);if(path.isAbsolute(value)&&fs.existsSync(value)&&fs.statSync(value).isFile()){
  if(!dependencies.has(value))dependencies.set(value,{file:value,sha256Before:sha(value)});
  if(parent?.filename&&inside(parent.filename)&&(/[/\\](src|node_modules)[/\\]/.test(parent.filename))&&!inside(value)){violations.push({request,parent:parent.filename,resolved:value});throw Error('RUNTIME_DEPENDENCY_ESCAPE '+value);}
 }return value;};
 const snapshot=()=>{const values=[...dependencies.values()].map(d=>({...d,sha256After:sha(d.file)}));fs.writeFileSync(path.join(out,process.pid+'-dependencies.json'),JSON.stringify({pid:process.pid,electron:process.versions.electron||null,argv:process.argv,dependencies:values,dependenciesUnchanged:values.every(d=>d.sha256Before===d.sha256After),violations,spawns},null,2));};
 let hooked=false;Module._load=function(request,...rest){const value=load.call(this,request,...rest);if(request==='electron'&&process.versions.electron&&value.app&&!hooked){hooked=true;const exit=value.app.exit.bind(value.app);value.app.exit=function(code){snapshot();return exit(code);};}return value;};
 const spawn=cp.spawnSync;cp.spawnSync=function(...args){const startedAt=new Date().toISOString(),r=spawn.apply(this,args);spawns.push({command:args[0],args:args[1],startedAt,completedAt:new Date().toISOString(),exitCode:r.status,signal:r.signal,error:r.error?{name:r.error.name,message:r.error.message,code:r.error.code}:null});snapshot();return r;};
 process.on('exit',snapshot);
}
