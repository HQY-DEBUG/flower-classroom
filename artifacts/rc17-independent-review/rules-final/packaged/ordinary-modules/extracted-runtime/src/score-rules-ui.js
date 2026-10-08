(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const $=s=>root.document.querySelector(s),pid=s=>s.panels?.activeId||'panel_default',signed=n=>(n>0?'+':'')+n;
 let draft=null,busy=false;
 const handles=action=>action==='show-reasons'||action==='score-reasons-target'||action.startsWith('rule-')||action==='flexible-plus'||action==='flexible-minus';
 const latest=context=>context.getState?context.getState():context.state;
 const enabled=state=>!!state.settings.petRules;
 const growthNote=(rule,state)=>{const n=ScoreRules.effectiveGrowth(rule,enabled(state));return n?'成长 '+signed(n):'成长不变';};
 function scoreGrowthNote(rule,state,ids){
  if(!enabled(state))return growthNote(rule,state);
  const linked=ids.filter(id=>state.petAccounts?.some(a=>a.studentId===id&&a.mode==='legacy-linked')).length;
  if(linked&&rule.delta>0)return `旧关联伙伴 ${linked} 位：成长 +${rule.delta}${ids.length>linked?'；其余伙伴成长不变':''}`;
  return '宠物成长保持不变';
 }
 const sheetControls=()=>`<section class="rule-sheet-panel"><div><strong>计分卡片表格</strong><p>在 Excel 中修改后，回到这里预览并刷新。界面内保存也会同步到表格</p></div><label>软件同级文件<input class="rule-sheet-path" readonly aria-label="计分卡片表格位置" value="正在读取位置…"></label><div class="button-row"><button type="button" class="button" data-do="rule-sheet-open">打开计分卡片表格 ↗</button><button type="button" class="button" data-do="rule-sheet-refresh">从表格刷新</button><button type="button" class="text-button" data-do="rule-sheet-export">用当前规则重建表格</button></div><p class="rule-sheet-status" role="status">各面板使用独立编号，刷新前会验证所有卡片</p></section>`;
 async function readSheetInfo(context){const host=$('.rule-sheet-panel');if(!host)return;try{const result=await context.api.file({command:'rules-workbook-info'});if(!host.isConnected)return;if(!result?.path){host.querySelector('.rule-sheet-path').value='请在桌面版使用';return;}host.querySelector('.rule-sheet-path').value=result.path;if(result.warning)host.querySelector('.rule-sheet-status').textContent=result.warning;}catch(error){if(host.isConnected)host.querySelector('.rule-sheet-status').textContent=error.message;}}
 function returnTo(context,current=draft){if(current?.panelId!==pid(latest(context))){context.closeModal();return;}if(current?.onReturn)current.onReturn();else context.closeModal();}
 function openManager(context,options={}){
  const state=latest(context),rules=ScoreRules.list(state);draft={kind:'manage',panelId:pid(state),rules,onReturn:options.onReturn};
  context.modal(`<h2>规则原因</h2><div class="rule-manager-intro"><p>编辑卡片名称、积分与成长。只影响今后的操作，已记入的历史保持原样</p>${options.onReturn?'<button class="button" data-do="rule-back">返回计分卡片</button>':''}</div>${sheetControls()}<div class="score-rule-columns">${[1,-1].map(sign=>`<section><h3>${sign>0?'加分原因':'扣分原因'}</h3><div class="score-rule-list">${rules.filter(r=>Math.sign(r.delta)===sign).map(r=>`<button type="button" class="score-rule-card ${sign<0?'negative':''}" data-do="rule-edit" data-id="${r.id}"><span>${esc(r.label)}</span><strong>${signed(r.delta)} 分</strong><small>${growthNote(r,state)} · 点击编辑</small></button>`).join('')||'<p class="muted">暂无原因</p>'}</div></section>`).join('')}</div>`);
  $('#modal .dialog').classList.add('score-rules-dialog');readSheetInfo(context);
 }
 function openEditor(id,context,options={}){
  const state=latest(context),rules=ScoreRules.list(state),rule=rules.find(r=>r.id===id);if(!rule)return context.toast('这张卡片已移除，请重新打开');
  const old=draft,back=options.onReturn||(()=>openManager(context,{onReturn:old?.onReturn}));
  draft={kind:'edit',panelId:pid(state),rules,ruleId:id,onReturn:back};
  const independent=enabled(state);
  context.modal(`<h2>编辑积分原因</h2><p class="rule-edit-context">修改“${esc(rule.label)}”这张计分卡片，保存时不会为学生计分</p><form id="score-rule-edit-form"><label>原因名称<input name="label" maxlength="120" required value="${esc(rule.label)}"></label><div class="rule-value-fields"><label>积分变化<input name="delta" type="number" min="-100" max="100" step="1" required value="${rule.delta}"><small>正数加分，负数扣分，不能为 0</small></label><label>成长值变化<input name="growthDelta" type="number" min="${independent?-100:0}" max="100" step="1" value="${Object.hasOwn(rule,'growthDelta')?rule.growthDelta:''}" placeholder="自动（${signed(ScoreRules.effectiveGrowth({delta:rule.delta},independent))}）"><small>留空沿用原规则；填 0 表示成长不变</small></label></div><p class="rule-input-note">${independent?'本班已启用分段成长：宠物页按成长值操作，不增加积分。普通计分仍保留每位学生原有关联方式，旧关联伙伴加分会同步成长；卡片自定义成长用于宠物页。成长值支持 −100 至 100。':'本班使用关联成长：计分同时记录卡片显示的成长，成长值支持 0 至 100。留空时加分同步成长、扣分不减成长。'}</p><p class="rule-save-note">保存后同步到软件同级“计分卡片.xlsx”；若表格被外部修改或占用，会保留草稿并提示处理</p><div class="dialog-actions"><button type="button" class="button" data-do="rule-cancel">取消</button><button type="submit" class="button primary">保存规则</button></div></form>`);
  $('#modal .dialog').classList.add('score-rule-edit-dialog');
 }
 function targets(state,selected,id){const ids=id?[id]:[...(selected||[])];const allowed=new Set(state.students.map(s=>s.id));if(!ids.length||ids.some(id=>!allowed.has(id)))throw Error('请先选择要记分的学生');return [...new Set(ids)];}
 function showFlexible(state,ids,direction,modal){
  draft={kind:'flexible',panelId:pid(state),ids:[...ids],direction};
  const names=state.students.filter(s=>ids.includes(s.id)).map(s=>s.name);
  modal(`<h2>临时${direction>0?'加':'扣'}分</h2><p class="rule-targets">${esc(names.join('、'))}</p><form id="score-flexible-form"><label>原因 / 理由（必填）<input name="reason" maxlength="120" required placeholder="例如：期末考试成绩"></label><label>${direction>0?'加':'扣'}分数<input name="amount" type="number" min="1" max="100" step="1" required value="1"></label><p class="rule-input-note">这里只输入正数，系统会自动${direction>0?'加':'扣'}分。${ids.length>1?'所选每位学生分别记相同分值，可整笔撤销。':''}</p><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button primary">确认${direction>0?'加':'扣'}分</button></div></form>`);
 }
 function chooseReasons(context,ids){
  const state=latest(context),rules=ScoreRules.list(state);draft={kind:'choose',panelId:pid(state),ids:[...ids],rules};
  const names=state.students.filter(s=>ids.includes(s.id)).map(s=>s.name);
  context.modal(`<h2>规则原因操作</h2><p class="rule-targets">${esc(names.join('、'))}</p><div class="reason-editor-toolbar"><small>选择卡片后确认记分</small><button type="button" class="button" data-do="rule-manage">编辑计分卡片</button></div>${ids.length===1?`<button class="button" data-do="cw-prize" data-id="${ids[0]}">奖品项 · 幸运大转盘 / 点击抽奖</button>`:''}<div class="score-rule-columns">${[1,-1].map(sign=>`<section><h3>${sign>0?'表现优异（加分项）':'需要改进（扣分项）'}</h3><div class="score-rule-list">${rules.filter(r=>Math.sign(r.delta)===sign).map(r=>`<div class="rule-choice-row"><button type="button" class="score-rule-card ${sign<0?'negative':''}" data-do="rule-choose" data-id="${r.id}"><span>${esc(r.label)}</span><strong>${signed(r.delta)}</strong><small>${scoreGrowthNote(r,state,ids)}</small></button><button type="button" class="rule-inline-edit" data-do="rule-edit-choice" data-id="${r.id}" aria-label="编辑${esc(r.label)}计分卡片">编辑</button></div>`).join('')}<button type="button" class="score-rule-card flexible" data-do="rule-flexible" data-direction="${sign}"><span>灵活原因</span><small>点击填入</small></button></div></section>`).join('')}</div>`);
  $('#modal .dialog').classList.add('score-rules-dialog');
 }
 async function sheetAction(action,el,context){
  const host=el.closest('.rule-sheet-panel');if(!host)return true;const active=draft;if(!active)return true;
  const status=host.querySelector('.rule-sheet-status');el.disabled=true;
  try{
   if(action==='rule-sheet-open'){const result=await context.api.file({command:'rules-workbook-open'});if(!host.isConnected||draft!==active)return true;if(result?.path)host.querySelector('.rule-sheet-path').value=result.path;status.textContent=result?.opened?'表格已打开。修改并保存后，请回到这里点击“从表格刷新”':result?.warning||'未能打开表格';return true;}
   const command=action==='rule-sheet-export'?'rules-workbook-export-preview':'rules-workbook-refresh-preview';
   const result=await context.api.file({command});if(!host.isConnected||draft!==active)return true;
   if(!result?.token)throw Error('表格预览未就绪，请重试');
   const rebuilding=action==='rule-sheet-export';draft={kind:'sheet-confirm',panelId:active.panelId,token:result.token,rebuilding,onReturn:()=>openManager(context,{onReturn:active.onReturn})};
   context.modal(`<h2>${rebuilding?'用当前规则重建表格？':'确认加载表格中的计分卡片'}</h2><p>${rebuilding?'将当前所有面板的计分规则写入表格；原表会保留备份。未导入的外部修改不会进入课堂。':'验证已完成，确认后更新对应面板的卡片。学生积分、成长与历史记录不会重新计算。'}</p>${result.warning?`<p class="rule-recovery-notice" role="status">${esc(result.warning)}</p>`:''}${rebuilding?`<div class="rule-recovery-paths">${result.backupPath?`<p>原表备份：<span>${esc(result.backupPath)}</span></p>`:''}${result.receiptBackupPath?`<p>原事务记录备份：<span>${esc(result.receiptBackupPath)}</span></p>`:''}</div>`:''}<div class="rule-refresh-summary"><strong>${result.panelCount} 个面板</strong><strong>${result.ruleCount} 张卡片</strong></div>${Array.isArray(result.summary)?`<div class="rule-import-panels">${result.summary.map(item=>typeof item==='string'?`<p>${esc(item)}</p>`:`<details ${item.changed?'open':''}><summary>${esc(item.name)} · ${item.count} 张卡片${item.changed?' · 将更新':''}</summary><div class="rule-import-table-wrap"><table><thead><tr><th>卡片名称</th><th>积分变化</th><th>成长值变化</th></tr></thead><tbody>${(item.rules||[]).map(r=>`<tr><td>${esc(r.label)}</td><td>${signed(r.delta)}</td><td>${Object.hasOwn(r,'growthDelta')?signed(r.growthDelta):'自动（原规则）'}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}</div>`:''}<form id="score-rule-sheet-confirm-form"><div class="dialog-actions"><button type="button" class="button" data-do="rule-cancel">取消</button><button type="submit" class="button primary">${rebuilding?'确认重建表格':'确认更新卡片'}</button></div></form>`);
  }catch(error){if(host.isConnected&&draft===active)status.textContent=error.message;}
  finally{if(el.isConnected)el.disabled=false;}
  return true;
 }
 async function handle(action,el,context){
  if(!handles(action))return false;if(busy)return true;
  const {state,selected,modal,toast}=context;
  try{
   if(action==='show-reasons'){openManager(context);return true;}
   if(action==='rule-cancel'||action==='rule-back'){returnTo(context);return true;}
   if(action.startsWith('rule-sheet-'))return sheetAction(action,el,context);
   if(action==='rule-edit'){if(draft?.panelId!==pid(state))throw Error('面板已切换，请重新打开规则');openEditor(el.dataset.id,context);return true;}
   if(action==='rule-edit-choice'||action==='rule-manage'){if(draft?.kind!=='choose'||draft.panelId!==pid(state))throw Error('评分目标已变化，请重新选择');const ids=[...draft.ids],back=()=>chooseReasons(context,ids);if(action==='rule-manage')openManager(context,{onReturn:back});else openEditor(el.dataset.id,context,{onReturn:back});return true;}
   if(action==='score-reasons-target'){chooseReasons(context,targets(state,selected,el.dataset.id));return true;}
   if(action==='flexible-plus'||action==='flexible-minus'){showFlexible(state,targets(state,selected),action==='flexible-plus'?1:-1,modal);return true;}
   if(action==='rule-flexible'){if(draft?.panelId!==pid(state))throw Error('面板已切换，请重新选择学生');showFlexible(state,draft.ids,Number(el.dataset.direction),modal);return true;}
   if(action==='rule-choose'){
    if(draft?.kind!=='choose'||draft.panelId!==pid(state))throw Error('评分目标已变化，请重新选择');
    const rule=draft.rules.find(r=>r.id===el.dataset.id);if(!rule)return true;
    const current=ScoreRules.list(state).find(r=>r.id===rule.id);if(!current||!ScoreRules.same([rule],[current]))throw Error('计分卡片已修改，请重新打开后核对');
    const command={type:'score',ids:[...draft.ids],delta:rule.delta,reason:rule.label,panelId:draft.panelId,expectedRule:{...rule},...(!enabled(state)&&Object.hasOwn(rule,'growthDelta')?{growthDelta:rule.growthDelta}:{})};
    draft={...draft,kind:'confirm',command};
    modal(`<h2>确认${rule.delta>0?'加':'扣'}分</h2><p>${esc(rule.label)}</p><p>为 ${command.ids.length} 位学生各 ${signed(rule.delta)} 分</p><p>${scoreGrowthNote(rule,state,command.ids)}</p><form id="score-rule-confirm-form"><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button primary">确认</button></div></form>`);
   }
  }catch(error){toast(error.message);}
  return true;
 }
 async function submit(event,context){
  const {state,act,toast,closeModal}=context,form=event.target;
  if(!['score-rule-edit-form','score-flexible-form','score-rule-confirm-form','score-rule-sheet-confirm-form'].includes(form.id))return false;
  event.preventDefault();if(busy||form.dataset.saving)return true;
  const active=draft;
  try{
   if(!active||active.panelId!==pid(state))throw Error('面板已切换，请重新打开操作');
   const fd=new FormData(form);let action;
   if(form.id==='score-rule-edit-form'){
    const raw=String(fd.get('growthDelta')??'').trim();
    if(raw&&!/^-?\d+$/.test(raw))throw Error('成长值必须为整数，或留空使用原规则');
    const changed=active.rules.map(r=>{if(r.id!==active.ruleId)return r;const next={...r,label:fd.get('label'),delta:Number(fd.get('delta'))};if(raw)next.growthDelta=Number(raw);else delete next.growthDelta;return next;});
    action={type:'rules.save',rules:ScoreRules.validateRules(changed),expectedRules:active.rules,panelId:active.panelId};
   }else if(form.id==='score-flexible-form'){
    const reason=String(fd.get('reason')||'').trim();if(!reason||[...reason].length>120)throw Error('请填写1–120字的原因 / 理由');
    action={type:'score',ids:[...active.ids],delta:ScoreRules.flexibleDelta(fd.get('amount'),active.direction),reason,panelId:active.panelId};
   }else if(form.id!=='score-rule-sheet-confirm-form')action=active.command;
   busy=true;form.dataset.saving='1';form.querySelectorAll('button,input').forEach(e=>e.disabled=true);
   let ok;
   if(form.id==='score-rule-sheet-confirm-form'){const result=await context.api.file({command:active.rebuilding?'rules-workbook-export-apply':'rules-workbook-refresh-apply',token:active.token,panelId:active.panelId});context.acceptState(result,{type:'rules.save'});toast(active.rebuilding?'计分卡片表格已重建，原表备份保留':'计分卡片已从表格更新');ok=true;}
   else ok=await act(action,action.type==='rules.save'?'计分卡片与表格已保存':'积分已更新');
   if(ok!==false&&form.isConnected&&draft===active){if(form.id==='score-rule-edit-form'||form.id==='score-rule-sheet-confirm-form')returnTo(context,active);else{draft=null;closeModal();}}
  }catch(error){toast(error.message);}
  finally{busy=false;if(form.isConnected){delete form.dataset.saving;form.querySelectorAll('button,input').forEach(e=>e.disabled=false);}}
  return true;
 }
 root.RuleTools=Object.freeze({handles,handle,submit,openEditor,openManager});
})(globalThis);
