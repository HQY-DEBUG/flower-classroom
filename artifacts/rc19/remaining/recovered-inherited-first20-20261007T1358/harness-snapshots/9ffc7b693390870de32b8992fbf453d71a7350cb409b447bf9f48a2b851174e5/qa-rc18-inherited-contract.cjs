'use strict';
// Synthetic inherited QA contract: explicit configuration initialization and
// native JSON preview. No runtime repair or post-restore workbook rebuild.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function bootstrapExpected(original,src){
 const Core=require(path.join(src,'core.cjs')),Rules=require(path.join(src,'score-rules.js')),Config=require(path.join(src,'configuration-model.js'));
 const expected=structuredClone(original);
 // Only the approved migration metadata/effective defaults are materialized.
 // Comparing the entire result still checks all students, history, ledgers,
 // modes, revisions, inactive panels and explicitly saved settings.
 Rules.promoteShared(expected);Config.apply(expected,Config.snapshot(original));
 return Core.validateState(expected);
}
function snapshotBackups(directory){
 const result={};
 function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(dir,entry.name);if(entry.isDirectory())visit(file);else if(entry.isFile())result[path.relative(directory,file)]=sha(fs.readFileSync(file));}}
 if(fs.existsSync(directory))visit(directory);
 return result;
}
async function reviewRestore({incoming,file,readContext,dialog,directory}){
 const before=await readContext(),locations=await file({command:'folder-info'}),workbook=fs.readFileSync(locations.configuration),backups=snapshotBackups(locations.backup);
 const chosen=path.join(directory,'reviewed-restore-'+randomUUID()+'.json'),bytes=Buffer.from(JSON.stringify(incoming));fs.writeFileSync(chosen,bytes);
 const original=dialog.showOpenDialog;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[chosen]});
 let preview;try{preview=await file({command:'restore-preview',withRevision:true});}finally{dialog.showOpenDialog=original;}
 assert.equal(typeof preview.restoreToken,'string');assert.ok(preview.restoreToken.length);assert.ok(preview.restoreConfiguration);assert.equal(preview.expectedRevision,before.state.revision);
 assert.deepEqual(fs.readFileSync(chosen),bytes);assert.deepEqual(fs.readFileSync(locations.configuration),workbook);assert.deepEqual(snapshotBackups(locations.backup),backups);
 const after=await readContext();assert.deepEqual(after.state,before.state);assert.equal(after.restoreGeneration,before.restoreGeneration);assert.equal(fs.existsSync(preview.restoreConfiguration.stateBackupPath),false);
 return {command:'restore-apply',state:preview,restoreToken:preview.restoreToken,expectedRevision:preview.expectedRevision,expectedRestoreGeneration:before.restoreGeneration};
}
module.exports={bootstrapExpected,snapshotBackups,reviewRestore};
