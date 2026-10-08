/* Panel-local homework and teacher-curated links. No network, scoring, or automatic URL visits. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ToolboxExtra=api;})(globalThis,function(){
 'use strict';
 const MAX_REVISION=Number.MAX_SAFE_INTEGER-1, MAX_TASKS=40, MAX_HISTORY=200;
 const OFFICIAL_URL='https://basic.smartedu.cn/';
 const types=new Set(['toolbox.link.add','toolbox.link.update','toolbox.link.remove','toolbox.link.move','toolbox.homework.subjects','toolbox.homework.add','toolbox.homework.update','toolbox.homework.remove','toolbox.homework.set','toolbox.homework.bulk','toolbox.homework.reset','toolbox.homework.archive']);
 const fail=m=>{throw Error(m);};
 function record(v,label){if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail(label+'格式无效');return v;}
 function integer(v,min,max,label){if(!Number.isSafeInteger(v)||v<min||v>max)fail(label+'范围无效');return v;}
 function text(v,max,label){if(typeof v!=='string'||!v.trim()||[...v.trim()].length>max||/[\u0000-\u001f\u007f]/.test(v))fail(label+'不能为空或超长');return v.trim();}
 function id(v){if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(v))fail('编号无效');return v;}
 function list(v,max,label){if(!Array.isArray(v)||v.length>max)fail(label+'数量过多或格式无效');return v;}
 function distinct(v,label){if(new Set(v).size!==v.length)fail(label+'不能重复');return v;}
 function url(v){const value=text(v,2048,'网址');if(!/^https?:\/\//i.test(value)||/[\s\\]/.test(value))fail('只允许完整的 http:// 或 https:// 网页地址');let parsed;try{parsed=new URL(value);}catch{fail('网址格式无效');}if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||parsed.username||parsed.password)fail('网址不能含账号密码，且仅支持 http(s)');return parsed.href;}
 function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)fail('作业日期无效');return v;}
 const panelId=s=>s.panels?.activeId||'panel_default';
 const rosterKey=s=>JSON.stringify(s.students.map(v=>[v.id,v.name,v.group]));
 const empty=()=>({version:1,revision:0,links:[],homework:{subjects:['语文','数学','英语'],tasks:[],history:[]}});
 function selected(v,roster){const result=distinct(list(v,300,'销号名单').map(id),'学生');if(result.some(k=>!roster.has(k)))fail('销号名单含已移除学生');return result;}
 function task(v,roster){record(v,'作业');return {id:id(v.id),title:text(v.title,80,'任务名称'),subject:text(v.subject,40,'科目'),date:date(v.date),submittedIds:selected(v.submittedIds,roster)};}
 function validate(value,students){
  const v=record(value,'百宝箱');if(v.version!==1)fail('百宝箱版本无效');const roster=new Set(students.map(s=>s.id));
  const links=list(v.links,60,'网址').map(l=>{record(l,'网址');return {id:id(l.id),title:text(l.title,60,'网址名称'),url:url(l.url)};});distinct(links.map(l=>l.id),'网址编号');
  const hw=record(v.homework,'作业销号'),subjects=distinct(list(hw.subjects,20,'科目').map(s=>text(s,40,'科目')),'科目');if(!subjects.length)fail('至少保留一个科目');
  const tasks=list(hw.tasks,MAX_TASKS,'进行中作业').map(v=>task(v,roster));distinct(tasks.map(t=>t.id),'任务编号');if(tasks.some(t=>!subjects.includes(t.subject)))fail('任务科目不在设置中');
  const history=list(hw.history,MAX_HISTORY,'作业历史').map(h=>{record(h,'作业历史');const members=list(h.members,300,'历史名单').map(m=>{record(m,'历史同学');if(typeof m.submitted!=='boolean')fail('历史提交状态无效');return {id:id(m.id),name:text(m.name,40,'历史姓名'),group:text(m.group,40,'历史小组'),submitted:m.submitted};});distinct(members.map(m=>m.id),'历史学生');if(!['reset','archive','remove'].includes(h.kind))fail('作业历史类型无效');return {id:id(h.id),taskId:id(h.taskId),title:text(h.title,80,'历史任务'),subject:text(h.subject,40,'历史科目'),date:date(h.date),timestamp:integer(h.timestamp,0,MAX_REVISION,'历史时间'),kind:h.kind,members};});distinct(history.map(h=>h.id),'历史编号');
  return {version:1,revision:integer(v.revision,0,MAX_REVISION,'百宝箱版本'),links,homework:{subjects,tasks,history}};
 }
 const hasNewFields=s=>s.toolboxExtra!==undefined;
 function validateExtensions(source,result){if(!hasNewFields(source))return;if(source.version!==2)fail('百宝箱数据需要 version 2 存档');result.toolboxExtra=validate(source.toolboxExtra,result.students);}
 const snapshot=s=>hasNewFields(s)?validate(s.toolboxExtra,s.students):empty();
 const expectation=s=>({panelId:panelId(s),expectedExtraRevision:snapshot(s).revision,expectedRoster:rosterKey(s)});
 function assertCurrent(s,a,v=snapshot(s)){if(a.panelId!==panelId(s))fail('面板已切换，请重新打开百宝箱');if(a.expectedExtraRevision!==v.revision)fail('百宝箱已在另一窗口更新，请重新确认');if(a.expectedRoster!==rosterKey(s))fail('学生名单已变化，请重新确认');}
 function apply(s,a,now=Date.now()){record(a,'百宝箱操作');if(!types.has(a.type))fail('未知百宝箱操作');const v=snapshot(s);assertCurrent(s,a,v);const hw=v.homework,roster=new Set(s.students.map(s=>s.id));
  const findTask=()=>{const t=hw.tasks.find(t=>t.id===a.id);if(!t)fail('找不到这项作业');return t;};
  const history=(t,kind)=>{if(a.confirmed!==true)fail('请先确认作业'+(kind==='reset'?'重置':'归档或移除'));if(hw.history.length>=MAX_HISTORY)fail('历史已达200条，请先备份并新建面板继续；本次未修改');const hid=id(a.historyId);if(hw.history.some(h=>h.id===hid))fail('历史编号重复');hw.history.push({id:hid,taskId:t.id,title:t.title,subject:t.subject,date:t.date,timestamp:integer(now,0,MAX_REVISION,'历史时间'),kind,members:s.students.map(st=>({id:st.id,name:st.name,group:st.group,submitted:t.submittedIds.includes(st.id)}))});};
  if(a.type.startsWith('toolbox.link.')){
   if(a.type==='toolbox.link.add'){if(v.links.length>=60)fail('最多保存60个网址');const next={id:id(a.id),title:text(a.title,60,'网址名称'),url:url(a.url)};if(v.links.some(l=>l.id===next.id))fail('网址编号重复');v.links.push(next);}
   else{const index=v.links.findIndex(l=>l.id===a.id);if(index<0)fail('找不到这个网址');if(a.type==='toolbox.link.update')v.links[index]={id:a.id,title:text(a.title,60,'网址名称'),url:url(a.url)};else if(a.type==='toolbox.link.remove'){if(a.confirmed!==true)fail('请先确认移除网址');v.links.splice(index,1);}else{if(![-1,1].includes(a.direction))fail('排序方向无效');const next=index+a.direction;if(next<0||next>=v.links.length)fail('已到达排序边界');[v.links[index],v.links[next]]=[v.links[next],v.links[index]];}}
  }else if(a.type==='toolbox.homework.subjects'){const names=distinct(list(a.subjects,20,'科目').map(s=>text(s,40,'科目')),'科目');if(!names.length||hw.tasks.some(t=>!names.includes(t.subject)))fail('请保留至少一个科目及进行中任务使用的科目');hw.subjects=names;}
  else if(a.type==='toolbox.homework.add'){if(hw.tasks.length>=MAX_TASKS)fail('最多同时记录40项作业');const t=task({...a,submittedIds:[]},roster);if(hw.tasks.some(v=>v.id===t.id))fail('任务编号重复');if(!hw.subjects.includes(t.subject))fail('请先设置该科目');hw.tasks.push(t);}
  else {const t=findTask();switch(a.type){
   case 'toolbox.homework.update':{const next=task({...a,submittedIds:t.submittedIds},roster);if(!hw.subjects.includes(next.subject))fail('请先设置该科目');Object.assign(t,next);break;}
   case 'toolbox.homework.set':{selected([a.studentId],roster);if(typeof a.submitted!=='boolean')fail('提交状态无效');const marks=new Set(t.submittedIds);if(marks.has(a.studentId)===a.submitted)fail('提交状态已经更新，请勿重复操作');if(a.submitted)marks.add(a.studentId);else marks.delete(a.studentId);t.submittedIds=s.students.filter(st=>marks.has(st.id)).map(st=>st.id);break;}
   case 'toolbox.homework.bulk':{const ids=selected(a.ids,roster);if(!ids.length||typeof a.submitted!=='boolean')fail('请选择学生和有效状态');const marks=new Set(t.submittedIds);if(ids.every(id=>marks.has(id)===a.submitted))fail('所选学生状态已经一致');for(const id of ids){if(a.submitted)marks.add(id);else marks.delete(id);}t.submittedIds=s.students.filter(st=>marks.has(st.id)).map(st=>st.id);break;}
   case 'toolbox.homework.reset':history(t,'reset');t.submittedIds=[];break;
   case 'toolbox.homework.archive':history(t,'archive');hw.tasks=hw.tasks.filter(v=>v.id!==t.id);break;
   case 'toolbox.homework.remove':history(t,'remove');hw.tasks=hw.tasks.filter(v=>v.id!==t.id);break;
  }}
  v.revision=integer(v.revision+1,0,MAX_REVISION,'百宝箱版本');s.toolboxExtra=v;s.version=2;return s;
 }
 function reconcile(s){if(!hasNewFields(s))return s;const roster=new Set(s.students.map(s=>s.id));let changed=false;for(const task of s.toolboxExtra.homework.tasks){const keep=task.submittedIds.filter(id=>roster.has(id));if(keep.length!==task.submittedIds.length){task.submittedIds=keep;changed=true;}}if(changed)s.toolboxExtra.revision=integer(s.toolboxExtra.revision+1,0,MAX_REVISION,'百宝箱版本');return s;}
 function summary(s,taskId){const t=snapshot(s).homework.tasks.find(t=>t.id===taskId);if(!t)fail('找不到这项作业');const marked=new Set(t.submittedIds);return {task:t,total:s.students.length,submitted:s.students.filter(st=>marked.has(st.id)),missing:s.students.filter(st=>!marked.has(st.id))};}
 return Object.freeze({OFFICIAL_URL,MAX_TASKS,MAX_HISTORY,empty,url,validate,validateExtensions,hasNewFields,snapshot,expectation,assertCurrent,panelId,rosterKey,apply,reconcile,summary,handles:type=>types.has(type)});
});
