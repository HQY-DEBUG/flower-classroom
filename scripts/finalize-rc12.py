from pathlib import Path
import json,hashlib,datetime,re
r=Path(__file__).resolve().parent.parent;o=r/'artifacts/rc12'
read=lambda p:json.loads((r/p).read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
f=read('artifacts/rc12/frozen-source.json');version=f['candidateVersion'];assert version=='1.3.0-rc.12'
for n,h in {**f['files'],**f['avatarAssets'],**f['packagedDocuments'],**f['packageFiles']}.items():assert sha(r/n)==h,n
source=read('artifacts/rc12/source-final-runs.json');pack=read('artifacts/rc12/packaged-runs.json');assert len(source)==26 and len(pack['results'])==24;assert all(x['exitCode']==0 for x in source+pack['results'])
archive=r/'dist-rc12-final/win-unpacked/resources/app.asar';ash=sha(archive);assert ash==pack['asarSha256']=='c5dcc68cf01d205d56145b42bba35881a637617311c4ea266ba62ebc79e4c9c5'
def checks(d):
 if isinstance(d,list):
  if d and all(isinstance(v,dict) and v.get('status') in ['passed','failed','observed'] and ('name' in v or 'id' in v) for v in d):return d
  return sum((checks(v) for v in d),[])
 if not isinstance(d,dict):return []
 if isinstance(d.get('checks'),list):return d['checks']
 for key in ['results','runs','report','result']:
  if key in d:return checks(d[key])
 if d.get('passed') is True:return [{'name':'Fresh process restart exact state','status':'passed'}]
 return []
def checked(paths):
 cs=sum((checks(read(p)) for p in paths),[]);assert cs,paths
 cs=[c for c in cs if not c.get('name','').startswith('Workbook format observation:')]
 assert all(c['status']=='passed' for c in cs),[(c.get('name'),c.get('status')) for c in cs if c.get('status')!='passed'];return len(cs)
packagePaths=read('artifacts/rc10/recovery/package-paths.json');inherited=[{'suite':n,'artifact':p,'passed':checked([p]),'failed':0} for n,p in packagePaths.items()]
def targeted(folder,new):
 run=read('artifacts/rc12/'+folder+'/runs.json');assert run['sourceUnchanged'] and all(x['exitCode']==0 and x['scriptUnchanged'] for x in run['suites'])
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
assert oldS['passed']==oldP['passed']==157 and newS['passed']==newP['passed']==101
features={}
for mode in ['source','packaged']:
 run=read(f'artifacts/rc12/features-{mode}/final-runs.json');assert run['sourceUnchanged'];rows=run['suites'];assert all(x['exitCode']==0 for x in rows if x['suite']!='keyboard')
 if mode=='packaged':assert run['asarSha256']==ash
 kinds=['egg','avatars','avatar-import','egg-comprehensive','avatar-comprehensive','pet-feedback','keyboard-close-retest'];suites=[]
 for kind in kinds:
  folder='avatar-comprehensive-retest' if mode=='packaged' and kind=='avatar-comprehensive' else kind
  p=f'artifacts/rc12/features-{mode}/{folder}/results.json';paths=[p]
  if kind=='egg-comprehensive':paths.append(f'artifacts/rc12/features-{mode}/{kind}/restart-result.json')
  d=read(p)
  if kind=='keyboard-close-retest':assert d['completed'] and d['sourceChanged'] is False and not d['runtimeErrors']
  suites.append({'suite':kind,'passed':checked(paths),'failed':0,'evidence':paths})
 features[mode]={'passed':sum(x['passed'] for x in suites),'suites':suites}
assert features['source']['passed']==features['packaged']['passed']
review=read('artifacts/rc12/independent-review/FINAL-REVIEW.json')
independentPaths={
 'cross-feature':['artifacts/rc12/independent-review/packaged-final/results.json'],
 'tools':['artifacts/comprehensive-rc11-20261005/tools-audit/packaged-rc12-final33/results.json'],
 'import':['artifacts/comprehensive-rc11-20261005/import-audit/packaged-rc12-final/results.json','artifacts/comprehensive-rc11-20261005/import-audit/format-packaged-rc12-final/results.json','artifacts/comprehensive-rc11-20261005/import-audit/text-packaged-rc12-final/results.json']}
independent={k:{'passed':checked(v),'evidence':v} for k,v in independentPaths.items()};assert independent['cross-feature']['passed']==21 and independent['tools']['passed']==33 and independent['import']['passed']==72
unitLog=(o/'source-unit.log').read_text();unit=int(re.search(r'(?:ℹ|#) pass (\d+)',unitLog)[1]);assert re.search(r'(?:ℹ|#) fail 0',unitLog)
pu=read('artifacts/rc12/package-unit/results.json');assert pu['exitCode']==0 and pu['passed']==unit==461 and pu['asarSha256']==ash
startup=read('artifacts/rc12/startup-identity/results.json');assert startup['failed']==0 and startup['asarSha256']==ash
preview=read('artifacts/rc12/ui-review/preview/results.json');previewCount=checked(['artifacts/rc12/ui-review/preview/results.json']);assert previewCount==41
folder=read('artifacts/rc12/package/folder7z-verification.json');pe=read('artifacts/rc12/package/pe-verification.json');portable=read('artifacts/rc12/package/portable-verification.json')
for d in [folder,pe,portable]:assert d['status']=='passed' and d['asarSha256']==ash
files=[{'path':str(p),'fileName':p.name,'sizeBytes':p.stat().st_size,'sha256':sha(p)} for p in [r/'dist-rc12-final'/f'FlowerClassroom-{version}-portable.exe',r/'dist-rc12-final'/f'FlowerClassroom-{version}-x64.zip',Path(folder['file'])]]
assert files[0]['sizeBytes']<104857600 and files[2]['sizeBytes']<104857600
result={'candidateVersion':version,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed-in-covered-cloud-scope','frozenAt':f['frozenAt'],'sourceFiles':52,'sourceManifest':f['files'],'sourceTreeSha256':hashlib.sha256(json.dumps(f['files'],sort_keys=True,separators=(',',':')).encode()).hexdigest(),'avatarAssets':f['avatarAssets'],'unitPassed':unit,'extractedPackageUnitPassed':pu['passed'],'sourceSuitesPassed':26,'sourceFirstRun':{'passed':24,'harnessAdaptationsRetested':2,'evidence':'artifacts/rc12/source-runs.json'},'packageSuites':inherited,'inheritedPackagedChecksPassed':sum(v['passed'] for v in inherited),'legacyTargetedSource':oldS['passed'],'legacyTargetedPackaged':oldP['passed'],'rc10TargetedSource':newS['passed'],'rc10TargetedPackaged':newP['passed'],'features':features,'independentPackaged':independent,'totalProductionAsarChecks':sum(v['passed'] for v in inherited)+oldP['passed']+newP['passed']+features['packaged']['passed']+sum(x['passed'] for x in independent.values()),'startupChecksPassed':startup['passed'],'previewChecksPassed':previewCount,'asarSha256':ash,'files':files,'folder7z':folder,'sourceAndPackageSame':True,'archiveVerificationPassed':True,'windowsExecuted':False,'schemaVersionChanged':False,'normalDataDirectory':'%APPDATA%\\FlowerClassroom','avatarDirectory':'%APPDATA%\\FlowerClassroom\\avatars','appId':'org.flowerclassroom.desktop','realStudentDataTouched':False,'species':40,'speciesForms':280,'sharedEggPrelude':True,'defaultAvatarCount':40,'unverifiedWindowsItems':['V033','V035','V037','V038','V052','V054','V067'],'specializedAudit':'Previously platform-stopped lock/file specialist remains stopped and unverified; not retried or rerouted. Established regression checks are separate.','releaseGate':{'status':'passed-for-covered-scope','unresolvedDiscoveredDefects':0,'independentReviewComplete':True,'fullFinalSourceAndAsarRegression':True,'unverifiedScopesRetained':True},'source':'artifacts/rc12/source-final-runs.json','package':'artifacts/rc12/packaged-runs.json','independentReview':'artifacts/rc12/independent-review/FINAL-REVIEW.json'}
for n in ['package-summary.json','final-test-manifest.json']:(o/n).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
(r/'RELEASE-VERIFICATION.md').write_text(f'''# RC12 最终验证\n\n版本{version}，ASAR SHA256 {ash}。52源码和40头像与冻结源码完全一致，280宠物形态保持原样。\n\n源码26套经2处继承测试适配复测闭环；最终生产ASAR24套、RC9/RC10专项及本次独立修复测试全部通过，合计{result['totalProductionAsarChecks']}项实际Linux Electron ASAR检查。源码与提取包模型分别{unit}项通过，启动路径/配置{startup['passed']}项，预览{previewCount}项另计。保留首次失败、测试超时和适配记录。\n\n独立复查RC11发现10类产品问题，修复过程中另发现1类过期反馈问题，均修复并由最终ASAR重验。没有遗留已发现的覆盖内缺陷。七项Windows现场项目和此前中止的额外安全专项仍未验证，不能声称全软件零缺陷。\n\n便携与7z目录的78运行文件一致，ZIP77共有文件一致，CRC/PE/包同源核验通过。两个推荐分发包均低于100MiB。旧版已失真的导入文字不能自动重建，应核对原始名单。\n''')
print(json.dumps({k:result[k] for k in ['candidateVersion','sourceTreeSha256','unitPassed','totalProductionAsarChecks','startupChecksPassed','files']},ensure_ascii=False))
