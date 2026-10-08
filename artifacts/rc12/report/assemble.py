"""Index only the current frozen RC12 evidence. Finalization needs the release lead's gate."""
import json,hashlib,sys,shutil,datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];D=Path(__file__).resolve().parent;S=ROOT/'artifacts/rc12'
final='--final'in sys.argv
read=lambda p:json.loads(Path(p).read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
freeze=read(S/'frozen-source.json');review=read(S/'independent-review/FINAL-REVIEW.json')
ash=review['archiveSha256'];assert sha(review['archive'])==ash
assert review['status']=='passed'and not review['openFindings']
for file,h in {**freeze['files'],**freeze['avatarAssets']}.items():assert sha(ROOT/file)==h,file
source_sha=hashlib.sha256(json.dumps(dict(sorted(freeze['files'].items())),separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
oldruns={r['id']:r for r in read(ROOT/'artifacts/rc11/report/final-config.json')['runs']}
alias={'primary':'known-flows','care':'pet-care','switch':'pet-switch','petextra':'pet-extra'}
source_paths={'ui':'qa/qa-electron-results.json','pets':'qa-pets/qa-pets-results.json','catalog':'qa-catalog/source/qa-catalog-results.json','primary':'parity/known-flows-results.json','migration':'qa-pet-care-independent/results.json','wheels':'qa-wheels/results.json','groups':'qa-group-tools/results.json','classroom':'qa-classroom-tools-native/results.json','switch':'qa-pet-switch/source/results.json','narrow':'qa-classroom-tools-240/results.json','organization':'qa-organization/results.json','toolbox':'qa-toolbox-extra-native/results.json','navigation':'rc9/navigation-source/results.json','palette':'rc9/tool-palette-source-run.json','focus':'rc9/focus-contrast-source-run.json','lifecycle':'qa-adventure-lifecycle/source/results.json','lazy-excel':'rc9/lazy-excel/results.json','lock-layout':'rc9/lock-dialog-source/results.json','modal-headers':'rc9/modal-inventory-source-results.json','window-exits':'rc9/window-exits-source-results.json','adversarial':'rc9/adversarial/results.json','window-readonly':'rc9/window-readonly-source-results.json'}
package_paths=read(ROOT/'artifacts/rc10/recovery/package-paths.json')
runs=[];extra=[];pending=[]
def required(p):
    p=Path(p)
    if p.exists():return True
    pending.append(str(p.relative_to(ROOT)));return False
def evidence(p):
    p=Path(p)
    if p.exists():extra.append(str(p.relative_to(ROOT)))
def add(id,title,scope,file,meta=None,binding=None):
    meta=meta or {};file=str(file);p=ROOT/file
    if not required(p):return
    if id=='source-tools-independent':
        raw=read(p)
        if raw.get('initialSourceHashes',{}).get('app.js')!=freeze['files']['src/app.js']:
            pending.append(file+'：不是最终app.js冻结哈希');return
    if any(r['id']==id for r in runs):raise ValueError('Duplicate run '+id)
    runs.append(dict(id=id,title=title,scope=scope,file=file,frozenEvidence=True,bindingScope=binding,
        startedAt=None if meta.get('initialAttempt')else meta.get('startedAt'),completedAt=meta.get('completedAt'),
        timingNote='完整复测起始时间未单独记录；初轮起始不冒作复测起始'if meta.get('initialAttempt')else'',
        provenance=meta.get('provenance','最终冻结清单与本轮运行清单'),initialAttempt=meta.get('initialAttempt')))
def primary_manifest(p):
    if required(p):evidence(p);return read(p)
    return None
src=primary_manifest(S/'source-final-runs.json')
assert src and len(src)==26 and all(r['exitCode']==0 for r in src)
evidence(S/'source-runs.json')
for r in src:
    name=r['suite'];rid='source-'+alias.get(name,name)
    if name=='unit':file='artifacts/rc12/source-unit.log';scope='冻结源码 Node模型'
    elif name in('care','lock','petextra'):file='artifacts/rc12/frozen-'+name+'-results.json';scope='冻结源码 Linux Electron'
    else:file='artifacts/rc12/source-evidence/'+source_paths[name];scope='冻结源码 Linux Electron'
    add(rid,oldruns[rid]['title'],scope,file,r,'source')
pkg=primary_manifest(S/'packaged-final-runs.json'if(S/'packaged-final-runs.json').exists()else S/'packaged-runs.json')
if pkg:
    assert pkg['asarSha256']==ash
    if final:assert len(pkg['results'])==24 and all(r['exitCode']==0 for r in pkg['results'])
    for r in pkg['results']:
        if r['exitCode']!=0:pending.append('packaged:'+r['suite']);continue
        rid='packaged-'+r['suite'];file=r.get('mergedEvidence')or r.get('retestEvidence')or package_paths[r['suite']]
        snap=D/'bound-evidence'/(rid+'.json');snap.parent.mkdir(exist_ok=True)
        shutil.copy2(ROOT/file,snap)
        add(rid,oldruns[rid]['title'],'最终ASAR Linux Electron',str(snap.relative_to(ROOT)),r,'package')
for mode in('source','packaged'):
    for kind in('legacy','new'):
        directory=S/f'{kind}-targeted-{mode}';m=primary_manifest(directory/'runs.json')
        if not m:continue
        assert m['sourceUnchanged']
        if mode=='packaged':assert m['archiveSha256']==ash
        for f,h in m['sourceAtStart'].items():assert freeze['files'][f]==h
        for r in m['suites']:
            if r['exitCode']!=0:pending.append(mode+'-'+kind+'-'+r['suite']);continue
            assert r['scriptUnchanged']
            if kind=='legacy':files=[r['result']]
            elif r['suite']in('transactions','startup-restore','missed-restore-notice'):
                run=read(ROOT/r['evidenceDirectory']/'run.json');assert all(x['status']==0 for x in run['runs']);files=[r['evidenceDirectory']+'/'+x['phase']+'.json'for x in run['runs']]
            elif r['suite']=='queued-restore':files=[r['evidenceDirectory']+'/results.json',r['evidenceDirectory']+'/restart.json']
            else:files=[r['evidenceDirectory']+'/results.json']
            for f in files:add(mode+'-'+kind+'-'+r['suite']+'-'+Path(f).name,('RC9边界 / 'if kind=='legacy'else'RC10边界 / ')+r['suite'],'冻结源码 Linux Electron'if mode=='source'else'最终ASAR Linux Electron',f,r,'source'if mode=='source'else'package')
for mode in('source','packaged'):
    directory=S/f'features-{mode}';p=directory/'final-runs.json'if(directory/'final-runs.json').exists()else directory/'runs-final.json'if(directory/'runs-final.json').exists()else directory/'runs.json';m=primary_manifest(p)
    if not m:continue
    assert m['sourceUnchanged']
    if mode=='packaged':assert m['asarSha256']==ash
    for f,h in m['sourceFiles'].items():assert freeze['files']['src/'+f]==h
    for r in m['suites']:
        if r['exitCode']!=0:pending.append(mode+'-feature-'+r['suite']);continue
        f=r.get('retestEvidence')or r.get('mergedEvidence')or r['evidenceDirectory']+'/results.json'
        name={'egg':'eggs','avatars':'avatars','avatar-import':'avatar-import'}.get(r['suite'],r['suite'])
        add(mode+'-'+name,'RC11/RC12功能专项 / '+r['suite'],'冻结源码 Linux Electron'if mode=='source'else'最终ASAR Linux Electron',f,r,'source'if mode=='source'else'package')
        restart=ROOT/r['evidenceDirectory']/'restart-result.json'
        if r['suite']=='egg-comprehensive'and restart.exists():add(mode+'-egg-comprehensive-restart','成长综合专项新进程重启','冻结源码 Linux Electron'if mode=='source'else'最终ASAR Linux Electron',str(restart.relative_to(ROOT)),r,'source'if mode=='source'else'package')
if not any(r['id']=='packaged-keyboard'for r in runs):
    p=S/'features-packaged/keyboard-close-retest/results.json'
    if p.exists():
        raw=read(p);assert raw['completed']is True and raw['sourceChanged']is False
        assert len(raw['checks'])==27 and all(c['status']=='passed'for c in raw['checks'])
        add('packaged-keyboard','键盘连续操作完整专项','最终ASAR Linux Electron',str(p.relative_to(ROOT)),{'provenance':'final-test-manifest.features.packaged中的keyboard-close-retest完整27条；原features-packaged/final-runs仅六组'},'package')
    else:pending.append('packaged-keyboard完整27场景结果')
items=[
 ('package-node-model','最终包精确提取模块','最终ASAR提取 Node模型','artifacts/rc12/package-unit/run.log','package'),
 ('packaged-startup','路径及普通锁状态启动专项','最终ASAR 启动专项','artifacts/rc12/startup-identity/results.json','package'),
 ('source-preview','源码预览资源与生命周期','冻结源码 预览资源','artifacts/rc12/ui-review/preview/results.json','source'),
 ('independent-source','本轮独立综合修复复验','冻结源码 Linux Electron','artifacts/rc12/independent-review/source-repaired-final/results.json','source'),
 ('independent-asar','本轮独立综合修复复验','最终ASAR Linux Electron','artifacts/rc12/independent-review/packaged-final/results.json','package'),
 ('source-tools-independent','独立工具/恢复/键盘33场景','冻结源码 Linux Electron','artifacts/comprehensive-rc11-20261005/tools-audit/source-frozen33/results.json','source'),
 ('packaged-tools-independent','独立工具/恢复/键盘33场景','最终ASAR Linux Electron','artifacts/comprehensive-rc11-20261005/tools-audit/packaged-rc12-final33/results.json','package'),
 ('packaged-import-independent','独立导入功能/观察/重启','最终ASAR Linux Electron','artifacts/comprehensive-rc11-20261005/import-audit/packaged-rc12-final/results.json','package'),
 ('source-import-independent','独立导入功能/观察/重启','冻结源码 Linux Electron','artifacts/comprehensive-rc11-20261005/import-audit/source-frozen-final/results.json','source'),
 ('packaged-import-format','独立原10项文本格式回归','最终ASAR Linux Electron','artifacts/comprehensive-rc11-20261005/import-audit/format-packaged-rc12-final/results.json','package'),
 ('packaged-import-controls','独立16项扩展文本对照','最终ASAR Linux Electron','artifacts/comprehensive-rc11-20261005/import-audit/text-packaged-rc12-final/results.json','package')]
for name,title in [('format-source-frozen','最终源码原10项文本格式回归'),('text-source-frozen','最终源码16项扩展文本对照')]:
    f='artifacts/comprehensive-rc11-20261005/import-audit/'+name+'/results.json'
    items.append(('source-import-'+name,title,'冻结源码 Linux Electron',f,'source'))
for rid,title,scope,f,binding in items:
    meta=read(S/'package-unit/results.json')if rid=='package-node-model'else{}
    add(rid,title,scope,f,meta,binding)
    evidence((ROOT/f).parent/'provenance.json')
overrides=read(D/'additional-final-runs.json')if(D/'additional-final-runs.json').exists()else[]
for r in overrides:add(r['id'],r['title'],r['scope'],r['file'],r,r.get('bindingScope'))
for file in ['frozen-source.json','independent-review/FINAL-REVIEW.json','package-unit/results.json','package/portable-verification.json','package/folder7z-verification.json','package/zip-verification.json','package/pe-verification.json','final-test-manifest.json','KEYBOARD-REPAIR.md','KEYBOARD-HARNESS-CLOSE-REVIEW.md','harness-history/package-unit-test-dependency/results.json','harness-history/package-unit-test-dependency/NOTE.txt','harness-history/petextra-feedback-before/frozen-petextra-results.json','harness-history/petextra-selector-iteration/frozen-petextra-results.json']:
    evidence(S/file)
for file in ['artifacts/comprehensive-rc11-20261005/tools-audit/packaged-rc12-final33/verification-summary.json','artifacts/comprehensive-rc11-20261005/tools-audit/source-frozen33/verification-summary.json','artifacts/comprehensive-rc11-20261005/tools-audit/source-frozen33/manifest-before.json','artifacts/comprehensive-rc11-20261005/tools-audit/source-frozen33/manifest-after.json','artifacts/comprehensive-rc11-20261005/import-audit/packaged-rc12-summary.json']:evidence(ROOT/file)
proof={}
for rid,needles in {'V035':['transparent: true',"setAlwaysOnTop(true, 'screen-saver')"],'V038':["role === 'panel'","role === 'sidebar'","setAlwaysOnTop(true, 'screen-saver')"]}.items():
    lines=(ROOT/'src/main.cjs').read_text().splitlines();found=[]
    for needle in needles:
        matches=[(i+1,line.strip())for i,line in enumerate(lines)if needle in line];assert matches,needle
        found.append('src/main.cjs:'+str(matches[0][0])+'\n'+matches[0][1])
    proof[rid]='\n'.join(found)+'\n仅证明源码窗口配置提供，不证明Windows/PPT现场效果'
files=[]
for p in [ROOT/'dist-rc12-final/FlowerClassroom-1.3.0-rc.12-portable.exe',ROOT/'dist-rc12-final/FlowerClassroom-1.3.0-rc.12-x64.zip',ROOT.parents[1]/'flower-rc12-deliverables/FlowerClassroom-1.3.0-rc.12-folder.7z']:
    if p.exists():files.append(dict(name=p.name,bytes=p.stat().st_size,sha256=sha(p)))
qa=[{'id':'Q06','title':'冻结后图鉴及宠物附加测试适配','actual':'原源码26组首轮为24组成功、catalog与petextra两组失败。图鉴旧脚本期望旧“40位”标题，改为新标题并检查40条升级行；附加脚本先通过可见关闭按钮关闭持续反馈再下一步。首次适配误用active类的中间轮保留。最终catalog29/29、petextra14/14完整复跑；生产源码未改。','evidence':'artifacts/rc12/source-runs.json\nartifacts/rc12/source-final-runs.json\nartifacts/rc12/harness-history/'},
 {'id':'Q07','title':'提取包Node测试夹具依赖补齐','actual':'首次提取包测试缺少仅测试使用的xmldom依赖。保留该次运行与说明后补齐测试依赖；同一ASAR提取的52个源码文件通过461/461 Node检查。不把测试依赖问题当作应用运行缺陷。','evidence':'artifacts/rc12/harness-history/package-unit-test-dependency/\nartifacts/rc12/package-unit/results.json'}]
qa.extend([
 {'id':'Q08','title':'键盘专项等待已销毁渲染器导致未完成','actual':'冻结源码首轮完成23场景后，已保存计时器键盘截图及断言，但测试仍await关闭中的timer renderer执行承诺，进程超时。改用真实Return按钮并在测试进程等待窗口销毁，增加completed标记及超时失败记录；同一源码和ASAR各27/27完整通过，原始未完成轮保留。','evidence':'artifacts/rc12/KEYBOARD-HARNESS-CLOSE-REVIEW.md\nartifacts/rc12/features-source/keyboard/results.json\nartifacts/rc12/features-source/keyboard-close-retest/results.json\nartifacts/rc12/features-packaged/keyboard-close-retest/results.json'},
 {'id':'Q09','title':'头像包侧短窗测试读取未建立节点','actual':'旧测试在短窗缩放重绘期间读取尚不存在节点的disabled。增加布局稳定及节点存在等待后再真实点击，原26个场景完整重跑26/26通过、无renderer错误；没有修改生产源码或ASAR，原失败保留。','evidence':'artifacts/rc12/features-packaged/runs.json\nartifacts/rc12/features-packaged/avatar-comprehensive/results.json\nartifacts/rc12/features-packaged/avatar-comprehensive-retest/results.json'}])
if final:
    assert not pending,pending
    assert(S/'final-test-manifest.json').is_file(),'Release lead final manifest missing'
cfg=dict(finalized=final,source=dict(at=freeze['frozenAt'],sha256=source_sha,files=freeze['files'],avatarAssets=freeze['avatarAssets']),package=dict(asarSha256=ash,files=files),runs=runs,implementationProof=proof,evidenceFiles=list(dict.fromkeys(extra)),qaNotes=qa,pendingEvidence=pending,releaseGate='最终冻结源码、最终ASAR的对应模型与Linux Electron检查及独立复核均完成。RC11基线10类问题和RC12独立复核新增1类问题已修复并复验。7项Windows效果及此前中止的专项仍未验证。'if final else'制作预览：最终源码与ASAR已冻结，完整运行门槛尚待完成；不作最终交付结论。')
dest=D/('final-config.json'if final else'working-config.json');dest.write_text(json.dumps(cfg,ensure_ascii=False,indent=2))
print(json.dumps({'config':str(dest.relative_to(ROOT)),'finalized':final,'runs':len(runs),'pending':pending,'asarSha256':ash,'sourceSha256':source_sha},ensure_ascii=False))
