import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {Workbook, SpreadsheetFile} from '@oai/artifact-tool';

const [input,out]=process.argv.slice(2),d=JSON.parse(await fs.readFile(input,'utf8'));
const version=d.version,label=d.reportLabel,slug=d.reportSlug;
const preview=process.argv.includes('--preview');assert(d.finalized||preview);
const names=['验证概览','190项功能','缺陷复验','原始执行','过程与限制','版本证据'];
const wb=Workbook.create(),sheets=Object.fromEntries(names.map(n=>[n,wb.worksheets.add(n)]));
const ink='#263648',navy='#334F69',muted='#596D7E';const overflows=[];
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const text=v=>{if(typeof v==='number'||typeof v==='boolean'||v instanceof Date)return v;const t=String(v??'');assert(!/\/(workspace|root|home|tmp)\//.test(t),t.slice(0,100));return t.startsWith('=')?"'"+t:t;};
const bounded=(v,n=2300)=>String(v??'').length>n?String(v).slice(0,n)+'…完整名称和原始值见原始执行及相应证据文件':String(v??'');
const stat=s=>s==='passed'?'通过':s==='failed'?'失败':s==='confirmed-defect'?'已确认缺陷':s==='observed'?'仅观察':'未验证';
const date=v=>v&&Number.isFinite(Date.parse(v))?new Date(v):'原日志未记录';
function base(s,r){s.showGridLines=false;s.getRange(r).format={font:{name:'Arial',size:10,color:ink},wrapText:true,verticalAlignment:'top',rowHeight:28};}
function head(s,r){s.getRange(r).format={fill:navy,font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},wrapText:true,verticalAlignment:'center',horizontalAlignment:'center',rowHeight:34};}
function grid(name,title,sub,headers,rows,widths,table){
 const s=sheets[name],last=col(headers.length-1),end=Math.max(6,rows.length+5);base(s,`A1:${last}${end}`);
 widths.forEach((w,i)=>s.getRangeByIndexes(0,i,end,1).format.columnWidth=w);
 s.getRange('A2').values=[[title]];s.getRange(`A2:${last}2`).format={font:{name:'Arial',size:15,bold:true,color:ink},wrapText:false,rowHeight:31};
 s.getRange('A3').values=[[sub]];s.getRange(`A3:${last}3`).format={font:{name:'Arial',size:10,color:muted},wrapText:false,rowHeight:24};
 s.getRange(`A5:${last}5`).values=[headers];head(s,`A5:${last}5`);
 if(rows.length){s.getRange(`A6:${last}${end}`).values=rows.map(r=>r.map(text));s.tables.add(`A5:${last}${end}`,true,table).style='TableStyleLight1';}
 for(const[i,row]of rows.entries()){
  const lines=Math.max(...row.map((v,j)=>String(v??'').split('\n').reduce((n,t)=>n+Math.max(1,Math.ceil([...t].reduce((a,c)=>a+(c.charCodeAt(0)>255?1.9:1),0)/Math.max(8,widths[j]-3))),0)));
  if(lines*14+12>405)overflows.push({sheet:name,row:i+6,id:row[0],lines});
  s.getRange(`A${i+6}:${last}${i+6}`).format.rowHeight=Math.min(405,Math.max(42,lines*14+12));
 }
 s.freezePanes.freezeRows(5);s.freezePanes.freezeColumns(2);return end;
}
function statuses(s,r){for(const[label,fill,color]of[['失败','#FCE5E5','#A32937'],['未验证','#FFF0D4','#805913'],['部分验证','#FFF0D4','#805913'],['待完整复验','#FFF0D4','#805913'],['复验仍失败','#FCE5E5','#A32937']])s.getRange(r).conditionalFormats.add('cellIs',{operator:'equal',formula:'"'+label+'"',format:{fill,font:{color,bold:label.includes('失败')}}});}

const req=d.requirements.map(r=>[r.id,r.baselineKind,r.module||r.category,r.title,r.expected,r.steps,bounded(r.actual),null,r.sourceStatus,r.packageStatus,r.version,bounded(r.sourceEvidence?.replaceAll("\n","; ")),bounded(r.packageEvidence?.replaceAll("\n","; ")),r.fix,r.limits,r.basis||r.sourceKind||'既有功能要求',r.historicalStatus,bounded(r.historicalEvidence?.replaceAll("\n","; ")),r.auditFindings||'见缺陷复验',r.testTime,bounded(r.missingSummary?.replaceAll("\n","; "),1400),r.implementationStatus||"待核验",bounded(r.implementationEvidence||r.implementation||"沿用RC16功能定义；效果状态单独判定") ]);
const re=grid('190项功能','全部190项要求与功能效果','176项继承要求 + 14项RC15目录要求；9项Windows仍未验证；来源、步骤、实际结果和证据逐项保存',['要求ID','来源分组','模块','要求','预期结果','测试步骤','实际结果','效果状态','源码结果','ASAR结果','受测版本','源码证据定位','ASAR证据定位','修复与复验','适用范围和限制','需求来源与视频定位','RC16历史状态','RC16历史证据','相关问题','测试时间UTC','仍缺少的证据','功能提供状态','实现依据'],req,[14,23,23,47,78,82,93,16,16,18,22,95,95,72,85,105,19,95,38,58,110,19,100],'RC15Requirements');
sheets['190项功能'].getRange(`H6:H${re}`).formulas=d.requirements.map((r,i)=>{const n=i+6;return[d.windows.some(w=>w.id===r.id)?'="未验证"':r.requiredScopes?.length===1?`=I${n}`:`=IF(OR(I${n}="失败",J${n}="失败"),"失败",IF(AND(I${n}="通过",J${n}="通过"),"通过",IF(OR(I${n}="通过",J${n}="通过",I${n}="部分验证",J${n}="部分验证"),"部分验证","未验证")))`];});statuses(sheets['190项功能'],`H6:J${re}`);
sheets['190项功能'].getRange(`T6:T${re}`).setNumberFormat('yyyy-mm-dd hh:mm:ss');
const findings=d.findings||[];
const fr=findings.map(f=>[f.id,f.module,f.title,f.expected,f.steps,f.before,[f.rootCause,f.fix].filter(Boolean).join('\n'),f.sourceStatus,f.packageStatus,null,bounded(f.sourceActual?.replaceAll('\n','；'),1600),bounded(f.packageActual?.replaceAll('\n','；'),1600),f.beforeEvidence,f.sourceEvidence,f.packageEvidence,f.limits||'合成数据与受测平台限定',f.severity||'未单列']);
const fe=grid('缺陷复验','本轮新发现问题、原因与最终复验','修前失败保留。只有该问题要求的最终执行对象均通过，才标记已修复并复验；源码工具或打包专属问题明确标记不适用层',['问题ID','模块','问题','预期','复现与复验步骤','修前实际','原因与修复','最终源码','最终ASAR','闭环状态','源码实际','ASAR实际','原始失败证据','源码复验定位','ASAR复验定位','限制','严重程度'],fr,[14,22,48,74,80,84,72,16,16,23,92,92,100,100,100,80,16],'RC15Findings');
if(fr.length){sheets['缺陷复验'].getRange(`J6:J${fe}`).formulas=findings.map((f,i)=>{const r=i+6;return[f.requiredScopes?.length===1?`=IF(${f.requiredScopes[0]==='source'?'H':'I'}${r}="失败","复验仍失败",IF(${f.requiredScopes[0]==='source'?'H':'I'}${r}="通过","已修复并复验","待完整复验"))`:`=IF(OR(H${r}="失败",I${r}="失败"),"复验仍失败",IF(AND(H${r}="通过",I${r}="通过"),"已修复并复验","待完整复验"))`];});statuses(sheets['缺陷复验'],`H6:J${fe}`);}
else sheets['缺陷复验'].getRange('A6').values=[['本轮未确认新的产品缺陷']];
if(fr.length)sheets['缺陷复验'].getRange(`A6:Q${fe}`).format.autofitRows();

const execution=[];for(const r of d.runs)for(const[i,c]of r.checks.entries())execution.push([r.id,r.stage,r.scope,r.title,c.id||`${r.id}-${i+1}`,c.name,stat(c.status),bounded(String(c.actualText).split('\n').length>15?String(c.actualText).replace(/\n\s*/g,' '):c.actualText,1800),r.version,date(c.startedAt||c.beganAt||r.startedAt),date(c.completedAt||c.finishedAt||r.completedAt),r.file+'\n'+c.locator,r.sha256,r.bindingProof||'诊断过程，不支持最终通过',c.classification==='harness'?'测试脚本问题':c.classification==='environment'?'测试环境问题':'产品行为断言或明确观察']);
const finalRecords=d.runs.filter(r=>r.stage==='最终冻结').reduce((n,r)=>n+r.checks.length,0);
const ee=grid('原始执行','每条当前运行检查的原始结果',`共${execution.length}条 = 最终${finalRecords}条 + 开发过程${execution.length-finalRecords}条。最终观察项与正确性通过分开；所有原始记录均不加入190项功能分母`,['运行ID','阶段','执行对象/层','测试组','检查ID','检查精确名称','状态','实际记录','版本','开始UTC','完成UTC','原始定位','证据SHA256','冻结绑定依据','记录类别'],execution,[37,24,31,38,40,100,15,112,50,35,35,110,74,100,28],'RC15Execution');statuses(sheets['原始执行'],`G6:G${ee}`);
sheets['原始执行'].getRange(`J6:K${ee}`).setNumberFormat('yyyy-mm-dd hh:mm:ss');

const processRows=[...(d.independentReviews||[]).map(r=>[r.id,'独立复核',r.title,[r.actual,r.limits].filter(Boolean).join('\n'),r.evidence]),...(d.qaNotes||[]).map(q=>[q.id,'测试过程',q.title,q.actual,q.evidence]),['LIMIT-STOP','单列未完成专项','此前新增锁、权限与文件边界专项','此前因平台风险提示中止，未重试、未绕路。普通锁回归、图片测试、合成写入失败不替代该专项，不能据此推断通过或缺陷。','artifacts/rc10/specialized-audit-status.json'],...d.windows.map(w=>[w.id,w.id.startsWith('R14')?'保留Windows专项未验':'原7项Windows未验',w.title,w.expected,w.limits]),['SOURCE-01','来源区分','原始109秒视频','保留既有需求中的原视频时间点与视频确认/合理推导区分。本报告不声称重新核看原片，不附学生照片或原视频帧。','https://www.douyin.com/jingxuan?modal_id=7679405517986542159'],['SOURCE-02','来源区分','补充教程与新增要求','补充教程只作后续解释；不替代原片证据，也不倒推为原片可见功能。RC15目录要求保留为此前用户新增要求。',d.supplementarySource||'原始来源说明沿用各行；未新增未核实链接'],['COUNT','计数口径','功能和原始检查分开','190是已交付RC16全部要求总数。通过率=通过/190，部分验证与未验证都留在分母。原始检查按测试层、阶段分别统计；观察不算通过。','所有计数由明细计算'],['EXCEL','报告验证限制','报告Excel与应用工作簿','报告Excel经公式重算、导出结构及视觉检查。应用计分卡经ExcelJS读写与校验。两者都没有Microsoft Excel/WPS原生GUI验收证据。','见R14-W02'],['UPGRADE','升级核对','旧数据和外部文件保留',d.upgradeNote,'先备份旧资料，明确选择旧目录迁移；之后完整搬移整个运行文件夹']];
grid('过程与限制','过程记录 来源区分和未验证范围','原7项Windows、2项目录及原生文件验收与此前停止的专项分别保留',['记录ID','类别','主题','实际情况与限制','证据或依据'],processRows,[17,28,51,125,108],'RC15Process');
const ev=[['RC16已交付基线','原目录7z SHA256',d.baselineArchiveSha256,'本轮重新解压核验；不自动沿用历史通过'],['RC16已交付基线','原ASAR SHA256',d.baselineAsarSha256,'来自重新解压的已交付目录包'],['本轮复核','采用方式',d.baselineSourceProvenance,'本轮实际起点'],['当前版本','版本',d.version,'报告目标'],['当前版本','源码冻结UTC',d.source?.at||'待冻结','精确代码身份'],['当前版本','源码集合SHA256',d.source?.sha256||'待绑定','逐文件哈希见冻结清单'],['当前版本','最终ASAR SHA256',d.package?.asarSha256||'待绑定','最终运行归档身份'],...(d.package?.files||[]).map(f=>['当前版本',f.name,`${f.bytes??f.sizeBytes} bytes\nSHA256 ${f.sha256}`,'发布文件身份']),...d.evidence.map(e=>[e.id,e.file,e.sha256,e.purpose])];
grid('版本证据','版本身份与原始证据索引','路径相对交付源码包根目录。测试输入均为合成课堂、学生、图片和工作簿',['对象/编号','文件/字段','值/SHA256','用途'],ev,[20,108,83,82],'RC15Evidence');
sheets['版本证据'].getRange('C10').values=[[date(d.source?.at)]];
sheets['版本证据'].getRange('C10').setNumberFormat('yyyy-mm-dd hh:mm:ss');

const s=sheets['验证概览'];base(s,'A1:H55');[38,14,16,14,16,14,3,78].forEach((w,i)=>s.getRangeByIndexes(0,i,55,1).format.columnWidth=w);
s.getRange('A2').values=[['花伴课堂 '+label]];s.getRange('A2:H2').format={font:{name:'Arial',size:16,bold:true,color:ink},wrapText:false,rowHeight:34};
s.getRange('A3').values=[[(d.finalized?'最终冻结报告':'制作预览，不能作为交付结论')+' / '+d.date+' UTC']];s.getRange('A3:H3').format.wrapText=false;
s.getRange('A5:F5').values=[['要求范围','通过','部分验证','失败','未验证','要求总数']];head(s,'A5:F5');
for(const[i,label]of['既有118项','RC11新增37项','RC14新增21项','RC15新增14项'].entries()){const row=i+6;s.getRange(`A${row}`).values=[[label]];for(const[j,status]of['通过','部分验证','失败','未验证'].entries())s.getRange(`${col(j+1)}${row}`).formulas=[[`=COUNTIFS('190项功能'!B6:B${re},A${row},'190项功能'!H6:H${re},"${status}")`]];s.getRange(`F${row}`).formulas=[[`=SUM(B${row}:E${row})`]];}
s.getRange('A10').values=[['全部要求']];for(const c of['B','C','D','E','F'])s.getRange(`${c}10`).formulas=[[`=SUM(${c}6:${c}9)`]];s.getRange('A6:F10').format.rowHeight=34;
s.getRange('H5').values=[['结论与分母']];head(s,'H5');s.getRange('H6').values=[[d.releaseGate]];s.getRange('H6').format.rowHeight=44;
s.getRange('H7').formulas=[['="完整通过率 "&TEXT(B10/F10,"0.0%")&"；分母始终为190。"']];s.getRange('H8').values=[['原7项Windows + 新增2项Windows保持未验证。此前停止的专项另列，不混入已完成检查。']];s.getRange('H8').format.rowHeight=32;
s.getRange('H9').values=[['部分验证表示已取得部分有效证据，但仍缺少该要求所需的场景或测试层。']];s.getRange('H9').format.rowHeight=32;
s.getRange('H10').formulas=[[`=COUNTIFS('190项功能'!V6:V${re},"已提供")&" 项已提供；"&COUNTIFS('190项功能'!V6:V${re},"接口已提供，现场未验证")&" 项接口已提供、实机未验证。"`]];s.getRange('H10').format.rowHeight=32;
s.getRange('A12:F12').values=[['最终执行对象/层','通过检查','失败检查','观察/未验','检查总数','判定通过率']];head(s,'A12:F12');
const scopes=[...new Set(d.runs.filter(r=>r.stage==='最终冻结').map(r=>r.scope))];
for(const[i,scope]of(scopes.length?scopes:['尚未绑定最终证据']).entries()){const r=13+i;s.getRange(`A${r}`).values=[[scope]];for(const[j,st]of['通过','失败'].entries())s.getRange(`${col(j+1)}${r}`).formulas=[[`=COUNTIFS('原始执行'!B6:B${ee},"最终冻结",'原始执行'!C6:C${ee},A${r},'原始执行'!G6:G${ee},"${st}")`]];s.getRange(`E${r}`).formulas=[[`=COUNTIFS('原始执行'!B6:B${ee},"最终冻结",'原始执行'!C6:C${ee},A${r})`]];s.getRange(`D${r}`).formulas=[[`=E${r}-B${r}-C${r}`]];s.getRange(`F${r}`).formulas=[[`=IF(SUM(B${r}:C${r})=0,"未验证",B${r}/SUM(B${r}:C${r}))`]];s.getRange(`F${r}`).setNumberFormat('0.0%');s.getRange(`A${r}:F${r}`).format.rowHeight=30;}
const totalRow=13+scopes.length;s.getRange(`A${totalRow}`).values=[['最终执行合计']];for(const c of['B','C','D','E'])s.getRange(`${c}${totalRow}`).formulas=[[`=SUM(${c}13:${c}${totalRow-1})`]];s.getRange(`F${totalRow}`).formulas=[[`=IF(SUM(B${totalRow}:C${totalRow})=0,"未验证",B${totalRow}/SUM(B${totalRow}:C${totalRow}))`]];s.getRange(`F${totalRow}`).setNumberFormat('0.0%');s.getRange(`A${totalRow}:F${totalRow}`).format={font:{bold:true},rowHeight:30};
s.getRange('H12').values=[['证据的范围']];head(s,'H12');s.getRange('H13').values=[['Linux Electron源码、精确ASAR与Node模型分别记录。Windows EXE实际运行、PPT覆盖、真实DPI/触屏、提示音听感以及Explorer/Excel/WPS原生行为尚无实机证据。']];s.getRange('H13').format.rowHeight=44;
const nr=Math.max(19,15+scopes.length);s.getRange(`A${nr}`).values=[['本轮复核']];s.getRange(`B${nr}:H${nr}`).merge();s.getRange(`B${nr}`).values=[[d.auditSummary]];s.getRange(`A${nr}:H${nr}`).format.rowHeight=56;
s.getRange(`A${nr+2}`).values=[['来源区分']];s.getRange(`B${nr+2}:H${nr+2}`).merge();s.getRange(`B${nr+2}`).values=[['原始109秒视频的既有时间定位沿用；补充教程独立解释；RC14及RC15新功能来自用户新增要求。所有截图仅含合成资料，报告不包含原片学生照片或用户真实图片。']];s.getRange(`A${nr+2}:H${nr+2}`).format.rowHeight=47;
s.getRange(`A${nr+4}`).values=[['历史追溯']];s.getRange(`B${nr+4}:H${nr+4}`).merge();s.getRange(`B${nr+4}`).values=[['已交付RC16有190项要求，181通过、9未验证；历史5,204条通过断言与8条观察合计5,212条，均不计本轮。修前诊断和最终复验分开。']];s.getRange(`A${nr+4}:H${nr+4}`).format.rowHeight=47;
wb.recalculate();assert.equal(s.getRange('F10').values[0][0],190);
for(const [i,st]of['通过','部分验证','失败','未验证'].entries())assert.equal(s.getRange(`${col(i+1)}10`).values[0][0],d.requirementCounts[st]||0);
const first=d.requirements.findIndex(r=>!d.windows.some(w=>w.id===r.id));const ri=first+6,original=sheets['190项功能'].getRange(`I${ri}`).values[0][0];sheets['190项功能'].getRange(`I${ri}`).values=[['失败']];wb.recalculate();assert.equal(sheets['190项功能'].getRange(`H${ri}`).values[0][0],'失败');sheets['190项功能'].getRange(`I${ri}`).values=[[original]];wb.recalculate();
for(const range of[`验证概览!A1:H${nr+4}`,`190项功能!H6:J${re}`,`缺陷复验!H6:J${fe}`]){const scan=await wb.inspect({kind:'match',range,searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:100}});assert(/matched 0 entries/.test(scan.ndjson),scan.ndjson);}
await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'layout-overflows.json'),JSON.stringify(overflows,null,2));assert.equal(overflows.length,0,'Rows exceed Excel limit: '+JSON.stringify(overflows));
const windowsRow=d.requirements.findIndex(r=>r.id==='R14-W01')+6,directoryRow=d.requirements.findIndex(r=>r.id==='R15-01')+6;
const views=[['验证概览',`A1:H${nr+4}`,'overview'],['190项功能','A5:D9','requirements-identities'],['190项功能','E5:J7','requirements-results'],['190项功能',`A${re-20}:J${re-18}`,'new-requirements'],['190项功能',`A${windowsRow}:J${windowsRow+1}`,'windows-new'],['190项功能',`A${directoryRow}:J${directoryRow+2}`,'directory-new'],['缺陷复验',`H${fe}:J${fe}`,'preview-finding-scope'],['缺陷复验','A5:J7','findings'],['原始执行','A5:H8','execution'],['过程与限制','A5:E8','limits'],['版本证据','A5:D10','identity']];
for(const[sheetName,range,file]of views){const b=await wb.render({sheetName,range,scale:1,format:'png'});await fs.writeFile(path.join(out,file+'.png'),new Uint8Array(await b.arrayBuffer()));}
if(fr.length){const b=await wb.render({sheetName:'缺陷复验',range:'K5:P8',scale:1,format:'png'});await fs.writeFile(path.join(out,'findings-actual.png'),new Uint8Array(await b.arrayBuffer()));}
await fs.writeFile(path.join(out,'overview.inspect.ndjson'),(await wb.inspect({kind:'table',range:`验证概览!A5:H${nr+4}`,include:'values,formulas',tableMaxRows:nr+4,tableMaxCols:8,maxChars:6000})).ndjson);
await(await SpreadsheetFile.exportXlsx(wb)).save(path.join(out,'花伴课堂_'+slug+'_全面测试表'+(preview?'_制作预览':'')+'.xlsx'));
await fs.writeFile(path.join(out,'workbook-verification.json'),JSON.stringify({finalized:d.finalized,preview,sheets:names,requirementRows:190,executionRecords:execution.length,formulaErrors:0,statusMutationVerified:true,renderedViews:views,nativeExcelVerified:false},null,2));
console.log(JSON.stringify({preview,executionRecords:execution.length,out}));
