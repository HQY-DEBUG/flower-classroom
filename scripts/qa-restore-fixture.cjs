'use strict';
// Synthetic QA inputs follow the same reviewed JSON restore transaction as teachers.
// This helper never repairs/rebuilds the workbook after a restore.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const clone=value=>structuredClone(value);
const mirroredSettings=['scoreRules','showAvatars','scoreStep','studentSort','hideLateForms','timerSound','toolDefaults','wheelPrizes','challengeOptions'];
function classroomPayload(state,original,root=true){
 const value=clone(state);delete value.version;
 if(root){delete value.revision;delete value.sharedScoreRules;delete value.appConfig;}
 for(const key of mirroredSettings)if(!Object.hasOwn(original.settings,key))delete value.settings[key];
 if(value.panels)value.panels.others=value.panels.others.map(panel=>({...panel,data:classroomPayload(panel.data,original.panels.others.find(p=>p.id===panel.id).data,false)}));
 return value;
}
function assertRestoredState(actual,incoming,previous,{configuration,rules}){
 // Preserve every original classroom field, including photos, ledger/history,
 // running tool state, inactive panel revision, and saved settings.
 assert.deepEqual(classroomPayload(actual,incoming),classroomPayload(incoming,incoming),'Restore must retain all original classroom fields');
 assert.equal(actual.version,2);assert.equal(actual.revision,previous.revision+1);
 const expectedConfiguration=configuration.snapshot({...incoming,appConfig:incoming.appConfig??previous.appConfig});
 assert.deepEqual(configuration.snapshot(actual),expectedConfiguration,'Restore must retain every effective configuration value');
 if(incoming.sharedScoreRules)assert.deepEqual(actual.sharedScoreRules,incoming.sharedScoreRules,'Existing shared rule metadata must survive restore');
 else{
  const expected=rules.previewShared(incoming);assert.equal(expected.required,false,'General classroom fixtures must not silently merge conflicting old cards');
  assert.deepEqual(actual.sharedScoreRules,{version:1,revision:0,rules:expected.rules,migration:{panels:expected.panels,mappings:expected.mappings}},'Legacy restore must explicitly establish the shared catalog and retain its source metadata');
 }
 for(const panel of [actual,...(actual.panels?.others||[]).map(p=>p.data)]){assert.equal(panel.version,2,'Every restored panel uses version 2');for(const key of mirroredSettings)assert.ok(Object.hasOwn(panel.settings,key),'Restored panel must materialize '+key);assert.deepEqual(panel.settings.scoreRules,actual.sharedScoreRules.rules,'Every panel mirrors the root catalog');}
}
async function verifyRestoredWorkbook(state,file,workbook,configuration){
 const info=await file({command:'folder-info'});assert.equal(path.basename(info.configuration),'配置.xlsx');const bytes=fs.readFileSync(info.configuration),panels=await workbook.parseBytes(bytes,state);
 assert.deepEqual(panels,workbook.configuration(state),'Restored workbook cards and progression must match restored JSON');
 assert.deepEqual(panels.configSnapshot,configuration.snapshot(state),'Every restored workbook parameter must match restored JSON');
 return {verified:true,path:info.configuration,sha256:createHash('sha256').update(bytes).digest('hex'),panelCount:panels.length};
}
async function restoreFixture({incoming,fixturePath,file,readContext,withOpenPath,configuration,rules,workbook,evidence=[]}){
 const before=await readContext(),fixtureBytes=Buffer.from(JSON.stringify(incoming));fs.writeFileSync(fixturePath,fixtureBytes);
 const preview=await withOpenPath(fixturePath,()=>file({command:'restore-preview',withRevision:true}));
 assert.equal(typeof preview.restoreToken,'string','Reviewed restore must supply a transaction token');assert.ok(preview.restoreToken.length>0);
 assert.ok(preview.restoreConfiguration,'Reviewed restore must describe the configuration transaction');
 assert.equal(preview.expectedRevision,before.state.revision);
 assert.deepEqual(fs.readFileSync(fixturePath),fixtureBytes,'Restore preview must not modify its selected JSON');
 const afterPreview=await readContext();assert.deepEqual(afterPreview.state,before.state,'Restore preview is read-only');assert.equal(afterPreview.restoreGeneration,before.restoreGeneration);
 await file({command:'restore-apply',state:preview,expectedRevision:preview.expectedRevision,restoreToken:preview.restoreToken});
 assert.deepEqual(fs.readFileSync(fixturePath),fixtureBytes,'Restore apply must not modify its selected JSON');
 const after=await readContext();assert.equal(after.restoreGeneration,before.restoreGeneration+1,'Restore advances its epoch exactly once');
 assertRestoredState(after.state,incoming,before.state,{configuration,rules});
 const workbookEvidence=await verifyRestoredWorkbook(after.state,file,workbook,configuration);assert.equal(workbookEvidence.verified,true);
 evidence.push({fixturePath,reviewed:true,restoreTokenReturned:true,configurationPreview:preview.restoreConfiguration,revisionBefore:before.state.revision,revisionAfter:after.state.revision,epochBefore:before.restoreGeneration,epochAfter:after.restoreGeneration,originalClassroomFieldsPreserved:true,effectiveConfigurationPreserved:true,noPostRestoreRebuild:true,workbook:workbookEvidence});
 return after.state;
}
module.exports={assertRestoredState,restoreFixture,verifyRestoredWorkbook};
