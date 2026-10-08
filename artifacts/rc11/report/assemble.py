"""Bind current result manifests without copying historical passes."""
import json,hashlib,sys,shutil,re,datetime
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3];D=Path(__file__).resolve().parent;S=ROOT/'artifacts/rc11';partial='--partial'in sys.argv
def read(p):return json.loads(Path(p).read_text())
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
freeze=read(S/'frozen-source.json');identity=read(S/'asar-identity.json');ash=identity['sha256']
source_sha=hashlib.sha256(json.dumps(dict(sorted(freeze['files'].items())),separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
for file,digest in {**freeze['files'],**freeze['avatarAssets']}.items():assert sha(ROOT/file)==digest,file
assert sha(ROOT/identity['asar'])==ash
old=read(ROOT/'artifacts/rc10/report/final-config.json')
oldruns={r['id']:r for r in old['runs']}
alias={'primary':'known-flows','care':'pet-care','switch':'pet-switch','petextra':'pet-extra'}
source_paths={
'ui':'qa/qa-electron-results.json','pets':'qa-pets/qa-pets-results.json','catalog':'qa-catalog/source/qa-catalog-results.json','primary':'parity/known-flows-results.json','migration':'qa-pet-care-independent/results.json','wheels':'qa-wheels/results.json','groups':'qa-group-tools/results.json','classroom':'qa-classroom-tools-native/results.json','switch':'qa-pet-switch/source/results.json','narrow':'qa-classroom-tools-240/results.json','organization':'qa-organization/results.json','toolbox':'qa-toolbox-extra-native/results.json','navigation':'rc9/navigation-source/results.json','palette':'rc9/tool-palette-source-run.json','focus':'rc9/focus-contrast-source-run.json','lifecycle':'qa-adventure-lifecycle/source/results.json','lazy-excel':'rc9/lazy-excel/results.json','lock-layout':'rc9/lock-dialog-source/results.json','modal-headers':'rc9/modal-inventory-source-results.json','window-exits':'rc9/window-exits-source-results.json','adversarial':'rc9/adversarial/results.json','window-readonly':'rc9/window-readonly-source-results.json'}
package_paths=read(ROOT/'artifacts/rc10/recovery/package-paths.json')
runs=[];extra=['artifacts/rc11/frozen-source.json','artifacts/rc11/asar-identity.json','artifacts/rc11/source-runs.json','artifacts/rc11/source-runs-initial-final-freeze.json','artifacts/rc11/independent-review/FINAL-REVIEW.json','artifacts/rc11/avatars-packaged/package-provenance.json','artifacts/rc11/package-unit/results.json']
def add(id,title,scope,file,meta=None):
    meta=meta or {};p=ROOT/file;assert p.exists(),file
    runs.append(dict(id=id,title=title,scope=scope,file=file,frozenEvidence=True,
        startedAt=None if meta.get('initialAttempt') else meta.get('startedAt'),
        completedAt=None if meta.get('initialAttempt') else meta.get('completedAt'),
        timingNote=('复测精确起止未单独记录；调和时间 '+meta.get('reconciledAt','')) if meta.get('initialAttempt') else '',
        provenance=meta.get('provenance','运行清单及当前冻结身份')))
src=read(S/'source-runs.json');assert len(src)==26 and all(r['exitCode']==0 for r in src)
for r in src:
    name=r['suite'];id='source-'+alias.get(name,name)
    if name=='unit':file='artifacts/rc11/source-unit.log'
    elif name in ('care','lock','petextra'):file='artifacts/rc11/frozen-'+name+'-results.json'
    else:file='artifacts/rc11/source-evidence/'+source_paths[name]
    if r.get('retestEvidenceSha256'):assert sha(ROOT/file)==r['retestEvidenceSha256'],name
    add(id,oldruns[id]['title']+('（Node模型）'if name=='unit'else ''),'冻结源码',file,r)
package_manifest=S/'packaged-runs.json'
if package_manifest.exists():
    pkg=read(package_manifest);assert pkg['asarSha256']==ash
    if not partial:assert len(pkg['results'])==24 and all(r['exitCode']==0 for r in pkg['results'])
    extra.append('artifacts/rc11/packaged-runs.json')
    for r in pkg['results']:
        if r['exitCode']!=0:continue
        id='packaged-'+r['suite'];file=r.get('mergedEvidence') or r.get('retestEvidence') or package_paths[r['suite']]
        snap=D/'bound-evidence'/(id+'.json');snap.parent.mkdir(exist_ok=True);shutil.copy2(ROOT/file,snap)
        add(id,oldruns[id]['title'],'最终ASAR',str(snap.relative_to(ROOT)),r)
elif not partial:raise RuntimeError('Packaged suite manifest is pending')
for mode in ('source','packaged'):
    for kind in ('legacy','new'):
        directory=S/f'{kind}-targeted-{mode}';m=read(directory/'runs.json');assert m['sourceUnchanged'] and all(r['exitCode']==0 and r['scriptUnchanged']for r in m['suites'])
        if mode=='packaged':assert m['archiveSha256']==ash
        for file,digest in m['sourceAtStart'].items():assert freeze['files'][file]==digest
        extra.append(str((directory/'runs.json').relative_to(ROOT)))
        for r in m['suites']:
            if kind=='legacy':files=[r['result']]
            elif r['suite']in ('transactions','startup-restore','missed-restore-notice'):
                run=read(ROOT/r['evidenceDirectory']/'run.json');assert all(x['status']==0 for x in run['runs']);files=[r['evidenceDirectory']+'/'+x['phase']+'.json'for x in run['runs']]
            elif r['suite']=='queued-restore':files=[r['evidenceDirectory']+'/results.json',r['evidenceDirectory']+'/restart.json']
            else:files=[r['evidenceDirectory']+'/results.json']
            for file in files:add(mode+'-'+kind+'-'+r['suite']+'-'+Path(file).name,('RC9边界 / 'if kind=='legacy'else 'RC10边界 / ')+r['suite'],'冻结源码'if mode=='source'else '最终ASAR',file,r)
for id,title,scope,file in [
 ('source-eggs','RC11宠物蛋界面','冻结源码','artifacts/rc11/egg-source-final/results.json'),
 ('packaged-eggs','RC11宠物蛋界面','最终ASAR','artifacts/rc11/egg-packaged/results.json'),
 ('source-avatars','RC11头像交互','冻结源码','artifacts/rc11/avatars-source/results.json'),
 ('packaged-avatars','RC11头像交互','最终ASAR','artifacts/rc11/avatars-packaged/results.json'),
 ('source-avatar-import','RC11名单头像导入','冻结源码','artifacts/rc11/avatar-import-source-final/results.json'),
 ('packaged-avatar-import','RC11名单头像导入','最终ASAR','artifacts/rc11/avatar-import-packaged/results.json'),
 ('package-node-model','最终包提取模块（Node模型）','包内Node模型','artifacts/rc11/package-unit/run.log'),
 ('packaged-startup','启动路径与锁状态','启动专项','artifacts/rc11/startup-identity/results.json'),
 ('source-preview','源码预览资源与生命周期','源码预览','artifacts/rc11/ui-review/preview/results.json'),
 ('independent-model','独立RC10差异与模型复核','独立复验','artifacts/rc11/independent-review/model-results.json'),
 ('independent-source','独立源码生命周期复核','独立复验','artifacts/rc11/independent-review/runtime-results.json'),
 ('independent-asar','独立最终ASAR生命周期复核','独立复验','artifacts/rc11/independent-review/packaged-runtime-results.json'),
 ('independent-focused','独立既有焦点/模型检查','独立复验','artifacts/rc11/independent-review/focused-tests.tap')]:
    p=ROOT/file
    if not p.exists():
        if partial:continue
        raise RuntimeError('Required final evidence missing: '+file)
    meta=read(S/'package-unit/results.json') if id=='package-node-model' else {}
    add(id,title,scope,file,meta)
for p in [S/'avatar-import-source-final/tested-source-hashes.json',S/'package/portable-verification.json',S/'package/folder7z-verification.json',S/'package/pe-verification.json']:
    if p.exists():extra.append(str(p.relative_to(ROOT)))
defects=read(D/'defects-draft.json')
for x in defects:
    if x['id'].startswith('D'):
        x['status']='已修复并复验';x['retest']='最终冻结源码与最终包对应专项通过；独立复核未留下相关普通语义缺陷'
        after='artifacts/rc11/avatars-source/results.json\nartifacts/rc11/avatars-packaged/results.json'if x['id']in ('D001','D002','D003','D004','D008')else 'artifacts/rc11/independent-review/runtime-results.json\nartifacts/rc11/independent-review/packaged-runtime-results.json'
        x['evidence']='修前：'+('开发观察记录；未单独保留原始失败日志'if x['id']=='D008'else x['evidence'])+'\n复验：'+after
    elif x['id'].startswith('H'):
        x['status']='脚本已纠正';x['retest']='最终26套源码及对应专项重新通过；不计产品缺陷'
    else:x['retest']='19:27:12 UTC重新冻结后完成重新执行，19:22候选不计最终通过'
    x['version']='RC11开发候选 → 1.3.0-rc.11最终冻结'
defects.append(dict(id='H003',type='仅测试预期/时序',title='最终冻结后3套继承测试适配',before='图鉴异步动画尚未稳定就取值；Excel预览仍断言旧原始列对象；跨板旧预览取消后仍等待旧提示。原失败保留。',fix='等待稳定造型；按已规范化name/group/photo字段核对；核对取消不改资料及不打开旧确认。生产源码未再修改。',retest='catalog、lazy-excel、adversarial在同一最终源码上复测通过，source-runs保留initialAttempt及retestEvidence。',status='脚本已纠正',version='同一19:27最终冻结',evidence='artifacts/rc11/source-runs.json\nartifacts/rc11/source-runs-initial-final-freeze.json'))
defects.append(dict(id='H004',type='仅测试流程',title='旧事务/导入脚本未关闭新破壳反馈',before='首次正成长产生新破壳弹层，旧脚本随即触发后续事务/导入确认，遇到前景弹层而失败。',fix='通过可见关闭/Escape先关闭新反馈，再执行原有边界场景。',retest='RC9边界157及RC10边界101在冻结源码与最终ASAR两侧通过。',status='脚本已纠正',version='同一19:27最终冻结',evidence='artifacts/rc11/source-final-retests/imports-before-hatch-dismiss/results.json\nartifacts/rc11/source-final-retests/transactions-before-hatch-dismiss/flows.json\nartifacts/rc11/legacy-targeted-source/runs.json\nartifacts/rc11/new-targeted-source/runs.json'))
defects.append(dict(id='H005',type='仅测试等待条件',title='共享弹层跨轮复验合并',before='首轮315/317；头像异步加载改变scrollHeight，50ms自动焦点与点击测量重叠。第二轮新增“焦点必须在dialog”的过严等待使8项重绘超时，结果309/317；原两项此轮已通过。',fix='生产源码/ASAR不变。等待稳定头像布局，并改成有上限的焦点settle；对受影响交互按缩放/角色重复开关、键盘及庆祝弹层定向复验。',retest='317个检查按完整原轮与定向复验逐项调和，不声称存在某一单轮317全绿；各轮及等待条件变更均保留。',status='跨轮复验通过'if not partial else '待定向复验',version='同一最终ASAR',evidence='artifacts/rc11/packaged-runs.json\nartifacts/rc11/package-modal-retest/'))
extra+=['artifacts/rc11/avatars-source-form-races/flows.json','artifacts/rc11/avatars-source-form-restore/flows.json','artifacts/rc11/avatars-source-selection-focus/flows.json','artifacts/rc11/avatars-source-manager-keyboard/flows.json','artifacts/rc11/independent-review/findings-before.json','artifacts/rc11/avatars-source-attempt1/flows.json','artifacts/rc11/source-first-pass/status.json','artifacts/rc11/avatar-library/native-asar-results.json','artifacts/rc11/source-final-retests/imports-before-hatch-dismiss/results.json','artifacts/rc11/source-final-retests/transactions-before-hatch-dismiss/flows.json']
for file in ['final-test-manifest.json','package-summary.json','package-modal-retest/merged-results.json','package-modal-retest/targeted-results.json','package-modal-retest/targeted-run.json','package-modal-retest/modal-inventory-packaged-results.json','package-modal-retest/overstrict-focus-results.json']:
    if (S/file).exists():extra.append('artifacts/rc11/'+file)
proof={}
for id,needles in {'V035':['transparent: true',"setAlwaysOnTop(true, 'screen-saver')"],'V038':["role === 'panel'","role === 'sidebar'","setAlwaysOnTop(true, 'screen-saver')"]}.items():
    lines=(ROOT/'src/main.cjs').read_text().splitlines();found=[]
    for needle in needles:
        matches=[(i+1,line.strip())for i,line in enumerate(lines)if needle in line];assert matches,needle
        found.append('src/main.cjs:'+str(matches[0][0])+'\n'+matches[0][1])
    proof[id]='\n'.join(found)+'\n仅证明源码窗口配置提供，不证明Windows/PPT现场效果'
files=[]
deliver=ROOT.parents[1]/'flower-rc11-deliverables'
for p in [ROOT/'dist-rc11-final/FlowerClassroom-1.3.0-rc.11-portable.exe',ROOT/'dist-rc11-final/FlowerClassroom-1.3.0-rc.11-x64.zip',deliver/'FlowerClassroom-1.3.0-rc.11-folder.7z']:
    if p.exists():files.append(dict(name=p.name,bytes=p.stat().st_size,sha256=sha(p)))
cfg=dict(finalized=not partial,source=dict(at=freeze['frozenAt'],sha256=source_sha,files=freeze['files'],avatarAssets=freeze['avatarAssets']),package=dict(asarSha256=ash,files=files),runs=runs,defects=defects,implementationProof=proof,evidenceFiles=list(dict.fromkeys(extra)),releaseGate='最终冻结源码、最终包对应模型与Linux Electron检查均通过；覆盖范围内已发现的问题已修复并复验。7项Windows现场效果及此前被中止的专项继续未验证。'if not partial else '制作预览：等待最终ASAR继承回归完成，尚未发布最终结论')
(D/('working-config.json'if partial else 'final-config.json')).write_text(json.dumps(cfg,ensure_ascii=False,indent=2))
print(json.dumps({'finalized':not partial,'runs':len(runs),'sourceSha256':source_sha,'asarSha256':ash,'packages':len(files)},ensure_ascii=False))
