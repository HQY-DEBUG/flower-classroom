/* Original classroom wheel defaults; ordinary point prizes and voluntary light challenges. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ClassroomWheels=api;})(globalThis,function(){
 'use strict';
 const defaults=Object.freeze([{id:'pencil',name:'铅笔一支',cost:200},{id:'sticker',name:'鼓励贴纸',cost:20},{id:'bookmark',name:'成长书签',cost:40},{id:'choice',name:'选择课堂小游戏',cost:60}]);
 const challenges=Object.freeze(['说一句鼓励同伴的话','分享今天的小发现','给大家一个微笑','做一次深呼吸','说出一个感谢的理由','邀请全组一起鼓掌']);
 const clean=(v,label,max=60)=>{if(typeof v!=='string'||!v.trim()||[...v.trim()].length>max||/[\u0000-\u001f\u007f]/u.test(v))throw Error(label+'需填写1–'+max+'字');return v.trim();};
 function prizes(values){if(!Array.isArray(values)||!values.length||values.length>24)throw Error('奖品需设置1–24项');const seen=new Set();return values.map(p=>{if(!p||typeof p!=='object'||typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(p.id)||seen.has(p.id))throw Error('奖品编号无效或重复');seen.add(p.id);if(!Number.isSafeInteger(p.cost)||p.cost<1||p.cost>1000000)throw Error('奖品分值需为1–1000000整数');return {id:p.id,name:clean(p.name,'奖品名称'),cost:p.cost};});}
 function options(values){if(!Array.isArray(values)||!values.length||values.length>24)throw Error('挑战需设置1–24项');return values.map(v=>clean(v,'挑战内容',80));}
 const list=s=>prizes(s.settings.wheelPrizes||defaults),challengeList=s=>options(s.settings.challengeOptions||challenges);
 const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function pick(values){if(!values.length)throw Error('没有可抽取的选项');const max=values.length,cap=0x100000000-(0x100000000%max),u=new Uint32Array(1);do{globalThis.crypto.getRandomValues(u);}while(u[0]>=cap);return values[u[0]%max];}
 return Object.freeze({defaults,challenges,prizes,options,list,challengeList,same,pick});
});
