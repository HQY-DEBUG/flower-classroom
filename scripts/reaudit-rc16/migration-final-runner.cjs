'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const repo=path.resolve(__dirname,'../..'),entry=process.env.FLOWER_PACKAGE_MAIN;
if(!entry||!entry.includes('.asar/'))throw Error('Final migration review requires explicit FLOWER_PACKAGE_MAIN pointing inside the delivered ASAR');
const out=path.resolve(process.env.FLOWER_MIGRATION_FINAL_OUT||path.join(repo,'artifacts/reaudit-rc16/migration/final-packaged'));
if(fs.existsSync(out))throw Error('Use a new final output folder to preserve earlier evidence: '+out);
fs.mkdirSync(out,{recursive:true});const startedAt=new Date().toISOString(),asar=entry.slice(0,entry.indexOf('.asar')+5),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),asarBefore=sha(fs.readFileSync(asar));
const runs=[
 {name:'interactions',script:'migration-interactions.cjs',env:{FLOWER_MIGRATION_INTERACTIONS_OUT:path.join(out,'interactions')},result:'interactions/results.json'},
 {name:'snapshot',script:'migration-snapshot-cases.cjs',env:{FLOWER_MIGRATION_SNAPSHOT_OUT:path.join(out,'snapshot')},result:'snapshot/results.json'},
 {name:'authentic-journals',script:'migration-journal-compatibility.cjs',env:{FLOWER_MIGRATION_COMPAT_OUT:path.join(out,'authentic-journals')},result:'authentic-journals/results.json'},
 {name:'main-preview',script:'migration-preview-main.cjs',env:{FLOWER_MIGRATION_MAIN_OUT:path.join(out,'main'),FLOWER_MIGRATION_EXPECT_COHERENT:'1',FLOWER_MIGRATION_MAIN_PHASE:'preview'},result:'main/preview-result.json'},
 {name:'main-restart',script:'migration-preview-main.cjs',env:{FLOWER_MIGRATION_MAIN_OUT:path.join(out,'main'),FLOWER_MIGRATION_EXPECT_COHERENT:'1',FLOWER_MIGRATION_MAIN_PHASE:'restart'},result:'main/restart-result.json'},
],results=[];
for(const run of runs){
 const beganAt=new Date().toISOString(),result=cp.spawnSync(require('electron'),['--no-sandbox','--ozone-platform=headless','--disable-gpu',path.join(__dirname,run.script)],{cwd:repo,encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,env:{...process.env,...run.env,TMPDIR:'/tmp/flower-classroom-workspace/flower-rc17-temp'}});
 fs.writeFileSync(path.join(out,run.name+'.log'),(result.stdout||'')+(result.stderr||''));const file=path.join(out,run.result),detail=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
 const value={name:run.name,beganAt,finishedAt:new Date().toISOString(),exitCode:result.status,error:result.error?String(result.error):null,resultFile:file,checks:detail?.checks||[],moduleSha256:detail?.moduleSha256||detail?.moduleHashes?.['legacy-migration.cjs']||null};results.push(value);console.log(run.name,'exit',result.status,'checks',value.checks.length);fs.writeFileSync(path.join(out,'results.partial.json'),JSON.stringify({startedAt,entry,asarSha256:asarBefore,results},null,2));
}
const asarAfter=sha(fs.readFileSync(asar)),checks=results.flatMap(x=>x.checks),report={startedAt,finishedAt:new Date().toISOString(),entry,asarSha256:asarBefore,asarUnchanged:asarBefore===asarAfter,results,passed:checks.filter(x=>x.status==='passed').length,failed:checks.filter(x=>x.status!=='passed').length,executionFailures:results.filter(x=>x.exitCode!==0).length,syntheticOnly:true,windowsExecuted:false};
fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));process.exitCode=report.failed||report.executionFailures||!report.asarUnchanged?1:0;
