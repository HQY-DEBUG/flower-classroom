(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ScoreRules=api;})(globalThis,function(){
 'use strict';
 const defaults=Object.freeze([['participate','积极发言',1],['practice','认真做题',2],['help','乐于助人',2],['improve','进步很大',5],['team','团队合作',2],['correct','需要改进',-1],['writing','字迹工整',1],['posture','坐姿端正',1],['punctual','从来没有迟到过',2],['duty','认真做值日',2],['progress','成绩进步',3],['top5','考试前五名',5],['reflection','知错能改',2],['activities','积极参加学校活动',2]].map(([id,label,delta])=>Object.freeze({id:'rule_'+id,label,delta})));
 function validateRules(input){
  if(!Array.isArray(input)||input.length<1||input.length>100)throw Error('积分原因需保留1–100项');
  const seen=new Set();
  return input.map(item=>{
   if(!item||typeof item!=='object'||Array.isArray(item)||![Object.prototype,null].includes(Object.getPrototypeOf(item)))throw Error('积分原因格式无效');
   if(typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(item.id)||seen.has(item.id))throw Error('积分原因编号无效或重复');seen.add(item.id);
   if(typeof item.label!=='string')throw Error('积分原因必须为文字');const label=item.label.trim();
   if(!label||[...label].length>120||/[\u0000-\u001f\u007f]/u.test(label))throw Error('积分原因需为1–120字，不含控制字符');
   if(!Number.isInteger(item.delta)||item.delta===0||Math.abs(item.delta)>100)throw Error('规则分值需为−100至100的非零整数');
   return {id:item.id,label,delta:item.delta};
  });
 }
 const list=state=>validateRules(state?.settings?.scoreRules??defaults);
 const same=(a,b)=>JSON.stringify(validateRules(a))===JSON.stringify(validateRules(b));
 function flexibleDelta(value,direction){const raw=typeof value==='string'?value.trim():String(value);if(!/^[0-9]+$/.test(raw))throw Error('请输入1–100的正整数，系统按所选方向加减');const n=Number(raw);if(!Number.isInteger(n)||n<1||n>100||![1,-1].includes(direction))throw Error('请输入1–100的正整数，系统按所选方向加减');return n*direction;}
 return Object.freeze({defaults,list,validateRules,same,flexibleDelta});
});
