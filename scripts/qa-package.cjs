'use strict';
// Verifies that app.asar contains precisely the source bytes covered by final QA.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),asar=require('@electron/asar');
const root=path.resolve(__dirname,'..'),manifest=JSON.parse(fs.readFileSync(path.join(root,'artifacts/qa/tested-source-sha256.json'))),archive=path.resolve(process.argv[2]||path.join(root,'dist/win-unpacked/resources/app.asar'));
const out=path.resolve(process.env.FLOWER_PACKAGE_QA_OUT||path.join(root,'artifacts/qa'));fs.mkdirSync(out,{recursive:true});
const sourceManifest=Object.fromEntries(Object.entries(manifest).map(([name,value])=>[name.startsWith('src/')?name.slice(4):name,value]));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),checks=[];
for(const [name,expected] of Object.entries(sourceManifest)){const local=sha(fs.readFileSync(path.join(root,'src',name))),packaged=sha(asar.extractFile(archive,'src/'+name));assert.equal(local,expected,'Source changed after final QA: '+name);assert.equal(packaged,expected,'Packaged source is not final tested source: '+name);checks.push({name,sha256:expected,matched:true});}
const paths=asar.listPackage(archive);
const actualSources=paths.filter(p=>p.startsWith('/src/')&&!p.endsWith('/')).map(p=>p.slice(5)).sort();
assert.deepEqual(actualSources,Object.keys(sourceManifest).sort(),'Unexpected or missing source files in final ASAR');assert.ok(!paths.some(p=>/\.qa-|classroom\.json|qa-backup|qa-roster|artifacts\/qa/.test(p)),'Test data leaked into package');
const metadata={status:'passed',sourceChecks:checks,testFixturesAbsent:true,asarFile:archive,asarSha256:sha(fs.readFileSync(archive)),note:'Verifies bytes, not Windows execution or code signing'};
fs.writeFileSync(path.join(out,'package-verification.json'),JSON.stringify(metadata,null,2));console.log('PASS_PACKAGE',checks.length,'tested source files match app.asar; no test data included');
