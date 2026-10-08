'use strict';
// Fail-closed evidence and per-copy layout for synthetic feature QA only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
function fixture(prefix){const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix)),data=path.join(root,'数据');fs.mkdirSync(data);return {root,data,env:{FLOWER_HEADLESS_TEST:'1',FLOWER_FOLDER_ROOT:root,FLOWER_EXTERNAL_RESOURCE_DIR:root,FLOWER_DATA_DIR:data}};}
function prepare(directory,names){for(const name of names){const file=path.join(directory,name);if(fs.existsSync(file))fs.renameSync(file,file+'.prior-'+Date.now()+'-'+randomUUID());}}
function capture(run,file,phase){
 let report=null,parseError=null;try{report=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){parseError=error.message;}
 const problems=[];
 if(run.error)problems.push(run.error.code||run.error.message);
 if(run.signal)problems.push('Child terminated by '+run.signal);
 if(run.status!==0)problems.push('Child status was '+String(run.status));
 if(parseError)problems.push('Missing or invalid fresh report: '+parseError);
 if(!report||!Array.isArray(report.checks)||report.checks.length===0)problems.push('Report has zero verified cases');
 else if(report.checks.some(check=>check.status!=='passed'))problems.push('At least one case did not pass');
 if(report?.fatal||report?.completed===false)problems.push('Report did not complete');
 for(const key of ['errors','runtimeErrors'])if(Array.isArray(report?.[key])&&report[key].length)problems.push('Unexpected '+key);
 return {phase,exitCode:problems.length?1:0,status:run.status,signal:run.signal||null,error:run.error?{message:run.error.message,code:run.error.code||null}:null,evidenceErrors:problems,report};
}
function load(entry,app){try{require(entry);return true;}catch(error){console.error('FATAL_FEATURE_STARTUP',error.stack);app.exit(2);return false;}}
module.exports={fixture,prepare,capture,load};
