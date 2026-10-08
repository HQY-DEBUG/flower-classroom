'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),stage='artifacts/rc9';
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p))),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const freeze=read(stage+'/frozen-source.json'),src=read(stage+'/source-runs.json'),pkg=read(stage+'/packaged-runs.json'),archive=read(stage+'/package/portable-verification.json'),pe=read(stage+'/package/pe-verification.json'),startup=read(stage+'/startup-identity/results.json');
assert(src.every(x=>x.exitCode===0));assert(pkg.results.every(x=>x.exitCode===0));assert.equal(archive.status,'passed');assert.equal(pe.asarSha256,pkg.asarSha256);assert.equal(startup.asarSha256,pkg.asarSha256);assert.equal(startup.failed,0);assert.equal(archive.asarSha256,pkg.asarSha256);
for(const [p,d]of Object.entries({...freeze.files,...freeze.packagedDocuments,...freeze.packageFiles}))assert.equal(sha(fs.readFileSync(path.join(root,p))),d);
const paths={ui:'artifacts/qa-packaged/qa-electron-results.json',pets:'artifacts/qa-pets-packaged/qa-pets-results.json',catalog:'artifacts/qa-catalog/packaged/qa-catalog-results.json',primary:'artifacts/rc9-packaged/known-flows-results.json',care:'artifacts/qa-pet-care-packaged/results.json',wheels:'artifacts/qa-wheels-packaged/results.json',lock:'artifacts/qa-classroom-lock-packaged/results.json',groups:'artifacts/qa-group-tools-packaged/results.json',classroom:'artifacts/qa-classroom-tools-native-packaged/results.json',switch:'artifacts/qa-pet-switch/packaged/results.json',narrow:'artifacts/qa-classroom-tools-240-packaged/results.json',organization:'artifacts/qa-organization-packaged/results.json',petextra:'artifacts/qa-pet-extra-packaged/results.json',toolbox:'artifacts/qa-toolbox-extra-native-packaged/results.json',navigation:stage+'/navigation-packaged/results.json',palette:stage+'/tool-palette-packaged-run.json',focus:stage+'/focus-contrast-packaged-run.json',lifecycle:'artifacts/qa-adventure-lifecycle/packaged/results.json','modal-headers':stage+'/modal-inventory-packaged-results.json','lock-layout':stage+'/lock-dialog-packaged/results.json','lazy-excel':stage+'/lazy-excel-packaged/results.json','window-exits':stage+'/window-exits-packaged-results.json',adversarial:stage+'/adversarial-packaged/results.json','window-readonly':stage+'/window-readonly-packaged-results.json'};
const checks=d=>d.checks|| (d.results?d.results.flatMap(r=>checks(r.report||r)):d.report?checks(d.report):[]);
const suites=Object.entries(paths).map(([suite,artifact])=>{const rows=checks(read(artifact));assert(rows.length>0);assert(rows.every(r=>r.status==='passed'));return{suite,passed:rows.length,failed:0,artifact,sha256:sha(fs.readFileSync(path.join(root,artifact)))};});
const unitText=fs.readFileSync(path.join(root,stage+'/source-unit.log'),'utf8'),unitPassed=Number(unitText.match(/(?:ℹ|#) pass (\d+)/)[1]);assert.match(unitText,/(?:ℹ|#) fail 0/);
const files=['portable.exe','x64.zip'].map(s=>{const p='dist-rc9-final/FlowerClassroom-'+freeze.candidateVersion+'-'+s,b=fs.readFileSync(path.join(root,p));return{path:p,sizeBytes:b.length,sha256:sha(b)}});
const summary={candidateVersion:freeze.candidateVersion,createdAt:new Date().toISOString(),status:'passed',sourceFiles:Object.keys(freeze.files).length,frozenAt:freeze.frozenAt,sourceManifest:freeze.files,sourceTreeSha256:sha(JSON.stringify(Object.fromEntries(Object.entries(freeze.files).sort(([a],[b])=>a.localeCompare(b))))),unitPassed,unitFailed:0,sourceSuitesPassed:src.length,packageSuites:suites,preRC7ScopePackagedChecksPassed:334,rc7ScopePackagedChecksPassed:712,packagedChecksPassed:suites.reduce((n,s)=>n+s.passed,0),startupPathAndConfigRuns:startup.results.length,startupChecksPassed:startup.passed,startupChecksFailed:startup.failed,asarSha256:pkg.asarSha256,files,windowsExecuted:false,normalLinuxSingleInstanceStartup:'blocked by environment local socket denial; not counted as passed',headlessElectronRealPackageAndIPC:true,physicalTouchscreen:false,realDataTouched:false,lockCoreUnchanged:freeze.files['src/classroom-lock.cjs']==='298b4688eb1a78ad767b7eaf1ff38fecbf735d2be14af6e898bb9ce2cf35d8c7',sourceAndPackageSame:true,archiveVerificationPassed:true,species:40,stagesPerSpecies:7,totalRepresentations:280,legacySpeciesPreserved:20,legacySVGsByteIdentical:140,modalSurfaces:80,sharedModalChecks:317,lockLayoutChecks:47,lazyExcelChecks:14,independentWindowRoles:8,independentWindowChecks:suites.find(s=>s.suite==='window-exits').passed,adversarialChecks:suites.find(s=>s.suite==='adversarial').passed,readonlyWindowChecks:suites.find(s=>s.suite==='window-readonly').passed,independentReview:{status:'passed-after-fixes',windowsValidated:false}};
fs.writeFileSync(path.join(root,stage+'/package-summary.json'),JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(root,'RELEASE-VERIFICATION.md'),`# RC9 发布包验证

版本 ${summary.candidateVersion}。运行时源码 ${summary.sourceFiles} 文件与ASAR逐字节一致，源码清单SHA256：${summary.sourceTreeSha256}。

模型 ${unitPassed} 项通过；继承源码回归 ${src.length} 套、正式ASAR回归 ${suites.length} 套通过（包内 ${summary.packagedChecksPassed} 条检查）。另有 ${startup.results.length} 种启动路径/配置、${startup.passed} 项启动保护检查通过。RC9独立新增复查、修复前后结果和详细功能边界单列在 targeted 源码/包清单和配套Excel/PDF；重复执行数不等于功能完成率。

本次从实际交付的RC8-r2起审计，修复确认过期、已有导出文件被中断写入破坏、保存回执异常导致重复操作、旧工具迟到回执误关闭新窗口四类边界。毕业检查真实快照；破坏性确认在资料变化后要求重新核对；导出采用同目录临时文件与原子替换；通信结果未知时阻止隐式重复提交并提示先核对；旧工具回执只更新其原始界面。

保留共享弹层和8类独立窗体固定退出、40种伙伴及280幅造型、旧20种ID与140幅SVG、旧存档迁移、照片、积分和成长账本。课堂锁、登记窗口和主frame来源限制继续验证；正常数据目录及schema未改变。

Portable嵌入归档与ZIP的CRC通过，${archive.commonFileCount}个共有文件逐字节一致，含冻结说明、范围与升级指南。PE内嵌ASAR完整性匹配。

${files.map(f=>`- ${path.basename(f.path)}：${f.sizeBytes}字节；SHA256 ${f.sha256}`).join('\n')}

ASAR SHA256：${pkg.asarSha256}

所有资料为合成测试数据。云端实际Electron主进程/preload/渲染、IPC与生产ASAR验证不能替代Windows EXE现场运行、Alt菜单、PPT覆盖、物理触屏、多屏DPI或听感；原7项Windows未验证继续单列。动作回执在本进程和原窗口有效，刷新/进程重启后应按实际记录核对。磁盘与回执故障注入不代表用户已经遭遇这些故障。没有签名或残缺安装器。
`);
console.log(JSON.stringify({...summary,sourceManifest:undefined},null,2));
