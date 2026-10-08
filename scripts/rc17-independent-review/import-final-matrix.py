"""Sequential independent source and exact-ASAR import review; preserves first-run evidence."""
import datetime, hashlib, json, os, pathlib, subprocess
REPO=pathlib.Path(__file__).resolve().parents[2]
PAYLOAD=REPO/'dist-rc17-final/win-unpacked'
ASAR=PAYLOAD/'resources/app.asar'
OUT=pathlib.Path(os.environ.get('IMPORT_FINAL_OUT',str(REPO/'artifacts/rc17-independent-review/imports-final')))
EXPECTED='02d81b32d623225861231181c0285ef9e0683b99dbdb0c2a4b349e866fd66b08'
TMP='/tmp/flower-classroom-workspace/flower-rc17-temp'
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,v): p.write_text(json.dumps(v,indent=2,ensure_ascii=False))
def maps():
 source={str(p.relative_to(REPO)):sha(p) for p in sorted((REPO/'src').rglob('*')) if p.is_file()}
 source_assets={str(p.relative_to(REPO)):sha(p) for p in sorted((REPO/'assets').rglob('*')) if p.is_file()}
 script="const a=require('@electron/asar'),c=require('crypto');let f={};for(const p of a.listPackage(process.argv[1]).filter(p=>p.startsWith('/src/'))){try{f[p.slice(1)]=c.createHash('sha256').update(a.extractFile(process.argv[1],p.slice(1))).digest('hex')}catch(e){if(!a.statFile(process.argv[1],p.slice(1)).files)throw e}}process.stdout.write(JSON.stringify(f))"
 proc=subprocess.run(['node','-e',script,str(ASAR)],cwd=REPO,capture_output=True,text=True,check=True)
 return {'source':source,'sourceAssets':source_assets,'sourcePackageJson':sha(REPO/'package.json'),'asar':{'path':str(ASAR),'sha256':sha(ASAR),'source':json.loads(proc.stdout)},'externalAvatars':{p.name:sha(p) for p in sorted((PAYLOAD/'头像').iterdir()) if p.is_file()},'seedMarker':sha(PAYLOAD/'头像-初始化-v2.txt')}
if OUT.exists(): raise RuntimeError('Use a fresh output directory; preserve existing execution evidence: '+str(OUT))
assert sha(ASAR)==EXPECTED,'Wrong final artifact'
OUT.mkdir(parents=True)
start=now();before=maps();write(OUT/'runtime-before.json',before)
assert before['source']==before['asar']['source'],'Source src does not match packaged src'
rows=[];allchecks=[];leaves=[]
spec=[('snapshot-source','source','scripts/rc17-independent-review/import-snapshots.cjs',36,147),('snapshot-asar','packaged','scripts/rc17-independent-review/import-snapshots.cjs',36,147),('focused-source','source','scripts/reaudit-rc15/avatars/audit-batch-races.cjs',10,None),('focused-asar','packaged','scripts/reaudit-rc15/avatars/audit-batch-races.cjs',10,None)]
for suite,mode,rel,expected_cases,expected_leaves in spec:
 target=OUT/suite;target.mkdir()
 script=REPO/rel;env=os.environ.copy()
 for name in ['AUDIT_MAIN','AUDIT_ASAR','AUDIT_OUT','AUDIT_PAYLOAD']:env.pop(name,None)
 overrides={'AUDIT_OUT':str(target),'AUDIT_PAYLOAD':str(PAYLOAD),'AUDIT_ASAR':str(ASAR),'TMPDIR':TMP}
 if mode=='source':overrides['AUDIT_MAIN']=str(REPO/'src/main.cjs')
 env.update(overrides)
 command=['node',str(script)];pre=maps();write(target/'runtime-before.json',pre)
 began=now()
 try:
  proc=subprocess.run(command,cwd=REPO,env=env,capture_output=True,text=True,timeout=270)
  code=proc.returncode;log=proc.stdout+'\n'+proc.stderr
 except subprocess.TimeoutExpired as e:
  code=124;log=str(e)
 ended=now();(target/'execution.log').write_text(log)
 post=maps();write(target/'runtime-after.json',post)
 result=json.loads((target/'results.json').read_text()) if (target/'results.json').exists() else {}
 checks=result.get('checks',[]);named=result.get('leaves',checks)
 validity={'expectedCases':expected_cases,'actualCases':len(checks),'expectedNamedLeaves':expected_leaves or expected_cases,'actualNamedLeaves':len(named),'countMatches':len(checks)==expected_cases and len(named)==(expected_leaves or expected_cases)}
 evidence=sorted(str(p) for p in target.rglob('*') if p.is_file())
 row={'suite':suite,'mode':mode,'domain':'imports','startedAt':began,'completedAt':ended,'exitCode':code,'command':command,'cwd':str(REPO),'environmentOverrides':overrides,'log':str(target/'execution.log'),'evidenceFiles':evidence,'script':str(script),'scriptSha256':sha(script),'runtimeUnchanged':pre==post,'sourceMatchesASAR':post['source']==post['asar']['source'],'asarSha256':post['asar']['sha256'],'validation':validity,'actualAssertionLeaves':len(named)}
 write(target/'execution-row.json',row);rows.append(row)
 allchecks.extend({'suite':suite,'mode':mode,'domain':'imports',**check} for check in checks)
 leaves.extend({'suite':suite,'mode':mode,'domain':'imports',**leaf} for leaf in named)
 write(OUT/'execution-rows.json',rows);write(OUT/'named-checks.json',allchecks);write(OUT/'named-assertions.json',leaves)
 print(json.dumps({'suite':suite,'exitCode':code,'runtimeUnchanged':pre==post,'cases':len(checks),'leaves':len(named),'failed':sum(c.get('status')!='passed' for c in checks)}),flush=True)
after=maps();write(OUT/'runtime-after.json',after)
summary={'startedAt':start,'completedAt':now(),'domain':'imports','executions':len(rows),'allExecutionsPassed':all(r['exitCode']==0 and r['runtimeUnchanged'] and r['sourceMatchesASAR'] and r['validation']['countMatches'] for r in rows),'namedCases':len(allchecks),'passedCases':sum(c.get('status')=='passed' for c in allchecks),'failedCases':sum(c.get('status')!='passed' for c in allchecks),'namedAssertions':len(leaves),'failedAssertions':sum(c.get('status')!='passed' for c in leaves),'runtimeUnchanged':before==after,'asarSha256':after['asar']['sha256'],'syntheticOnly':True,'windowsExecuted':False,'nativeChooserMocked':True,'executionRows':str(OUT/'execution-rows.json'),'namedChecksPath':str(OUT/'named-checks.json'),'namedAssertionsPath':str(OUT/'named-assertions.json')}
write(OUT/'summary.json',summary);write(OUT/'execution-envelope.json',{'startedAt':start,'completedAt':summary['completedAt'],'domain':'imports','suites':rows,'summary':summary})
print(json.dumps(summary),flush=True)
raise SystemExit(0 if summary['allExecutionsPassed'] and not summary['failedCases'] and summary['runtimeUnchanged'] else 1)
