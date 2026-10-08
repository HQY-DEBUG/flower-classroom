(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const $=s=>root.document.querySelector(s),pid=s=>s.panels?.activeId||'panel_default';
 let draft=null,busy=false;
 const handles=action=>action==='show-reasons'||action==='score-reasons-target'||action.startsWith('rule-')||action==='flexible-plus'||action==='flexible-minus';
 function manage(state,modal){
  const rules=ScoreRules.list(state);draft={kind:'manage',panelId:pid(state),rules};
  modal(`<h2>规则原因</h2><p>点击已有原因，修改名称与分值。已经记入的历史不随规则改名而改变</p><div class="score-rule-columns">${[1,-1].map(sign=>`<section><h3>${sign>0?'加分原因':'扣分原因'}</h3><div class="score-rule-list">${rules.filter(r=>Math.sign(r.delta)===sign).map(r=>`<button class="score-rule-card ${sign<0?'negative':''}" data-do="rule-edit" data-id="${r.id}"><span>${esc(r.label)}</span><strong>${r.delta>0?'+':''}${r.delta}</strong><small>点击修改</small></button>`).join('')||'<p class="muted">暂无原因</p>'}</div></section>`).join('')}</div>`);
  $('#modal .dialog').classList.add('score-rules-dialog');
 }
 function edit(id,modal){
  const rule=draft?.rules.find(r=>r.id===id);if(!rule)return;
  draft={...draft,kind:'edit',ruleId:id};
  modal(`<h2>编辑积分原因</h2><form id="score-rule-edit-form"><label>原因名称<input name="label" maxlength="120" required value="${esc(rule.label)}"></label><label>分值<input name="delta" type="number" min="-100" max="100" step="1" required value="${rule.delta}"></label><p class="rule-input-note">正数加分，负数扣分；支持−100至100，不能为0</p><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button primary">保存规则</button></div></form>`);
 }
 function targets(state,selected,id){const ids=id?[id]:[...(selected||[])];const allowed=new Set(state.students.map(s=>s.id));if(!ids.length||ids.some(id=>!allowed.has(id)))throw Error('请先选择要记分的学生');return [...new Set(ids)];}
 function showFlexible(state,ids,direction,modal){
  draft={kind:'flexible',panelId:pid(state),ids:[...ids],direction};
  const names=state.students.filter(s=>ids.includes(s.id)).map(s=>s.name);
  modal(`<h2>临时${direction>0?'加':'扣'}分</h2><p class="rule-targets">${esc(names.join('、'))}</p><form id="score-flexible-form"><label>原因 / 理由（必填）<input name="reason" maxlength="120" required placeholder="例如：期末考试成绩"></label><label>${direction>0?'加':'扣'}分数<input name="amount" type="number" min="1" max="100" step="1" required value="1"></label><p class="rule-input-note">这里只输入正数，系统会自动${direction>0?'加':'扣'}分。${ids.length>1?'所选每位学生分别记相同分值，可整笔撤销。':''}</p><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button primary">确认${direction>0?'加':'扣'}分</button></div></form>`);
 }
 function chooseReasons(state,ids,modal){
  const rules=ScoreRules.list(state);draft={kind:'choose',panelId:pid(state),ids:[...ids],rules};
  const names=state.students.filter(s=>ids.includes(s.id)).map(s=>s.name);
  modal(`<h2>规则原因操作</h2><p class="rule-targets">${esc(names.join('、'))}</p>${ids.length===1?`<button class="button" data-do="cw-prize" data-id="${ids[0]}">奖品项 · 幸运大转盘 / 点击抽奖</button>`:''}<div class="score-rule-columns">${[1,-1].map(sign=>`<section><h3>${sign>0?'表现优异（加分项）':'需要改进（扣分项）'}</h3><div class="score-rule-list">${rules.filter(r=>Math.sign(r.delta)===sign).map(r=>`<button class="score-rule-card ${sign<0?'negative':''}" data-do="rule-choose" data-id="${r.id}"><span>${esc(r.label)}</span><strong>${r.delta>0?'+':''}${r.delta}</strong></button>`).join('')}<button class="score-rule-card flexible" data-do="rule-flexible" data-direction="${sign}"><span>灵活原因</span><small>点击填入</small></button></div></section>`).join('')}</div>`);
  $('#modal .dialog').classList.add('score-rules-dialog');
 }
 async function handle(action,el,context){
  if(!handles(action))return false;if(busy)return true;
  const {state,selected,modal,toast,act,closeModal}=context;
  try{
   if(action==='show-reasons'){manage(state,modal);return true;}
   if(action==='rule-edit'){if(draft?.panelId!==pid(state))throw Error('面板已切换，请重新打开规则');edit(el.dataset.id,modal);return true;}
   if(action==='score-reasons-target'){chooseReasons(state,targets(state,selected,el.dataset.id),modal);return true;}
   if(action==='flexible-plus'||action==='flexible-minus'){showFlexible(state,targets(state,selected),action==='flexible-plus'?1:-1,modal);return true;}
   if(action==='rule-flexible'){if(draft?.panelId!==pid(state))throw Error('面板已切换，请重新选择学生');showFlexible(state,draft.ids,Number(el.dataset.direction),modal);return true;}
   if(action==='rule-choose'){
    if(draft?.kind!=='choose'||draft.panelId!==pid(state))throw Error('评分目标已变化，请重新选择');
    const rule=draft.rules.find(r=>r.id===el.dataset.id);if(!rule)return true;
    const command={type:'score',ids:[...draft.ids],delta:rule.delta,reason:rule.label,panelId:draft.panelId};
    const selectedRule={...rule};draft={...draft,kind:'confirm',command};
    modal(`<h2>确认${rule.delta>0?'加':'扣'}分</h2><p>${esc(selectedRule.label)}</p><p>为 ${command.ids.length} 位学生各 ${selectedRule.delta>0?'+':''}${selectedRule.delta} 分</p><form id="score-rule-confirm-form"><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button primary">确认</button></div></form>`);
   }
  }catch(error){toast(error.message);}
  return true;
 }
 async function submit(event,{state,act,toast,closeModal}){
  const form=event.target;
  if(!['score-rule-edit-form','score-flexible-form','score-rule-confirm-form'].includes(form.id))return false;
  event.preventDefault();if(busy||form.dataset.saving)return true;
  try{
   if(!draft||draft.panelId!==pid(state))throw Error('面板已切换，请重新打开操作');
   const fd=new FormData(form);let action;
   if(form.id==='score-rule-edit-form'){
    const changed=draft.rules.map(r=>r.id===draft.ruleId?{...r,label:fd.get('label'),delta:Number(fd.get('delta'))}:r);
    action={type:'rules.save',rules:ScoreRules.validateRules(changed),expectedRules:draft.rules,panelId:draft.panelId};
   }else if(form.id==='score-flexible-form'){
    const reason=String(fd.get('reason')||'').trim();if(!reason||[...reason].length>120)throw Error('请填写1–120字的原因 / 理由');
    action={type:'score',ids:[...draft.ids],delta:ScoreRules.flexibleDelta(fd.get('amount'),draft.direction),reason,panelId:draft.panelId};
   }else action=draft.command;
   busy=true;form.dataset.saving='1';form.querySelectorAll('button,input').forEach(e=>e.disabled=true);
   const ok=await act(action,action.type==='rules.save'?'积分规则已保存':'积分已更新');
   if(ok!==false&&form.isConnected){draft=null;closeModal();}
  }catch(error){toast(error.message);}
  finally{busy=false;if(form.isConnected){delete form.dataset.saving;form.querySelectorAll('button,input').forEach(e=>e.disabled=false);}}
  return true;
 }
 root.RuleTools=Object.freeze({handles,handle,submit});
})(globalThis);
