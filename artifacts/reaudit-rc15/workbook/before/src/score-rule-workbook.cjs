'use strict';

// The classroom JSON is the last valid configuration. Construction is inert;
// startup may bind only the exact shipped template, never an edited workbook.
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const Rules = require('./score-rules.js');

const FILE_NAME = '计分卡片.xlsx';
const SHEET_NAME = '计分卡片';
const HELP_SHEET = '填写说明';
const INITIAL_PANEL_ID = '__flower_initial_panel_v1__';
const INITIAL_MARKER = 'flower-classroom:unbound-score-rules';
const INITIAL_VERSION = 1;
// Pinned to buildInitialBytes(). A changed template must deliberately update
// this hash; marker text or equivalent cell values alone never permit a write.
const INITIAL_SHA256 = 'dc902af8a5ce2be33d6a26e222bd00c28ed370fd98234d2a6592cc29d0eca441';
const HEADERS = ['面板ID', '面板名称', '规则ID', '卡片名称', '积分变化', '成长值变化'];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 2 * MAX_BYTES + 32768;
const MAX_ROWS = 5000;
const MAX_TOKENS = 12;
const TOKEN_LIFETIME = 15 * 60 * 1000;
const conflict = () => new Error('计分卡片.xlsx 已在外部更改，请先点击「刷新计分卡片」预览并应用，再保存页面中的规则');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const initialState = () => ({version: 2, revision: 0,
  settings: {className: '首次启动时绑定当前课堂', scoreRules: clone(Rules.defaults)},
  panels: {activeId: INITIAL_PANEL_ID, others: []}});
const isInitialBytes = bytes => Buffer.isBuffer(bytes) && digest(bytes) === INITIAL_SHA256;

// ExcelJS gives each ZIP member a wall-clock timestamp. Normalize only ZIP
// headers in our freshly generated archive, keeping exact bytes reproducible
// across packaging and runtime clocks/time zones without a sidecar manifest.
function fixedZipDates(input) {
  const bytes = Buffer.from(input), end = bytes.length - 22;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50) throw new Error('初始计分卡片压缩格式无效');
  let offset = bytes.readUInt32LE(end + 16);
  const entries = bytes.readUInt16LE(end + 10);
  for (let i = 0; i < entries; i++) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('初始计分卡片目录无效');
    const local = bytes.readUInt32LE(offset + 42);
    if (bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('初始计分卡片条目无效');
    bytes.writeUInt16LE(0, offset + 12); bytes.writeUInt16LE(0x5821, offset + 14);
    bytes.writeUInt16LE(0, local + 10); bytes.writeUInt16LE(0x5821, local + 12);
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return bytes;
}

function panelEntries(state) {
  const list = [{id: state.panels?.activeId || 'panel_default', name: state.settings.className, data: state},
    ...(state.panels?.others || []).map(panel => ({id: panel.id, name: panel.data.settings.className, data: panel.data}))];
  if (!list.length || list.length > 20 || new Set(list.map(panel => panel.id)).size !== list.length) throw new Error('计分卡片的面板集合无效');
  return list;
}

function configuration(state) {
  return panelEntries(state).map(panel => ({id: panel.id, name: panel.name, rules: Rules.list(panel.data)})).sort((a, b) => a.id.localeCompare(b.id));
}

function signature(state) { return digest(JSON.stringify(configuration(state))); }

function mergeRules(state, panels) {
  const byId = new Map(panels.map(panel => [panel.id, panel.rules]));
  const update = (data, id) => {
    const scoreRules = clone(byId.get(id));
    return {...data, version: scoreRules.some(rule => Object.hasOwn(rule, 'growthDelta')) ? 2 : data.version,
      settings: {...data.settings, scoreRules}};
  };
  const next = update(state, state.panels?.activeId || 'panel_default');
  if (state.panels) next.panels = {...state.panels, others: state.panels.others.map(panel => ({...panel, data: update(panel.data, panel.id)}))};
  if (next.panels?.others.some(panel => panel.data.version === 2)) next.version = 2;
  next.revision = state.revision + 1;
  return next;
}

function summaryFor(state, panels) {
  const prior = new Map(configuration(state).map(panel => [panel.id, panel]));
  const summary = panels.map(panel => ({id: panel.id, name: panel.name, count: panel.rules.length,
    changed: !Rules.same(prior.get(panel.id).rules, panel.rules),
    rules: clone(panel.rules)}));
  return {panelCount: panels.length, ruleCount: panels.reduce((total, panel) => total + panel.rules.length, 0), summary,
    warning: (panels.nameWarnings || []).join('；')};
}

function cellScalar(cell, context) {
  const value = cell.value;
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) throw new Error(`${context} ${cell.address} 不能使用公式，请填写文字或整数`);
  if (value && typeof value === 'object' && 'error' in value) throw new Error(`${context} ${cell.address} 含有 Excel 错误，请修正后刷新`);
  if (value && Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  throw new Error(`${context} ${cell.address} 仅支持文字或整数，不支持日期、链接或其他单元格类型`);
}

function integer(value, label, optional = false) {
  if (value === '' && optional) return undefined;
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isInteger(number) || Math.abs(number) > 100 || (!optional && number === 0)) throw new Error(`${label}需为−100至100的${optional ? '整数（可填0或留空）' : '非零整数'}`);
  return number;
}

async function buildBytes(state, loadExcel = () => require('exceljs'), {initialTemplate = false} = {}) {
  const ExcelJS = loadExcel();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '花伴课堂';
  if (initialTemplate) workbook.created = workbook.modified = new Date('2024-01-01T00:00:00.000Z');
  const sheet = workbook.addWorksheet(SHEET_NAME, {views: [{state: 'frozen', ySplit: 1}]});
  sheet.columns = HEADERS.map((header, index) => ({header, width: [42, 24, 42, 32, 16, 18][index], style: {numFmt: index < 4 ? '@' : '0'}}));
  for (const panel of configuration(state)) for (const rule of panel.rules) sheet.addRow([panel.id, panel.name, rule.id, rule.label, rule.delta, rule.growthDelta ?? null]);
  sheet.autoFilter = {from: 'A1', to: 'F1'};
  sheet.getRow(1).font = {bold: true, color: {argb: 'FFFFFFFF'}};
  sheet.getRow(1).fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF395F4A'}};
  sheet.getRow(1).height = 26;
  sheet.eachRow((row, rowNumber) => {
    row.alignment = {vertical: 'middle'};
    if (rowNumber > 1) {
      row.height = 24;
      row.getCell(4).font = {color: {argb: 'FF1D4ED8'}};
      row.getCell(5).font = {color: {argb: 'FF1D4ED8'}};
      row.getCell(6).font = {color: {argb: 'FF1D4ED8'}};
      row.getCell(5).dataValidation = {type: 'whole', operator: 'between', formulae: [-100, 100], allowBlank: false, showErrorMessage: true, errorTitle: '积分变化', error: '填写−100至100的非零整数'};
      row.getCell(6).dataValidation = {type: 'whole', operator: 'between', formulae: [-100, 100], allowBlank: true, showErrorMessage: true, errorTitle: '成长值变化', error: '填写−100至100的整数，或留空沿用旧规则'};
    }
  });
  const help = workbook.addWorksheet(HELP_SHEET);
  help.columns = [{header: '项目', width: 22}, {header: '填写方法', width: 104}];
  help.addRows([
    ['编辑后应用', '保存并关闭 Excel，然后回到花伴课堂，点击「刷新计分卡片」，预览确认后应用。应用前仍使用上一次有效规则。'],
    ['卡片名称', '必填，1–120字。积分变化为−100至100的非零整数。'],
    ['成长值变化', '可填−100至100的整数；0表示成长值不变。留空沿用当前面板的旧规则：独立宠物成长按积分同方向变化，旧成长仅随加分增加。'],
    ['面板对应', '面板ID决定规则所属班级，请保留原编号。面板名称仅供显示，改班名后按程序中的当前名称识别，下次保存规则会同步名称。不要把一个面板的规则移到另一个面板。'],
    ['规则ID', '现有卡片保留原规则ID。新增卡片填写不同的编号，如 rule_custom_1；仅使用英文字母、数字、下划线和短横线。每个面板内不得重复。'],
    ['删除卡片', '删除整行即可。每个面板须保留1–100张卡片；文件应包含全部现有面板。'],
    ['允许的内容', '只填写文字或整数，不使用公式、链接或 Excel 错误值。不要更改表头或增加数据工作表。'],
    ['历史记录', '这里只配置今后使用的计分卡片，不修改已产生的积分、成长值或历史记录。']
  ]);
  if (initialTemplate) help.addRows([
    ['首次启动', '这是尚未绑定课堂的初始计分卡片。原样文件会在首次启动时按当前课堂生成正式面板编号。若提前编辑了表格，程序将保留文件，需在「刷新计分卡片」中预览并确认；存在多个面板时请先核对并明确重建。'],
    [INITIAL_MARKER, INITIAL_VERSION]
  ]);
  help.getRow(1).font = {bold: true};
  help.getColumn(2).alignment = {wrapText: true, vertical: 'top'};
  help.eachRow((row, index) => {if (index > 1) row.height = 42;});
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('计分卡片文件超过5MB，请减少不必要的格式或内容');
  return initialTemplate ? fixedZipDates(bytes) : bytes;
}

async function buildInitialBytes(loadExcel = () => require('exceljs')) {
  return buildBytes(initialState(), loadExcel, {initialTemplate: true});
}

async function parseBytes(bytes, state, loadExcel = () => require('exceljs'), {allowInitialTemplate = false} = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw new Error('计分卡片文件不能超过5MB');
  const zip = await require('unzipper').Open.buffer(bytes);
  if (zip.files.length > 2000 || zip.files.reduce((total, file) => total + file.uncompressedSize, 0) > 20 * 1024 * 1024) throw new Error('计分卡片解压内容过大，请使用简洁的计分卡片文件');
  const ExcelJS = loadExcel();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) throw new Error('找不到「计分卡片」工作表，请保留原工作表名称');
  if (sheet.rowCount > MAX_ROWS || sheet.columnCount > 32) throw new Error('计分卡片工作表范围过大，请删除多余行列');
  for (const other of workbook.worksheets) if (![SHEET_NAME, HELP_SHEET].includes(other.name) && other.actualRowCount > 0) throw new Error(`工作表「${other.name}」含有无法应用的数据，请仅保留计分卡片及填写说明`);
  const headers = [];
  for (let column = 1; column <= Math.max(HEADERS.length, sheet.columnCount); column++) headers.push(cellScalar(sheet.getRow(1).getCell(column), '表头'));
  const columns = new Map();
  for (const header of HEADERS) {
    const matches = headers.flatMap((value, index) => value === header ? [index + 1] : []);
    if (matches.length !== 1) throw new Error(`第一行必须恰好包含一列「${header}」`);
    columns.set(header, matches[0]);
  }
  if (headers.some(value => value !== '' && !HEADERS.includes(value))) throw new Error('计分卡片含有未知表头，请保留原来的六列');
  const panels = configuration(state).map(panel => ({...panel, rules: []}));
  const byId = new Map(panels.map(panel => [panel.id, panel]));
  const renamed = new Map();
  const help = workbook.getWorksheet(HELP_SHEET);
  let templateMarker = false, templateBound = false;
  const sourcePanelIds = new Set();
  if (help) {
    if (help.rowCount > MAX_ROWS) throw new Error('填写说明行数过多，请使用简洁的计分卡片文件');
    help.eachRow(row => {
      if (row.getCell(1).value === INITIAL_MARKER && row.getCell(2).value === INITIAL_VERSION) templateMarker = true;
    });
  }
  for (let index = 2; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    const values = [];
    for (let column = 1; column <= Math.max(HEADERS.length, sheet.columnCount); column++) values.push(cellScalar(row.getCell(column), `第${index}行`));
    if (values.every(value => value === '')) continue;
    if (values.some((value, column) => value !== '' && !HEADERS.includes(headers[column]))) throw new Error(`第${index}行存在表头之外的数据，请修正后刷新`);
    const get = label => values[columns.get(label) - 1];
    const rowPanelId = get('面板ID');
    sourcePanelIds.add(rowPanelId);
    let panel = byId.get(rowPanelId);
    if (rowPanelId === INITIAL_PANEL_ID && !panel && templateMarker) {
      if (!allowInitialTemplate) throw new Error('初始计分卡片尚未绑定课堂，文件已保留；请点击「刷新计分卡片」预览确认，或用当前规则重建表格');
      if (panels.length !== 1) throw new Error('初始计分卡片尚未绑定，当前存在多个面板，无法确定编辑属于哪个班级；文件已保留，请核对后用当前规则重建表格，原表会另存备份');
      panel = panels[0]; templateBound = true;
    }
    if (!panel) throw new Error(`第${index}行的面板ID不存在，请使用当前面板的原始编号`);
    // IDs determine ownership. Display names in an existing workbook can lag a
    // classroom rename; normalize them to the current JSON name without ever
    // moving rules between panels or accepting differing rule content.
    if (get('面板名称') !== panel.name) renamed.set(panel.id, `面板名称已按当前课堂「${panel.name}」识别，下次保存规则会同步文件中的显示名称`);
    const rule = {id: get('规则ID'), label: get('卡片名称'), delta: integer(get('积分变化'), `第${index}行积分变化`)};
    const growthDelta = integer(get('成长值变化'), `第${index}行成长值变化`, true);
    if (growthDelta !== undefined) rule.growthDelta = growthDelta;
    try { Rules.validateRules([rule]); } catch (error) { throw new Error(`第${index}行：${error.message}`); }
    panel.rules.push(rule);
  }
  if (templateBound && sourcePanelIds.size !== 1) throw new Error('初始计分卡片混用了未绑定编号和正式面板编号，请核对后再刷新；文件已保留');
  for (const panel of panels) {
    try { panel.rules = Rules.validateRules(panel.rules); } catch (error) { throw new Error(`面板「${panel.name}」：${error.message}`); }
  }
  Object.defineProperty(panels, 'nameWarnings', {value: [...renamed.values()]});
  Object.defineProperty(panels, 'initialTemplate', {value: templateBound});
  return panels;
}

function createScoreRuleWorkbook({resourceDirectory, backupDirectory = resourceDirectory, fileSystem = fs, loadExcel = () => require('exceljs'), now = Date.now} = {}) {
  if (typeof resourceDirectory !== 'string' || !path.isAbsolute(resourceDirectory)) throw new Error('计分卡片文件夹必须为绝对路径');
  if (typeof backupDirectory !== 'string' || !path.isAbsolute(backupDirectory) || path.relative(resourceDirectory, backupDirectory).startsWith('..') || path.isAbsolute(path.relative(resourceDirectory, backupDirectory))) throw new Error('计分卡片备份必须保存在程序文件夹内');
  const file = path.join(resourceDirectory, FILE_NAME);
  const receiptPath = file + '.flower-pending.json';
  const prepared = new Map();
  let observedHash, warning = '';
  function readOptional(target = file, limit = MAX_BYTES) {
    let stat;
    try { stat = fileSystem.statSync(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.size > limit) throw new Error(`${path.basename(target)} 不是可读取的文件或超过大小上限`);
    return fileSystem.readFileSync(target);
  }
  function hashNow() { const bytes = readOptional(); return bytes === null ? null : digest(bytes); }
  function assertHash(expected) { if (hashNow() !== expected) throw conflict(); }
  function atomicWrite(target, bytes, beforeCommit = () => {}) {
    const temporary = target + '.flower-' + randomUUID() + '.tmp';
    let created = false;
    try {
      const fd = fileSystem.openSync(temporary, 'wx', 0o600);
      created = true;
      try { fileSystem.writeFileSync(fd, bytes); fileSystem.fsyncSync(fd); } finally { fileSystem.closeSync(fd); }
      beforeCommit();
      fileSystem.renameSync(temporary, target);
      created = false;
    } finally {
      if (created) try { fileSystem.unlinkSync(temporary); } catch {}
    }
  }
  function fileError(error) {
    if (['EACCES', 'EPERM', 'EROFS', 'EBUSY', 'ENOSPC', 'ENOENT'].includes(error.code)) return new Error(`无法保存「${FILE_NAME}」：请关闭 Excel，检查空间和写入权限；若程序文件夹不可写，请将程序放到可写文件夹后重试。${error.message}`);
    return error;
  }
  function clearReceipt() {
    try { fileSystem.unlinkSync(receiptPath); warning = ''; } catch (error) { if (error.code !== 'ENOENT') warning = '规则已保存，事务记录暂未清理；下次打开计分卡片时将重新核对'; }
  }
  function decodeReceipt(bytes) {
    let receipt;
    try { receipt = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('计分卡片事务记录损坏，请保留文件并重新核对，当前有效规则未改变'); }
    if (!receipt || receipt.version !== 1 || !['beforeRules', 'afterRules', 'afterHash'].every(key => /^[a-f0-9]{64}$/.test(receipt[key])) || !(receipt.beforeHash === null || /^[a-f0-9]{64}$/.test(receipt.beforeHash)) || !(receipt.beforeBytes === null || typeof receipt.beforeBytes === 'string')) throw new Error('计分卡片事务记录格式无效，请保留文件并重新核对');
    const prior = receipt.beforeBytes === null ? null : Buffer.from(receipt.beforeBytes, 'base64');
    if ((prior === null ? null : digest(prior)) !== receipt.beforeHash || (prior && prior.length > MAX_BYTES)) throw new Error('计分卡片事务记录校验失败，请保留文件并重新核对');
    if (receipt.purpose !== undefined && (receipt.purpose !== 'bootstrap' || receipt.beforeRules !== receipt.afterRules || (prior !== null && !isInitialBytes(prior)))) throw new Error('计分卡片初始化事务校验失败，请保留文件并重新核对');
    return {...receipt, prior};
  }
  function recover(state) {
    const bytes = readOptional(receiptPath, MAX_RECEIPT_BYTES);
    if (!bytes) return {recovered: false};
    const receipt = decodeReceipt(bytes), current = signature(state), actual = hashNow();
    if (current === receipt.afterRules && actual === receipt.afterHash) {
      clearReceipt(); observedHash = actual; return {recovered: true, committed: true};
    }
    // Before the first JSON save, a restart may create different random panel
    // IDs. Only a verified bootstrap receipt can roll back to the exact shipped
    // template (or absence) independently of that initial state's fingerprint.
    if ((current !== receipt.beforeRules && receipt.purpose !== 'bootstrap') || ![receipt.beforeHash, receipt.afterHash].includes(actual)) throw new Error('上次计分卡片保存尚未完成，且文件或课堂规则已变化。已保留两份资料，请先核对，当前有效规则未改变');
    if (actual === receipt.afterHash && actual !== receipt.beforeHash) {
      if (receipt.prior === null) { assertHash(actual); fileSystem.unlinkSync(file); }
      else atomicWrite(file, receipt.prior, () => assertHash(actual));
    }
    clearReceipt(); observedHash = receipt.beforeHash;
    return {recovered: true, committed: false};
  }
  function remember(data, publicFields) {
    const time = now();
    for (const [token, value] of prepared) if (value.expires < time) prepared.delete(token);
    while (prepared.size >= MAX_TOKENS) prepared.delete(prepared.keys().next().value);
    const token = randomUUID();
    prepared.set(token, {...data, expires: time + TOKEN_LIFETIME});
    return {token, ...publicFields};
  }
  function take(token, kind) {
    const key = typeof token === 'string' ? token : token?.token;
    const data = prepared.get(key);
    prepared.delete(key);
    if (!data || data.kind !== kind || data.expires < now()) throw new Error('计分卡片预览已过期，请重新打开并确认');
    return data;
  }
  function info() {
    const bytes = readOptional();
    return {path: file, existing: bytes !== null, hash: bytes === null ? null : digest(bytes), warning};
  }
  async function bootstrap(state, {saveState, beforeCommit = () => {}} = {}) {
    beforeCommit();
    recover(state);
    const prior = readOptional();
    if (prior !== null && !isInitialBytes(prior)) {
      // Existing workbooks can be large or edited. Leave them untouched and
      // keep ExcelJS lazy on normal launches; an explicit open/refresh/save
      // validates their content before accepting any rule or overwrite.
      return {path: file, hash: digest(prior), state, created: false, bound: false,
        needsReview: false, validationDeferred: true, warning};
    }
    const beforeRules = signature(state), beforeHash = prior === null ? null : digest(prior);
    const bytes = await buildBytes(state, loadExcel);
    const saved = commitData({purpose: 'bootstrap', beforeRules, afterRules: beforeRules,
      prior, beforeHash, bytes, afterHash: digest(bytes)}, {currentState: state, nextState: state, saveState, beforeCommit});
    return {path: file, hash: digest(bytes), state: saved, created: prior === null,
      bound: true, needsReview: false, externalChanged: false, warning};
  }
  async function open(state, {beforeCommit = () => {}} = {}) {
    beforeCommit();
    recover(state);
    let bytes = readOptional();
    if (bytes === null) {
      const beforeRules = signature(state);
      bytes = await buildBytes(state, loadExcel);
      if (signature(state) !== beforeRules) throw new Error('规则已变化，请重新打开计分卡片');
      try { atomicWrite(file, bytes, () => {beforeCommit(); assertHash(null);}); } catch (error) { throw fileError(error); }
      observedHash = digest(bytes);
      return {path: file, hash: observedHash, externalChanged: false, created: true, warning};
    }
    const hash = digest(bytes);
    let issue = '', displayWarning = '';
    try {
      const panels = await parseBytes(bytes, state, loadExcel);
      beforeCommit(); assertHash(hash);
      displayWarning = panels.nameWarnings.join('；');
      if (digest(JSON.stringify(panels)) === signature(state)) observedHash = hash;
      else issue = '文件中的规则与当前课堂不同，请刷新预览并应用';
    } catch (error) { issue = error.message; }
    return {path: file, hash, externalChanged: observedHash !== hash || !!issue, created: false, warning: issue || displayWarning || warning};
  }
  async function prepareSave(currentState, nextState) {
    recover(currentState);
    const beforeRules = signature(currentState), afterRules = signature(nextState);
    const prior = readOptional(), beforeHash = prior === null ? null : digest(prior);
    if (prior !== null && observedHash !== beforeHash) {
      const panels = await parseBytes(prior, currentState, loadExcel);
      if (digest(JSON.stringify(panels)) !== beforeRules) throw conflict();
      observedHash = beforeHash;
    }
    const bytes = await buildBytes(nextState, loadExcel);
    assertHash(beforeHash);
    if (signature(currentState) !== beforeRules || signature(nextState) !== afterRules) throw new Error('计分卡片规则已变化，请重新保存');
    return remember({kind: 'save', beforeRules, afterRules, beforeHash, prior, bytes, afterHash: digest(bytes)}, {kind: 'save', ...summaryFor(currentState, configuration(nextState))});
  }
  // saveState MUST be synchronous and return only after the authoritative JSON
  // is durable. The caller assigns its in-memory state only after this returns.
  function commitData(data, {currentState, nextState, saveState, beforeCommit = () => {}}) {
    beforeCommit();
    recover(currentState);
    if (signature(currentState) !== data.beforeRules || signature(nextState) !== data.afterRules) throw new Error('面板或计分卡片已变化，请重新保存');
    assertHash(data.beforeHash);
    const receipt = {version: 1, ...(data.purpose ? {purpose: data.purpose} : {}), beforeRules: data.beforeRules, afterRules: data.afterRules,
      beforeHash: data.beforeHash, afterHash: data.afterHash, beforeBytes: data.prior === null ? null : data.prior.toString('base64')};
    if (typeof saveState !== 'function' || saveState.constructor?.name === 'AsyncFunction') throw new Error('计分卡片保存必须使用同步课堂存档');
    let replaced = false, saveReturned = false;
    try {
      if (data.backupPath && data.prior !== null) atomicWrite(data.backupPath, data.prior, () => {beforeCommit(); assertHash(data.beforeHash);});
      atomicWrite(receiptPath, JSON.stringify(receipt), () => {beforeCommit(); assertHash(data.beforeHash);});
      atomicWrite(file, data.bytes, () => {beforeCommit(); assertHash(data.beforeHash);});
      replaced = true;
      beforeCommit(); assertHash(data.afterHash);
      const saved = saveState(nextState);
      saveReturned = true;
      if (!saved || typeof saved.then === 'function') throw new Error('计分卡片保存必须使用同步课堂存档');
      observedHash = data.afterHash;
      clearReceipt();
      return saved;
    } catch (error) {
      // A callback that returned may already have durably saved JSON. Never
      // roll Excel back on a callback contract violation after that boundary.
      if (saveReturned) {observedHash = undefined; throw new Error(`课堂存档返回了无法确认的结果，已保留计分卡片事务记录，请重新打开核对。${error.message}`);}
      if (replaced) {
        try {
          assertHash(data.afterHash);
          if (data.prior === null) fileSystem.unlinkSync(file);
          else atomicWrite(file, data.prior, () => assertHash(data.afterHash));
          observedHash = data.beforeHash;
          clearReceipt();
        } catch (rollbackError) {
          throw new Error(`计分卡片保存失败，回滚也未完成；已保留事务记录，下次打开时会按课堂存档核对。${error.message}；${rollbackError.message}`);
        }
      } else clearReceipt();
      throw fileError(error);
    }
  }
  function commitPrepared(token, options) {return commitData(take(token, 'save'), options);}
  async function prepareExport(currentState, {expectedHash} = {}) {
    recover(currentState);
    const beforeRules = signature(currentState), prior = readOptional(), beforeHash = prior === null ? null : digest(prior);
    if (expectedHash !== beforeHash) throw conflict();
    const bytes = await buildBytes(currentState, loadExcel);
    assertHash(beforeHash);
    if (signature(currentState) !== beforeRules) throw new Error('面板或计分卡片已变化，请重新重建');
    const backupPath = prior === null ? null : path.join(backupDirectory, `计分卡片-备份-${new Date(now()).toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID()}.xlsx`);
    return remember({kind: 'export', beforeRules, afterRules: beforeRules, beforeHash, prior, bytes, afterHash: digest(bytes), backupPath},
      {kind: 'export', backupPath, ...summaryFor(currentState, configuration(currentState))});
  }
  function commitExport(token, options) {
    const data = take(token, 'export');
    return commitData(data, {...options, nextState: {...options.currentState, revision: options.currentState.revision + 1}});
  }
  async function prepareRefresh(currentState) {
    recover(currentState);
    const beforeRules = signature(currentState), bytes = readOptional();
    if (bytes === null) throw new Error('尚无计分卡片.xlsx，请先点击「打开计分卡片」创建');
    const hash = digest(bytes), panels = await parseBytes(bytes, currentState, loadExcel, {allowInitialTemplate: true});
    let bindingData;
    if (panels.initialTemplate) {
      const next = mergeRules(currentState, panels), boundBytes = await buildBytes(next, loadExcel);
      bindingData = {beforeRules, afterRules: signature(next), beforeHash: hash, prior: bytes,
        bytes: boundBytes, afterHash: digest(boundBytes),
        backupPath: path.join(backupDirectory, `计分卡片-首次绑定前-${new Date(now()).toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID()}.xlsx`)};
    }
    assertHash(hash);
    if (signature(currentState) !== beforeRules) throw new Error('面板或计分卡片已变化，请重新刷新');
    const summary = summaryFor(currentState, panels);
    if (bindingData) summary.warning = `确认后将此初始表格绑定到当前课堂「${panels[0].name}」，并另存原表备份。${summary.warning}`;
    return remember({kind: 'refresh', beforeRules, hash, panels, bindingData},
      {kind: 'refresh', ...summary, ...(bindingData ? {backupPath: bindingData.backupPath, initialBinding: true} : {})});
  }
  function commitRefresh(token, {currentState, saveState, beforeCommit = () => {}}) {
    const data = take(token, 'refresh');
    beforeCommit();
    recover(currentState);
    if (signature(currentState) !== data.beforeRules) throw new Error('面板或计分卡片已变化，请重新刷新');
    assertHash(data.hash);
    const next = mergeRules(currentState, data.panels);
    if (data.bindingData) return commitData(data.bindingData, {currentState, nextState: next, saveState, beforeCommit});
    const saved = saveState(next);
    if (!saved || typeof saved.then === 'function') throw new Error('计分卡片保存必须使用同步课堂存档');
    observedHash = data.hash;
    return saved;
  }
  const asyncGuard = operation => async (...args) => {try {return await operation(...args);} catch (error) {throw fileError(error);}};
  const syncGuard = operation => (...args) => {try {return operation(...args);} catch (error) {throw fileError(error);}};
  return {bootstrap: asyncGuard(bootstrap), open: asyncGuard(open), info: syncGuard(info), prepareSave: asyncGuard(prepareSave), commitPrepared: syncGuard(commitPrepared),
    prepareRefresh: asyncGuard(prepareRefresh), commitRefresh: syncGuard(commitRefresh), prepareExport: asyncGuard(prepareExport),
    commitExport: syncGuard(commitExport), recover: syncGuard(recover),
    get path() { return file; }, get warning() {return warning;},
    status() {return {path: file, observedHash, warning};},
    invalidate() {observedHash = undefined; prepared.clear();}};
}

module.exports = {createScoreRuleWorkbook, configuration, signature, mergeRules, buildBytes, buildInitialBytes, isInitialBytes, parseBytes,
  FILE_NAME, SHEET_NAME, HEADERS, MAX_BYTES, INITIAL_PANEL_ID, INITIAL_MARKER, INITIAL_VERSION, INITIAL_SHA256};
