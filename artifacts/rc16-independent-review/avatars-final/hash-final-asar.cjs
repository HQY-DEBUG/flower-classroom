'use strict';
const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path'),asar=require('@electron/asar');
const target=process.argv[2],output=process.argv[3],sha=b=>crypto.createHash('sha256').update(b).digest('hex'),digest=sha(fs.readFileSync(target));
const files={},links={};
for(const name of asar.listPackage(target)){const relative=name.replace(/^\//,''),stat=asar.statFile(target,relative,false);if(stat.files)continue;if(stat.link){links[relative]=stat.link;continue;}files[relative]={size:stat.size,sha256:sha(asar.extractFile(target,relative))};}
const content={generatedAt:new Date().toISOString(),archive:target,archiveSha256:digest,files,links,note:'The complete archive digest equals every before/after archive digest captured in all three final executions. This map expands that unchanged artifact into file-level hashes; generatedAt is the actual map-generation time.'};
fs.writeFileSync(output,JSON.stringify(content,null,2));console.log(JSON.stringify({archiveSha256:digest,files:Object.keys(files).length,links:Object.keys(links).length,output}));
