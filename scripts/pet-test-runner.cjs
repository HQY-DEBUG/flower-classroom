'use strict';
const {spawnSync}=require('node:child_process');const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),electron=require('electron');
const args=process.platform==='linux'?['--no-sandbox','--ozone-platform=headless','--disable-gpu']:[];
const result=spawnSync(electron,[...args,path.join(__dirname,'qa-pets.cjs')],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:32*1024*1024});
const log=(result.stdout||'')+(result.stderr||'');const out=process.env.FLOWER_PETS_OUT?path.resolve(process.env.FLOWER_PETS_OUT):path.join(root,'artifacts/qa-pets');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'qa-pets-runner.log'),log);
console.log(log.split('\n').filter(line=>/^(PASS|FAIL|QA_|RESULT)/.test(line)).join('\n'));if(result.error)console.error(result.error.message);process.exitCode=result.status===0&&!result.error?0:1;
