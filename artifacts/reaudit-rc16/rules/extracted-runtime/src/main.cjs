const { app, BrowserWindow, ipcMain, dialog, screen, shell, session, nativeImage, Menu, clipboard } = require('electron');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { isTrustedPage } = require('./trusted-page.cjs');
const { createInitialState, validateState, applyAction, remainingMs, importRows, panelId } = require('./core.cjs');
const { saveAtomic, writeFileAtomic, parseWorkbook, resolveAvatarRows, validatePhoto } = require('./io.cjs');
const { prepareBatchPhotos, decodePhotoBytes } = require('./photo-batch.cjs');
const { createAvatarLibrary } = require('./avatar-library.cjs');
const { bootstrapFolderApp } = require('./folder-layout.cjs');
const FolderPristine = require('./folder-pristine.cjs');
const {createLegacyMigration}=require('./legacy-migration.cjs');
const { createScoreRuleWorkbook, signature:ruleConfigurationSignature } = require('./score-rule-workbook.cjs');
const { createStore } = require('./storage.cjs');
const PetProgress = require('./pet-progress.js');
const Rankings = require('./classroom-rankings.js');
const ToolboxExtra = require('./toolbox-extra.js');
const ToolboxExport = require('./toolbox-export.cjs');
const { createClassroomLock } = require('./classroom-lock.cjs');
const { createActionReceipts } = require('./action-receipts.cjs');
app.setName('花伴课堂');
const headlessTest = process.env.FLOWER_HEADLESS_TEST === '1';
const startup = bootstrapFolderApp({app, developmentDirectory:path.resolve(__dirname,'..')});
if(!startup.ok){if(headlessTest)console.error(JSON.stringify(startup.error));else dialog.showErrorBox(startup.error.title,startup.error.message);app.exit(1);return;}
const {layout,config:startupConfig}=startup;
const resourceDirectory=layout.resourceDirectory;
const legacySuggestedDirectory=process.env.APPDATA?path.join(process.env.APPDATA,'FlowerClassroom'):'';
const singleInstanceLock=headlessTest || app.requestSingleInstanceLock();
if(!singleInstanceLock) app.quit();
app.on('second-instance', () => { if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });
let state, dataFile, store, classroomLock, mainWindow, savingError = '', workbookNotice = '', timerInterval, lockRevision = 0, restoreGeneration = 0;
// Packaged resources already exist on extraction. Avatars are decoded only on
// explicit listing/import; all application paths are under the program folder.
const avatarLibrary = createAvatarLibrary({resourceDirectory,legacyDataDirectory:app.getPath('userData'),defaultsDirectory:path.join(__dirname,'../assets/avatar-defaults'),nativeImage});
const scoreWorkbook=createScoreRuleWorkbook({resourceDirectory,backupDirectory:layout.backupDirectory});
const workbookContexts=new Map();
const legacyMigration=createLegacyMigration({dataDirectory:layout.dataDirectory,backupDirectory:layout.backupDirectory,resourceDirectory,validate:validateState});
const migrationContexts=new Map();let migrationCommitted=false;
function migrationContext(token,owner){const context=migrationContexts.get(token);if(!context||context.owner!==owner)throw Error('旧版迁移预览已失效，请重新选择');assertUnlocked(context.lockRevision);if(context.restoreGeneration!==restoreGeneration||context.stateHash!==FolderPristine.stateHash(state))throw Error('课堂资料已变化，迁移确认已失效。请取消后重新查看');return context;}
function rememberWorkbook(result,event,kind){workbookContexts.set(result.token,{owner:event.sender,kind,panelId:panelId(state),restoreGeneration,lockRevision});while(workbookContexts.size>24)workbookContexts.delete(workbookContexts.keys().next().value);return result;}
function workbookContext(token,owner,kind){const context=workbookContexts.get(token);if(!context||context.owner!==owner||context.kind!==kind)throw new Error('计分卡片预览已失效，请重新打开');assertUnlocked(context.lockRevision);if(context.restoreGeneration!==restoreGeneration||context.panelId!==panelId(state))throw new Error('面板或备份已变化，请重新核对计分卡片');return context;}
const actionReceipts=createActionReceipts({getState:()=>state});
const windows = new Map();
const flowerGestures = new WeakMap();
const entry = path.join(__dirname, 'index.html');
const MAX_BACKUP = 100 * 1024 * 1024;
function save(next,options) { const saved=store.save(next,options);dataFile=store.path;return saved; }
function notify(change) {
  for (const w of windows.values()) if (!w.isDestroyed()) w.webContents.send('state:changed', state, {...change,restoreGeneration,workbookWarning:workbookNotice||scoreWorkbook.warning});
}
function commit(next, change={type:'data'},options={}) { if(!store.blocked)scoreWorkbook.reconcileBeforeStateChange(state,next,{force:!!options.restore});const saved=save(next,options);state=saved;if(options.restore){savingError='';restoreGeneration++;scoreWorkbook.invalidate();workbookContexts.clear();}notify({...change,readOnly:store.blocked});return state; }
function protect(label) { fs.writeFileSync(path.join(layout.backupDirectory, `before-${label}-${Date.now()}-${randomUUID()}.json`), JSON.stringify(state)); }
function dispatch(action,owner) {
  if(store.blocked)throw new Error('新版存档需要先恢复备份，当前未保存任何改动');
  const next = applyAction(state, action);
  if(action.type==='rules.save'){workbookContext(action.workbookToken,owner,'save');const saved=scoreWorkbook.commitPrepared(action.workbookToken,{currentState:state,nextState:next,saveState:value=>save(value),beforeCommit:()=>workbookContext(action.workbookToken,owner,'save')});workbookContexts.delete(action.workbookToken);state=saved;workbookNotice='';notify({type:'rules.save',readOnly:store.blocked});return state;}
  if (['panel.remove','panel.clear','points.clear','pet.graduate','classroom.attendance.reset','classroom.vote.start','toolbox.homework.reset','toolbox.homework.archive','toolbox.homework.remove','toolbox.link.remove'].includes(action.type)) protect(action.type.replace('.','-'));
  return commit(next, {type:action.type});
}
function assertUnlocked(revision = lockRevision) {
  if(migrationCommitted)throw Error('旧版数据已迁移，正在重新启动。请关闭并重新打开本程序后继续');
  if (classroomLock?.status().locked || revision !== lockRevision) throw new Error('课堂已锁定或锁定状态已改变，请解锁后重新操作');
}
function assertRestoreGeneration(request) {
  for(const key of ['_restoreGeneration','expectedRestoreGeneration'])if(Object.hasOwn(request||{},key)&&request[key]!==restoreGeneration)throw new Error('备份已恢复，原操作已过期。请核对当前资料后重新操作');
}
function assertTransactionCurrent(request,owner) {
  assertUnlocked();
  // Replaying an already committed receipt is an inert outcome read. A restore
  // may itself have advanced this boundary; only unexecuted work can mutate it.
  if(request?._transportId&&actionReceipts.inspect(owner,request._transportId).committed)return;
  assertRestoreGeneration(request);
}
function notifyLock() { lockRevision++; const status=classroomLock.status(); for(const w of windows.values())if(!w.isDestroyed())w.webContents.send('lock:changed',status); }
function lockCommand(request={}) {
  if(!request || typeof request!=='object')throw new Error('未知课堂锁操作');
  let result;
  switch(request.command){
    case 'status': return classroomLock.status();
    case 'setup': result=classroomLock.setup(request.pin,request.repeat);break;
    case 'lock': result=classroomLock.lock();break;
    case 'unlock': result=classroomLock.unlock(request.pin);break;
    case 'change': result=classroomLock.change(request.oldPin,request.newPin,request.repeat);break;
    default:throw new Error('未知课堂锁操作');
  }
  if(result.ok)notifyLock(); return result;
}
function requestClassroomLock() {
  if(classroomLock.status().configured){lockCommand({command:'lock'});showWindow('main');}
  else{showWindow('main');mainWindow?.webContents.send('ui:command','lock-setup');}
}
function menuAction(action, window = mainWindow) { if(classroomLock?.status().locked){showWindow('main');return;} window?.webContents.send('ui:command', action); }
function fitSidebarZoom(win) {
  if(!win || win.isDestroyed() || win.flowerRole!=='sidebar')return;
  const area=headlessTest?{x:0,y:0,width:1440,height:1000}:screen.getDisplayMatching(win.getBounds()).workArea;
  const width=Math.min(area.width,Math.round((win.flowerSidebarNarrow?64:320)*win.webContents.getZoomFactor()));
  const b=win.getBounds();
  if(b.width!==width || b.height!==area.height || b.x!==area.x+area.width-width || b.y!==area.y)win.setBounds({x:area.x+area.width-width,y:area.y,width,height:area.height});
}
function setWindowZoom(win,value){
  if(!win || win.isDestroyed())return;
  win.webContents.setZoomFactor(Math.max(.5,Math.min(2,value)));
  fitSidebarZoom(win);
}
function installMenus() {
  const focused = () => BrowserWindow.getFocusedWindow() || mainWindow;
  const zoom = delta => { const win=focused(); if(win) setWindowZoom(win,Math.round((win.webContents.getZoomFactor()+delta)*10)/10); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label:'面板',submenu:[{label:'创建新面板',click:()=>menuAction('panel-create')},{label:'面板管理',click:()=>menuAction('panel-manage')},{type:'separator'},{label:'导出完整备份',click:()=>menuAction('backup')},{label:'恢复备份',click:()=>menuAction('restore')},{type:'separator'},{label:'退出',click:()=>app.quit()}]},
    {label:'头像设置',submenu:[{label:'显示 / 隐藏头像',click:()=>menuAction('toggle-avatars')},{label:'批量导入头像',click:()=>menuAction('batch-photos')}]},
    {label:'课堂工具',submenu:[{label:'悬浮红花',click:()=>showWindow('flower')},{label:'置顶积分',click:()=>showWindow('panel')},{label:'随机点名',click:()=>showWindow('draw')},{label:'计时器',click:()=>showWindow('timer')},{label:'悬浮宠物',click:()=>showWindow('pet')},{label:'网址传送门',click:()=>menuAction('tx-portal')},{label:'作业销号',click:()=>menuAction('tx-homework')},{label:'分类导出 Excel',click:()=>menuAction('tx-export')},{type:'separator'},{label:'一键锁屏',click:requestClassroomLock},{label:'设置 / 修改课堂密码',click:()=>menuAction('lock-change')}]},
    {label:'显示',submenu:[{label:'刷新',accelerator:'CmdOrCtrl+R',click:()=>focused()?.webContents.reload()},{label:'强制刷新',accelerator:'CmdOrCtrl+Shift+R',click:()=>focused()?.webContents.reloadIgnoringCache()},{type:'separator'},{label:'放大10%',accelerator:'CmdOrCtrl+Plus',click:()=>zoom(.1)},{label:'缩小10%',accelerator:'CmdOrCtrl+-',click:()=>zoom(-.1)},{label:'默认大小',accelerator:'CmdOrCtrl+0',click:()=>setWindowZoom(focused(),1)},{type:'separator'},{label:'全屏',accelerator:'F11',click:()=>{const w=focused();if(w)w.setFullScreen(!w.isFullScreen());}}]}
  ]));
}
function assertSender(event) {
  const owner=BrowserWindow.fromWebContents(event.sender);
  if(!owner||windows.get(owner.flowerRole)!==owner||event.senderFrame!==event.sender.mainFrame)throw new Error('不受信任的窗口');
  if(!isTrustedPage(event.senderFrame.url,entry))throw new Error('不受信任的页面');
}
function clampToDisplay(bounds) {
  const area = screen.getDisplayMatching(bounds).workArea;
  return { x: Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width)), y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height)) };
}
function showWindow(role, startNarrow = false) {
  if(classroomLock?.status().locked && role !== 'main')return showWindow('main');
  const existing = windows.get(role);
  if (existing && !existing.isDestroyed()) { if(role==='sidebar' && startNarrow){ existing.flowerSidebarNarrow=true;fitSidebarZoom(existing);existing.webContents.send('sidebar:narrow',true); } existing.show(); existing.focus(); return; }
  const area = headlessTest ? {x:0,y:0,width:1440,height:1000} : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  let opts = { width: startupConfig.windowWidth, height: startupConfig.windowHeight, minWidth: 900, minHeight: 640, show: false, title: '花伴课堂', backgroundColor: '#f5f6fb', icon: path.join(__dirname, '../assets/icon.png') };
  if (role === 'flower') opts = { ...opts, width: 110, height: 146, minWidth: 110, minHeight: 146, x: area.x + area.width - 126, y: area.y + Math.round(area.height * 0.3), frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false };
  if (role === 'panel') opts = { ...opts, width: 450, height: Math.min(690,area.height), minWidth: 240, minHeight: 480, x: area.x + area.width - 570, y: area.y + 30, frame: false, alwaysOnTop: true, skipTaskbar: true };
  if (role === 'sidebar') opts = { ...opts, width: 320, height: area.height, minWidth: 64, minHeight: 480, x: area.x + area.width - 320, y: area.y, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false };
  if (role === 'timer') opts = { ...opts, width: 430, height: 430, minWidth: 360, minHeight: 360, frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, hasShadow: false, resizable: false };
  if (role === 'draw') opts = { ...opts, width: 1020, height: 740, minWidth: 700, minHeight: 580 };
  if (role === 'pets') opts = { ...opts, width: 1280, height: 840, minWidth: 700, minHeight: 580, title: '花伴课堂 · 宠物课堂展示' };
  if (role === 'pet') opts = { ...opts, width: 340, height: 590, minWidth: 300, minHeight: 560, x: area.x + area.width - 360, y: area.y + 30, frame: false, alwaysOnTop: true, skipTaskbar: true, title: '花伴课堂 · 悬浮宠物' };
  if(role==='sidebar' && startNarrow) opts={...opts,width:64,x:area.x+area.width-64};
  const win = new BrowserWindow({ ...opts, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: headlessTest } });
  win.flowerRole = role;
  win.webContents.on('did-finish-load',()=>setWindowZoom(win,startupConfig.initialZoom));
  if(role==='sidebar'){win.flowerSidebarNarrow=startNarrow;win.webContents.on('did-finish-load',()=>fitSidebarZoom(win));}
  windows.set(role, win);
  if (!headlessTest && !['main','draw','pets'].includes(role)) win.setAlwaysOnTop(true, 'screen-saver');
  // Keep native accelerators and Alt menu access without a second permanent toolbar.
  if (role === 'main') win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, cb) => cb(false));
  const pageURL=pathToFileURL(entry);
  pageURL.searchParams.set('view',role);pageURL.searchParams.set('narrow',startNarrow?'1':'0');
  win.loadURL(pageURL.href);
  if (role === 'flower') win.webContents.on('context-menu', () => {
    Menu.buildFromTemplate([
      {label:'置顶积分',click:()=>showWindow('panel')},
      {label:'计时器',click:()=>showWindow('timer')},
      {label:'随机点名',click:()=>showWindow('draw')},
      {type:'separator'},
      {label:'养宠物',click:()=>showWindow('pet')},
      {label:'网址传送门',click:()=>{showWindow('main');menuAction('tx-portal');}},
      {label:'作业销号',click:()=>{showWindow('main');menuAction('tx-homework');}},
      {label:'返回主界面',click:()=>showWindow('main')},
      {label:'一键锁屏',click:requestClassroomLock},
      {type:'separator'},
      {label:'退出',click:()=>app.quit()}
    ]).popup({window:win});
  });
  if (role==='flower' && !headlessTest) { let docking; win.on('move',()=>{clearTimeout(docking);docking=setTimeout(()=>{if(win.isDestroyed()||!win.isVisible())return;const bounds=win.getBounds(),work=screen.getDisplayMatching(bounds).workArea;if(work.x+work.width-bounds.x-bounds.width<=5){showWindow('sidebar',true);win.hide();}},350);});win.on('closed',()=>clearTimeout(docking)); }
  win.once('ready-to-show', () => { if (!headlessTest){win.show();if(role==='main'&&startupConfig.startMinimized)win.minimize();} });
  win.on('closed', () => { const gesture=flowerGestures.get(win);if(gesture)clearTimeout(gesture.timer);flowerGestures.delete(win);windows.delete(role); if (role === 'main' && !app.isQuitting) app.quit(); });
  if (role === 'main') mainWindow = win;
}
function windowCommand(event, { command, role, value } = {}) {
  if(migrationCommitted&&!['close','minimize'].includes(command))throw Error('迁移已完成，请等待重新启动');
  const owner = BrowserWindow.fromWebContents(event.sender);
  if(command==='main'){showWindow('main');return true;}
  if(!['close','minimize'].includes(command) && !(command==='open'&&role==='main'))assertUnlocked();
  if ((command==='flower-single'||command==='flower-double')&&owner.flowerRole==='flower') {
    const prior=flowerGestures.get(owner);if(prior)clearTimeout(prior.timer);
    const target=windows.get('panel'),visible=!!(target&&!target.isDestroyed()&&target.isVisible());
    if(command==='flower-single') {
      const gesture={initialVisible:visible,timer:null};flowerGestures.set(owner,gesture);
      gesture.timer=setTimeout(()=>{if(owner.isDestroyed()||flowerGestures.get(owner)!==gesture||classroomLock?.status().locked)return;showWindow('panel');},260);return true;
    }
    flowerGestures.delete(owner);
    const initiallyVisible=value===2&&prior?prior.initialVisible:visible;
    if(initiallyVisible){if(target&&!target.isDestroyed())target.hide();}else showWindow('panel');return true;
  }
  if (command === 'open') {
    if (!['main', 'flower', 'panel', 'sidebar', 'timer', 'draw', 'pet', 'pets'].includes(role)) throw new Error('未知窗口');
    showWindow(role); return true;
  }
  if (command === 'toggle' && role === 'panel') {const target=windows.get('panel');if(target&&!target.isDestroyed()&&target.isVisible()){target.hide();return true;}showWindow('panel');return true;}
  if (command === 'close') { owner.close(); return true; }
  if (command === 'minimize') { owner.minimize(); return true; }
  if (command === 'fullscreen') { owner.setFullScreen(!owner.isFullScreen()); return true; }
  if (command === 'pin') { owner.setAlwaysOnTop(!!value, 'screen-saver'); return true; }
  if (command === 'sidebar-width' && owner.flowerRole === 'sidebar') {
    owner.flowerSidebarNarrow=value==='narrow';fitSidebarZoom(owner);return true;
  }
  throw new Error('未知窗口操作');
}
async function importList(mode = 'append') {
  const lockAtStart=lockRevision;
  const startPanel=panelId(state),startGeneration=restoreGeneration;
  const check=()=>{assertUnlocked(lockAtStart);if(startPanel!==panelId(state)||startGeneration!==restoreGeneration)throw new Error('面板或备份已变化，请重新选择名单文件');};
  const result = await dialog.showOpenDialog(mainWindow, { title: '导入学生名单（姓名、小组、可选头像名称）', defaultPath:resourceDirectory, properties: ['openFile'], filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'csv'] }] });
  if (result.canceled) return null;
  assertUnlocked(lockAtStart);
  const file = result.filePaths[0];
  if (fs.statSync(file).size > 10 * 1024 * 1024) throw new Error('名单文件不能超过 10 MB');
  const parsed = await parseWorkbook(fs.readFileSync(file), file);check();
  const hasAvatarNames=parsed.some(row=>String(row['头像名称']??row.avatarName??'').trim());
  const library=hasAvatarNames?await avatarLibrary.refresh({check}):{items:[],warning:''};check();
  const {rows,avatarMatches}=resolveAvatarRows(parsed,library.items);
  const preview = importRows(rows, state, mode);
  const added = mode==='replace'?preview.students:preview.students.slice(state.students.length);
  return { rows, avatarMatches, avatarWarning:library.warning||'', count: added.length, names: added.map(s => s.name), panelId:startPanel, expectedRevision:state.revision };
}
async function exportTemplate() {
  const lockAtStart=lockRevision;
  const result = await dialog.showSaveDialog(mainWindow, { title: '保存 Excel 名单模板', defaultPath: path.join(resourceDirectory,'花伴课堂-名单模板.xlsx'), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  if (result.canceled) return false;
  assertUnlocked(lockAtStart);
  const ExcelJS = require('exceljs');
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('名单');
  sheet.columns = [{ header: '姓名', key: 'name', width: 20, style: { numFmt: '@' } }, { header: '小组', key: 'group', width: 20, style: { numFmt: '@' } }, {header:'头像名称',key:'avatarName',width:30,style:{numFmt:'@'}}];
  sheet.addRows([{ name: '示例同学', group: '向日葵组',avatarName:'01-星星猫头鹰.png' }]);
  const help=book.addWorksheet('填写说明');help.columns=[{header:'项目',key:'topic',width:18},{header:'说明',key:'note',width:80}];help.addRows([{topic:'头像名称',note:'可选。填写头像文件夹内的图片文件名，例如 01-星星猫头鹰.png。留空使用姓名头像。'},{topic:'文本填写',note:'三列已设为文本。0001 等含前导零的姓名、小组或头像名称请保持文本格式；已被 Excel 转成数字或日期的内容需先改为文本并重新填写。'},{topic:'管理头像',note:'班级设置 → 打开头像库 → 打开头像文件夹。全部素材放在这一层；添加或移除后刷新。'},{topic:'匹配规则',note:'建议填写完整文件名（含后缀）。不含后缀时仅匹配唯一同名图片。未匹配或重名会在导入预览中提示。'},{topic:'旧模板',note:'只有姓名、小组两列的旧模板可以继续使用。姓名必填，每次最多300位学生。'},{topic:'保存方式',note:'确认导入后使用预览时的头像快照。之后删除素材不影响已保存头像；完整备份包含已选头像。'}]);help.getColumn(2).alignment={wrapText:true,vertical:'top'};help.eachRow((row,i)=>{if(i>1)row.height=45;});
  sheet.getRow(1).font = { bold: true };
  const output = Buffer.from(await book.xlsx.writeBuffer());
  writeFileAtomic(result.filePath, output, {beforeCommit:()=>assertUnlocked(lockAtStart)}); return true;
}
async function fileCommand(event, request = {}) {
  if(request.command==='legacy-migration-cancel'){const context=migrationContexts.get(request.token);if(context?.owner===event.sender){migrationContexts.delete(request.token);await legacyMigration.cancel(request.token);}return {canceled:true};}
  assertUnlocked();const lockAtStart=lockRevision;
  if(store.blocked&&!['restore-preview','restore-apply','backup','data-folder','template'].includes(request.command))throw new Error('新版存档需要先恢复备份，当前未保存任何改动');
  if (request.panelId !== undefined && request.panelId !== panelId(state)) throw new Error('当前面板已切换，请重新操作');
  const destructive = ['restore-apply','archive','blank'].includes(request.command) || (request.command==='import-apply' && request.mode==='replace');
  if (destructive && request.expectedRevision !== undefined && request.expectedRevision !== state.revision) throw new Error('课堂资料在确认期间已变化，请取消后重新查看并确认');
  if(request.command?.startsWith('rules-workbook-')){
    const startPanel=panelId(state),startEpoch=restoreGeneration,startSignature=ruleConfigurationSignature(state);
    const check=()=>{assertUnlocked(lockAtStart);assertRestoreGeneration(request);if(startEpoch!==restoreGeneration||startPanel!==panelId(state)||startSignature!==ruleConfigurationSignature(state))throw new Error('面板、备份或计分卡片已变化，请重新核对');};
    check();
    if(request.command==='rules-workbook-info'){try{return scoreWorkbook.info();}catch(error){return {path:scoreWorkbook.path,warning:error.message};}}
    if(request.command==='rules-workbook-open'){const result=await scoreWorkbook.open(state,{beforeCommit:check});check();const error=await shell.openPath(result.path);check();if(error)throw new Error('无法打开计分卡片表格，请通过显示的路径打开，并检查是否安装 Excel 或 WPS');return {...result,opened:true};}
    if(request.command==='rules-workbook-prepare'){
      const action=request.action;if(!action||action.type!=='rules.save')throw new Error('计分规则保存请求无效');assertRestoreGeneration(action);
      const next=applyAction(state,action),result=await scoreWorkbook.prepareSave(state,next);check();return rememberWorkbook(result,event,'save');
    }
    if(request.command==='rules-workbook-refresh-preview'){const result=await scoreWorkbook.prepareRefresh(state);check();return rememberWorkbook(result,event,'refresh');}
    if(request.command==='rules-workbook-export-preview'){const result=await scoreWorkbook.prepareExport(state);check();return rememberWorkbook(result,event,'export');}
    if(['rules-workbook-refresh-apply','rules-workbook-export-apply'].includes(request.command)){
      const kind=request.command==='rules-workbook-refresh-apply'?'refresh':'export';workbookContext(request.token,event.sender,kind);
      const options={currentState:state,saveState:value=>save(value),beforeCommit:()=>{assertRestoreGeneration(request);workbookContext(request.token,event.sender,kind);}};
      const saved=kind==='refresh'?scoreWorkbook.commitRefresh(request.token,options):scoreWorkbook.commitExport(request.token,options);
      workbookContexts.delete(request.token);state=saved;workbookNotice='';notify({type:'rules.save',readOnly:store.blocked});return state;
    }
    throw new Error('未知计分卡片操作');
  }
  if(request.command==='legacy-migration-preview'){
    const startState=FolderPristine.stateHash(state),startEpoch=restoreGeneration;
    const allowed=FolderPristine.allowedPristineFiles(layout.dataDirectory,state);if(!allowed)throw Error('当前程序文件夹已有课堂资料，不能用旧版迁移覆盖。请另行完整解压到空文件夹后迁移，或使用备份恢复并明确确认替换');
    const chosen=await dialog.showOpenDialog(mainWindow,{title:'选择旧版花伴课堂数据文件夹（只读取并复制，原文件保留）',defaultPath:legacySuggestedDirectory||resourceDirectory,properties:['openDirectory']});
    if(chosen.canceled)return null;assertUnlocked(lockAtStart);if(startEpoch!==restoreGeneration||startState!==FolderPristine.stateHash(state))throw Error('选择期间课堂资料已变化，请重新操作');
    const preview=legacyMigration.preview(chosen.filePaths[0],{allowPristineFiles:allowed,allowPristineWorkbookHash:FolderPristine.allowedPristineWorkbookHash(layout.dataDirectory,state,resourceDirectory)});
    migrationContexts.set(preview.token,{owner:event.sender,lockRevision:lockAtStart,restoreGeneration:startEpoch,stateHash:startState});
    while(migrationContexts.size>4){const token=migrationContexts.keys().next().value;migrationContexts.delete(token);await legacyMigration.cancel(token);}
    return {...preview,sourceDirectory:chosen.filePaths[0],destinationDirectory:layout.dataDirectory};
  }
  if(request.command==='legacy-migration-apply'){
    const check=()=>{assertRestoreGeneration(request);migrationContext(request.token,event.sender);};check();
    await legacyMigration.prepare(request.token,{approvedResourcePaths:request.approvedResourcePaths,check});check();
    const result=legacyMigration.commit(request.token,{check});migrationCommitted=true;migrationContexts.clear();clearInterval(timerInterval);
    for(const win of windows.values())if(!win.isDestroyed())win.hide();
    if(!(headlessTest&&process.env.FLOWER_MIGRATION_NO_RELAUNCH==='1'))setTimeout(()=>{app.relaunch();app.exit(0);},150);
    return {migrated:true,restartRequired:true,archiveDirectory:result.archiveDirectory,summary:result.summary,warnings:result.warnings};
  }
  if (request.command === 'portal-open') {
    ToolboxExtra.assertCurrent(state,request);
    const url=request.official===true?ToolboxExtra.OFFICIAL_URL:ToolboxExtra.snapshot(state).links.find(link=>link.id===request.id)?.url;
    if(!url)throw new Error('网址已移除，请重新打开传送门');
    await shell.openExternal(ToolboxExtra.url(url),{activate:true});return true;
  }
  if (request.command === 'export-category' || request.command === 'honor-png') {
    const startPanel=panelId(state),startRevision=state.revision;
    if(request.panelId!==startPanel||request.expectedRevision!==startRevision)throw new Error('面板或资料已变化，请重新打开导出页面');
    const current=validateState(state),png=request.command==='honor-png';
    if(!png&&!Object.hasOwn(ToolboxExport.CATEGORIES,request.category))throw new Error('导出分类无效');
    const bytes=png?ToolboxExport.pngBytes(request.dataUrl,nativeImage):null;
    const label=png?'宠物荣誉卡':ToolboxExport.CATEGORIES[request.category],extension=png?'.png':'.xlsx';
    const chosen=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender)||mainWindow,{title:'保存'+label,defaultPath:path.join(resourceDirectory,'花伴课堂-'+label+'-'+new Date().toISOString().slice(0,10)+extension),filters:[{name:png?'PNG图片':'Excel工作簿',extensions:[extension.slice(1)]}]});
    if(chosen.canceled)return false;
    const check=()=>{assertUnlocked(lockAtStart);if(startPanel!==panelId(state)||startRevision!==state.revision)throw new Error('导出期间面板或资料已变化，请核对后重新导出');};
    check();const target=ToolboxExport.checkedPath(chosen.filePath,extension);
    const output=png?bytes:Buffer.from(await ToolboxExport.buildWorkbook(require('exceljs'),current,request.category).xlsx.writeBuffer());
    if(output.length>40*1024*1024)throw new Error('导出文件超过40MB，请按分类导出');check();
    writeFileAtomic(target,output,{beforeCommit:check});
    return true;
  }
  if (request.command === 'import-preview') return importList(request.mode);
  if (request.command === 'import-apply') { const next=importRows(request.rows,state,request.mode||'append');if(request.mode==='replace')fs.writeFileSync(path.join(layout.backupDirectory,`before-replace-${Date.now()}-${randomUUID()}.json`),JSON.stringify(state));return commit(next); }
  if (request.command === 'archive') { fs.writeFileSync(path.join(layout.backupDirectory,`before-archive-${Date.now()}-${randomUUID()}.json`),JSON.stringify(state));return commit(validateState({...state,logs:[],revision:state.revision+1})); }
  if (request.command === 'blank') { protect('blank'); const next=createInitialState();next.version=state.version;next.students=[];next.settings.className='我的班级';next.settings.petStep=5;next.revision=state.revision;if(state.panels)next.panels=state.panels;return commit(applyAction(next,{type:'pet.stage-rules',thresholds:[5,5,5,5,5,5]})); }
  if (request.command === 'template') return exportTemplate();
  if (['avatar-folder-info','avatars-list','avatars-refresh','avatar-open-folder'].includes(request.command)) {
    const check=()=>{assertUnlocked(lockAtStart);assertRestoreGeneration(request);};
    check();
    if(request.command==='avatar-folder-info')return {directory:avatarLibrary.directory,warning:avatarLibrary.warning};
    if (request.command === 'avatar-open-folder') {
      const directory=await avatarLibrary.openFolder({check});check();
      const error=await shell.openPath(directory);
      if(error)throw new Error('无法打开头像文件夹，请通过显示的路径在文件管理器中打开');
      check();return {directory,opened:true,warning:avatarLibrary.warning};
    }
    const result=await (request.command==='avatars-refresh'?avatarLibrary.refresh({check}):avatarLibrary.list({check}));
    check();return result;
  }
  if (request.command === 'photo') {
    const startPanel=panelId(state);
    const chosen = await dialog.showOpenDialog(mainWindow, { title: '选择学生照片（仅本机保存）', defaultPath:avatarLibrary.directory, properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (chosen.canceled) return null;
    assertUnlocked(lockAtStart);
    if (startPanel!==panelId(state)) throw new Error('面板已切换，请重新选择照片');
    const p = chosen.filePaths[0];
    if(fs.statSync(p).size>1400*1024)throw new Error('照片应小于 1.4 MB，请先裁剪或压缩');
    const bytes = fs.readFileSync(p);
    const encoded = await decodePhotoBytes(bytes,nativeImage);
    assertUnlocked(lockAtStart);
    if (startPanel!==panelId(state)) throw new Error('面板已切换，请重新选择照片');
    return encoded;
  }
  if (request.command === 'rankings-copy') {await clipboard.writeText(Rankings.copyText(state,request.mode));return true;}
  if (request.command === 'rankings-export') {
    const snapshot=validateState(state),mode=request.mode,rows=Rankings.rows(snapshot,mode);
    const chosen=await dialog.showSaveDialog(mainWindow,{title:'导出当前排行榜',defaultPath:path.join(resourceDirectory,'花伴课堂-'+Rankings.labels[mode]+'排行榜.xlsx'),filters:[{name:'Excel工作簿',extensions:['xlsx']}]});
    if(chosen.canceled)return false;assertUnlocked(lockAtStart);
    const ExcelJS = require('exceljs');
    const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('排行榜');
    sheet.columns=mode==='students'?[{header:'排名',key:'rank',width:10},{header:'姓名',key:'name',width:22},{header:'小组',key:'group',width:24},{header:'当前积分',key:'score',width:16}]:[{header:'排名',key:'rank',width:10},{header:'小组名称',key:'name',width:24},{header:'小组基础分',key:'base',width:18},{header:'小组平均分',key:'average',width:18},{header:'成员总分',key:'total',width:18},{header:'成员积分明细',key:'details',width:70}];
    sheet.addRows(rows.map(r=>({...r,details:r.members?.map(m=>m.name+' '+m.score).join('、')})));sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:sheet.columnCount}};sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF536B87'}};sheet.eachRow(row=>{row.alignment={vertical:'middle',wrapText:true};row.height=30;});
    const output=Buffer.from(await book.xlsx.writeBuffer());writeFileAtomic(chosen.filePath,output,{beforeCommit:()=>assertUnlocked(lockAtStart)});return true;
  }
  if (request.command === 'summary-export') {
    const snapshot=validateState(state);
    const chosen=await dialog.showSaveDialog(mainWindow,{title:'导出当前面板 Excel 汇总',defaultPath:path.join(resourceDirectory,`花伴课堂-积分汇总-${new Date().toISOString().slice(0,10)}.xlsx`),filters:[{name:'Excel工作簿',extensions:['xlsx']}]});
    if(chosen.canceled)return false;
    assertUnlocked(lockAtStart);
    const ExcelJS = require('exceljs');
    const book=new ExcelJS.Workbook();book.creator='花伴课堂';book.created=new Date();
    const students=book.addWorksheet('学生积分'),groups=book.addWorksheet('小组积分'),logs=book.addWorksheet('积分记录');
    students.columns=[{header:'学生编号',key:'id',width:40},{header:'姓名',key:'name',width:22},{header:'小组',key:'group',width:22},{header:'当前积分',key:'score',width:14},{header:'课堂累计成长（兼容）',key:'growth',width:24},{header:'宠物',key:'pet',width:18},{header:'等级',key:'level',width:12},{header:'组长标记',key:'leader',width:14},{header:'当前宠物成长',key:'petGrowth',width:18},{header:'宠物生涯净成长',key:'petLifetime',width:20},{header:'总徽章',key:'medals',width:14},{header:'可兑换徽章',key:'available',width:18}];
    const petNames=require('./pet-art.js').names;
    students.addRows(snapshot.students.map(s=>{const p=PetProgress.profile(snapshot,s);return {...s,pet:petNames[p.pet],level:p.adopted?p.level:'未领养',leader:s.leader?'是':'',petGrowth:p.growth,petLifetime:p.lifetimeNetGrowth,medals:p.medalTotal,available:p.medalAvailable===null?'待核定':p.medalAvailable};}));
    groups.columns=[{header:'小组',key:'group',width:24},{header:'成员人数',key:'count',width:14},{header:'成员积分合计',key:'total',width:18},{header:'独立基础分',key:'base',width:18},{header:'小组总分',key:'combined',width:16},{header:'成员平均分',key:'average',width:18}];
    const names=[...new Set([...snapshot.students.map(s=>s.group),...(snapshot.groupBases||[]).map(g=>g.group)])];
    groups.addRows(names.map(group=>{const members=snapshot.students.filter(s=>s.group===group);const total=members.reduce((a,s)=>a+s.score,0),base=snapshot.groupBases?.find(g=>g.group===group)?.score||0;return {group,count:members.length,total,base,combined:total+base,average:members.length?total/members.length:0};}));
    logs.columns=[{header:'记录编号',key:'id',width:40},{header:'时间',key:'time',width:24},{header:'姓名',key:'name',width:22},{header:'原因',key:'reason',width:30},{header:'变动分值',key:'delta',width:14},{header:'变动前积分',key:'before',width:16},{header:'变动后积分',key:'after',width:16},{header:'状态',key:'status',width:14}];
    logs.addRows(snapshot.logs.flatMap(l=>l.changes.map(c=>({id:l.id,time:new Date(l.timestamp),name:c.name,reason:l.reason,delta:l.delta,before:c.beforeScore,after:c.afterScore,status:l.undone?'已撤销':'已生效'}))));
    logs.getColumn('time').numFmt='yyyy-mm-dd hh:mm:ss';
    for(const sheet of [students,groups,logs]){sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:1,column:sheet.columnCount}};sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF536B87'}};sheet.getRow(1).height=26;sheet.eachRow((row,n)=>{if(n>1){row.height=22;row.alignment={vertical:'middle'};}});}
    const output=Buffer.from(await book.xlsx.writeBuffer());writeFileAtomic(chosen.filePath,output,{beforeCommit:()=>assertUnlocked(lockAtStart)});return true;
  }
  if (request.command === 'photos-batch') {
    const startPanel=panelId(state),startGeneration=restoreGeneration;
    const checkPhotoContext=()=>{assertUnlocked(lockAtStart);assertRestoreGeneration(request);if(startPanel!==panelId(state)||startGeneration!==restoreGeneration)throw Error('照片导入期间面板或备份已变化，请重新导入');};checkPhotoContext();
    const selected=await dialog.showOpenDialog(mainWindow,{title:'选择照片文件夹（照片文件名须与学生姓名一致）',defaultPath:resourceDirectory,properties:['openDirectory']});
    if(selected.canceled)return null;
    checkPhotoContext();
    const startingStudents=state.students.map(s=>({id:s.id,name:s.name,photo:s.photo}));
    const result=await prepareBatchPhotos(selected.filePaths[0],state.students,nativeImage);
    checkPhotoContext();
    if(startPanel!==panelId(state)||JSON.stringify(startingStudents)!==JSON.stringify(state.students.map(s=>({id:s.id,name:s.name,photo:s.photo}))))throw new Error('名单或照片在导入时发生变化，请重新导入');
    if(result.updates.length){checkPhotoContext();const next=applyAction(state,{type:'photos.batch',updates:result.updates,panelId:startPanel});protect('batch-photos');commit(next,{type:'photos.batch'});}
    return {counts:result.counts,results:result.results};
  }
  if (request.command === 'backup') {
    const target = await dialog.showSaveDialog(mainWindow, { title: '备份全部课堂数据', defaultPath: path.join(layout.backupDirectory,`花伴课堂-备份-${new Date().toISOString().slice(0,10)}.json`), filters: [{ name: '课堂备份', extensions: ['json'] }] });
    if (target.canceled) return false;
    assertUnlocked(lockAtStart);
    writeFileAtomic(target.filePath, JSON.stringify(state)); return true;
  }
  if (request.command === 'restore-preview') {
    const chosen = await dialog.showOpenDialog(mainWindow, { title: '恢复课堂备份', defaultPath:layout.backupDirectory, properties: ['openFile'], filters: [{ name: '课堂备份', extensions: ['json'] }] });
    if (chosen.canceled) return null;
    assertUnlocked(lockAtStart);
    if (fs.statSync(chosen.filePaths[0]).size > MAX_BACKUP) throw new Error('备份不能超过 100 MB');
    const incoming = validateState(JSON.parse(fs.readFileSync(chosen.filePaths[0], 'utf8')));
    return request.withRevision===true?{...incoming,expectedRevision:state.revision}:incoming;
  }
  if (request.command === 'restore-apply') {
    const incoming = validateState(request.state);
    fs.writeFileSync(path.join(layout.backupDirectory,`before-restore-${Date.now()}-${randomUUID()}.json`),JSON.stringify(state));
    return commit({ ...incoming, revision: state.revision + 1 },{type:'data',restored:true},{restore:true});
  }
  if (['data-folder','program-folder','backup-folder','config-open'].includes(request.command)) {const target=({ 'data-folder':layout.dataDirectory,'program-folder':resourceDirectory,'backup-folder':layout.backupDirectory,'config-open':layout.configFile })[request.command];const error=await shell.openPath(target);assertUnlocked(lockAtStart);if(error)throw Error('无法打开文件或文件夹，请通过显示的位置打开并检查默认应用');return {opened:true,path:target};}
  if(request.command==='folder-info')return {root:resourceDirectory,data:layout.dataDirectory,backup:layout.backupDirectory,config:layout.configFile,avatars:avatarLibrary.directory,rules:scoreWorkbook.path,migrationEligible:!!FolderPristine.allowedPristineFiles(layout.dataDirectory,state)};
  throw new Error('未知文件操作');
}
app.whenReady().then(async () => {
  if(!singleInstanceLock)return;
  session.defaultSession.webRequest.onBeforeRequest({ urls:['http://*/*','https://*/*','ws://*/*','wss://*/*'] }, (_details, callback) => callback({cancel:true}));
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  legacyMigration.recover();
  classroomLock=createClassroomLock(app.getPath('userData'));
  store=createStore(app.getPath('userData'),{validate:validateState,initial:createInitialState,backupDirectory:layout.backupDirectory});
  const firstRun=!FolderPristine.hasClassroomFiles(layout.dataDirectory);
  const loaded=store.load();state=loaded.state;savingError=loaded.warning;dataFile=store.path;
  if(!store.blocked){
    try{const prepared=await scoreWorkbook.bootstrap(state,{saveState:value=>firstRun?save(value):value});state=prepared.state;workbookNotice=prepared.warning||'';}
    catch(error){workbookNotice='外部计分表暂不可用，当前课堂继续使用已保存的规则。原表和事务记录已保留，请在计分卡片管理中核对或重建。'+error.message;}
    if(firstRun){state=save(state);FolderPristine.recordInitialState(layout.dataDirectory,state,resourceDirectory);}
  }
  ipcMain.handle('state:get', event => { assertSender(event);if(migrationCommitted)throw Error('迁移已完成，请重新启动程序'); return { state, warning: savingError, workbookWarning:workbookNotice||scoreWorkbook.warning, readOnly:store.blocked, restoreGeneration, desktop: true, version: require('../package.json').version }; });
  ipcMain.handle('state:action', (event, action) => { assertSender(event); return actionReceipts.execute(event.sender,action,value=>dispatch(value,event.sender),()=>assertTransactionCurrent(action,event.sender)); });
  ipcMain.handle('state:receipt', (event, request={}) => { assertSender(event);if(migrationCommitted)throw Error('迁移已完成，请重新启动程序'); const receipt=actionReceipts.inspect(event.sender,request.transportId);return request.withContext===true?{...receipt,restoreGeneration,state,readOnly:store.blocked}:receipt; });
  ipcMain.handle('window:command', (event, request) => { assertSender(event); return windowCommand(event, request); });
  ipcMain.handle('file:command', (event, request) => {
    assertSender(event);
    // These branches finish their transaction synchronously before returning
    // from the async file dispatcher. Dialog and other asynchronous IO paths
    // must not infer an outcome from unrelated state changes while awaiting IO.
    if(['import-apply','restore-apply','archive','blank','rules-workbook-refresh-apply','rules-workbook-export-apply'].includes(request?.command)){
      return actionReceipts.execute(event.sender,request,value=>fileCommand(event,value),()=>assertTransactionCurrent(request,event.sender));
    }
    return fileCommand(event, request);
  });
  ipcMain.handle('lock:command',(event,request)=>{assertSender(event);if(migrationCommitted)throw Error('迁移已完成，请重新启动程序');return lockCommand(request);});
  installMenus();
  showWindow('main');
  if (!headlessTest) screen.on('display-removed', () => { for (const w of windows.values()) w.setPosition(...Object.values(clampToDisplay(w.getBounds()))); });
  timerInterval = setInterval(() => {
    if (!store.blocked && state.timer.running && remainingMs(state.timer) <= 0) {
      try {
        dispatch({ type: 'timer.pause' });
        const audioOwner=windows.get('timer') || mainWindow;
        for (const w of windows.values()) w.webContents.send('timer:finished',{sound:state.settings.timerSound||'tick',play:w===audioOwner});
      } catch (e) { console.error(e); }
    }
  }, 300);
}).catch(error=>{const message='程序未能完成启动，原数据没有被重置。请保留整个程序文件夹并检查配置、可用空间和写入权限。\n'+error.message;if(headlessTest)console.error(message);else dialog.showErrorBox('花伴课堂无法启动',message);app.exit(1);});
app.on('before-quit', () => { app.isQuitting = true; clearInterval(timerInterval); });
app.on('window-all-closed', () => app.quit());
