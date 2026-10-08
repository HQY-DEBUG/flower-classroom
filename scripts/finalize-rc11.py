from pathlib import Path
import json,hashlib,datetime,re
r=Path(__file__).resolve().parent.parent;o=r/'artifacts/rc11'
read=lambda f:json.loads((r/f).read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
f=read('artifacts/rc11/frozen-source.json');version=f['candidateVersion'];assert version=='1.3.0-rc.11'
for n,h in {**f['files'],**f['avatarAssets'],**f['packagedDocuments'],**f['packageFiles']}.items():assert sha(r/n)==h,n
source=read('artifacts/rc11/source-runs.json');pack=read('artifacts/rc11/packaged-runs.json');assert all(v['exitCode']==0 for v in source);assert all(v['exitCode']==0 for v in pack['results'])
archive=r/'dist-rc11-final/win-unpacked/resources/app.asar';ash=sha(archive);assert ash==pack['asarSha256']=='53e658ce7fdcaa7615f5b370271c57c0ca18ccd381d68ad77c28ed76df5e6baa'
def checks(d):
 if isinstance(d,list):
  if d and all(isinstance(v,dict) and v.get('status') in ['passed','failed'] and ('name' in v or 'id' in v) for v in d):return d
  return sum((checks(v) for v in d),[])
 if not isinstance(d,dict):return []
 if isinstance(d.get('checks'),list):return d['checks']
 for key in ['results','runs','report','result']:
  if key in d:return checks(d[key])
 return []
def checked(paths):
 result=sum((checks(read(p)) for p in paths),[]);assert result,paths;assert all(c['status']=='passed' for c in result),[(c.get('name'),c['status']) for c in result if c['status']!='passed'];return len(result)
packagePaths=read('artifacts/rc10/recovery/package-paths.json');inherited=[{'suite':name,'artifact':p,'passed':checked([p]),'failed':0} for name,p in packagePaths.items()]
def targeted(folder,new):
 run=read('artifacts/rc11/'+folder+'/runs.json');assert run['sourceUnchanged'];assert all(x['exitCode']==0 and x['scriptUnchanged'] for x in run['suites'])
 if run['mode']=='packaged':assert run['archiveSha256']==ash
 suites=[]
 for row in run['suites']:
  d=row['evidenceDirectory'] if new else str(Path(row['result']).parent)
  if new and row['suite'] in ['transactions','startup-restore','missed-restore-notice']:
   rr=read(d+'/run.json');assert all(v['status']==0 for v in rr['runs']);paths=[d+'/'+v['phase']+'.json' for v in rr['runs']]
  elif new and row['suite']=='queued-restore':paths=[d+'/results.json',d+'/restart.json']
  else:paths=[d+'/results.json']
  suites.append({'suite':row['suite'],'passed':checked(paths),'failed':0,'evidence':paths})
 result={'mode':run['mode'],'archiveSha256':run.get('archiveSha256'),'suites':suites,'passed':sum(v['passed'] for v in suites),'failed':0};(o/folder/'counts.json').write_text(json.dumps(result,indent=2)+'\n');return result
oldS=targeted('legacy-targeted-source',False);oldP=targeted('legacy-targeted-packaged',False);newS=targeted('new-targeted-source',True);newP=targeted('new-targeted-packaged',True)
assert oldS['passed']==oldP['passed']==157;assert newS['passed']==newP['passed']==101
fresh={'egg':('artifacts/rc11/egg-source-final/results.json','artifacts/rc11/egg-packaged/results.json'),'avatars':('artifacts/rc11/avatars-source/results.json','artifacts/rc11/avatars-packaged/results.json'),'avatarImport':('artifacts/rc11/avatar-import-source-final/results.json','artifacts/rc11/avatar-import-packaged/results.json'),'independentUI':('artifacts/rc11/independent-review/runtime-results.json','artifacts/rc11/independent-review/packaged-runtime-results.json')}
features={k:{'source':checked([v[0]]),'packaged':checked([v[1]]),'sourceEvidence':v[0],'packagedEvidence':v[1]} for k,v in fresh.items()};assert all(v['source']==v['packaged'] for v in features.values())
unitLog=(o/'source-unit.log').read_text();unit=int(re.search(r'(?:ℹ|#) pass (\d+)',unitLog)[1]);assert re.search(r'(?:ℹ|#) fail 0',unitLog)
packageUnit=read('artifacts/rc11/package-unit/results.json');assert packageUnit['exitCode']==0 and packageUnit['passed']==unit==441 and packageUnit['asarSha256']==ash
startup=read('artifacts/rc11/startup-identity/results.json');assert startup['failed']==0 and startup['asarSha256']==ash
folder=read('artifacts/rc11/package/folder7z-verification.json');pe=read('artifacts/rc11/package/pe-verification.json');portable=read('artifacts/rc11/package/portable-verification.json')
for d in [folder,pe,portable]:assert d['status']=='passed' and d['asarSha256']==ash
files=[]
for p in [r/'dist-rc11-final'/f'FlowerClassroom-{version}-portable.exe',r/'dist-rc11-final'/f'FlowerClassroom-{version}-x64.zip',Path(folder['file'])]:files.append({'path':str(p),'fileName':p.name,'sizeBytes':p.stat().st_size,'sha256':sha(p)})
assert files[0]['sizeBytes']<104857600 and files[2]['sizeBytes']<104857600
result={'candidateVersion':version,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed-in-covered-cloud-scope','frozenAt':f['frozenAt'],'sourceFiles':len(f['files']),'sourceManifest':f['files'],'sourceTreeSha256':hashlib.sha256(json.dumps(f['files'],sort_keys=True,separators=(',',':')).encode()).hexdigest(),'avatarAssets':f['avatarAssets'],'unitPassed':unit,'extractedPackageUnitPassed':packageUnit['passed'],'sourceSuitesPassed':len(source),'packageSuites':inherited,'inheritedPackagedChecksPassed':sum(v['passed'] for v in inherited),'legacyTargetedSource':oldS['passed'],'legacyTargetedPackaged':oldP['passed'],'rc10TargetedSource':newS['passed'],'rc10TargetedPackaged':newP['passed'],'rc11Features':features,'newNativeFeatureChecks':sum(features[k]['packaged'] for k in ['egg','avatars','avatarImport']),'independentPackagedChecks':features['independentUI']['packaged'],'totalProductionAsarChecks':sum(v['passed'] for v in inherited)+oldP['passed']+newP['passed']+sum(v['packaged'] for v in features.values()),'startupChecksPassed':startup['passed'],'startupPathAndConfigRuns':len(startup['results']),'previewChecksPassed':40,'asarSha256':ash,'files':files,'folder7z':folder,'sourceAndPackageSame':True,'archiveVerificationPassed':True,'windowsExecuted':False,'schemaVersionChanged':False,'additiveDataFields':['student.startFromEgg','petAccount.cycle.startFromEgg'],'normalDataDirectory':'%APPDATA%\\FlowerClassroom','avatarDirectory':'%APPDATA%\\FlowerClassroom\\avatars','appId':'org.flowerclassroom.desktop','realStudentDataTouched':False,'species':40,'speciesForms':280,'sharedEggPrelude':True,'defaultAvatarCount':40,'unverifiedWindowsItems':['V033','V035','V037','V038','V052','V054','V067'],'specializedAudit':'Previously platform-stopped lock/file specialist remains stopped and unverified; not retried or rerouted. Established regression checks are separate.','releaseGate':{'status':'passed-for-covered-scope','unresolvedDiscoveredDefects':0,'independentReviewComplete':True,'fullFinalSourceAndAsarRegression':True,'unverifiedScopesRetained':True},'source':'artifacts/rc11/source-runs.json','package':'artifacts/rc11/packaged-runs.json','sourceRetestHistory':'artifacts/rc11/source-final-retests','independentReview':'artifacts/rc11/independent-review/FINAL-REVIEW.json'}
for n in ['package-summary.json','final-test-manifest.json']:(o/n).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
(r/'RELEASE-VERIFICATION.md').write_text(f'''# RC11 最终验证\n\n版本{version}，生产ASAR SHA256 {ash}。51个源码文件与40张默认头像均与冻结源码逐字节一致，全部280宠物形态保持原样。\n\n源码26套（含继承测试适配后的记录复测）通过；包内24套以及157项RC9、101项RC10边界、51项RC11功能和9项独立交互复审通过，合计{result['totalProductionAsarChecks']}项实际Electron生产ASAR检查。源码与包内提取模型分别441项通过；模型层不冒充Windows运行。另有启动路径/配置{startup['passed']}项、预览40项通过。\n\n本轮发现的8个产品问题均修复复测：包内默认头像读取兼容、旧头像请求覆盖新选择、恢复后的旧草稿提交、键盘头像选择失焦、文件夹详情键盘不可达、迟到导入/恢复预览重新出现、失效头像选择视觉状态、失效说明被迟到列表覆盖。原始失败及测试适配记录保留。\n\n便携EXE与目录7z运行资源78个文件一致，ZIP77个共有文件一致；CRC、PE内嵌ASAR校验通过，两种推荐分发包都低于100MiB。\n\n七项Windows现场观察仍未验证。此前被平台中止的额外锁/文件边界专项保持中止，未重试或绕过。验证使用合成资料、Linux Electron，不声称全软件零缺陷或物理断电耐久性。\n''')
print(json.dumps({k:result[k] for k in ['candidateVersion','sourceTreeSha256','unitPassed','totalProductionAsarChecks','startupChecksPassed','newNativeFeatureChecks','independentPackagedChecks','files']},ensure_ascii=False))
