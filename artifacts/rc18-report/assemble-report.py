"""Create the report model from explicit, hash-bound RC18 selections only."""
from pathlib import Path
from collections import Counter
import argparse
import copy
import datetime as dt
import hashlib
import importlib.util
import json
import re

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
VERSION='1.3.0-rc.18'
spec=importlib.util.spec_from_file_location('rc18_finalizer',ROOT/'scripts/finalize-rc18.py')
finalizer=importlib.util.module_from_spec(spec);spec.loader.exec_module(finalizer)

def path(value):
    p=Path(value)
    p=p if p.is_absolute() else ROOT/p
    assert 'rc18-private-roster-qa' not in p.as_posix() and 'rc18-private-roster-qa' not in p.resolve().as_posix(), 'Private roster inputs are forbidden in public report assembly'
    return p

def read(value):return json.loads(path(value).read_text())
def sha(value):return hashlib.sha256(path(value).read_bytes()).hexdigest()
def relative(value):return str(path(value).resolve().relative_to(ROOT))

def locate(value,pointer):
    for t in pointer.split('/')[1:]:
        t=t.replace('~1','/').replace('~0','~')
        value=value[int(t)] if isinstance(value,list) else value[t]
    return value

def clean(value,limit=1800):
    if isinstance(value,(dict,list)):value=json.dumps(value,ensure_ascii=False,separators=(',',':'))
    value=str(value if value is not None else '')
    value=re.sub(r'data:image/[A-Za-z0-9.+-]+;base64,[A-Za-z0-9+/=]+','[合成图片数据省略，原始证据保留]',value)
    value=re.sub(r'/(?:workspace|tmp|root|home)/[^\s"\',)]+','[测试环境路径]',value)
    return value if len(value)<=limit else value[:limit]+'…完整值见原始证据'

def actual(check):
    for k in ['actual','detail','details','error']:
        if check.get(k) is not None:return clean(check[k])
    extra={k:v for k,v in check.items() if k not in ['name','status','case','id','title','startedAt','completedAt','pointer']}
    if extra:return clean(extra)
    return '断言满足预期；原日志未另记实际数值' if check.get('status')=='passed' else '原始检查未通过；完整原因见原始证据' if check.get('status')=='failed' else '仅观察，不计通过'

def evidence_text(checks):
    return '\n'.join(dict.fromkeys(c['file']+'#'+c['pointer'] for c in checks)) or '无本轮冻结对应证据'

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--release',default='artifacts/rc18/final-test-manifest.json')
    ap.add_argument('--context',default='artifacts/rc18-report/final-context.json')
    ap.add_argument('--preview',action='store_true')
    args=ap.parse_args()
    draft=read('artifacts/rc18-report/coverage-matrix-draft.json')
    if not args.preview:assert draft.get('denominatorFinalized') is True,'Wait for the complete configurable-parameter inventory and finalized requirement definitions'
    ctx=read(args.context)
    assert ctx.get('version')==VERSION
    if not args.preview:
        assert ctx.get('upgradeNote') and '等待' not in ctx['upgradeNote'],'Final report needs reviewed, current unified-configuration upgrade instructions'
        assert ctx.get('releaseGate') and '等待' not in ctx['releaseGate'],'Final report needs a concrete release conclusion and retained limits'
    release=read(args.release)
    assert release['version']==VERSION
    assert ctx.get('coordinatorFinalIdentityConfirmed') is True
    assert ctx.get('confirmedAsarSha256')==release['asarSha256']
    assert sha('dist-rc18-final/win-unpacked/resources/app.asar')==release['asarSha256']
    freeze=read('artifacts/rc18/frozen-source.json')
    assert sha('artifacts/rc18/frozen-source.json')==release['sourceManifestSha256']
    for file,digest in {**freeze['files'],**freeze['assetFiles'],**freeze['packageFiles'],**freeze['packagedDocuments']}.items():assert sha(file)==digest,file
    for file,digest in release['evidenceSha256'].items():assert sha(file)==digest,file
    evidence={relative(args.release):'最终发布选择与版本绑定',relative(args.context):'本轮需求绑定和过程说明','artifacts/rc18/frozen-source.json':'冻结源码、资源和打包文件','artifacts/rc18-report/coverage-matrix-draft.json':'稳定需求与本轮更新定义'}
    evidence.update({f:'原始冻结执行或发布证据' for f in release['evidenceSha256']})
    if draft.get('parameterInventoryEvidence'):
        inventory=draft['parameterInventoryEvidence']
        assert sha(inventory)==draft['parameterInventorySha256'],'Parameter inventory changed; refresh and review its report annex before finalizing'
        evidence[inventory]='经过复核的40项参数与作用域清单'
    for file in ctx.get('evidenceFiles',[]):
        evidence[relative(file)]='协调者提供的过程或补充证据'
    for screenshot in ctx.get('screenshots', []):
        assert screenshot.get('syntheticOnly') is True and screenshot.get('visuallyInspected') is True
        assert sha(screenshot['path']) == screenshot['sha256'], 'Synthetic final-ASAR screenshot has changed'
    for note in ctx.get('qaNotes',[]):
        for line in note.get('evidence','').splitlines():
            file=line.split('#',1)[0].strip()
            if file.startswith('artifacts/') and path(file).is_file():evidence[file]='过程说明：'+note['title']
    runs=[];used=set();check_index={'source':{},'package':{}}
    for group in release['groups']:
        mode='source' if group['mode']=='source' else 'package'
        categories={'node':'Node断言' if mode=='source' else '提取Node断言','startup':'Linux Electron启动','preview':'预览服务','regression':'应用回归'}
        scope=('冻结源码 ' if mode=='source' else '最终ASAR ')+categories[group['category']]
        selected=group.get('selectedAssertions')
        assert selected,('Finalizer must preserve exact selected assertion leaves',group['group'])
        assert Counter(c['status'] for c in selected)==Counter({'passed':group['passed'],'observed':group['observations']})
        for file in group['evidenceFiles']:
            assert sha(file)==group['evidenceSha256'][file]
            subset=[c for c in selected if c['file']==file]
            data=read(file) if file.endswith('.json') else None
            checks=[]
            for c in subset:
                key=(file,c['pointer']);assert key not in used,('Duplicate selected leaf',key);used.add(key)
                raw=locate(data,c['pointer']) if data is not None else {'name':c['name'],'status':c['status']}
                detail={**c,'actualText':actual(raw),'startedAt':group['startedAt'],'completedAt':group['completedAt'],'scope':scope,'classification':'product'}
                checks.append(detail)
                check_index[mode].setdefault(c['name'],[]).append(detail)
            rid=group['mode']+'-'+group['group']+('-'+str(group['evidenceFiles'].index(file)+1) if len(group['evidenceFiles'])>1 else '')
            runs.append({'id':rid,'title':group.get('title',group['group']),'file':file,'scope':scope,'bindingScope':mode,'stage':'最终冻结','version':VERSION,'startedAt':group['startedAt'],'completedAt':group['completedAt'],'sha256':sha(file),'bindingProof':group['originalBindingProof'],'checks':checks})
    expected_total=sum(g['passed']+g['observations'] for g in release['groups'])
    assert len(used)==expected_total
    # Development failures and corrected harness attempts are displayed, never
    # used by requirement matchers or headline final-assertion formulas.
    development=copy.deepcopy(ctx.get('developmentRuns',[]))
    listed={relative(r['file']) for r in development}
    for group in release['groups']:
        initial=group.get('execution',{}).get('initialAttempt')
        if not initial:continue
        files=initial.get('resultFiles',[])
        if not files and initial.get('log'):files=[initial['log']]
        assert files,'A replaced run needs retained initial output or log for report traceability'
        for file in files:
            file=relative(file)
            if file in listed:continue
            listed.add(file)
            development.append({'file':file,'sha256':sha(file),'id':'INITIAL-'+group['mode']+'-'+group['group'],
              'title':'替换前原始执行：'+group['group'],'classification':group['execution'].get('initialClassification','product'),
              'version':VERSION+' 未发布尝试','scope':'原始失败/后续复验替换',
              'startedAt':initial.get('startedAt'),'completedAt':initial.get('completedAt',initial.get('finishedAt')),
              'outcome':'failed' if initial.get('exitCode')!=0 else 'observed',
              'actual':'原运行退出码 '+str(initial.get('exitCode'))+'；'+group['execution'].get('selectionReason','见明确复验选择')})
    for run in development:
        assert run.get('file') and run.get('classification') in ['product','harness','environment']
        file=run['file'];assert sha(file)==run['sha256']
        checks=[]
        if file.endswith('.json'):
            for pointer,c in finalizer.collect_checks(read(file)):
                classification=run.get('checkClassifications',{}).get(c['name'],run['classification'])
                checks.append({**c,'file':file,'pointer':pointer,'actualText':actual(c),'classification':classification})
        if not checks:
            assert run.get('outcome'), 'A development attempt without machine-readable checks needs an explicit reported outcome'
            checks=[{'name':run['title'],'status':run['outcome'],'file':file,'pointer':'','actualText':run.get('actual','见保留的原始过程日志'),'classification':run['classification']}]
        elif len(checks)==1 and checks[0]['pointer']=='' and run.get('actual'):
            checks[0]['name']=run['title'];checks[0]['actualText']=run['actual']
        runs.append({**run,'stage':'开发过程','scope':run.get('scope','开发/诊断'),'checks':checks,'bindingProof':'不计最终断言或功能通过'})
        evidence[file]='保留的开发过程：'+run['title']
    overrides=ctx.get('requirementBindings',{})
    assert set(overrides)<=set(r['id'] for r in draft['requirements'])
    aliases=ctx.get('assertionAliases',{})
    for old,new in aliases.items():assert isinstance(new,dict) and new.get('name') and new.get('reason'),('Assertion alias needs explicit reason',old)
    baseline=read(draft['historicalBaseline']['reportInputFile'])
    old_source_count=len(baseline['source']['files']);current_source_count=len(freeze['files'])
    if old_source_count!=current_source_count:
        old_name=f'Loaded production entry matches all {old_source_count} frozen source files'
        aliases.setdefault(old_name,{'name':f'Loaded production entry matches all {current_source_count} frozen source files',
          'reason':'仅精确源码文件数量随本轮新增模块变化；仍要求实际生产入口逐文件匹配本轮冻结源码。'})
    requirements=[]
    for old in draft['requirements']:
        r=copy.deepcopy(old)
        exact=copy.deepcopy(r.get('expectedExactAssertions',{}))
        if r['id'] in overrides:
            o=overrides[r['id']]
            assert o.get('reason') and set(o.get('exactAssertions',{}))=={'source','package'},r['id']
            exact=o['exactAssertions'];r['bindingRevisionReason']=o['reason']
            if o.get('implementationEvidence'):r['implementationEvidence']=o['implementationEvidence']
        required=r.get('requiredScopes',['source','package'])
        combined=[]
        for mode in ['source','package']:
            names=[aliases.get(n,{}).get('name',n) for n in exact.get(mode,[])]
            names+=ctx.get('additionalRequirementAssertions',{}).get(r['id'],{}).get(mode,[])
            names=list(dict.fromkeys(names))
            selected=[];missing=[]
            for name in names:
                found=check_index[mode].get(name,[])
                if found:selected.extend(found)
                else:missing.append(name)
            selected=list({(c['file'],c['pointer']):c for c in selected}.values())
            if not names:missing=['未指定符合本轮定义的精确断言']
            passed=[c for c in selected if c['status']=='passed']
            status='通过' if names and not missing and len(passed)==len(selected) else '部分验证' if passed else '未验证'
            r[mode+'Status']=status;r[mode+'Missing']=missing;r[mode+'Evidence']=evidence_text(selected)
            combined+=selected
        r['exactBindings']=exact
        statuses=[r[m+'Status'] for m in required]
        r['status']='通过' if all(s=='通过' for s in statuses) else '部分验证' if any(s in ['通过','部分验证'] for s in statuses) else '未验证'
        r['actual']='\n'.join(c['name']+'：'+clean(c['actualText'],220) for c in list({c['name']:c for c in combined}.values())[:6]) or '尚无本轮冻结对应证据'
        r['implementationStatus']='已提供' if combined else '待核验'
        if r['platformUnverified']:
            r['status']='未验证';r['implementationStatus']='接口已提供，现场未验证' if combined else '现场未验证'
            r['actual']='Windows实机未执行。相关Linux或模型检查仅支持其受测层，不能替代此要求。'
        if required==['source']:r['packageStatus']='不适用';r['packageEvidence']='按原要求仅使用源码专项，不宣称包内专项完成'
        r['testTime']='；'.join(dict.fromkeys(c['startedAt'] for c in combined)) or '未执行'
        r['missingSummary']='\n'.join(m+': '+s for m in required for s in r[m+'Missing']) or '全部精确要求已绑定'
        r['fix']=ctx.get('requirementRepairs',{}).get(r['id'],r.get('replaces','沿用稳定要求定义，以本轮冻结证据重新核验'))
        requirements.append(r)
    assert len(requirements)==len({r['id'] for r in requirements})==len(draft['requirements'])
    missing=[{k:r.get(k) for k in ['id','title','status','sourceMissing','packageMissing']} for r in requirements if not r['platformUnverified'] and r['status']!='通过']
    (OUT/'unbound-requirements.json').write_text(json.dumps(missing,ensure_ascii=False,indent=2)+'\n')
    findings=[]
    for f in release.get('fixedFindings',[]):
        result=copy.deepcopy(f)
        for mode,source_mode in [('source','source'),('package','packaged')]:
            if mode=='package' and f.get('scope')=='source-preview-only':
                result[mode+'Status']='不适用';result[mode+'Evidence']='源码预览脚本不进入Windows ASAR'
                result[mode+'Actual']=f['packagedNotApplicableReason']
                continue
            cs=[c for n in f['afterAssertions'][source_mode] for c in check_index[mode].get(n,[])]
            assert cs and all(c['status']=='passed' for c in cs)
            result[mode+'Status']='通过';result[mode+'Evidence']=evidence_text(cs)
            result[mode+'Actual']='\n'.join(c['name']+'：'+clean(c['actualText'],250) for c in cs[:5])
        result['status']='已修复并复验';result['beforeEvidence']='\n'.join(v['file']+'#'+v['pointer'] for v in f['before'])
        result['before']=f.get('beforeSummary') or '原始修前结果及确切字段保留，见原始失败证据'
        findings.append(result)
    final_runs=[r for r in runs if r['stage']=='最终冻结']
    counts=Counter(c['status'] for r in final_runs for c in r['checks'])
    assert counts['failed']==0
    data={**draft,**ctx,'finalized':not args.preview,'date':dt.datetime.now(dt.timezone.utc).date().isoformat(),'requirements':requirements,'runs':runs,'findings':findings,
      'source':{'at':freeze['frozenAt'],'sha256':release['sourceTreeSha256'],'files':freeze['files'],'avatarAssets':freeze['avatarAssets']},
      'package':{'asarSha256':release['asarSha256'],'files':release['files']},
      'requirementCounts':dict(Counter(r['status'] for r in requirements)),
      'finalAssertionCounts':dict(counts),'finalExecutionRecords':sum(counts.values()),
      'historicalBaseline':draft['historicalBaseline'],'privateRosterQa':release['privateRosterQa'],
      'smartScreen':release['smartScreen'],'windows':[r for r in requirements if r['platformUnverified']],
      'supplementalVerifications':release.get('supplementalVerifications',[]),
      'finalExecutionCountsByScope':{scope:dict(Counter(c['status'] for r in final_runs if r['scope']==scope for c in r['checks'])) for scope in sorted({r['scope'] for r in final_runs})},
      'evidence':[{'id':f'E{i:03d}','file':f,'sha256':sha(f),'purpose':purpose} for i,(f,purpose) in enumerate(sorted(evidence.items()),1)],
      'bindingVerification':{'allEvidenceDigestsVerified':True,'sourceManifestSha256':release['sourceManifestSha256'],'finalSelection':relative(args.release),'finalSelectionSha256':sha(args.release),'selectedLeaves':len(used),'noDuplicateSelectedLeaf':True},
      'assertionAliases':aliases,
    }
    assert data['privateRosterQa']['status']=='passed','Requested two-class QA requires final sanitized aggregate'
    if not args.preview:assert not missing,('Unbound current requirements',[(r['id'],r['status']) for r in missing])
    data['currentAssertions']=counts['passed']
    if data['finalized']:
        data['definitionStage']=f'共{len(requirements)}项稳定要求；功能定义、参数作用域及最终冻结证据已逐项核对。Windows实机及其他明确限制继续单列。'
        data.pop('pendingScope',None)
        data['privacy']={**data.get('privacy',{}),'privateRosterQa':'已使用协调者脱敏汇总；真实姓名、原输入和原截图不进入报告；该场景不计最终合成断言数。'}
    (OUT/'report-input.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'requirements':data['requirementCounts'],'finalAssertions':dict(counts),'missingRequirements':len(missing),'output':str(OUT/'report-input.json')},ensure_ascii=False))

if __name__=='__main__':main()
