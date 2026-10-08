'use strict';
// Ordinary migration interactions only. All source and destination files are synthetic.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'../..');
const entry=process.env.FLOWER_PACKAGE_MAIN||'/tmp/flower-classroom-workspace/flower-rc16-reaudit-20261007/payload/花伴课堂/resources/app.asar/src/main.cjs';
const src=path.dirname(entry),out=path.resolve(process.env.FLOWER_MIGRATION_INTERACTIONS_OUT||path.join(repo,'artifacts/reaudit-rc16/migration/interactions'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(value,null,2));};
function tree(root){const result={};function walk(dir){if(!fs.existsSync(dir))return;for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),s=fs.statSync(file);if(s.isDirectory())walk(file);else result[path.relative(root,file)]={size:s.size,sha256:sha(fs.readFileSync(file))};}}walk(root);return result;}
fs.mkdirSync(out,{recursive:true});
if(!process.versions.electron)throw Error('Run this probe with real Electron');
const {app,nativeImage}=require('electron');app.disableHardwareAcceleration();app.setPath('userData',path.join(out,'runtime'));
require('../package-boundary.cjs')(entry,path.join(out,'dependency-boundary.json'));
const C=require(path.join(src,'core.cjs')),M=require(path.join(src,'legacy-migration.cjs')),S=require(path.join(src,'storage.cjs')),W=require(path.join(src,'score-rule-workbook.cjs')),A=require(path.join(src,'avatar-library.cjs')),P=require(path.join(src,'folder-pristine.cjs'));
const defaults=path.join(src,'../assets/avatar-defaults'),names=require(path.join(defaults,'manifest.json')).files.map(x=>x.fileName);
const stateBase=()=>C.validateState(require('../../tests/pet-fixtures.cjs').legacyState());
const opts=root=>({dataDirectory:path.join(root,'数据'),backupDirectory:path.join(root,'备份'),resourceDirectory:root,validate:C.validateState});
const readState=root=>S.createStore(path.join(root,'数据'),{validate:C.validateState,initial:C.createInitialState}).load().state;
async function fixture(name){const home=path.join(out,'fixtures',name),source=path.join(home,'source'),root=path.join(home,'destination');const state=stateBase();save(path.join(source,'classroom.json'),state);save(path.join(source,'materials','notes.txt'),'Synthetic migration notes');save(path.join(source,'avatars','custom.png'),fs.readFileSync(path.join(defaults,names[43])));const initial=C.createInitialState(),store=S.createStore(path.join(root,'数据'),{validate:C.validateState,initial:()=>initial});store.load();store.save(initial);save(path.join(root,W.FILE_NAME),await W.buildBytes(initial));P.recordInitialState(path.join(root,'数据'),initial,root);const options=opts(root),previewOptions={allowPristineFiles:P.allowedPristineFiles(options.dataDirectory,initial),allowPristineWorkbookHash:P.allowedPristineWorkbookHash(options.dataDirectory,initial,root)};save(path.join(home,'source-before.json'),tree(source));save(path.join(home,'target-before.json'),tree(root));return{home,source,root,state,initial,options,previewOptions};}
const startedAt=new Date().toISOString(),checks=[];
const moduleHashes=Object.fromEntries(['legacy-migration.cjs','folder-pristine.cjs','folder-layout.cjs','score-rule-workbook.cjs','avatar-library.cjs','main.cjs','folder-ui.js'].map(name=>[name,sha(fs.readFileSync(path.join(src,name)))]));
const archive=entry.includes('.asar/')?entry.slice(0,entry.indexOf('.asar')+5):null,identity={entry,asarSha256:archive?sha(require('original-fs').readFileSync(archive)):null,moduleHashes,layer:archive?'Actual delivered ASAR modules in real Electron':'Candidate source modules in real Electron'};
async function check(name,fn){const beganAt=new Date().toISOString();try{const details=await fn();checks.push({name,beganAt,finishedAt:new Date().toISOString(),status:'passed',details});console.log('PASS',name);}catch(e){checks.push({name,beganAt,finishedAt:new Date().toISOString(),status:'failed',code:e.code||null,error:String(e.stack||e)});console.log('FAIL',name,e.message);}save(path.join(out,'results.partial.json'),{startedAt,...identity,checks});}
const preserve=f=>assert.deepEqual(tree(f.source),JSON.parse(fs.readFileSync(path.join(f.home,'source-before.json'))));
const prepare=(service,p)=>service.prepare(p.token,{approvedResourcePaths:p.externalResources.map(x=>x.path)});
(async()=>{
 await check('source changes between classroom validation and preview inventory cannot create a stale confirmed workbook',async()=>{
  const f=await fixture('source-preview-coherence'),first=path.join(f.source,'classroom.json');
  const newer=C.applyAction(f.state,{type:'panel.create',mode:'copy',name:'合成同时新增面板'},1770000000000);
  let injected=false;const disk=new Proxy(fs,{get(t,k){if(k==='readFileSync')return(file,...rest)=>{const value=t.readFileSync(file,...rest);if(!injected&&file===first){injected=true;save(first,newer);}return value;};return t[k];}});
  const service=M.createLegacyMigration({...f.options,disk});let p,error=null,result;
  try{p=service.preview(f.source,f.previewOptions);await prepare(service,p);result=service.commit(p.token);}catch(e){error={code:e.code,message:e.message};}
  const actual=fs.existsSync(path.join(f.root,'数据','classroom.json'))?readState(f.root):null;
  let workbookError=null;try{await W.parseBytes(fs.readFileSync(path.join(f.root,W.FILE_NAME)),actual);}catch(e){workbookError=e.message;}
  const detail={injected,preview:p&&{summary:p.summary,files:p.files},error,committed:!!result,loadedPanelCount:actual?1+(actual.panels?.others||[]).length:null,workbookError,actualState:actual,newerState:newer,target:tree(f.root),source:tree(f.source),...identity};
  save(path.join(f.home,'observed.json'),detail);
  assert.ok(error||!workbookError,'Migration completed with stale preview/summary and generated workbook that cannot parse against the migrated classroom');
  if(error)assert.equal(error.code,'SOURCE_CHANGED');
  return detail;
 });
 await check('two prepared confirmations for the same pristine destination commit once and safely cancel the stale one',async()=>{
  const f=await fixture('two-prepared'),service=M.createLegacyMigration(f.options),a=service.preview(f.source,f.previewOptions),b=service.preview(f.source,f.previewOptions);
  await Promise.all([prepare(service,a),prepare(service,b)]);const result=service.commit(b.token),after=tree(f.root);
  assert.throws(()=>service.commit(a.token),e=>['DESTINATION_NOT_EMPTY','TARGET_CHANGED'].includes(e.code));assert.deepEqual(tree(f.root),after);await service.cancel(a.token);assert.deepEqual(readState(f.root),f.state);assert.deepEqual(tree(path.join(result.archiveDirectory,'旧版数据')),tree(f.source));preserve(f);return{winner:b.token,staleConfirmationRefused:true};
 });
 await check('prepare copy failure after deleting the incoming file preserves target and source and a new preview recovers',async()=>{
  const f=await fixture('prepare-disappearing-source');let once=true;const victim=path.join(f.source,'materials','notes.txt'),original=fs.readFileSync(victim),io=new Proxy(fs.promises,{get(t,k){if(k==='copyFile')return async(from,...rest)=>{if(once&&from===victim){once=false;fs.unlinkSync(victim);}return t.copyFile(from,...rest);};return typeof t[k]==='function'?t[k].bind(t):t[k];}});
  const service=M.createLegacyMigration({...f.options,io}),p=service.preview(f.source,f.previewOptions),before=tree(f.root);await assert.rejects(prepare(service,p),e=>e.code==='ENOENT');assert.deepEqual(tree(f.root),before);save(victim,original);const next=service.preview(f.source,f.previewOptions);await prepare(service,next);service.commit(next.token);assert.deepEqual(readState(f.root),f.state);preserve(f);return{copyFailedBeforeCommit:true,newPreviewSucceeded:true};
 });
 await check('avatar deletion history survives three complete-folder copies and repeated refresh without restoring removed defaults',async()=>{
  const f=await fixture('repeated-avatar-copy');for(const name of names)save(path.join(f.root,'头像',name),fs.readFileSync(path.join(defaults,name)));save(path.join(f.root,A.SEED_MARKER),A.initialSeedMarker());save(path.join(f.source,'avatar-location-v2.json'),{version:2,directory:path.join(f.source,'avatars'),seededFiles:names.slice(0,40),complete:true});save(path.join(f.home,'source-before.json'),tree(f.source));
  const service=M.createLegacyMigration(f.options),p=service.preview(f.source,f.previewOptions);await prepare(service,p);service.commit(p.token);const original=tree(f.root);let prior=f.root;
  for(let index=1;index<=3;index++){const copy=path.join(f.home,'copy-'+index);fs.cpSync(prior,copy,{recursive:true});assert.deepEqual(M.createLegacyMigration(opts(copy)).recover(),{recovered:false});const library=A.createAvatarLibrary({resourceDirectory:copy,defaultsDirectory:defaults,nativeImage});const first=await library.refresh(),second=await library.refresh();assert.equal(first.items.length,81);assert.deepEqual(second,first);assert.equal(fs.existsSync(path.join(copy,'头像',names[0])),false);assert.equal(fs.existsSync(path.join(copy,'头像','custom.png')),true);assert.deepEqual(readState(copy),f.state);prior=copy;}
  assert.deepEqual(tree(f.root),original);preserve(f);return{successiveCompleteCopies:3,itemsPerCopy:81,originalUnchanged:true};
 });
 for(const afterRename of [1,2,3,4,5])await check('recovery interrupted after rollback rename '+afterRename+' survives two more whole-folder copies and restores the original bytes',async()=>{
  const f=await fixture('recovery-rename-'+afterRename),before=tree(f.root);let commitFailed=false,rollbackFailed=false;
  const boom=message=>Object.assign(Error(message),{code:'EIO'}),disk=new Proxy(fs,{get(t,k){if(k==='renameSync')return(from,to)=>{if(!commitFailed&&to===path.join(f.root,'数据',M.RECEIPT)){commitFailed=true;throw boom('Synthetic commit receipt rename failure');}if(commitFailed&&!rollbackFailed){rollbackFailed=true;throw boom('Synthetic initial rollback failure');}return t.renameSync(from,to);};return t[k];}});
  const service=M.createLegacyMigration({...f.options,disk}),p=service.preview(f.source,f.previewOptions);await prepare(service,p);assert.throws(()=>service.commit(p.token),e=>e.code==='RECOVERY_REQUIRED');
  const boundary=tree(f.root);save(path.join(f.home,'original-interrupted.json'),boundary);
  const first=path.join(f.home,'first-copy');fs.cpSync(f.root,first,{recursive:true});let count=0;
  const recoveryDisk=new Proxy(fs,{get(t,k){if(k==='renameSync')return(...args)=>{const result=t.renameSync(...args);if(++count===afterRename)throw boom('Synthetic recovery interrupted after successful rename '+count);return result;};return t[k];}});
  assert.throws(()=>M.createLegacyMigration({...opts(first),disk:recoveryDisk}).recover(),e=>e.code==='EIO');assert.equal(count,afterRename);const firstInterrupted=tree(first);save(path.join(f.home,'copied-recovery-interrupted.json'),firstInterrupted);
  const second=path.join(f.home,'second-copy');fs.cpSync(first,second,{recursive:true});assert.deepEqual(M.createLegacyMigration(opts(second)).recover(),{recovered:true,committed:false});assert.deepEqual(tree(second),before);assert.deepEqual(M.createLegacyMigration(opts(second)).recover(),{recovered:false});assert.deepEqual(tree(first),firstInterrupted);assert.deepEqual(tree(f.root),boundary);preserve(f);
  return{recoveryRenameCount:count,originalAndFirstCopyUnchanged:true,secondCopyRestored:true};
 });
 const report={startedAt,finishedAt:new Date().toISOString(),...identity,checks,passed:checks.filter(x=>x.status==='passed').length,failed:checks.filter(x=>x.status==='failed').length,syntheticOnly:true,windowsExecuted:false,scope:'Ordinary migration interactions, no lock or file security tests'};save(path.join(out,'results.json'),report);console.log(JSON.stringify({passed:report.passed,failed:report.failed}));app.exit(report.failed?1:0);
})().catch(e=>{save(path.join(out,'fatal.json'),{error:String(e.stack||e),...identity});console.error(e);app.exit(2);});
