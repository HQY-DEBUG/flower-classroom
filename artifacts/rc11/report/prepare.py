import json, sys, re, hashlib, datetime
from pathlib import Path
from requirements import ROWS

ROOT = Path(__file__).resolve().parents[3]
DIR = Path(__file__).resolve().parent
WINDOWS = {'V033','V035','V037','V038','V052','V054','V067'}
def read(p): return json.loads(Path(p).read_text())
def sha(p): return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def clean(value):
    if isinstance(value,(dict,list)): value=json.dumps(value,ensure_ascii=False)
    return re.sub(r'/(?:workspace|tmp|root|home)/[^\s"\',)]+','[测试环境路径]',str(value or ''))
def checks(raw,loc='',context=None):
    if not isinstance(raw,dict): return []
    context={**(context or {}),**{k:raw[k] for k in ('phase','boundary') if raw.get(k)}}
    if raw.get('name') and raw.get('status'): return [{**context,**raw,'locator':loc.rstrip('.')}]
    if isinstance(raw.get('checks'),list):
        return [{**context,**c,'name':c.get('name') or c.get('title') or c.get('id') or f"{c.get('role','')} {c.get('width','')}x{c.get('height','')} zoom {c.get('zoom','')}",'locator':f'{loc}checks[{i}]'} for i,c in enumerate(raw['checks'])]
    if isinstance(raw.get('report'),dict): return checks(raw['report'],loc+'report.',context)
    for key in ('runs','results'):
        if isinstance(raw.get(key),list):
            return [c for i,r in enumerate(raw[key]) for c in checks(r, f'{loc}{key}[{i}].', context)]
    if isinstance(raw.get('result'),dict): return checks(raw['result'],loc+'result.',context)
    return []
def status(cs):
    if any(c['status']=='failed' for c in cs):return '失败'
    return '通过' if cs and all(c['status']=='passed' for c in cs) else '未验证'
def compact(cs):
    result={}
    for c in cs: result.setdefault(c['file'],[]).append(c['locator'])
    return '\n'.join(file+'\n'+', '.join(dict.fromkeys(locs)) for file,locs in result.items()) or '没有本次对应证据'
def unit_checks(p):
    text=p.read_text(); rows=[]
    for line in text.splitlines():
        if line.startswith('✔ '): rows.append(dict(name=re.sub(r' \([^)]*ms\)$','',line[2:]),status='passed'))
        elif line.startswith('✖ '): rows.append(dict(name=re.sub(r' \([^)]*ms\)$','',line[2:]),status='failed'))
    if not rows:
        names=re.findall(r'^# Subtest: (.+)$',text,re.M)
        states=re.findall(r'^(not ok|ok) \d+ -',text,re.M)
        rows=[dict(name=n,status='passed' if s=='ok' else 'failed') for n,s in zip(names,states)]
    total=re.search(r'(?:ℹ|#) tests (\d+)',text)
    if total:assert len(rows)==int(total.group(1)),str(p)+' unit count mismatch'
    return {'checks':rows}

cfg=read(sys.argv[1]) if len(sys.argv)>1 else {'finalized':False,'source':{},'package':{},'runs':[]}
prior=read(ROOT/'artifacts/rc10/report/report-input.json')
base=read(ROOT/'artifacts/rc10/report/feature-baseline-118.json')
if cfg.get('finalized'):
    assert cfg.get('source',{}).get('sha256') and cfg.get('package',{}).get('asarSha256')
    for file,digest in cfg['source']['files'].items(): assert sha(ROOT/file)==digest,file
    for file,digest in cfg['source'].get('avatarAssets',{}).items(): assert sha(ROOT/file)==digest,file
def validate_hashes(raw,spec):
    if not isinstance(raw,dict):return
    for key in ('sourceChanged',):
        if key in raw:assert raw[key] is False,spec['file']+' '+key
    for key in ('sourceUnchanged','archiveUnchanged','matchesFreeze'):
        if key in raw:assert raw[key] is True,spec['file']+' '+key
    for key in ('sourceAtStart','sourceAtFinish','sourceHashes','sourcesAtEnd','initialHashes','finalHashes','loadedSourceHashes','sourceFiles','sourceFilesAfter','loadedSourceFiles','codeHashes','currentCodeHashes','reviewedHashes','reviewedFileHashes'):
        hashes=raw.get(key)
        if isinstance(hashes,dict):
            for file,digest in hashes.items():
                file=file if file.startswith('src/') else 'src/'+file
                if isinstance(digest,str) and file in cfg['source']['files']: assert digest==cfg['source']['files'][file],spec['file']+' '+key+' '+file
    if spec['scope']=='最终ASAR':
        for key in ('archiveSha256','archiveHash','initialArchiveSha256','finalArchiveSha256','asarSha256'):
            if raw.get(key): assert raw[key]==cfg['package']['asarSha256'],spec['file']+' '+key
    for key in ('results','runs'):
        if isinstance(raw.get(key),list):
            for value in raw[key]:validate_hashes(value,spec)
    for key in ('report','result'):
        if isinstance(raw.get(key),dict):validate_hashes(raw[key],spec)
runs=[]; evidence=[]
for spec in cfg.get('runs',[]):
    p=ROOT/spec['file']; raw=spec.get('raw') or (unit_checks(p) if p.suffix in ('.log','.tap') else read(p))
    cs=checks(raw)
    if cfg.get('finalized'):
        assert cs, spec['file']
        assert str(spec['file']).startswith('artifacts/rc11/'),spec['file']
        assert spec.get('frozenEvidence',False), 'Final run needs explicit freeze evidence: '+spec['file']
        validate_hashes(raw,spec)
    for c in cs:
        c['actual']=clean(c.get('actual') or c.get('detail') or c.get('error') or ('原始断言通过' if c['status']=='passed' else '原始断言未满足'))
        c['key']=' / '.join(str(c[k]) for k in ('boundary','phase','name') if c.get(k))
        c['file']=spec['file']
    runs.append({**spec,'sha256':sha(p),'checks':cs})
    evidence.append(dict(file=spec['file'],sha256=sha(p),purpose=spec['scope']+' / '+spec['title']))
def find_requirement(item,scope):
    scopes=['最终ASAR','包内Node模型'] if scope=='最终ASAR' else [scope]
    relevant=[c for r in runs if r['scope'] in scopes for c in r['checks']]
    patterns=item.get('packagePatterns',item['patterns']) if scope=='最终ASAR' else item['patterns']
    groups=[[c for c in relevant if re.search(pattern,c['name'])] for pattern in patterns]
    all_cs=[c for group in groups for c in group]
    return status(all_cs) if all(groups) else '未验证',compact(all_cs),[p for p,g in zip(patterns,groups) if not g]
new=[]
for item in ROWS+cfg.get('additionalRequirements',[]):
    x={**item}
    for scope,key in [('冻结源码','source'),('最终ASAR','package')]:
        x[key+'Status'],x[key+'Evidence'],x[key+'Missing']=find_requirement(item,scope)
    if item.get('requiredScopes')==['source']:
        x['packageStatus']='不适用（模型专项）';x['packageEvidence']='本行仅报告冻结源码模型边界，不宣称ASAR界面效果';x['packageMissing']=[]
        x['status']=x['sourceStatus'];x['actual']=(x.get('observed','冻结源码模型边界断言通过') if x['status']=='通过' else '冻结源码模型边界：'+x['sourceStatus'])+'；不宣称Windows或ASAR界面效果'
    else:
        x['status']='失败' if '失败' in (x['sourceStatus'],x['packageStatus']) else '通过' if x['sourceStatus']==x['packageStatus']=='通过' else '未验证'
        x['actual']=x.get('observed','冻结源码与最终ASAR对应检查均满足预期') if x['status']=='通过' else '源码：'+x['sourceStatus']+'；ASAR：'+x['packageStatus']+'。未齐备的证据不记通过'
    x['version']='1.3.0-rc.11'
    x['implementationStatus']='已提供' if all((ROOT/p).exists() for p in re.findall(r'(?:src|assets)/[\w./-]+',x['implementation'])) else '待复核'
    x['limits']='Linux Electron；文件选择器与打开文件夹使用合成输入/替身，未运行Windows EXE、实体触屏或PPT' if x.get('testLayer')!='模型与文件边界' else '受控模型或文件测试，不代替Windows实际效果'
    if item['id'] in ('N023','N024'):
        x['actual']+='（冻结源码及最终包提取模块的Node模型层）'
        x['limits']='两侧均为Node模型/文件边界测试，不计Electron界面或Windows效果通过'
    related={'N012':'D008','N013':'D003','N017':'D001','N018':'D002、D006、D007','N019':'D001、D002','N020':'D004、D008','N031':'D005','N033':'D005','N036':'D005'}.get(item['id'])
    if related:x['fix']='相关问题 '+related+'，详见“问题与复验”；本行最终源码/包对应检查'+x['status']
    elif item.get('fix')=='新增功能；最终修复与复验过程见问题记录':x['fix']='新增功能；本行最终源码与包对应检查'+x['status']+'，未将早期候选结果计作最终通过'
    new.append(x)
features=[]
renames={
 '头像库异步解码晚到时不污染新编辑表单':'头像库异步读取晚到时不污染新编辑表单',
 'robot visible adoption starts LV1 zero growth with original ordinary data intact':'robot visible adoption starts as a shared egg at LV1 zero growth with original ordinary data intact',
 'phoenix visible adoption starts LV1 zero growth with original ordinary data intact':'phoenix visible adoption starts as a shared egg at LV1 zero growth with original ordinary data intact',
}
for old in base:
    p=next(r for r in prior['features'] if r['id']==old['id']); bound=[]; missing=[]
    for binding in old.get('bindings',[]):
        run=next((r for r in runs if r['id']==binding['runId']),None)
        bound_name=renames.get(binding['name'],binding['name'])
        c=next((c for c in run['checks'] if c['name']==bound_name),None) if run else None
        if c:bound.append(c)
        else:missing.append(binding)
    st='未验证' if old['id'] in WINDOWS or missing or not bound else status(bound)
    proof=compact(bound)
    implementation='已提供' if not missing and bound else '历史已提供，待当前复核'
    if old['id'] in cfg.get('implementationProof',{}):
        implementation='已提供'; proof=cfg['implementationProof'][old['id']]
    features.append(dict(id=old['id'],category=old['category'],module=old['module'],title=old['feature'],basis=old['basis'],assumptions=old.get('assumptions',''),steps=old['steps'],expected=old['expected'],historyStatus=p['rc10Status'],historyVersion='1.3.0-rc.10（历史）',historyEvidence=p['rc10Evidence'],status=st,actual='RC11冻结源码与最终ASAR对应检查通过' if st=='通过' else 'Windows现场效果仍未验证' if old['id'] in WINDOWS else '缺少本次完整绑定，保留历史结果但不计RC11通过',evidence=compact(bound),version='1.3.0-rc.11',fix='既有功能回归；不把RC10通过自动转为RC11通过',implementationStatus=implementation,implementationEvidence=proof,limits=old.get('limits') or '运行范围见各证据；Windows现场未执行',missingBindings=missing))
    if old['id'] in ('V017','V020'):features[-1]['fix']='沿用原要求；RC11头像由文件夹异步读取，原“异步解码”检查明确改名绑定为“异步读取”。'
    if old['id']=='RC6-13':features[-1]['fix']='按本次新要求将零成长领养检查更新为统一蛋；原成长、换宠及毕业规则仍逐项复验。'
assert len(features)==118
for file in cfg.get('evidenceFiles',[]):
    p=ROOT/file
    evidence.append(dict(file=file,sha256=sha(p),purpose='版本、复验与过程依据'))
unique={}
for e in evidence:
    if e['file'] in unique: assert unique[e['file']]['sha256']==e['sha256']
    else:unique[e['file']]=e
evidence=list(unique.values())
d={**cfg,'version':'1.3.0-rc.11','date':datetime.datetime.now(datetime.timezone.utc).date().isoformat(),'features':features,'newFeatures':new,'runs':runs,'evidence':evidence,'history':{'version':prior['version'],'sourceSha256':prior['source']['sha256'],'asarSha256':prior['package']['asarSha256'],'featurePassed':sum(f['rc10Status']=='通过' for f in prior['features'])},'windows':[f for f in features if f['id'] in WINDOWS]}
d.setdefault('defects',[])
d.setdefault('releaseGate','尚未完成冻结后全部复验，当前文件为制作预览')
(DIR/'report-input.json').write_text(json.dumps(d,ensure_ascii=False,indent=2))
print(json.dumps({'finalized':d.get('finalized',False),'newFeatures':len(new),'historicalFeatures':len(features),'runs':len(runs),'checks':sum(len(r['checks']) for r in runs)},ensure_ascii=False))
