(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GroupTools=api;})(globalThis,function(){
 'use strict';
 const MAX_GROUPS=600,MAX_BASES=300;
 function groupName(value){
  if(typeof value!=='string')throw Error('小组名称必须是文字');
  const name=value.trim();
  if(!name||[...name].length>40||/[\u0000-\u001f\u007f]/u.test(name))throw Error('小组名称需为1–40字，不含控制字符');
  return name;
 }
 function validateOrder(input){
  if(!Array.isArray(input)||input.length>MAX_GROUPS)throw Error('小组顺序格式无效');
  const order=input.map(groupName);
  if(new Set(order).size!==order.length)throw Error('小组顺序不能重复');
  return order;
 }
 function naturalNames(state){return [...new Set([...(state.students||[]).map(s=>s.group),...(state.groupBases||[]).map(g=>g.group)])];}
 function names(state){
  const live=naturalNames(state),available=new Set(live);
  const saved=state.settings?.groupOrder===undefined?[]:validateOrder(state.settings.groupOrder);
  const result=saved.filter(name=>available.has(name)),seen=new Set(result);
  return [...result,...live.filter(name=>!seen.has(name))];
 }
 // Missing groupOrder stays missing on old archives; this helper never writes to state.
 function reconcileOrder(state){return state.settings?.groupOrder===undefined?undefined:names(state);}
 function orderedGroups(state,rows){
  const order=names(state);
  if(rows===undefined)return order.map(name=>{
   const students=(state.students||[]).filter(s=>s.group===name);
   return {name,students,memberTotal:students.reduce((sum,s)=>sum+s.score,0),base:(state.groupBases||[]).find(g=>g.group===name)?.score||0};
  });
  const positions=new Map(order.map((name,i)=>[name,i]));
  return [...rows].sort((a,b)=>(positions.get(a.group??a.name)??MAX_GROUPS)-(positions.get(b.group??b.name)??MAX_GROUPS));
 }
 function createGroupPatch(state,value){
  const group=groupName(value);
  if(naturalNames(state).includes(group))throw Error('已存在同名小组');
  if((state.groupBases||[]).length>=MAX_BASES)throw Error('独立小组记录已达300组上限，请先备份并整理');
  const groupBases=[...(state.groupBases||[]).map(item=>({...item})),{group,score:0}];
  const groupOrder=reconcileOrder({...state,groupBases});
  return {group,groupBases,...(groupOrder===undefined?{}:{groupOrder})};
 }
 function orderPatch(state,input,expected){
  const current=names(state),order=validateOrder(input);
  if(expected===undefined||JSON.stringify(validateOrder(expected))!==JSON.stringify(current))throw Error('小组顺序已变化，请重新打开排序');
  const live=new Set(current);
  if(order.length!==current.length||order.some(name=>!live.has(name)))throw Error('小组名单已变化，请重新打开排序');
  return {groupOrder:order};
 }
 function move(order,index,direction){
  const result=validateOrder(order);
  if(!Number.isInteger(index)||index<0||index>=result.length||![-1,1].includes(direction))throw Error('小组移动位置无效');
  const target=index+direction;
  if(target>=0&&target<result.length)[result[index],result[target]]=[result[target],result[index]];
  return result;
 }
 function assertAssignments(state,ids,expected,group){
  if(!Array.isArray(ids)||!ids.length||ids.length>300||new Set(ids).size!==ids.length)throw Error('请选择1–300位不同的学生');
  const students=new Map((state.students||[]).map(s=>[s.id,s]));
  if(ids.some(id=>typeof id!=='string'||!students.has(id)))throw Error('分组名单包含不存在的学生');
  if(!Array.isArray(expected)||expected.length!==ids.length)throw Error('分组名单已变化，请重新打开分配窗口');
  const previous=new Map();
  for(const item of expected){
   if(!item||typeof item!=='object'||Array.isArray(item)||typeof item.id!=='string'||previous.has(item.id)||typeof item.group!=='string')throw Error('分组快照格式无效');
   previous.set(item.id,item.group);
  }
  if(ids.some(id=>previous.get(id)!==students.get(id).group))throw Error('学生分组已变化，请重新打开分配窗口');
  const target=groupName(group);
  if(!naturalNames(state).includes(target))throw Error('目标小组已变化，请重新选择');
  return target;
 }
 // Prepare both operations before the caller commits anything. A failed
 // selection snapshot must never leave an empty group behind.
 function createAndAssignPatch(state,ids,expected,value){
  const patch=createGroupPatch(state,value);
  assertAssignments({...state,groupBases:patch.groupBases},ids,expected,patch.group);
  return patch;
 }
 return Object.freeze({MAX_GROUPS,MAX_BASES,groupName,validateOrder,names,reconcileOrder,orderedGroups,createGroupPatch,createAndAssignPatch,orderPatch,move,assertAssignments});
});
