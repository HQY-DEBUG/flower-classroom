'use strict';
require('./observe.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'../..'),entry=process.env.FLOWER_PACKAGE_MAIN||path.join(repo,'src/main.cjs'),src=path.dirname(entry),out=path.resolve(process.env.FLOWER_MIGRATION_COMPAT_OUT||path.join(repo,'artifacts/reaudit-rc16/migration/authentic-journals'));
const baseline=path.join(repo,'artifacts/rc18/ordinary-independent/migration/legacy-inputs-complete-20261007T1006');
function expectedCurrentState(legacy){assert.equal(Object.hasOwn(legacy,'petProgression'),false);return {...legacy,petProgression:{version:1,costs:[5,10,15,20,20,20,20],repeatCost:20}};}
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),save=(f,x)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(x,null,2));};
function tree(root){const result={};function walk(dir){for(const name of fs.readdirSync(dir).sort()){const f=path.join(dir,name);if(fs.statSync(f).isDirectory())walk(f);else result[path.relative(root,f)]=hash(fs.readFileSync(f));}}walk(root);return result;}
const {app}=require('electron');app.disableHardwareAcceleration();app.setPath('userData',path.join(out,'runtime'));require('../package-boundary.cjs')(entry,path.join(out,'dependency-boundary.json'));
const M=require(path.join(src,'legacy-migration.cjs')),C=require(path.join(src,'core.cjs')),S=require(path.join(src,'storage.cjs'));const opts=root=>({dataDirectory:path.join(root,'数据'),backupDirectory:path.join(root,'备份'),resourceDirectory:root,validate:C.validateState});
const startedAt=new Date().toISOString(),checks=[];
for(const boundary of ['before-receipt','after-receipt'])for(const previousMethod of ['copy','move']){
 const name='authentic RC15 v1 '+boundary+' prior '+previousMethod+' survives three further complete-folder copies',beganAt=new Date().toISOString();
 try{
  const home=path.join(baseline,'fixtures','crash-'+boundary),original=path.join(home,'relocated-'+previousMethod),before=tree(original),expected=JSON.parse(fs.readFileSync(path.join(home,'fixture.json'))),first=path.join(out,boundary+'-'+previousMethod,'first');
  fs.cpSync(original,first,{recursive:true});const record=JSON.parse(fs.readFileSync(path.join(first,'备份',M.JOURNAL)));assert.equal(record.version,1);assert.ok(path.isAbsolute(record.stage));let prior=first;
  for(let i=1;i<=2;i++){const next=path.join(path.dirname(first),'copy-'+i);fs.cpSync(prior,next,{recursive:true});prior=next;}
  const interrupted=tree(prior);save(path.join(path.dirname(first),'before-recovery.json'),interrupted);
  assert.deepEqual(M.createLegacyMigration(opts(prior)).recover(),{recovered:true,committed:boundary==='after-receipt'});
  if(boundary==='before-receipt')assert.deepEqual(tree(prior),JSON.parse(fs.readFileSync(path.join(home,'target-before.json'))));
  else assert.deepEqual(S.createStore(opts(prior).dataDirectory,{validate:C.validateState,initial:C.createInitialState}).load().state,expectedCurrentState(expected.state));
  assert.deepEqual(M.createLegacyMigration(opts(prior)).recover(),{recovered:false});assert.deepEqual(tree(original),before);assert.deepEqual(tree(first),before);
  checks.push({name,beganAt,finishedAt:new Date().toISOString(),status:'passed',journalVersion:record.version,originalFixtureSha256:hash(Buffer.from(JSON.stringify(before))),originalFixtureUnchanged:true,intermediateCopiesUnchanged:true});console.log('PASS',name);
 }catch(e){checks.push({name,beganAt,finishedAt:new Date().toISOString(),status:'failed',error:String(e.stack||e)});console.log('FAIL',name,e.message);}
}
const result={startedAt,finishedAt:new Date().toISOString(),entry,asarSha256:entry.includes('.asar/')?hash(require('original-fs').readFileSync(entry.slice(0,entry.indexOf('.asar')+5))):null,moduleSha256:hash(fs.readFileSync(path.join(src,'legacy-migration.cjs'))),checks,passed:checks.filter(x=>x.status==='passed').length,failed:checks.filter(x=>x.status==='failed').length,syntheticOnly:true,windowsExecuted:false,layer:'Fresh real Electron execution using copies of preserved authentic RC15 journal fixtures'};save(path.join(out,'results.json'),result);app.exit(result.failed?1:0);
