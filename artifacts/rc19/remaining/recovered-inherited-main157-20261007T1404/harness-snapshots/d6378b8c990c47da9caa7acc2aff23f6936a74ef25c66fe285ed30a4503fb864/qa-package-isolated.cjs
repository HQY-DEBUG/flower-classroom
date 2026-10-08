'use strict';
// Run an unchanged integration suite against an isolated ASAR with a strict dependency boundary.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const main=process.env.FLOWER_PACKAGE_MAIN;if(!main||!main.includes('.asar/'))throw Error('FLOWER_PACKAGE_MAIN must target an isolated ASAR');
const asar=main.slice(0,main.indexOf('.asar/')+5),resolve=Module._resolveFilename,seen=new Set();
Module._resolveFilename=function(request,parent,...rest){const resolved=resolve.call(this,request,parent,...rest);if(parent?.filename?.startsWith(asar+'/')&&path.isAbsolute(resolved)){if(!resolved.startsWith(asar+'/'))throw Error('PACKAGED_DEPENDENCY_ESCAPE '+request+' -> '+resolved);seen.add(resolved.slice(asar.length+1));}return resolved;};
const suite=process.env.FLOWER_QA_SUITE||process.argv.find(a=>['qa-electron.cjs','qa-pets.cjs'].includes(a));if(!['qa-electron.cjs','qa-pets.cjs'].includes(suite))throw Error('Select the existing qa-electron.cjs or qa-pets.cjs suite');
// The normal ui-test runner resets this synthetic directory before qa-electron.
// Direct packaged runs need the identical clean-fixture contract.
if(suite==='qa-electron.cjs')fs.rmSync(path.join(__dirname,'../.qa-electron-packaged'),{recursive:true,force:true});
const {app}=require('electron');const originalExit=app.exit.bind(app);app.exit=code=>{const out=path.join(__dirname,'../artifacts/qa-packaged');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'dependency-boundary-'+suite.replace('.cjs','')+'.json'),JSON.stringify({status:code===0?'passed':'failed',isolatedArchive:asar,packageDependenciesStayedInsideArchive:true,checkedResolvedFiles:[...seen].sort(),suite},null,2));return originalExit(code);};
require('./'+suite);
