'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{createHash}=require('node:crypto');
const ExcelJS=require('exceljs'),Core=require('../src/core.cjs'),Rules=require('../src/score-rules.js'),Config=require('../src/configuration-model.js'),W=require('../src/score-rule-workbook.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex'),clone=value=>structuredClone(value),saved=value=>Core.validateState(value);
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'flower-unified-rc18-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const backup=path.join(root,'备份'),data=path.join(root,'数据');fs.mkdirSync(backup);fs.mkdirSync(data);const create=options=>W.createScoreRuleWorkbook({resourceDirectory:root,backupDirectory:backup,dataDirectory:data,...options});return {root,backup,data,file:path.join(root,W.FILE_NAME),oldText:path.join(root,W.LEGACY_CONFIG_NAME),oldBook:path.join(root,W.LEGACY_FILE_NAME),create,service:create()};}
async function edit(file,fn){const book=new ExcelJS.Workbook();await book.xlsx.readFile(file);fn(book);await book.xlsx.writeFile(file);}
async function oldBook(state,label='合成旧表卡片'){const book=new ExcelJS.Workbook(),sheet=book.addWorksheet(W.SHEET_NAME);sheet.addRow(W.LEGACY_HEADERS);sheet.addRow([state.panels?.activeId||'panel_default',state.settings.className,'legacy_card',label,7,0]);return Buffer.from(await book.xlsx.writeBuffer());}
async function boot(f,state=Core.createInitialState()){return (await f.service.bootstrap(state,{saveState:saved})).state;}

test('unified first bootstrap persists app cache and one shared collection, exposes ten sheets, and changes no classroom records',async t=>{
 const f=fixture(t),state=Core.createInitialState(),before=clone(state);fs.writeFileSync(f.file,await W.buildInitialBytes());let writes=0;
 const result=await f.service.bootstrap(state,{saveState:value=>{writes++;return saved(value);}});assert.equal(writes,1);assert.ok(result.state.appConfig);assert.ok(result.state.sharedScoreRules);assert.deepEqual(state,before);assert.deepEqual(result.state.students,before.students);assert.deepEqual(result.state.logs,before.logs);
 const book=new ExcelJS.Workbook();await book.xlsx.readFile(f.file);assert.equal(book.worksheets.length,10);assert.equal(book.getWorksheet('计分卡片').columnCount,4);assert.equal(fs.existsSync(f.oldText),false);assert.equal(fs.existsSync(f.oldBook),false);
 const prior=fs.readFileSync(f.file),start=performance.now(),restarted=await f.create().bootstrap(result.state,{saveState:()=>assert.fail('read-only startup')});assert.equal(restarted.validated,true);assert.deepEqual(fs.readFileSync(f.file),prior);assert.ok(performance.now()-start<15000,'bounded synthetic Linux startup read');
});

test('old TXT and workbook migrate only via explicit full preview, source hashes remain unchanged, and changes after preview reject',async t=>{
 const f=fixture(t),state=Core.createInitialState();fs.writeFileSync(f.file,await W.buildInitialBytes());const txt=Buffer.from('initialZoom=1.3\nwindowWidth=1500\nwindowHeight=900\nstartMinimized=true\n'),xlsx=await oldBook(state);fs.writeFileSync(f.oldText,txt);fs.writeFileSync(f.oldBook,xlsx);
 const initial=fs.readFileSync(f.file),result=await f.service.bootstrap(state,{saveState:()=>assert.fail('migration must await preview')});assert.equal(result.migrationAvailable,true);assert.deepEqual(fs.readFileSync(f.file),initial);
 const preview=await f.service.prepareRefresh(state);assert.equal(preview.migration.legacyFiles,true);assert.equal(preview.legacySources.length,2);assert.equal(preview.configSummary.find(group=>group.sheet==='启动显示').changes.length,4);
 fs.appendFileSync(f.oldText,'# changed after preview\n');assert.throws(()=>f.service.commitRefresh(preview,{currentState:state,saveState:saved}),/来源.*已变化/);assert.deepEqual(fs.readFileSync(f.file),initial);
 fs.writeFileSync(f.oldText,txt);const retry=await f.service.prepareRefresh(state),next=f.service.commitRefresh(retry,{currentState:state,saveState:saved});assert.equal(next.appConfig.initialZoom,1.3);assert.equal(next.appConfig.windowWidth,1500);assert.equal(Rules.list(next)[0].label,'合成旧表卡片');assert.deepEqual(fs.readFileSync(f.oldText),txt);assert.deepEqual(fs.readFileSync(f.oldBook),xlsx);assert.deepEqual(next.students,state.students);
});

test('pending old workbook receipt is read-only evidence; migration uses current authoritative JSON card settings',async t=>{
 const f=fixture(t),state=Core.createInitialState(),bytes=await oldBook(state,'合成未提交旧卡片'),receipt=Buffer.from('{ unresolved legacy transaction evidence');fs.writeFileSync(f.oldBook,bytes);fs.writeFileSync(f.oldBook+'.flower-pending.json',receipt);
 const preview=await f.service.prepareRefresh(state);assert.match(preview.warning,/旧版未清理事务/);const next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});assert.deepEqual(Rules.list(next),Rules.list(state));assert.deepEqual(fs.readFileSync(f.oldBook),bytes);assert.deepEqual(fs.readFileSync(f.oldBook+'.flower-pending.json'),receipt);
});

test('established malformed or missing new config never reads or falls back to old TXT or score workbook',async t=>{
 const f=fixture(t),state=await boot(f);fs.writeFileSync(f.oldText,'initialZoom=1.8');fs.writeFileSync(f.oldBook,await oldBook(state));
 for(const variant of ['bad','missing']){
  if(variant==='bad')fs.writeFileSync(f.file,'synthetic invalid unified workbook');else fs.unlinkSync(f.file);
  const bytes=variant==='bad'?fs.readFileSync(f.file):null,io=new Proxy(fs,{get(target,key){if(['statSync','readFileSync'].includes(key))return(...args)=>{assert.notEqual(args[0],f.oldText);assert.notEqual(args[0],f.oldBook);return target[key](...args);};return target[key];}});
  const result=await f.create({fileSystem:io}).bootstrap(state,{saveState:()=>assert.fail('must use durable cache')});assert.equal(result.state,state);assert.match(result.warning,/继续使用最后有效配置/);assert.equal(state.appConfig.initialZoom,1);
  assert.deepEqual(fs.existsSync(f.file)?fs.readFileSync(f.file):null,bytes);
 }
});

test('external workbook edits are read-only on restart and full refresh applies settings together while preserving live tools',async t=>{
 const f=fixture(t),state=await boot(f);state.timer={durationMs:300000,remainingMs:100000,endsAt:2000000,running:true};
 await edit(f.file,book=>{book.getWorksheet('启动显示').getCell('B2').value=1.2;book.getWorksheet('面板设置').getCell('D2').value=9;book.getWorksheet('工具默认').getCell('C2').value=600;book.getWorksheet('计分卡片').getCell('B2').value='合成新的共享卡片';});
 const bytes=fs.readFileSync(f.file),restart=await f.create().bootstrap(state,{saveState:()=>assert.fail('external edits must not import at startup')});assert.equal(restart.needsReview,true);assert.equal(restart.state,state);assert.equal(state.appConfig.initialZoom,1);assert.deepEqual(fs.readFileSync(f.file),bytes);
 const preview=await f.service.prepareRefresh(state),next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});assert.equal(next.appConfig.initialZoom,1.2);assert.equal(next.settings.scoreStep,9);assert.equal(next.settings.toolDefaults.timerDurationSeconds,600);assert.deepEqual(next.timer,state.timer);assert.deepEqual(next.draw,state.draw);assert.equal(Rules.list(next)[0].label,'合成新的共享卡片');
});

test('custom new workbook with absent app cache takes precedence over old migration sources and never imports old TXT',async t=>{
 const f=fixture(t),state=Core.createInitialState();fs.writeFileSync(f.file,await W.buildBytes(state));fs.writeFileSync(f.oldText,'initialZoom=1.7');fs.writeFileSync(f.oldBook,await oldBook(state));
 await edit(f.file,book=>book.getWorksheet('启动显示').getCell('B2').value=1.1);const prior=fs.readFileSync(f.file);
 const result=await f.service.bootstrap(state,{saveState:()=>assert.fail('custom file review required')});assert.equal(result.validationDeferred,true);assert.deepEqual(fs.readFileSync(f.file),prior);
 const preview=await f.service.prepareRefresh(state);assert.equal(preview.migration?.legacyFiles,undefined);const next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});assert.equal(next.appConfig.initialZoom,1.1);assert.deepEqual(Rules.list(next),Rules.list(state));
});

test('copied migration sources are read from verified current-root backup paths and missing/tampered evidence blocks migration',async t=>{
 const f=fixture(t),state=Core.createInitialState(),archive=path.join(f.backup,'synthetic-migration');fs.mkdirSync(archive);const txt=Buffer.from('initialZoom=1.4'),target=path.join(archive,'配置.txt');fs.writeFileSync(target,txt);
 const receipt={version:1,archiveDirectory:'/synthetic/prior-root/备份/synthetic-migration',archiveRelativePath:'备份/synthetic-migration',configurationSources:[{kind:'legacy-text',relativePath:'配置.txt',sha256:hash(txt),sizeBytes:txt.length}]};fs.writeFileSync(path.join(f.data,'legacy-migration-receipt-v1.json'),JSON.stringify(receipt));
 const preview=await f.service.prepareRefresh(state);assert.equal(preview.legacySources.some(source=>source.path===target),true);
 fs.writeFileSync(target,'tampered');assert.throws(()=>f.service.commitRefresh(preview,{currentState:state,saveState:saved}),/来源.*已变化/);await assert.rejects(f.create().prepareRefresh(state),/已变化或缺失/);
 fs.writeFileSync(target,txt);const retry=await f.service.prepareRefresh(state),next=f.service.commitRefresh(retry,{currentState:state,saveState:saved});assert.equal(next.appConfig.initialZoom,1.4);assert.deepEqual(fs.readFileSync(target),txt);
});

test('explicit repair of a missing established config rebuilds current cached settings without resurrecting old files',async t=>{
 const f=fixture(t),state=await boot(f),old=await oldBook(state,'合成不应回退');fs.writeFileSync(f.oldBook,old);fs.writeFileSync(f.oldText,'initialZoom=1.9');fs.unlinkSync(f.file);
 await assert.rejects(f.service.prepareRefresh(state),/不会回退/);await assert.rejects(f.service.prepareSave(state,state),/丢失/);
 const preview=await f.service.prepareExport(state),next=f.service.commitExport(preview,{currentState:state,saveState:saved});assert.equal(next.appConfig.initialZoom,1);assert.deepEqual(Rules.list(next),Rules.list(state));assert.deepEqual(fs.readFileSync(f.oldBook),old);assert.equal((await f.create().bootstrap(next,{saveState:()=>assert.fail('read-only restart')})).validated,true);
});

test('legacy source edited at the new workbook replacement boundary rolls new config back without overwriting the edited source',async t=>{
 const f=fixture(t),state=Core.createInitialState(),initial=await W.buildInitialBytes();fs.writeFileSync(f.file,initial);fs.writeFileSync(f.oldText,'initialZoom=1.2');let raced=false,writes=0;
 const io=new Proxy(fs,{get(target,key){if(key==='renameSync')return(from,to)=>{const result=fs.renameSync(from,to);if(to===f.file&&!raced){raced=true;fs.writeFileSync(f.oldText,'initialZoom=1.6');}return result;};return target[key];}});
 const service=f.create({fileSystem:io}),preview=await service.prepareRefresh(state);assert.throws(()=>service.commitRefresh(preview,{currentState:state,saveState:()=>{writes++;return state;}}),/来源.*已变化/);assert.equal(writes,0);assert.deepEqual(fs.readFileSync(f.file),initial);assert.equal(fs.readFileSync(f.oldText,'utf8'),'initialZoom=1.6');assert.equal(fs.existsSync(f.file+'.flower-pending.json'),false);
});

test('established startup validates only the current workbook and receipt without scanning directories or changing files',async t=>{
 const f=fixture(t),state=await boot(f),reads=[];const io=new Proxy(fs,{get(target,key){if(['statSync','readFileSync'].includes(key))return(...args)=>{assert.ok([f.file,f.file+'.flower-pending.json'].includes(args[0]),args[0]);reads.push([key,args[0]]);return target[key](...args);};if(['readdirSync','writeFileSync','renameSync','unlinkSync','mkdirSync'].includes(key))return()=>assert.fail('normal validated startup must stay read-only and bounded');return target[key];}});
 const result=await f.create({fileSystem:io}).bootstrap(state,{saveState:()=>assert.fail('startup cannot save external edits')});assert.equal(result.validated,true);assert.equal(result.state,state);assert.ok(reads.length<=8);
});


test('edited initial template keeps a placeholder panel name but imports a deliberately changed name only through preview',async t=>{
 for(const editedName of [undefined,'合成明确修改的班名']){
  const f=fixture(t),state=Core.createInitialState();state.settings.className='合成现有课堂名称';fs.writeFileSync(f.file,await W.buildInitialBytes());
  await edit(f.file,book=>{book.getWorksheet('启动显示').getCell('B2').value=1.25;if(editedName)book.getWorksheet('面板设置').getCell('B2').value=editedName;});
  const preview=await f.service.prepareRefresh(state);assert.equal(preview.initialBinding,true);const changes=preview.configSummary.flatMap(group=>group.changes);assert.equal(changes.some(change=>change.key==='name'),editedName!==undefined);
  const next=f.service.commitRefresh(preview,{currentState:state,saveState:saved});assert.equal(next.settings.className,editedName||state.settings.className);assert.equal(next.appConfig.initialZoom,1.25);const applied=new ExcelJS.Workbook();await applied.xlsx.readFile(f.file);assert.equal(applied.getWorksheet('启动显示').getCell('B2').value,1.25);assert.equal(applied.getWorksheet('启动显示').getCell('B2').numFmt,'0.###############');
 }
});
