'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=process.cwd(),qa=require(path.join(root,'scripts/qa-feature-child.cjs')),plans=require(path.join(root,'scripts/qa-extension-cases.json')),dir=qa.fixture('flower-extension-checker-').root;
const results=[];
for(const [suite,phases] of Object.entries(plans))for(const [phase,expectedCaseNames]of Object.entries(phases)){
 const target=path.join(dir,suite+'-'+phase+'.json'),options={expectedCaseNames,requireCompleted:true};
 const report={completed:true,checks:expectedCaseNames.map(name=>({name,status:'passed'}))};fs.writeFileSync(target,JSON.stringify(report));
 assert.equal(qa.capture({status:0},target,phase,options).exitCode,0);
 for(const [name,run,doc] of [
  ['missing-case',{status:0},{...report,checks:report.checks.slice(1)}],
  ['duplicate-case',{status:0},{...report,checks:[...report.checks,report.checks[0]]}],
  ['missing-completion',{status:0},{checks:report.checks}],
  ['incomplete',{status:0},{...report,completed:false}],
  ['timeout-status-zero',{status:0,error:{code:'ETIMEDOUT',message:'synthetic timeout'}},report],
  ['signal-status-zero',{status:0,signal:'SIGTERM'},report],
  ['null-status',{status:null},report],
  ['zero-cases',{status:0},{completed:true,checks:[]}],
  ['missing-report',{status:0},null]
 ]){if(doc)fs.writeFileSync(target,JSON.stringify(doc));else fs.rmSync(target,{force:true});assert.equal(qa.capture(run,target,phase,options).exitCode,1,suite+' '+phase+' '+name);}
 results.push({suite,phase,requiredCases:expectedCaseNames.length,validReportAccepted:true,negativeContractsRejected:9});
}
const freeze=JSON.parse(fs.readFileSync('artifacts/rc18/frozen-source.json')),sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');assert.ok(Object.entries(freeze.files).every(([file,hash])=>sha(file)===hash));
fs.writeFileSync(path.join(__dirname,'checker-results.json'),JSON.stringify({syntheticOnly:true,electronProcessesLaunched:0,results,runtimeMatchesFreeze:true,asarSha256:sha('dist-rc18-final/win-unpacked/resources/app.asar')},null,2));console.log(JSON.stringify({phasesChecked:results.length,negativeContractsRejected:results.length*9,electronProcessesLaunched:0,runtimeMatchesFreeze:true}));
