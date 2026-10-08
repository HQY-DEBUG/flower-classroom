'use strict';
// Attests the complete source manifest around a real existing integration command.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,process.env.FLOWER_FREEZE_DIR||'artifacts/rc4'),kind=process.argv[2];
const choices={petextra:{entry:'scripts/qa-pet-extra.cjs',raw:'artifacts/qa-pet-extra/results.json',electron:true},care:{entry:'scripts/qa-pet-care.cjs',raw:'artifacts/qa-pet-care/results.json',electron:true},lock:{entry:'tests/classroom-lock-fixture.cjs',raw:'artifacts/qa-classroom-lock/results.json',electron:false}};
assert(Object.hasOwn(choices,kind),'Choose care, lock or petextra');const task=choices[kind],sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest=()=>Object.fromEntries(fs.readdirSync(path.join(root,'src')).sort().map(n=>[n,sha(fs.readFileSync(path.join(root,'src',n)))]));
const frozen=JSON.parse(fs.readFileSync(path.join(out,'frozen-source.json'))),expected=Object.fromEntries(Object.entries(frozen.files).map(([k,v])=>[k.replace(/^src\//,''),v]));
const before=manifest();assert.deepEqual(before,expected,'Working source differs from frozen manifest');
const r=spawnSync(task.electron?require('electron'):process.execPath,[...(task.electron?['--no-sandbox','--ozone-platform=headless','--disable-gpu']:[]),path.join(root,task.entry)],{cwd:root,env:{...process.env,ELECTRON_CACHE:'/tmp/flower-electron-cache',XDG_CACHE_HOME:'/tmp/flower-cache'},encoding:'utf8'});
fs.writeFileSync(path.join(out,'frozen-'+kind+'.log'),r.stdout+r.stderr);const after=manifest(),raw=fs.readFileSync(path.join(root,task.raw),'utf8'),report=JSON.parse(raw);
const envelope={createdAt:new Date().toISOString(),candidateVersion:frozen.candidateVersion,syntheticOnly:true,sourceAtStart:before,sourceAtFinish:after,sourceChanged:JSON.stringify(before)!==JSON.stringify(after),rawArtifact:task.raw,rawSha256:sha(raw),results:[{phase:kind,exitCode:r.status,report:{checks:report.checks}}]};
fs.writeFileSync(path.join(out,'frozen-'+kind+'-results.json'),JSON.stringify(envelope,null,2));console.log(kind,r.status,report.checks.filter(c=>c.status==='passed').length,'passed',report.checks.filter(c=>c.status!=='passed').length,'not passed');assert.deepEqual(after,expected,'Source changed during execution');process.exitCode=r.status||0;
