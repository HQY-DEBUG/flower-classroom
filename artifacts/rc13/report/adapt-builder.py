"""One-time adaptation of the prior report's layout; no historical results are reused."""
from pathlib import Path
p=Path(__file__).parent/'build-workbook.mjs'
s=p.read_text().replace('RC12','RC13').replace('rc.12','rc.13').replace('RC11交付后发现的问题与RC13复验','RC12交付后发现的问题与RC13复验').replace('RC11全面审计与RC13复验','RC12独立审计与RC13复验').replace('交付RC11','交付RC12').replace('RC11的10类问题','RC12的10类问题').replace('RC11原报告状态','RC12原报告状态').replace('RC11历史证据','RC12历史证据').replace('RC11修复','RC12修复')
s=s.replace('RC11新增37项','新增37项（始于RC11）')
s=s.replace('r.baselineKind,','r.baselineKind===\'RC11新增37项\'?\'新增37项（始于RC11）\':r.baselineKind,')
s=s.replace('`RC12的10类问题对应${d.baselineFailed}个基线失败场景；另含RC13过程中新发现的IR01。键盘一类含${d.keyboardScenarioCount}种控件。开发过程成功不等于最终软件包已关闭问题`','`RC12正式基线75条记录中28失败，归纳10类问题。原始失败保留；开发过程通过不等于最终源码和ASAR已闭环`')
s=s.replace("'修前实际（版本见后列）'","'RC12修前实际'")
s=s.replace("'RC13源码实际'","'最终源码实际'").replace("'RC13 ASAR实际'","'最终ASAR实际'")
s=s.replace("f.sourceEvidence,f.packageEvidence]","f.sourceEvidence,f.packageEvidence,f.workaround]")
s=s.replace("'ASAR复验定位'],fr,[12,18,38,58,63,72,62,16,16,22,85,85,26,32,95,95,95]","'ASAR复验定位','RC12临时措施及升级行为'],fr,[12,18,38,58,63,72,62,16,16,22,85,85,26,32,95,95,95,75]")
s=s.replace("r.implementationEvidence,r.limits]","r.implementationEvidence,r.limits,r.basis||r.category||'本轮已有功能要求',r.assumptions||'按本行预期执行',r.testTime]")
s=s.replace("'适用范围与限制'],rr,[13,22,23,48,26,16,16,16,82,85,65,22,52,32,95,95,20,95,85,72]","'适用范围与限制','需求来源与原视频定位','要求解释与假设','本轮测试时间UTC'],rr,[13,22,23,48,26,16,16,16,82,85,65,22,52,32,95,95,20,95,85,72,100,80,42]")
s=s.replace("'沿用37项RC11新功能及118项已有要求；每项重新绑定RC13。7项Windows现场效果继续未验证'","'37项RC11新增功能和118项已有要求共155项；每项重新绑定RC13。需求来源、视频时间和假设完整保留；7项Windows现场效果未验'")
s=s.replace("'已被RC11转换的文本无法自动恢复'","'旧文本丢失与RC12公式漏行需核对'")
s=s.replace("['UPGRADE','历史导入核对','旧文本丢失与RC12公式漏行需核对',d.upgradeNote,'I01、I02；原始名单为核对依据']","['UPGRADE','历史导入核对','旧文本丢失与RC12公式漏行需核对',d.upgradeNote,'I01、A01；原始名单及保护备份为核对依据']")
start=s.index("s.getRange('A11:F11')")
end=s.index("const scopes=",start)
s=s[:start]+'''s.getRange('A11:F11').values=[['RC12正式基线','通过','失败','仅观察','记录总数','说明']];head(s,'A11:F11');
const groups=[['确认与恢复',['baseline-confirmations'],'36场景；重启另列'],['名单与头像',['baseline-roster'],'21项含1重启'],['图鉴与反馈',['baseline-feedback'],'18场景；重启另列']];
for(const[i,[name,ids,note]]of groups.entries()){const r=12+i;s.getRange(`A${r}`).values=[[name]];for(const[j,st]of ['通过','失败','仅观察'].entries())s.getRange(`${col(j+1)}${r}`).formulas=[[`=${ids.map(id=>`COUNTIFS('执行明细'!A6:A${ee},"${id}",'执行明细'!G6:G${ee},"${st}")`).join('+')}`]];s.getRange(`E${r}`).formulas=[[`=SUM(B${r}:D${r})`]];s.getRange(`F${r}`).values=[[note]];s.getRange(`A${r}:F${r}`).format.rowHeight=47;}
s.getRange('A15').values=[['合计']];for(const c of ['B','C','D','E'])s.getRange(`${c}15`).formulas=[[`=SUM(${c}12:${c}14)`]];
s.getRange('F15').values=[['75记录；非功能数']];s.getRange('A15:F15').format.rowHeight=36;
s.getRange('H11').values=[['审计发现']];head(s,'H11:I11');s.getRange('H12:I15').merge();s.getRange('H12').values=[['28个基线失败归纳为10类问题：确认/恢复4类，名单/头像4类，图鉴/反馈2类。名单漏行、错图及旧确认是实际资料风险；荣誉相册不更新时磁盘账本仍正确。重启通过只证明已保存状态被加载，不能把错误状态变为正确。']];
''' +s[end:]
s=s.replace("'原RC11历史状态只作追溯。'","'原RC12历史状态只作追溯。'")
s=s.replace('原RC11历史状态只作追溯','原RC12历史状态只作追溯')
s=s.replace("if(!preview)await(await SpreadsheetFile.exportXlsx(wb)).save(path.join(out,'花伴课堂_1.3.0-rc.13_全面测试表.xlsx'));","await(await SpreadsheetFile.exportXlsx(wb)).save(path.join(out,'花伴课堂_1.3.0-rc.13_全面测试表'+(preview?'_制作预览':'')+'.xlsx'));")
s=s.replace("const original=sheets['155项功能']", "assert.equal(s.getRange('B15').values[0][0],47);assert.equal(s.getRange('C15').values[0][0],28);assert.equal(s.getRange('E15').values[0][0],75);\nconst original=sheets['155项功能']")
p.write_text(s)
