"""Collect current RC13 runs. Finalization additionally requires an explicit release manifest."""
import json,hashlib,sys,shutil,argparse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];D=Path(__file__).resolve().parent;S=ROOT/'artifacts/rc13'
p=argparse.ArgumentParser();p.add_argument('--final',action='store_true');p.add_argument('--release-manifest');a=p.parse_args()
read=lambda p:json.loads(Path(p).read_text());sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
freeze=read(S/'frozen-source.json');review=read(ROOT/'artifacts/rc13-independent-review/FINAL-REVIEW.json')
assert review['status']=='passed'and not review['openFindings']
ash=review['artifact']['sha256'];assert sha(review['artifact']['path'])==ash
assert sha(S/'frozen-source.json')==review['freeze']['sha256']
for file,h in {**freeze['files'],**freeze['avatarAssets']}.items():assert sha(ROOT/file)==h,file
oldruns={r['id']:r for r in read(ROOT/'artifacts/rc12/report/final-config.json')['runs']}
runs=[];extra=[];pending=[]
def evidence(p):
    p=Path(p);p=p if p.is_absolute()else ROOT/p
    if p.is_file():extra.append(str(p.relative_to(ROOT)))
def manifest(p):
    p=Path(p)
    if not p.exists():pending.append(str(p.relative_to(ROOT)));return None
    evidence(p);return read(p)
def add(rid,title,mode,file,meta=None,scope=None):
    meta=meta or {};f=ROOT/file
    if not f.exists():pending.append(file);return
    assert not any(r['id']==rid for r in runs),rid
    runs.append(dict(id=rid,title=title,scope=scope or('冻结源码 Linux Electron'if mode=='source'else'最终ASAR Linux Electron'),bindingScope='source'if mode=='source'else'package',file=file,frozenEvidence=True,startedAt=meta.get('startedAt'),completedAt=meta.get('completedAt')or meta.get('finishedAt'),provenance=meta.get('provenance','RC13最终冻结运行清单')))
def validate_m(m):
    if 'sourceUnchanged'in m:assert m['sourceUnchanged']
    h=m.get('sourceAtStart')or m.get('sourceFiles')or{}
    for f,v in h.items():assert freeze['files'][f if f.startswith('src/')else'src/'+f]==v,f
    for key in ('asarSha256','archiveSha256'):
        if m.get(key):assert m[key]==ash
def title(rid,fallback):return oldruns.get(rid,{}).get('title',fallback)
alias={'primary':'known-flows','care':'pet-care','switch':'pet-switch','petextra':'pet-extra'}
paths={'ui':'qa/qa-electron-results.json','pets':'qa-pets/qa-pets-results.json','catalog':'qa-catalog/source/qa-catalog-results.json','primary':'parity/known-flows-results.json','migration':'qa-pet-care-independent/results.json','wheels':'qa-wheels/results.json','groups':'qa-group-tools/results.json','classroom':'qa-classroom-tools-native/results.json','switch':'qa-pet-switch/source/results.json','narrow':'qa-classroom-tools-240/results.json','organization':'qa-organization/results.json','toolbox':'qa-toolbox-extra-native/results.json','navigation':'rc9/navigation-source/results.json','palette':'rc9/tool-palette-source-run.json','focus':'rc9/focus-contrast-source-run.json','lifecycle':'qa-adventure-lifecycle/source/results.json','lazy-excel':'rc9/lazy-excel/results.json','lock-layout':'rc9/lock-dialog-source/results.json','modal-headers':'rc9/modal-inventory-source-results.json','window-exits':'rc9/window-exits-source-results.json','adversarial':'rc9/adversarial/results.json','window-readonly':'rc9/window-readonly-source-results.json'}
src=manifest(S/('source-final-runs.json'if(S/'source-final-runs.json').exists()else'source-runs.json'))
if src:
    if len(src)!=26:pending.append('source suite count != 26')
    for r in src:
        if r['exitCode']!=0:pending.append('source:'+r['suite']);continue
        name=r['suite'];rid='source-'+alias.get(name,name)
        f=r.get('mergedEvidence')or r.get('retestEvidence')
        if not f:f='artifacts/rc13/source-unit.log'if name=='unit'else'artifacts/rc13/frozen-'+name+'-results.json'if name in('care','lock','petextra')else'artifacts/rc13/source-evidence/'+paths[name]
        add(rid,title(rid,name),'source',f,r,scope='冻结源码 Node测试（含预览HTTP）'if name=='unit'else None)
pkg=manifest(S/('packaged-final-runs.json'if(S/'packaged-final-runs.json').exists()else'packaged-runs.json'))
if pkg:
    assert pkg['asarSha256']==ash
    if len(pkg['results'])!=24:pending.append('package suite count != 24')
    packagepaths=read(ROOT/'artifacts/rc10/recovery/package-paths.json')
    for r in pkg['results']:
        if r['exitCode']!=0:pending.append('packaged:'+r['suite']);continue
        rid='packaged-'+r['suite'];original=r.get('mergedEvidence')or r.get('retestEvidence')or packagepaths[r['suite']]
        f=ROOT/original
        if f.exists():
            target=D/'bound-evidence'/(rid+'.json');target.parent.mkdir(exist_ok=True);shutil.copy2(f,target);add(rid,title(rid,r['suite']),'packaged',str(target.relative_to(ROOT)),r)
        else:pending.append(original)
for mode in('source','packaged'):
    for kind in('legacy','new'):
        directory=S/f'{kind}-targeted-{mode}';m=manifest(directory/'runs.json')
        if not m:continue
        validate_m(m)
        for r in m['suites']:
            if r['exitCode']!=0:pending.append(mode+'-'+kind+'-'+r['suite']);continue
            assert r.get('scriptUnchanged',True)
            if kind=='legacy':files=[r['result']]
            elif r['suite']in('transactions','startup-restore','missed-restore-notice'):
                run=read(ROOT/r['evidenceDirectory']/'run.json');assert all(x['status']==0 for x in run['runs']);files=[r['evidenceDirectory']+'/'+x['phase']+'.json'for x in run['runs']]
            elif r['suite']=='queued-restore':files=[r['evidenceDirectory']+'/results.json',r['evidenceDirectory']+'/restart.json']
            else:files=[r['evidenceDirectory']+'/results.json']
            for f in files:add(mode+'-'+kind+'-'+r['suite']+'-'+Path(f).name,('既有RC9边界 / 'if kind=='legacy'else'既有RC10边界 / ')+r['suite'],mode,f,r)
    for family in('features','extension'):
        directory=S/f'{family}-{mode}';mp=directory/'final-runs.json'if(directory/'final-runs.json').exists()else directory/'runs.json';m=manifest(mp)
        if not m:continue
        validate_m(m)
        for r in m['suites']:
            if r['exitCode']!=0:pending.append(mode+'-'+family+'-'+r['suite']);continue
            f=r.get('retestEvidence')or r.get('mergedEvidence')or r['evidenceDirectory']+('/flows.json'if r['suite']=='target-confirmations'else'/results.json')
            name={'egg':'eggs'}.get(r['suite'],r['suite']);rid=mode+'-'+(name if family=='features'else'extension-'+name)
            add(rid,title(rid,family+' / '+name),mode,f,r)
            for tail in ('restart-result.json','restart.json'):
                # Other feature/import results already embed their restart checks.
                if r['suite']!='egg-comprehensive' or tail!='restart-result.json':continue
                rp=ROOT/r['evidenceDirectory']/tail
                if rp.exists():add(rid+'-'+tail,'真实新进程重启 / '+name,mode,str(rp.relative_to(ROOT)),r)
            if r['suite']=='target-confirmations':
                rp=ROOT/r['evidenceDirectory']/'run.json'
                if rp.exists():add(rid+'-restarts','目标确认独立重启',mode,str(rp.relative_to(ROOT)),r)

for mode,cn in [('source','source-frozen-final'),('packaged','packaged-final')]:
    base='artifacts/rc12-independent-20261005/'
    for name in('confirmations','feedback-navigation'):
        directory=base+name+'/'+cn
        main='flows.json'if name=='confirmations'else'results.json'
        prov=ROOT/directory/'process-and-provenance.json';pr=read(prov).get('processes',[])if prov.exists()else[]
        add(mode+'-independent-'+name,'独立原始矩阵 / '+name,mode,directory+'/'+main,pr[0]if pr else None)
        add(mode+'-independent-'+name+'-restart','独立真实重启 / '+name,mode,directory+('/run.json'if name=='confirmations'else'/restart.json'),pr[1]if len(pr)>1 else None)
        for f in ('process-and-provenance.json','freeze-before-run.json','freeze-after-run.json'):evidence(directory+'/'+f)
    for name in [cn,'exact-source-frozen'if mode=='source'else'exact-packaged']:
        directory=base+'roster-roundtrips/'+name
        summary=ROOT/base/'roster-roundtrips/frozen-final-summary.json';meta=next((r for r in read(summary)['runs']if r['name']==name),{})if summary.exists()else{}
        add(mode+'-roster-'+name,'独立名单及原样夹具 / '+name,mode,directory+'/results.json',meta)
        for f in('freeze-before-run.json','freeze-after-run.json'):evidence(directory+'/'+f)
    directory='artifacts/rc13-independent-review/'+('source-5-final'if mode=='source'else'final-asar')
    add(mode+'-independent-repair','新复核25项修复矩阵',mode,directory+'/results.json')
    add(mode+'-independent-repair-restart','新复核真实新进程重启',mode,directory+'/restart.json')
for rid,title_,mode,f,scope in [('package-node-model','包内精确提取模块Node模型','packaged','artifacts/rc13/package-unit/run.log','最终ASAR提取 Node测试'),('packaged-startup','启动路径与普通锁状态','packaged','artifacts/rc13/startup-identity/results.json','最终ASAR 启动专项'),('source-preview','源码预览资源及生命周期','source','artifacts/rc13/ui-review/preview/results.json','冻结源码 预览资源')]:add(rid,title_,mode,f,scope=scope)
for f in ['artifacts/rc13/frozen-source.json','artifacts/rc13-independent-review/FINAL-REVIEW.json','artifacts/rc13-independent-review/package-provenance.json','artifacts/rc12-independent-20261005/confirmations/final-summary.json','artifacts/rc12-independent-20261005/roster-roundtrips/frozen-final-summary.json','artifacts/rc13/package-unit/results.json','artifacts/rc13/package/portable-verification.json','artifacts/rc13/package/folder7z-verification.json','artifacts/rc13/package/zip-verification.json','artifacts/rc13/package/pe-verification.json']:evidence(f)
if a.release_manifest:evidence(a.release_manifest)
if a.final:
    assert a.release_manifest and (ROOT/a.release_manifest).is_file(),'Explicit release lead manifest required'
    assert not pending,pending
files=[]
release=read(ROOT/a.release_manifest)if a.release_manifest else None
if release:
    assert release['sourceAndPackageSame']and release['archiveVerificationPassed']
    assert release['asarSha256']==ash and release['releaseGate']['fullFinalSourceAndAsarRegression']
    for f in release['files']:
        file=Path(f['path']);assert file.is_file()and sha(file)==f['sha256'],file
        files.append(dict(name=f['fileName'],bytes=f['sizeBytes'],sha256=f['sha256']))
else:
    for file in sorted((ROOT/'dist-rc13-final').glob('FlowerClassroom*')):
        if file.is_file():files.append(dict(name=file.name,bytes=file.stat().st_size,sha256=sha(file)))
source_sha=hashlib.sha256(json.dumps(dict(sorted(freeze['files'].items())),separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
if release:assert release['sourceTreeSha256']==source_sha
qa=[]
extraqa=D/'additional-qa-notes.json'
if extraqa.exists():qa=read(extraqa)
cfg=dict(finalized=a.final,source=dict(at=freeze['frozenAt'],sha256=source_sha,files=freeze['files'],avatarAssets=freeze['avatarAssets']),package=dict(asarSha256=ash,files=files),runs=runs,evidenceFiles=list(dict.fromkeys(extra)),qaNotes=qa,pendingEvidence=pending,releaseGate='最终冻结源码及精确ASAR的对应回归完成；RC12基线10类问题及RC13修复过程3类问题均已修复并复验。155项功能逐项核对，7项Windows效果及此前中止专项仍未验证。'if a.final else'制作预览：仅已完成并绑定本次冻结的运行进入最终证据区；发布总门槛尚未授权关闭，不能作为交付结论。')
dest=D/('final-config.json'if a.final else'working-config.json');dest.write_text(json.dumps(cfg,ensure_ascii=False,indent=2))
print(json.dumps({'file':str(dest.relative_to(ROOT)),'runs':len(runs),'pending':pending,'finalized':a.final},ensure_ascii=False))
