(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ClassroomRankings=api;})(globalThis,function(){
 'use strict';
 const labels={students:'学生积分',average:'小组成员平均分',base:'小组基础分',groups:'小组成员总分'};
 function rows(state,mode='students'){
  if(!Object.hasOwn(labels,mode))throw Error('排行榜类型无效');let rows;
  if(mode==='students')rows=state.students.map(s=>({name:s.name,group:s.group,score:s.score}));
  else rows=[...new Set([...state.students.map(s=>s.group),...(state.groupBases||[]).map(g=>g.group)])].map(name=>{const members=state.students.filter(s=>s.group===name),total=members.reduce((n,s)=>n+s.score,0),base=state.groupBases?.find(g=>g.group===name)?.score||0,average=members.length?Math.round(total/members.length):0;return {name,count:members.length,base,total,average,score:mode==='base'?base:mode==='average'?average:total,members:members.map(s=>({name:s.name,score:s.score})),group:`${members.length}位成员${mode==='average'?` · 成员合计 ${total} ÷ 人数`:''}`};});
  rows.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'zh-CN'));let rank=0,last;return rows.map((r,i)=>{if(r.score!==last)rank=i+1;last=r.score;return {...r,rank};});
 }
 function copyText(state,mode){const data=rows(state,mode);return `${state.settings.className} · ${labels[mode]}排行榜\n`+(mode==='students'?'排名\t姓名\t小组\t当前积分\n':'排名\t小组名称\t小组基础分\t小组平均分\t成员总分\t成员积分明细\n')+data.map(r=>mode==='students'?`${r.rank}\t${r.name}\t${r.group}\t${r.score}`:`${r.rank}\t${r.name}\t${r.base}\t${r.average}\t${r.total}\t${r.members.map(m=>m.name+' '+m.score).join('、')}`).join('\n');}
 return Object.freeze({rows,copyText,labels});
});
