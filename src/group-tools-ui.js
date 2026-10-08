(function(root){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const $=selector=>root.document.querySelector(selector),model=root.GroupTools,pid=state=>state.panels?.activeId||'panel_default';
 const formIds=new Set(['gt-create-form','gt-order-form','bulk-group-form']);
 let draft=null,busy=false,sequence=0;
 const handles=action=>action==='bulk-group'||action.startsWith('gt-');
 const handlesForm=id=>formIds.has(id);
 const rosterSignature=state=>JSON.stringify(state.students.map(s=>[s.id,s.group]));
 const visible=()=>draft&&$('#modal [data-gt-token]')?.dataset.gtToken===String(draft.token);
 const header=()=>`<div class="gt-content" data-gt-token="${draft.token}"><p class="gt-stale" role="alert" hidden>课堂小组已变化，请刷新后重新操作 <button type="button" class="text-button" data-do="gt-refresh">刷新窗口</button></p>`;
 function show(context,html){context.modal(html);$('#modal .dialog')?.classList.add('gt-dialog');}
 function begin(state,kind){draft={kind,token:++sequence,panelId:pid(state),stale:false,expectedOrder:model.names(state),roster:rosterSignature(state)};}
 function manage(context){
  const {state}=context;begin(state,'manage');const groups=model.orderedGroups(state);
  show(context,`${header()}<h2>批量分组</h2><p>创建小组、调整展示顺序，或手工分配学生</p><div class="gt-toolbar"><button type="button" class="button primary" data-do="gt-create">＋ 添加新小组</button><button type="button" class="button" data-do="gt-order" ${groups.length<2?'disabled':''}>小组排序</button><button type="button" class="button" data-do="gt-assign" ${!state.students.length?'disabled':''}>批量分配学生</button></div><div class="gt-summary">${groups.map(group=>`<article><strong>${esc(group.name)}</strong><span>${group.students.length} 位学生</span><small>成员 ${group.memberTotal} 分 · 基础 ${group.base} 分</small></article>`).join('')||'<p class="gt-empty">暂无小组，点击“添加新小组”开始</p>'}</div></div>`);
 }
 function create(context){
  begin(context.state,'create');
  show(context,`${header()}<h2>添加新小组</h2><p>先创建空小组，再分配学生</p><form id="gt-create-form"><label>小组名称<input name="group" maxlength="40" required autocomplete="off" placeholder="例如：向日葵组"></label><div class="dialog-actions"><button type="button" class="button" data-do="gt-manage">返回</button><button type="submit" class="button primary">创建小组</button></div></form></div>`);
 }
 function orderRows(){
  return draft.order.map((name,index)=>`<li class="gt-order-row" data-gt-index="${index}"><span class="gt-position">${index+1}</span><strong>${esc(name)}</strong><div class="gt-arrows"><button type="button" class="button" data-do="gt-left" data-index="${index}" aria-label="${esc(name)}向左移动" ${index===0?'disabled':''}>←</button><button type="button" class="button" data-do="gt-right" data-index="${index}" aria-label="${esc(name)}向右移动" ${index===draft.order.length-1?'disabled':''}>→</button></div></li>`).join('');
 }
 function order(context){
  begin(context.state,'order');draft.order=[...draft.expectedOrder];
  show(context,`${header()}<h2>小组排序</h2><p>用左右箭头调整小组展示顺序，再保存。换行后按从左到右、从上到下排列</p><form id="gt-order-form"><ol class="gt-order-list">${orderRows()}</ol><p class="gt-announcement" aria-live="polite">共 ${draft.order.length} 个小组，可用 Tab 选择箭头，按回车移动</p><div class="dialog-actions"><button type="button" class="button" data-do="gt-manage">返回</button><button type="submit" class="button primary">保存顺序</button></div></form></div>`);
  $('#gt-order-form').addEventListener('keydown',event=>{
   if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
   const row=event.target.closest('[data-gt-index]');if(!row)return;
   event.preventDefault();row.querySelector(`[data-do="gt-${event.key==='ArrowLeft'?'left':'right'}"]`)?.click();
  });
 }
 function selectionStatus(){
  const form=$('#bulk-group-form');if(!form||!visible())return;
  const count=form.querySelectorAll('[name=student]:checked').length;
  const label=form.querySelector('.gt-selected-count');if(label)label.textContent=`已选择 ${count} / ${draft.students.length} 位学生`;
  let valid=!!form.elements.group?.value,error='';
  if(draft.createTarget){
   const input=form.elements.newGroup;
   try{const name=model.groupName(input.value);if(draft.expectedOrder.includes(name))throw Error('已存在同名小组，请选择已有小组或换一个名称');valid=true;}
   catch(issue){valid=false;if(input.value)error=issue.message;}
   input.setAttribute('aria-invalid',String(!!error));
  }
  const warning=form.querySelector('.gt-name-error');if(warning){warning.textContent=error;warning.hidden=!error;}
  const submit=form.querySelector('[type=submit]');if(submit){submit.disabled=busy||draft.stale||!count||!valid;submit.textContent=draft.createTarget?'创建并分配':'保存分组';}
 }
 function targetMode(createTarget){
  const form=$('#bulk-group-form');draft.createTarget=createTarget;
  const existing=form.querySelector('.gt-existing-target'),fresh=form.querySelector('.gt-new-target'),toggle=form.querySelector('[data-do=gt-new-target]');
  existing.hidden=createTarget;fresh.hidden=!createTarget;
  form.elements.group.disabled=createTarget||!draft.expectedOrder.length;form.elements.group.required=!createTarget;
  form.elements.newGroup.disabled=!createTarget;form.elements.newGroup.required=createTarget;
  toggle.setAttribute('aria-expanded',String(createTarget));toggle.textContent=createTarget?'选择已有小组':'＋ 新建小组';
  selectionStatus();(createTarget?form.elements.newGroup:form.elements.group).focus();
 }
 function assign(context){
  const {state,selected}=context;begin(state,'assign');draft.students=state.students.map(s=>({id:s.id,name:s.name,group:s.group,score:s.score,leader:s.leader===true}));
  const chosen=new Set(selected||[]),groups=model.names(state);
  show(context,`${header()}<h2>批量分配学生</h2><p>选择已有小组或直接新建，再勾选学生。保存后个人积分、成长和组长标记随学生保留</p><form id="bulk-group-form" data-panel-id="${draft.panelId}"><div class="gt-target-tools"><label class="gt-existing-target">目标小组<select name="group" required ${!groups.length?'disabled':''}>${groups.length?'<option value="">请选择目标小组</option>':'<option value="">暂无小组，可直接新建</option>'}${groups.map(group=>`<option value="${esc(group)}">${esc(group)}</option>`).join('')}</select></label><button type="button" class="button" data-do="gt-new-target" aria-expanded="false" aria-controls="gt-new-target">＋ 新建小组</button></div><div class="gt-new-target" id="gt-new-target" hidden><label>新小组名称<input name="newGroup" maxlength="40" autocomplete="off" placeholder="例如：向日葵组" aria-describedby="gt-new-help gt-name-error" disabled></label><p id="gt-new-help" class="gt-target-help">点击“创建并分配”后，新小组和学生分配一起保存；取消不会创建小组</p></div><p id="gt-name-error" class="gt-name-error" role="status" aria-live="polite" hidden></p><div class="gt-selection-tools"><button type="button" class="button" data-do="gt-select-all" ${!draft.students.length?'disabled':''}>全选</button><button type="button" class="button" data-do="gt-select-none" ${!draft.students.length?'disabled':''}>取消全选</button><span class="gt-selected-count" aria-live="polite"></span></div><div class="gt-student-list">${draft.students.map(student=>`<label class="gt-student-choice"><input type="checkbox" name="student" value="${esc(student.id)}" ${chosen.has(student.id)?'checked':''}><span><strong>${esc(student.name)}${student.leader?'<em>组长</em>':''}</strong><small>${esc(student.group)}</small></span><b>${student.score} 分</b></label>`).join('')||'<p class="gt-empty">暂无学生，可先在学生积分页添加名单</p>'}</div><div class="dialog-actions"><button type="button" class="button" data-do="gt-manage">返回</button><button type="submit" class="button primary" disabled>保存分组</button></div></form></div>`);
  $('#bulk-group-form').addEventListener('change',selectionStatus);$('#bulk-group-form').addEventListener('input',selectionStatus);selectionStatus();
 }
 function sync(state){
  if(!visible()||busy)return;
  if(draft.kind==='assign'&&pid(state)===draft.panelId){
   const current=new Map(state.students.map(student=>[student.id,student]));
   $('#bulk-group-form')?.querySelectorAll('.gt-student-choice').forEach(row=>{
    const student=current.get(row.querySelector('[name=student]')?.value);if(!student)return;
    row.querySelector('b').textContent=`${student.score} 分`;
    row.querySelector('strong').innerHTML=`${esc(student.name)}${student.leader?'<em>组长</em>':''}`;
   });
  }
  let changed=pid(state)!==draft.panelId;
  if(draft.kind==='order')changed ||=JSON.stringify(model.names(state))!==JSON.stringify(draft.expectedOrder);
  if(draft.kind==='assign')changed ||=rosterSignature(state)!==draft.roster||JSON.stringify(model.names(state))!==JSON.stringify(draft.expectedOrder);
  if(!changed)return;
  draft.stale=true;const warning=$('#modal .gt-stale');if(warning)warning.hidden=false;
  $('#modal [type=submit]')?.setAttribute('disabled','');
  if(draft.kind==='order')$('#gt-order-form')?.querySelectorAll('[data-do=gt-left],[data-do=gt-right]').forEach(button=>button.disabled=true);
 }
 function assertDraft(state,kind){
  if(!visible()||!draft||draft.panelId!==pid(state)||kind&&draft.kind!==kind)throw Error('操作窗口已变化，请重新打开');
  sync(state);if(draft.stale)throw Error('课堂小组已变化，请刷新后重新操作');
 }
 async function handle(action,element,context){
  if(!handles(action))return false;if(busy)return true;
  try{
   if(action==='gt-manage'){manage(context);return true;}
   if(action==='bulk-group'||action==='gt-assign'){assign(context);return true;}
   if(action==='gt-create'){create(context);return true;}
   if(action==='gt-order'){order(context);return true;}
   if(action==='gt-refresh'){
    const kind=visible()?draft.kind:'manage';({manage,create,order,assign}[kind]||manage)(context);return true;
   }
   assertDraft(context.state);
   if(action==='gt-new-target'){
    assertDraft(context.state,'assign');targetMode(!draft.createTarget);return true;
   }
   if(action==='gt-select-all'||action==='gt-select-none'){
    assertDraft(context.state,'assign');$('#bulk-group-form').querySelectorAll('[name=student]').forEach(input=>input.checked=action==='gt-select-all');selectionStatus();return true;
   }
   if(action==='gt-left'||action==='gt-right'){
    assertDraft(context.state,'order');const index=Number(element.dataset.index),direction=action==='gt-left'?-1:1,name=draft.order[index];
    draft.order=model.move(draft.order,index,direction);$('#modal .gt-order-list').innerHTML=orderRows();
    const at=draft.order.indexOf(name),row=$(`#modal [data-gt-index="${at}"]`);
    (row?.querySelector(`[data-do="${action}"]:not(:disabled)`)||row?.querySelector('button:not(:disabled)'))?.focus();
    $('#modal .gt-announcement').textContent=`${name}已移到第 ${at+1} 位，保存后生效`;
   }
  }catch(error){context.toast(error.message);}
  return true;
 }
 async function submit(event,context){
  const form=event.target;if(!handlesForm(form.id))return false;
  event.preventDefault();if(busy||form.dataset.saving)return true;
  let controls=[];
  try{
   assertDraft(context.state);const data=new FormData(form);let action,message;
   if(form.id==='gt-create-form'){
    assertDraft(context.state,'create');const patch=model.createGroupPatch(context.state,data.get('group'));
    action={type:'group.create',group:patch.group,panelId:draft.panelId};message='新小组已创建，可以分配学生';
   }else if(form.id==='gt-order-form'){
    assertDraft(context.state,'order');const patch=model.orderPatch(context.state,draft.order,draft.expectedOrder);
    action={type:'group.order',order:patch.groupOrder,expectedOrder:[...draft.expectedOrder],panelId:draft.panelId};message='小组展示顺序已保存';
   }else{
    assertDraft(context.state,'assign');const ids=data.getAll('student'),expectedAssignments=draft.students.filter(student=>ids.includes(student.id)).map(({id,group})=>({id,group}));
    const group=draft.createTarget?model.createAndAssignPatch(context.state,ids,expectedAssignments,data.get('newGroup')).group:model.assertAssignments(context.state,ids,expectedAssignments,data.get('group'));
    action={type:draft.createTarget?'students.group.create':'students.group',ids,group,expectedAssignments,requireExistingGroup:true,panelId:draft.panelId};message=draft.createTarget?`已创建「${group}」并分配 ${ids.length} 位学生`:`已为 ${ids.length} 位学生保存分组`;
   }
   const token=draft.token;busy=true;form.dataset.saving='1';controls=[...form.querySelectorAll('button,input,select')].map(control=>[control,control.disabled]);controls.forEach(([control])=>control.disabled=true);
   const ok=await context.act(action,message);
   if(ok!==false&&form.isConnected&&draft?.token===token){draft=null;context.closeModal();}
  }catch(error){context.toast(error.message);}
  finally{busy=false;if(form.isConnected){delete form.dataset.saving;controls.forEach(([control,disabled])=>control.disabled=disabled);selectionStatus();}}
  return true;
 }
 root.GroupToolsUI=Object.freeze({handles,handlesForm,handle,submit,sync});
})(globalThis);
