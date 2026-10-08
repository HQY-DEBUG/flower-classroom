"""Build a traceable RC11 delivered-audit / RC12 retest report. No historic pass carry-forward."""
import json, sys, re, hashlib, datetime
from collections import Counter
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
D=Path(__file__).resolve().parent
READ=lambda p:json.loads(Path(p).read_text())
SHA=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
PRIOR=READ(ROOT/'artifacts/rc11/report/report-input.json')
BASE=READ(ROOT/'artifacts/rc10/report/feature-baseline-118.json')
WINDOWS={'V033','V035','V037','V038','V052','V054','V067'}
BASELINE_SHA='53e658ce7fdcaa7615f5b370271c57c0ca18ccd381d68ad77c28ed76df5e6baa'

def clean(v,limit=1000):
    if isinstance(v,(dict,list)):v=json.dumps(v,ensure_ascii=False,separators=(',',':'))
    t=str(v if v is not None else '')
    t=re.sub(r'/(?:workspace|tmp|root|home)/[^\s\"\',)]+','[测试环境路径]',t)
    t=re.sub(r'\n\s+at .*','',t)
    return t if len(t)<=limit else t[:limit]+'…（完整实际值见原始证据）'

def flatten(x,loc='',ctx=None):
    if not isinstance(x,dict):return []
    ctx={**(ctx or {}),**{k:x[k]for k in ('phase','boundary')if x.get(k)}}
    if x.get('name') and x.get('status')in('passed','failed','observed','skipped'):
        return [{**ctx,**x,'locator':loc.rstrip('.')}]
    if isinstance(x.get('checks'),list):
        return [{**ctx,**c,'name':c.get('name')or c.get('title')or c.get('id')or f"{c.get('role','')} {c.get('width','')}x{c.get('height','')} zoom {c.get('zoom','')}",'locator':f'{loc}checks[{i}]'}for i,c in enumerate(x['checks'])]
    if isinstance(x.get('report'),dict):return flatten(x['report'],loc+'report.',ctx)
    for key in ('runs','results'):
        if isinstance(x.get(key),list):return [c for i,r in enumerate(x[key])for c in flatten(r,f'{loc}{key}[{i}].',ctx)]
    if isinstance(x.get('result'),dict):return flatten(x['result'],loc+'result.',ctx)
    if x.get('passed')is True:return [dict(name='Fresh Electron process reloads the exact saved multi-panel state',status='passed',detail=x,locator='$')]
    return []

def logchecks(p):
    txt=p.read_text().split('✖ failing tests:')[0];cs=[]
    for ln in txt.splitlines():
        m=re.match(r'\s*([✔✖]) (.+?)(?: \([\d.]+ms\))?$',ln)
        if m:cs.append(dict(name=m[2],status='passed'if m[1]=='✔'else'failed'))
    if not cs:
        names=re.findall(r'^\s*# Subtest: (.+)$',txt,re.M)
        outcomes=re.findall(r'^\s*(not ok|ok) \d+ -',txt,re.M)
        cs=[dict(name=n,status='passed'if s=='ok'else'failed')for n,s in zip(names,outcomes)]
    for i,c in enumerate(cs):c['locator']=f'normalizedChecks[{i}]'
    total=re.search(r'(?:ℹ|#) tests (\d+)',txt)
    if total:assert len(cs)==int(total.group(1)),(p,len(cs),total.group(1))
    return cs

cfg=READ(sys.argv[1])if len(sys.argv)>1 else {'finalized':False,'source':{},'package':{},'runs':[]}
if cfg.get('finalized'):
    assert cfg.get('source',{}).get('sha256') and cfg.get('package',{}).get('asarSha256')
    for f,h in {**cfg['source']['files'],**cfg['source'].get('avatarAssets',{})}.items():assert SHA(ROOT/f)==h,f

baseline_specs=[
 ('baseline-egg','宠物成长与反馈','artifacts/comprehensive-rc11-20261005/egg-audit/baseline-complete/results.json'),
 ('baseline-egg-restart','宠物独立进程重启','artifacts/comprehensive-rc11-20261005/egg-audit/baseline-complete/restart-result.json'),
 ('baseline-avatar','头像编辑与持久化','artifacts/comprehensive-rc11-20261005/avatar-audit/final-baseline/results.json'),
 ('baseline-import','名单导入与事务','artifacts/comprehensive-rc11-20261005/import-audit/results.json'),
 ('baseline-format','CSV/XLSX文本保真','artifacts/comprehensive-rc11-20261005/import-audit/format-baseline/results.json'),
 ('baseline-tools','工具、恢复与键盘','artifacts/comprehensive-rc11-20261005/tools-audit/canonical-results.json')]
dev_specs=[
 ('dev-avatar','头像修复独立源码复验','artifacts/comprehensive-rc11-20261005/avatar-audit/rc12-source-retest/results.json'),
 ('dev-pet','宠物原失败场景源码复验','artifacts/rc12/pet-fixes/source-original-audit/results.json'),
 ('dev-pet-focus','宠物展示加强源码复验','artifacts/rc12/pet-fixes/focused-source-final/results.json'),
 ('dev-tools','工具原始场景源码复验','artifacts/comprehensive-rc11-20261005/tools-audit/source-independent-retest/results.json'),
 ('dev-confirm-controls','删除确认源码对照复验','artifacts/comprehensive-rc11-20261005/tools-audit/source-confirmation-controls/results.json'),
 ('dev-format','导入格式源码复验','artifacts/rc12/import-text-fix/format-source-retest/results.json'),
 ('dev-parse-before','新增解析检查修复前','artifacts/rc12/import-text-fix/before.log'),
 ('dev-parse-after','新增解析检查修复后','artifacts/rc12/import-text-fix/after-focused.log'),
 ('dev-independent-before','RC12批量反馈陈旧独立复现','artifacts/rc12/independent-review/lifetime-repro/results.json'),
 ('dev-independent-after','RC12综合修复独立源码复验','artifacts/rc12/independent-review/source-repaired-final/results.json')]
runs=[];evidence={}
def validate_final(raw,spec):
    if not isinstance(raw,dict):return
    for k in ('sourceChanged',):
        if k in raw:assert raw[k] is False,(spec['file'],k)
    for k in ('sourceUnchanged','archiveUnchanged','matchesFreeze'):
        if k in raw:assert raw[k] is True,(spec['file'],k)
    for k in ('archiveSha256','asarSha256','initialArchiveSha256','finalArchiveSha256'):
        if raw.get(k):assert raw[k]==cfg['package']['asarSha256'],(spec['file'],k)
    for k in ('sourceAtStart','sourceAtFinish','sourceHashes','initialSourceHashes','finalSourceHashes','sourceSha256','initialHashes','finalHashes','loadedSourceHashes','sourceFiles','sourceFilesAfter','loadedSourceFiles','codeHashes','currentCodeHashes','reviewedHashes','reviewedFileHashes'):
        h=raw.get(k)
        if isinstance(h,dict):
            for file,digest in h.items():
                file=file if file.startswith('src/')else'src/'+file
                if isinstance(digest,str)and file in cfg['source'].get('files',{}):assert digest==cfg['source']['files'][file],(spec['file'],k,file)
    for k in ('results','runs'):
        if isinstance(raw.get(k),list):
            for r in raw[k]:validate_final(r,spec)
    for k in ('report','result'):
        if isinstance(raw.get(k),dict):validate_final(raw[k],spec)
def add_evidence(file,purpose):
    if not file or not (ROOT/file).is_file():return
    evidence[file]=dict(file=file,sha256=SHA(ROOT/file),purpose=purpose)
def add_run(spec,stage,version):
    p=ROOT/spec['file'];assert p.is_file(),p
    raw=spec.get('raw')
    if raw is None:raw=READ(p)if p.suffix=='.json'else None
    cs=flatten(raw)if raw is not None else logchecks(p)
    if stage=='最终冻结':
        assert spec.get('frozenEvidence',False),spec
        assert cs,spec['file']
        validate_final(raw,spec)
    for c in cs:
        if c['name'].startswith('Workbook format observation:'):
            c['originalStatus']=c['status'];c['status']='observed'
        value=c.get('actual')if c.get('actual')is not None else c.get('detail')if c.get('detail')is not None else c.get('error')
        c['actualText']=clean(value)if value is not None else '原始断言满足预期；该条日志未另记实际数值'if c['status']=='passed'else '观察记录，不纳入正确性通过统计'if c['status']=='observed'else '原始断言未满足'
        if c.get('error') and c.get('detail'):c['actualText']+='\n错误：'+clean(c['error'],240)
        c['file']=spec['file']
    rr={**spec,'stage':stage,'version':version,'checks':cs,'sha256':SHA(p)}
    if raw and not rr.get('startedAt'):
        rr['createdAt']=raw.get('createdAt')or raw.get('time')or raw.get('at')
    runs.append(rr);add_evidence(spec['file'],stage+' / '+spec['title'])
for rid,title,file in baseline_specs:add_run(dict(id=rid,title=title,file=file,scope='交付RC11 Linux Electron ASAR'),'交付后基线审计','1.3.0-rc.11')
for rid,title,file in dev_specs:
    if (ROOT/file).is_file():add_run(dict(id=rid,title=title,file=file,scope='开发过程Node模型'if file.endswith('.log')else'开发过程Linux Electron源码'),'修复过程（非最终统计）','RC12开发过程；精确哈希见原始证据')
for spec in cfg.get('runs',[]):add_run(spec,'最终冻结','1.3.0-rc.12')

def status(cs):return '失败'if any(c['status']=='failed'for c in cs)else'通过'if cs and all(c['status']=='passed'for c in cs)else'未验证'
def compact(cs):
    grouped={}
    for c in cs:grouped.setdefault(c['file'],[]).append(c['locator'])
    return '\n'.join(f+'\n'+', '.join(dict.fromkeys(ls))for f,ls in grouped.items())or'无最终冻结对应证据'
final=[r for r in runs if r['stage']=='最终冻结']
def selected(scope):
    def side(r):
        if r.get('bindingScope')in('source','package'):return r['bindingScope']
        if 'ASAR'in r['scope']or'包内'in r['scope']or re.search(r'(?:^|-)(packaged|asar)(?:-|$)',r['id']):return'package'
        if '源码'in r['scope']or re.search(r'(?:^|-)source(?:-|$)',r['id']):return'source'
        return None
    return [r for r in final if side(r)==scope]
def matching(patterns,scope):
    cs=[c for r in selected(scope)for c in r['checks']]
    groups=[[c for c in cs if re.search(p,c['name'],re.I)]for p in patterns]
    return status([c for g in groups for c in g])if all(groups)else'未验证',[c for g in groups for c in g],[p for p,g in zip(patterns,groups)if not g]

findings=READ(D/'findings.json')
if any(c['name']=='Timer sound selection returns keyboard focus to the available sound menu' for r in runs if r['id']=='baseline-tools' for c in r['checks']):
    k=next(f for f in findings if f['id']=='K01')
    k['title']='七类控件重绘后键盘位置丢失或停留在不可用控件'
    k['before']+=' 后续扩展的第七场景：计时器选择音色后焦点未回到可用音色菜单。'
    k['steps']+=' 再补测计时器音色选择后的可用焦点。'
    k['patterns'].append('Timer sound selection returns keyboard focus')
    k['affected']+='、V054'
    k['baselineDetail']+='\nartifacts/comprehensive-rc11-20261005/tools-audit/delivered-sound-menu-validation/results.json'
for f in findings:
    for scope in ('source','package'):
        f[scope+'Status'],cs,f[scope+'Missing']=matching(f['patterns'],scope)
        f[scope+'Evidence']=compact(cs)
        unique={c['name']:c for c in cs}
        f[scope+'Actual']='\n'.join(c['name']+'：'+clean(c['actualText'],90)for c in unique.values())
    f['status']='已修复并复验'if f['sourceStatus']==f['packageStatus']=='通过'else'复验仍有失败'if'失败'in(f['sourceStatus'],f['packageStatus'])else'待最终冻结复验'
    if f['status']=='已修复并复验'and f['id']=='K01':f['sourceDetail']='原六项连续操作及新增音色菜单焦点均通过最终源码/ASAR复验；包含迟到保存、新意图、禁用边界及125%/200%缩放的完整27项键盘专项两侧也均通过。'
    if f['status']=='已修复并复验'and f['id']=='I02':f['sourceDetail']='原5个富文本失败场景及16项扩展文本对照在最终源码和ASAR均通过，覆盖公式缓存0/false、错误与日期、无关元数据及模板文本列。'
    for scope in ('source','package'):
        if f[scope+'Status']=='通过':f[scope+'Actual']=f['sourceDetail']+'\n对应原始检查：\n'+f[scope+'Actual']
    f['version']='RC12早期修复 → RC12最终冻结'if f['id']=='IR01'else'交付RC11 → 修复RC12'
    for file in f['baselineDetail'].splitlines():add_evidence(file,'修前问题细节 '+f['id'])

requirements=[]
for old in PRIOR['newFeatures']:
    r={**old,'historicalStatus':old['status'],'historicalEvidence':old['sourceEvidence']+'\n'+old['packageEvidence'],'version':'1.3.0-rc.12','baselineKind':'RC11新增37项'}
    for scope in ('source','package'):
        patterns=r.get('packagePatterns',r['patterns'])if scope=='package'else r['patterns']
        r[scope+'Status'],cs,r[scope+'Missing']=matching(patterns,scope);r[scope+'Evidence']=compact(cs)
    r['status']='失败'if'失败'in(r['sourceStatus'],r['packageStatus'])else'通过'if r['sourceStatus']==r['packageStatus']=='通过'else'未验证'
    r['actual']=r.get('observed','最终冻结源码和最终ASAR对应检查满足要求')if r['status']=='通过'else'最终源码：'+r['sourceStatus']+'；最终ASAR：'+r['packageStatus']
    r['module']=r['category'];r['implementationEvidence']=r.get('implementation','')
    requirements.append(r)
rename={'头像库异步解码晚到时不污染新编辑表单':'头像库异步读取晚到时不污染新编辑表单','robot visible adoption starts LV1 zero growth with original ordinary data intact':'robot visible adoption starts as a shared egg at LV1 zero growth with original ordinary data intact','phoenix visible adoption starts LV1 zero growth with original ordinary data intact':'phoenix visible adoption starts as a shared egg at LV1 zero growth with original ordinary data intact'}
for b in BASE:
    old=next(r for r in PRIOR['features']if r['id']==b['id'])
    r={**old,'historicalStatus':old['status'],'historicalEvidence':old['evidence'],'version':'1.3.0-rc.12','baselineKind':'既有118项'}
    byscope={'source':[],'package':[]};missing={'source':[],'package':[]}
    for bind in b.get('bindings',[]):
        rid=bind['runId'];scope='package'if rid.startswith('packaged-')else'source'
        rr=next((x for x in final if x['id']==rid),None)
        name=rename.get(bind['name'],bind['name'])
        c=next((c for c in rr['checks']if c['name']==name),None)if rr else None
        if c:byscope[scope].append(c)
        else:missing[scope].append(bind)
    for scope in ('source','package'):
        r[scope+'Status']='未验证'if missing[scope]else status(byscope[scope]);r[scope+'Evidence']=compact(byscope[scope]);r[scope+'Missing']=missing[scope]
    r['requiredScopes']=['source','package']
    if b.get('bindings') and not any(x['runId'].startswith('packaged-')for x in b['bindings']):
        r['requiredScopes']=['source'];r['packageStatus']='未单独绑定（源码专项）';r['packageEvidence']='原要求只绑定源码专项；本版不宣称该项已独立完成相同ASAR专项'
    r['status']='未验证'if r['id']in WINDOWS else '失败'if'失败'in(r['sourceStatus'],r['packageStatus'])else'通过'if r['sourceStatus']==r['packageStatus']=='通过'else'未验证'
    if r['requiredScopes']==['source']and r['id']not in WINDOWS:r['status']=r['sourceStatus']
    r['actual']='Windows现场效果仍未验证；实现与云端部分检查不等于Windows效果通过'if r['id']in WINDOWS else '最终冻结源码和最终ASAR对应检查均满足该项预期'if r['status']=='通过'else'最终源码：'+r['sourceStatus']+'；最终ASAR：'+r['packageStatus']
    if r['status']=='通过':
        observations={c['name']:c for c in byscope['source']+byscope['package']}
        actual_rows=[]
        for name,c in list(observations.items())[:3]:
            value=c['actualText']
            actual_rows.append(name+('；实测：'+clean(value,160)if value!='原始断言满足预期；该条日志未另记实际数值'else''))
        r['actual']='本次通过的具体观察：\n'+'\n'.join(actual_rows)
        if len(observations)>3:r['actual']+=f'\n另{len(observations)-3}条对应检查见本行证据及执行明细。'
        if r['requiredScopes']==['source']:r['actual']='仅最终冻结源码专项；未独立绑定同名ASAR专项。\n'+r['actual']
    if cfg.get('implementationProof',{}).get(r['id']):r['implementationEvidence']=cfg['implementationProof'][r['id']]
    requirements.append(r)
for r in requirements:
    related=[f['id']for f in findings if r['id']in f['affected'].split('、')]
    r['auditFindings']='、'.join(related)or'本轮未新增该项缺陷记录'
    r['fix']='关联本轮问题 '+r['auditFindings']+'；见缺陷闭环'if related else'重新绑定RC12对应检查；历史通过不自动沿用'
    r['implementationStatus']='已提供'if cfg.get('finalized')else'实现存在，待最终冻结核对'
assert len(requirements)==155 and len({r['id']for r in requirements})==155

for f in cfg.get('evidenceFiles',[]):add_evidence(f,'版本与复验过程')
for f in ['artifacts/comprehensive-rc11-20261005/egg-audit/findings.json','artifacts/comprehensive-rc11-20261005/avatar-audit/REPORT.md','artifacts/comprehensive-rc11-20261005/import-audit/REPORT.md','artifacts/comprehensive-rc11-20261005/tools-audit/REPORT.md','artifacts/rc12/import-text-fix/REPORT.md','artifacts/rc12/import-text-fix/template-check.json','artifacts/rc12/independent-review/REPORT.md','artifacts/rc12/independent-review/baseline-source-comparison.json','artifacts/rc10/specialized-audit-status.json']:
    add_evidence(f,'专项说明与保留限制')
for i,e in enumerate(evidence.values()):e['id']=f'E{i+1:03}'

qa=[
 {'id':'Q01','title':'头像初轮错误素材文件名','actual':'夹具用了不存在的内置文件名，执行中止；纠正为实际文件名并验证同名自定义图片确实不同后，完成24场景基线。','evidence':'artifacts/comprehensive-rc11-20261005/avatar-audit/REPORT.md'},
 {'id':'Q02','title':'工具原生按键与关闭/滚动夹具纠正','actual':'早期Enter缺少char事件；隐藏测试窗不能以isVisible断言打开；关闭渲染器后不能继续等待其IPC；滚动需实际目标容器。最终30场景以原生完整按键、BrowserWindow身份/销毁和鼠标滚轮结果调和，不追加重复通过数。','evidence':'artifacts/comprehensive-rc11-20261005/tools-audit/REPORT.md'},
 {'id':'Q03','title':'宠物审计归档哈希与动画等待','actual':'初次使用Electron修补fs读取归档哈希，在任何场景前失败，随后改为original-fs。截图等待动画稳定；baseline-complete为完整扩展基线。','evidence':'artifacts/comprehensive-rc11-20261005/egg-audit/findings.json'},
 {'id':'Q04','title':'修复过程轮与最终冻结分开','actual':'所有早期开发者复测、测试预期适配或候选失败保留在原目录；不能因为后续成功删除旧失败，不能把开发过程直接当作最终ASAR通过。','evidence':'最终运行清单及独立复核中的initialAttempt/retest记录'},
 {'id':'Q05','title':'独立复核CSV换行与焦点助手纠正','actual':'首轮CSV小组内换行被正常验证拒绝。纠正后分开证明解析保留换行、验证整批拒绝及其他普通文本导入；新增焦点返回检查一度以局部变量遮蔽助手，修正后21/21源码复验。IR01的9.5秒陈旧反馈是另一个真实产品缺陷，单列修复。','evidence':'artifacts/rc12/independent-review/REPORT.md'}]
qa+=cfg.get('qaNotes',[])

d={**cfg,'version':'1.3.0-rc.12','date':datetime.datetime.now(datetime.timezone.utc).date().isoformat(),'baseline':{'version':'1.3.0-rc.11','asarSha256':BASELINE_SHA,'portableSha256':'98a62436f9a231fac0e3585af2ae07be537b6ffad901797332176995adfa9497','sourceSha256':PRIOR['source']['sha256']},'requirements':requirements,'findings':findings,'runs':runs,'evidence':list(evidence.values()),'windows':[r for r in requirements if r['id']in WINDOWS],'qaNotes':qa,'upgradeNote':'本次解析修复保证今后的导入按新规则正确处理；RC11此前已丢掉的前导零或富文本内容无法凭现存档案自动猜回。若用过这类名单，请对照原始表格核对姓名、小组、头像，优先在学生档案中更正以保留积分。不要直接用“替换名单”作为保留成绩的修复方法；替换名单会重建名单与相关积分。软件不会自动覆盖真实班级。'}
d['baselineFailed']=sum(c['status']=='failed'for r in runs if r['stage']=='交付后基线审计'for c in r['checks'])
d['baselineToolsCount']=len(next(r for r in runs if r['id']=='baseline-tools')['checks'])
d['baselineToolsFailed']=sum(c['status']=='failed'for c in next(r for r in runs if r['id']=='baseline-tools')['checks'])
d['keyboardScenarioCount']=len(next(f for f in findings if f['id']=='K01')['patterns'])
if d['baselineToolsCount']==31:
    q=next(q for q in d['qaNotes']if q['id']=='Q02')
    q['actual']+=' 随后新增1项计时器音色焦点基线，形成31项（23过8败）；独立来源delivered-sound-menu-validation保留，不改写原30项的历史统计。'
d.setdefault('releaseGate','制作预览：最终源码冻结、最终ASAR和独立复核尚待绑定，不作最终通过结论。')
(Path(sys.argv[2])if len(sys.argv)>2 else D/'report-input.json').write_text(json.dumps(d,ensure_ascii=False,indent=2))
print(json.dumps({'finalized':d.get('finalized',False),'requirements':len(requirements),'requirementsByStatus':dict(Counter(r['status']for r in requirements)),'findingsByStatus':dict(Counter(f['status']for f in findings)),'runs':len(runs),'executionRecords':sum(len(r['checks'])for r in runs)},ensure_ascii=False))
