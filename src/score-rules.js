(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ScoreRules=api;})(globalThis,function(){
 'use strict';
 const defaults=Object.freeze([['participate','积极发言',1],['practice','认真做题',2],['help','乐于助人',2],['improve','进步很大',5],['team','团队合作',2],['correct','需要改进',-1],['writing','字迹工整',1],['posture','坐姿端正',1],['punctual','从来没有迟到过',2],['duty','认真做值日',2],['progress','成绩进步',3],['top5','考试前五名',5],['reflection','知错能改',2],['activities','积极参加学校活动',2]].map(([id,label,delta])=>Object.freeze({id:'rule_'+id,label,delta})));
 const MAX_SHARED_RULES=2000;
 const clone=value=>JSON.parse(JSON.stringify(value));
 function plain(value,label){if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error(`${label}格式无效`);return value;}
 function identifier(value,label){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw Error(`${label}无效`);return value;}
 function validateRules(input,{max=100}={}){
  if(![100,MAX_SHARED_RULES].includes(max))throw Error('积分原因数量上限无效');
  if(!Array.isArray(input)||input.length<1||input.length>max)throw Error(`积分原因需保留1–${max}项`);
  const seen=new Set();
  return input.map(item=>{
   plain(item,'积分原因');
   if(typeof item.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(item.id)||seen.has(item.id))throw Error('积分原因编号无效或重复');seen.add(item.id);
   if(typeof item.label!=='string')throw Error('积分原因必须为文字');const label=item.label.trim();
   if(!label||[...label].length>120||/[\u0000-\u001f\u007f]/u.test(label))throw Error('积分原因需为1–120字，不含控制字符');
   if(!Number.isInteger(item.delta)||item.delta===0||Math.abs(item.delta)>100)throw Error('规则分值需为−100至100的非零整数');
   const rule={id:item.id,label,delta:item.delta};
   // Absence retains the historical context-specific growth behavior.
   if(Object.hasOwn(item,'growthDelta')){
    if(!Number.isInteger(item.growthDelta)||Math.abs(item.growthDelta)>100)throw Error('规则成长值需为−100至100的整数，可以为0');
    rule.growthDelta=item.growthDelta;
   }
   return rule;
  });
 }
 const validateSharedRules=input=>validateRules(input,{max:MAX_SHARED_RULES});
 const list=state=>state?.sharedScoreRules?validateSharedRules(state.sharedScoreRules.rules):validateSharedRules(state?.settings?.scoreRules??defaults);
 const same=(a,b)=>JSON.stringify(validateSharedRules(a))===JSON.stringify(validateSharedRules(b));
 const effectiveGrowth=(rule,enabled=false)=>rule.growthDelta??(enabled?rule.delta:Math.max(0,rule.delta));
 const compare=(a,b)=>a<b?-1:a>b?1:0;
 function panelSnapshots(state){
  const panels=[{id:state.panels?.activeId||'panel_default',data:state},...(state.panels?.others||[])];
  if(panels.length>20)throw Error('最多保留20个面板');
  const seen=new Set();
  return panels.map(({id,data})=>{
   identifier(id,'面板编号');if(seen.has(id))throw Error('面板编号不能重复');seen.add(id);
   plain(data?.settings,'班级设置');const name=data.settings.className;
   if(typeof name!=='string'||!name.trim()||[...name.trim()].length>80||/[\u0000-\u001f\u007f]/u.test(name))throw Error('面板名称无效');
   return {id,name:name.trim(),explicit:Object.hasOwn(data.settings,'scoreRules'),rules:validateRules(data.settings.scoreRules??defaults)};
  }).sort((a,b)=>compare(a.id,b.id));
 }
 function mergedPanels(panels){
  // Reserve every original ID before assigning deterministic conflict IDs.
  const reserved=new Set(panels.flatMap(panel=>panel.rules.map(rule=>rule.id))),byOriginal=new Map(),rules=[],mappings=[];
  let sequence=0;
  for(const panel of panels)for(const rule of panel.rules){
   const variants=byOriginal.get(rule.id)||[];
   let variant=variants.find(item=>same([item.original],[rule]));
   if(!variant){
    let id=rule.id;
    if(variants.length){do{id=`shared_${String(++sequence).padStart(4,'0')}`;}while(reserved.has(id));reserved.add(id);}
    variant={original:rule,sharedRule:{...rule,id},sources:[]};variants.push(variant);byOriginal.set(rule.id,variants);rules.push(variant.sharedRule);
   }
   variant.sources.push({panelId:panel.id,panelName:panel.name,ruleId:rule.id});
   mappings.push({panelId:panel.id,ruleId:rule.id,sharedRuleId:variant.sharedRule.id});
  }
  const conflicts=[];
  for(const [id,variants]of byOriginal)if(variants.length>1)conflicts.push({kind:'id',id,variants:variants.map(item=>({rule:{...item.sharedRule},sources:clone(item.sources)}))});
  const byLabel=new Map();
  for(const variants of byOriginal.values())for(const item of variants){const list=byLabel.get(item.original.label)||[];list.push(item);byLabel.set(item.original.label,list);}
  for(const [label,variants]of byLabel){
   const values=new Set(variants.map(item=>JSON.stringify([item.original.delta,Object.hasOwn(item.original,'growthDelta')?item.original.growthDelta:null])));
   if(values.size>1)conflicts.push({kind:'label',label,variants:variants.map(item=>({rule:{...item.sharedRule},sources:clone(item.sources)}))});
  }
  return {rules:validateSharedRules(rules),mappings,conflicts};
 }
 function validateShared(input){
  const value=plain(input,'共享计分卡片');
  if(value.version!==1)throw Error('不支持此共享计分卡片版本');
  if(!Number.isSafeInteger(value.revision)||value.revision<0||value.revision>=Number.MAX_SAFE_INTEGER)throw Error('共享计分卡片版本无效');
  const result={version:1,revision:value.revision,rules:validateSharedRules(value.rules)};
  if(value.migration!==undefined)result.migration=validateMigration(value.migration);
  if(value.migrationHistory!==undefined){
   if(!Array.isArray(value.migrationHistory)||value.migrationHistory.length>100)throw Error('旧表格规则快照最多保留100次，请保留完整备份');
   result.migrationHistory=value.migrationHistory.map(validateMigration);
  }
  return result;
 }
 function validateMigration(input){
   const archive=plain(input,'旧面板规则快照');
   if(!Array.isArray(archive.panels)||!archive.panels.length||archive.panels.length>20)throw Error('旧面板规则快照无效');
   const ids=new Set();
   const panels=archive.panels.map(item=>{
    plain(item,'旧面板规则快照');const id=identifier(item.id,'旧面板编号');if(ids.has(id))throw Error('旧面板编号不能重复');ids.add(id);
    if(typeof item.name!=='string'||!item.name.trim()||[...item.name.trim()].length>80||/[\u0000-\u001f\u007f]/u.test(item.name))throw Error('旧面板名称无效');
    if(typeof item.explicit!=='boolean')throw Error('旧面板规则来源无效');
    return {id,name:item.name.trim(),explicit:item.explicit,rules:validateRules(item.rules)};
   }).sort((a,b)=>compare(a.id,b.id));
   const expected=mergedPanels(panels).mappings;
   if(!Array.isArray(archive.mappings)||archive.mappings.length!==expected.length)throw Error('旧面板规则映射无效');
   const mappings=archive.mappings.map(item=>{plain(item,'旧面板规则映射');return {panelId:identifier(item.panelId,'旧面板编号'),ruleId:identifier(item.ruleId,'旧规则编号'),sharedRuleId:identifier(item.sharedRuleId,'共享规则编号')};});
   if(JSON.stringify(mappings)!==JSON.stringify(expected))throw Error('旧面板规则映射与原快照不一致');
   return {panels,mappings};
 }
 function key(state){
  if(state?.sharedScoreRules){const shared=validateShared(state.sharedScoreRules);return JSON.stringify({version:1,revision:shared.revision,rules:shared.rules});}
  return JSON.stringify({legacy:panelSnapshots(state)});
 }
 function previewShared(state){
  if(state.sharedScoreRules){const shared=validateShared(state.sharedScoreRules);return {required:false,shared:true,expectedKey:key(state),sharedRevision:shared.revision,panels:clone(shared.migration?.panels||[]),rules:shared.rules,conflicts:[],mappings:clone(shared.migration?.mappings||[])};}
  const panels=panelSnapshots(state),required=panels.some(panel=>!same(panel.rules,panels[0].rules));
  return {required,shared:false,expectedKey:key(state),panels,...mergedPanels(panels)};
 }
 function mirrorShared(state){
  const shared=validateShared(state.sharedScoreRules);state.sharedScoreRules=shared;state.version=2;
  for(const data of [state,...(state.panels?.others||[]).map(panel=>panel.data)]){
   data.settings={...data.settings,scoreRules:clone(shared.rules)};
   // Shared collections may exceed the legacy per-panel limit, so every
   // mirrored payload uses the current version and is validated in context.
   data.version=2;
   if(data!==state)delete data.sharedScoreRules;
  }
  return state;
 }
 function promoteShared(state){
  if(state.sharedScoreRules)return mirrorShared(state);
  const preview=previewShared(state);
  if(preview.required)throw Error('各面板原有计分卡片不同，请先预览并确认合并为共享卡片；原规则和历史尚未改变');
  state.sharedScoreRules={version:1,revision:0,rules:preview.rules,migration:{panels:preview.panels,mappings:preview.mappings}};
  return mirrorShared(state);
 }
 function confirmShared(state,expectedKey){
  const preview=previewShared(state);
  if(typeof expectedKey!=='string'||expectedKey!==preview.expectedKey)throw Error('面板或计分卡片已变化，请重新预览合并');
  if(preview.shared)throw Error('计分卡片已共享，请重新打开');
  state.sharedScoreRules={version:1,revision:0,rules:preview.rules,migration:{panels:preview.panels,mappings:preview.mappings}};
  return mirrorShared(state);
 }
 function setShared(state,rules,{migration}={}){
  const nextRules=validateSharedRules(rules),archive=migration===undefined?undefined:validateMigration(migration);promoteShared(state);
  if(archive){
   const archives=[...(state.sharedScoreRules.migrationHistory||[])];
   const archived=JSON.stringify(archive);
   if(JSON.stringify(state.sharedScoreRules.migration)!==archived&&!archives.some(item=>JSON.stringify(item)===archived)){
    if(archives.length>=100)throw Error('旧表格规则快照已达100次，请保留完整备份；本次未导入');
    archives.push(archive);
   }
   if(archives.length)state.sharedScoreRules.migrationHistory=archives;
  }
  if(state.sharedScoreRules.revision>=Number.MAX_SAFE_INTEGER-1)throw Error('共享计分卡片版本已达上限');
  state.sharedScoreRules={...state.sharedScoreRules,revision:state.sharedScoreRules.revision+1,rules:nextRules};
  return mirrorShared(state);
 }
 function flexibleDelta(value,direction){const raw=typeof value==='string'?value.trim():String(value);if(!/^[0-9]+$/.test(raw))throw Error('请输入1–100的正整数，系统按所选方向加减');const n=Number(raw);if(!Number.isInteger(n)||n<1||n>100||![1,-1].includes(direction))throw Error('请输入1–100的正整数，系统按所选方向加减');return n*direction;}
 return Object.freeze({defaults,MAX_SHARED_RULES,list,validateRules,validateSharedRules,same,effectiveGrowth,flexibleDelta,validateShared,key,previewShared,promoteShared,confirmShared,setShared,mirrorShared});
});
