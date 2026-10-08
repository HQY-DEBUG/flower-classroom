"""Select only the coordinator's immutable final release groups; do not rerun tests."""
import copy,hashlib,json,re
from pathlib import Path
from collections import Counter
from prepare import flatten,logchecks
from report_context import FINDINGS,QA_NOTES
D=Path(__file__).resolve().parent;ROOT=D.parents[2]
read=lambda p:json.loads((ROOT/p).read_text())
sha=lambda p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
release_path='artifacts/rc14/final-test-manifest.json';freeze_path='artifacts/rc14/frozen-source.json'
release=read(release_path);freeze=read(freeze_path);ash=release['asarSha256']
assert release['releaseGate']['fullFinalSourceAndAsarRegression']and release['releaseGate']['unresolvedDiscoveredDefects']==0
ref=lambda p,loc='$':dict(path=p,sha256=sha(p),locator=loc)
proofs={};runs=[];bindings=[];evidence=set([release_path,freeze_path,'artifacts/rc14/asar-source-match.json','artifacts/rc14-independent-review/final-review.json'])
def proof(p):
    if p not in proofs:proofs[p]=read(p)
    return proofs[p]
def suite_name(g):
    s=g['group']
    for prefix in ('source-','legacy-targeted-','new-targeted-','features-','extension-','rc13-inherited-','rc14-'):
        if s.startswith(prefix):s=s[len(prefix):];break
    return {'known-flows':'primary','pet-care':'care','pet-switch':'switch','pet-extra':'petextra'}.get(s,s)
def find_digest(x,loc=''):
    if isinstance(x,dict):
        for k,v in x.items():
            p=loc+'.'+k if loc else k
            if v==ash and k in('asarSha256','archiveSha256','archiveHash','sha256'):return p
        for k,v in x.items():
            got=find_digest(v,loc+'.'+k if loc else k)
            if got:return got
    elif isinstance(x,list):
        for i,v in enumerate(x):
            got=find_digest(v,f'{loc}[{i}]')
            if got:return got
    return None
def execution(g,file):
    p=g['bindingProof'];data=proof(p)
    if g['group']=='rc14-independent':
        k='responseLoss'if'/response-loss/'in file else'crashRecovery'if file.endswith('restart-results.json')else'feature'
        return ref(p,'runs.'+g['mode']+'.'+k),data['runs'][g['mode']][k]
    rows=data if isinstance(data,list)else data.get('suites')or data.get('results')
    if rows is not None:
        matches=[(i,r)for i,r in enumerate(rows)if r.get('suite')==suite_name(g)]
        assert len(matches)==1,(g['group'],suite_name(g),[r.get('suite')for r in rows])
        i,r=matches[0];prefix=''if isinstance(data,list)else'suites'if'suites'in data else'results'
        return ref(p,f'{prefix}[{i}]'),r
    return ref(p),data
def append(rid,title,mode,file,bproof,exe,record,reference=None,scope=None,companion=False):
    assert(ROOT/file).is_file(),file
    scope=scope or('冻结源码 Linux Electron'if mode=='source'else'最终ASAR Linux Electron')
    spec=dict(id=rid,title=title,file=file,scope=scope,bindingScope=mode,frozenEvidence=True,bindingProof=bproof)
    for k in('startedAt','completedAt'):
        if record.get(k):spec[k]=record[k]
    if record.get('finishedAt')and not spec.get('completedAt'):spec['completedAt']=record['finishedAt']
    runs.append(spec)
    b=dict(runId=rid,bindingScope=mode,evidence=dict(path=file,sha256=sha(file)),execution=exe)
    if reference:b['resultReference']=reference
    if companion:b['companionExtractedNodeLog']=True
    if mode=='source':b.update(sourceBefore=ref(freeze_path,'files'),sourceAfter=ref(release_path,'sourceFiles'))
    else:
        data=proof(bproof);loc=find_digest(data)
        if loc:b['packageIdentity']=ref(bproof,loc)
        else:
            loc=find_digest(read(file));assert loc,('missing actual ASAR identity',rid,bproof,file)
            b['packageIdentity']=ref(file,loc)
    bindings.append(b);evidence.update([file,bproof,exe['path']])
for i,g in enumerate(release['groups']):
    total=Counter()
    for j,file in enumerate(g['evidenceFiles']):
        cs=flatten(read(file));assert cs,file
        for c in cs:total['observed'if c['name'].startswith('Workbook format observation:')else c['status']]+=1
        mode='source'if g['mode']=='source'else'package'
        rid=g['group']if g['group'].startswith('source-')else g['mode']+'-'+g['group']
        if len(g['evidenceFiles'])>1:rid+='-'+str(j+1)
        exe,record=execution(g,file)
        append(rid,g['group'],mode,file,g['bindingProof'],exe,record,ref(release_path,f'groups[{i}]'))
    assert total['passed']==g['passed']and total['failed']==g['failed']and total['observed']==g['observations'],(g['group'],total,g)

source_runs='artifacts/rc14/source-final-runs.json';unit_index=next(i for i,r in enumerate(read(source_runs))if r['suite']=='unit')
append('source-node','源码Node模型与预览服务测试','source','artifacts/rc14/source-unit.log',source_runs,ref(source_runs,f'[{unit_index}]'),read(source_runs)[unit_index],scope='冻结源码 Node测试')
pu='artifacts/rc14/package-unit/results.json';append('package-node','最终ASAR提取Node模型','package','artifacts/rc14/package-unit/run.log',pu,ref(pu),read(pu),scope='最终ASAR提取 Node测试',companion=True)
startup='artifacts/rc14/startup-identity/results.json';append('package-startup','启动路径与配置','package',startup,startup,ref(startup),read(startup),scope='最终ASAR 启动专项')
preview='artifacts/rc14/ui-review/preview/results.json';append('source-preview','预览资源与生命周期','source',preview,preview,ref(preview),read(preview),scope='冻结源码 预览资源')

dev=[]
for rid,title,f in [
 ('dev-score-initial','200%脚本时序修正前','artifacts/rc14/score-editor-initial/results.json'),
 ('dev-avatar-selection','路径选区修复前','artifacts/rc14/avatar-access-source/resolved-selection-regression/failure.json'),
 ('dev-linked-fixture','旧关联与独立夹具早期区分','artifacts/rc14-independent-review/legacy-linked-ui-finding.json'),
 ('dev-linked-message','旧关联文案真实失败','artifacts/rc14-independent-review/legacy-linked-message-reproduction.json'),
 ('dev-response-loss','第一冻结通信双丢失真实失败','artifacts/rc14-independent-review/response-loss-review/result.json')]:
    if(ROOT/f).exists():dev.append(dict(id=rid,title=title,file=f,scope='RC14开发过程 Linux Electron',bindingScope='source',frozenEvidence=False))
for q in QA_NOTES:
    for f in q['evidence'].splitlines():
        if(ROOT/f).is_file():evidence.add(f)
for f in FINDINGS:
    for p in f['beforeEvidence'].splitlines():
        if(ROOT/p).is_file():evidence.add(p)
files=[]
for f in release['files']:
    p=Path(f['path']);assert p.is_file()and hashlib.sha256(p.read_bytes()).hexdigest()==f['sha256'];files.append(dict(name=f['name'],bytes=f['bytes'],sha256=f['sha256']))
shots=[]
for f,title,caption in[
 ('artifacts/rc14/focused-packaged/score-editor/02-rule-editor.png','计分卡就地编辑','最终ASAR合成界面：名称、积分和成长独立编辑；编辑和保存规则本身不直接奖励。'),
 ('artifacts/rc14/focused-packaged/avatar-access/01-settings-avatar-folder.png','头像实际目录和明确入口','最终ASAR合成设置页：实际头像路径、打开头像文件夹及刷新头像库。Windows系统窗口未在此截图中验证。')]:
    if(ROOT/f).is_file():shots.append(dict(file=f,title=title,caption=caption,syntheticOnly=True))
cfg=dict(finalized=True,releaseManifest=release_path,bindingIndex='artifacts/rc14/report/binding-index.json',source=dict(at=freeze['frozenAt'],sha256=release['sourceTreeSha256'],files=freeze['files'],avatarAssets=freeze['avatarAssets']),package=dict(asarSha256=ash,files=files),runs=runs,developmentRuns=dev,findings=FINDINGS,qaNotes=QA_NOTES,screenshots=shots,evidenceFiles=sorted(evidence),releaseGate='本轮冻结源码和精确ASAR的覆盖内回归完成，4类已发现问题均经修复及最终复验。176项要求重新逐项判定；原7项及新增2项Windows现场验收仍未验证，此前停止的专项另列未完成。')
index=dict(schemaVersion=1,freeze=ref(freeze_path),release=ref(release_path),asar=dict(path='dist-rc14-final/win-unpacked/resources/app.asar',sha256=ash),runs=bindings)
(D/'binding-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2));(D/'final-config.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2))
print(json.dumps(dict(finalRuns=len(runs),developmentRuns=len(dev),groups=len(release['groups']),screenshots=len(shots)),ensure_ascii=False))
