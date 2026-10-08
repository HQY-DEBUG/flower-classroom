"""Build the new re-audit report model exclusively from explicitly selected current evidence."""
import copy, datetime, hashlib, json, re, sys
from collections import Counter
from pathlib import Path
from new_requirements import ROWS
from report_context import ALIASES, OVERRIDES, QA_NOTES
from bindings import validate_index

D=Path(__file__).resolve().parent; ROOT=D.parents[2]
read=lambda p:json.loads(Path(p).read_text())
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
OLD=read(D/'baseline-report-input.json')
ORIGINAL=read(ROOT/'artifacts/rc13/report/report-input.json')
WINDOWS={'V033','V035','V037','V038','V052','V054','V067'}
BASE_SHA=None

def clean(value,limit=1400):
    if isinstance(value,(dict,list)):value=json.dumps(value,ensure_ascii=False,separators=(',',':'))
    t=str(value if value is not None else '')
    t=re.sub(r'data:image/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+',lambda m:'[合成图片数据，原始文本SHA256 '+hashlib.sha256(m[0].encode()).hexdigest()+']',t)
    t=re.sub(r'/(?:workspace|tmp|root|home)/[^\s"\',)]+','[测试环境路径]',t)
    t=re.sub(r'\n\s+at .*','',t)
    return t if len(t)<=limit else t[:limit]+'…（完整记录见原始证据）'

def flatten(x,loc='',inherited_name=''):
    if isinstance(x,list):return [c for i,r in enumerate(x)for c in flatten(r,f'{loc}[{i}].',inherited_name)]
    if not isinstance(x,dict):return []
    inherited_name=x.get('name')or inherited_name
    if isinstance(x.get('leaves'),list):
        scenarios={c.get('name'):c for c in x.get('checks',[])if isinstance(c,dict)}
        return [{**c,'name':(c.get('case')+' / 'if c.get('case')else'')+c['name'],
            'originalName':c['name'],'locator':f'{loc}leaves[{i}]',
            'startedAt':scenarios.get(c.get('case'),{}).get('startedAt'),
            'completedAt':scenarios.get(c.get('case'),{}).get('endedAt')or scenarios.get(c.get('case'),{}).get('completedAt')}
            for i,c in enumerate(x['leaves'])]
    if isinstance(x.get('receiptRecovered'),bool)and isinstance(x.get('passed'),bool):
        return [dict(name='Exact rule-save retry recovers existing receipt after lost action and receipt responses',status='passed'if x['passed']else'failed',detail=x,locator=loc.rstrip('.')or'$')]
    if x.get('status') in ('passed','failed','observed','skipped'):
        return [{**x,'name':inherited_name or loc.rstrip('.')or'Case result','locator':loc.rstrip('.')}]
    if isinstance(x.get('checks'),list):
        return [{**c,'name':c.get('name')or c.get('title')or c.get('id')or f"{c.get('role','')} {c.get('width','')}x{c.get('height','')} zoom {c.get('zoom','')}",'locator':f'{loc}checks[{i}]'}for i,c in enumerate(x['checks'])]
    if isinstance(x.get('report'),dict):return flatten(x['report'],loc+'report.',inherited_name)
    for key in ('runs','results'):
        if isinstance(x.get(key),list):return [c for i,r in enumerate(x[key])for c in flatten(r,f'{loc}{key}[{i}].',inherited_name)]
    if isinstance(x.get('result'),dict):return flatten(x['result'],loc+'result.',inherited_name)
    if isinstance(x.get('restarts'),list):return [dict(name='Actual new-process reload: '+r['name'],status='passed'if r['status']==0 else'failed',detail=r,locator=f'{loc}restarts[{i}]')for i,r in enumerate(x['restarts'])]
    if isinstance(x.get('passed'),bool):
        name=inherited_name or ('Process interruption/recovery phase: '+x['phase']if x.get('phase')else'Fresh Electron recovery reconciles saved classroom and workbook: '+x['boundary']if x.get('boundary')else'Fresh Electron process reloads exact saved state')
        return [dict(name=name,status='passed'if x['passed']else'failed',detail=x,locator=loc.rstrip('.')or'$')]
    if 'stateEqual'in x:return [dict(name='Fresh Electron process reloads exact saved state without transient dialogs',status='passed'if x.get('stateEqual')and x.get('transientModalsAbsent')else'failed',detail=x,locator=loc.rstrip('.')or'$')]
    if isinstance(x.get('exitCode'),int) and x['exitCode']!=0:
        return [dict(name='Execution failed before assertion report: '+str(x.get('scenario')or x.get('suite')or x.get('name')or'unnamed process'),status='failed',detail=x,locator=loc.rstrip('.')or'$')]
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

def bind_prior(r,scope):
    oldchecks={(x['file'],c['locator']):c for x in OLD['runs']if x['stage']=='最终冻结'for c in x['checks']}
    file=None;out=[]
    for line in r.get(scope+'Evidence','').splitlines():
        if line.startswith('artifacts/'):
            file=line.strip();continue
        for loc in line.split(', '):
            if(file,loc)in oldchecks:out.append(oldchecks[(file,loc)]['name'])
    return list(dict.fromkeys(out))

def status(checks,missing):
    if any(c['status']=='failed'for c in checks):return '失败'
    if checks and not missing and all(c['status']=='passed'for c in checks):return '通过'
    if any(c['status']=='passed'for c in checks):return '部分验证'
    return '未验证'

def compact(cs):
    groups={}
    for c in cs:groups.setdefault(c['file'],[]).append(c['locator'])
    return '\n'.join(f+'\n'+', '.join(dict.fromkeys(locs))for f,locs in groups.items())or'无本轮冻结证据'

def main():
    cfg=read(sys.argv[1])if len(sys.argv)>1 else dict(finalized=False,runs=[])
    version=cfg.get('version','1.3.0-rc.16')
    if not cfg.get('qaNotes'):cfg['qaNotes']=copy.deepcopy(QA_NOTES)
    oldavatars={p:h for p,h in ORIGINAL['source']['avatarAssets'].items()if p.lower().endswith('.png')}
    newavatars={p:h for p,h in cfg.get('source',{}).get('avatarAssets',{}).items()if p.lower().endswith('.png')}
    lineage=dict(originalCount=len(oldavatars),currentCount=len(newavatars),addedCount=len(set(newavatars)-set(oldavatars)),originalHashesPreserved=bool(newavatars)and all(newavatars.get(p)==h for p,h in oldavatars.items()))
    lineage['verified']=lineage==dict(originalCount=40,currentCount=120,addedCount=80,originalHashesPreserved=True)
    if cfg.get('finalized'):
        assert cfg.get('releaseManifest'),'Final release manifest required'
        assert cfg['source']['sha256'] and cfg['package']['asarSha256']
        assert re.fullmatch('[0-9a-f]{64}',cfg.get('baselineArchiveSha256','')),'Delivered RC16 archive baseline hash required'
        for f,h in {**cfg['source']['files'],**cfg['source'].get('avatarAssets',{})}.items():assert sha(ROOT/f)==h,f
        release=read(ROOT/cfg['releaseManifest'])
        assert release.get('sourceTreeSha256')==cfg['source']['sha256']
        assert release.get('asarSha256')==cfg['package']['asarSha256']
        assert release.get('sourceAndPackageSame')and release.get('archiveVerificationPassed')
        assert lineage['verified'],lineage
        binding_verification=validate_index(ROOT,cfg)
    evidence={};runs=[]
    def add_evidence(file,purpose):
        if file and(ROOT/file).is_file():
            evidence.setdefault(file,dict(file=file,sha256=sha(ROOT/file),purpose=purpose))
    def verify_raw(raw,spec):
        if not isinstance(raw,dict):return
        for k in ('sourceChanged',):
            if k in raw:assert raw[k]is False,(spec['file'],k)
        for k in ('sourceUnchanged','archiveUnchanged','asarUnchanged','codeUnchanged','matchesFreeze'):
            if k in raw:assert raw[k]is True,(spec['file'],k)
        for k in ('archiveSha256','archiveHash','archiveSha','asarSha256','initialArchiveSha256','finalArchiveSha256','asarSha256Before','asarSha256After'):
            if raw.get(k):assert raw[k]==cfg['package']['asarSha256'],(spec['file'],k)
        for k in ('sourceAtStart','sourceAtFinish','sourceBefore','sourceAfter','startHashes','endHashes','sourceHashes','initialSourceHashes','finalSourceHashes','sourceSha256','initialHashes','finalHashes','loadedSourceHashes','sourceFiles','sourceFilesAfter','loadedSourceFiles','codeHashes','currentCodeHashes','reviewedHashes','reviewedFileHashes','beforeHashes','afterHashes'):
            h=raw.get(k)
            if isinstance(h,dict):
                for f,digest in h.items():
                    f=f if f.startswith(('src/','assets/'))else'src/'+f
                    if isinstance(digest,str)and f in cfg['source'].get('files',{}):assert digest==cfg['source']['files'][f],(spec['file'],k,f)
        for k in ('runs','results'):
            if isinstance(raw.get(k),list):
                for x in raw[k]:verify_raw(x,spec)
        for k in ('report','result'):
            if isinstance(raw.get(k),dict):verify_raw(raw[k],spec)
    for spec in cfg.get('runs',[])+cfg.get('developmentRuns',[]):
        p=ROOT/spec['file'];assert p.is_file(),p
        raw=read(p)if p.suffix=='.json'else None
        cs=flatten(raw)if raw is not None else logchecks(p)
        if spec.get('observationRows'):
            assert not spec.get('frozenEvidence')
            observed=raw if isinstance(raw,list)else raw['results']
            cs=[dict(name='RC16诊断观察：'+str(c.get('mode')or c.get('variant')or c.get('name')or c.get('suite')or i)+((' / '+c['phase'])if c.get('phase')else''),status='observed',detail=c,locator=(f'[{i}]'if isinstance(raw,list)else f'results[{i}]'))for i,c in enumerate(observed)]
        if spec.get('caseSide'):
            assert not spec.get('frozenEvidence')and spec['caseSide']in('before','after')
            side=spec['caseSide'];cs=[{**item[side],'locator':f'cases[{i}].{side}'}for i,item in enumerate(raw['cases'])]
        stage='最终冻结'if spec.get('frozenEvidence')else'测试环境或脚本问题'if spec.get('classification')in('harness','environment')else'本轮诊断过程'
        if stage=='最终冻结':
            assert spec.get('bindingScope')in('source','package'),spec
            assert cs,spec['file'];verify_raw(raw,spec)
            assert spec.get('bindingProof'),'Each final run needs a hash-bound manifest or explicit proof'
            assert(ROOT/spec['bindingProof']).is_file(),spec['bindingProof']
            verify_raw(read(ROOT/spec['bindingProof']),spec)
            add_evidence(spec['bindingProof'],'冻结运行与代码绑定依据')
        for c in cs:
            c['classification']=spec.get('checkClassifications',{}).get(c['name'],spec.get('classification','product'))
            if c['name'].startswith('Workbook format observation:'):c['originalStatus']=c['status'];c['status']='observed'
            value=c.get('actual')if c.get('actual')is not None else c.get('detail')if c.get('detail')is not None else c.get('details')if c.get('details')is not None else c.get('error')
            if value is None:
                extra={k:v for k,v in c.items()if k not in('name','title','id','status','originalStatus','locator','file','classification','originalName','case','startedAt','completedAt','beganAt','finishedAt','endedAt')}
                value=extra or None
            c['actualText']=clean(value)if value is not None else'断言满足预期；原日志未另记实际数值'if c['status']=='passed'else'原始断言未满足'if c['status']=='failed'else'仅观察或未执行，不计通过'
            c['file']=spec['file']
        rr={**spec,'checks':cs,'stage':stage,'sha256':sha(p),'version':version if stage=='最终冻结'else spec.get('version','RC16交付版诊断，精确哈希见原始记录')}
        if isinstance(raw,dict):
            rr.setdefault('startedAt',raw.get('startedAt')or raw.get('createdAt')or raw.get('time')or raw.get('at'))
            rr.setdefault('completedAt',raw.get('completedAt')or raw.get('finishedAt')or raw.get('endedAt'))
        runs.append(rr);add_evidence(spec['file'],stage+' / '+spec['title'])
    final=[r for r in runs if r['stage']=='最终冻结']
    allchecks={scope:[c for r in final if r['bindingScope']==scope for c in r['checks']]for scope in('source','package')}
    aliases={**ALIASES,**cfg.get('nameAliases',{})}
    if cfg.get('source',{}).get('files'):
        old_count=len(OLD['source']['files']);new_count=len(cfg['source']['files'])
        aliases.setdefault(f'Loaded production entry matches all {old_count} frozen source files',f'Loaded production entry matches all {new_count} frozen source files')
    def match(patterns,scope,exact=False):
        groups=[[c for c in allchecks[scope]if c['name']==aliases.get(p,p)]if exact else[c for c in allchecks[scope]if re.search(p,c['name'],re.I)]for p in patterns]
        cs=list({(c['file'],c['locator']):c for g in groups for c in g}.values())
        missing=[p for p,g in zip(patterns,groups)if not g]
        if not patterns:missing=['无适用最终冻结证据']
        return status(cs,missing),cs,missing
    requirements=[]
    for old in OLD['requirements']:
        r=copy.deepcopy(old)
        r.update(historicalStatus=old['status'],historicalEvidence=old['sourceEvidence']+'\n'+old['packageEvidence'],historicalVersion='1.3.0-rc.16',version=version)
        r['auditFindings']='本轮未单列该项产品问题'
        names={scope:bind_prior(old,scope)for scope in('source','package')}
        r['legacyExactBindings']=names
        r['exactBindings']={scope:[aliases.get(name,name)for name in selected]for scope,selected in names.items()}
        r['fix']='RC16交付行为按本轮新执行证据重新判定，历史通过不自动继承'
        if r['id'] in OVERRIDES:
            r['historicalEvidence']='RC14原要求：'+old['title']+'；'+old['expected']+'\n'+r['historicalEvidence']
            r.update(copy.deepcopy(OVERRIDES[r['id']]))
            r.pop('exactBindings',None)
            r['fix']='按RC15目录版明确要求更新；旧定义及历史结果保留，本轮对应检查重新执行'
        if r['id'] in cfg.get('requirementOverrides',{}):
            override=copy.deepcopy(cfg['requirementOverrides'][r['id']])
            if 'patterns' in override:r.pop('exactBindings',None)
            r.update(override)
        requirements.append(r)
    requirements.extend(copy.deepcopy(ROWS))
    for r in requirements:
        if r['id'] in cfg.get('requirementOverrides',{}):
            override=copy.deepcopy(cfg['requirementOverrides'][r['id']])
            if 'patterns' in override:r.pop('exactBindings',None)
            r.update(override)
    for r in requirements:
        r['version']=version;selected=[]
        for scope in('source','package'):
            exact='exactBindings'in r;pats=r['exactBindings'][scope]if exact else r.get('patternsByScope',{}).get(scope,r['patterns'])
            st,cs,missing=match(pats,scope,exact)
            extras=r.get('additionalExactBindings',{}).get(scope,[])
            if extras:
                _,extra_checks,extra_missing=match(extras,scope,True)
                cs=list({(c['file'],c['locator']):c for c in cs+extra_checks}.values())
                missing+=extra_missing
                st=status(cs,missing)
            r[scope+'Status']=st;r[scope+'Evidence']=compact(cs);r[scope+'Missing']=missing
            selected.extend(cs)
        required=r.get('requiredScopes',['source','package'])
        states=[r[s+'Status']for s in required]
        if r['id']in WINDOWS or r.get('alwaysUnverified'):r['status']='未验证'
        elif'失败'in states:r['status']='失败'
        elif all(s=='通过'for s in states):r['status']='通过'
        elif any(s in('通过','部分验证')for s in states):r['status']='部分验证'
        else:r['status']='未验证'
        if required==['source']:r['packageStatus']='不要求单独ASAR';r['packageEvidence']='该历史要求按原定义仅源码专项，不宣称完成同项ASAR专项'
        selected=list({(c['file'],c['locator']):c for c in selected}.values())
        r['actual']='\n'.join(c['name']+'：'+clean(c['actualText'],160)for c in list({c['name']:c for c in selected}.values())[:5])or'尚无本轮冻结对应证据'
        if r['id']=='R14-15':
            r['actual']='冻结素材清单：原40张SHA256逐一保留；新增'+str(lineage['addedCount'])+'张；总数'+str(lineage['currentCount'])+'张。'+'\n'+r['actual']if lineage['verified']else'尚未完成40+80素材身份核对。\n'+r['actual']
            if not lineage['verified']and r['status']=='通过':r['status']='部分验证'
        if r['id']in WINDOWS or r.get('alwaysUnverified'):r['actual']='Windows现场未执行。相关模型或Linux证据仅支持各自测试层。'
        missing=[scope+': '+p for scope in required for p in r[scope+'Missing']]
        r['missingSummary']='\n'.join(missing)or'所需证据已绑定'
        r['testTime']='；'.join(dict.fromkeys(str(x.get('startedAt')or'原日志未记录')for x in final if any(c in selected for c in x['checks'])))or'未执行或未记录'
        r.setdefault('fix','RC15新增行为，见本行源码及ASAR复验依据')
        r.setdefault('historicalStatus','本轮新增要求');r.setdefault('historicalEvidence','无历史通过结论')
        if selected and r.get('implementationStatus')=='待绑定':r['implementationStatus']='已提供'
    assert len(requirements)==190 and len({r['id']for r in requirements})==190
    findings=[]
    for f in cfg.get('findings',[]):
        f=copy.deepcopy(f)
        for scope in('source','package'):
            st,cs,missing=match(f.get('patternsByScope',{}).get(scope,f['patterns']),scope)
            f[scope+'Status']=st;f[scope+'Evidence']=compact(cs);f[scope+'Missing']=missing
            f[scope+'Actual']='\n'.join(c['name']+'：'+clean(c['actualText'],170)for c in cs)
        required=f.get('requiredScopes',['source','package'])
        if required==['source']:
            f['packageStatus']='不适用';f['packageEvidence']='源码预览工具问题，不属于Windows运行包';f['packageActual']='未修改ASAR运行代码，不要求同项ASAR复验'
        if required==['package']:
            f['sourceStatus']='不适用';f['sourceEvidence']='打包产物专属问题，不属于源码运行缺陷';f['sourceActual']='通过精确ASAR和实际目录产物复验'
        ss=[f[scope+'Status']for scope in required]
        f['status']='复验仍失败'if'失败'in ss else'已修复并复验'if all(s=='通过'for s in ss)else'待完整复验'
        findings.append(f)
        for r in requirements:
            if r['id'] in f.get('requirementIds',[]):
                r['auditFindings']=(r['auditFindings']+'；'if r['auditFindings']!='本轮未单列该项产品问题'else'')+f['id']+' '+f['title']
                r['fix']=f['fix']
        for p in f.get('beforeEvidence','').splitlines():add_evidence(p,'RC16本轮问题原始失败 '+f['id'])
    for p in ['artifacts/rc16-report/RC16-REPORT-MANIFEST.json','artifacts/reaudit-rc16/report/baseline-report-input.json','artifacts/reaudit-rc16/report/baseline-delivery-identity.json','artifacts/rc10/specialized-audit-status.json',*cfg.get('evidenceFiles',[])]:add_evidence(p,'来源、历史或发布证明')
    for shot in cfg.get('screenshots',[]):
        assert shot.get('syntheticOnly')is True
        add_evidence(shot['file'],'合成UI截图：'+shot['caption'])
    if cfg.get('releaseManifest'):add_evidence(cfg['releaseManifest'],'本轮最终发布门槛')
    if cfg.get('bindingIndex'):add_evidence(cfg['bindingIndex'],'每条最终输出的精确字节、执行记录及版本绑定')
    for i,e in enumerate(evidence.values(),1):e['id']=f'E{i:03}'
    data={**cfg,'version':version,'date':datetime.datetime.now(datetime.timezone.utc).date().isoformat(),'baselineArchiveSha256':cfg.get('baselineArchiveSha256','待绑定RC16交付7z'),'requirements':requirements,'runs':runs,'findings':findings,'evidence':list(evidence.values()),'windows':[r for r in requirements if r['id']in WINDOWS or r.get('alwaysUnverified')],'originalWindowsIds':sorted(WINDOWS),'newWindowsIds':['R14-W01','R14-W02'],'requirementCounts':dict(Counter(r['status']for r in requirements)),'historicalBaseline':read(D/'baseline-delivery-identity.json')['historicalBaseline'],'upgradeNote':cfg.get('upgradeNote',OLD['upgradeNote'])}
    data.setdefault('releaseGate','制作中：等待最终源码冻结、精确ASAR和对应全部回归；不能作为交付通过结论。')
    data['finalExecutionCountsByScope']={scope:dict(Counter(c['status']for r in final if r['scope']==scope for c in r['checks']))for scope in sorted({r['scope']for r in final})}
    development=[r for r in runs if r['stage']!='最终冻结']
    data['diagnosticCountsByClass']={kind:dict(Counter(c['status']for r in development for c in r['checks']if c.get('classification','product')==kind))for kind in sorted({c.get('classification','product')for r in development for c in r['checks']})}
    data['sourceCounts']=dict(Counter(r['sourceKind']for r in requirements))
    data['avatarLineage']=lineage
    previous={p:h for p,h in OLD['source']['avatarAssets'].items()if p.lower().endswith('.png')}
    data['baselineAvatarIdentity']={'count':len(previous),'all120Preserved':bool(newavatars)and all(newavatars.get(p)==h for p,h in previous.items())}
    if cfg.get('finalized'):assert data['baselineAvatarIdentity']['all120Preserved']
    data['bindingVerification']=binding_verification if cfg.get('finalized')else{'verified':False,'reason':'Not final'}
    dest=Path(sys.argv[2])if len(sys.argv)>2 else D/'report-input.json';dest.write_text(json.dumps(data,ensure_ascii=False,indent=2))
    (dest.parent/'unbound-requirements.json').write_text(json.dumps([dict(id=r['id'],title=r['title'],status=r['status'],sourceMissing=r['sourceMissing'],packageMissing=r['packageMissing'])for r in requirements if r['status']not in('通过',)and r['id']not in WINDOWS and not r.get('alwaysUnverified')],ensure_ascii=False,indent=2))
    print(json.dumps({'finalized':data.get('finalized',False),'requirements':data['requirementCounts'],'runs':len(runs),'finalRawChecks':sum(len(r['checks'])for r in final),'output':str(dest)},ensure_ascii=False))

if __name__=='__main__':main()
