(function (root) {
  'use strict';
  const $ = selector => root.document.querySelector(selector), model = root.PetProgress;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pid = state => state.panels?.activeId || 'panel_default';
  const requestId = () => `px_${root.crypto.randomUUID()}`;
  const labels = {growth:'批量加减成长', adopt:'未领养者领养', switch:'批量换宠', graduate:'满级宠物毕业'};
  let draft = null, busy = false, sequence = 0;
  const handles = action => action.startsWith('px-');
  const handlesForm = id => ['px-batch-form','px-policy-form','px-wallet-form'].includes(id);
  function begin(context, kind, id = '') { draft = {kind, id, token:++sequence, state:context.state, revision:context.state.revision, panelId:pid(context.state), requestId:requestId(), stale:false}; }
  const visible = () => draft && $('#modal [data-px-token]')?.dataset.pxToken === String(draft.token);
  const header = () => `<div class="px-content" data-px-token="${draft.token}"><p class="px-stale" role="alert" hidden>课堂数据已更新，请刷新预览后再保存 <button type="button" class="text-button" data-do="px-refresh">刷新</button></p>`;
  function show(context, html) { context.modal(html); $('#modal .dialog')?.classList.add('px-dialog'); }
  function entry() { return '<button class="button" data-do="px-batch">批量操作 ▾</button><button class="button" data-do="px-features">全部功能</button>'; }
  function honorActions(id = '') { return `<button class="button" data-do="px-wallet" data-id="${esc(id)}">徽章兑换 / 账本</button><button class="button" data-do="px-card" data-id="${esc(id)}">导出荣誉卡 PNG</button>`; }
  function features(context) {
    begin(context, 'features');
    const items = [
      ['pet-tab','学生伙伴','查看每位同学的成长伙伴','students'],['pet-tab','按小组看','小组展示与组员鼓励','groups'],
      ['pet-tab','宠物排行榜','总徽章、当前等级、小组均值','rankings'],['pet-tab','成长记录','查看与撤销原周期成长','records'],
      ['pet-draw','抽学生 / 抽小组','仅抽取已领养的伙伴'],['open-timer','课堂计时器','打开独立悬浮倒计时'],['px-search','搜索学生','回到学生伙伴并定位搜索'],['px-lock','课堂锁','设置课堂密码或锁定本应用'],['pet-rules','成长规则','六段门槛与旧版兼容'],
      ['pet-catalog','全部宠物图鉴',`${Object.keys(root.PetArt.names).length}种原创伙伴 × 7阶段`],['pet-honors','毕业荣誉世界','永久荣誉与历史毕业相册'],
      ['px-batch','批量操作','预览资格后一次保存'],['px-policy','成长下限设置','低于零时拒绝或截到零'],
      ['px-wallet','徽章兑换 / 账本','兑换与撤销独立记录'],['px-card','导出荣誉卡','本地保存 PNG 成长纪念卡'],
      ['open-pets','课堂展示','打开全班伙伴展示窗'],['open-pet','悬浮宠物侧栏','打开个人成长窗口']
    ];
    show(context, `${header()}<h2>宠物全部功能</h2><p>领养、成长、毕业与荣誉，都从这里开始</p><div class="px-feature-grid">${items.map(([action,title,note,tab]) => `<button type="button" class="px-feature" data-do="px-feature" data-entry="${action}" data-tab="${tab || ''}"><strong>${title}</strong><small>${note}</small></button>`).join('')}</div><p class="px-rule-note">批量资格、成长下限与徽章账本是花伴课堂的明确规则；视频未展示的内部细节采用可审核的本应用实现。</p></div>`);
  }
  function batch(context, selectedIds, restoredOptions) {
    begin(context, 'batch'); draft.selected = [...(selectedIds || context.selected || [])];
    const state = context.state, chosen = new Set(draft.selected), names = root.PetArt.names;
    show(context, `${header()}<h2>批量宠物操作</h2><p>先选择同学和操作，检查资格预览。确认后仅执行符合资格的同学，整笔保存</p><form id="px-batch-form"><div class="px-fields"><label>操作<select name="operation">${Object.entries(labels).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label data-px-pet hidden>目标伙伴<select name="pet">${Object.entries(names).map(([id,name])=>`<option value="${id}">${esc(name)}</option>`).join('')}</select></label><label data-px-growth>成长增减<input type="number" name="delta" value="1" min="-100" max="100" step="1"></label><label data-px-growth>原因<input name="reason" maxlength="120" value="批量宠物成长"></label></div><div class="px-select-tools"><button type="button" class="button" data-do="px-select-all">全选</button><button type="button" class="button" data-do="px-select-none">取消全选</button><span class="px-selection-count"></span></div><div class="px-student-list">${state.students.map(s=>`<label><input type="checkbox" name="student" value="${s.id}" ${chosen.has(s.id)?'checked':''}><span><strong>${esc(s.name)}</strong><small>${esc(s.group)}</small></span></label>`).join('') || '<p>暂无学生，请先添加名单</p>'}</div><div id="px-batch-preview" aria-live="polite"></div><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button primary" disabled>确认批量操作</button></div></form></div>`);
    if (restoredOptions) for (const name of ['operation','pet','delta','reason']) if (restoredOptions[name] !== undefined) $('#px-batch-form').elements[name].value = restoredOptions[name];
    $('#px-batch-form').addEventListener('input', updatePreview); $('#px-batch-form').addEventListener('change', updatePreview); updatePreview();
  }
  function batchOptions() {
    const form = $('#px-batch-form'), data = new FormData(form);
    return {operation:data.get('operation'), ids:data.getAll('student'), pet:data.get('pet'), delta:Number(data.get('delta')), reason:String(data.get('reason') || '').trim()};
  }
  function updatePreview() {
    if (!visible() || draft.kind !== 'batch') return;
    const form = $('#px-batch-form'), box = $('#px-batch-preview'), options = batchOptions(), growth = options.operation === 'growth';
    form.querySelectorAll('[data-px-growth]').forEach(el=>el.hidden=!growth); form.querySelector('[data-px-pet]').hidden=!['adopt','switch'].includes(options.operation);
    form.querySelector('.px-selection-count').textContent=`已选 ${options.ids.length} 位同学`;
    const submit = form.querySelector('[type=submit]');
    try {
      const preview = model.batchPreview(draft.state, options); draft.preview=preview;
      const eligible=preview.rows.filter(v=>v.eligible);
      box.innerHTML=`<div class="px-preview-summary"><strong>可执行 ${eligible.length} 人</strong><span>已排除 ${preview.excluded.length} 人</span></div><div class="px-preview-list">${preview.rows.map(row=>`<article class="${row.eligible?'eligible':'excluded'}"><strong>${esc(row.name)}</strong><span>${row.eligible?(growth?`成长 ${row.growth} → ${row.afterGrowth}（实际 ${row.actualDelta>=0?'+':''}${row.actualDelta}） · LV.${row.level} → LV.${row.afterLevel}`:labels[options.operation]):esc(row.reason)}</span></article>`).join('') || '<p>勾选学生后，显示每位同学的执行资格</p>'}</div><p class="px-rule-note">${options.operation==='graduate'?'毕业留下永久快照并增加1枚荣誉徽章，当前伙伴回到未领养状态。':options.operation==='adopt'?'已有伙伴会排除。未毕业的休眠伙伴保留已有成长；毕业后再领养从0成长开始。':options.operation==='switch'?'只更换当前外形，成长、积分、已有荣誉与毕业相册保留。':`当前下限：${model.growthFloor(draft.state)==='clamp'?'低于0时截到0，每人按实际差额记账':'低于0时拒绝，该同学不进入执行名单'}。撤销始终按原周期实际差额执行。`}</p>`;
      submit.disabled=busy||draft.stale||!eligible.length; submit.textContent=`确认${labels[options.operation]}（${eligible.length}人）`;
    } catch(error) { draft.preview=null; box.textContent=error.message;submit.disabled=true; }
  }
  function policy(context) {
    begin(context,'policy'); const enabled=!!context.state.settings.petRules;
    show(context, `${header()}<h2>成长下限设置</h2><p>宠物等级由当前累计成长和六段门槛计算；扣成长跨过门槛会降级</p>${enabled?`<form id="px-policy-form"><label class="px-option"><input type="radio" name="growthFloor" value="reject" ${model.growthFloor(context.state)==='reject'?'checked':''}><span><strong>低于0时拒绝</strong><small>保留旧班默认行为；整笔普通成长操作不保存</small></span></label><label class="px-option"><input type="radio" name="growthFloor" value="clamp" ${model.growthFloor(context.state)==='clamp'?'checked':''}><span><strong>低于0时截到0</strong><small>例如现有2成长扣5，实际扣2；撤销只还2</small></span></label><p class="px-rule-note">该选择只影响新成长扣减；不改历史记录。撤销若会使原周期低于0，始终拒绝整笔撤销。此为花伴课堂规则。</p><div class="dialog-actions"><button type="button" class="button" data-do="modal-close">取消</button><button type="submit" class="button primary">保存下限规则</button></div></form>`:'<p>请先启用六段成长规则，再设置成长下限</p><button class="button primary" data-do="pet-enable">启用成长规则</button>'}</div>`);
  }
  function chooseStudent(context, kind) {
    begin(context,kind);
    show(context, `${header()}<h2>${kind==='card'?'选择荣誉卡同学':'选择徽章账本'}</h2><div class="px-owner-list">${context.state.students.map(s=>{const p=model.profile(context.state,s);return `<button type="button" class="button" data-do="px-${kind}" data-id="${s.id}"><strong>${esc(s.name)}</strong><small>总荣誉 ${p.medalTotal} · 可用 ${p.medalAvailable??'未启用'}</small></button>`;}).join('') || '<p>暂无学生</p>'}</div></div>`);
  }
  function openSearch(context) {
    begin(context,'search');
    show(context,`${header()}<h2>搜索成长伙伴</h2><label>姓名或小组<input id="px-student-search" type="search" placeholder="输入姓名或小组" autocomplete="off"></label><p id="px-search-count" aria-live="polite"></p><div class="px-owner-list">${context.state.students.map(s=>`<button type="button" class="button" data-do="px-search-pick" data-id="${s.id}"><strong>${esc(s.name)}</strong><small>${esc(s.group)}</small></button>`).join('')}</div><p class="px-rule-note">选择同学后显示这位同学的悬浮宠物</p></div>`);
    const update=()=>{const query=$('#px-student-search').value.trim().toLocaleLowerCase();let count=0;$('#modal .px-owner-list').querySelectorAll('button').forEach(button=>{button.hidden=!button.textContent.toLocaleLowerCase().includes(query);if(!button.hidden)count++;});$('#px-search-count').textContent=count?`找到 ${count} 位同学`:'没有找到匹配的同学';};
    $('#px-student-search').addEventListener('input',update);update();$('#px-student-search').focus();
  }
  function wallet(context, id) {
    if(!id)return chooseStudent(context,'wallet');
    const student=context.state.students.find(s=>s.id===id);if(!student)throw Error('找不到这位学生');
    begin(context,'wallet',id);const p=model.profile(context.state,id),account=context.state.petAccounts?.find(a=>a.studentId===id),transactions=account?.badgeTransactions||[];
    const undone=new Set(transactions.filter(t=>t.type==='undo').map(t=>t.redemptionId));
    show(context,`${header()}<h2>${esc(student.name)}的徽章账本</h2><div class="px-honor-stats"><span>总荣誉<strong>${p.medalTotal}</strong></span><span>净兑换<strong>${p.medalSpent}</strong></span><span>可用徽章<strong>${p.medalAvailable??'未启用'}</strong></span></div><p class="px-rule-note">总荣誉永久保留；可用＝总荣誉－净兑换。旧奖章作为启用时基数保留，本账本不虚构此前兑换或毕业记录。</p>${p.enabled?`<form id="px-wallet-form"><div class="px-fields"><label>兑换徽章数<input name="amount" type="number" min="1" max="${Math.max(1,p.medalAvailable)}" step="1" value="1" required></label><label>兑换说明<input name="reason" maxlength="120" placeholder="例如：兑换课堂奖励" required></label></div><div class="dialog-actions"><button class="button primary" type="submit" ${p.medalAvailable?'':'disabled'}>确认兑换</button></div></form>`:'<button class="button" data-do="pet-enable">启用成长与徽章账本</button>'}<h3>兑换与撤销记录</h3><div class="px-transactions">${[...transactions].reverse().map(t=>`<article><div><strong>${esc(t.reason)}</strong><small>${new Date(t.timestamp).toLocaleString('zh-CN',{hour12:false})}</small></div><b>${t.type==='redeem'?'−':'+'}${t.amount}</b>${t.type==='redeem'?(undone.has(t.id)?'<small>已撤销</small>':`<button type="button" class="button" data-do="px-undo" data-id="${id}" data-redemption-id="${t.id}">撤销兑换</button>`):'<small>返还可用徽章</small>'}</article>`).join('')||'<p>还没有徽章兑换记录</p>'}</div><div class="dialog-actions"><button class="button" data-do="px-card" data-id="${id}">查看荣誉卡</button><button class="button" data-do="modal-close">关闭</button></div></div>`);
  }
  function card(context,id) {
    if(!id)return chooseStudent(context,'card');
    begin(context,'card',id);const data=model.honorCard(context.state,id);draft.card=data;
    show(context,`${header()}<h2>${esc(data.studentName)}的成长荣誉卡</h2><div class="px-honor-card"><p>${esc(data.className)} · ${esc(data.groupName)}</p><div class="px-card-art">${root.PetArt.render(data.pet,data.shape)}</div><h3>${esc(data.studentName)}</h3><p>${data.adopted?'当前 LV.'+data.level:'等待新伙伴'} · 累计毕业 ${data.graduationCount} 次</p><div class="px-honor-stats"><span>总荣誉<strong>${data.totalHonors}</strong></span><span>可用徽章<strong>${data.availableBadges??'未启用'}</strong></span></div><small>每一次努力，都值得被看见</small></div><p class="px-rule-note">导出内容包含班级、姓名、小组与荣誉数据，仅保存到你选择的本地 PNG 文件</p><div class="dialog-actions"><button class="button" data-do="modal-close">取消</button><button class="button primary" data-do="px-card-save">保存荣誉卡 PNG</button></div></div>`);
  }
  function sync(state) {
    if(!visible()||busy||['features'].includes(draft.kind))return;
    if(state.revision===draft.revision&&pid(state)===draft.panelId)return;
    draft.stale=true;const warning=$('#modal .px-stale');if(warning)warning.hidden=false;
    $('#modal .px-content')?.querySelectorAll('[type=submit],[data-do=px-undo],[data-do=px-card-save]').forEach(button=>button.disabled=true);
  }
  function assertDraft(context) { if(!visible()||draft.panelId!==pid(context.state))throw Error('面板或操作窗口已变化，请重新打开'); sync(context.state);if(draft.stale)throw Error('课堂数据已更新，请刷新预览后重新操作'); }
  function drawText(ctx,text,x,y,maxWidth) { let value=String(text);while(value.length>1&&ctx.measureText(value).width>maxWidth)value=value.slice(0,-1);ctx.fillText(value===String(text)?value:value+'…',x,y); }
  async function cardPng(data) {
    const canvas=root.document.createElement('canvas');canvas.width=1200;canvas.height=1500;const c=canvas.getContext('2d');
    c.fillStyle='#fff8ef';c.fillRect(0,0,1200,1500);c.fillStyle='#f9e4b5';c.fillRect(56,56,1088,1388);c.fillStyle='#ffffff';c.fillRect(76,76,1048,1348);
    c.textAlign='center';c.fillStyle='#9a622b';c.font='bold 42px sans-serif';c.fillText('花伴课堂 · 成长荣誉卡',600,168);
    c.fillStyle='#71665e';c.font='28px sans-serif';drawText(c,data.className+' · '+data.groupName,600,230,930);
    const svg=root.PetArt.render(data.pet,data.shape,{animated:false});const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('宠物图像生成失败，请重试'));image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);});
    c.drawImage(image,370,275,460,460);c.fillStyle='#483b36';c.font='bold 64px sans-serif';drawText(c,data.studentName,600,815,950);
    c.font='32px sans-serif';c.fillText((data.adopted?'当前 LV.'+data.level:'等待新伙伴')+' · 累计毕业 '+data.graduationCount+' 次',600,885);
    c.fillStyle='#9a622b';c.font='bold 76px sans-serif';c.fillText(String(data.totalHonors),370,1038);c.fillText(String(data.availableBadges??'—'),830,1038);
    c.fillStyle='#71665e';c.font='30px sans-serif';c.fillText('总荣誉徽章',370,1094);c.fillText('可用徽章',830,1094);
    c.font='28px sans-serif';c.fillText('每一次努力，都值得被看见',600,1220);c.font='21px sans-serif';c.fillText('总荣誉永久保留 · 可用徽章＝总荣誉－本账本净兑换',600,1300);
    c.fillText('花伴课堂本地生成',600,1355);return canvas.toDataURL('image/png');
  }
  async function handle(action,element,context) {
    if(!handles(action))return false;if(busy)return true;
    try {
      if(action==='px-features'){features(context);return true;}
      if(action==='px-search'){
        context.closeModal();await context.invoke?.('pet-tab',{dataset:{tab:'students'}});
        const search=$('#search');if(search){search.focus();search.select();}else openSearch(context);return true;
      }
      if(action==='px-lock'){
        context.closeModal();if(typeof context.api.lock!=='function'){context.toast('课堂锁请在桌面版使用');return true;}
        const status=await context.api.lock({command:'status'});
        if(status.configured)await context.api.lock({command:'lock'});else await root.ClassroomLockUI.openSetup();return true;
      }
      if(action==='px-batch'){batch(context);return true;}
      if(action==='px-policy'){policy(context);return true;}
      if(action==='px-wallet'){wallet(context,element.dataset.id);return true;}
      if(action==='px-card'){card(context,element.dataset.id);return true;}
      if(action==='px-feature'){
        const entry=element.dataset.entry;context.closeModal();
        if(handles(entry))return handle(entry,element,context);
        if(context.invoke)await context.invoke(entry,element);return true;
      }
      if(action==='px-refresh'){
        const previous=draft;if(previous?.kind==='batch'){const options=batchOptions();batch(context,options.ids,options);}
        else if(previous?.kind==='policy')policy(context);else if(previous?.kind==='wallet')wallet(context,previous.id);else if(previous?.kind==='card')card(context,previous.id);else if(previous?.kind==='search')openSearch(context);return true;
      }
      assertDraft(context);
      if(action==='px-search-pick'){
        busy=true;element.disabled=true;const token=draft.token;
        const ok=await context.act({type:'pet.focus',id:element.dataset.id,panelId:draft.panelId},'已显示这位同学的成长伙伴');
        if(ok!==false&&visible()&&draft.token===token)context.closeModal();return true;
      }
      if(action==='px-select-all'||action==='px-select-none'){$('#px-batch-form').querySelectorAll('[name=student]').forEach(input=>input.checked=action==='px-select-all');updatePreview();return true;}
      if(action==='px-undo'){
        busy=true;element.disabled=true;const id=draft.id,token=draft.token;
        const ok=await context.act({type:'pet.badge.undo',id,redemptionId:element.dataset.redemptionId,requestId:requestId(),expectedRevision:draft.revision,panelId:draft.panelId},'兑换已撤销，可用徽章已返还；总荣誉保留');
        if(ok!==false&&visible()&&draft.token===token)context.closeModal();return true;
      }
      if(action==='px-card-save'){
        busy=true;element.disabled=true;const dataUrl=await cardPng(draft.card);
        const saved=await context.api.file({command:'honor-png',panelId:draft.panelId,expectedRevision:draft.revision,dataUrl,title:draft.card.studentName+'-成长荣誉卡'});
        if(saved)context.toast('荣誉卡 PNG 已保存');return true;
      }
    } catch(error) {context.toast(error.message);} finally {busy=false;if(element?.isConnected)element.disabled=false;}
    return true;
  }
  async function submit(event,context) {
    const form=event.target;if(!handlesForm(form.id))return false;event.preventDefault();if(busy||form.dataset.saving)return true;
    let controls=[];
    try {
      assertDraft(context);const data=new FormData(form);let action,message;
      if(form.id==='px-batch-form'){
        const options=batchOptions(),preview=model.batchPreview(draft.state,options);if(!preview.eligibleIds.length)throw Error('没有符合资格的学生');
        if(options.operation==='growth'&&!options.reason)throw Error('请填写成长原因');
        action={type:'pet.batch',...options,ids:preview.eligibleIds};message=`已为 ${preview.eligibleIds.length} 位同学完成${labels[options.operation]}`;
      }else if(form.id==='px-policy-form'){action={type:'pet.growth-policy',growthFloor:data.get('growthFloor')};message='成长下限已保存，历史记录保持原差额';}
      else{action={type:'pet.badge.redeem',id:draft.id,amount:Number(data.get('amount')),reason:String(data.get('reason')||'').trim()};message='兑换已保存，总荣誉徽章保留';}
      action={...action,panelId:draft.panelId,requestId:draft.requestId,expectedRevision:draft.revision};
      const token=draft.token;busy=true;form.dataset.saving='1';controls=[...form.querySelectorAll('input,select,button')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
      const ok=await context.act(action,message);if(ok!==false&&form.isConnected&&draft?.token===token){draft=null;context.closeModal();}
    } catch(error){context.toast(error.message);} finally{busy=false;if(form.isConnected){delete form.dataset.saving;controls.forEach(([el,disabled])=>el.disabled=disabled);if(form.id==='px-batch-form')updatePreview();}}
    return true;
  }
  root.PetExtraUI=Object.freeze({entry,honorActions,handles,handlesForm,handle,submit,sync,cardPng});
})(globalThis);
