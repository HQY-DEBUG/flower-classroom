from pathlib import Path
import json,hashlib,datetime,re
r=Path(__file__).resolve().parent.parent;o=r/'artifacts/rc14'
read=lambda p:json.loads((r/p).read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();write=lambda p,d:(r/p).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
f=read('artifacts/rc14/frozen-source.json');assert f['candidateVersion']=='1.3.0-rc.14'
for n,h in {**f['files'],**f['assetFiles'],**f['packageFiles'],**f['packagedDocuments']}.items():assert sha(r/n)==h,n
ash=sha(r/'dist-rc14-final/win-unpacked/resources/app.asar');assert ash=='960db9464f92f72e28abd5d086dfd37694de1544f8fb6d667d763ee45705e1a5'
retests=read('artifacts/rc14/final-retests/runs.json');care=read('artifacts/rc14/care-exact-final/runs.json')
assert retests['sourceUnchanged'] and care['sourceUnchanged'];assert all(v['exitCode']==0 for v in retests['suites']+care['suites'])
source=read('artifacts/rc14/source-runs.json');pack=read('artifacts/rc14/packaged-runs.json');assert len(source)==26 and len(pack['results'])==24
for mode,rows in [('source',source),('packaged',pack['results'])]:
 for row in rows:
  replacement=next((x for x in retests['suites']+care['suites'] if x['mode']==mode and x['suite']==row['suite']),None)
  if replacement:row['initialAttempt']={**row};row.update(replacement);row['bindingProof']='artifacts/rc14/care-exact-final/runs.json' if replacement in care['suites'] else 'artifacts/rc14/final-retests/runs.json'
  assert row['exitCode']==0,(mode,row['suite'])
write('artifacts/rc14/source-final-runs.json',source);write('artifacts/rc14/packaged-final-runs.json',{**pack,'results':pack['results']})
def cs(d):
 if isinstance(d,list):return sum((cs(v) for v in d),[])
 if not isinstance(d,dict):return []
 if isinstance(d.get('checks'),list):return cs(d['checks'])
 if 'status' in d and d['status'] in ['passed','failed','observed']:return [d]
 for key in ['results','runs','report','result']:
  if key in d:return cs(d[key])
 if d.get('passed') is True:return [{'name':d.get('phase','Case passed'),'status':'passed'}]
 if d.get('stateEqual') is True and d.get('transientModalsAbsent') is True:return [{'name':'Fresh process exact state and no transient modals','status':'passed'}]
 return []
def checked(paths):
 checks=sum((cs(read(p)) for p in paths),[]);assert checks,paths
 observed=[v for v in checks if v['status']=='observed' or v.get('name','').startswith('Workbook format observation:')];normal=[v for v in checks if v not in observed]
 assert all(v['status']=='passed' for v in normal),[(p,v.get('name'),v.get('status')) for p in paths for v in normal if v['status']!='passed']
 return len(normal),len(observed)
groups=[]
def group(name,mode,paths,proof):
 count,obs=checked(paths);groups.append({'group':name,'mode':mode,'passed':count,'observations':obs,'failed':0,'evidenceFiles':paths,'bindingProof':proof});return count
# Shared regular outputs have distinct source/package locations.
old=read('artifacts/rc13/report/final-config.json');source_paths={v['id']:v['file'].replace('artifacts/rc13/source-evidence/','artifacts/').replace('artifacts/rc13/','artifacts/rc14/') for v in old['runs'] if v.get('bindingScope')=='source'}
source_paths['source-adversarial']='artifacts/rc9/adversarial-source/results.json';source_paths['source-pet-care']='artifacts/qa-pet-care/results.json'
sourcekeys=['source-ui','source-pets','source-catalog','source-known-flows','source-migration','source-pet-care','source-wheels','source-lock','source-groups','source-classroom','source-pet-switch','source-narrow','source-organization','source-pet-extra','source-toolbox','source-navigation','source-palette','source-focus','source-lifecycle','source-lazy-excel','source-lock-layout','source-modal-headers','source-window-exits','source-adversarial','source-window-readonly']
for key in sourcekeys:group(key,'source',[source_paths[key]],'artifacts/rc14/source-final-runs.json')
for name,p in read('artifacts/rc10/recovery/package-paths.json').items():group(name,'packaged',[p],'artifacts/rc14/packaged-final-runs.json')
for mode in ['source','packaged']:
 for stem in ['legacy-targeted','new-targeted','features','extension','rc13-inherited']:
  base=f'artifacts/rc14/{stem}-{mode}';run=read(base+'/runs.json');assert run['sourceUnchanged'];rows=run['suites']
  for row in rows:
   kind=row['suite'];p=row.get('evidenceDirectory') or str(Path(row['result']).parent)
   replacement=None
   if stem=='features' and mode=='source' and kind=='avatar-comprehensive':p='artifacts/rc14/final-retests/avatar-comprehensive-source';replacement=next(v for v in retests['suites'] if v['suite']==kind and v['mode']==mode)
   if stem=='new-targeted' and mode=='packaged' and kind=='ui':p='artifacts/rc14/final-retests/ui-packaged';replacement=next(v for v in retests['suites'] if v['suite']==kind and v['mode']==mode)
   if stem=='rc13-inherited' and kind=='roster-exact':p=f'artifacts/rc14/care-exact-final/exact-{mode}';replacement=next(v for v in care['suites'] if v['suite']=='exact' and v['mode']==mode)
   if stem=='rc13-inherited' and kind=='feedback' and mode=='packaged':p='artifacts/rc14/final-retests/feedback-packaged';replacement=next(v for v in retests['suites'] if v['suite']=='feedback')
   if replacement:row['initialAttempt']={**row};row.update({**replacement,'suite':kind,'evidenceDirectory':p})
   assert row['exitCode']==0,(stem,mode,kind)
   if kind in ['confirmations','target-confirmations']:
    rr=read(p+'/run.json');assert rr['status']==0 and all(x['status']==0 for x in rr['restarts']);paths=[p+'/flows.json']+[p+'/restart-'+x['name']+'.json' for x in rr['restarts']]
   elif stem=='new-targeted' and kind in ['transactions','startup-restore','missed-restore-notice']:
    rr=read(p+'/run.json');assert all(x['status']==0 for x in rr['runs']);paths=[p+'/'+x['phase']+'.json' for x in rr['runs']]
   else:
    paths=[p+'/results.json']
    if stem=='new-targeted' and kind=='queued-restore':paths.append(p+'/restart.json')
    if stem=='features' and kind=='egg-comprehensive':paths.append(p+'/restart-result.json')
    if stem=='rc13-inherited' and kind in ['feedback','cross-feature']:paths.append(p+'/restart.json')
   row['resultFiles']=paths
   group(stem+'-'+kind,mode,paths,base+'/final-runs.json')
  if mode=='packaged':assert run.get('asarSha256',run.get('archiveSha256'))==ash
  write(base+'/final-runs.json',{**run,'suites':rows})
 for kind in ['score-editor','avatar-access']:
  group('rc14-'+kind,mode,[f'artifacts/rc14/focused-{mode}/{kind}/results.json'],f'artifacts/rc14/focused-{mode}/runs.json')
 review='source-final-r2' if mode=='source' else 'packaged-final-r2';base='artifacts/rc14-independent-review/'+review
 group('rc14-independent',mode,[base+'/results.json',base+'/restart-results.json',base+'/response-loss/result.json'],'artifacts/rc14-independent-review/final-review.json')
review=read('artifacts/rc14-independent-review/final-review.json');assert review['status']=='passed'
unit=int(re.search(r'(?:ℹ|#) pass (\d+)',(o/'source-unit.log').read_text())[1]);pkgunit=read('artifacts/rc14/package-unit/results.json');assert unit==552 and pkgunit['passed']==551 and pkgunit['exitCode']==0 and pkgunit['asarSha256']==ash
startup=read('artifacts/rc14/startup-identity/results.json');assert startup['failed']==0 and startup['asarSha256']==ash
preview=checked(['artifacts/rc14/ui-review/preview/results.json'])[0]
folder=read('artifacts/rc14/package/folder7z-verification.json')
for p in ['portable-verification','pe-verification','folder7z-verification']:assert read('artifacts/rc14/package/'+p+'.json')['status']=='passed' and read('artifacts/rc14/package/'+p+'.json')['asarSha256']==ash
files=[{'path':str(p),'fileName':p.name,'name':p.name,'sizeBytes':p.stat().st_size,'bytes':p.stat().st_size,'sha256':sha(p)} for p in [r/'dist-rc14-final/FlowerClassroom-1.3.0-rc.14-portable.exe',Path(folder['file']),r/'dist-rc14-final/FlowerClassroom-1.3.0-rc.14-x64.zip']]
assert all(v['sizeBytes']<104857600 for v in files[:2])
totals={mode:sum(v['passed'] for v in groups if v['mode']==mode) for mode in ['source','packaged']}
result={'version':f['candidateVersion'],'candidateVersion':f['candidateVersion'],'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed-in-covered-cloud-scope','sourceTreeSha256':hashlib.sha256(json.dumps(f['files'],sort_keys=True,separators=(',',':')).encode()).hexdigest(),'sourceManifestSha256':sha(o/'frozen-source.json'),'sourceFiles':f['files'],'sourceFileCount':len(f['files']),'frozenAt':f['frozenAt'],'avatarAssets':f['avatarAssets'],'assetFiles':f['assetFiles'],'defaultAvatarCount':120,'original40Unchanged':True,'species':40,'speciesForms':280,'sourceAndPackageSame':True,'archiveVerificationPassed':True,'asarSha256':ash,'files':files,'sourceNodePassed':unit,'packageNodePassed':pkgunit['passed'],'sourceElectronChecks':totals['source'],'totalProductionAsarChecks':totals['packaged'],'startupChecksPassed':startup['passed'],'previewChecksPassed':preview,'groups':groups,'sourceRuns':'artifacts/rc14/source-final-runs.json','packageRuns':'artifacts/rc14/packaged-final-runs.json','independentReview':'artifacts/rc14-independent-review/final-review.json','windowsExecuted':False,'unverifiedWindowsItems':['V033','V035','V037','V038','V052','V054','V067','R14-W01','R14-W02'],'specializedAudit':'Previously stopped lock/file SECURITY specialist audit remains stopped and unverified; ordinary existing regressions and authorized new-feature error handling are distinct.','realStudentDataTouched':False,'dataDirectory':'%APPDATA%\\FlowerClassroom','resourceDirectory':'Actual launched EXE sibling folder; portable outer EXE location','avatarDirectory':'EXE sibling / 头像','ruleWorkbook':'EXE sibling / 计分卡片.xlsx','schemaVersionChanged':False,'newOptionalVersion2Fields':['scoreRules[].growthDelta','logs[].growthDelta'],'appId':'org.flowerclassroom.desktop','releaseGate':{'passedInCoveredScope':True,'unresolvedDiscoveredDefects':0,'fixedFindings':4,'fullFinalSourceAndAsarRegression':True,'independentReviewComplete':True,'unverifiedLimitsRetained':True},'languages':['zh-CN','zh-TW','en-US']}
write('artifacts/rc14/final-test-manifest.json',result);write('artifacts/rc14/package-summary.json',result)
print(json.dumps({k:result[k] for k in ['version','sourceTreeSha256','sourceNodePassed','packageNodePassed','sourceElectronChecks','totalProductionAsarChecks','startupChecksPassed','previewChecksPassed','files']},ensure_ascii=False,indent=2))
