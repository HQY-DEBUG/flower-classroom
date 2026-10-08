'use strict';
// v2 lives beside the legacy save; an older binary never gets a path to overwrite it.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {saveAtomic}=require('./io.cjs');
const MAX_BYTES=90*1024*1024;
function createStore(directory,{validate,initial}){
  const legacy=path.join(directory,'classroom.json'),modern=path.join(directory,'classroom-v2.json'),marker=path.join(directory,'classroom-v2.enabled');
  let active=legacy,blocked=false,activeVerified=false,lastGoodState=null,preservationPending=false;
  const read=file=>{if(fs.statSync(file).size>100*1024*1024)throw Error('课堂存档超过100MB读取上限');return validate(JSON.parse(fs.readFileSync(file,'utf8')));};
  const preserve=file=>{if(fs.existsSync(file))fs.copyFileSync(file,file+`.damaged-${Date.now()}-${randomUUID()}`);};
  function load(){
    fs.mkdirSync(directory,{recursive:true});
    const upgraded=fs.existsSync(modern)||fs.existsSync(marker)||fs.existsSync(modern+'.previous');
    active=upgraded?modern:legacy;blocked=false;activeVerified=false;lastGoodState=null;preservationPending=false;
    // A legacy recovery file still belongs to a real classroom, even when its
    // primary has gone missing. Only an entirely absent chain is a first run.
    if(!fs.existsSync(active)&&!fs.existsSync(active+'.previous')&&!upgraded){lastGoodState=initial();return {state:lastGoodState,warning:'',readOnly:false};}
    try{lastGoodState=read(active);activeVerified=true;return {state:lastGoodState,warning:'',readOnly:false};}
    catch(error){
      try{preserve(active);}catch{preservationPending=true;blocked=true;}
      try{
        lastGoodState=read(active+'.previous');
        return {state:lastGoodState,warning:preservationPending?'已读取上一次完整存档，但异常原文件的保留副本未能保存。当前只读，请保留数据目录，检查可用空间和权限后恢复备份。':'已从上一次完整存档恢复，原文件已保留。建议立即导出备份。',readOnly:blocked};
      }
      catch{
        blocked=true;
        return {state:initial(),warning:preservationPending?'课堂存档未能读取，异常原文件的保留副本也未能保存。已停止自动保存，请保留数据目录，检查可用空间和权限后恢复备份。':upgraded?'新版课堂存档未能读取，已停止自动保存。旧版本数据没有覆盖新版，请恢复一份完整备份后继续。':'课堂存档无法读取，原文件已保留。当前显示示例班级且已停止自动保存，请恢复一份完整备份后继续。',readOnly:true};
      }
    }
  }
  function save(input,{restore=false}={}){
    if(blocked&&!restore)throw Error('课堂存档需要先恢复备份，当前未保存任何改动');
    const next=validate({...input,version:2});
    const bytes=Buffer.byteLength(JSON.stringify(next),'utf8');
    if(bytes>MAX_BYTES)throw Error('完整课堂数据超过90MB安全上限，请先导出并整理，避免备份无法恢复');
    // Explicit restore must not destroy the only unreadable source when the
    // startup preservation failed. Retry that copy before changing any save.
    if(preservationPending){
      try{preserve(active);preservationPending=false;}catch{throw Error('异常原存档仍无法保留，本次恢复未保存。请检查可用空间和数据目录权限后重试');}
    }
    if(active!==modern){
      // Preserve a validated pre-migration state in the new recovery chain before
      // enabling v2. A failed first rename must not make the next launch lose it.
      if(lastGoodState&&!fs.existsSync(modern)&&!fs.existsSync(modern+'.previous'))saveAtomic(modern+'.previous',validate({...lastGoodState,version:2}));
      // A durable marker prevents a missing/corrupt future v2 file from silently
      // falling back to the stale v1 branch. Only explicit restore may unblock it.
      if(!fs.existsSync(marker)){
        const fd=fs.openSync(marker,'wx',0o600);
        try{fs.writeFileSync(fd,'FlowerClassroom save format 2\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      }
      if(fs.existsSync(legacy)){
        const backup=path.join(directory,`before-v2-migration-${Date.now()}-${randomUUID()}.json`);
        fs.copyFileSync(legacy,backup);
      }
    }
    // Never rotate a corrupt primary over the healthy previous file we just
    // recovered. A failed rename then leaves that verified fallback intact.
    saveAtomic(modern,next,{preservePrevious:active===modern&&!activeVerified});
    active=modern;blocked=false;activeVerified=true;lastGoodState=next;return next;
  }
  return {load,save,get path(){return active;},get blocked(){return blocked;},legacyPath:legacy,modernPath:modern,markerPath:marker};
}
module.exports={createStore,MAX_BYTES};
