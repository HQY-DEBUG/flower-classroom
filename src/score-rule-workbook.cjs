'use strict';

// Classroom JSON remains authoritative until a reviewed workbook transaction
// commits both files. Construction never reads a workbook or loads ExcelJS.
const fs = require('node:fs');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const Rules = require('./score-rules.js');
const Progress = require('./pet-progress.js');
const Config = require('./configuration-model.js');
const ConfigSheets = require('./configuration-workbook-sheets.cjs');
const RestoreChain = require('./restore-state-chain.cjs');
const {parsePortableConfig, MAX_CONFIG_BYTES} = require('./portable-config.cjs');

const FILE_NAME = '配置.xlsx';
const LEGACY_FILE_NAME = '计分卡片.xlsx';
const LEGACY_CONFIG_NAME = '配置.txt';
const SHEET_NAME = '计分卡片';
const PROGRESSION_SHEET = '宠物进阶';
const HELP_SHEET = '填写说明';
const INITIAL_PANEL_ID = '__flower_initial_panel_v1__';
const INITIAL_MARKER = 'flower-classroom:unbound-score-rules';
const INITIAL_VERSION = 3;
const LEGACY_INITIAL_SHA256 = 'dc902af8a5ce2be33d6a26e222bd00c28ed370fd98234d2a6592cc29d0eca441';
const INITIAL_SHA256 = 'dfeb710624e314300998fb763ffc57421e421a04950ac903130c0765a8c2be0a';
const HEADERS = ['规则ID', '卡片名称', '积分变化', '成长值变化'];
const LEGACY_HEADERS = ['面板ID', '面板名称', ...HEADERS];
const PROGRESSION_HEADERS = ['面板ID', '面板名称', '成长模式', 'LV2累计成长', 'LV3累计成长', 'LV4累计成长', 'LV5累计成长', 'LV6累计成长', 'LV7累计成长', '成长下限'];
const MODES = {'legacy-step': '旧版每级成长', 'ledger-six': '六段成长账本'};
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 2 * MAX_BYTES + 32768;
const MAX_ROWS = 5000;
const MAX_TOKENS = 12;
const TOKEN_LIFETIME = 15 * 60 * 1000;
const conflict = () => new Error('配置.xlsx 已在外部更改，请先点击「刷新配置」预览整本并应用，再保存页面中的设置');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const initialState = () => ({version: 2, revision: 0,
  students: [], logs: [], settings: {className: '首次启动时绑定当前课堂', petStep: 20, scoreRules: clone(Rules.defaults)},
  panels: {activeId: INITIAL_PANEL_ID, others: []}});
const isInitialBytes = bytes => Buffer.isBuffer(bytes) && digest(bytes) === INITIAL_SHA256;

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
function progression(data) {
  const mode = data.settings.petRules ? 'ledger-six' : 'legacy-step';
  const step = data.settings.petStep ?? 20;
  if (mode === 'legacy-step' && (!Number.isInteger(step) || step < 1 || step > 100)) throw new Error('旧版每级成长值需为1–100的整数');
  const costs = mode === 'ledger-six' ? Progress.thresholds(data.settings.petRules.thresholds) : Array(6).fill(step);
  let total = 0;
  return {mode, cumulative: costs.map(value => total += value), growthFloor: mode === 'ledger-six' ? data.settings.petRules.growthFloor || 'reject' : 'not-applicable'};
}
function configuration(state) {
  return panelEntries(state).map(panel => ({id: panel.id, name: panel.name,
    rules: Rules.list(state.sharedScoreRules ? state : panel.data), ...progression(panel.data)})).sort((a, b) => a.id.localeCompare(b.id));
}
function legacySignature(state) {
  return digest(JSON.stringify(panelEntries(state).map(panel => ({id: panel.id, name: panel.name, rules: Rules.list(panel.data)})).sort((a, b) => a.id.localeCompare(b.id))));
}
function signature(state) {
  return digest(JSON.stringify({panels: configuration(state), shared: state.sharedScoreRules || null, config: Config.snapshot(state), established: state.appConfig !== undefined}));
}
function sameConfiguration(state, panels) {
  const compared = panels.migration?.legacyColumns ? panels.map(panel => ({...panel, rules: panels.migration.panels.find(source => source.id === panel.id).rules})) : panels;
  return JSON.stringify(configuration(state)) === JSON.stringify(compared) && (!panels.configSnapshot || JSON.stringify(Config.snapshot(state)) === JSON.stringify(panels.configSnapshot));
}
function sharedRules(state) {
  if (state.sharedScoreRules) return Rules.list(state);
  const panels = configuration(state), first = panels[0].rules;
  if (panels.some(panel => !Rules.same(first, panel.rules))) throw new Error('旧版面板的计分卡不同，请先预览并确认合并为所有面板共用的计分卡；原规则会保留迁移快照');
  return clone(first);
}
function sourceWithRules(state, panels) {
  const next = clone(state), byId = new Map(panels.map(panel => [panel.id, panel.rules]));
  delete next.sharedScoreRules;
  for (const panel of panelEntries(next)) {delete panel.data.sharedScoreRules; panel.data.settings.scoreRules = clone(byId.get(panel.id));}
  return next;
}
function mergeRules(state, panels) {
  let next = clone(state);
  if (panels.migration?.legacyColumns) {
    if (!next.sharedScoreRules) Rules.confirmShared(next, Rules.previewShared(next).expectedKey);
    const preview = Rules.previewShared(sourceWithRules(state, panels.migration.panels));
    Rules.setShared(next, panels[0].rules, {migration: {panels: preview.panels, mappings: preview.mappings}});
  } else {
    if (!next.sharedScoreRules && Rules.previewShared(next).required) Rules.confirmShared(next, Rules.previewShared(next).expectedKey);
    Rules.setShared(next, panels[0].rules);
  }
  const byId = new Map(panels.map(panel => [panel.id, panel]));
  for (const panel of panelEntries(next)) {
    const incoming = byId.get(panel.id), prior = progression(panel.data);
    if (incoming.mode !== prior.mode) throw new Error(`面板「${panel.name}」成长模式已变化，请重新预览`);
    let last = 0;
    const costs = Progress.thresholds(incoming.cumulative.map(value => {const cost = value - last; last = value; return cost;}));
    if (incoming.mode === 'ledger-six') panel.data.settings.petRules = {...panel.data.settings.petRules, thresholds: costs, growthFloor: incoming.growthFloor};
    else panel.data.settings.petStep = costs[0];
  }
  Config.apply(next, panels.configSnapshot || Config.snapshot(state));
  next.revision = state.revision + 1;
  return next;
}
function summaryFor(state, panels) {
  const prior = new Map(configuration(state).map(panel => [panel.id, panel]));
  const rules = clone(panels[0].rules);
  const summary = panels.map(panel => ({id: panel.id, name: panel.name, count: rules.length,
    changed: !Rules.same(prior.get(panel.id)?.rules || rules, rules), rules: clone(rules)}));
  return {shared: true, panelCount: panels.length, ruleCount: rules.length, rules, summary,
    progression: panels.map(panel => ({id: panel.id, name: panel.name, mode: panel.mode, cumulative: clone(panel.cumulative),
      growthFloor: panel.growthFloor, changed: JSON.stringify([prior.get(panel.id)?.cumulative,prior.get(panel.id)?.growthFloor]) !== JSON.stringify([panel.cumulative,panel.growthFloor])})),
    configSummary: ConfigSheets.summary(Config.snapshot(state), panels.configSnapshot || Config.snapshot(state)),
    ...(panels.migration ? {migration: clone(panels.migration)} : {}),
    warning: (panels.nameWarnings || []).join('；')};
}
function cellScalar(cell, context, {allowHyperlink=false}={}) {
  const value = cell.value;
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) throw new Error(`${context} ${cell.address} 不能使用公式，请填写文字或整数`);
  if (value && typeof value === 'object' && 'error' in value) throw new Error(`${context} ${cell.address} 含有 Excel 错误，请修正后刷新`);
  if (allowHyperlink && value && typeof value.text==='string' && value.text===value.hyperlink) return value.text;
  if (value && Array.isArray(value.richText)) return value.richText.map(part => part.text || '').join('');
  throw new Error(`${context} ${cell.address} 仅支持文字或整数，不支持日期、链接或其他单元格类型`);
}
function integer(value, label, optional = false) {
  if (value === '' && optional) return undefined;
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^[+-]?\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isInteger(number) || Math.abs(number) > 100 || (!optional && number === 0)) throw new Error(`${label}需为−100至100的${optional ? '整数（可填0或留空）' : '非零整数'}`);
  return number;
}
function tableRows(sheet, required) {
  if (sheet.rowCount > MAX_ROWS || sheet.columnCount > 32) throw new Error(`${sheet.name}工作表范围过大，请删除多余行列`);
  const width = Math.max(required.length, sheet.columnCount), headers = [];
  for (let column = 1; column <= width; column++) headers.push(cellScalar(sheet.getRow(1).getCell(column), `${sheet.name}表头`));
  const columns = new Map();
  for (const header of required) {
    const matches = headers.flatMap((value, index) => value === header ? [index + 1] : []);
    if (matches.length !== 1) throw new Error(`「${sheet.name}」第一行必须恰好包含一列「${header}」`);
    columns.set(header, matches[0]);
  }
  if (headers.some(value => value !== '' && !required.includes(value))) throw new Error(`${sheet.name}含有未知表头，请保留原来的${required.length}列`);
  const rows = [];
  for (let index = 2; index <= sheet.rowCount; index++) {
    const values = [];
    for (let column = 1; column <= width; column++) values.push(cellScalar(sheet.getRow(index).getCell(column), `${sheet.name}第${index}行`, {allowHyperlink: sheet.name==='课堂网址'&&headers[column-1]==='网页地址'}));
    if (values.every(value => value === '')) continue;
    if (values.some((value, column) => value !== '' && !required.includes(headers[column]))) throw new Error(`${sheet.name}第${index}行存在表头之外的数据，请修正后刷新`);
    rows.push({index, get: label => values[columns.get(label) - 1]});
  }
  return rows;
}
function formatSheet(sheet) {
  sheet.getRow(1).font = {bold: true, color: {argb: 'FFFFFFFF'}};
  sheet.getRow(1).fill = {type: 'pattern', pattern: 'solid', fgColor: {argb: 'FF395F4A'}};
  sheet.getRow(1).height = 30;
  sheet.eachRow((row, index) => {row.alignment = {vertical: 'middle'}; if (index > 1) row.height = 26;});
}
async function buildBytes(state, loadExcel = () => require('exceljs'), {initialTemplate = false} = {}) {
  const rules = sharedRules(state), panels = configuration(state), ExcelJS = loadExcel();
  const workbook = new ExcelJS.Workbook(); workbook.creator = '花伴课堂';
  if (initialTemplate) workbook.created = workbook.modified = new Date('2024-01-01T00:00:00.000Z');
  const sheet = workbook.addWorksheet(SHEET_NAME, {views: [{state: 'frozen', ySplit: 1}]});
  sheet.columns = HEADERS.map((header, index) => ({header, width: [42, 32, 16, 18][index], style: {numFmt: index < 2 ? '@' : '0'}}));
  for (const rule of rules) sheet.addRow([rule.id, rule.label, rule.delta, rule.growthDelta ?? null]);
  sheet.autoFilter = {from: 'A1', to: 'D1'}; formatSheet(sheet);
  sheet.eachRow((row, index) => {if (index > 1) for (const column of [2, 3, 4]) {
    row.getCell(column).font = {color: {argb: 'FF1D4ED8'}};
    if (column > 2) row.getCell(column).dataValidation = {type: 'whole', operator: 'between', formulae: [-100, 100], allowBlank: column === 4, showErrorMessage: true, errorTitle: HEADERS[column - 1], error: column === 3 ? '填写−100至100的非零整数' : '填写−100至100的整数，或留空沿用当前成长方式'};
  }});
  const stages = workbook.addWorksheet(PROGRESSION_SHEET, {views: [{state: 'frozen', ySplit: 1, xSplit: 2}]});
  stages.columns = PROGRESSION_HEADERS.map((header, index) => ({header, width: [42, 26, 22, 20, 20, 20, 20, 20, 20, 18][index], style: {numFmt: index < 3 ? '@' : '0'}}));
  for (const panel of panels) stages.addRow([panel.id, panel.name, MODES[panel.mode], ...panel.cumulative, panel.growthFloor === 'not-applicable' ? '不适用' : panel.growthFloor]);
  stages.autoFilter = {from: 'A1', to: 'J1'}; formatSheet(stages);
  stages.eachRow((row, index) => {if (index > 1) for (let column = 4; column <= 9; column++) {
    row.getCell(column).font = {color: {argb: 'FF1D4ED8'}};
    row.getCell(column).dataValidation = {type: 'whole', operator: 'between', formulae: [1, 1000000000], allowBlank: false, showErrorMessage: true, errorTitle: '累计成长门槛', error: '填写严格递增的累计成长整数，最大1000000000；旧版须为同一每级值的1至6倍'};
  }});
  stages.eachRow((row,index)=>{if(index>1)row.getCell(10).dataValidation={type:'list',allowBlank:false,formulae:[row.getCell(3).value===MODES['legacy-step']?'"不适用"':'"reject,clamp"'],showErrorMessage:true,error:'旧版保留不适用；六段选择reject或clamp'};});
  ConfigSheets.addSheets(workbook, state, formatSheet);
  const help = workbook.addWorksheet(HELP_SHEET);
  help.columns = [{header: '项目', width: 24}, {header: '填写方法', width: 110}];
  help.addRows([
    ['编辑后应用', '本文件是统一配置。保存 Excel 后回到花伴课堂，点击「刷新配置」，预览全部工作表并确认后一起应用。窗口与启动设置下次重启生效，其余以预览标注为准。'],
    ['共享计分卡', '全部面板共用计分卡工作表中的这一套卡片，不按面板复制。卡片名称必填1–120字；积分变化为−100至100的非零整数。'],
    ['成长值变化', '可填−100至100的整数；0表示成长值不变。留空保留既有方式：独立宠物成长按积分同方向变化，旧成长仅随加分增加。'],
    ['规则ID', '现有卡片保留原规则ID。新增卡片填写不同编号，仅使用英文字母、数字、下划线和短横线。全体共享1–2000张卡片，ID不得重复。'],
    ['宠物进阶', 'LV2至LV7各列填写达到该等级所需的累计成长值。成长值与可消费积分分开：兑换扣积分不会扣减成长，也不会改变这些门槛。'],
    ['成长模式', '每个面板保留当前成长模式，不能在表中切换。旧版每级成长：LV2至LV7必须为同一每级值（1–100）的1至6倍。六段成长账本：累计值严格递增，总计不超过10亿。'],
    ['面板ID与名称', '宠物进阶表按面板ID对应，请保留编号并包含全部现有面板。面板名称仅供识别，下次应用会同步当前班名。'],
    ['旧表迁移', '旧表缺少宠物进阶页时，刷新预览会保留每个面板当前成长模式及门槛。旧表按面板分开的卡片需明确确认合并，冲突卡片保留独立编号，并备份原表。'],
    ['保存失败后重试', '如果替换表格被拒绝，原表与课堂设置会保留。关闭可能占用表格的程序并检查文件权限后，重新预览或再次保存；不会先删除原表。'],
    ['允许的内容', '只填写文字、数值及true/false，不使用公式、日期或Excel错误值。网址须在课堂网址表填写完整http(s)文本。保留全部工作表与表头；空网址面板保留一行（空）标记。'],
    ['旧配置迁移', '旧配置.txt、计分卡片.xlsx和旧事务记录仅作为只读迁移来源，原件不删除、不覆盖。统一配置建立后，不会因本文件损坏或丢失而回退旧配置。'],
    ['工具默认', '工具默认只用于未来打开或开始新一轮，不改正在运行的计时、点名结果和已用名单。对象：students为学生、groups为小组。策略：cycle为本轮不重复、repeat为允许重复。'],
    ['工具数值与响铃', '计时默认秒数1–10800；点名及宠物默认数量1–20；挑战默认秒数10–180。响铃可选tick（提示音）、applause（掌声）、laser（电子音）。'],
    ['显示与排序', '显示头像、隐藏后两级、启动最小化填true或false。排序：natural添加顺序、name姓名、scoreDesc积分降序、scoreAsc积分升序、growth成长降序、level等级降序、leader组长优先、custom保留课堂自定顺序。'],
    ['成长下限', '六段成长账本：reject低于0时拒绝，clamp低于0时截到0；旧版模式必须保留不适用。此设置不修改已有历史或撤销差额。'],
    ['配置范围', '名单、照片、小组成员、自定名单顺序、运行中计时/抽取、积分与宠物历史、密码均为课堂数据，不放入配置表。'],
    ['历史记录', '修改卡片和门槛不会重写已有积分、成长账目、徽章或毕业快照。等级显示按当前成长门槛计算。']
  ]);
  if (initialTemplate) help.addRows([
    ['首次启动', '这是尚未绑定课堂的初始表格。原样文件按当前课堂生成正式面板编号。提前编辑的文件会保留，需要刷新预览确认；有多个面板时请核对宠物进阶来源。'],
    [INITIAL_MARKER, INITIAL_VERSION]
  ]);
  if (initialTemplate) help.getRow(help.rowCount).hidden = true;
  formatSheet(help); help.getColumn(2).alignment = {wrapText: true, vertical: 'top'};
  help.eachRow((row, index) => {if (index > 1) row.height = 52;});
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  if (bytes.length > MAX_BYTES) throw new Error('计分卡片文件超过5MB，请减少不必要的格式或内容');
  return initialTemplate ? fixedZipDates(bytes) : bytes;
}
async function buildInitialBytes(loadExcel = () => require('exceljs')) {return buildBytes(initialState(), loadExcel, {initialTemplate: true});}
async function parseBytes(bytes, state, loadExcel = () => require('exceljs'), {allowInitialTemplate = false, legacyInput = false} = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES) throw new Error('计分卡片文件不能超过5MB');
  const zip = await require('unzipper').Open.buffer(bytes);
  if (zip.files.length > 2000 || zip.files.reduce((total, file) => total + file.uncompressedSize, 0) > 20 * 1024 * 1024) throw new Error('计分卡片解压内容过大，请使用简洁的计分卡片文件');
  const ExcelJS = loadExcel(), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet(SHEET_NAME), stages = workbook.getWorksheet(PROGRESSION_SHEET), help = workbook.getWorksheet(HELP_SHEET);
  if (!sheet) throw new Error('找不到「计分卡片」工作表，请保留原工作表名称');
  for (const other of workbook.worksheets) if (![SHEET_NAME, PROGRESSION_SHEET, HELP_SHEET, ...Object.keys(ConfigSheets.SHEETS)].includes(other.name) && other.actualRowCount > 0) throw new Error(`工作表「${other.name}」含有无法应用的数据，请保留统一配置中的分类工作表`);
  let templateMarker = false, templateBound = false;
  if (help) {if (help.rowCount > MAX_ROWS) throw new Error('填写说明行数过多'); help.eachRow(row => {if (row.getCell(1).value === INITIAL_MARKER && [1, 2, INITIAL_VERSION].includes(row.getCell(2).value)) templateMarker = true;});}
  const panels = configuration(state), byId = new Map(panels.map(panel => [panel.id, panel])), warnings = [];
  function findPanel(id, index) {
    let panel = byId.get(id);
    if (!panel && id === INITIAL_PANEL_ID && templateMarker) {
      if (!allowInitialTemplate) throw new Error('初始计分卡片尚未绑定课堂，文件已保留；请点击「刷新计分卡片」预览确认');
      if (panels.length !== 1) throw new Error('初始计分卡片尚未绑定，当前存在多个面板，无法确定宠物进阶属于哪个班级；文件已保留，请核对后用当前规则重建表格，原表会另存备份');
      panel = panels[0]; templateBound = true;
    }
    if (!panel) throw new Error(`第${index}行的面板ID不存在，请使用当前面板的原始编号`);
    return panel;
  }
  const legacyColumns = sheet.getRow(1).values.includes('面板ID');
  const sourcePanels = panels.map(panel => ({id: panel.id, name: panel.name, rules: []})), sourceById = new Map(sourcePanels.map(panel => [panel.id, panel]));
  const rules = [];
  for (const {index, get} of tableRows(sheet, legacyColumns ? LEGACY_HEADERS : HEADERS)) {
    const rule = {id: get('规则ID'), label: get('卡片名称'), delta: integer(get('积分变化'), `第${index}行积分变化`)};
    const growthDelta = integer(get('成长值变化'), `第${index}行成长值变化`, true); if (growthDelta !== undefined) rule.growthDelta = growthDelta;
    try {Rules.validateRules([rule]);} catch (error) {throw new Error(`第${index}行：${error.message}`);}
    if (legacyColumns) {const panel = findPanel(get('面板ID'), index); sourceById.get(panel.id).rules.push(rule); if (get('面板名称') !== panel.name) warnings.push(`面板名称已按当前课堂「${panel.name}」识别`);}
    else rules.push(rule);
  }
  if (!legacyInput && !stages) throw Error('配置.xlsx缺少「宠物进阶」工作表，未应用任何设置');
  if (!legacyInput && legacyColumns) throw Error('配置.xlsx的计分卡片必须为全局共享四列格式，请从旧文件迁移预览导入');
  let migration = {legacyColumns, missingProgression: !stages}, shared;
  if (legacyColumns) {
    for (const panel of sourcePanels) {try {panel.rules = Rules.validateRules(panel.rules);} catch (error) {throw new Error(`面板「${panel.name}」：${error.message}`);}}
    const preview = Rules.previewShared(sourceWithRules(state, sourcePanels)); shared = preview.rules;
    migration = {...migration, panels: sourcePanels, conflicts: preview.conflicts, mappings: preview.mappings};
    warnings.push('这是按面板分开的旧表。确认后将合并为全部面板共用的一套计分卡，保留冲突卡片及迁移快照，并先备份原表');
  } else shared = Rules.validateSharedRules(rules);
  for (const panel of panels) panel.rules = clone(shared);
  if (stages) {
    const seen = new Set();
    const stageHeaders = legacyInput && !stages.getRow(1).values.includes('成长下限') ? PROGRESSION_HEADERS.slice(0,9) : PROGRESSION_HEADERS;
    for (const {index, get} of tableRows(stages, stageHeaders)) {
      const panel = findPanel(get('面板ID'), index); if (seen.has(panel.id)) throw new Error(`宠物进阶第${index}行面板ID重复`); seen.add(panel.id);
      if (get('面板名称') !== panel.name) warnings.push(`面板名称已按当前课堂「${panel.name}」识别，下次保存同步显示名称`);
      if (get('成长模式') !== MODES[panel.mode]) throw new Error(`面板「${panel.name}」成长模式不能在表格中切换，请保留「${MODES[panel.mode]}」`);
      const cumulative = PROGRESSION_HEADERS.slice(3,9).map(header => {const raw = get(header), value = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN; if (!Number.isSafeInteger(value) || value < 1 || value > 1000000000) throw new Error(`宠物进阶第${index}行${header}需为1至1000000000的整数`); return value;});
      let last = 0; const costs = cumulative.map(value => {const cost = value - last; last = value; return cost;});
      try {Progress.thresholds(costs);} catch {throw new Error(`宠物进阶第${index}行LV2至LV7累计成长必须严格递增，合计不超过1000000000`);}
      if (panel.mode === 'legacy-step' && (costs[0] > 100 || costs.some(value => value !== costs[0]))) throw new Error(`面板「${panel.name}」使用旧版每级成长，LV2至LV7须为同一每级值（1–100）的1至6倍`);
      panel.cumulative = cumulative;
      if (stageHeaders.includes('成长下限')) {const floor=get('成长下限');if(panel.mode==='legacy-step'&&floor!=='不适用')throw Error('旧版成长下限须保留「不适用」，不会隐式启用账本');if(panel.mode==='ledger-six'&&!['reject','clamp'].includes(floor))throw Error('成长下限只能为reject或clamp');panel.growthFloor=panel.mode==='legacy-step'?'not-applicable':floor;}
    }
    if (seen.size !== panels.length) throw new Error('宠物进阶工作表须恰好包含每个现有面板，不得遗漏');
  } else warnings.push('旧表缺少「宠物进阶」工作表。确认后保留各面板当前成长模式和门槛，补齐工作表；不会启用或重置成长账本');
  const extra = ConfigSheets.parseSheets(workbook, state, {tableRows, findPanel, legacyInput, initialPanelId: INITIAL_PANEL_ID, initialPanelName: initialState().settings.className});
  Object.defineProperty(panels, 'configSnapshot', {value: extra.snapshot, writable: true});
  if (extra.missing.length) {migration.missingSheets=extra.missing;warnings.push('旧表未包含的其他分类设置保留当前已保存值');}
  Object.defineProperty(panels, 'nameWarnings', {value: [...new Set(warnings)]});
  Object.defineProperty(panels, 'initialTemplate', {value: templateBound});
  if (legacyInput || legacyColumns || !stages) Object.defineProperty(panels, 'migration', {value: migration});
  return panels;
}

function createScoreRuleWorkbook({resourceDirectory, backupDirectory = resourceDirectory, dataDirectory = path.join(resourceDirectory || '', '数据'), fileSystem = fs, loadExcel = () => require('exceljs'), now = Date.now} = {}) {
  if (typeof resourceDirectory !== 'string' || !path.isAbsolute(resourceDirectory)) throw new Error('计分卡片文件夹必须为绝对路径');
  if (typeof backupDirectory !== 'string' || !path.isAbsolute(backupDirectory) || path.relative(resourceDirectory, backupDirectory).startsWith('..') || path.isAbsolute(path.relative(resourceDirectory, backupDirectory))) throw new Error('计分卡片备份必须保存在程序文件夹内');
  if(typeof dataDirectory!=='string'||!path.isAbsolute(dataDirectory)||path.relative(resourceDirectory,dataDirectory).startsWith('..')||path.isAbsolute(path.relative(resourceDirectory,dataDirectory)))throw Error('配置数据目录必须保存在程序文件夹内');
  const file = path.join(resourceDirectory, FILE_NAME);
  const receiptPath = file + '.flower-pending.json';
  const legacyFile = path.join(resourceDirectory, LEGACY_FILE_NAME);
  const legacyText = path.join(resourceDirectory, LEGACY_CONFIG_NAME);
  const legacyReceipt = legacyFile + '.flower-pending.json';
  const prepared = new Map();
  let observedHash, warning = '', restoreRecoveryPending = false;
  function readOptional(target = file, limit = MAX_BYTES) {
    let stat;
    try { stat = fileSystem.statSync(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.size > limit) throw new Error(`${path.basename(target)} 不是可读取的文件或超过大小上限`);
    const bytes = fileSystem.readFileSync(target);
    if (bytes.length > limit) throw new Error(`${path.basename(target)} 超过大小上限`);
    return bytes;
  }
  function legacySources() {
    const entries=[[legacyText,MAX_CONFIG_BYTES,'legacy-text'],[legacyFile,MAX_BYTES,'legacy-workbook'],[legacyReceipt,MAX_RECEIPT_BYTES,'legacy-receipt']];
    const sources=entries.map(([source,limit,kind])=>{const bytes=readOptional(source,limit);return {path:source,name:path.basename(source),limit,kind,bytes,hash:bytes===null?null:digest(bytes)};});
    const migrationPath=path.join(dataDirectory,'legacy-migration-receipt-v1.json'),receiptBytes=readOptional(migrationPath,256*1024);
    if(receiptBytes===null)return sources;
    let receipt;try{receipt=JSON.parse(receiptBytes.toString('utf8'));}catch{throw Error('旧数据迁移凭据无法读取，请保留文件并核对');}
    if(!Array.isArray(receipt.configurationSources)||!receipt.configurationSources.length)return sources;
    let archiveDirectory=receipt.archiveDirectory;
    if(receipt.archiveRelativePath!==undefined){if(typeof receipt.archiveRelativePath!=='string'||path.isAbsolute(receipt.archiveRelativePath))throw Error('旧配置迁移来源相对目录无效');archiveDirectory=path.resolve(resourceDirectory,receipt.archiveRelativePath);}
    if(receipt.configurationSources.length>3||typeof archiveDirectory!=='string'||!path.isAbsolute(archiveDirectory)||path.relative(backupDirectory,archiveDirectory).startsWith('..')||path.isAbsolute(path.relative(backupDirectory,archiveDirectory)))throw Error('旧配置迁移来源目录无效，请保留迁移备份并核对');
    const seen=new Set();
    for(const item of receipt.configurationSources){
      if(!item||!entries.some(entry=>entry[2]===item.kind)||seen.has(item.kind)||typeof item.relativePath!=='string'||path.isAbsolute(item.relativePath)||!/^([a-f0-9]{64})$/.test(item.sha256)||!Number.isSafeInteger(item.sizeBytes)||item.sizeBytes<0)throw Error('旧配置迁移来源清单无效');seen.add(item.kind);
      const target=path.resolve(archiveDirectory,item.relativePath),relative=path.relative(archiveDirectory,target);
      if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('旧配置迁移来源不能越出备份目录');
      const rootSource=sources.find(source=>source.kind===item.kind),bytes=readOptional(target,rootSource.limit);
      if(bytes===null||bytes.length!==item.sizeBytes||digest(bytes)!==item.sha256)throw Error(`旧配置迁移备份「${item.relativePath}」已变化或缺失，请保留原件并核对`);
      if(rootSource.bytes!==null&&rootSource.hash!==item.sha256)throw Error(`程序根目录与迁移备份的「${rootSource.name}」不同，请先核对旧配置来源`);
      sources.push({path:target,name:path.basename(target),limit:rootSource.limit,kind:item.kind,bytes,hash:item.sha256,archived:true});
    }
    sources.push({path:migrationPath,name:path.basename(migrationPath),limit:256*1024,kind:'migration-manifest',bytes:receiptBytes,hash:digest(receiptBytes)});
    return sources;
  }
  function checkSources(sources) {for(const source of sources||[]){const bytes=readOptional(source.path,source.limit);if((bytes===null?null:digest(bytes))!==source.hash)throw Error(`旧配置来源「${source.name}」在预览后已变化，请重新预览；新旧文件均已保留`);}}
  function needsLegacyReview(state, prior) {return state.appConfig===undefined&&(prior===null||isInitialBytes(prior))&&legacySources().some(source=>source.bytes!==null);}
  function hashNow() { const bytes = readOptional(); return bytes === null ? null : digest(bytes); }
  function assertHash(expected) { if (hashNow() !== expected) throw conflict(); }
  function receiptHashNow() { const bytes = readOptional(receiptPath, MAX_RECEIPT_BYTES); return bytes === null ? null : digest(bytes); }
  function assertReceiptHash(expected) {
    if (receiptHashNow() !== expected) throw new Error('计分卡片事务记录已变化，请重新预览；已保留现有文件和当前有效规则');
  }
  function atomicWrite(target, bytes, beforeCommit = () => {}) {
    const temporary = target + '.flower-' + randomUUID() + '.tmp';
    let created = false;
    try {
      const fd = fileSystem.openSync(temporary, 'wx', 0o600);
      created = true;
      try { fileSystem.writeFileSync(fd, bytes); fileSystem.fsyncSync(fd); } finally { fileSystem.closeSync(fd); }
      beforeCommit();
      try {fileSystem.renameSync(temporary, target);} catch (error) {
        error.flowerWriteStage = 'replace'; error.flowerWriteTarget = target; throw error;
      }
      created = false;
    } finally {
      if (created) try { fileSystem.unlinkSync(temporary); } catch {}
    }
  }
  function fileError(error) {
    if (error.flowerFormatted) return error;
    if(error.flowerSaveStage==='classroom')return Object.assign(new Error(`课堂资料文件保存失败${error.code?'（'+error.code+'）':''}，本次课堂和配置修改已回滚，原文件与备份保留。请检查资料文件及文件夹的写入权限和可用空间，再重新预览并重试。${error.message}`),{code:error.code,flowerFormatted:true,retryable:true,stage:'classroom'});
    if (['EACCES', 'EPERM', 'EROFS', 'EBUSY', 'ENOSPC', 'ENOENT'].includes(error.code)) {
      const replacement = error.flowerWriteStage === 'replace' && error.flowerWriteTarget === file;
      const message = replacement
        ? `无法替换「${FILE_NAME}」（${error.code}）：临时文件已写好，但系统拒绝替换原表，具体原因尚未确认。原表和课堂设置已保留。请关闭可能占用表格的 Excel/WPS，检查文件及程序文件夹的写入权限与可用空间，然后重新预览或点击「重试保存」。程序不会先删除原表。`
        : `无法保存「${FILE_NAME}」（${error.code}）：请关闭可能占用文件的 Excel/WPS，检查可用空间及文件、程序文件夹的写入权限，然后重新预览或重试保存。`;
      return Object.assign(new Error(message + ' ' + error.message), {code: error.code, flowerFormatted: true, retryable: true, stage: error.flowerWriteStage || 'write'});
    }
    return error;
  }
  function clearReceipt(expectedHash, committed = true) {
    try {
      assertReceiptHash(expectedHash);
      fileSystem.unlinkSync(receiptPath); warning = ''; restoreRecoveryPending=false; return true;
    } catch (error) {
      if (error.code === 'ENOENT') {warning = '';restoreRecoveryPending=false; return true;}
      warning = `${committed ? '规则已保存' : '当前有效规则已保留'}，事务记录暂未清理；下次打开计分卡片时将重新核对。${error.message}`;
      return false;
    }
  }
  function decodeReceipt(bytes) {
    let receipt;
    try { receipt = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('计分卡片事务记录损坏，请保留文件并重新核对，当前有效规则未改变'); }
    if (!receipt || ![1, 2].includes(receipt.version) || !['beforeRules', 'afterRules', 'afterHash'].every(key => /^[a-f0-9]{64}$/.test(receipt[key])) || !(receipt.beforeHash === null || /^[a-f0-9]{64}$/.test(receipt.beforeHash)) || !(receipt.beforeBytes === null || typeof receipt.beforeBytes === 'string')) throw new Error('计分卡片事务记录格式无效，请保留文件并重新核对');
    const prior = receipt.beforeBytes === null ? null : Buffer.from(receipt.beforeBytes, 'base64');
    if ((prior === null ? null : digest(prior)) !== receipt.beforeHash || (prior && prior.length > MAX_BYTES)) throw new Error('计分卡片事务记录校验失败，请保留文件并重新核对');
    if (receipt.version === 1 && receipt.purpose !== undefined && (receipt.purpose !== 'bootstrap' || (receipt.configurationVersion!==2 && receipt.beforeRules !== receipt.afterRules) || (prior !== null && !isInitialBytes(prior) && digest(prior) !== LEGACY_INITIAL_SHA256))) throw new Error('计分卡片初始化事务校验失败，请保留文件并重新核对');
    if (receipt.version === 2 && (receipt.purpose !== 'rebuild' || (receipt.configurationVersion!==2 && receipt.beforeRules !== receipt.afterRules) ||
      !(receipt.priorReceipt === null || (receipt.priorReceipt && /^配置-事务备份-\d+-[a-f0-9-]{36}\.json$/.test(receipt.priorReceipt.name) && /^[a-f0-9]{64}$/.test(receipt.priorReceipt.hash))))) throw new Error('计分卡片重建事务校验失败，请保留文件并重新核对');
    if(receipt.restoreChain!==undefined){RestoreChain.validate(receipt.restoreChain);if(!/^[a-f0-9]{64}$/.test(receipt.beforeStateHash)||!/^[a-f0-9]{64}$/.test(receipt.afterStateHash)||typeof receipt.restoreUnverifiedBefore!=='boolean'||(receipt.beforeStateUpgradedHash!==undefined&&!/^[a-f0-9]{64}$/.test(receipt.beforeStateUpgradedHash)))throw Error('课堂恢复完整状态凭据无效');}
    return {...receipt, prior};
  }
  function priorReceiptBytes(receipt) {
    if (receipt.version !== 2 || receipt.priorReceipt === null) return null;
    const bytes = readOptional(path.join(backupDirectory, receipt.priorReceipt.name), MAX_RECEIPT_BYTES);
    if (bytes === null || digest(bytes) !== receipt.priorReceipt.hash) throw new Error('重建前事务记录的备份缺失或已变化，请保留现有文件并核对');
    return bytes;
  }
  function recover(state) {
    const bytes = readOptional(receiptPath, MAX_RECEIPT_BYTES);
    if (!bytes) return {recovered: false};
    const receipt = decodeReceipt(bytes), receiptHash = digest(bytes), current = receipt.configurationVersion === 2 ? signature(state) : legacySignature(state), actual = hashNow();
    const oldReceipt = priorReceiptBytes(receipt);
    if(receipt.restoreChain)restoreRecoveryPending=true;
    const wholeState=receipt.restoreChain?RestoreChain.stateHash(state):null;
    const afterMatches=receipt.restoreChain?wholeState===receipt.afterStateHash:current===receipt.afterRules;
    const beforeMatches=receipt.restoreChain?(wholeState===receipt.beforeStateHash||wholeState===receipt.beforeStateUpgradedHash||(receipt.restoreUnverifiedBefore&&RestoreChain.primaryBefore(receipt.restoreChain,dataDirectory,fileSystem))):current===receipt.beforeRules;
    if (afterMatches && actual === receipt.afterHash) {
      clearReceipt(receiptHash); observedHash = actual; return {recovered: true, committed: true};
    }
    // Before the first JSON save, a restart may create different random panel
    // IDs. Only a verified bootstrap receipt can roll back to the exact shipped
    // template (or absence) independently of that initial state's fingerprint.
    if ((!beforeMatches && receipt.purpose !== 'bootstrap') || ![receipt.beforeHash, receipt.afterHash].includes(actual)) throw new Error('上次计分卡片保存尚未完成，且文件或课堂规则已变化。已保留两份资料，请先核对，当前有效规则未改变');
    // A confirmed rebuild can supersede an ambiguous old receipt, but only
    // after preserving it. A failed rebuild restores that exact old evidence.
    assertReceiptHash(receiptHash);
    if(receipt.restoreChain)RestoreChain.restore(receipt.restoreChain,dataDirectory,backupDirectory,fileSystem);
    if (actual === receipt.afterHash && actual !== receipt.beforeHash) {
      if (receipt.prior === null) { assertHash(actual); assertReceiptHash(receiptHash); fileSystem.unlinkSync(file); }
      else atomicWrite(file, receipt.prior, () => {assertHash(actual); assertReceiptHash(receiptHash);});
    }
    if (oldReceipt !== null) {
      atomicWrite(receiptPath, oldReceipt, () => {assertHash(receipt.beforeHash); assertReceiptHash(receiptHash);});
      observedHash = undefined;
      throw new Error('上次重建尚未完成，原表格和事务记录已恢复；请用当前规则重新预览重建');
    }
    clearReceipt(receiptHash, false); observedHash = receipt.beforeHash;
    const result={recovered: true, committed: false};if(receipt.restoreChain)Object.defineProperty(result,'reloadState',{value:true});return result;
  }
  function reconcileBeforeStateChange(currentState, nextState, {force = false} = {}) {
    if (!force && !restoreRecoveryPending && signature(currentState) === signature(nextState)) return {recovered: false};
    const result = recover(currentState);
    if (receiptHashNow() !== null) throw new Error(`计分卡片事务记录尚未清理，本次班级、面板或规则变更未保存。请关闭 Excel 后重试，或用当前规则重建表格。${warning}`);
    return result;
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
  function info(state) {
    const bytes = readOptional();
    const migrationAvailable=!!state&&needsLegacyReview(state,bytes);
    return {path: file, existing: bytes !== null, hash: bytes === null ? null : digest(bytes), migrationAvailable, warning: migrationAvailable?'检测到旧版配置，请点击刷新配置预览迁移；旧文件将原样保留':warning};
  }
  async function bootstrap(state, {saveState, beforeCommit = () => {}} = {}) {
    beforeCommit();const recovery=recover(state);
    if(recovery.reloadState)return {path:file,state,created:false,bound:false,requiresStateReload:true,warning:'恢复前课堂文件链已复原，正在重新读取课堂资料'};
    const prior=readOptional();
    if(state.appConfig!==undefined){
      if(prior===null)return {path:file,state,created:false,bound:false,needsReview:true,warning:'配置.xlsx已丢失，课堂继续使用最后有效配置；请在统一配置中预览重建。不会回退旧配置.txt或计分卡片.xlsx'};
      const hash=digest(prior);let review='';
      try {const parsed=await parseBytes(prior,state,loadExcel);beforeCommit();assertHash(hash);if(!sameConfiguration(state,parsed))review='配置.xlsx含有尚未应用的外部修改，继续使用最后有效配置；请刷新整本预览确认';else observedHash=hash;}
      catch(error){review='配置.xlsx暂时无法核对，继续使用最后有效配置；请在统一配置中修复或预览重建。'+error.message;}
      return {path:file,hash,state,created:false,bound:false,validated:!review,needsReview:!!review,warning:review||warning};
    }
    if(needsLegacyReview(state,prior))return {path:file,hash:prior===null?null:digest(prior),state,created:false,bound:false,needsReview:true,migrationAvailable:true,warning:'检测到旧版配置，请打开统一配置并点击刷新，核对整本迁移预览后确认；旧配置.txt、计分卡片.xlsx及事务记录均保留原样'};
    if(prior!==null&&!isInitialBytes(prior))return {path:file,hash:digest(prior),state,created:false,bound:false,needsReview:true,validationDeferred:true,warning:'统一配置文件需要核对，请刷新预览后确认；当前继续使用课堂中最后有效的设置'};
    const next=clone(state);Rules.promoteShared(next);Config.apply(next,Config.snapshot(state));
    const beforeRules=signature(state),beforeHash=prior===null?null:digest(prior),bytes=await buildBytes(next,loadExcel);
    const saved=commitData({purpose:'bootstrap',beforeRules,afterRules:signature(next),prior,beforeHash,bytes,afterHash:digest(bytes)}, {currentState:state,nextState:next,saveState,beforeCommit});
    return {path:file,hash:digest(bytes),state:saved,created:prior===null,bound:true,needsReview:false,externalChanged:false,warning};
  }
  async function open(state, {beforeCommit = () => {}} = {}) {
    beforeCommit();
    recover(state);
    let bytes = readOptional();
    if(needsLegacyReview(state,bytes))return {path:file,existing:bytes!==null,opened:false,migrationAvailable:true,externalChanged:true,warning:'请先点击刷新配置查看旧版迁移预览，确认后生成统一配置.xlsx；原件保留'};
    if (bytes === null && state.appConfig!==undefined)throw Error('配置.xlsx已丢失，请预览重建当前有效配置；不会回退旧配置文件');
    if (bytes === null) {
      reconcileBeforeStateChange(state, state, {force: true});
      const beforeRules = signature(state);
      bytes = await buildBytes(state, loadExcel);
      if (signature(state) !== beforeRules) throw new Error('规则已变化，请重新打开计分卡片');
      try { atomicWrite(file, bytes, () => {beforeCommit(); assertHash(null); assertReceiptHash(null);}); } catch (error) { throw fileError(error); }
      observedHash = digest(bytes);
      return {path: file, hash: observedHash, externalChanged: false, created: true, warning};
    }
    const hash = digest(bytes);
    let issue = '', displayWarning = '';
    try {
      const panels = await parseBytes(bytes, state, loadExcel);
      beforeCommit(); assertHash(hash);
      displayWarning = panels.nameWarnings.join('；');
      if (sameConfiguration(state, panels) && !panels.migration) observedHash = hash;
      else issue = '文件中的规则与当前课堂不同，请刷新预览并应用';
    } catch (error) { issue = error.message; }
    return {path: file, hash, externalChanged: observedHash !== hash || !!issue, created: false, warning: issue || displayWarning || warning};
  }
  async function prepareSave(currentState, nextState) {
    recover(currentState);
    const beforeRules = signature(currentState), afterRules = signature(nextState);
    const prior = readOptional(), beforeHash = prior === null ? null : digest(prior);
    if(needsLegacyReview(currentState,prior))throw Error('请先打开统一配置并刷新预览旧版迁移，确认后再保存设置；旧文件尚未改变');
    if(prior===null&&currentState.appConfig!==undefined)throw Error('配置.xlsx已丢失，请先用当前有效配置预览重建，再保存设置');
    let migrationBackup = false;
    if (prior !== null && !isInitialBytes(prior)) {
      const panels = await parseBytes(prior, currentState, loadExcel);
      if (!sameConfiguration(currentState, panels)) throw conflict();
      migrationBackup = !!panels.migration;
      observedHash = beforeHash;
    }
    const bytes = await buildBytes(nextState, loadExcel);
    assertHash(beforeHash);
    if (signature(currentState) !== beforeRules || signature(nextState) !== afterRules) throw new Error('计分卡片规则已变化，请重新保存');
    return remember({kind: 'save', beforeRules, afterRules, beforeHash, prior, bytes, afterHash: digest(bytes), ...(migrationBackup ? {backupPath: path.join(backupDirectory, `配置-迁移前-${new Date(now()).toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID()}.xlsx`)} : {})}, {kind: 'save', ...summaryFor(currentState, configuration(nextState))});
  }
  async function prepareRestore(currentState, incomingState, {recoveryRebuild = false} = {}) {
    // A normal restore may replace only the current applied configuration. An
    // unreadable classroom uses a separately disclosed, explicit recovery flow.
    if (!recoveryRebuild) {recover(currentState);if(receiptHashNow()!==null)throw Error('配置事务尚未核对完成，请先处理当前配置再恢复备份');}
    const beforeRules=signature(currentState),beforeRevision=currentState.revision;
    const prior=readOptional(),beforeHash=prior===null?null:digest(prior);
    const priorReceipt=readOptional(receiptPath,MAX_RECEIPT_BYTES),receiptHash=priorReceipt===null?null:digest(priorReceipt);
    const unbound=prior!==null&&isInitialBytes(prior)&&currentState.appConfig===undefined;
    if(!recoveryRebuild&&prior!==null&&!unbound){
      if(observedHash!==undefined&&observedHash!==beforeHash)throw conflict();
      let parsed;try{parsed=await parseBytes(prior,currentState,loadExcel);}catch(error){throw Error('当前配置.xlsx无法核对，未恢复任何课堂数据。请先在统一配置中处理当前文件，再重新预览备份。'+error.message);}
      if(!sameConfiguration(currentState,parsed))throw conflict();
    }
    const next=clone(incomingState),keptStartup=next.appConfig===undefined;
    if(keptStartup)next.appConfig=clone(Config.snapshot(currentState).appConfig);
    const sharePreview=Rules.previewShared(next);
    if(!next.sharedScoreRules)Rules.confirmShared(next,sharePreview.expectedKey);
    Config.apply(next,Config.snapshot(next));next.revision=currentState.revision+1;
    const verifiedNext=require('./core.cjs').validateState(next);
    const stateChain=RestoreChain.capture(dataDirectory,currentState,verifiedNext,fileSystem);
    const bytes=await buildBytes(verifiedNext,loadExcel),stamp=new Date(now()).toISOString().replace(/[-:.TZ]/g,'');
    const backupPath=prior===null?null:path.join(backupDirectory,`配置-恢复前-${stamp}-${randomUUID()}.xlsx`);
    const receiptBackupPath=priorReceipt===null?null:path.join(backupDirectory,`配置-事务备份-${stamp}-${randomUUID()}.json`);
    assertHash(beforeHash);assertReceiptHash(receiptHash);
    if(signature(currentState)!==beforeRules||currentState.revision!==beforeRevision)throw Error('课堂资料已在恢复预览期间变化，请重新选择备份');
    const summary=summaryFor(currentState,configuration(next));summary.configSummary=ConfigSheets.summary(Config.snapshot(currentState),Config.snapshot(next),{includeNewPanels:true});
    summary.warning='确认后同时恢复全部课堂数据和整本配置.xlsx；恢复前文件会先保留备份。';
    if(keptStartup)summary.warning+='此旧备份不含启动显示参数，将沿用当前启动参数。';
    if(sharePreview.required){summary.migration={legacyColumns:true,panels:sharePreview.panels,conflicts:sharePreview.conflicts,mappings:sharePreview.mappings};summary.warning+='备份中各面板的旧卡片不同，本次将合并为全局共享卡片，保留全部冲突版本、原规则快照和对应关系。';}
    if(recoveryRebuild)summary.warning+='当前课堂存档不可读取，恢复将以所选完整备份重建配置；现有配置表和事务记录（如存在）将按原字节备份，损坏课堂文件也会保留。';
    else if(prior===null)summary.warning+='当前配置.xlsx缺失，本次按备份重建，不读取旧配置文件。';
    return remember({kind:'restore',rebuild:recoveryRebuild,beforeRules,afterRules:signature(next),beforeRevision,beforeHash,prior,bytes,afterHash:digest(bytes),backupPath,priorReceipt,receiptHash,receiptBackupPath,nextState:verifiedNext,stateChain,beforeStateHash:RestoreChain.stateHash(currentState),beforeStateUpgradedHash:stateChain.beforeUpgradedHash,afterStateHash:RestoreChain.stateHash(verifiedNext),restoreUnverifiedBefore:recoveryRebuild},
      {kind:'restore',state:clone(verifiedNext),...summary,backupPath,receiptBackupPath,stateBackupPaths:stateChain.metadata.files.filter(item=>item.backupName).map(item=>({name:item.name,path:path.join(backupDirectory,item.backupName)})),recoveryRebuild,requiresRuleMerge:sharePreview.required});
  }
  function commitRestore(token, {currentState,saveState,beforeCommit=()=>{}}) {
    const data=take(token,'restore');
    if(currentState.revision!==data.beforeRevision)throw Error('课堂资料已在恢复预览后变化，请重新选择备份');
    return commitData(data,{currentState,nextState:clone(data.nextState),saveState,beforeCommit});
  }
  // saveState MUST be synchronous and return only after the authoritative JSON
  // is durable. The caller assigns its in-memory state only after this returns.
  function commitData(data, {currentState, nextState, saveState, beforeCommit = () => {}}) {
    beforeCommit();checkSources(data.sources);
    if (!data.rebuild) reconcileBeforeStateChange(currentState, nextState, {force: true});
    if (signature(currentState) !== data.beforeRules || signature(nextState) !== data.afterRules) throw new Error('面板或计分卡片已变化，请重新保存');
    assertHash(data.beforeHash);
    const oldReceiptHash = data.rebuild ? data.receiptHash : null;
    assertReceiptHash(oldReceiptHash);
    const preservesReceipt = data.rebuild && data.priorReceipt !== null;
    const receipt = {configurationVersion: 2, version: preservesReceipt ? 2 : 1, ...(preservesReceipt ? {purpose: 'rebuild', priorReceipt: {name: path.basename(data.receiptBackupPath), hash: oldReceiptHash}} : data.purpose ? {purpose: data.purpose} : {}), beforeRules: data.beforeRules, afterRules: data.afterRules,
      ...(data.stateChain?{restoreChain:data.stateChain.metadata,beforeStateHash:data.beforeStateHash,beforeStateUpgradedHash:data.beforeStateUpgradedHash,afterStateHash:data.afterStateHash,restoreUnverifiedBefore:data.restoreUnverifiedBefore}:{}),beforeHash: data.beforeHash, afterHash: data.afterHash, beforeBytes: data.prior === null ? null : data.prior.toString('base64')};
    const receiptBytes = Buffer.from(JSON.stringify(receipt)), ownReceiptHash = digest(receiptBytes);
    if (typeof saveState !== 'function' || saveState.constructor?.name === 'AsyncFunction') throw new Error('计分卡片保存必须使用同步课堂存档');
    const check = (workbookHash, pendingHash) => {beforeCommit(); checkSources(data.sources); assertHash(workbookHash); assertReceiptHash(pendingHash);};
    // Never clear or replace a receipt that this transaction did not write.
    // A failed backup, stale confirmation, or external edit retains all prior
    // recovery evidence byte-for-byte.
    const restoreReceipt = () => {
      const checkRollback = () => {assertHash(data.beforeHash); assertReceiptHash(ownReceiptHash);};
      checkRollback();
      if (data.rebuild && data.priorReceipt !== null) {
        atomicWrite(receiptPath, data.priorReceipt, checkRollback);
        observedHash = undefined;
        warning = '重建未完成，原表格和事务记录已保留；请重新预览后重试';
      } else clearReceipt(ownReceiptHash, false);
    };
    let replaced = false, receiptWritten = false, saveReturned = false, stateSaveStarted = false;
    try {
      if(data.stateChain)RestoreChain.backup(data.stateChain,dataDirectory,backupDirectory,fileSystem,()=>check(data.beforeHash,oldReceiptHash));
      if (data.backupPath && data.prior !== null) atomicWrite(data.backupPath, data.prior, () => {check(data.beforeHash, oldReceiptHash);if(readOptional(data.backupPath)!==null)throw Error('配置备份路径已出现其他文件，请重新预览，现有文件未覆盖');});
      if (data.receiptBackupPath && data.priorReceipt !== null) atomicWrite(data.receiptBackupPath, data.priorReceipt, () => {check(data.beforeHash, oldReceiptHash);if(readOptional(data.receiptBackupPath,MAX_RECEIPT_BYTES)!==null)throw Error('事务备份路径已出现其他文件，请重新预览，现有文件未覆盖');});
      atomicWrite(receiptPath, receiptBytes, () => check(data.beforeHash, oldReceiptHash));
      receiptWritten = true;if(data.stateChain)restoreRecoveryPending=true;
      atomicWrite(file, data.bytes, () => check(data.beforeHash, ownReceiptHash));
      replaced = true;
      check(data.afterHash, ownReceiptHash);
      stateSaveStarted=true;
      let saved;try{saved=saveState(nextState);}catch(error){error.flowerSaveStage='classroom';throw error;}
      saveReturned = true;
      if (!saved || typeof saved.then === 'function') throw new Error('计分卡片保存必须使用同步课堂存档');
      observedHash = data.afterHash;
      clearReceipt(ownReceiptHash);
      return saved;
    } catch (error) {
      // A callback that returned may already have durably saved JSON. Never
      // roll Excel back on a callback contract violation after that boundary.
      if (saveReturned) {if(data.stateChain)restoreRecoveryPending=true;observedHash = undefined; throw new Error(`课堂存档返回了无法确认的结果，已保留计分卡片事务记录，请重新打开核对。${error.message}`);}
      if(data.stateChain&&stateSaveStarted){try{RestoreChain.restore(data.stateChain.metadata,dataDirectory,backupDirectory,fileSystem);}catch(chainError){restoreRecoveryPending=true;observedHash=undefined;throw Error(`课堂恢复保存失败，恢复链回滚尚未完成；完整原文件备份和事务记录已保留，请检查权限后重新打开核对。${error.message}；${chainError.message}`);}}
      if (replaced) {
        try {
          assertHash(data.afterHash);
          assertReceiptHash(ownReceiptHash);
          if (data.prior === null) fileSystem.unlinkSync(file);
          else atomicWrite(file, data.prior, () => {assertHash(data.afterHash); assertReceiptHash(ownReceiptHash);});
          observedHash = data.beforeHash;
          restoreReceipt();
        } catch (rollbackError) {
          if(data.stateChain)restoreRecoveryPending=true;
          throw new Error(`计分卡片保存失败，回滚也未完成；已保留事务记录，下次打开时会按课堂存档核对。${error.message}；${rollbackError.message}`);
        }
      } else if (receiptWritten) {
        try {restoreReceipt();} catch (rollbackError) {
          throw new Error(`计分卡片保存失败，事务记录已保留，请重新打开核对。${error.message}；${rollbackError.message}`);
        }
      }
      throw fileError(error);
    }
  }
  function commitPrepared(token, options) {return commitData(take(token, 'save'), options);}
  async function prepareExport(currentState, options = {}) {
    // This is the explicit escape hatch for a stale or malformed receipt.
    // Preview is read-only: do not auto-recover an earlier transaction here.
    const beforeRules = signature(currentState), prior = readOptional(), beforeHash = prior === null ? null : digest(prior);
    const priorReceipt = readOptional(receiptPath, MAX_RECEIPT_BYTES), receiptHash = priorReceipt === null ? null : digest(priorReceipt);
    if (Object.hasOwn(options, 'expectedHash') && options.expectedHash !== beforeHash) throw conflict();
    const next=clone(currentState);const sharePreview=Rules.previewShared(next);if(!next.sharedScoreRules)Rules.confirmShared(next,sharePreview.expectedKey);Config.apply(next,Config.snapshot(currentState));
    const bytes = await buildBytes(next, loadExcel);
    assertHash(beforeHash); assertReceiptHash(receiptHash);
    if (signature(currentState) !== beforeRules) throw new Error('面板或计分卡片已变化，请重新重建');
    const stamp = new Date(now()).toISOString().replace(/[-:.TZ]/g, '');
    const backupPath = prior === null ? null : path.join(backupDirectory, `配置-备份-${stamp}-${randomUUID()}.xlsx`);
    const receiptBackupPath = priorReceipt === null ? null : path.join(backupDirectory, `配置-事务备份-${stamp}-${randomUUID()}.json`);
    const summary = summaryFor(currentState, configuration(next));
    if(sharePreview.required){summary.migration={legacyColumns:true,panels:sharePreview.panels,conflicts:sharePreview.conflicts,mappings:sharePreview.mappings};summary.warning='当前旧面板的卡片不同。确认重建将同时合并为一套共享卡片，保留每套原规则及冲突版本。';}
    if (priorReceipt !== null) summary.warning = (summary.warning||'')+'发现尚未清理或无法核对的事务记录。确认后将以当前已验证的课堂 JSON 规则重建表格，不采用旧事务中的规则；原表格（如存在）和事务记录均会先另存备份。';
    return remember({kind: 'export', rebuild: true, beforeRules, afterRules: signature(next), beforeHash, prior, bytes, afterHash: digest(bytes), backupPath, priorReceipt, receiptHash, receiptBackupPath},
      {kind: 'export', backupPath, receiptBackupPath, recovery: priorReceipt !== null, ...summary});
  }
  function commitExport(token, options) {
    const data = take(token, 'export');
    const next=clone(options.currentState);if(!next.sharedScoreRules)Rules.confirmShared(next,Rules.previewShared(next).expectedKey);Config.apply(next,Config.snapshot(options.currentState));next.revision=options.currentState.revision+1;
    return commitData(data, {...options, nextState: next});
  }
  async function prepareRefresh(currentState) {
    recover(currentState);
    const beforeRules=signature(currentState),prior=readOptional(),hash=prior===null?null:digest(prior);
    const legacyMode=currentState.appConfig===undefined&&(prior===null||isInitialBytes(prior));
    let panels,sources,legacyWarning='';
    if(legacyMode){
      sources=legacySources();const select=kind=>sources.find(v=>v.kind===kind&&v.bytes!==null)||sources.find(v=>v.kind===kind);const oldBook=select('legacy-workbook'),oldText=select('legacy-text'),oldReceipt=select('legacy-receipt');
      if(oldBook.bytes!==null&&oldReceipt.bytes===null)panels=await parseBytes(oldBook.bytes,currentState,loadExcel,{allowInitialTemplate:true,legacyInput:true});
      else {
        const preview=Rules.previewShared(currentState);panels=configuration(currentState).map(panel=>({...panel,rules:clone(preview.rules)}));
        Object.defineProperty(panels,'migration',{value:{legacyColumns:!currentState.sharedScoreRules,missingProgression:false,panels:preview.panels,conflicts:preview.conflicts,mappings:preview.mappings}});
        Object.defineProperty(panels,'nameWarnings',{value:[]});Object.defineProperty(panels,'configSnapshot',{value:Config.snapshot(currentState),writable:true});
        if(oldReceipt.bytes!==null)legacyWarning='发现旧版未清理事务记录，迁移采用当前课堂JSON中的有效卡片与设置；旧表格和事务记录均原样保留。';
      }
      if(oldText.bytes!==null)panels.configSnapshot={...panels.configSnapshot,appConfig:{...parsePortableConfig(new TextDecoder('utf-8',{fatal:true}).decode(oldText.bytes))}};
      Config.apply(clone(currentState),panels.configSnapshot);
      legacyWarning+='确认后将整本配置写入新的配置.xlsx；旧配置.txt、计分卡片.xlsx及旧事务记录只读保留，不覆盖、不删除。';
    } else {
      if(prior===null)throw Error('配置.xlsx已丢失，请使用「用当前配置重建」预览修复；不会回退旧配置文件');
      panels=await parseBytes(prior,currentState,loadExcel,{allowInitialTemplate:true});
    }
    const next=mergeRules(currentState,panels),boundBytes=await buildBytes(next,loadExcel),migrating=legacyMode||!!panels.migration||panels.initialTemplate;
    const bindingData={beforeRules,afterRules:signature(next),beforeHash:hash,prior,bytes:boundBytes,afterHash:digest(boundBytes),sources,
      ...(migrating&&prior!==null?{backupPath:path.join(backupDirectory,`配置-迁移前-${new Date(now()).toISOString().replace(/[-:.TZ]/g,'')}-${randomUUID()}.xlsx`)}:{})};
    assertHash(hash);checkSources(sources);
    if(signature(currentState)!==beforeRules)throw Error('面板或配置已变化，请重新刷新');
    const summary=summaryFor(currentState,panels);
    if(legacyMode){summary.migration={...summary.migration,legacyFiles:true};summary.legacySources=sources.filter(source=>source.bytes!==null).map(({path,name,hash})=>({path,name,hash}));summary.warning=legacyWarning+summary.warning;}
    if(panels.initialTemplate)summary.warning=`确认后将此初始表格绑定到当前课堂，并另存原表备份。${summary.warning}`;
    return remember({kind:'refresh',beforeRules,hash,panels,bindingData},{kind:'refresh',...summary,...(bindingData.backupPath?{backupPath:bindingData.backupPath}:{}),...(panels.initialTemplate?{initialBinding:true}:{})});
  }
  function commitRefresh(token, {currentState, saveState, beforeCommit = () => {}}) {
    const data = take(token, 'refresh');
    beforeCommit();
    reconcileBeforeStateChange(currentState, currentState, {force: true});
    if (signature(currentState) !== data.beforeRules) throw new Error('面板或计分卡片已变化，请重新刷新');
    assertHash(data.hash);
    const next = mergeRules(currentState, data.panels);
    return commitData(data.bindingData, {currentState, nextState: next, saveState, beforeCommit});
  }
  const asyncGuard = operation => async (...args) => {try {return await operation(...args);} catch (error) {throw fileError(error);}};
  const syncGuard = operation => (...args) => {try {return operation(...args);} catch (error) {throw fileError(error);}};
  return {bootstrap: asyncGuard(bootstrap), open: asyncGuard(open), info: syncGuard(info), prepareSave: asyncGuard(prepareSave), commitPrepared: syncGuard(commitPrepared),
    prepareRefresh: asyncGuard(prepareRefresh), commitRefresh: syncGuard(commitRefresh), prepareRestore: asyncGuard(prepareRestore), commitRestore: syncGuard(commitRestore), prepareExport: asyncGuard(prepareExport),
    commitExport: syncGuard(commitExport), recover: syncGuard(recover), reconcileBeforeStateChange: syncGuard(reconcileBeforeStateChange),
    get path() { return file; }, get warning() {return warning;},
    status() {return {path: file, observedHash, warning};},
    invalidate() {observedHash = undefined; prepared.clear();}};
}

module.exports = {createScoreRuleWorkbook, configuration, signature, mergeRules, buildBytes, buildInitialBytes, isInitialBytes, parseBytes,
  FILE_NAME, LEGACY_FILE_NAME, LEGACY_CONFIG_NAME, SHEET_NAME, PROGRESSION_SHEET, HEADERS, LEGACY_HEADERS, PROGRESSION_HEADERS, MODES, MAX_BYTES, INITIAL_PANEL_ID, INITIAL_MARKER, INITIAL_VERSION, INITIAL_SHA256};
