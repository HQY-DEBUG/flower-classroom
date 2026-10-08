'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash,randomUUID}=require('node:crypto');
const NAMES=Object.freeze(['classroom.json','classroom.json.previous','classroom-v2.json','classroom-v2.json.previous','classroom-v2.enabled']);
const MAX_BYTES=100*1024*1024,sha=bytes=>createHash('sha256').update(bytes).digest('hex'),validHash=value=>value===null||/^[a-f0-9]{64}$/.test(value);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const stateHash=state=>sha(JSON.stringify(canonical(state)));
function read(file,disk=fs){let stat;try{stat=disk.statSync(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}if(!stat.isFile()||stat.size>MAX_BYTES)throw Error('恢复链文件类型或大小无效：'+path.basename(file));const bytes=disk.readFileSync(file);if(bytes.length>MAX_BYTES)throw Error('恢复链文件超过读取上限');return bytes;}
const hashAt=(file,disk)=>{const bytes=read(file,disk);return bytes===null?null:sha(bytes);};
function capture(dataDirectory,current,next,disk=fs){
 const bytes=NAMES.map(name=>read(path.join(dataDirectory,name),disk)),modern=bytes[2]!==null||bytes[3]!==null||bytes[4]!==null,token=randomUUID();
 const priorState=require('./core.cjs').validateState({...current,version:2}),nextHash=sha(JSON.stringify(next)),priorNormalized=sha(JSON.stringify(priorState)),markerHash=sha('FlowerClassroom save format 2\n');
 return {metadata:{version:1,primaryName:modern?NAMES[2]:NAMES[0],files:NAMES.map((name,index)=>{const beforeHash=bytes[index]===null?null:sha(bytes[index]);const allowedHashes=[beforeHash];if(name===NAMES[2])allowedHashes.push(nextHash);if(name===NAMES[3]){allowedHashes.push(priorNormalized);if(bytes[2]!==null)allowedHashes.push(sha(bytes[2]));}if(name===NAMES[4])allowedHashes.push(markerHash);return {name,beforeHash,backupName:bytes[index]===null?null:`before-restore-chain-${token}-${name}`,allowedHashes:[...new Set(allowedHashes)]};})},bytes,beforeUpgradedHash:stateHash(priorState)};
}
function validate(value){if(!value||value.version!==1||!NAMES.includes(value.primaryName)||!Array.isArray(value.files)||value.files.length!==NAMES.length)throw Error('课堂恢复链凭据无效');
 const seen=new Set();for(const item of value.files){if(!item||!NAMES.includes(item.name)||seen.has(item.name)||!validHash(item.beforeHash)||!Array.isArray(item.allowedHashes)||item.allowedHashes.length>4||!item.allowedHashes.every(validHash)||!item.allowedHashes.includes(item.beforeHash))throw Error('课堂恢复链文件凭据无效');seen.add(item.name);if(item.beforeHash===null?item.backupName!==null:typeof item.backupName!=='string'||path.basename(item.backupName)!==item.backupName||!new RegExp('^before-restore-chain-[a-f0-9-]{36}-'+item.name.replaceAll('.','\\.')+'$').test(item.backupName))throw Error('课堂恢复链备份位置无效');}return value;
}
function assertBefore(metadata,dataDirectory,disk=fs){validate(metadata);for(const item of metadata.files)if(hashAt(path.join(dataDirectory,item.name),disk)!==item.beforeHash)throw Error('课堂恢复链已在预览后变化，请重新选择备份');}
function backup(captured,dataDirectory,backupDirectory,disk=fs,beforeCommit=()=>{}){
 assertBefore(captured.metadata,dataDirectory,disk);
 for(let index=0;index<captured.metadata.files.length;index++){const item=captured.metadata.files[index],bytes=captured.bytes[index];if(bytes===null)continue;beforeCommit();assertBefore(captured.metadata,dataDirectory,disk);const fd=disk.openSync(path.join(backupDirectory,item.backupName),'wx',0o600);try{disk.writeFileSync(fd,bytes);disk.fsyncSync(fd);}finally{disk.closeSync(fd);}}
}
function restore(metadata,dataDirectory,backupDirectory,disk=fs){validate(metadata);const entries=metadata.files.map(item=>{const prior=item.backupName===null?null:read(path.join(backupDirectory,item.backupName),disk);if((prior===null?null:sha(prior))!==item.beforeHash)throw Error('课堂恢复链备份缺失或已变化，现有文件已保留');const target=path.join(dataDirectory,item.name),actual=hashAt(target,disk);if(!item.allowedHashes.includes(actual))throw Error('课堂恢复链存在后续外部修改，已保留全部备份，请重新核对');return {...item,prior,target,actual};});
 for(const item of entries){if(item.actual===item.beforeHash)continue;const check=()=>{if(hashAt(item.target,disk)!==item.actual)throw Error('课堂恢复链在回滚时变化，已保留备份');};if(item.prior===null){check();disk.unlinkSync(item.target);continue;}const temp=item.target+'.restore-'+randomUUID()+'.tmp';let created=false;try{const fd=disk.openSync(temp,'wx',0o600);created=true;try{disk.writeFileSync(fd,item.prior);disk.fsyncSync(fd);}finally{disk.closeSync(fd);}check();disk.renameSync(temp,item.target);created=false;}finally{if(created)try{disk.unlinkSync(temp);}catch{}}}
 assertBefore(metadata,dataDirectory,disk);
}
function primaryBefore(metadata,dataDirectory,disk=fs){validate(metadata);const item=metadata.files.find(item=>item.name===metadata.primaryName);return hashAt(path.join(dataDirectory,item.name),disk)===item.beforeHash;}
module.exports={NAMES,stateHash,capture,validate,assertBefore,backup,restore,primaryBefore};
