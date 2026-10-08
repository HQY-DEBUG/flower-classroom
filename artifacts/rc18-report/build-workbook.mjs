import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { Workbook, SpreadsheetFile, FileBlob } from '@oai/artifact-tool';

const [input, outputDir] = process.argv.slice(2);
const preview = process.argv.includes('--preview');
const d = JSON.parse(await fs.readFile(input, 'utf8'));
assert(d.finalized || preview, 'Final report evidence is not ready');
const total=d.requirements.length;
const wb=Workbook.create();
const names=['验证概览','功能验收','缺陷与修复','最终断言','开发过程','范围与迁移','证据索引'];
const sheets=Object.fromEntries(names.map(n=>[n,wb.worksheets.add(n)]));
const color={ink:'#25384B',head:'#3B536E',muted:'#68788A',pale:'#EAF0F5'};
const overflow=[];
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const safe=value=>{
  if(typeof value==='number'||typeof value==='boolean'||value instanceof Date)return value;
  const s=String(value??'');
  assert(!s.includes('rc18-private-roster-qa'),'Private roster path in report');
  assert(!/\/(workspace|root|home|tmp)\//.test(s),'Unredacted machine path in report');
  return s.startsWith('=')?"'"+s:s;
};
const brief=(value,limit=1300)=>{const s=String(value??'');return s.length>limit?s.slice(0,limit)+'…完整记录见证据文件':s;};
const evidenceIds=new Map((d.evidence||[]).map(e=>[e.file,e.id]));
const evidenceRefs=value=>{
  const grouped=new Map();
  for(const line of String(value||'').split('\n').filter(Boolean)){
    const split=line.indexOf('#'),file=split<0?line:line.slice(0,split),pointer=split<0?'':line.slice(split+1);
    if(!grouped.has(file))grouped.set(file,[]);
    if(pointer&&!grouped.get(file).includes(pointer))grouped.get(file).push(pointer);
  }
  return [...grouped].map(([file,pointers])=>(evidenceIds.get(file)||file)+(pointers.length?'：'+pointers.join('；'):'')).join('\n');
};
const shown=s=>({'passed':'通过','failed':'失败','observed':'仅观察','unverified':'未验证','blocked':'受阻','confirmed-defect':'已确认缺陷','skipped':'未执行','invalid-execution':'执行无效'}[s]||s||'未记录');
function base(sheet,range){sheet.showGridLines=false;sheet.getRange(range).format={font:{name:'Arial',size:10,color:color.ink},wrapText:true,verticalAlignment:'top',rowHeight:30};}
function header(sheet,range){sheet.getRange(range).format={fill:color.head,font:{name:'Arial',size:10,color:'#FFFFFF',bold:true},verticalAlignment:'center',horizontalAlignment:'center',wrapText:true,rowHeight:36};}
function statusFormat(sheet,range){
  for(const [text,fill,ink] of [['失败','#FBE5E7','#9A2839'],['复验仍失败','#FBE5E7','#9A2839'],['未验证','#FFF0D1','#805913'],['部分验证','#FFF0D1','#805913'],['待完整复验','#FFF0D1','#805913']])
    sheet.getRange(range).conditionalFormats.add('cellIs',{operator:'equal',formula:'"'+text+'"',format:{fill,font:{color:ink,bold:text.includes('失败')}}});
}
function grid(name,title,subtitle,headers,rows,widths){
  const s=sheets[name],end=Math.max(6,rows.length+5),last=col(headers.length-1);
  base(s,`A1:${last}${end}`);
  widths.forEach((w,i)=>s.getRangeByIndexes(0,i,end,1).format.columnWidth=w);
  s.getRange('A2').values=[[title]];s.getRange(`A2:${last}2`).format={font:{name:'Arial',size:15,bold:true,color:color.ink},wrapText:false,rowHeight:31};
  s.getRange('A3').values=[[subtitle]];s.getRange(`A3:${last}3`).format={font:{name:'Arial',size:10,color:color.muted},wrapText:false,rowHeight:25};
  s.getRange(`A5:${last}5`).values=[headers];header(s,`A5:${last}5`);
  if(rows.length){
    s.getRange(`A6:${last}${end}`).values=rows.map(row=>row.map(safe));
    const table=s.tables.add(`A5:${last}${end}`,true,'RC18Table'+names.indexOf(name));table.style='TableStyleLight1';
    rows.forEach((row,i)=>{
      const lineCount=Math.max(...row.map((v,j)=>String(v??'').split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].reduce((w,c)=>w+(c.charCodeAt(0)>255?1.9:1),0)/Math.max(widths[j]-3,8))),0)));
      const height=Math.max(44,lineCount*14+13);
      if(height>405)overflow.push({sheet:name,row:i+6,id:row[0],height});
      s.getRange(`A${i+6}:${last}${i+6}`).format.rowHeight=Math.min(405,height);
    });
  }else s.getRange('A6').values=[['无此类记录']];
  s.freezePanes.freezeRows(5);s.freezePanes.freezeColumns(2);
  return end;
}

const reqRows=d.requirements.map(r=>[r.id,r.title,r.module||r.category,r.steps,r.expected,brief(r.actual,1000),null,r.sourceStatus,r.packageStatus,r.implementationStatus,brief(r.fix,800),brief(r.testTime,500),brief(evidenceRefs([r.sourceEvidence,r.packageEvidence].filter(Boolean).join('\n')),1800),r.version,brief(r.limits,500),r.historicalStatus,brief(r.historicalExpected,1100),brief(r.bindingRevisionReason||r.replaces||'本轮定义未变',700),brief(r.basis||r.sourceKind||'本轮用户要求',1600),r.historicalVersion||'无']);
const re=grid('功能验收',`全部${total}项要求与验证结果`,'功能提供状态、实际验证状态、原始步骤、修复复测、证据和历史定义分别保留；证据编号对应“证据索引”',['要求ID','功能','模块','测试步骤','预期结果','实际结果','验证状态','源码状态','ASAR状态','功能提供状态','修复/调整','复验时间UTC','证据编号与JSON定位','受测版本','范围限制','历史状态','历史定义','本轮定义或绑定修订','需求来源与定位','历史版本'],reqRows,[14,45,22,70,76,95,17,17,17,25,75,48,110,22,65,17,78,78,110,22]);
sheets['功能验收'].getRange(`G6:G${re}`).formulas=d.requirements.map((r,i)=>{
  const n=i+6;
  return [r.platformUnverified?'="未验证"':r.requiredScopes?.length===1?`=H${n}`:`=IF(OR(H${n}="失败",I${n}="失败"),"失败",IF(AND(H${n}="通过",I${n}="通过"),"通过",IF(OR(H${n}="通过",I${n}="通过",H${n}="部分验证",I${n}="部分验证"),"部分验证","未验证")))`];
});
statusFormat(sheets['功能验收'],`G6:I${re}`);

const findings=d.findings||[];
const fr=findings.map(f=>[f.id,f.title,f.expected||'见对应需求',f.steps||'见原始复现与复验记录',brief(f.before),brief(f.rootCause),brief(f.fix),f.sourceStatus,f.packageStatus,null,brief(f.sourceActual),brief(f.packageActual),brief(f.beforeEvidence),brief(f.sourceEvidence+'\n'+f.packageEvidence),brief(f.limits||'仅在实际受测层关闭')]);
const fe=grid('缺陷与修复','本轮问题、修复与最终复验','需求调整、产品缺陷、输入格式整理和脚本修正不得互相混计',['问题ID','问题','预期','测试步骤','修前实际','原因','修复','源码复验','ASAR复验','闭环状态','源码实际','ASAR实际','修前证据','最终证据','限制'],fr,[16,46,74,75,86,74,74,17,17,24,100,100,95,110,80]);
if(fr.length){
 sheets['缺陷与修复'].getRange(`J6:J${fe}`).formulas=fr.map((_,i)=>{const r=i+6;return [`=IF(OR(H${r}="失败",I${r}="失败"),"复验仍失败",IF(AND(H${r}="通过",OR(I${r}="通过",I${r}="不适用")),"已修复并复验","待完整复验"))`];});
 statusFormat(sheets['缺陷与修复'],`H6:J${fe}`);
}
const flattened=stage=>(d.runs||[]).filter(r=>r.stage===stage).flatMap(r=>r.checks.map((c,i)=>[r.id,r.scope,r.title,c.name,shown(c.status),brief(String(c.actualText??'').replace(/\n\s*/g,' '),1500),r.version,r.startedAt?new Date(r.startedAt):'未记录',r.completedAt?new Date(r.completedAt):'未记录',r.file+'#'+(c.pointer??c.locator??i),r.sha256,r.bindingProof||'开发过程，不支持最终通过',c.classification||'product']));
const finalRows=flattened('最终冻结'),devRows=flattened('开发过程');
const executionHeaders=['运行ID','执行对象/层','测试组','断言精确名称','状态','实际记录','受测版本','开始UTC','完成UTC','原始定位','证据SHA256','版本绑定','记录分类'];
const executionWidths=[35,31,39,108,16,120,25,29,29,110,73,100,20];
const ee=grid('最终断言','最终冻结执行明细',`仅计显式选定的${finalRows.length}条唯一记录；观察与通过分开，独立重复子集不自动相加`,executionHeaders,finalRows,executionWidths);
const de=grid('开发过程','开发、原始失败与脚本修正',`${devRows.length}条过程记录均不进入最终断言总数或功能通过率`,executionHeaders,devRows,executionWidths);
for(const [name,end] of [['最终断言',ee],['开发过程',de]]){statusFormat(sheets[name],`E6:E${end}`);sheets[name].getRange(`H6:I${end}`).setNumberFormat('yyyy-mm-dd hh:mm:ss');}

const roster=d.privateRosterQa||{};
const scopeRows=[
 ['COUNTS','计数口径',`${total}项功能是需求分母。通过率=完整通过/${total}；开发检查、观察、独立重复子集和真实名单场景不增功能分母。`,'由功能验收与最终断言明细计算'],
 ['HISTORY','历史基线','RC17：190项，181通过、9未验证；5,515条通过断言与8条观察只作历史追溯，不计本轮。',d.historicalBaseline?.reportInputFile||'历史报告'],
 ['CONFIG','统一配置',d.configurationScope||d.pendingScope||'见本轮配置工作簿需求与参数清单',d.parameterInventoryEvidence||'等待最终清单'],
 ...((d.parameterInventory||[]).map((q,i)=>['PARAM-'+String(i+1).padStart(2,'0'),q.sheet+' / '+q.name,q.scope+'；'+q.note+'\n'+q.behavior,(d.parameterInventoryEvidence||'参数清单')+' / '+q.key+'\n'+q.source])),
 ['INPUT','名单输入整理','原打印版名单保留，按用户最新选择制作标准名单副本，验证这些副本；未将打印布局适配作为软件新功能或待修缺陷。','协调者提供的脱敏场景摘要'],
 ...((roster.classes||[]).map(c=>['ROSTER',c.alias,`${c.expectedCount}人；解析${c.parsedCount}人、导入${c.importedCount}人；${shown(c.status)}。名单、原文件和原截图不进入报告或软件包。`,roster.file||'脱敏聚合'])),
 ['PRIVACY','数据范围','公开测试和界面截图均为合成资料；真实名单仅隔离验证，以别名、人数和结果单列，相关场景不计最终合成断言总数。','不含真实姓名、原始名单、图片或凭据'],
 ...((d.windows||d.requirements.filter(r=>r.platformUnverified)).map(r=>[r.id,'Windows实机未验证',r.title+'；'+r.expected,'Linux模型、故障注入或Electron检查不替代Windows验收'])),
 ['STOPPED','另行未验证范围','此前停止的额外锁、权限及文件边界专项保持未验证，未检查、未重启，也不由普通回归替代。','延续既有范围限制'],
 ['SIGNING','未解决的发布限制','用户SmartScreen截图显示未知发布者。签名/信誉问题仍未解决，本报告不声称已修复或已在Windows实机验证。','用户提供截图；不提供安全绕过'],
 ['XLSX','报告自身验证','报告Excel以Artifact Tool重算、导出后重新导入核对和视觉检查；尚未进行Microsoft Excel/WPS原生GUI验收。','精确导出字节SHA256及渲染绑定记录'],
 ['UPGRADE','升级与原文件保留',d.upgradeNote||'等待最终配置迁移实现与验证后填写升级步骤','见最终迁移证据'],
 ['DELIVERY','仅交付目录7z','本次只交付已核验的目录7z；内部可选ZIP曾验证为同一组文件，已按交付选择清理，不作为交付文件。原验证SHA及清理记录保留。','artifacts/rc18/release-artifact-selection.json'],
 ...((d.qaNotes||[]).map(q=>[q.id,q.title,q.actual,q.evidence||'过程说明'])),
 ...((d.supplementalVerifications||[]).map(q=>['INDEPENDENT',q.title||'独立重复子集',q.reason+'；仅作为旁证，不增加最终断言数。',q.file])),
];
grid('范围与迁移','验证范围、配置迁移与未完成项','平台验收、额外专项和签名/信誉限制分别保留',['记录ID','主题','实际结果或限制','证据/依据'],scopeRows,[19,42,145,115]);
const er=(d.evidence||[]).map(e=>[e.id,e.file,e.sha256,e.purpose]);
er.unshift(['VERSION',d.version,d.package?.asarSha256||'待最终ASAR','最终运行归档SHA256'],['SOURCE','冻结源码',d.source?.sha256||'待冻结','源码集合SHA256']);
grid('证据索引','版本身份与原始证据索引','文件路径相对源码包根目录；具体内容和执行时间须与SHA256匹配',['编号/对象','文件/版本','SHA256','用途'],er,[20,112,74,95]);

const s=sheets['验证概览'];base(s,'A1:J40');[38,28,16,16,16,16,3,70,3,3].forEach((w,i)=>s.getRangeByIndexes(0,i,40,1).format.columnWidth=w);
s.tabColor=color.head;
s.getRange('A2').values=[['花伴课堂 RC18 测试报告']];s.getRange('A2:H2').format={font:{name:'Arial',size:15,bold:true,color:color.ink},wrapText:false,rowHeight:32};
s.getRange('A3').values=[[(d.finalized?'最终冻结报告':'制作预览，不能作为交付结论')+' / '+(d.date||d.createdAt?.slice(0,10)||'')+' UTC']];s.getRange('A3:H3').format.wrapText=false;
s.getRange('A5:F5').values=[['要求范围','通过','部分验证','失败','未验证','总数']];header(s,'A5:F5');
s.getRange('A6').values=[['全部功能要求']];['通过','部分验证','失败','未验证'].forEach((v,i)=>s.getRange(`${col(i+1)}6`).formulas=[[`=COUNTIFS('功能验收'!G6:G${re},"${v}")`]]);s.getRange('F6').formulas=[['=SUM(B6:E6)']];
s.getRange('A8').values=[['完整通过率']];s.getRange('B8').formulas=[['=B6/F6']];s.getRange('B8').setNumberFormat('0.0%');
s.getRange('A10:F10').values=[['记录范围','通过','失败','仅观察','记录总数','其他状态']];header(s,'A10:F10');
for(const [row,label,name,end,rows] of [[11,'最终冻结断言','最终断言',ee,finalRows],[12,'开发过程（不计最终）','开发过程',de,devRows]]){
  s.getRange(`A${row}`).values=[[label]];
  ['通过','失败','仅观察'].forEach((v,i)=>s.getRange(`${col(i+1)}${row}`).formulas=[[rows.length?`=COUNTIFS('${name}'!E6:E${end},"${v}")`:'=0']]);
  s.getRange(`E${row}`).values=[[rows.length]];
  s.getRange(`F${row}`).formulas=[[`=E${row}-SUM(B${row}:D${row})`]];
}
const confirmedDefects=devRows.filter(r=>r[4]==='已确认缺陷').length,invalidExecutions=devRows.filter(r=>r[4]==='执行无效').length;
s.getRange('A13').values=[[`其他状态：${confirmedDefects}条缺陷确认、${invalidExecutions}条执行无效；开发共${devRows.length}条，全部不计最终。`]];
s.getRange('A13:F13').format={wrapText:false,font:{name:'Arial',size:10,color:color.muted},rowHeight:32};
s.getRange('A15').values=[['受测版本']];s.getRange('B15').values=[[d.version]];
s.getRange('A16').values=[['源码冻结UTC']];s.getRange('B16').values=[[d.source?.at?new Date(d.source.at):'待冻结']];s.getRange('B16:D16').setNumberFormat('yyyy-mm-dd hh:mm:ss');
s.getRange('A18').values=[['最终ASAR SHA256']];s.getRange('B18').values=[[d.package?.asarSha256||'待绑定']];s.getRange('B18:F18').format.wrapText=false;
s.getRange('A21').values=[['历史RC17基线']];s.getRange('B21').values=[['190项 / 181通过 / 9未验证']];s.getRange('B21:F21').format.wrapText=false;
s.getRange('A22').values=[['历史断言不计本轮']];s.getRange('B22').values=[['5,515通过 + 8观察']];s.getRange('B22:F22').format.wrapText=false;
s.getRange('H5').values=[['结论与限制']];header(s,'H5');
s.getRange('H6').values=[[d.releaseGate||'等待最终证据']];s.getRange('H6').format.rowHeight=74;
s.getRange('H8').values=[['9项Windows实机验收保持未验证；此前停止的额外专项独立列为未验证。']];s.getRange('H8').format.rowHeight=55;
s.getRange('H10').values=[['SmartScreen未知发布者问题仍未解决，不计作已修复。']];s.getRange('H10').format.rowHeight=45;
s.getRange('H12').values=[['真实两班名单使用标准副本隔离验证；仅公布别名、人数和结果。']];s.getRange('H12').format.rowHeight=55;
s.getRange('H15').values=[['功能是否提供与是否已验证分别呈现；任何历史通过都不自动成为RC18通过。']];s.getRange('H15').format.rowHeight=58;
s.getRange('H18').values=[[d.definitionStage||'按本轮最终需求定义和冻结证据判定']];s.getRange('H18').format.rowHeight=72;

assert.equal(overflow.length,0,'Rows exceed readable Excel height: '+JSON.stringify(overflow.slice(0,8)));
wb.recalculate();
assert.equal(s.getRange('F6').values[0][0],total);
const finalPassed=finalRows.filter(r=>r[4]==='通过').length;
assert.equal(s.getRange('B11').values[0][0],finalPassed);
const mutable=d.requirements.findIndex(r=>!r.platformUnverified&&(r.requiredScopes?.length??2)===2);
const mutableRow=mutable+6, oldValue=sheets['功能验收'].getRange(`H${mutableRow}`).values[0][0];
sheets['功能验收'].getRange(`H${mutableRow}`).values=[['失败']];wb.recalculate();assert.equal(sheets['功能验收'].getRange(`G${mutableRow}`).values[0][0],'失败');
sheets['功能验收'].getRange(`H${mutableRow}`).values=[[oldValue]];wb.recalculate();
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:100},summary:'Final formula error scan'});
const errorPattern=/^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!)$/;
const formulaErrors=errors.ndjson.split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(v=>v.formula&&errorPattern.test(String(v.value)));
assert.equal(formulaErrors.length,0,'Formula error: '+JSON.stringify(formulaErrors));
// Negative import evidence deliberately contains literal Excel error tokens.
// Inspect every generated formula cell independently so text hits cannot hide
// a later formula error behind the search result limit.
for(const [sheetName,range] of [['验证概览','A1:H23'],['功能验收',`G6:G${re}`],...(fr.length?[['缺陷与修复',`J6:J${fe}`]]:[])]){
  const area=sheets[sheetName].getRange(range),formulas=area.formulas,values=area.values;
  formulas.forEach((row,i)=>row.forEach((formula,j)=>{if(formula)assert(!errorPattern.test(String(values[i][j])),`${sheetName}/${range} formula ${formula} failed`);}));
}
await fs.mkdir(outputDir,{recursive:true});
const file=path.join(outputDir,'花伴课堂_RC18_全面测试表'+(preview?'_制作预览':'')+'.xlsx');
await(await SpreadsheetFile.exportXlsx(wb)).save(file);
const digest=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
const renderDir=path.join(outputDir,'xlsx-'+digest);await fs.mkdir(renderDir,{recursive:true});
// The visual review uses a new import of these exact exported bytes.
const saved=await SpreadsheetFile.importXlsx(await FileBlob.load(file));
saved.recalculate();
assert.equal(saved.worksheets.getItem('验证概览').getRange('F6').values[0][0],total);
assert.equal(saved.worksheets.getItem('验证概览').getRange('B11').values[0][0],finalPassed);
const views=[['验证概览','A1:H23','overview'],['功能验收','A2:F9','requirements-definition'],['功能验收','G5:L10','requirements-status'],['功能验收','M5:T8','requirements-evidence'],['缺陷与修复',fr.length?'A2:G7':'A2:E6','findings'],['最终断言',finalRows.length?'C2:G8':'A2:E6','final-assertions'],['开发过程',devRows.length?'C2:G8':'A2:E6','development'],['范围与迁移','A2:D10','scope'],['证据索引','A2:D10','evidence']];
const inputRow=scopeRows.findIndex(row=>row[0]==='INPUT')+6;
views.push(['范围与迁移',`A${inputRow}:D${Math.min(inputRow+6,scopeRows.length+5)}`,'scope-roster-and-limits']);
const images=[];
for(const [sheetName,range,stem]of views){const b=await saved.render({sheetName,range,scale:1,format:'png'});const imageFile=path.join(renderDir,stem+'.png');const bytes=new Uint8Array(await b.arrayBuffer());await fs.writeFile(imageFile,bytes);images.push({sheetName,range,file:path.basename(imageFile),sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
const verification={xlsx:path.basename(file),xlsxSha256:digest,finalized:d.finalized,requirements:total,finalExecutionRecords:finalRows.length,developmentRecords:devRows.length,formulaErrors:0,statusMutationVerified:true,exactExportReimportVerified:true,nativeExcelWpsVerified:false,visualInspectionCompleted:false,images};
await fs.writeFile(path.join(renderDir,'XLSX-BINDING.json'),JSON.stringify(verification,null,2)+'\n');
await fs.writeFile(path.join(outputDir,'workbook-verification.json'),JSON.stringify({...verification,renderDirectory:path.basename(renderDir)},null,2)+'\n');
console.log(JSON.stringify({xlsx:file,sha256:digest,requirements:total,finalExecutionRecords:finalRows.length,renderDirectory:renderDir}));
