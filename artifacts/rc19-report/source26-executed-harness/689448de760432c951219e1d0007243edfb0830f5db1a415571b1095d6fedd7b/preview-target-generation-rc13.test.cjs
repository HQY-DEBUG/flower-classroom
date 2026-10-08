'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process'),C=require('../src/core.cjs'),W=require('../src/classroom-wheels.js');

test('Preview transaction boundary rejects old confirmation epochs and advances only on saved restores',{timeout:20000},async t=>{
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'flower-preview-epoch-')),file=path.join(dir,'classroom.json');
 let initial=C.createInitialState();initial.students=initial.students.slice(0,1);initial.students[0].score=40;initial=C.applyAction(initial,{type:'wheel.prizes',prizes:[{id:'synthetic',name:'合成奖品',cost:10}]});fs.writeFileSync(file,JSON.stringify(initial));
 const probe=net.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,[path.join(root,'scripts/preview.cjs')],{cwd:root,env:{...process.env,PORT:String(port),FLOWER_PREVIEW_DATA:file},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}fs.rmSync(dir,{recursive:true,force:true});});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Preview startup timeout: '+output)),10000);const ready=()=>{if(output.includes('http://127.0.0.1:')){clearTimeout(timeout);child.stdout.off('data',ready);resolve();}};child.stdout.on('data',ready);child.once('error',error=>{clearTimeout(timeout);reject(error);});ready();});
 const base='http://127.0.0.1:'+port,request=async(route,body)=>{const response=await fetch(base+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});return {status:response.status,body:await response.json()};};
 const original=await request('/api/state');assert.equal(original.body.restoreGeneration,0);
 const action={type:'wheel.redeem',id:initial.students[0].id,prizeId:'synthetic',expectedPrize:W.list(initial)[0],expectedStudent:W.studentIdentity(initial.students[0]),expectedScore:40,expectedRestoreGeneration:0,redemptionId:'synthetic_preview_rc13'};
 assert.equal((await request('/api/action',action)).body.students[0].score,30);
 assert.equal((await request('/api/restore',{state:initial,expectedRestoreGeneration:0})).status,200);
 const restored=(await request('/api/state')).body,before=fs.readFileSync(file,'utf8');assert.equal(restored.restoreGeneration,1);
 for(const [route,body] of [['/api/action',action],['/api/import-apply',{rows:[{name:'合成旧草稿'}],mode:'append'}],['/api/blank',{}],['/api/archive',{}],['/api/restore',{state:initial}]]){
  const result=await request(route,{...body,expectedRestoreGeneration:0});assert.equal(result.status,400);assert.match(result.body.error,/备份已恢复/);assert.equal(fs.readFileSync(file,'utf8'),before);assert.deepEqual((await request('/api/state')).body.state,restored.state);
 }
 fs.mkdirSync(file+'.tmp');try{assert.equal((await request('/api/restore',{state:initial,expectedRestoreGeneration:1})).status,400);assert.equal((await request('/api/state')).body.restoreGeneration,1);assert.equal(fs.readFileSync(file,'utf8'),before);}finally{fs.rmdirSync(file+'.tmp');}
 const controller=new AbortController(),stream=await fetch(base+'/api/events',{signal:controller.signal}),reader=stream.body.getReader();await reader.read();
 try{
  const saved=await request('/api/restore',{state:initial,expectedRestoreGeneration:1});assert.equal(saved.status,200);const event=new TextDecoder().decode((await reader.read()).value);assert.match(event,/"restoreGeneration":2/);assert.match(event,/"restored":true/);
 }finally{controller.abort();}
 const fresh={...action,expectedRestoreGeneration:2};assert.equal((await request('/api/action',fresh)).body.students[0].score,30);const saved=fs.readFileSync(file,'utf8');assert.equal((await request('/api/action',fresh)).status,400);assert.equal(fs.readFileSync(file,'utf8'),saved);
 assert.equal((await request('/api/state')).body.restoreGeneration,2);
});
