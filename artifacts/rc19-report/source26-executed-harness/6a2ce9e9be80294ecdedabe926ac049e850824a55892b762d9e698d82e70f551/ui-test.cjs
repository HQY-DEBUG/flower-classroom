'use strict';
const {spawnSync}=require('node:child_process');const fs=require('node:fs');const path=require('node:path');
const root=path.resolve(__dirname,'..');const electron=require('electron');
const args=process.platform==='linux'?['--no-sandbox','--ozone-platform=headless','--disable-gpu']:[];
// Test-only fixtures; production user data is never read or removed.
for(const name of ['.qa-electron','.qa-network','.qa-recovery-restart','.qa-recovery-fallback','.qa-recovery-both-corrupt','.qa-recovery-write-error'])fs.rmSync(path.join(root,name),{recursive:true,force:true});
fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
let failed=false;
for(const [script,...extra] of [['qa-electron.cjs'],['qa-recovery.cjs','restart'],['qa-recovery.cjs','fallback'],['qa-recovery.cjs','both-corrupt'],['qa-recovery.cjs','write-error'],['qa-network.cjs']]){
 const result=spawnSync(electron,[...args,path.join(__dirname,script),...extra],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});
 const log=(result.stdout||'')+(result.stderr||'');fs.writeFileSync(path.join(root,'artifacts',`test-${script.replace('.cjs','')}${extra.length?'-'+extra.join('-'):''}.log`),log);
 console.log(log.split('\n').filter(line=>/^(PASS|FAIL|QA_|RESULT)/.test(line)).join('\n'));
 if(result.status!==0 || result.error){failed=true;console.error(script,extra.join(' '),'failed',result.error?.message||`exit ${result.status}`);}
}
process.exitCode=failed?1:0;
