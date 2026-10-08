'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),freeze=read('artifacts/parity-rc3/frozen-source.json'),summary=read('artifacts/parity-rc3/package-summary.json'),assessment=read('artifacts/parity-rc3/assessment-input.json');
if(summary.status!=='passed'||summary.candidateVersion!==freeze.candidateVersion||JSON.stringify(summary.sourceManifest)!==JSON.stringify(freeze.files))throw Error('Final package is not verified against current source');
for(const [file,sha] of Object.entries(freeze.files))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')!==sha)throw Error('Source changed '+file);
const count=(rows,field,value)=>rows.filter(row=>row[field]===value).length;
const status={version:freeze.candidateVersion,status:'未完整对齐、未发布候选；不得代替已发布1.2',sourceFrozenAt:freeze.frozenAt,sourceFingerprint:assessment.metadata.sourceRevision,sourceFiles:freeze.files,primaryVideoFeatures:76,implemented:count(assessment.results,'implementation','已实现'),partlyImplemented:count(assessment.results,'implementation','部分实现'),notImplemented:count(assessment.results,'implementation','未实现'),ruleScopeUnknown:count(assessment.results,'implementation','待核定'),verificationPassed:count(assessment.results,'status','通过'),needsClarification:count(assessment.results,'status','待澄清'),WindowsNotVerified:count(assessment.results,'status','未验证'),supplementalEvidenceRows:28,supplementalPassed:count(assessment.supplementalResults,'status','通过'),supplementalNeedsClarification:count(assessment.supplementalResults,'status','待澄清'),sourceAndAsarVerified:true,windowsExecution:false,syntheticFixturesOnly:true,referenceStudentImagesIncluded:false,checkpointPurpose:'开发恢复及后续迭代；不作为用户正式软件交付'};
fs.writeFileSync(path.join(root,'CHECKPOINT-STATUS.json'),JSON.stringify(status,null,2)+'\n');
const report=[`# 花伴课堂 ${freeze.candidateVersion} 未发布候选核验`,'',`此候选未完整对齐，不代替已发布1.2。最终35份源码冻结于 ${freeze.frozenAt}。原片76项：${status.verificationPassed}通过、${status.needsClarification}待澄清、${status.WindowsNotVerified}未验证；实现${status.implemented}/76。28项同系列补证：${status.supplementalPassed}通过、${status.supplementalNeedsClarification}待澄清。补证跨日期，不能认定原片同版。`,'','## 同源与运行包',
`- 最终目录：${path.dirname(summary.portable.path)}。先前dist-rc3-final是240px修前包，仅作历史记录`,
`- Windows x64 portable及ZIP已构建，35个源文件逐字吻合ASAR；没有残缺安装器，也未签名`,
`- 将ASAR复制至独立目录执行，应用依赖禁止从包外解析；${summary.suites.length}组共${summary.isolatedAsarChecks}项执行通过。这是包内复验数量，不与源码用例重复相加为功能数`,
...summary.suites.map(s=>`- ${s.suite}：${s.passed}通过，${s.failed}失败`),
`- 两档完整性通过；${summary.commonRuntimeFiles}个共同运行文件字节一致，四份说明文档与当前版本逐字一致`,
'- 20种×7段原创造型、旧4ID、选择保存和重启兼容保留。全部测试使用合成学生与头像，原视频学生照片未包含',
'- 最后新增真实240px指针测试：7页、42处控件可达、12项通过。修前内层溢出和焦点等问题、测试执行等待问题均保留修复与复测记录','',
'## SHA-256',`- portable：${summary.portable.sha256}（${summary.portable.sizeBytes} bytes）`,`- ZIP：${summary.zip.sha256}（${summary.zip.sizeBytes} bytes）`,`- ASAR：${summary.asarSha256}`,`- 主EXE：${summary.runtimeExeSha256}`,'',
'## 尚需补证与验证',
'1. 提供带准确版本信息的官方可访问测试版本，或使用虚构学生的完整连续录屏/说明：传送门、成员排序、抽取对象、Excel下拉、宠物批量/工具图标及百宝箱课堂作业消和裁切项。',
'2. 提供非零数据前后闭环：复制/清零对宠物、徽章、历史及规则的影响；负成长降级下限与余值；徽章可兑换/总数及相机动作；宠物排行联合优先级与并列。',
'3. 授权的Windows测试环境与课件软件：实际执行EXE、全屏PPT置顶/切页、透明窗口和物理拖动、快捷键、多屏DPI、实际音响；物理触屏需要实际触屏设备测试。Linux离屏或模拟输入不能代替这些验收。',
'',
'当前没有运行Windows EXE。所有未验证和待澄清均未计为通过；包完整性不会解除这些阻塞。发布前继续针对补足资料迭代并重测，当前只保存独立未发布检查点。',''];
fs.writeFileSync(path.join(root,'RELEASE-VERIFICATION.md'),report.join('\n'));console.log(JSON.stringify({...status,sourceFiles:35},null,2));
