'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),vm=require('node:vm'),{spawn}=require('node:child_process');
const Config=require('../src/configuration-model.js');
test('RC18 source preview serves the exact configuration module and its dependencies for browser startup',{timeout:20000},async t=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'flower-preview-assets-')),file=path.join(dir,'synthetic-classroom.json'),probe=net.createServer();
 await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,[path.join(root,'scripts/preview.cjs')],{cwd:root,env:{...process.env,PORT:String(port),FLOWER_PREVIEW_DATA:file},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}fs.rmSync(dir,{recursive:true,force:true});});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Preview startup timeout: '+output)),10000),ready=()=>{if(output.includes('http://127.0.0.1:')){clearTimeout(timeout);child.stdout.off('data',ready);resolve();}};child.stdout.on('data',ready);child.once('error',error=>{clearTimeout(timeout);reject(error);});ready();});
 const base='http://127.0.0.1:'+port,html=await (await fetch(base+'/')).text();assert.match(html,/<script[^>]+src="configuration-model\.js"/);
 const browser=vm.createContext({URL});for(const name of ['pet-progress.js','organization-tools.js','classroom-wheels.js','toolbox-extra.js','configuration-model.js']){const response=await fetch(base+'/'+name);assert.equal(response.status,200,name+' is required for startup');assert.match(response.headers.get('content-type'),/application\/javascript/);const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual(bytes,fs.readFileSync(path.join(root,'src',name)));vm.runInContext(bytes.toString('utf8'),browser,{filename:name});}
 const state=(await (await fetch(base+'/api/state')).json()).state,defaults=vm.runInContext('JSON.stringify(ConfigurationModel.toolDefaults('+JSON.stringify(state)+'))',browser);assert.deepEqual(JSON.parse(defaults),Config.toolDefaults(state));
 // Adding this one public asset must keep unlisted paths outside the whitelist.
 for(const route of ['/core.cjs','/package.json','/unlisted-preview-module.js'])assert.equal((await fetch(base+route)).status,404,route);
 assert.equal(fs.existsSync(file),false,'Reading public assets and initial state must not create classroom data');
});
