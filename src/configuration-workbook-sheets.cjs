'use strict';
const Config = require('./configuration-model.js');
const {randomUUID} = require('node:crypto');
const {DEFAULT_CONFIG} = require('./portable-config.cjs');
const SHEETS = Object.freeze({
  '启动显示': ['参数','值','说明'],
  '面板设置': ['面板ID','面板名称','显示头像','快捷分值','成员排序','隐藏后两级'],
  '轮盘奖品': ['面板ID','奖品ID','奖品名称','积分价格'],
  '趣味挑战': ['面板ID','挑战内容'],
  '课堂网址': ['面板ID','网址ID','网址名称','网页地址'],
  '作业科目': ['面板ID','科目名称'],
  '工具默认': ['面板ID','计时响铃','计时默认秒数','点名默认对象','点名默认策略','点名默认数量','宠物默认对象','宠物默认策略','宠物默认数量','挑战默认秒数']
});
const APP_LABELS = {initialZoom:'初始界面缩放（0.5–2；下次重启生效）',windowWidth:'主窗口初始宽度（900–3840像素；下次重启生效）',windowHeight:'主窗口初始高度（640–2160像素；下次重启生效）',startMinimized:'启动后最小化（true/false；下次重启生效）'};
const TOOL_KEYS=['timerDurationSeconds','drawScope','drawMode','drawCount','petDrawScope','petDrawMode','petDrawCount','bombSeconds'];
const clone=value=>JSON.parse(JSON.stringify(value));
const PANEL_CHOICE='所属面板', PANEL_MAPPING='面板选项（自动）', PANEL_RANGE='FlowerPanelChoices';
function panelChoices(panels){return panels.map((panel,index)=>({id:panel.id,label:`${panel.name}（面板${index+1}）`}));}
function createPanelResolver(workbook,panels,{tableRows,findPanel}){
  const labels=new Map(),settings=workbook.getWorksheet('面板设置');
  if(settings?.getRow(1).values.includes(PANEL_MAPPING)){
    const seen=new Set();
    for(const {index,get} of tableRows(settings,SHEETS['面板设置'],[PANEL_MAPPING])){
      const panel=findPanel(get('面板ID'),index),label=get(PANEL_MAPPING);
      if(typeof label!=='string'||!label.trim()||labels.has(label)||seen.has(panel.id))throw Error('面板设置的自动面板选项缺失或重复，请保留隐藏列；新增面板请在软件内创建');
      labels.set(label,panel);seen.add(panel.id);
    }
    if(seen.size!==panels.length)throw Error('面板设置须包含每个现有面板；新增面板请在软件内创建');
  }
  return (id,index,choice='')=>{
    if(choice===''){
      if(id==='')throw Error(`第${index}行请选择「所属面板」；新增面板请在软件内创建，无需填写编号`);
      return findPanel(id,index);
    }
    let selected=labels.get(choice);
    if(!selected){
      const matching=panels.filter(panel=>panel.name===choice);
      if(matching.length>1)throw Error(`第${index}行「所属面板」名称重复，请从下拉列表选择带序号的完整面板名称`);
      if(matching.length===1)selected=matching[0];
    }
    if(!selected)throw Error(`第${index}行「所属面板」不存在，请从下拉列表选择；新增面板请在软件内创建`);
    if(id!==''&&findPanel(id,index).id!==selected.id)throw Error(`第${index}行「所属面板」与该行保存的面板不一致，请恢复原选择；新增条目请另起空白行并选择面板`);
    return selected;
  };
}
function addSheets(workbook,state,formatSheet){
  const snapshot=Config.snapshot(state),labels=new Map(panelChoices(snapshot.panels).map(item=>[item.id,item.label]));
  for(const [name,baseHeaders] of Object.entries(SHEETS)){
    const headers=[...baseHeaders,...(name==='启动显示'?[]:[name==='面板设置'?PANEL_MAPPING:PANEL_CHOICE])];
    const sheet=workbook.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});
    sheet.columns=headers.map((header,index)=>({header,width:name==='启动显示'?[28,20,76][index]:header==='网页地址'?70:header==='挑战内容'?70:header==='奖品名称'?32:[PANEL_CHOICE,PANEL_MAPPING,'面板名称'].includes(header)?34:22,hidden:header.endsWith('ID')||header===PANEL_MAPPING}));
    if(name==='启动显示')for(const key of Object.keys(DEFAULT_CONFIG))sheet.addRow([key,typeof snapshot.appConfig[key]==='boolean'?String(snapshot.appConfig[key]):snapshot.appConfig[key],APP_LABELS[key]]);
    else for(const p of snapshot.panels){
      const label=labels.get(p.id);
      if(name==='面板设置')sheet.addRow([p.id,p.name,String(p.showAvatars),p.scoreStep,p.studentSort,String(p.hideLateForms),label]);
      if(name==='轮盘奖品')for(const v of p.wheelPrizes)sheet.addRow([p.id,v.id,v.name,v.cost,label]);
      if(name==='趣味挑战')for(const v of p.challengeOptions)sheet.addRow([p.id,v,label]);
      if(name==='课堂网址'){
        if(!p.links.length)sheet.addRow([p.id,'（空）','（空）',null,label]);
        for(const v of p.links)sheet.addRow([p.id,v.id,v.title,v.url,label]);
      }
      if(name==='作业科目')for(const v of p.subjects)sheet.addRow([p.id,v,label]);
      if(name==='工具默认')sheet.addRow([p.id,p.timerSound,...TOOL_KEYS.map(key=>p.toolDefaults[key]),label]);
    }
    formatSheet(sheet);sheet.autoFilter={from:'A1',to:sheet.getRow(1).getCell(headers.length).address};
    const choices=(cell,values)=>{cell.dataValidation={type:'list',allowBlank:false,formulae:['"'+values.join(',')+'"'],showErrorMessage:true,errorTitle:'请选择有效配置',error:'请从下拉列表选择，或参阅填写说明'};};
    if(name!=='启动显示'&&name!=='面板设置'){
      const letter=sheet.getColumn(headers.length).letter;
      sheet.dataValidations.add(`${letter}2:${letter}5000`,{type:'list',allowBlank:false,formulae:[PANEL_RANGE],showErrorMessage:true,errorTitle:'请选择所属面板',error:'请选择带序号的面板名称；新增面板请在软件内创建'});
    }
    sheet.eachRow((row,index)=>{if(index>1){if(name==='启动显示'&&row.getCell(1).value==='startMinimized')choices(row.getCell(2),['true','false']);if(name==='面板设置'){choices(row.getCell(3),['true','false']);choices(row.getCell(6),['true','false']);choices(row.getCell(5),['natural','name','scoreDesc','scoreAsc','growth','level','leader','custom']);}if(name==='工具默认'){choices(row.getCell(2),['tick','applause','laser']);for(const col of [4,7])choices(row.getCell(col),['students','groups']);for(const col of [5,8])choices(row.getCell(col),['cycle','repeat']);}}});
    sheet.eachRow((row,index)=>{if(index>1)row.eachCell(cell=>{if(typeof cell.value==='number')cell.numFmt=Number.isInteger(cell.value)?'0':'0.###############';else if(typeof cell.value==='string')cell.numFmt='@';if(cell.col>1||name==='启动显示')cell.font={color:{argb:'FF1D4ED8'}};});});
  }
  workbook.definedNames.add(`'面板设置'!$G$2:$G$${snapshot.panels.length+1}`,PANEL_RANGE);
}
function numeric(value,label){const result=typeof value==='number'?value:typeof value==='string'&&/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())?Number(value.trim()):NaN;if(!Number.isFinite(result))throw Error(`${label}必须为数字`);return result;}
function boolean(value,label){if(value===true||value==='true'||value==='是')return true;if(value===false||value==='false'||value==='否')return false;throw Error(`${label}必须为true/false或是/否`);}
function parseSheets(workbook,state,{tableRows,findPanel,legacyInput=false,initialPanelId,initialPanelName}={}){
  const prior=Config.snapshot(state),incoming=clone(prior),byId=new Map(incoming.panels.map(p=>[p.id,p]));
  const missing=Object.keys(SHEETS).filter(name=>!workbook.getWorksheet(name));
  if(missing.length&&!legacyInput)throw Error(`配置.xlsx缺少工作表「${missing.join('、')}」，请保留全部配置工作表；未应用任何设置`);
  for(const [name,headers] of Object.entries(SHEETS)){
    const sheet=workbook.getWorksheet(name);if(!sheet)continue;
    const rows=tableRows(sheet,headers,name==='启动显示'?[]:[name==='面板设置'?PANEL_MAPPING:PANEL_CHOICE]),seen=new Set();
    if(name==='启动显示'){
      for(const {index,get} of rows){const key=get('参数');if(!Object.hasOwn(DEFAULT_CONFIG,key)||seen.has(key))throw Error(`启动显示第${index}行参数未知或重复`);seen.add(key);incoming.appConfig[key]=key==='startMinimized'?boolean(get('值'),key):numeric(get('值'),key);}
      if(seen.size!==Object.keys(DEFAULT_CONFIG).length)throw Error('启动显示必须完整保留四项参数');
      continue;
    }
    const lists={'轮盘奖品':'wheelPrizes','趣味挑战':'challengeOptions','课堂网址':'links','作业科目':'subjects'},field=lists[name],empties=new Set();
    if(field)for(const p of incoming.panels)p[field]=[];
    for(const {index,get} of rows){
      const resolved=findPanel(get('面板ID'),index,name==='面板设置'?'':get(PANEL_CHOICE)),id=resolved.id,p=byId.get(id);
      if(!field&&seen.has(id))throw Error(`「${name}」第${index}行面板ID重复`);seen.add(id);
      if(name==='面板设置')Object.assign(p,{name:get('面板ID')===initialPanelId&&get('面板名称')===initialPanelName?resolved.name:get('面板名称'),showAvatars:boolean(get('显示头像'),'显示头像'),scoreStep:numeric(get('快捷分值'),'快捷分值'),studentSort:get('成员排序'),hideLateForms:boolean(get('隐藏后两级'),'隐藏后两级')});
      if(name==='轮盘奖品')p.wheelPrizes.push({id:get('奖品ID'),name:get('奖品名称'),cost:numeric(get('积分价格'),'积分价格')});
      if(name==='趣味挑战')p.challengeOptions.push(get('挑战内容'));
      if(name==='课堂网址'){
        const empty=get('网址ID')==='（空）'||(get('网址ID')===''&&get('网址名称')==='（空）');
        if(empty){if(!['','（空）'].includes(get('网址名称'))||get('网页地址')!==''||empties.has(id)||p.links.length)throw Error('空网址面板仅保留一行名称为「（空）」且地址留空');empties.add(id);}
        else {if(empties.has(id))throw Error('新增网址时请删除该面板的「（空）」行，再重新预览');p.links.push({id:get('网址ID'),title:get('网址名称'),url:get('网页地址')});}
      }
      if(name==='作业科目')p.subjects.push(get('科目名称'));
      if(name==='工具默认'){p.timerSound=get('计时响铃');for(let i=0;i<TOOL_KEYS.length;i++){const key=TOOL_KEYS[i],value=get(headers[i+2]);p.toolDefaults[key]=/Scope|Mode/.test(key)?value:numeric(value,headers[i+2]);}}
    }
    if(seen.size!==incoming.panels.length)throw Error(`「${name}」须包含每个现有面板；空网址请使用明确的「（空）」行`);
    if(['wheelPrizes','links'].includes(field))for(const p of incoming.panels){
      Config.assignNewIds(p[field],prior.panels.find(item=>item.id===p.id)[field],{label:`${name}「${p.name}」`,prefix:field==='links'?'link_':'prize_',createId:randomUUID});
    }
  }
  // Validate through the same model used by application edits before exposing
  // any preview. Work remains on a detached clone, including toolbox revisions.
  Config.apply(clone(state),incoming);
  return {snapshot:incoming,missing};
}
function summary(before,after,{includeNewPanels=false}={}){
  const result=[],add=(sheet,scope,changes,panel)=>{if(changes.length)result.push({sheet,title:sheet,scope:scope==='application'?'全局':'当前面板',...(panel?{panelId:panel.id,panelName:panel.name}:{}),changes});};
  const change=(key,label,a,b,effect)=>JSON.stringify(a)===JSON.stringify(b)?null:{key,label,before:clone(a),after:clone(b),...(effect?{effect}:{})};
  add('启动显示','application',Object.keys(DEFAULT_CONFIG).map(key=>change(key,APP_LABELS[key],before.appConfig[key],after.appConfig[key],'下次重启生效')).filter(Boolean));
  add('宠物进阶','application',[
    change('costs','LV1–LV7逐级所需积分',before.petProgression.costs,after.petProgression.costs,'所有面板按当前积分立即重新显示等级'),
    change('repeatCost','LV8及以后每级所需积分',before.petProgression.repeatCost,after.petProgression.repeatCost,'所有面板按当前积分立即重新显示等级')
  ].filter(Boolean));
  for(const p of after.panels){const old=before.panels.find(v=>v.id===p.id);if(!old&&!includeNewPanels)continue;
    add('面板设置','panel',[['name','面板名称'],['showAvatars','显示头像'],['scoreStep','快捷分值'],['studentSort','成员排序'],['hideLateForms','隐藏后两级']].map(([key,label])=>change(key,label,old?old[key]:'当前没有此面板',p[key],'应用后生效')).filter(Boolean),p);
    add('工具默认','panel',[change('timerSound','计时响铃',old?old.timerSound:'当前没有此面板',p.timerSound,'以后响铃使用'),...TOOL_KEYS.map(key=>change(key,SHEETS['工具默认'][TOOL_KEYS.indexOf(key)+2],old?old.toolDefaults[key]:'当前没有此面板',p.toolDefaults[key],'未来打开或新一轮使用'))].filter(Boolean),p);
    for(const [key,label] of [['wheelPrizes','轮盘奖品'],['challengeOptions','趣味挑战'],['links','课堂网址'],['subjects','作业科目']]){const display=values=>values.map(value=>key==='wheelPrizes'?`${value.name}（${value.cost}积分）`:key==='links'?`${value.title}：${value.url}`:value);add(label,'panel',[change(key,label,old?display(old[key]):'当前没有此面板',display(p[key]),'应用后生效')].filter(Boolean),p);}
  }
  return result;
}
module.exports={SHEETS,TOOL_KEYS,PANEL_CHOICE,PANEL_MAPPING,panelChoices,createPanelResolver,addSheets,parseSheets,summary};
