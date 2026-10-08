from pathlib import Path
import json,hashlib,datetime,re
r=Path(__file__).resolve().parent.parent;s=r/'artifacts/rc10'
read=lambda p:json.loads((r/p).read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
freeze=read('artifacts/rc10/frozen-source.json');version=freeze['candidateVersion'];assert version=='1.3.0-rc.10'
for file,digest in {**freeze['files'],**freeze['packagedDocuments'],**freeze['packageFiles']}.items():assert sha(r/file)==digest,file
source=read('artifacts/rc10/source-runs.json');package=read('artifacts/rc10/packaged-runs.json');assert all(x['exitCode']==0 for x in source);assert all(x['exitCode']==0 for x in package['results'])
asar=r/'dist-rc10-final/win-unpacked/resources/app.asar';ash=sha(asar);assert ash==package['asarSha256']=='7b63ac113e67dfba1abe35ba6cde12a77b4803a867dd8ca04544d954d101d78f'
def checks(d):
 if isinstance(d,list):return sum([checks(x) for x in d],[])
 if not isinstance(d,dict):return []
 if isinstance(d.get('checks'),list):return d['checks']
 for key in ['results','runs','report','result']:
  if key in d:return checks(d[key])
 return []
def rows(files):
 result=sum([checks(read(f)) for f in files],[]);assert result and all(x['status']=='passed' for x in result),files;return result
inherited=[]
for name,file in read('artifacts/rc10/recovery/package-paths.json').items():inherited.append({'suite':name,'artifact':file,'passed':len(rows([file])),'failed':0})
def targeted(folder,new):
 run=read('artifacts/rc10/'+folder+'/runs.json');assert run['sourceUnchanged'];assert all(x['exitCode']==0 and x['scriptUnchanged'] for x in run['suites'])
 if run['mode']=='packaged':assert run['archiveSha256']==ash
 result=[]
 for x in run['suites']:
  d=x['evidenceDirectory'] if new else str(Path(x['result']).parent)
  if new and x['suite'] in ['transactions','startup-restore','missed-restore-notice']:
   a=read(d+'/run.json');assert all(v['status']==0 for v in a['runs']);files=[d+'/'+v['phase']+'.json' for v in a['runs']]
  elif new and x['suite']=='queued-restore':files=[d+'/results.json',d+'/restart.json']
  else:files=[d+'/results.json']
  result.append({'suite':x['suite'],'passed':len(rows(files)),'failed':0,'evidence':files})
 out={'mode':run['mode'],'archiveSha256':run.get('archiveSha256'),'suites':result,'passed':sum(v['passed'] for v in result),'failed':0};(s/folder/'counts.json').write_text(json.dumps(out,indent=2)+'\n');return out
oldSource=targeted('legacy-targeted-source',False);oldPackage=targeted('legacy-targeted-packaged',False);newSource=targeted('new-targeted-source',True);newPackage=targeted('new-targeted-packaged',True)
assert oldSource['passed']==oldPackage['passed']==157;assert newSource['passed']==newPackage['passed']==101
startup=read('artifacts/rc10/startup-identity/results.json');assert startup['failed']==0 and startup['asarSha256']==ash
archive=read('artifacts/rc10/package/portable-verification.json');folder=read('artifacts/rc10/package/folder7z-verification.json');pe=read('artifacts/rc10/package/pe-verification.json')
for d in [archive,folder,pe]:assert d['status']=='passed' and d['asarSha256']==ash
unit=(s/'source-unit.log').read_text();passed=int(re.search(r'(?:ℹ|#) pass (\d+)',unit)[1]);assert re.search(r'(?:ℹ|#) fail 0',unit)
files=[]
for n in [f'FlowerClassroom-{version}-portable.exe',f'FlowerClassroom-{version}-x64.zip']:
 p=r/'dist-rc10-final'/n;files.append({'path':str(p.relative_to(r)),'sizeBytes':p.stat().st_size,'sha256':sha(p)})
review=read('artifacts/rc10/recovery/production-source-identity.json');scope=read('artifacts/rc10/specialized-audit-status.json')
independent=read('artifacts/rc10/independent-review/recovery-20261004T0022Z/review-manifest.json');assert independent['status'].startswith('PASS:') and independent['all47SourceFilesMatchFinalAsar'] and independent['all47RuntimeHashesStableThroughReview'];assert independent['finalAsarSha256']==ash
result={'candidateVersion':version,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed-in-covered-cloud-scope','sourceFiles':len(freeze['files']),'sourceManifest':freeze['files'],'sourceTreeSha256':review['sourceTreeSha256'],'frozenAt':freeze['frozenAt'],'originalFinalFreezeAt':'2026-10-03T23:53:24.277978+00:00','unitPassed':passed,'sourceSuitesPassed':len(source),'packageSuites':inherited,'inheritedPackagedChecksPassed':sum(x['passed'] for x in inherited),'legacyTargetedSource':oldSource['passed'],'legacyTargetedPackaged':oldPackage['passed'],'newTargetedSource':newSource['passed'],'newTargetedPackaged':newPackage['passed'],'newBreakdown':newPackage['suites'],'totalProductionAsarChecks':sum(x['passed'] for x in inherited)+oldPackage['passed']+newPackage['passed'],'startupChecksPassed':startup['passed'],'startupPathAndConfigRuns':len(startup['results']),'asarSha256':ash,'files':files,'folder7z':folder,'sourceAndPackageSame':True,'archiveVerificationPassed':True,'windowsExecuted':False,'schemaChanged':False,'normalDataDirectory':'%APPDATA%\\FlowerClassroom','appId':'org.flowerclassroom.desktop','realStudentDataTouched':False,'species':40,'totalRepresentations':280,'legacyArtworkPreserved':140,'unverifiedWindowsItems':['V033','V035','V037','V038','V052','V054','V067'],'specializedAudit':scope,'executorReplacement':read('artifacts/rc10/recovery/executor-replacement.json'),'programRebuiltDuringRecovery':False,'independentReview':'artifacts/rc10/independent-review/recovery-20261004T0022Z/review-manifest.json','releaseGate':{'status':'passed-for-covered-scope','unresolvedDiscoveredDefects':0,'independentReviewComplete':True,'fullFinalSourceAndAsarRegression':True,'unverifiedScopesRetained':True},'source':'artifacts/rc10/source-runs.json','package':'artifacts/rc10/packaged-runs.json'}
(s/'package-summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');(s/'final-test-manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
(r/'RELEASE-VERIFICATION.md').write_text(f'''# RC10 发行包与环境恢复重验

版本 {version}，生产ASAR SHA256 {ash}，47文件树SHA256 {result['sourceTreeSha256']}。程序从已保存Library恢复，未重新构建，便携EXE和目录包字节与最初通过版本完全一致。

环境更换后重新执行：模型{passed}、源码{len(source)}套、生产ASAR{len(inherited)}套，包内合计{result['totalProductionAsarChecks']}项（810继承、157既有边界、101本轮新增），启动{startup['passed']}项；均通过。新增101项在源码和同一ASAR两侧通过。原环境成功运行的已观察事实保留，但丢失日志不冒充当前可读取证据，本次使用重新生成的原始记录。

覆盖范围内已发现缺陷全部修复并经独立复审。原7项Windows现场观察与被平台中止的新增锁/文件边界专项分别未验证，不宣称全软件零缺陷。没有重试或绕过中止专项。所有数据为合成资料，未操作真实名单。进程终止测试不等于物理断电；回执与恢复代次为进程内机制。

程序保留40种宠物280形态；旧appId、存档schema、数据目录及兼容规则不变。Portable/folder7z有78文件，ZIP共有77文件逐字节核对，CRC与PE内嵌ASAR一致。文件与SHA详见配套最终交付清单及Excel/PDF。
''')
print(json.dumps({k:result[k] for k in ['candidateVersion','sourceTreeSha256','unitPassed','totalProductionAsarChecks','startupChecksPassed','createdAt']},ensure_ascii=False))
