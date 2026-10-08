'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root='/tmp/flower-classroom-workspace/flower-rc16-work/FlowerClassroom-source',out=path.resolve(process.env.FLOWER_INTERACTIONS_OUT),entry=path.resolve(process.env.FLOWER_PACKAGE_MAIN),runtimeDir=path.dirname(entry),archive=entry.includes('.asar/')?entry.slice(0,entry.indexOf('.asar/')+5):null;fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron){const r=require('node:child_process').spawnSync(require(path.join(root,'node_modules/electron')),['--no-sandbox','--ozone-platform=headless','--disable-gpu',__filename],{encoding:'utf8',timeout:60000});fs.writeFileSync(path.join(out,'floor-model.log'),(r.stdout||'')+(r.stderr||''));console.log(r.stdout);process.exitCode=r.status||0;}
else{
 const {app}=require('electron'),C=require(runtimeDir+'/core.cjs'),P=require(runtimeDir+'/pet-progress.js');
 const startedAt=new Date().toISOString(),digest=b=>crypto.createHash('sha256').update(b).digest('hex'),hash=()=>archive?digest(require('original-fs').readFileSync(archive)):null,beforeHash=hash();const files=(dir,p='')=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name),p+e.name+'/'):[p+e.name]);const hashes=()=>Object.fromEntries(files(runtimeDir).sort().map(f=>[f,digest(fs.readFileSync(path.join(runtimeDir,f)))])),beforeHashes=hashes();const clone=v=>JSON.parse(JSON.stringify(v)),checks=[];
 const perms=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
 for(const mode of ['legacy-linked','independent'])for(const policy of ['reject','clamp'])for(const order of perms)for(const graduated of [false,true]){
  const name=[mode,policy,order.join(''),graduated?'graduated-and-readopted':'active'].join('/'),trace=[];
  try{
   let s=C.createInitialState();s.students=s.students.slice(0,1).map(x=>({...x,id:'floor_old',name:'纯合成下限',score:0,growth:0,photo:''}));
   const act=a=>s=C.applyAction(s,{panelId:C.panelId(s),...a},1800000000000);
   act({type:'score',ids:['floor_old'],delta:2,reason:'合成初值'});act({type:'pet.stage-rules',thresholds:[1,1,1,1,1,1]});
   let id='floor_old';if(mode==='independent'){act({type:'student.add',name:'纯合成独立',pet:'dragon',adopted:true});id=s.students.at(-1).id;act({type:'pet.growth',ids:[id],delta:2,reason:'合成独立初值'});}
   act({type:'pet.growth-policy',growthFloor:policy});const p=()=>P.profile(s,id),account=()=>s.petAccounts.find(a=>a.studentId===id),oldCycle=p().activeCycleId;
   const scoreBefore=s.students.find(v=>v.id===id).score,studentGrowthBefore=s.students.find(v=>v.id===id).growth,events=[];
   if(mode==='legacy-linked'){act({type:'score',ids:[id],delta:3,reason:'合成旧链积分'});events.push({type:'undo',logId:s.logs.at(-1).id,delta:3,scoreDelta:3});}
   else{act({type:'pet.growth',ids:[id],delta:3,reason:'合成独立成长'});events.push({type:'pet.undo',logId:s.petLogs.at(-1).id,delta:3,scoreDelta:0});}
   // Both policies must debit exactly the recorded actual amount. A clamp is
   // not allowed to make its later undo credit the requested nine points.
   act({type:'pet.growth',ids:[id],delta:policy==='clamp'?-9:-5,reason:'合成扣至下限'});const debit=s.petLogs.at(-1);assert.equal(debit.changes[0].afterGrowth,0);if(policy==='clamp')assert.equal(debit.changes[0].actualDelta,-5);events.push({type:'pet.undo',logId:debit.id,delta:-5,scoreDelta:0});
   act({type:'pet.growth',ids:[id],delta:2,reason:'合成下限后再加'});events.push({type:'pet.undo',logId:s.petLogs.at(-1).id,delta:2,scoreDelta:0});
   let expectedOldGrowth=2,expectedScore=scoreBefore+(mode==='legacy-linked'?3:0),expectedStudentGrowth=studentGrowthBefore+(mode==='legacy-linked'?3:0),snapshot=null,newCycle=null;
   if(graduated){act({type:'pet.growth',ids:[id],delta:4,reason:'合成满级垫层'});expectedOldGrowth+=4;act({type:'pet.graduate',id});snapshot=clone(account().graduations);act({type:'pet.adopt',id,pet:'cat'});newCycle=p().activeCycleId;act({type:'pet.growth',ids:[id],delta:1,reason:'合成下一周期'});}
   // A serialization boundary midway models a same-data restore/round trip.
   s=C.validateState(clone(s));const rejected=[];
   function undo(index){const e=events[index],before=clone(s);if(expectedOldGrowth-e.delta<0){assert.throws(()=>act({type:e.type,logId:e.logId}),/低于|负|0/);assert.deepEqual(s,before);rejected.push(index);trace.push({index,outcome:'intended-rejection',oldGrowth:expectedOldGrowth});return false;}
    act({type:e.type,logId:e.logId});expectedOldGrowth-=e.delta;expectedScore-=e.scoreDelta;expectedStudentGrowth-=e.scoreDelta;
    assert.equal(account().cycles.find(v=>v.id===oldCycle).netGrowth,expectedOldGrowth);assert.equal(s.students.find(v=>v.id===id).score,expectedScore);assert.equal(s.students.find(v=>v.id===id).growth,expectedStudentGrowth);
    assert.equal(account().lifetimeNetGrowth,expectedOldGrowth+(graduated?1:0));assert.equal(p().growth,graduated?1:expectedOldGrowth);
    if(graduated){assert.equal(p().activeCycleId,newCycle);assert.deepEqual(account().graduations,snapshot);assert.equal(p().medalTotal,1);}
    assert.deepEqual(C.validateState(clone(s)),s);trace.push({index,outcome:'undone',oldGrowth:expectedOldGrowth,score:expectedScore,lifetime:account().lifetimeNetGrowth});return true;
   }
   for(const index of order)undo(index);for(const index of [...rejected])undo(index);
   assert.equal(expectedOldGrowth,graduated?6:2);assert.equal(expectedScore,scoreBefore);assert.equal(expectedStudentGrowth,studentGrowthBefore);
   checks.push({name,status:'passed',trace});
  }catch(e){checks.push({name,status:'failed',trace,error:e.stack});}
 }
 fs.writeFileSync(path.join(out,'floor-model-results.json'),JSON.stringify({entry,archive,startedAt,completedAt:new Date().toISOString(),beforeHashes,afterHashes:hashes(),runtimeUnchanged:JSON.stringify(beforeHashes)===JSON.stringify(hashes()),archiveSha256:beforeHash,archiveUnchanged:beforeHash===hash(),syntheticOnly:true,windowsExecuted:false,checks},null,2));
 console.log('SUMMARY_FLOOR',checks.filter(c=>c.status==='passed').length,'passed',checks.filter(c=>c.status==='failed').length,'failed');for(const c of checks.filter(c=>c.status==='failed'))console.log(c.name,c.error);
 app.exit(checks.some(c=>c.status==='failed')?1:0);
}
