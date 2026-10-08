'use strict';
// Synthetic operational records that a configuration-only import must preserve.
const clone=v=>structuredClone(v);
const markers={student:'DO_NOT_EXPORT_STUDENT',score:'DO_NOT_EXPORT_SCORE_HISTORY',homework:'DO_NOT_EXPORT_HOMEWORK_TITLE',group:'DO_NOT_EXPORT_ROSTER_GROUP'};
function buildRichState(Core,ToolboxExtra,now=1700000000000){
 const act=(s,a)=>Core.applyAction(s,a,now),a=require('../../tests/rc18-regression-fixtures.cjs').historical('readopted'),b=Core.createInitialState();delete b.petProgression;
 a.settings.className='合成多表配置甲班';b.settings.className='合成多表配置乙班';
 for(const [p,state]of [a,b].entries())state.students=state.students.map((s,i)=>({...s,...(p?{id:`student_config_${p}_${i}`}:{ }),name:markers.student+`_${p}_${i}`,group:markers.group+`_${i%2}`}));
 let s=Core.validateState({...a,panels:{activeId:'panel_config_a',others:[{id:'panel_config_b',data:b}]}});
 s=act(s,{type:'rules.save',rules:[{id:'rule_config',label:'合成统一配置规则',delta:3,growthDelta:2}]});
 if(!s.petLogs?.length||!s.petAccounts?.some(a=>a.graduations?.length))throw Error('Historical fixture must retain growth and graduation records');
 s=act(s,{type:'score',ids:[s.students[1].id],delta:3,reason:markers.score});
 s=act(s,{type:'group.base',group:s.students[0].group,delta:2,reason:markers.score});
 s=act(s,{type:'draw',scope:'students',mode:'cycle',count:2});
 s=act(s,{type:'pet.draw',scope:'students',mode:'cycle',count:1});
 s=act(s,{type:'timer.set',seconds:600});s=act(s,{type:'timer.start'});
 const tx=action=>{s=act(s,{...ToolboxExtra.expectation(s),...action});};
 tx({type:'toolbox.link.add',id:'link_config_1',title:'合成课堂网址',url:'https://example.com/configuration-fixture'});
 tx({type:'toolbox.homework.add',id:'task_archived',title:markers.homework+'_archived',subject:'语文',date:'2026-10-07'});
 tx({type:'toolbox.homework.set',id:'task_archived',studentId:s.students[0].id,submitted:true});
 tx({type:'toolbox.homework.archive',id:'task_archived',historyId:'history_config',confirmed:true});
 tx({type:'toolbox.homework.add',id:'task_active',title:markers.homework+'_active',subject:'数学',date:'2026-10-07'});
 tx({type:'toolbox.homework.set',id:'task_active',studentId:s.students[1].id,submitted:true});
 return Core.validateState(s);
}
function operationalProjection(state){
 return Object.fromEntries([{id:state.panels?.activeId||'panel_default',data:state},...(state.panels?.others||[])].map(({id,data})=>[id,clone({
  students:data.students,logs:data.logs,groupBases:data.groupBases,groupLogs:data.groupLogs,petAccounts:data.petAccounts,petLogs:data.petLogs,petOperations:data.petOperations,
  draw:data.draw,drawSessions:data.drawSessions,petDraw:data.petDraw,timer:data.timer,classroomTools:data.classroomTools,
  homeworkTasks:data.toolboxExtra?.homework.tasks||[],homeworkHistory:data.toolboxExtra?.homework.history||[],studentOrder:data.settings.studentOrder,groupOrder:data.settings.groupOrder,petFocusId:data.settings.petFocusId
 })]));
}
module.exports={markers,buildRichState,operationalProjection};
