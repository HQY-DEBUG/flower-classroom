const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {createInitialState,validateState,applyAction,importRows,remainingMs}=require('../src/core.cjs');
const {saveAtomic,parseWorkbook}=require('../src/io.cjs');
const file=process.env.FLOWER_PREVIEW_DATA || path.join(__dirname,'../.preview/classroom.json');
let state=fs.existsSync(file)?validateState(JSON.parse(fs.readFileSync(file,'utf8'))):createInitialState(),restoreGeneration=0;
const clients=new Set();
function commit(next,change={type:'data'}){saveAtomic(file,next);state=next;if(change.restored===true)restoreGeneration++;change={...change,restoreGeneration};for(const res of clients)res.write(`data: ${JSON.stringify({state,change})}\n\n`);return state;}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;}
  if(url.pathname.startsWith('/api/')){
   if(req.headers.origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.origin))throw new Error('仅允许本机预览请求');
   let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>100*1024*1024)throw new Error('请求数据过大');chunks.push(chunk);}
   const body=size?JSON.parse(Buffer.concat(chunks).toString()):{};
   if(['/api/action','/api/restore','/api/archive','/api/blank','/api/import-apply'].includes(url.pathname)&&Object.hasOwn(body,'expectedRestoreGeneration')&&body.expectedRestoreGeneration!==restoreGeneration)throw new Error('备份已恢复，原操作已过期。请核对当前资料后重新操作');
   const destructive=['/api/restore','/api/archive','/api/blank'].includes(url.pathname)||(url.pathname==='/api/import-apply'&&body.mode==='replace');
   if(destructive&&body.expectedRevision!==undefined&&body.expectedRevision!==state.revision)throw new Error('课堂资料在确认期间已变化，请取消后重新查看并确认');
   let result;
   if(url.pathname==='/api/state')result={state,restoreGeneration,desktop:false,version:require('../package.json').version};
   else if(url.pathname==='/api/action')result=commit(applyAction(state,body),{type:body.type});
   else if(url.pathname==='/api/validate'){const incoming=validateState(body.state);result=body.withRevision===true?{...incoming,expectedRevision:state.revision}:incoming;}
   else if(url.pathname==='/api/restore')result=commit({...validateState(body.state),revision:state.revision+1},{type:'data',restored:true});
   else if(url.pathname==='/api/archive'){fs.writeFileSync(file+`.archive-${Date.now()}.json`,JSON.stringify(state));result=commit({...state,logs:[],revision:state.revision+1});}
   else if(url.pathname==='/api/blank'){const next=createInitialState();next.students=[];next.settings.className='我的班级';next.settings.petStep=5;next.revision=state.revision+1;if(state.panels)next.panels=state.panels;result=commit(next);}
   else if(url.pathname==='/api/import-apply')result=commit(importRows(body.rows,state,body.mode||'append'));
   else if(url.pathname==='/api/import'){const rows=await parseWorkbook(Buffer.from(body.base64,'base64'),body.name);const next=importRows(rows,state,body.mode||'append');const added=body.mode==='replace'?next.students:next.students.slice(state.students.length);result={rows,count:added.length,names:added.map(s=>s.name),expectedRevision:state.revision};}
   else{res.writeHead(404);res.end('{}');return;}
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;
  }
  const allowed={'/folder-ui.js':'folder-ui.js','/folder-ui.css':'folder-ui.css','/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/render-focus.js':'render-focus.js','/pet-art.js':'pet-art.js','/panel-tools.js':'panel-tools.js','/panel-tools.css':'panel-tools.css','/timer-tools.js':'timer-tools.js','/timer-tools.css':'timer-tools.css','/draw-tools.js':'draw-tools.js','/draw-tools.css':'draw-tools.css','/pet-score-progression.js':'pet-score-progression.js','/pet-progress.js':'pet-progress.js','/pet-care.css':'pet-care.css','/score-rules.js':'score-rules.js','/configuration-model.js':'configuration-model.js','/score-rules-ui.js':'score-rules-ui.js','/score-rules.css':'score-rules.css','/classroom-lock-ui.js':'classroom-lock-ui.js','/classroom-lock.css':'classroom-lock.css','/classroom-wheels.js':'classroom-wheels.js','/classroom-wheels-ui.js':'classroom-wheels-ui.js','/classroom-wheels.css':'classroom-wheels.css','/classroom-rankings.js':'classroom-rankings.js','/classroom-tools.js':'classroom-tools.js','/classroom-tools-ui.js':'classroom-tools-ui.js','/classroom-tools.css':'classroom-tools.css','/group-tools.js':'group-tools.js','/group-tools-ui.js':'group-tools-ui.js','/group-tools.css':'group-tools.css','/organization-tools.js':'organization-tools.js','/organization-ui.js':'organization-ui.js','/organization-ui.css':'organization-ui.css','/pet-extra-ui.js':'pet-extra-ui.js','/pet-extra-ui.css':'pet-extra-ui.css','/toolbox-extra.js':'toolbox-extra.js','/toolbox-extra-ui.js':'toolbox-extra-ui.js','/toolbox-extra.css':'toolbox-extra.css','/modal-shell.css':'modal-shell.css','/avatar-ui.css':'avatar-ui.css','/avatar-ui.js':'avatar-ui.js','/egg-pet.css':'egg-pet.css'};
  const name=allowed[url.pathname];if(!name){res.writeHead(404);res.end('Not found');return;}
  res.writeHead(200,{'Content-Type':name.endsWith('.css')?'text/css':name.endsWith('.js')?'application/javascript':'text/html','Cache-Control':'no-cache'});res.end(fs.readFileSync(path.join(__dirname,'../src',name)));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
setInterval(()=>{if(state.timer.running&&remainingMs(state.timer)<=0)commit(applyAction(state,{type:'timer.pause'}));},250).unref();
server.listen(Number(process.env.PORT)||4173,'127.0.0.1',()=>console.log(`花伴课堂仅本机预览 http://127.0.0.1:${server.address().port}`));
