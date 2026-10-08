from pathlib import Path
p=Path('src/app.js');s=p.read_text()
def replace_function(start,end,body):
 global s
 a=s.index(start);b=s.index(end,a);s=s[:a]+body+'\n'+s[b:]
s=s.replace('const petEnabled=()=>!!state.settings.petRules;','const petEnabled=()=>true;')
s=s.replace("const growthText=p=>!p.adopted?'等待领养':p.isEgg?'0 · 待破壳':p.maxed?'已满级':`${p.current}/${p.needed}`;","const growthText=p=>!p.adopted?'等待领养':`${p.current}/${p.needed}${p.isEgg?' · 待破壳':''}`;")
s=s.replace("p.isEgg?'待破壳':`LV.${p.level}${p.maxed?' · MAX':''}`","p.isEgg?'LV.0 · 待破壳':`LV.${p.level}`")
s=s.replace('成长 ${growthText(p)}','本级积分 ${growthText(p)}')
s=s.replace("${p.maxed?'成长完成':'成长值'}",'本级积分')
s=s.replace("petEnabled()?(state.petAccounts?.some(a=>a.mode==='legacy-linked')?'支持多选 · 旧关联伙伴仍同步成长':'支持多选 · 普通积分独立操作'):'支持多选 · 积分和宠物成长同步'","'支持多选 · 宠物等级随当前积分升降'")
s=s.replace('成长门槛按面板保留','宠物进阶也由所有面板共用')
s=s.replace("${petEnabled()?`当前六段成长门槛 ${state.settings.petRules.thresholds.join(' / ')}`:`当前保留旧版每 ${state.settings.petStep} 点成长升级规则`}；${petEnabled()?'独立宠物成长与原关联账本分别保留':'扣分不扣成长，撤销还原本次成长'}","所有宠物按照当前积分进阶；首次达到 ${PetScoreProgression.get(state).costs[0]} 分破壳，扣分跨过门槛会降级，负分仍显示蛋")
s=s.replace('首行为「姓名」「小组」，可加「头像名称」列填写头像文件名','首行为「姓名、性别、组号、头像」；性别与头像可留空，也兼容「小组、头像名称」表头')
s=s.replace("'\\ufeff姓名,小组,头像名称\\n示例同学,向日葵组,01-星星猫头鹰.png\\n'","'\\ufeff姓名,性别,组号,头像\\n示例同学,,1,01-星星猫头鹰.png\\n'")
s=s.replace('<label>小组<input name="group"','<label>性别<select name="gender"><option value="" ${!s.gender?\'selected\':\'\'}>未填写</option><option ${s.gender===\'男\'?\'selected\':\'\'}>男</option><option ${s.gender===\'女\'?\'selected\':\'\'}>女</option></select></label><label>小组<input name="group"')
s=s.replace("fields:{name:s.name,group:s.group,pet:s.pet","fields:{name:s.name,gender:s.gender||'',group:s.group,pet:s.pet")
s=s.replace("const data={name:fd.get('name'),group:fd.get('group')","const data={name:fd.get('name'),gender:fd.get('gender'),group:fd.get('group')")
s=s.replace('调整领养状态或更换伙伴会保留累计成长','调整领养状态或更换伙伴不会修改积分，等级按当前积分计算')
s=s.replace("if(action==='pet-undo')return act({type:'pet.undo',logId:el.dataset.id},'已按原周期撤销整笔成长，普通积分不变');","if(action==='pet-undo')return toast('养成历史只读保留；请在积分记录中撤销当前积分操作');")
# Entire score-card action keeps current panel/rule/cycle/restore guards.
a=s.index(" if(action==='pet-reason'){");b=s.index(" if(action==='pet-album')",a)
s=s[:a]+''' if(action==='pet-reason'){
  if(rewardBusy)return;const context=pendingRewardContext,reason=context?.reasons[Number(el.dataset.index)];if(!reason)return;
  if(context.panelId!==PanelTools.currentId(state))return toast('面板已变化，请重新打开积分窗口');
  if(!petReasons().some(r=>r.id===reason.id)||!ScoreRules.same([reason],petReasons().filter(r=>r.id===reason.id)))return toast('计分卡片已修改，请重新打开积分窗口');
  rewardBusy=true;const ids=[...pendingRewardIds];closeModal();
  try {await act({type:'score',ids,delta:reason.delta,reason:reason.label,panelId:context.panelId,expectedRulesKey:context.expectedRulesKey,sharedRevision:context.sharedRevision,expectedRule:reason,expectedCycles:context.expectedCycles,expectedProgressionKey:context.progressionKey},'积分已记录，宠物等级已同步计算');}finally{rewardBusy=false;}return;
 }
'''+s[b:]
replace_function('function petMoreDialog(){','function petDetailView(','''function petMoreDialog(){
 const rules=PetScoreProgression.get(state),cumulative=PetScoreProgression.cumulative(rules);
 modal(`<h2>伙伴设置与图鉴</h2><div class="pet-secondary-menu"><button type="button" class="button" data-do="pet-rules"><strong>进阶规则</strong><span>所有面板共用一套积分门槛</span></button><button type="button" class="button" data-do="pet-catalog"><strong>${Object.keys(petNames).length} 种伙伴图鉴</strong><span>浏览每种伙伴的七级造型</span></button></div><section class="pet-menu-rules"><h3>当前积分决定等级</h3><p>低于 ${rules.costs[0]} 分时显示蛋（LV.0），负分也保持蛋。加分跨门槛升级，扣分跨门槛降级。</p><p>LV.1–LV.7 累计积分门槛：${cumulative.join(' / ')}</p><p>7级以后每级需要 ${rules.repeatCost} 分；数字等级继续增加，外观保留第7种形态。领养和换宠不修改积分。</p></section>`);
}''')
replace_function('function petDetailView(', 'function rewardDialog(){', '''function petDetailView(s){
 const p=growth(s),rules=PetScoreProgression.get(state);
 const heading=`<div class="pet-detail-heading"><button class="text-button" data-do="pet-back">‹ 返回宠物花园</button><div class="button-row"><button class="button" data-do="edit-student" data-id="${s.id}">学生档案</button><button class="button" data-do="pet-honors" data-id="${s.id}">历史荣誉</button><button class="button" data-do="pet-focus" data-id="${s.id}">◧ 放到悬浮侧栏</button></div></div>`;
 if(!p.adopted)return `${heading}<section class="unadopted-detail"><div class="unadopted-egg">${petEgg(true)}</div><h2>${esc(s.name)}正在等待新伙伴</h2><p>领养不会修改积分。伙伴等级按照当前 ${s.score} 分计算，低于 ${rules.costs[0]} 分时保持蛋。</p><button class="button primary large-button" data-do="pet-adopt" data-id="${s.id}">领养伙伴</button></section>`;
 return `${heading}<section class="pet-detail-hero"><div class="pet-big-stage pet-${p.pet}"><span class="stage-constellation">✧ · ✦ · ✧</span>${currentPetArt(p,true)}<span class="stage-platform"></span><span class="pill">${esc(currentPetStage(p))}</span></div><div class="pet-profile"><span class="eyebrow">${esc(s.group)} · 专属成长伙伴</span><h2>${esc(s.name)}的${esc(petNames[p.pet])}</h2><span class="level-badge">${esc(currentPetLabel(p))}</span><p class="pet-detail-copy">${p.isEgg?`达到 ${rules.costs[0]} 分，伙伴就会破壳`:'每一次积分变化，都能看见伙伴的变化'}</p><div class="pet-growth"><strong>本级积分 ${growthText(p)}</strong><span>还差 ${p.needed-p.current} 分${p.isEgg?'破壳':'升级'}</span></div><div class="progress"><i style="width:${growthPercent(p)}%"></i></div><div class="pet-totals"><div><strong>${s.score}</strong><small>当前积分</small></div><div><strong>${p.level}</strong><small>当前等级</small></div><div><strong>${p.medalTotal}</strong><small>永久荣誉徽章</small></div></div><div class="button-row"><button class="button primary large-button" data-do="pet-reward" data-id="${s.id}">✦ 加减积分</button><button class="button" data-do="pet-album" data-id="${s.id}">进化图鉴</button></div><p class="pet-fine-print">全班与所有面板共用一套积分门槛。加分升级、扣分降级，低于首级门槛回到蛋；第7种外观之后，数字等级仍继续增加。领养、换宠不会清零积分。</p><details class="pet-history-note"><summary>已有养成与荣誉记录</summary><p>已保存的成长 ${p.historicalGrowth??0}、毕业相册与徽章继续保留；这些历史数值不参与当前等级计算。</p></details></div></section>`;
}
''')
replace_function('function rewardDialog(){','function stageRuleFields(','''function rewardDialog(){
 const requested=new Set(pendingRewardIds),students=state.students.filter(s=>requested.has(s.id)&&growth(s).adopted),skipped=requested.size-students.length;
 if(!students.length)return toast('请先为选中的同学领养宠物');pendingRewardIds=students.map(s=>s.id);
 pendingRewardContext={panelId:PanelTools.currentId(state),enabled:true,reasons:petReasons(),expectedRulesKey:ScoreRules.key(state),sharedRevision:state.sharedScoreRules?.revision,progressionKey:PetScoreProgression.key(state),expectedCycles:students.map(s=>({id:s.id,cycleId:growth(s).activeCycleId}))};
 modal(`<h2>为伙伴记录积分</h2><p class="reward-students">${esc(students.map(s=>s.name).join('、'))}</p><p>这里直接加减学生当前积分，宠物等级同步升降，可在积分记录中撤销。</p>${students.length===1?`<button class="button pet-switch-entry" data-do="pet-switch" data-id="${students[0].id}">换宠物</button>`:''}${skipped?`<p class="rule-warning">本次跳过 ${skipped} 位尚未领养的同学</p>`:''}<div class="reason-editor-toolbar"><div><strong>课堂计分卡片</strong><small>点卡片记分 · 点“编辑”修改卡片</small></div><button type="button" class="button" data-do="pet-manage-reasons">编辑计分卡片</button></div><div class="pet-reasons">${pendingRewardContext.reasons.map((r,i)=>`<div class="reason-editable-card"><button class="reason-card ${r.delta<0?'minus':''}" data-do="pet-reason" data-index="${i}"><span>${esc(r.label)}</span><strong>${r.delta>0?'+':''}${r.delta}<small> 分</small></strong><em>宠物等级随积分变化</em></button><button type="button" class="reason-edit-button" data-do="pet-edit-reason" data-id="${r.id}" aria-label="编辑${esc(r.label)}计分卡片">编辑</button></div>`).join('')}</div><form id="pet-growth-form" data-panel-id="${PanelTools.currentId(state)}"><h3>自定义积分</h3><div class="pet-custom-growth"><label>分值<input name="delta" type="number" min="1" max="100" value="1" step="1" required></label><label>原因<input name="reason" maxlength="80" value="课堂表现" required></label></div><div class="button-row"><button class="button" type="submit" name="direction" value="minus">− 扣分</button><button class="button primary" type="submit" name="direction" value="plus">＋ 加分</button></div></form><p class="pet-fine-print">${students.length>1?'本次为批量操作，撤销时会同时还原所有选中学生。':'可在积分记录中撤销整笔。'}</p>`);
 $('#modal .dialog').classList.add('reward-dialog');
}''')
replace_function('function stageRuleFields(', 'function capturePetAlbumView(){', '''function stageRuleFields(values){return `<div class="pet-threshold-grid">${values.map((v,i)=>`<label>LV.${i} → LV.${i+1}<input class="pet-threshold" name="threshold-${i}" type="number" min="1" max="1000000000" step="1" value="${v}" required><small>这一段所需积分</small></label>`).join('')}</div>`;}
function rulesDialog(){
 const rules=PetScoreProgression.get(state),cumulative=PetScoreProgression.cumulative(rules);
 modal(`<h2>全局宠物进阶规则</h2><p class="egg-rule-summary">所有面板、所有伙伴都按学生当前积分计算等级。低于首级门槛时为蛋（LV.0），扣分跨过门槛会降级；不修改已有积分或历史记录。</p><form id="pet-rules-form" data-panel-id="${PanelTools.currentId(state)}" data-progression-key="${esc(PetScoreProgression.key(state))}">${stageRuleFields(rules.costs)}<label>LV.7 以后每级所需积分<input id="pet-repeat-cost" name="repeatCost" type="number" min="1" max="1000000000" value="${rules.repeatCost}" required></label><p>当前 LV.1–LV.7 累计门槛：${cumulative.join(' / ')}</p><p class="rule-warning">输入的是各段所需积分；配置.xlsx“宠物进阶”会同时列出累计门槛。第7种外观之后仍可升级，外观保持第7阶段。</p><button class="button" type="button" data-do="pet-preset" data-preset="standard">填写标准规则</button><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button primary">保存全局规则</button></div></form><label class="pet-visibility-setting"><input id="pet-hide-late" type="checkbox" ${state.settings.hideLateForms?'checked':''}>隐藏图鉴最后两种形态（LV.6 / LV.7，立即生效）</label><p class="pet-fine-print">图鉴显示设置只影响预览，不改变真实积分、等级或伙伴卡片。</p>`);
 $('#modal .dialog').classList.add('pet-rules-dialog');
}''')
# Replace obsolete direct operation and adoption promises while preserving historical album data.
replace_function('function graduationDialog(', 'function showGraduationFeedback(', "function graduationDialog(){return toast('等级由当前积分决定，不再通过毕业重置。已有毕业相册与徽章保留，可在历史荣誉查看');}")
replace_function('function adoptionDialog(', 'function petRecordsView(', '''function adoptionDialog(id){const s=state.students.find(s=>s.id===id);if(!s)return;const p=growth(s);if(p.adopted)return toast('这位同学已经有成长伙伴');modal(`<h2>${esc(s.name)}，迎接新的成长伙伴</h2><p>领养不会扣除或清空当前 ${s.score} 分。伙伴按同一套积分规则显示等级；低于 ${PetScoreProgression.get(state).costs[0]} 分时显示蛋。</p><form id="pet-adopt-form" data-id="${s.id}" data-cycle-id="${p.activeCycleId||''}" data-panel-id="${PanelTools.currentId(state)}">${petChoicePicker(s.pet)}<div class="dialog-actions"><button class="button" type="button" data-do="modal-close">再想想</button><button class="button primary" type="submit">确认领养</button></div></form>`);$('#modal .dialog').classList.add('student-edit-dialog');}
''')
# Score history is the authoritative explanation for current level changes.
a=s.index('function petRecordsView(');b=s.index('function petRankingsView(',a)
s=s[:a]+'''function petRecordsView(id='',compact=false){
 const logs=[...state.logs].reverse().filter(log=>!id||log.changes.some(change=>change.id===id)).slice(0,compact?8:300);
 const legacy=[...(state.petLogs||[])].reverse().filter(log=>!id||log.changes.some(change=>change.id===id));
 return `<section class="pet-history"><h2>积分与等级记录</h2><p>等级由当前积分计算。撤销积分后，各伙伴按实际积分重新显示。</p><div class="log-list">${logs.map(log=>`<article class="log-row ${log.undone?'undone':''}"><div class="log-detail"><strong>${esc(log.reason)}</strong><p>${esc(log.changes.map(c=>c.name||state.students.find(s=>s.id===c.id)?.name||'已移除学生').join('、'))}</p><small>${new Date(log.timestamp).toLocaleString('zh-CN',{hour12:false})}</small></div><strong class="log-delta ${log.delta<0?'negative':''}">${log.delta>0?'+':''}${log.delta}</strong>${log.undone?'<span class="muted">已撤销</span>':`<button class="button" data-do="undo" data-id="${log.id}">撤销积分</button>`}</article>`).join('')||'<div class="empty">还没有积分记录</div>'}</div>${legacy.length?`<details><summary>已保存的养成历史（${legacy.length}条）</summary><p>这些记录只读保留，不参与当前积分等级计算。</p>${legacy.slice(0,compact?8:300).map(log=>`<p>${esc(log.reason)} · ${new Date(log.timestamp).toLocaleString('zh-CN',{hour12:false})}${log.undone?' · 已撤销':''}</p>`).join('')}</details>`:''}</section>`;
}
'''+s[b:]
a=s.index("  if(form.id==='pet-rules-form'){");b=s.index("  }else if(form.id==='pet-switch-form')",a)
s=s[:a]+'''  if(form.id==='pet-rules-form'){
   const petProgression=PetScoreProgression.validate({version:1,costs:[...form.querySelectorAll('.pet-threshold')].map(input=>Number(input.value)),repeatCost:Number(data.get('repeatCost'))});
   command={type:'petProgression.update',petProgression,expectedProgressionKey:form.dataset.progressionKey};message='全局进阶规则已保存，所有面板按当前积分重算等级';
  }else if(form.id==='pet-growth-form'){
   if(!pendingRewardContext||pendingRewardContext.panelId!==PanelTools.currentId(state))throw Error('积分目标已变化，请重新选择');const amount=Number(data.get('delta')),reason=String(data.get('reason')||'').trim();if(!Number.isInteger(amount)||amount<1||amount>100)throw Error('分值需为1–100整数');if(!reason)throw Error('请填写积分原因');command={type:'score',ids:[...pendingRewardIds],expectedCycles:pendingRewardContext.expectedCycles,expectedProgressionKey:pendingRewardContext.progressionKey,delta:amount*(event.submitter?.value==='minus'?-1:1),reason};message='积分已更新，宠物等级同步计算';
'''+s[b:]
# All now-active draw rewards use ordinary scores and retain the old draw-event guard.
s=s.replace("...(awards.length===1?{type:'pet.growth',...awards[0]}:{type:'pet.growth.mixed',awards})","...(awards.length===1?{type:'score',...awards[0]}:{type:'score.mixed',awards:awards.flatMap(a=>a.ids.map(id=>({id,delta:a.delta}))),expectedCycles:awards.flatMap(a=>a.expectedCycles)})")
s=s.replace('已记录宠物成长，普通积分不变','已记录积分，宠物等级同步计算').replace('每位已领养组员分别获得成长；普通积分和普通点名记录保持不变','每位已领养组员分别获得积分，伙伴等级同步变化；普通点名记录保持不变').replace('每位成长<input','每位积分<input').replace('已记录成长','已记录积分')
s=s.replace('初生蛋是共同的序章，第一次成长后按原门槛进入下方七种形态。','初生蛋是共同的序章，达到首级积分门槛后破壳。七种形态对应等级1–7，更高等级保留第7种外观。')
s=s.replace("p.isEgg?'第一次增加成长即破壳'", "p.isEgg?`达到 ${PetScoreProgression.get(state).costs[0]} 分破壳`")
s=s.replace("hatch?'第一次成长 · 破壳'", "hatch?'达到首级积分 · 破壳'")
s=s.replace('积分已撤销，关联宠物成长已同步回退','积分已撤销，宠物等级已同步计算')
s=s.replace('旧版徽章计入总荣誉','已有徽章计入总荣誉').replace('第一位满级伙伴毕业后，会出现在这里','已有毕业快照会保留在这里；当前等级不通过毕业重置')
s=s.replace('小组鼓励会逐人增加成长','小组鼓励会逐人增加积分')
s=s.replace('成长规则','进阶规则')
p.write_text(s)
