/* Classroom display order and independent ordinary draw sessions.
 * RC4 choices are inferred product rules, not claims about the reference's hidden implementation. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./pet-progress.js'):root.PetProgress);if(typeof module==='object'&&module.exports)module.exports=api;else root.OrganizationTools=api;})(globalThis,function(Progress){
 'use strict';
 const sorts=Object.freeze({natural:'添加顺序',name:'姓名顺序',scoreDesc:'积分从高到低',scoreAsc:'积分从低到高',growth:'当前成长从高到低',level:'当前等级从高到低',leader:'组长优先',custom:'自定顺序'});
 const fail=message=>{throw Error(message);};
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const clone=value=>JSON.parse(JSON.stringify(value));
 const key=(scope,mode)=>`${scope}_${mode}`;
 const drawKey=state=>JSON.stringify([state.draw.scope||'students',state.draw.mode,state.draw.round,state.draw.lastIds,state.draw.bag]);
 function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(label+'格式无效');return value;}
 function id(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))fail('学生编号无效');return value;}
 function order(value){if(!Array.isArray(value)||value.length>300)fail('学生顺序格式无效');const result=value.map(id);if(new Set(result).size!==result.length)fail('学生顺序不能重复');return result;}
 function customOrder(state){const live=state.students.map(v=>v.id),available=new Set(live),saved=(state.settings.studentOrder||[]).filter(id=>available.has(id)),seen=new Set(saved);return [...saved,...live.filter(id=>!seen.has(id))];}
 function sortedStudents(state,list=state.students,mode=state.settings.studentSort||'natural'){
  if(!Object.hasOwn(sorts,mode))fail('成员排序方式无效');
  const positions=new Map((mode==='custom'?customOrder(state):state.students.map(v=>v.id)).map((id,i)=>[id,i]));
  const values=new Map();if(['growth','level'].includes(mode))for(const student of list)values.set(student.id,Progress.profile(state,student));
  return [...list].sort((a,b)=>{
   let delta=0;
   if(mode==='name')delta=a.name.localeCompare(b.name,'zh-CN',{numeric:true,sensitivity:'base'});
   if(mode==='scoreDesc')delta=b.score-a.score;if(mode==='scoreAsc')delta=a.score-b.score;
   if(mode==='growth')delta=values.get(b.id).growth-values.get(a.id).growth;
   if(mode==='level')delta=(values.get(b.id).adopted?values.get(b.id).level:0)-(values.get(a.id).adopted?values.get(a.id).level:0);
   if(mode==='leader')delta=Number(!!b.leader)-Number(!!a.leader);
   return delta||(positions.get(a.id)-positions.get(b.id));
  });
 }
 function validateSettings(raw,result){
  if(raw.settings.studentSort!==undefined){if(raw.version!==2||!Object.hasOwn(sorts,raw.settings.studentSort))fail('成员排序数据无效');result.settings.studentSort=raw.settings.studentSort;}
  if(raw.settings.studentOrder!==undefined){if(raw.version!==2)fail('自定顺序需要新版存档格式');result.settings.studentOrder=order(raw.settings.studentOrder);const allowed=new Set(result.students.map(v=>v.id));if(result.settings.studentOrder.some(id=>!allowed.has(id)))fail('自定顺序包含已移除学生');}
 }
 function setOrder(state,action){
  const current=customOrder(state);if(!same(action.expectedOrder,current))fail('学生顺序已变化，请重新打开排序');
  const next=order(action.order),live=new Set(current);if(next.length!==current.length||next.some(id=>!live.has(id)))fail('学生名单已变化，请重新打开排序');
  state.settings.studentOrder=next;state.settings.studentSort='custom';
 }
 function candidates(state,scope='students'){if(!['students','groups'].includes(scope))fail('抽取对象无效');return scope==='students'?state.students.map(v=>v.id):[...new Set(state.students.map(v=>v.group))];}
 function empty(scope='students',mode='cycle'){return {mode,bag:[],lastIds:[],round:0,...(scope==='groups'?{scope,lastGroups:[],groups:[]}: {})};}
 function validateDraw(value,students){
  const d=object(value,'点名状态'),scope=d.scope||'students';if(!['students','groups'].includes(scope)||!['cycle','repeat'].includes(d.mode))fail('点名模式无效');
  const ids=new Set(students.map(v=>v.id)),names=new Set(students.map(v=>v.group));
  function list(value,allowed,label,max=300){if(!Array.isArray(value)||value.length>max||value.some(v=>typeof v!=='string'||!allowed.has(v))||new Set(value).size!==value.length)fail(label+'包含重复或无效对象');return [...value];}
  const result={mode:d.mode,bag:list(d.bag,scope==='groups'?names:ids,'待抽名单'),lastIds:list(d.lastIds,ids,'点名结果'),round:d.round};
  if(!Number.isSafeInteger(d.round)||d.round<0||d.round>Number.MAX_SAFE_INTEGER-1)fail('点名轮次无效');
  if(scope==='groups'){
   result.scope='groups';result.lastGroups=list(d.lastGroups,names,'点名小组',20);
   if(!Array.isArray(d.groups)||d.groups.length>20)fail('点名小组快照无效');
   result.groups=d.groups.map(raw=>{object(raw,'点名小组');const idsInGroup=students.filter(v=>v.group===raw.group).map(v=>v.id),memberIds=list(raw.ids,ids,'点名小组成员');if(!memberIds.length||!same(memberIds,idsInGroup))fail('点名小组成员快照已变化');return {group:raw.group,ids:memberIds};});
   if(!same(result.groups.map(v=>v.group),result.lastGroups)||!same(result.groups.flatMap(v=>v.ids),result.lastIds))fail('点名小组快照不一致');
  }else if(d.lastGroups!==undefined||d.groups!==undefined)fail('学生点名不能包含小组快照');
  if(result.mode==='repeat'&&result.bag.length)fail('重复点名模式不应包含待抽名单');
  if(result.mode==='cycle'&&result.bag.some(v=>(scope==='groups'?result.lastGroups:result.lastIds).includes(v)))fail('本轮点名结果不能仍在待抽名单中');
  return result;
 }
 function validateExtensions(raw,result){
  validateSettings(raw,result);
  if(raw.drawSessions!==undefined){
   if(raw.version!==2)fail('独立点名池需要新版存档格式');object(raw.drawSessions,'点名池');result.drawSessions={};
   for(const [name,value]of Object.entries(raw.drawSessions)){if(!['students_cycle','students_repeat','groups_cycle','groups_repeat'].includes(name))fail('点名池名称无效');const d=validateDraw(value,result.students);if(name!==key(d.scope||'students',d.mode))fail('点名池类型不一致');result.drawSessions[name]=d;}
   const current=result.drawSessions[key(result.draw.scope||'students',result.draw.mode)];if(!current||!same(current,result.draw))fail('当前点名与独立抽取池不一致');
  }
  if(result.draw.scope==='groups'&&(raw.version!==2||!result.drawSessions))fail('小组点名缺少独立抽取池');
 }
 function selectDraw(state,scope,mode){
  candidates(state,scope);if(!['cycle','repeat'].includes(mode))fail('点名模式无效');
  state.drawSessions||={};state.drawSessions[key(state.draw.scope||'students',state.draw.mode)]=clone(state.draw);
  state.draw=clone(state.drawSessions[key(scope,mode)]||empty(scope,mode));state.drawSessions[key(scope,mode)]=clone(state.draw);state.version=2;
 }
 function draw(state,action,shuffle){
  const scope=action.scope||state.draw.scope||'students',mode=action.mode||state.draw.mode,all=candidates(state,scope),count=action.count??1;
  if(!all.length)fail('请先添加学生');if(!Number.isSafeInteger(count)||count<1||count>Math.min(20,all.length))fail(scope==='groups'?'抽选组数需为有效整数，最多20组':'点名人数需为有效整数，最多20人');
  selectDraw(state,scope,mode);let selected;const d=state.draw;
  if(mode==='repeat'){d.bag=[];selected=shuffle(all).slice(0,count);}
  else{if(!d.bag.length){d.bag=shuffle(all);d.round++;}selected=d.bag.splice(0,Math.min(count,d.bag.length));}
  if(scope==='groups'){d.lastGroups=selected;d.groups=selected.map(group=>({group,ids:state.students.filter(v=>v.group===group).map(v=>v.id)}));d.lastIds=d.groups.flatMap(v=>v.ids);}else d.lastIds=selected;
  state.drawSessions[key(scope,mode)]=clone(d);
 }
 function resetDraw(state,all=false,groupsOnly=false){
  if(all){
   if(groupsOnly){if(state.drawSessions)for(const k of ['groups_cycle','groups_repeat'])delete state.drawSessions[k];if(state.draw.scope!=='groups')return;}
   else delete state.drawSessions;
  }
  state.draw=empty(state.draw.scope||'students',state.draw.mode);
  if(state.drawSessions||state.draw.scope==='groups'){state.drawSessions||={};state.drawSessions[key(state.draw.scope||'students',state.draw.mode)]=clone(state.draw);}
 }
 function reconcile(state){if(state.settings.studentOrder!==undefined)state.settings.studentOrder=customOrder(state);}
 function hasNewFields(state){return state.settings.studentSort!==undefined||state.settings.studentOrder!==undefined||state.drawSessions!==undefined||state.draw.scope==='groups';}
 // Reassign identifiers, never displayed names, group names, photos or free-form reasons.
 function copyPanel(state,newId){
  const result=clone(state);delete result.panels;const replacements=new Map();
  const referenceKeys=new Set(['id','studentId','accountId','activeCycleId','cycleId','graduationId','sourceActionId','redemptionId','requestId','petFocusId','taskId']);
  const idArrays=new Set(['ids','lastIds','presentIds','submittedIds','studentOrder','bag']);
  function collect(value){if(Array.isArray(value)){value.forEach(collect);return;}if(!value||typeof value!=='object')return;for(const [k,v]of Object.entries(value)){if(referenceKeys.has(k)&&typeof v==='string'&&v&&!replacements.has(v))replacements.set(v,newId());collect(v);}}
  collect(result);
  function replace(value,parentKey='',parent=null){if(Array.isArray(value))return value.map(v=>typeof v==='string'&&idArrays.has(parentKey)&&!(parentKey==='bag'&&parent?.scope==='groups')?(replacements.get(v)||v):replace(v));if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,referenceKeys.has(k)&&typeof v==='string'?(replacements.get(v)||v):replace(v,k,value)]));}
  return replace(result);
 }
 return Object.freeze({sorts,same,drawKey,customOrder,sortedStudents,setOrder,validateDraw,validateExtensions,candidates,selectDraw,draw,resetDraw,reconcile,hasNewFields,copyPanel});
});
