(function(root){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const errorText=error=>String(error?.message||error).replace(/^Error invoking remote method '[^']+':(?: Error:)?\s*/,'');
 const $=s=>root.document.querySelector(s),pid=s=>s.panels?.activeId||'panel_default',signed=n=>(n>0?'+':'')+n;
 let draft=null,busy=false;
 const handles=action=>action==='show-config'||action==='show-reasons'||action==='score-reasons-target'||action.startsWith('rule-')||action==='flexible-plus'||action==='flexible-minus';
 const latest=context=>context.getState?context.getState():context.state;
 const enabled=state=>!!state.settings.petRules;
 const growthNote=(rule,state)=>{const n=ScoreRules.effectiveGrowth(rule,enabled(state));return n?'成长 '+signed(n):'成长不变';};
 function scoreGrowthNote(rule,state,ids){
  if(!enabled(state))return growthNote(rule,state);
  const linked=ids.filter(id=>state.petAccounts?.some(a=>a.studentId===id&&a.mode==='legacy-linked')).length;
  if(linked&&rule.delta>0)return `旧关联伙伴 ${linked} 位：成长 +${rule.delta}${ids.length>linked?'；其余伙伴成长不变':''}`;
  return '宠物成长保持不变';
 }
 const ruleTable=rules=>`<div class="rule-import-table-wrap"><table><thead><tr><th>卡片名称</th><th>积分变化</th><th>成长值变化</th></tr></thead><tbody>${rules.map(r=>`<tr><td>${esc(r.label)}</td><td>${signed(r.delta)}</td><td>${Object.hasOwn(r,'growthDelta')?signed(r.growthDelta):'自动（原规则）'}</td></tr>`).join('')}</tbody></table></div>`;
 const conflictDetails=(conflicts,title='旧表格中不同版本将分别保留')=>Array.isArray(conflicts)&&conflicts.length?`<section class="rule-merge-conflicts"><h3>${esc(title)}</h3>${conflicts.map(item=>`<details open><summary>${esc(item.kind==='label'?item.label:'同一旧编号：'+item.id)}</summary>${(item.variants||[]).map(variant=>`<p><strong>${esc(variant.rule.label)}</strong> · 积分 ${signed(variant.rule.delta)} · 成长 ${Object.hasOwn(variant.rule,'growthDelta')?signed(variant.rule.growthDelta):'自动（原规则）'}<small>来自 ${esc((variant.sources||[]).map(source=>source.panelName).join('、'))}</small></p>`).join('')}</details>`).join('')}</section>`:'';
 const scopeNote='<p class="rule-shared-scope"><strong>所有面板共用同一套计分卡片</strong> · 保存后影响所有面板今后的计分操作，已记入的积分、成长和历史保持原样</p>';
 const sheetControls=()=>`<section class="rule-sheet-panel"><div><strong>统一配置表 · 配置.xlsx</strong><p>全部可修改参数按工作表分类；“计分卡片”由所有面板共用，“宠物进阶”按面板保留原有模式。保存 Excel 后，回到这里预览整本变更再确认</p></div><label>程序根目录文件<input class="rule-sheet-path" readonly aria-label="统一配置表位置" value="正在读取位置…"></label><div class="button-row"><button type="button" class="button" data-do="rule-sheet-open">打开配置表 ↗</button><button type="button" class="button" data-do="rule-sheet-refresh">从配置表刷新</button><button type="button" class="text-button" data-do="rule-sheet-export">用当前参数重建配置表</button></div><p class="rule-sheet-status" role="status">确认前查看各工作表的变更和生效时机；学生名单、积分历史、头像图片与密码不放入参数表</p></section>`;
 const displayValue=value=>value===null||value===undefined||value===''?'（空）':typeof value==='boolean'?(value?'启用':'关闭'):Array.isArray(value)?value.map(displayValue).join('、'):typeof value==='object'?Object.entries(value).map(([k,v])=>k+'：'+displayValue(v)).join('；'):String(value);
 function configSummaryView(groups,{afterLabel='表中值'}={}){
  if(!Array.isArray(groups)||!groups.length)return '';
  return `<section class="config-preview-summary"><h3>其他工作表的参数变更</h3>${groups.map(group=>`<details ${group.changes?.length?'open':''}><summary><strong>${esc(group.title||group.sheet)}</strong><span>${esc(group.panelName||({'global':'全局','panel':'本面板','shared':'所有面板'}[group.scope]||group.scope||''))} · ${group.changes?.length?'修改 '+group.changes.length+' 项':'保持当前参数'}</span></summary>${group.changes?.length?`<div class="rule-import-table-wrap"><table><thead><tr><th>参数</th><th>当前值</th><th>${esc(afterLabel)}</th><th>生效时机</th></tr></thead><tbody>${group.changes.map(change=>`<tr><th>${esc(change.label||change.key)}</th><td>${esc(displayValue(change.before))}</td><td class="config-next-value">${esc(displayValue(change.after))}</td><td>${esc(change.effect||'确认后生效')}</td></tr>`).join('')}</tbody></table></div>`:''}</details>`).join('')}</section>`;
 }
 function migrationSourcesView(result){
  const sources=result.legacySources||result.migrationSources||result.sources||result.migration?.sources;
  if(!Array.isArray(sources)||!sources.length)return '';
  return `<section class="config-migration-sources"><h3>旧配置来源</h3><p>确认后建立“配置.xlsx”，原文件保留供核对</p>${sources.map(source=>`<p><strong>${esc(source.name||source.filename||source.path||'旧配置文件')}</strong>${source.path&&source.name?`<span>${esc(source.path)}</span>`:''}${source.hash||source.sha256?`<small>文件校验：${esc(source.hash||source.sha256)}</small>`:''}</p>`).join('')}</section>`;
 }
 function openConfiguration(context,options={}){
  const state=latest(context);draft={kind:'config',panelId:pid(state),onReturn:options.onReturn};
  context.modal(`<h2>统一配置表</h2><p>参数统一保存在程序根目录的“配置.xlsx”。可以用 Excel / WPS 编辑，也可以继续使用界面内的设置入口</p>${sheetControls()}<div class="config-manager-shortcuts"><button type="button" class="button" data-do="show-reasons">编辑共享计分卡片</button><button type="button" class="button" data-do="pet-rules">查看本面板成长规则</button></div><p class="rule-input-note">刷新不会重新计分，也不会重开当前计时或抽取。窗口参数在下次完整退出并重开后生效；工具默认值在下一次明确重置或新一轮操作时使用</p>${progressionView(currentProgression(state))}`);
  $('#modal .dialog').classList.add('score-rules-dialog','configuration-dialog');readSheetInfo(context);
 }
 const currentProgression=state=>[{id:pid(state),data:state},...(state.panels?.others||[])].map(({id,data})=>{const stages=data.settings.petRules?.thresholds||Array(6).fill(data.settings.petStep);return {id,name:data.settings.className,mode:data.settings.petRules?'ledger-six':'legacy-step',cumulative:stages.map((_,i)=>stages.slice(0,i+1).reduce((a,b)=>a+b,0))};});
 function progressionView(items,title='当前宠物进阶配置',previous=[],description='表中的 LV.2–LV.7 为累计成长门槛。成长模式按面板保留，修改门槛不会修改现有成长值与历史'){
  if(!Array.isArray(items)||!items.length)return '';
  return `<section class="rule-progression-preview"><h3>${esc(title)}</h3><p>${esc(description)}</p><div class="rule-import-table-wrap"><table><thead><tr><th>面板 / 成长模式</th>${[2,3,4,5,6,7].map(v=>`<th>LV.${v}</th>`).join('')}</tr></thead><tbody>${items.map(item=>`<tr class="${item.changed?'rule-progression-changed':''}"><th>${esc(item.name)}<small>${item.mode==='ledger-six'?'六段成长与毕业':'旧版每级统一成长'}${item.changed?' · 将更新':' · 保持现有模式'}</small></th>${(item.cumulative||[]).map((n,i)=>{const old=previous.find(panel=>panel.id===item.id)?.cumulative?.[i];return `<td>${old!==undefined&&old!==n?`<del>${esc(old)}</del> <strong>${esc(n)}</strong>`:esc(n)}</td>`;}).join('')}</tr>`).join('')}</tbody></table></div></section>`;
 }
 function restorePreview(configuration,currentState){
  const result=configuration||{},rules=Array.isArray(result.rules)?result.rules:[],originals=result.migration?.panels||[];
  return `<section class="restore-configuration-preview"><h3>备份将恢复的整本配置</h3>${result.warning?`<p class="rule-recovery-notice" role="status">${esc(result.warning)}</p>`:''}${result.recoveryRebuild?'<p class="rule-form-error" role="status">当前课堂存档处于受损保护状态。本次确认会使用所选完整备份恢复课堂数据，并重建整本配置；现有课堂文件、配置表及事务记录会先保留。无法读写时不会绕过保护。</p>':''}${result.requiresRuleMerge?'<p class="rule-shared-scope"><strong>旧备份的面板计分卡片不同</strong>确认恢复时会合并为所有面板共用的卡片。不同分值或成长值的版本分别保留，原规则快照和映射关系一起保存。</p>':''}<details class="rule-import-panels" ${result.requiresRuleMerge?'open':''}><summary>恢复后的共享计分卡片 · ${rules.length} 张 · 影响全部面板</summary>${ruleTable(rules)}</details>${conflictDetails(result.migration?.conflicts,'旧备份中不同版本将分别保留')}${originals.length?`<details class="rule-merge-originals"><summary>查看将保留的旧备份原规则</summary>${originals.map(panel=>`<h3>${esc(panel.name)}</h3>${ruleTable(panel.rules||[])}`).join('')}</details>`:''}${configSummaryView(result.configSummary,{afterLabel:'备份值'})}${progressionView(result.progression,'恢复后的宠物进阶门槛',currentState?currentProgression(currentState):[],'以下为备份中的累计成长门槛。面板成长模式、学生成长及历史记录随所选备份恢复。')}<div class="rule-recovery-paths">${result.stateBackupPath?`<p>恢复前课堂文件备份：<span>${esc(result.stateBackupPath)}</span></p>`:''}${result.backupPath?`<p>恢复前配置表备份：<span>${esc(result.backupPath)}</span></p>`:''}${result.receiptBackupPath?`<p>恢复前事务记录备份：<span>${esc(result.receiptBackupPath)}</span></p>`:''}</div></section>`;
 }
 function openShare(context,options={}){
  const state=latest(context),preview=ScoreRules.previewShared(state);
  if(!preview.required){if(options.onShared)options.onShared(preview);else openManager(context,options);return;}
  draft={kind:'share',panelId:pid(state),expectedKey:preview.expectedKey,preview,onReturn:options.onReturn,onShared:options.onShared};
  context.modal(`<h2>先核对，再共享计分卡片</h2><p>这些面板的旧卡片不同。确认后合并为所有面板共用的一套卡片；不同分值或成长值的版本会分别保留，旧规则快照和对应关系也会保存</p><div class="rule-refresh-summary"><strong>${preview.panels.length} 个面板</strong><strong>合并后 ${preview.rules.length} 张卡片</strong></div>${preview.conflicts.length?`<section class="rule-merge-conflicts"><h3>需核对的不同版本</h3>${preview.conflicts.map(conflict=>`<details open><summary>${esc(conflict.kind==='label'?conflict.label:'同一旧编号：'+conflict.id)} · 保留 ${conflict.variants.length} 个版本</summary>${conflict.variants.map(variant=>`<p><strong>${esc(variant.rule.label)}</strong> · 积分 ${signed(variant.rule.delta)} · 成长 ${Object.hasOwn(variant.rule,'growthDelta')?signed(variant.rule.growthDelta):'自动（原规则）'}<small>来自 ${esc(variant.sources.map(source=>source.panelName).join('、'))}</small></p>`).join('')}</details>`).join('')}</section>`:'<p class="rule-input-note">面板的卡片内容或排序不同，下面列出了每套原规则和合并结果</p>'}<details class="rule-merge-originals"><summary>查看将保留的各面板原规则</summary>${preview.panels.map(panel=>`<h3>${esc(panel.name)}</h3>${ruleTable(panel.rules)}`).join('')}</details><details class="rule-merge-result"><summary>查看完整共享卡片 · ${preview.rules.length} 张</summary>${ruleTable(preview.rules)}</details><form id="score-rule-share-form"><p class="rule-form-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="button" data-do="rule-cancel">取消</button><button type="button" class="button" data-do="rule-share-refresh">重新预览</button><button type="submit" class="button primary">确认合并并共享</button></div></form>`);
  $('#modal .dialog').classList.add('score-rules-dialog','rule-share-dialog');
 }
 async function readSheetInfo(context){const host=$('.rule-sheet-panel');if(!host)return;try{const result=await context.api.file({command:'rules-workbook-info'});if(!host.isConnected)return;if(!result?.path){host.querySelector('.rule-sheet-path').value='请在桌面版使用';return;}host.querySelector('.rule-sheet-path').value=result.path;if(result.warning)host.querySelector('.rule-sheet-status').textContent=result.warning;}catch(error){if(host.isConnected)host.querySelector('.rule-sheet-status').textContent=errorText(error);}}
 function returnTo(context,current=draft){if(current?.panelId!==pid(latest(context))){context.closeModal();return;}if(current?.onReturn)current.onReturn();else context.closeModal();}
 function openManager(context,options={}){
  const state=latest(context);if(ScoreRules.previewShared(state).required)return openShare(context,{...options,onShared:()=>openManager(context,options)});const rules=ScoreRules.list(state);draft={kind:'manage',panelId:pid(state),rules,onReturn:options.onReturn};
  context.modal(`<h2>共享计分卡片</h2>${scopeNote}<div class="rule-manager-intro"><p>编辑卡片名称、积分与成长值，所有面板使用相同卡片</p>${options.onReturn?'<button class="button" data-do="rule-back">返回计分卡片</button>':''}</div>${sheetControls()}${progressionView(currentProgression(state))}<div class="score-rule-columns">${[1,-1].map(sign=>`<section><h3>${sign>0?'加分原因':'扣分原因'}</h3><div class="score-rule-list">${rules.filter(r=>Math.sign(r.delta)===sign).map(r=>`<button type="button" class="score-rule-card ${sign<0?'negative':''}" data-do="rule-edit" data-id="${r.id}"><span>${esc(r.label)}</span><strong>${signed(r.delta)} 分</strong><small>${growthNote(r,state)} · 点击编辑</small></button>`).join('')||'<p class="muted">暂无原因</p>'}</div></section>`).join('')}</div>`);
  $('#modal .dialog').classList.add('score-rules-dialog');readSheetInfo(context);
 }
 function openEditor(id,context,options={}){
  const state=latest(context),preview=ScoreRules.previewShared(state);if(preview.required){const panelId=pid(state);return openShare(context,{onReturn:options.onReturn,onShared:p=>openEditor(p.mappings.find(m=>m.panelId===panelId&&m.ruleId===id)?.sharedRuleId||id,context,options)});}const rules=ScoreRules.list(state),rule=rules.find(r=>r.id===id);if(!rule)return context.toast('这张卡片已移除，请重新打开');
  const old=draft,back=options.onReturn||(()=>openManager(context,{onReturn:old?.onReturn}));
  draft={kind:'edit',panelId:pid(state),rules,ruleId:id,expectedKey:ScoreRules.key(state),sharedRevision:state.sharedScoreRules?.revision,onReturn:back};
  const independent=enabled(state);
  context.modal(`<h2>编辑共享计分卡片</h2>${scopeNote}<p class="rule-edit-context">修改“${esc(rule.label)}”这张计分卡片，保存时不会为学生计分</p><form id="score-rule-edit-form"><label>原因名称<input name="label" maxlength="120" required value="${esc(rule.label)}"></label><div class="rule-value-fields"><label>积分变化<input name="delta" type="number" min="-100" max="100" step="1" required value="${rule.delta}"><small>正数加分，负数扣分，不能为 0</small></label><label>成长值变化<input name="growthDelta" type="number" min="-100" max="100" step="1" value="${Object.hasOwn(rule,'growthDelta')?rule.growthDelta:''}" placeholder="自动（${signed(ScoreRules.effectiveGrowth({delta:rule.delta},independent))}）"><small>留空沿用原规则；填 0 表示成长不变</small></label></div><p class="rule-input-note">${independent?'本班已启用分段成长：宠物页按成长值操作，不增加积分。普通计分仍保留每位学生原有关联方式，旧关联伙伴加分会同步成长；卡片自定义成长用于宠物页。成长值支持 −100 至 100。':'本班使用关联成长：计分同时记录卡片显示的成长，留空时加分同步成长、扣分不减成长；负成长卡片仅供启用六段成长的宠物页使用，旧版计分时会拒绝负成长操作。'}</p><p class="rule-save-note">保存后同步到程序根目录“配置.xlsx”的“计分卡片”工作表；若表格被外部修改或占用，会保留草稿并提示处理</p><p class="rule-form-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="button" data-do="rule-cancel">取消</button><button type="submit" class="button primary">保存到所有面板</button></div></form>`);
  $('#modal .dialog').classList.add('score-rule-edit-dialog');
 }
 function targets(state,selected,id){const ids=id?[id]:[...(selected||[])];const allowed=new Set(state.students.map(s=>s.id));if(!ids.length||ids.some(id=>!allowed.has(id)))throw Error('请先选择要记分的学生');return [...new Set(ids)];}
 function showFlexible(state,ids,direction,modal){
  draft={kind:'flexible',panelId:pid(state),ids:[...ids],direction};
  const names=state.students.filter(s=>ids.includes(s.id)).map(s=>s.name);
  modal(`<h2>临时${direction>0?'加':'扣'}分</h2><p class="rule-targets">${esc(names.join('、'))}</p><form id="score-flexible-form"><label>原因 / 理由（必填）<input name="reason" maxlength="120" required placeholder="例如：期末考试成绩"></label><label>${direction>0?'加':'扣'}分数<input name="amount" type="number" min="1" max="100" step="1" required value="1"></label><p class="rule-input-note">这里只输入正数，系统会自动${direction>0?'加':'扣'}分。${ids.length>1?'所选每位学生分别记相同分值，可整笔撤销。':''}</p><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button primary">确认${direction>0?'加':'扣'}分</button></div></form>`);
 }
 function chooseReasons(context,ids){
  const state=latest(context),rules=ScoreRules.list(state);draft={kind:'choose',panelId:pid(state),ids:[...ids],rules,expectedRulesKey:ScoreRules.key(state),sharedRevision:state.sharedScoreRules?.revision};
  const names=state.students.filter(s=>ids.includes(s.id)).map(s=>s.name);
  context.modal(`<h2>规则原因操作</h2><p class="rule-targets">${esc(names.join('、'))}</p><div class="reason-editor-toolbar"><small>选择卡片后确认记分</small><button type="button" class="button" data-do="rule-manage">编辑计分卡片</button></div>${ids.length===1?`<button class="button" data-do="cw-prize" data-id="${ids[0]}">奖品项 · 幸运大转盘 / 点击抽奖</button>`:''}<div class="score-rule-columns">${[1,-1].map(sign=>`<section><h3>${sign>0?'表现优异（加分项）':'需要改进（扣分项）'}</h3><div class="score-rule-list">${rules.filter(r=>Math.sign(r.delta)===sign).map(r=>`<div class="rule-choice-row"><button type="button" class="score-rule-card ${sign<0?'negative':''}" data-do="rule-choose" data-id="${r.id}"><span>${esc(r.label)}</span><strong>${signed(r.delta)}</strong><small>${scoreGrowthNote(r,state,ids)}</small></button><button type="button" class="rule-inline-edit" data-do="rule-edit-choice" data-id="${r.id}" aria-label="编辑${esc(r.label)}计分卡片">编辑</button></div>`).join('')}<button type="button" class="score-rule-card flexible" data-do="rule-flexible" data-direction="${sign}"><span>灵活原因</span><small>点击填入</small></button></div></section>`).join('')}</div>`);
  $('#modal .dialog').classList.add('score-rules-dialog');
 }
 async function sheetAction(action,el,context){
  const host=el.closest('.rule-sheet-panel')||(action==='rule-sheet-repreview'?el.closest('.dialog'):null);if(!host)return true;const active=draft;if(!active)return true;
  const status=host.querySelector('.rule-sheet-status')||host.querySelector('.rule-form-error'),rebuilding=action==='rule-sheet-export'||(action==='rule-sheet-repreview'&&active.rebuilding);el.disabled=true;
  try{
   if(action==='rule-sheet-open'){const result=await context.api.file({command:'rules-workbook-open'});if(!host.isConnected||draft!==active)return true;if(result?.path)host.querySelector('.rule-sheet-path').value=result.path;status.textContent=result?.opened?'表格已打开。修改并保存后，请回到这里点击“从配置表刷新”':result?.warning||'未能打开表格';return true;}
   const command=rebuilding?'rules-workbook-export-preview':'rules-workbook-refresh-preview';
   const result=await context.api.file({command});if(!host.isConnected||draft!==active)return true;
   if(!result?.token)throw Error('表格预览未就绪，请重试');
   draft={kind:'sheet-confirm',panelId:active.panelId,token:result.token,rebuilding,onReturn:active.kind==='sheet-confirm'?active.onReturn:active.kind==='config'?()=>openConfiguration(context,{onReturn:active.onReturn}):()=>openManager(context,{onReturn:active.onReturn})};
   context.modal(`<h2>${rebuilding?'用当前参数重建配置表？':'确认刷新整本配置' }</h2><p>${rebuilding?'将当前参数写入“配置.xlsx”的全部工作表；原表会保留备份。未导入的外部修改不会进入课堂。':'整本配置已验证。请核对下面各工作表的变更和生效时机，确认后一起应用；学生积分、成长值与历史记录保持原样。'}</p>${result.warning?`<p class="rule-recovery-notice" role="status">${esc(result.warning)}</p>`:''}${rebuilding?`<div class="rule-recovery-paths">${result.backupPath?`<p>原表备份：<span>${esc(result.backupPath)}</span></p>`:''}${result.receiptBackupPath?`<p>原事务记录备份：<span>${esc(result.receiptBackupPath)}</span></p>`:''}</div>`:''}<div class="rule-refresh-summary"><strong>${result.panelCount} 个面板共用</strong><strong>${result.ruleCount} 张卡片</strong></div>${Array.isArray(result.rules)?`<details class="rule-import-panels" ${!ScoreRules.same(ScoreRules.list(latest(context)),result.rules)?'open':''}><summary>共享计分卡片 · ${result.rules.length} 张 · 影响所有面板${ScoreRules.same(ScoreRules.list(latest(context)),result.rules)?' · 保持原规则':' · 将更新'}</summary>${ruleTable(result.rules)}</details>`:Array.isArray(result.summary)?`<div class="rule-import-panels">${result.summary.map(item=>typeof item==='string'?`<p>${esc(item)}</p>`:`<details ${item.changed?'open':''}><summary>${esc(item.name)} · ${item.count} 张卡片${item.changed?' · 将更新':''}</summary>${ruleTable(item.rules||[])}</details>`).join('')}</div>`:''}${configSummaryView(result.configSummary)}${migrationSourcesView(result)}${progressionView(result.progression,'刷新后的宠物进阶门槛',currentProgression(latest(context)))}${conflictDetails(result.migration?.conflicts)}${result.migration?.legacyColumns?'<p class="rule-recovery-notice">旧表格的面板卡片将合并为共享卡片；原规则快照与冲突版本完整保留</p>':''}<form id="score-rule-sheet-confirm-form"><p class="rule-form-error" role="alert" hidden></p><div class="dialog-actions"><button type="button" class="button" data-do="rule-cancel">取消</button><button type="submit" class="button primary">${rebuilding?'确认重建配置表':'确认刷新整本配置'}</button></div></form>`);
   $('#modal .dialog').classList.add('score-rules-dialog');
  }catch(error){if(host.isConnected&&draft===active)status.textContent=errorText(error);}
  finally{if(el.isConnected)el.disabled=false;}
  return true;
 }
 async function handle(action,el,context){
  if(!handles(action))return false;if(busy)return true;
  const {state,selected,modal,toast}=context;
  try{
   if(action==='show-config'){openConfiguration(context);return true;}
   if(action==='show-reasons'){openManager(context);return true;}
   if(action==='rule-share-refresh'){const current=draft;openShare(context,{onReturn:current?.onReturn,onShared:current?.onShared});return true;}
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
    const command={type:'score',ids:[...draft.ids],delta:rule.delta,reason:rule.label,panelId:draft.panelId,expectedRulesKey:draft.expectedRulesKey,sharedRevision:draft.sharedRevision,expectedRule:{...rule},...(!enabled(state)&&Object.hasOwn(rule,'growthDelta')?{growthDelta:rule.growthDelta}:{})};
    draft={...draft,kind:'confirm',command};
    modal(`<h2>确认${rule.delta>0?'加':'扣'}分</h2><p>${esc(rule.label)}</p><p>为 ${command.ids.length} 位学生各 ${signed(rule.delta)} 分</p><p>${scoreGrowthNote(rule,state,command.ids)}</p><form id="score-rule-confirm-form"><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button primary">确认</button></div></form>`);
   }
  }catch(error){toast(errorText(error));}
  return true;
 }
 async function submit(event,context){
  const {state,act,toast,closeModal}=context,form=event.target;
  if(!['score-rule-edit-form','score-flexible-form','score-rule-confirm-form','score-rule-sheet-confirm-form','score-rule-share-form'].includes(form.id))return false;
  event.preventDefault();if(busy||form.dataset.saving)return true;
  const active=draft;
  try{
   if(!active||active.panelId!==pid(state))throw Error('面板已切换，请重新打开操作');
   if(form.id==='score-rule-sheet-confirm-form'&&active.needsPreview)throw Error('此预览已失效，请点击“重新预览后重试”核对最新内容');
   const fd=new FormData(form);let action;
   if(form.id==='score-rule-edit-form'){
    const raw=String(fd.get('growthDelta')??'').trim();
    if(raw&&!/^-?\d+$/.test(raw))throw Error('成长值必须为整数，或留空使用原规则');
    const changed=active.rules.map(r=>{if(r.id!==active.ruleId)return r;const next={...r,label:fd.get('label'),delta:Number(fd.get('delta'))};if(raw)next.growthDelta=Number(raw);else delete next.growthDelta;return next;});
    action={type:'rules.save',rules:ScoreRules.validateSharedRules(changed),expectedRules:active.rules,expectedKey:active.expectedKey,expectedRulesKey:active.expectedKey,sharedRevision:active.sharedRevision,panelId:active.panelId};
   }else if(form.id==='score-rule-share-form'){
    action={type:'rules.share',confirmed:true,expectedKey:active.expectedKey,expectedRulesKey:active.expectedKey,panelId:active.panelId};
   }else if(form.id==='score-flexible-form'){
    const reason=String(fd.get('reason')||'').trim();if(!reason||[...reason].length>120)throw Error('请填写1–120字的原因 / 理由');
    action={type:'score',ids:[...active.ids],delta:ScoreRules.flexibleDelta(fd.get('amount'),active.direction),reason,panelId:active.panelId};
   }else if(form.id!=='score-rule-sheet-confirm-form')action=active.command;
   const failureNotice=form.querySelector('.rule-form-error');if(failureNotice)failureNotice.hidden=true;busy=true;form.dataset.saving='1';form.querySelectorAll('button,input').forEach(e=>e.disabled=true);
   let ok;
   if(form.id==='score-rule-sheet-confirm-form'){const result=await context.api.file({command:active.rebuilding?'rules-workbook-export-apply':'rules-workbook-refresh-apply',token:active.token,panelId:active.panelId});context.acceptState(result,{type:'rules.save'});toast(active.rebuilding?'配置表已重建，原表备份保留':'整本配置已刷新，请留意各项生效时机');ok=true;}
   else{let failure;ok=await act(action,action.type==='rules.save'?'共享计分卡片与表格已保存':action.type==='rules.share'?'全部面板已使用共享计分卡片':'积分已更新',error=>{failure=error;});if(ok===false)throw failure||Error('操作尚未完成，原数据与当前草稿保留，请核对提示后重试');}
   if(ok!==false&&form.isConnected&&draft===active){if(form.id==='score-rule-share-form'){if(active.onShared)active.onShared(active.preview);else openManager(context,{onReturn:active.onReturn});}else if(form.id==='score-rule-edit-form'||form.id==='score-rule-sheet-confirm-form')returnTo(context,active);else{draft=null;closeModal();}}
  }catch(error){const message=errorText(error);toast(message);if(form.isConnected&&draft===active){let notice=form.querySelector('.rule-form-error');if(!notice){notice=root.document.createElement('p');notice.className='rule-form-error';notice.setAttribute('role','alert');form.prepend(notice);}const fileProblem=/EPERM|EBUSY|EACCES|占用|替换.*拒绝|写入|Excel|WPS|文件夹|工作簿|表格/.test(message);notice.textContent=message+'。原数据与当前草稿已保留。'+(fileProblem?'关闭正在编辑此表的 Excel / WPS 后可重试；若仍失败，请检查程序文件夹是否可写。':'请核对最新规则；如提示预览已过期，请重新预览或重新打开此窗口。');notice.hidden=false;const save=form.querySelector('[type=submit]');if(save){if(form.id==='score-rule-sheet-confirm-form'){active.needsPreview=true;save.type='button';save.dataset.do='rule-sheet-repreview';save.textContent='重新预览后重试';}else save.textContent=form.id==='score-rule-edit-form'?'重试保存到所有面板':'重试确认';}}}
  finally{busy=false;if(form.isConnected){delete form.dataset.saving;form.querySelectorAll('button,input').forEach(e=>e.disabled=false);}}
  return true;
 }
 root.RuleTools=Object.freeze({handles,handle,submit,openEditor,openManager,openConfiguration,restorePreview});
})(globalThis);
