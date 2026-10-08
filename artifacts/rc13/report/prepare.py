"""Bind each RC13 conclusion to new, explicitly selected evidence. Historical results are context only."""
import json, sys, re, hashlib, datetime, copy
from collections import Counter
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]; D=Path(__file__).resolve().parent
READ=lambda p: json.loads(Path(p).read_text())
SHA=lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
PRIOR=READ(ROOT/'artifacts/rc12/report/report-input.json')
BASE=READ(ROOT/'artifacts/rc10/report/feature-baseline-118.json')
WINDOWS={'V033','V035','V037','V038','V052','V054','V067'}
PREFIX='artifacts/rc12-independent-20261005/'

def clean(v,limit=1300):
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
    if isinstance(x.get('restarts'),list):return [dict(name='Actual new-process reload: '+r['name'],status='passed'if r['status']==0 else'failed',detail=r,locator=f'{loc}restarts[{i}]')for i,r in enumerate(x['restarts'])]
    if x.get('passed')is True:return [dict(name='Fresh Electron process reloads exact saved state',status='passed',detail=x,locator='$')]
    if 'stateEqual'in x:return [dict(name='Fresh Electron process reloads exact saved state without transient dialogs',status='passed'if x.get('stateEqual')and x.get('transientModalsAbsent')else'failed',detail=x,locator='$')]
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

cfg=READ(sys.argv[1])if len(sys.argv)>1 else dict(finalized=False,source={},package={},runs=[])
if cfg.get('finalized'):
    assert cfg.get('source',{}).get('sha256') and cfg.get('package',{}).get('asarSha256')
    for f,h in {**cfg['source']['files'],**cfg['source'].get('avatarAssets',{})}.items():assert SHA(ROOT/f)==h,f
runs=[]; evidence={}
def add_evidence(file,purpose):
    if file and (ROOT/file).is_file():
        if file in evidence:
            if purpose not in evidence[file]['purpose'].split('；'):evidence[file]['purpose']+='；'+purpose
        else:evidence[file]=dict(file=file,sha256=SHA(ROOT/file),purpose=purpose)
def validate_final(raw,spec):
    if not isinstance(raw,dict):return
    for k in ('sourceChanged',):
        if k in raw:assert raw[k]is False,(spec['file'],k)
    for k in ('sourceUnchanged','archiveUnchanged','matchesFreeze'):
        if k in raw:assert raw[k]is True,(spec['file'],k)
    for k in ('archiveSha256','archiveSha','asarSha256','initialArchiveSha256','finalArchiveSha256'):
        if raw.get(k):assert raw[k]==cfg['package']['asarSha256'],(spec['file'],k)
    for k in ('sourceAtStart','sourceAtFinish','sourceHashes','initialSourceHashes','finalSourceHashes','sourceSha256','initialHashes','finalHashes','loadedSourceHashes','sourceFiles','sourceFilesAfter','loadedSourceFiles','codeHashes','currentCodeHashes','reviewedHashes','reviewedFileHashes','beforeHashes','afterHashes'):
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

def add_run(spec,stage,version):
    p=ROOT/spec['file'];assert p.is_file(),p
    raw=spec.get('raw')
    if raw is None:raw=READ(p)if p.suffix=='.json'else None
    cs=flatten(raw)if raw is not None else logchecks(p)
    if stage=='最终冻结':
        assert spec.get('frozenEvidence',False),spec
        assert cs,spec['file'];validate_final(raw,spec)
    for c in cs:
        if c['name'].startswith('Workbook format observation:'):c['originalStatus']=c['status'];c['status']='observed'
        if spec.get('findingReproduction'):c['originalStatus']=c['status'];c['status']='observed'
        value=c.get('actual')if c.get('actual')is not None else c.get('detail')if c.get('detail')is not None else c.get('error')
        c['actualText']=clean(value)if value is not None else '原始断言满足预期；该条日志未另记实际数值'if c['status']=='passed'else'已复现RC12已知错误，不计软件通过'if spec.get('findingReproduction')else'观察记录，不纳入正确性通过统计'if c['status']=='observed'else'原始断言未满足'
        if c.get('error')and c.get('detail'):c['actualText']+='\n错误：'+clean(c['error'],240)
        c['file']=spec['file']
    rr={**spec,'stage':stage,'version':version,'checks':cs,'sha256':SHA(p)}
    if raw:
        if not rr.get('startedAt'):rr['startedAt']=raw.get('startedAt')or raw.get('createdAt')or raw.get('time')or raw.get('at')
        if not rr.get('completedAt'):rr['completedAt']=raw.get('completedAt')or raw.get('finishedAt')
    runs.append(rr);add_evidence(spec['file'],stage+' / '+spec['title'])

baseline=[('baseline-confirmations','旧确认、恢复及班名编辑',PREFIX+'confirmations/before-summary.json'),('baseline-roster','名单和头像往返',PREFIX+'roster-roundtrips/verified/results.json'),('baseline-feedback','图鉴焦点与荣誉实时刷新',PREFIX+'feedback-navigation/baseline-final/results.json')]
for rid,title,f in baseline:add_run(dict(id=rid,title=title,file=f,scope='交付RC12 Linux Electron ASAR'),'交付后基线审计','1.3.0-rc.12')
assert [(len(r['checks']),sum(c['status']=='failed'for c in r['checks']))for r in runs]==[(36,15),(21,8),(18,5)]
extra_baseline=[('baseline-confirm-restart','确认场景独立进程重启',PREFIX+'confirmations/delivered-final-before/run.json'),('baseline-settings-restart','设置场景独立进程重启',PREFIX+'confirmations/settings-before/run.json'),('baseline-feedback-restart','反馈专项独立进程重启',PREFIX+'feedback-navigation/baseline-final/restart.json')]
for rid,title,f in extra_baseline:
    if(ROOT/f).is_file():add_run(dict(id=rid,title=title,file=f,scope='交付RC12 Linux Electron新进程'),'基线重启记录','1.3.0-rc.12')
dev=[
('dev-confirmations','原36场景修复过程复验',PREFIX+'confirmations/source-rereview-2/flows.json'),
('dev-confirm-restart','确认21快照新进程复验',PREFIX+'confirmations/source-rereview-2/run.json'),
('dev-roster','名单24项过程复验',PREFIX+'roster-roundtrips/source-retest/results.json'),
('dev-roster-exact','原样名单夹具11项复验',PREFIX+'roster-roundtrips/exact-source-retest/results.json'),
('dev-feedback','反馈原18场景过程复验',PREFIX+'feedback-navigation/rc13-source-retest/results.json'),
('dev-feedback-restart','反馈新进程状态与临时层检查',PREFIX+'feedback-navigation/rc13-source-retest/restart.json'),
('dev-album-focused','图鉴11项扩展过程复验','artifacts/rc13-album-refresh/final/results.json'),
('dev-confirm-focused','目标确认修复扩展复验','artifacts/rc13-target-confirmations/electron-final/flows.json'),
('dev-parser-before','解析边界新增测试修复前','artifacts/rc13-roster-parser/source-before/focused-tests.log'),
('dev-parser-after','解析边界修复后','artifacts/rc13-roster-parser/focused-tests.log')]
dev += [
('dev-independent-before','独立初始候选10项含2失败','artifacts/rc13-independent-review/source-2/results.json'),
('dev-independent-first-repair','独立首次修复17项过程','artifacts/rc13-independent-review/source-3/results.json'),
('dev-independent-padded','名称带空格子例仍失败','artifacts/rc13-independent-review/padded-title-source/results.json'),
('dev-independent-repaired','独立18项修复过程复验','artifacts/rc13-independent-review/source-4/results.json'),
('dev-independent-restart','独立修复新进程状态核对','artifacts/rc13-independent-review/source-4/restart.json'),
('dev-restore-toolbox-before','首轮冻结工具箱恢复返回失败','artifacts/rc13/freeze-attempt-1/new-targeted-source/restore-toolbox/results.json'),
('dev-restore-classroom-before','首轮冻结课堂恢复返回失败','artifacts/rc13/freeze-attempt-1/new-targeted-source/restore-classroom/results.json'),
('dev-reopen-first','恢复返回扩展首轮过程','artifacts/rc13-independent-review/reopen-source-1/results.json')]
for rid,title,f in dev:
    if(ROOT/f).is_file():add_run(dict(id=rid,title=title,file=f,scope='开发过程Node模型'if f.endswith('.log')else'开发过程Linux Electron源码'),'修复过程（非最终统计）','RC13开发过程；精确哈希见证据')
f=PREFIX+'roster-roundtrips/independent-repro/results.json'
if(ROOT/f).is_file():add_run(dict(id='baseline-roster-repro',title='异源夹具确认已知错误',file=f,scope='RC12已知坏行为复现',findingReproduction=True),'独立缺陷复现（不计通过）','1.3.0-rc.12')
for spec in cfg.get('runs',[]):add_run(spec,'最终冻结','1.3.0-rc.13')
control='artifacts/rc13-independent-review/rc12-title-control/results.json'
if(ROOT/control).is_file():add_run(dict(id='rc12-title-regression-control',title='RC12迟到班名回复对照',file=control,scope='交付RC12 Linux Electron ASAR'),'修复回归归因对照（不加原基线）','1.3.0-rc.12')

def status(cs):return '失败'if any(c['status']=='failed'for c in cs)else'通过'if cs and all(c['status']=='passed'for c in cs)else'未验证'
def compact(cs):
    g={}
    for c in cs:g.setdefault(c['file'],[]).append(c['locator'])
    return '\n'.join(f+'\n'+', '.join(dict.fromkeys(ls))for f,ls in g.items())or'无最终冻结对应证据'
def side(r):
    if r.get('bindingScope')in('source','package'):return r['bindingScope']
    if 'ASAR'in r['scope']or'包内'in r['scope']or re.search(r'(?:^|-)(packaged|asar)(?:-|$)',r['id']):return'package'
    if '源码'in r['scope']or re.search(r'(?:^|-)source(?:-|$)',r['id']):return'source'
final=[r for r in runs if r['stage']=='最终冻结']
def matching(patterns,scope):
    allc=[c for r in final if side(r)==scope for c in r['checks']]
    groups=[[c for c in allc if re.search(p,c['name'],re.I)]for p in patterns]
    cs=list({(c['file'],c['locator']):c for g in groups for c in g}.values())
    return status(cs)if groups and all(groups)else'未验证',cs,[p for p,g in zip(patterns,groups)if not g]

findings=READ(D/'findings.json')
for f in findings:
    for scope in ('source','package'):
        f[scope+'Status'],cs,f[scope+'Missing']=matching(f['patterns'],scope)
        f[scope+'Evidence']=compact(cs)
        f[scope+'Actual']='\n'.join(c['name']+'：'+clean(c['actualText'],140)for c in {c['name']:c for c in cs}.values())or'待最终冻结证据'
    f['status']='已修复并复验'if f['sourceStatus']==f['packageStatus']=='通过'else'复验仍有失败'if'失败'in(f['sourceStatus'],f['packageStatus'])else'待最终冻结复验'
    f['version']='RC13初始候选 → RC13最终冻结'if f.get('stage')else'交付RC12 → 修复RC13'
    for p in (f['baselineFile']+'\n'+f.get('baselineDetail','')).splitlines():add_evidence(p,'RC12问题证据 '+f['id'])

requirements=[]
rename={'头像库异步解码晚到时不污染新编辑表单':'头像库异步读取晚到时不污染新编辑表单','robot visible adoption starts LV1 zero growth with original ordinary data intact':'robot visible adoption starts as a shared egg at LV1 zero growth with original ordinary data intact','phoenix visible adoption starts LV1 zero growth with original ordinary data intact':'phoenix visible adoption starts as a shared egg at LV1 zero growth with original ordinary data intact'}
for old in PRIOR['requirements']:
    r=copy.deepcopy(old);r.update(historicalStatus=old['status'],historicalEvidence=old['sourceEvidence']+'\n'+old['packageEvidence'],version='1.3.0-rc.13')
    byscope={'source':[],'package':[]};missing={'source':[],'package':[]}
    if r['id'].startswith('N'):
        for scope in ('source','package'):
            pats=r.get('packagePatterns',r['patterns'])if scope=='package'else r['patterns']
            r[scope+'Status'],byscope[scope],missing[scope]=matching(pats,scope)
    else:
        b=next(b for b in BASE if b['id']==r['id'])
        for bind in b.get('bindings',[]):
            scope='package'if bind['runId'].startswith('packaged-')else'source'
            rr=next((x for x in final if x['id']==bind['runId']),None)
            name=rename.get(bind['name'],bind['name'])
            c=next((c for c in rr['checks']if c['name']==name),None)if rr else None
            if c:byscope[scope].append(c)
            else:missing[scope].append(bind)
        for scope in ('source','package'):r[scope+'Status']='未验证'if missing[scope]else status(byscope[scope])
    for scope in ('source','package'):
        r[scope+'Evidence']=compact(byscope[scope]);r[scope+'Missing']=missing[scope]
    if r.get('requiredScopes')==['source']:r['packageStatus']='未单独绑定（源码专项）';r['packageEvidence']='原要求仅源码专项，本版不宣称该项独立完成相同ASAR专项'
    statuses=[r[s+'Status']for s in r.get('requiredScopes',['source','package'])]
    r['status']='未验证'if r['id']in WINDOWS else'失败'if'失败'in statuses else'通过'if statuses and all(s=='通过'for s in statuses)else'未验证'
    if r['status']=='未验证':r['actual']='Windows现场效果仍未验证'if r['id']in WINDOWS else'本轮最终证据尚未完整绑定，含相关新增失败的复验要求'
    r['actual']='Windows现场效果仍未验证'if r['id']in WINDOWS else'本轮最终证据尚未完整绑定'if r['status']=='未验证'else'\n'.join(c['name']+'；'+clean(c['actualText'],140)for c in list({c['name']:c for c in byscope['source']+byscope['package']}.values())[:4])
    affected=[f['id']for f in findings if r['id']in f.get('affectedIds',[])]
    # Newly discovered requirements remain open until their original failure scenarios pass too.
    for scope in r.get('requiredScopes',['source','package']):
        linked=[f for f in findings if f['id']in affected]
        for f in linked:
            _,cs,miss=matching(f['patterns'],scope);byscope[scope].extend(cs)
            missing[scope].extend([f['id']+': '+p for p in miss])
        byscope[scope]=list({(c['file'],c['locator']):c for c in byscope[scope]}.values())
        r[scope+'Status']='未验证'if missing[scope]else status(byscope[scope])
        r[scope+'Evidence']=compact(byscope[scope]);r[scope+'Missing']=missing[scope]
    statuses=[r[s+'Status']for s in r.get('requiredScopes',['source','package'])]
    r['status']='未验证'if r['id']in WINDOWS else'失败'if'失败'in statuses else'通过'if statuses and all(s=='通过'for s in statuses)else'未验证'
    if r['status']=='未验证':r['actual']='Windows现场效果仍未验证'if r['id']in WINDOWS else'本轮最终证据尚未完整绑定，含相关新增失败的复验要求'
    r['auditFindings']='、'.join(affected)or'本轮未新增该项缺陷记录';r['fix']='关联 '+r['auditFindings']+'；见缺陷闭环'if affected else'重新绑定本轮证据；历史通过不自动沿用'
    if cfg.get('implementationProof',{}).get(r['id']):r['implementationEvidence']=cfg['implementationProof'][r['id']]
    r['testTime']='；'.join(dict.fromkeys(str(x.get('startedAt')or x.get('createdAt')or'原日志未记录精确起始时间')for x in final if any(c in byscope['source']+byscope['package']for c in x['checks'])))or'待最终执行记录'
    requirements.append(r)
assert len(requirements)==155 and len({r['id']for r in requirements})==155
qa=[
dict(id='Q01',title='确认审计探索阶段控件限制',actual='早期分组提交被禁用、遮挡控件点击等属于脚本导航限制。正式基线使用真实指针，宠物庆祝先由Escape关闭；仅33项正式轮和3项设置扩展计入36项基线。',evidence=PREFIX+'confirmations/REPORT.md'),
dict(id='Q02',title='确认源码复验隔离与源码变更',actual='首轮设置草稿延续到下一独立场景，造成测试隔离失败。第二轮用可见“读取当前名称”控件建立新草稿，36场景及21重启通过；运行期间app.js有邻接修改，只作为过程证据。',evidence=PREFIX+'confirmations/source-rereview-1/\n'+PREFIX+'confirmations/source-rereview-2/'),
dict(id='Q03',title='名单预览等待纠正',actual='初次探索有4项因等到旧提示而产生的时序假失败。正式verified轮等待真正的确认窗口，21项中13通过8失败。异源openpyxl夹具3次成功复现错误仅确认缺陷，不算软件通过。',evidence=PREFIX+'roster-roundtrips/REPORT.md'),
dict(id='Q04',title='反馈导航探索轮与扩展轮',actual='initial-run的3项导航失败已明确排除。baseline-final是18项正式基线；baseline-15和honors-extension保留。原生键盘、Escape及实际持久化检查与人工focus设置分别说明。',evidence=PREFIX+'feedback-navigation/REPORT.md'),
dict(id='Q05',title='图鉴修复专项的入口纠正',actual='首轮9个已到达检查通过，2项班级相册因未用可见工具入口导致失败。纠正为既有qa-tool-control导航后11/11通过。超时/信号现会记失败，原过程输出保留。',evidence='artifacts/rc13-album-refresh/REPORT.md')]
qa+=cfg.get('qaNotes',[])
qa += [dict(id='Q06',title='独立复核初轮编辑器入口',actual='source-1误在紧凑积分窗调用学生编辑器，属于测试入口错误。改用该窗口支持的面板班名编辑器后source-2正式10项为8过2败，两个真实产品问题单列IR1/IR2。',evidence='artifacts/rc13-independent-review/REPORT.md'),dict(id='Q07',title='首次冻结和构建中止',actual='发现名称首尾空格子例后停止首轮源码回归及构建，freeze-attempt-1完整保留，不能计最终通过。其恢复工具/课堂失败又定位出IR3，待修复后重新冻结及复跑。',evidence='artifacts/rc13/freeze-attempt-1/NOTE.json')]
qa += [dict(id='Q08',title='陈旧取消行为的两项预期适配',actual='reopen-source-1的两条Cancel断言期望返回下层视图，但修复设计是关闭陈旧弹窗且不写入。最终脚本明确核对无修改、弹窗已关及重新打开后当前资料可用；这是脚本预期差异，不新增产品缺陷。7项扩展纳入最终25项独立矩阵。',evidence='artifacts/rc13-independent-review/REPORT.md')]
for i,q in enumerate(qa,1):
    q['id']=f'Q{i:02}'
    for f in q.get('evidence','').splitlines():add_evidence(f,'测试过程与夹具说明 '+q['id'])
for f in [*(p+'REPORT.md'for p in [PREFIX+'confirmations/',PREFIX+'roster-roundtrips/',PREFIX+'feedback-navigation/']),'artifacts/rc13-album-refresh/REPORT.md','artifacts/rc13-roster-parser/results.json','artifacts/rc13-independent-review/REPORT.md','artifacts/rc10/specialized-audit-status.json',*cfg.get('evidenceFiles',[])]:add_evidence(f,'专项报告、冻结清单与保留限制')
for i,e in enumerate(evidence.values()):e['id']=f'E{i+1:03}'
upgrade='RC11及更旧导入已丢掉的前导零或文字，RC12无公式缓存造成的漏行/默认值，都不能由新版自动猜回。请对照原始表格和更早JSON完整备份核对。RC12替换名单前的自动保护备份经独立复现验证仍在，可先确认备份时间及内容，再由用户有意识恢复；恢复会替换当前资料，应先备份当前状态。不要自动覆盖真实班级，也不要把再次“替换名单”当作保留积分的修复。CSV/XLSX导出重导只保证名单姓名/小组文字；完整积分、ID、照片快照和历史应使用JSON备份。'
d={**cfg,'version':'1.3.0-rc.13','date':datetime.datetime.now(datetime.timezone.utc).date().isoformat(),'baseline':{'version':'1.3.0-rc.12','asarSha256':'c5dcc68cf01d205d56145b42bba35881a637617311c4ea266ba62ebc79e4c9c5','portableSha256':'0f7ae8eccc27433891f7bf5d46955e8e3e6942809419502a9389c4bc9241cb09'},'requirements':requirements,'findings':findings,'runs':runs,'evidence':list(evidence.values()),'windows':[r for r in requirements if r['id']in WINDOWS],'qaNotes':qa,'upgradeNote':upgrade,'baselineFailed':28,'baselineScenarios':75,'baselinePassed':47}
d.setdefault('releaseGate','制作预览：最终源码冻结、完整回归及最终ASAR证据尚待绑定，不能作为交付通过结论。')
dest=Path(sys.argv[2])if len(sys.argv)>2 else D/'report-input.json';dest.write_text(json.dumps(d,ensure_ascii=False,indent=2))
print(json.dumps({'finalized':d.get('finalized',False),'requirements':dict(Counter(r['status']for r in requirements)),'findings':dict(Counter(f['status']for f in findings)),'runs':len(runs),'executionRecords':sum(len(r['checks'])for r in runs)},ensure_ascii=False))
