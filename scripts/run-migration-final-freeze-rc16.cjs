'use strict';
// Evidence wrapper: no runtime edits, six sequential independent suite runs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const repo=path.resolve(__dirname,'..'),root=path.join(repo,'artifacts/rc16-independent-review/migration-final'),envelopeFile=path.join(root,'final-rerun-envelope.json');
const asar=path.join(repo,'dist-rc16-final/win-unpacked/resources/app.asar'),expectedAsarSha256='3b5d3b873b2f645409f3e503f41407b20b99ff2972379c84e77906a738a43587';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex'),quote=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
function files(directory){const result={};function walk(dir){for(const name of fs.readdirSync(dir).sort()){const file=path.join(dir,name),stat=fs.statSync(file);if(stat.isDirectory())walk(file);else result[path.relative(directory,file)]={sha256:hash(fs.readFileSync(file)),bytes:stat.size};}}walk(directory);return result;}
function packageHash(){const stat=fs.statSync(asar);return{path:asar,sha256:hash(fs.readFileSync(asar)),bytes:stat.size,mtime:stat.mtime.toISOString()};}
function snapshot(){return{capturedAt:new Date().toISOString(),src:files(path.join(repo,'src')),asar:packageHash()};}
const startedAt=new Date().toISOString(),runDirectory=path.join(root,'frozen-'+startedAt.replace(/[:.]/g,'-'));
fs.mkdirSync(runDirectory,{recursive:true});
if(fs.existsSync(envelopeFile))throw Error('Final envelope already exists; preserve it and explicitly choose a new wrapper path');
const envelope={schemaVersion:1,domain:'migration',startedAt,repo,runDirectory,expectedAsarSha256,before:snapshot(),suites:[],assertionLeaves:[],syntheticOnly:true,windowsExecuted:false,powerLossSimulated:false,legacyMalformedJournal:'Preserved with RECOVERY_REQUIRED; explicit fresh-folder remigration separately verified. Not automatic recovery.'};
function persist(){fs.writeFileSync(envelopeFile,JSON.stringify(envelope,null,2)+'\n');}
persist();
if(envelope.before.asar.sha256!==expectedAsarSha256)throw Error('Final ASAR does not match assigned freeze');
const suites=[
 {suite:'migration-combinations',script:'scripts/qa-migration-durability-review-rc16.cjs',outVar:'FLOWER_MIGRATION_DURABILITY_OUT'},
 {suite:'migration-setup-and-legacy-compatibility',script:'scripts/qa-migration-supplement-review-rc16.cjs',outVar:'FLOWER_MIGRATION_SUPPLEMENT_OUT'},
 {suite:'migration-full-main-startup',script:'scripts/qa-migration-startup-review-rc16.cjs',outVar:'FLOWER_MIGRATION_STARTUP_OUT'}
];
for(const mode of ['source','packaged'])for(const suite of suites){
 const output=path.join(runDirectory,mode,suite.suite);fs.mkdirSync(output,{recursive:true});
 const script=path.join(repo,suite.script),entry=mode==='source'?path.join(repo,'src/main.cjs'):path.join(asar,'src/main.cjs'),log=path.join(output,'suite-execution.log'),env={FLOWER_PACKAGE_MAIN:entry,[suite.outVar]:output};
 const row={suite:suite.suite,mode,domain:'migration',startedAt:new Date().toISOString(),completedAt:null,exitCode:null,command:Object.entries(env).map(([k,v])=>k+'='+quote(v)).join(' ')+' '+quote(process.execPath)+' '+quote(suite.script),log,evidenceFiles:[],script,scriptSha256:hash(fs.readFileSync(script)),env};
 envelope.suites.push(row);persist();
 const result=cp.spawnSync(process.execPath,[script],{cwd:repo,env:{...process.env,...env},encoding:'utf8',timeout:240000,maxBuffer:16*1024*1024});
 row.completedAt=new Date().toISOString();row.exitCode=result.status;row.signal=result.signal||null;if(result.error)row.executionError=String(result.error);
 fs.writeFileSync(log,(result.stdout||'')+(result.stderr||''));
 const resultFile=path.join(output,'results.json');
 if(fs.existsSync(resultFile)){
   row.evidenceFiles.push(resultFile);const data=JSON.parse(fs.readFileSync(resultFile));
   if(Array.isArray(data.checks))for(const check of data.checks)envelope.assertionLeaves.push({suite:row.suite,mode,domain:'migration',name:check.name,status:check.status,passed:check.status==='passed',evidenceFile:resultFile,...(check.error?{error:check.error}:{}),...(check.details?{details:check.details}:{})});
   else if(Array.isArray(data.results))for(const check of data.results)envelope.assertionLeaves.push({suite:row.suite,mode,domain:'migration',name:'Full main opens expected classroom after actual RC15 '+check.name+' recovery',status:check.exitCode===0&&check.originalEvidenceUnchanged&&check.result?.status==='passed'?'passed':'failed',passed:check.exitCode===0&&check.originalEvidenceUnchanged&&check.result?.status==='passed',evidenceFile:resultFile,details:check});
   for(const name of fs.readdirSync(output).sort())if(name.endsWith('.json')&&name!=='results.json')row.evidenceFiles.push(path.join(output,name));
 }
 row.scriptSha256After=hash(fs.readFileSync(script));row.after=snapshot();row.runtimeUnchanged=JSON.stringify(row.after.src)===JSON.stringify(envelope.before.src)&&row.after.asar.sha256===envelope.before.asar.sha256;persist();
 console.log(row.mode,row.suite,'exit',row.exitCode,'runtimeUnchanged',row.runtimeUnchanged);
 if(!row.runtimeUnchanged){envelope.interrupted='Runtime source or ASAR changed during frozen verification; further execution stopped';break;}
}
envelope.after=snapshot();envelope.completedAt=new Date().toISOString();envelope.verification={sourceUnchanged:JSON.stringify(envelope.before.src)===JSON.stringify(envelope.after.src),asarUnchanged:envelope.before.asar.sha256===envelope.after.asar.sha256,scriptHashesUnchanged:envelope.suites.every(x=>x.scriptSha256===x.scriptSha256After),suiteRows:envelope.suites.length,passed:envelope.assertionLeaves.filter(x=>x.passed).length,failed:envelope.assertionLeaves.filter(x=>!x.passed).length,allExitCodesZero:envelope.suites.every(x=>x.exitCode===0)};persist();console.log('FINAL_MIGRATION_ENVELOPE',envelopeFile,JSON.stringify(envelope.verification));process.exitCode=envelope.verification.failed||!envelope.verification.allExitCodesZero||!envelope.verification.sourceUnchanged||!envelope.verification.asarUnchanged||envelope.suites.length!==6?1:0;
