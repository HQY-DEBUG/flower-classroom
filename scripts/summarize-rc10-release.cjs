'use strict';
// RC10's authoritative post-recovery summary uses only fresh, hash-bound runs.
const {spawnSync}=require('node:child_process'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const result=spawnSync('python',[path.join(__dirname,'finalize-rc10-recovery.py')],{cwd:root,stdio:'inherit'});
process.exitCode=result.status??1;
