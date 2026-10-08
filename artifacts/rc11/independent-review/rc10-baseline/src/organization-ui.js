(function(root,factory){const api=factory(root,typeof module==='object'&&module.exports?require('./organization-tools.js'):root.OrganizationTools);if(typeof module==='object'&&module.exports)module.exports=api;else root.OrganizationUI=api;})(globalThis,function(root,Tools){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const panelId=state=>state.panels?.activeId||'panel_default';
 let draft=null;
 function button(state){return `<button class="button" data-do="org-sort-open">成员排序 · ${esc(Tools.sorts[state.settings.studentSort||'natural'])}</button>`;}
 function orderRows(state){const byId=new Map(state.students.map(s=>[s.id,s]));return draft.order.map((id,index)=>{const s=byId.get(id);return `<li data-org-student="${esc(id)}"><span class="org-position">${index+1}</span><div><strong>${esc(s?.name||'已移除')}</strong><small>${esc(s?.group||'')} ${s?.leader?'· 组长':''}</small></div><button class="button" type="button" data-do="org-order-up" data-id="${esc(id)}" aria-label="上移${esc(s?.name)}" ${index===0?'disabled':''}>↑</button><button class="button" type="button" data-do="org-order-down" data-id="${esc(id)}" aria-label="下移${esc(s?.name)}" ${index===draft.order.length-1?'disabled':''}>↓</button></li>`;}).join('');}
 function sortDialog(state,modal){
  draft={panelId:panelId(state),expectedOrder:Tools.customOrder(state),order:Tools.customOrder(state)};
  modal(`<h2>成员排序</h2><p>选择卡片的展示顺序。同分时保留添加顺序；自定排序只调整显示，不改变学生档案和点名池。</p><form id="org-sort-form" data-panel-id="${draft.panelId}"><label>排序方式<select name="mode" id="org-sort-mode">${Object.entries(Tools.sorts).map(([value,label])=>`<option value="${value}" ${value===(state.settings.studentSort||'natural')?'selected':''}>${label}</option>`).join('')}</select></label><p class="muted">使用上下箭头可调整自定顺序，移动后自动选择“自定顺序”</p><ol class="org-sort-list">${orderRows(state)}</ol><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button primary">保存排序</button></div></form>`);
 }
 const clearLabels={scores:'学生普通积分归零',groupScores:'小组基础分归零',petGrowth:'当前宠物成长归零',history:'清理普通积分和小组操作记录',petHistory:'清理宠物成长操作记录'};
 function clearDialog(state,modal){
  modal(`<h2>选择当前面板清零范围</h2><p>当前面板：<strong>${esc(state.settings.className)}</strong> · ${state.students.length} 位同学。确认后先保存包含全部面板的完整保护备份。</p><form id="org-clear-form" data-panel-id="${panelId(state)}" data-revision="${state.revision}"><div class="org-clear-options">${Object.entries(clearLabels).map(([value,label])=>`<label><input type="checkbox" name="${value}" ${['scores','groupScores','history'].includes(value)?'checked':''}><span><strong>${label}</strong><small>${value==='scores'?'只将当前普通积分设为0':value==='groupScores'?'只将小组独立基础分设为0':value==='petGrowth'?'仅清当前未毕业周期；毕业相册和永久荣誉保留':value==='history'?'清理普通积分、兑换及小组加减记录；之后无法在记录中撤销':'仅清成长增减与清零记录；毕业、荣誉及徽章兑换账本保留'}</small></span></label>`).join('')}</div><p class="org-clear-note">默认延续普通积分清零规则：宠物成长和宠物成长记录保留。清成长但保留记录时，旧记录撤销若令原周期低于0会整笔拒绝，可先撤销清零。${state.settings.petRules?'':'本面板使用旧版成长；选择宠物成长归零会同时启用七级周期，六段门槛均采用本面板每级 '+state.settings.petStep+' 点，旧普通积分成长数值保留作账务记录。'}</p><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button danger">检查范围并继续</button></div></form>`);
 }
 async function handle(action,el,context){
  if(action==='org-sort-open'){sortDialog(context.state,context.modal);return true;}
  if(action==='clear-current-points'||action==='org-clear-open'){clearDialog(context.state,context.modal);return true;}
  if(!['org-order-up','org-order-down'].includes(action))return false;
  if(!draft||draft.panelId!==panelId(context.state)||!Tools.same(draft.expectedOrder,Tools.customOrder(context.state))){context.toast('学生名单或顺序已变化，请重新打开排序');return true;}
  const index=draft.order.indexOf(el?.dataset?.id),next=index+(action==='org-order-up'?-1:1);if(index<0||next<0||next>=draft.order.length)return true;
  [draft.order[index],draft.order[next]]=[draft.order[next],draft.order[index]];
  const list=root.document?.querySelector('.org-sort-list');if(list)list.innerHTML=orderRows(context.state);
  const select=root.document?.getElementById('org-sort-mode');if(select)select.value='custom';return true;
 }
 const handlesForm=id=>['org-sort-form','org-clear-form'].includes(id);
 async function submit(event,context){
  const form=event.target;if(!handlesForm(form.id))return false;event.preventDefault();if(form.dataset.saving)return true;
  const {state,act,toast,closeModal,confirmDialog}=context;
  if(form.dataset.panelId!==panelId(state)){toast('面板已切换，请重新打开');return true;}
  if(form.id==='org-clear-form'){
   const options=Object.fromEntries(Object.keys(clearLabels).map(key=>[key,!!form.querySelector(`[name="${key}"]`)?.checked]));
   if(!Object.values(options).some(Boolean)){toast('请至少选择一个清零项目');return true;}
   const revision=Number(form.dataset.revision);if(revision!==state.revision){toast('数据已更新，请重新查看清零范围');return true;}
   const selected=Object.keys(options).filter(key=>options[key]).map(key=>clearLabels[key]);
   confirmDialog('确认执行所选清零项目？',`「${state.settings.className}」：${selected.join('；')}。名单和照片保留；操作前保存完整保护备份。`,()=>act({type:'points.clear',options,expectedRevision:revision,confirmed:true,panelId:form.dataset.panelId},'所选清零项目已完成，完整保护备份已保存'),{delaySeconds:7});return true;
  }
  if(!draft||draft.panelId!==panelId(state)){toast('排序窗口已失效，请重新打开');return true;}
  const mode=form.querySelector('[name="mode"]').value,current=draft;
  form.dataset.saving='1';try{const action=mode==='custom'?{type:'students.order',order:[...draft.order],expectedOrder:[...draft.expectedOrder]}:{type:'students.sort',mode};if(await act({...action,panelId:current.panelId},'成员显示顺序已保存')){if(form.isConnected&&draft===current){draft=null;closeModal();}}else form.dataset.saving='';}catch(error){form.dataset.saving='';toast(error.message);}return true;
 }
 return Object.freeze({button,handle,handlesForm,submit,clearLabels});
});
