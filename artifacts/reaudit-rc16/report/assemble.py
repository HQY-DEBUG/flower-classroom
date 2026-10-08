"""Bind the coordinator's final release groups, never discover or rerun tests."""
import argparse,copy,hashlib,json,re
from collections import Counter
from pathlib import Path
from prepare import flatten,logchecks
from report_context import QA_NOTES
D=Path(__file__).resolve().parent;ROOT=D.parents[2]
read=lambda p:json.loads((ROOT/p).read_text())
sha=lambda p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--release',default='artifacts/rc17/final-test-manifest.json');ap.add_argument('--freeze',default='artifacts/rc17/frozen-source.json');ap.add_argument('--context',default='artifacts/reaudit-rc16/report/final-context.json');a=ap.parse_args()
    release=read(a.release);freeze=read(a.freeze);context=read(a.context)
    assert release['releaseGate']['fullFinalSourceAndAsarRegression']
    assert release['releaseGate']['unresolvedDiscoveredDefects']==0
    assert context.get('coordinatorFinalIdentityConfirmed') is True
    ash=release['asarSha256'];assert context['confirmedAsarSha256']==ash
    ref=lambda p,loc='$':dict(path=p,sha256=sha(p),locator=loc)
    proofs={};runs=[];bindings=[];evidence={a.release,a.freeze,a.context}
    def proof(p):
        if p not in proofs:proofs[p]=read(p)
        return proofs[p]
    def linked(value,file):
        if isinstance(value,str):
            return value.replace('\\','/')==file or str(Path(value).resolve()if Path(value).is_absolute()else(ROOT/value).resolve())==str((ROOT/file).resolve())
        if isinstance(value,list):return any(linked(v,file)for v in value)
        if isinstance(value,dict):
            for k,v in value.items():
                if k in('evidenceDirectory','resultDirectory','outputDirectory')and isinstance(v,str):
                    p=Path(v);p=p if p.is_absolute()else ROOT/p
                    if(ROOT/file).resolve().is_relative_to(p.resolve()):return True
                if k in('report','result','results','resultFiles','file','path','evidenceFiles','output','log')and linked(v,file):return True
        return False
    def candidates(value,loc='$'):
        out=[]
        if isinstance(value,dict):
            if 'exitCode'in value or 'startedAt'in value or 'finishedAt'in value:out.append((loc,value))
            for k,v in value.items():out.extend(candidates(v,k if loc=='$'else loc+'.'+k))
        elif isinstance(value,list):
            for i,v in enumerate(value):out.extend(candidates(v,(''if loc=='$'else loc)+f'[{i}]'))
        return out
    def digest_loc(value,loc='$'):
        if isinstance(value,dict):
            for k,v in value.items():
                p=k if loc=='$'else loc+'.'+k
                if v==ash and k in('asar','asarSha256','asarSha256Before','asarSha256After','archiveSha256','archiveHash','sha256'):return p
            for k,v in value.items():
                found=digest_loc(v,k if loc=='$'else loc+'.'+k)
                if found:return found
        elif isinstance(value,list):
            for i,v in enumerate(value):
                found=digest_loc(v,(''if loc=='$'else loc)+f'[{i}]')
                if found:return found
        return None
    def select_execution(g,file):
        p=g['bindingProof'];data=proof(p)
        if isinstance(g.get('executionLocator'),dict):
            selector=g['executionLocator'];p=selector['file'];data=proof(p)
            if selector.get('locator'):
                loc=selector['locator'];obj=data
                if loc!='$':
                    for key,index in re.findall(r'(?:^|\.)([^.\[\]]+)|\[(\d+)\]',loc):obj=obj[key]if key else obj[int(index)]
                return ref(p,loc),obj
            rows=candidates(data)
            wanted_start=g.get('startedAt');wanted_end=g.get('completedAt')
            matches=[(loc,r)for loc,r in rows if r.get('suite')==selector.get('suite')and(not wanted_start or r.get('startedAt')==wanted_start)and(not wanted_end or(r.get('completedAt')or r.get('finishedAt'))==wanted_end)]
            if not matches and isinstance(data,dict)and data.get('startedAt')==wanted_start and(data.get('completedAt')or data.get('finishedAt'))==wanted_end:matches=[('$',data)]
            assert len(matches)==1,('original execution selector mismatch',g['group'],selector)
            loc,record=matches[0];return ref(p,loc),record
        if p==file and isinstance(data,dict):return ref(p),data
        if g.get('executionLocator'):
            loc=g['executionLocator'];obj=data
            if loc!='$':
                for key,index in re.findall(r'(?:^|\.)([^.\[\]]+)|\[(\d+)\]',loc):obj=obj[key]if key else obj[int(index)]
            return ref(p,loc),obj
        rows=candidates(data);matches=[(loc,r)for loc,r in rows if linked(r,file)]
        # The deepest original record preserves the specific suite execution.
        if matches:
            depth=max(loc.count('.')+loc.count('[')for loc,r in matches);matches=[(loc,r)for loc,r in matches if loc.count('.')+loc.count('[')==depth]
        if len(matches)!=1:
            suite=g.get('suite')or g['group']
            for prefix in('source-','legacy-targeted-','new-targeted-','features-','extension-','rc13-inherited-','rc15-'):
                if suite.startswith(prefix):suite=suite[len(prefix):];break
            suite={'known-flows':'primary','pet-care':'care','pet-switch':'switch','pet-extra':'petextra'}.get(suite,suite)
            matches=[(loc,r)for loc,r in rows if r.get('suite')==suite]
        assert len(matches)==1,('need explicit executionLocator',g['group'],file,[(loc,r.get('suite'))for loc,r in matches])
        loc,record=matches[0];return ref(p,loc),record
    def append(g,file,rid,reference=None):
        mode='source'if g['mode']=='source'else'package';p=g.get('originalBindingProof',g['bindingProof']);exe,record=select_execution(g,file)
        prefix='冻结源码'if mode=='source'else'最终ASAR'
        layer={'node':'Node测试'if mode=='source'else'提取Node测试','startup':'Linux Electron启动','preview':'预览服务'}.get(g.get('category'),'自动化回归')
        if g['group'].startswith('rc15-independent-'):
            layer='独立模型'if g.get('suite')in('modules','migration')else'目录结构'if g.get('suite')=='package'else'独立Linux Electron'
        if g.get('auditDomain'):
            layer='独立复核 '+{'avatars':'头像与名单','workbook':'工作簿与恢复','migration':'迁移与搬移','interactions':'跨功能交互','rules':'计分卡事务','imports':'导入与快照','classroom':'课堂交互'}[g['auditDomain']]
        spec=dict(id=rid,title=g.get('title',g['group']),file=file,scope=g.get('scope')or(prefix+' '+layer),bindingScope=mode,frozenEvidence=True,bindingProof=p)
        for k in('startedAt','completedAt'):
            value=record.get(k)or(record.get('finishedAt')if k=='completedAt'else None)
            if value:spec[k]=value
        runs.append(spec);b=dict(runId=rid,bindingScope=mode,evidence=dict(path=file,sha256=sha(file)),execution=exe)
        if reference:b['resultReference']=reference
        if g.get('companionExtractedNodeLog')or(g.get('category')=='node'and mode=='package'):b['companionExtractedNodeLog']=True
        if mode=='source':
            pr=proof(p)
            def complete(key):
                value=pr.get(key)if isinstance(pr,dict)else None
                return isinstance(value,dict)and all(value.get(k)==v for k,v in freeze['files'].items())
            before=next((key for key in('sourceBefore','sourceAtStart','initialSourceHashes')if complete(key)),None)
            after=next((key for key in('sourceAfter','sourceAtFinish','finalSourceHashes')if complete(key)),None)
            b['sourceBefore']=ref(p,before)if before else ref(a.freeze,'files')
            b['sourceAfter']=ref(p,after)if after else ref(a.release,'sourceFiles')
        else:
            loc=digest_loc(proof(p));identity_path=p
            if not loc:loc=digest_loc(read(file));identity_path=file
            assert loc,('missing actual ASAR identity',rid,p,file);b['packageIdentity']=ref(identity_path,loc)
        bindings.append(b);evidence.update((file,p,exe['path']))
    groups=release['groups']+context.get('additionalGroups',[])
    for i,g in enumerate(groups):
        totals=Counter()
        for j,file in enumerate(g['evidenceFiles']):
            checks=logchecks(ROOT/file)if file.endswith('.log')else flatten(read(file));assert checks,file
            for c in checks:totals['observed'if c['name'].startswith('Workbook format observation:')else c['status']]+=1
            rid=g.get('id')or g['mode']+'-'+g['group']
            if len(g['evidenceFiles'])>1:rid+='-'+str(j+1)
            reference=ref(a.release,f'groups[{i}]')if i<len(release['groups'])else ref(a.context,f'additionalGroups[{i-len(release["groups"])}]')
            append(g,file,rid,reference)
        for key in('passed','failed'):
            if key in g:assert totals[key]==g[key],(g['group'],totals,g[key])
        if 'observations'in g:assert totals['observed']==g['observations']
    files=[]
    for f in release['files']:
        p=Path(f['path']);assert p.is_file()and hashlib.sha256(p.read_bytes()).hexdigest()==f['sha256'];files.append(dict(name=f.get('name',p.name),bytes=p.stat().st_size,sha256=f['sha256']))
    for item in context.get('qaNotes',[])+context.get('findings',[]):
        for p in str(item.get('evidence',item.get('beforeEvidence',''))).splitlines():
            if(ROOT/p).is_file():evidence.add(p)
    evidence.update(context.get('evidenceFiles',[]))
    cfg={**context,'finalized':True,'releaseManifest':a.release,'bindingIndex':'artifacts/reaudit-rc16/report/binding-index.json',
        'baselineArchiveSha256':'c3d3d381a8c30b4d22df9f8a764d40c593cdfae41eada963f55a20c79c456bd7',
        'source':dict(at=freeze['frozenAt'],sha256=release['sourceTreeSha256'],files=freeze['files'],avatarAssets=freeze['avatarAssets']),
        'package':dict(asarSha256=ash,files=files),'runs':runs,'qaNotes':QA_NOTES+context.get('qaNotes',[]),'evidenceFiles':sorted(evidence)}
    index=dict(schemaVersion=1,freeze=ref(a.freeze),release=ref(a.release),asar=dict(path=context.get('asarPath','dist-rc17-final/win-unpacked/resources/app.asar'),sha256=ash),runs=bindings)
    (D/'binding-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2));(D/'final-config.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2))
    print(json.dumps(dict(finalRuns=len(runs),groups=len(groups),asarSha256=ash),ensure_ascii=False))
if __name__=='__main__':main()
