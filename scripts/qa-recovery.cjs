'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {app,BrowserWindow}=require('electron');
const mainEntry=path.resolve(process.env.FLOWER_PACKAGE_MAIN||path.join(__dirname,'../src/main.cjs')),appRequire=require('node:module').createRequire(mainEntry);
const {createInitialState,applyAction,validateState}=appRequire('./core.cjs');
const {saveAtomic}=appRequire('./io.cjs'),Configuration=appRequire('./configuration-model.js'),Rules=appRequire('./score-rules.js'),Workbook=appRequire('./score-rule-workbook.cjs');
const mode=process.argv.find(v=>['restart','fallback','both-corrupt','write-error'].includes(v));assert.ok(mode,'explicit recovery mode required');const dir=path.resolve(__dirname,'../.qa-recovery-'+mode),file=path.join(dir,'classroom.json'),modernFile=path.join(dir,'classroom-v2.json');
assert.ok(path.basename(dir).startsWith('.qa-recovery-'));fs.rmSync(dir,{recursive:true,force:true});fs.mkdirSync(dir,{recursive:true});
let expected=createInitialState();expected=applyAction(expected,{type:'settings',className:'QA恢复课堂'});expected=applyAction(expected,{type:'score',ids:[expected.students[0].id],delta:27});
let original;
if(mode==='restart'){expected=applyAction(expected,{type:'timer.set',seconds:30});expected=applyAction(expected,{type:'timer.start'});saveAtomic(file,expected);}
if(mode==='fallback'){saveAtomic(file,expected);saveAtomic(file,applyAction(expected,{type:'score',ids:[expected.students[0].id],delta:1}));fs.writeFileSync(file,'{broken-latest');original='{broken-latest';}
if(mode==='both-corrupt'){fs.writeFileSync(file,'{broken-latest');fs.writeFileSync(file+'.previous','{broken-previous');original='{broken-latest';}
if(mode==='write-error'){saveAtomic(file,expected);fs.mkdirSync(modernFile+'.tmp');}
const originalLegacy=fs.existsSync(file)?fs.readFileSync(file):null,originalPrevious=fs.existsSync(file+'.previous')?fs.readFileSync(file+'.previous'):null;
process.env.FLOWER_HEADLESS_TEST='1';process.env.FLOWER_DATA_DIR=dir;app.disableHardwareAcceleration();require(mainEntry);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Bootstrap materializes known configuration defaults without changing revision
// or any recovered classroom field. Compare original fields in full.
async function assertRecoveredBootstrap(actual,window){
 const fields=['scoreRules','showAvatars','scoreStep','studentSort','hideLateForms','timerSound','toolDefaults','wheelPrizes','challengeOptions'],payload=structuredClone(actual);
 for(const key of fields){assert.ok(Object.hasOwn(actual.settings,key),'Bootstrap must materialize '+key);if(!Object.hasOwn(expected.settings,key))delete payload.settings[key];}
 delete payload.appConfig;delete payload.sharedScoreRules;assert.deepEqual(payload,{...expected,version:2});
 assert.deepEqual(Configuration.snapshot(actual),Configuration.snapshot(expected));const share=Rules.previewShared(expected);assert.equal(share.required,false);
 assert.deepEqual(actual.sharedScoreRules,{version:1,revision:0,rules:share.rules,migration:{panels:share.panels,mappings:share.mappings}});assert.deepEqual(actual.settings.scoreRules,actual.sharedScoreRules.rules);
 const info=await window.webContents.executeJavaScript('classroom.file({command:"folder-info"})'),book=await Workbook.parseBytes(fs.readFileSync(info.configuration),actual);assert.equal(path.basename(info.configuration),'配置.xlsx');assert.deepEqual(book,Workbook.configuration(actual));assert.deepEqual(book.configSnapshot,Configuration.snapshot(actual));
 assert.deepEqual(JSON.parse(fs.readFileSync(modernFile)),actual);assert.deepEqual(fs.readFileSync(file),originalLegacy);if(originalPrevious!==null)assert.deepEqual(fs.readFileSync(file+'.previous'),originalPrevious);
}
app.whenReady().then(async()=>{try{let w;for(let i=0;i<100;i++){w=BrowserWindow.getAllWindows()[0];if(w&&!w.webContents.isLoading())break;await sleep(50);}await sleep(300);const read=()=>w.webContents.executeJavaScript('classroom.get()');const loaded=await read();
 if(mode==='restart'){await assertRecoveredBootstrap(loaded.state,w);assert.ok(loaded.state.timer.endsAt>Date.now());assert.equal(loaded.warning,'');}
 if(mode==='fallback'){await assertRecoveredBootstrap(loaded.state,w);assert.match(loaded.warning,/上一次完整存档/);assert.equal(fs.readFileSync(file,'utf8'),original);const damaged=fs.readdirSync(dir).filter(n=>n.includes('.damaged-'));assert.equal(damaged.length,1);assert.equal(fs.readFileSync(path.join(dir,damaged[0]),'utf8'),original);}
 if(mode==='both-corrupt'){assert.equal(loaded.state.students.length,12);assert.equal(loaded.state.students[0].score,0);assert.match(loaded.warning,/原文件/);const damaged=fs.readdirSync(dir).find(n=>n.includes('.damaged-'));assert.equal(fs.readFileSync(path.join(dir,damaged),'utf8'),original);assert.equal(fs.readFileSync(file,'utf8'),original);}
 if(mode==='write-error'){const disk=fs.readFileSync(file,'utf8');await assert.rejects(w.webContents.executeJavaScript(`classroom.action(${JSON.stringify({type:'score',ids:[expected.students[0].id],delta:1})})`));assert.deepEqual((await read()).state,expected);assert.equal(fs.readFileSync(file,'utf8'),disk);assert.equal(fs.existsSync(modernFile),false);fs.rmdirSync(modernFile+'.tmp');await w.webContents.executeJavaScript(`classroom.action(${JSON.stringify({type:'score',ids:[expected.students[0].id],delta:1})})`);assert.equal((await read()).state.students[0].score,28);assert.deepEqual(validateState(JSON.parse(fs.readFileSync(modernFile))),(await read()).state);assert.equal(fs.readFileSync(file,'utf8'),disk);}
 console.log('PASS_RECOVERY',mode);app.exit(0);
 }catch(e){console.error('FAIL_RECOVERY',mode,e);app.exit(1);}});setTimeout(()=>app.exit(2),15000);
