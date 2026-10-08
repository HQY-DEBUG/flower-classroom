/* Independent classroom panels. Existing classroom data remains the default panel. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.PanelTools=api;})(globalThis,function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const currentId=s=>s.panels?.activeId||'panel_default';
 const list=s=>[{id:currentId(s),name:s.settings.className,count:s.students.length},...(s.panels?.others||[]).map(p=>({id:p.id,name:p.data.settings.className,count:p.data.students.length}))];
 function view(state,compact=false){
  const items=list(state);
  return `<section class="panel-switcher ${compact?'panel-compact':''}"><div class="panel-current"><label for="panel-select">当前面板<select id="panel-select" aria-label="切换课堂面板">${items.map(p=>`<option value="${p.id}" ${p.id===currentId(state)?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><button type="button" class="button classroom-tools-launcher" id="classroom-tools-button" data-do="panel-toggle" aria-haspopup="dialog">课堂工具</button></div></section>`;
 }
 function toolsDialog(state,modal,role='main'){
  const groups=[
   {name:'课堂互动',items:[...(role==='main'?[['tools-pets','宠物花园','查看伙伴与成长','♧']]:[]),['open-draw','随机点名','抽学生或小组','✦'],['open-timer','课堂计时','打开独立计时器','◷'],['cw-prize','幸运大转盘','抽奖与奖品兑换','◎'],['cw-challenge','惩罚转盘','抽取课堂挑战','◇'],['cw-toolbox','百宝箱','投票、签到与作业','▦']]},
   {name:'悬浮与展示',items:[['open-flower','悬浮红花','桌面快捷入口','✿'],['open-sidebar','课堂侧栏','打开课堂快捷栏','◧'],['open-pet','悬浮宠物','伴随课堂的成长伙伴','♧'],['open-pets','宠物课堂展示','集中展示全班伙伴','▣']]},
   {name:'班级与学生',items:[['panel-create','创建新面板','空白、名单或完整副本','＋'],['panel-manage','管理面板','切换、改名与管理','▤'],...(role==='main'?[['tools-import','导入名单','导入 Excel 或 CSV','↥'],['bulk-add','批量添加学生','粘贴姓名和小组名单','＋'],['bulk-group','调整所选学生分组','只修改已选学生的小组','⌘']]:[]),['gt-manage','批量分组 / 组序','分配成员与调整组序','⌘'],['org-sort-open','成员排序','设置伙伴展示顺序','↕'],['batch-photos','批量导入头像','按学生姓名匹配照片','▧'],['toggle-avatars',state.settings.showAvatars===false?'显示头像':'隐藏头像','切换当前面板头像显示','◉']]},
   {name:'积分与数据',items:[['score-step','分值步进','设置快捷加减分值','±'],['show-reasons','规则原因','查看课堂积分规则','≡'],['excel-summary','Excel 汇总','导出当前面板汇总','▥'],['backup','导出完整备份','保存全部面板数据','↓'],['restore','恢复备份','从完整备份中恢复','↺']]},
   {name:'清理当前面板',danger:true,items:[['clear-current-points','全部清零','选择积分与成长清零范围','↻'],['clear-current-panel','清空当前面板','清空前确认并保存保护备份','−']]}
  ];
  modal(`<div class="classroom-tools-palette"><h2>课堂工具</h2><p class="classroom-tools-context">${esc(state.settings.className)}<span>·</span>${state.students.length} 位伙伴</p>${groups.map((group,index)=>`<section class="classroom-tool-group ${group.danger?'classroom-tool-group-danger':''}" aria-labelledby="classroom-tool-group-${index}"><h3 id="classroom-tool-group-${index}">${group.name}</h3><div class="classroom-tool-grid">${group.items.map(([action,label,description,icon])=>`<button type="button" class="classroom-tool-entry" data-tool-entry="true" data-do="${action}"${action==='toggle-avatars'?` aria-pressed="${state.settings.showAvatars!==false}"`:''}><span class="classroom-tool-icon" aria-hidden="true">${icon}</span><span class="classroom-tool-copy"><strong>${label}</strong><small>${description}</small></span></button>`).join('')}</div></section>`).join('')}</div>`);
 }
 function createDialog(state,modal){
  modal(`<h2>创建新面板</h2><p>为另一门课程或新一周单独记分，现有面板会完整保留</p><form id="panel-create-form" data-panel-id="${currentId(state)}"><div class="panel-modes"><label><input type="radio" name="mode" value="blank" checked><strong>空的新面板</strong><span>从空名单开始</span></label><label><input type="radio" name="mode" value="copy"><strong>复制当前名单的面板</strong><span>复制姓名和分组，重新开始记分</span></label><label><input type="radio" name="mode" value="full"><strong>复制完整状态的面板</strong><span>连同头像、积分、成长、记录和设置一起复制</span></label></div><label>面板名称<input name="name" maxlength="80" required value="新的课堂面板"></label><p class="panel-copy-note">默认“名单副本”只复制姓名和分组：积分、成长、记录归零，照片恢复默认。选择“完整状态副本”会复制当前面板所有档案、宠物周期、荣誉、工具状态和记录，分配独立编号，可单独撤销；两种复制均保留原面板。其他面板不重复复制</p><div class="dialog-actions"><button class="button" type="button" data-do="modal-close">取消</button><button class="button primary" type="submit">创建面板</button></div></form>`);
 }
 function manageDialog(state,modal){
  const items=list(state);
  modal(`<h2>面板管理</h2><p>当前共 ${items.length} 个面板；每个面板分别保存名单、照片、积分和成长</p><div class="panel-manage-list">${items.map(p=>`<div><strong>${esc(p.name)}</strong><small>${p.count} 位学生${p.id===currentId(state)?' · 当前面板':''}</small>${p.id===currentId(state)?'':`<button class="button" data-do="panel-switch" data-id="${p.id}">切换</button>`}</div>`).join('')}</div><form id="panel-rename-form" data-panel-id="${currentId(state)}"><label>修改当前面板标题<input name="name" maxlength="80" required value="${esc(state.settings.className)}"></label><div class="dialog-actions"><button class="button danger" type="button" data-do="panel-delete" ${items.length<2?'disabled':''}>删除当前面板</button><button class="button primary" type="submit">保存标题</button></div></form><small>删除前自动保存完整保护备份。最后一个面板不能删除</small>`);
 }
 async function handle(action,el,{state,act,toast,modal,confirmDialog,closeModal,api,render,acceptState,role='main'}){
  if(action==='panel-toggle'){toolsDialog(state,modal,role);return true;}
  if(action==='panel-create'){createDialog(state,modal);return true;}
  if(action==='panel-manage'){manageDialog(state,modal);return true;}
  if(action==='panel-switch'){const id=el.dataset.id;closeModal();await act({type:'panel.switch',id});return true;}
  if(action==='panel-delete'){confirmDialog('删除当前面板？',`将删除「${state.settings.className}」的名单、照片、积分与记录。其他面板保留；操作前保存完整保护备份。`,()=>act({type:'panel.remove',panelId:currentId(state),expectedRevision:state.revision},'当前面板已删除，已切换到保留面板'));return true;}
  if(action==='clear-current-panel'){confirmDialog('清空当前面板？',`将移除「${state.settings.className}」全部学生、照片、积分、成长和记录，保留面板标题和其他面板。操作前先保存完整保护备份。`,()=>act({type:'panel.clear',panelId:currentId(state),expectedRevision:state.revision},'当前面板已清空'));return true;}
  if(action==='clear-current-points')return root.OrganizationUI.handle(action,el,{state,act,toast,modal,confirmDialog,closeModal,api,render,acceptState});
  if(action==='toggle-avatars'){await act({type:'photos.visibility',value:state.settings.showAvatars===false});return true;}
  if(action==='batch-photos'){
   if(el?.dataset.busy)return true;if(el)el.dataset.busy='1';
   const openedDialog=root.document?.querySelector('#modal .dialog');
   try{
    const result=await api.file({command:'photos-batch',panelId:currentId(state)});
    if(!result)return true;
    if(root.document?.querySelector('#modal .dialog')!==openedDialog||root.document?.querySelector('#panel-select')?.value!==currentId(state))return true;
    const {counts,results}=result;
    modal(`<h2>头像处理完成</h2><div class="photo-result-counts"><div><strong>${counts.success}</strong><span>成功</span></div><div><strong>${counts.failed}</strong><span>失败</span></div><div><strong>${counts.skipped}</strong><span>跳过</span></div></div><p>按文件名与学生姓名精确匹配，照片只在本机保存</p><div class="photo-result-list">${results.filter(r=>r.status!=='success').map(r=>`<div><strong>${esc(r.file||r.name)}</strong><span>${esc(r.reason)}</span></div>`).join('')||'<p>所有匹配头像均已更新</p>'}</div><div class="dialog-actions"><button class="button primary" data-do="modal-close">好的</button></div>`);
   }finally{if(el)delete el.dataset.busy;}
   return true;
  }
  return false;
 }
 return Object.freeze({view,handle,currentId,list});
});
