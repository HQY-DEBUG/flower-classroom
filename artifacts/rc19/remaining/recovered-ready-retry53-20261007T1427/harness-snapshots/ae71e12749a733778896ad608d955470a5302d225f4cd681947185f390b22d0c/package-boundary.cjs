'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
module.exports=function install(mainEntry,outFile){
 const marker='.asar'+path.sep;if(!mainEntry.includes(marker)||!process.versions.electron)return;
 const archive=mainEntry.slice(0,mainEntry.indexOf(marker)+5),original=Module._resolveFilename,checked=[],violations=[];
 Module._resolveFilename=function(request,parent,...rest){const resolved=original.call(this,request,parent,...rest);if(parent?.filename?.startsWith(archive+path.sep)&&path.isAbsolute(resolved)){checked.push({request,resolved});if(!resolved.startsWith(archive+path.sep)){violations.push({request,resolved});throw Error('PACKAGED_DEPENDENCY_ESCAPE '+request);}}return resolved;};
 const {app}=require('electron'),exit=app.exit.bind(app);app.exit=function(code){fs.mkdirSync(path.dirname(outFile),{recursive:true});fs.writeFileSync(outFile,JSON.stringify({archive,status:code===0&&!violations.length?'passed':'failed',checked,violations,windowsExecution:false},null,2));return exit(code);};
};
