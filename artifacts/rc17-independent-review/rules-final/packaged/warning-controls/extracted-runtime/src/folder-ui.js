(function(root){
 'use strict';
 const $=s=>document.querySelector(s),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const actions=new Set(['folder-manage','folder-root','folder-data','folder-backups','folder-config','folder-avatars','folder-migrate','folder-migration-confirm','folder-migration-cancel']);
 let active=null,sequence=0;
 function dispose(){sequence++;const previous=active;active=null;if(previous?.token&&!previous.committed)previous.api.file({command:'legacy-migration-cancel',token:previous.token}).catch(()=>{});}
 const location=(title,value)=>`<label class="folder-location">${title}<input readonly type="text" value="${esc(value)}" aria-label="${title}（可选择复制）" spellcheck="false"></label>`;
 async function open(context){
  context.modal('<h2>程序文件夹与数据</h2><p>正在读取本程序的保存位置…</p>');
  const dialog=$('#modal .dialog'),request=++sequence;
  try{const info=await context.api.file({command:'folder-info'});if(request!==sequence||!dialog?.isConnected)return;
   context.modal(`<h2>所有资料，放在一起</h2><p>移动或备份软件时，请带走整个文件夹。头像、配置、计分卡片、课堂数据和运行缓存都跟随本程序保存。</p>${location('当前程序文件夹',info.root)}<div class="button-row"><button class="button primary" data-do="folder-root">打开程序文件夹</button><button class="button" data-do="folder-config">打开配置.txt</button></div><div class="folder-path-grid">${location('头像文件夹',info.avatars)}${location('课堂数据',info.data)}${location('备份文件夹',info.backup)}${location('计分卡片表格',info.rules)}</div><div class="button-row"><button class="button" data-do="folder-avatars">打开头像文件夹</button><button class="button" data-do="folder-data">打开数据</button><button class="button" data-do="folder-backups">打开备份</button></div><p class="folder-operation-status" role="status" aria-live="polite"></p><section class="folder-migration-section"><h3>接续旧版课堂</h3><p>仅在您主动选择旧版数据文件夹并确认后复制。旧文件会保留，已选头像与原课堂密码会一起迁移。</p><button class="button" data-do="folder-migrate" ${info.migrationEligible?'':'disabled'}>从旧版数据文件夹迁移</button>${info.migrationEligible?'<small>确认后替换当前未使用的示例班级，然后重新启动</small>':'<small>当前文件夹已有课堂资料。需要迁移另一份资料时，请先完整解压到新的空文件夹，避免覆盖当前班级。</small>'}</section>`);
   $('#modal .dialog').classList.add('folder-management-dialog');active={api:context.api,dialog:$('#modal .dialog'),token:null,committed:false};
  }catch(error){if(request===sequence&&dialog?.isConnected){dialog.querySelector('.dialog-content').innerHTML=`<p role="alert">${esc(error.message)}</p>`;}}
 }
 async function preview(context,button){
  const original=$('#modal .dialog'),request=++sequence;button.disabled=true;
  try{const result=await context.api.file({command:'legacy-migration-preview'});if(!result)return;
   if(request!==sequence||!original.isConnected){await context.api.file({command:'legacy-migration-cancel',token:result.token});return;}
   const summary=result.summary||{};context.modal(`<h2>确认迁移旧版课堂</h2><p>复制完成后重新启动。原文件和原头像目录保留；本文件夹中的未使用示例班级将被替换。</p>${location('读取的旧版数据文件夹',result.sourceDirectory)}${location('复制到本程序',result.destinationDirectory)}<div class="rule-refresh-summary"><strong>${Number(summary.panels)||0} 个面板</strong><strong>${Number(summary.students)||0} 位学生</strong><strong>${Number(summary.photos)||0} 张已存头像</strong></div><p>课堂密码：${summary.lock?.configured?'一并保留，重新启动后按原状态保护':'按旧版文件原样保留；未设置时不新增密码'}</p>${result.externalResources?.length?`<h3>一起复制的旧版素材</h3>${result.externalResources.map(item=>location('素材位置',item.path)).join('')}`:''}${result.warnings?.length?`<div class="rule-warning">${result.warnings.map(esc).join('<br>')}</div>`:''}<details><summary>查看本次复制的文件（${result.files?.length||0}）</summary><ul class="folder-file-list">${(result.files||[]).map(item=>`<li>${esc(typeof item==='string'?item:item.relative||item.path||item.name||JSON.stringify(item))}</li>`).join('')}</ul></details><p class="folder-operation-status" role="status" aria-live="polite"></p><div class="dialog-actions"><button class="button" data-do="folder-migration-cancel">取消</button><button class="button primary" data-do="folder-migration-confirm">确认复制并重新启动</button></div>`);
   $('#modal .dialog').classList.add('folder-management-dialog');active={api:context.api,dialog:$('#modal .dialog'),token:result.token,resources:(result.externalResources||[]).map(item=>item.path),committed:false};
  }catch(error){if(original.isConnected)context.toast(error.message);}finally{if(button.isConnected)button.disabled=false;}
 }
 async function handle(action,button,context){
  if(action==='folder-manage'){if(!context.native)return context.toast('文件夹管理需要使用桌面应用');return open(context);}
  if(action==='folder-migrate')return preview(context,button);
  if(action==='folder-migration-cancel'){dispose();return context.closeModal();}
  const current=active,dialog=$('#modal .dialog');if(!current||current.dialog!==dialog)return;
  const status=dialog.querySelector('.folder-operation-status');button.disabled=true;
  try{
   if(action==='folder-migration-confirm'){
    status.textContent='正在校验并复制，原文件保持保留…';const result=await current.api.file({command:'legacy-migration-apply',token:current.token,approvedResourcePaths:current.resources});
    if(result?.migrated){current.committed=true;if(dialog.isConnected)status.textContent='复制完成，正在重新启动。请使用原课堂密码继续。';}return;
   }
   const command=({'folder-root':'program-folder','folder-data':'data-folder','folder-backups':'backup-folder','folder-config':'config-open','folder-avatars':'avatar-open-folder'})[action];
   const result=await current.api.file({command});if(!result?.opened)throw Error('系统没有确认打开，请通过上方完整路径手动打开');if(dialog.isConnected)status.textContent=action==='folder-config'?'配置.txt 已打开，修改后请完整退出并重开程序':'文件夹已打开';
  }catch(error){if(dialog.isConnected)status.textContent=error.message;}
  finally{if(button.isConnected&&!current.committed)button.disabled=false;}
 }
 root.FolderUI={handles:action=>actions.has(action),handle,dispose};
})(window);
