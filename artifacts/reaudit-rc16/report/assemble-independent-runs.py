"""Select original post-freeze reviewer rows; never run product tests or invent times."""
import argparse,datetime,hashlib,importlib.util,json,re
from pathlib import Path
D=Path(__file__).resolve().parent;ROOT=D.parents[2]
def path(p):
    p=Path(p);return p if p.is_absolute()else ROOT/p
def load(p):return json.loads(path(p).read_text())
def sha(p):return hashlib.sha256(path(p).read_bytes()).hexdigest()
def rel(p):return path(p).resolve().relative_to(ROOT.resolve()).as_posix()
def locate(value,selector):
    if selector in ('$',None,''):return value
    for name,index in re.findall(r'(?:^|\.)([^.\[\]]+)|\[(\d+)\]',selector):value=value[name]if name else value[int(index)]
    return value
def normalized(values):
    result={}
    for k,v in values.items():
        if isinstance(v,dict):v=v.get('sha256')
        if not isinstance(v,str)or not re.fullmatch('[a-f0-9]{64}',v):continue
        if '/src/'in k:k='src/'+k.rsplit('/src/',1)[-1]
        if '/'not in k:k='src/'+k
        result[k]=v
    return result
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--inputs',default='artifacts/reaudit-rc16/report/independent-inputs.json');ap.add_argument('--output',default='artifacts/rc17/reaudit-final-runs.json');ap.add_argument('--partial',action='store_true');a=ap.parse_args()
    config=load(a.inputs);freeze_path='artifacts/rc17/frozen-source.json';freeze=load(freeze_path);frozen=freeze['files'];asar_path='dist-rc17-final/win-unpacked/resources/app.asar';asar=sha(asar_path)
    spec=importlib.util.spec_from_file_location('finalizer',ROOT/'scripts/finalize-rc17.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    rows=[];proofs={};leaves_seen=set();counts={};dependencies=set();exclusions=[]
    def proof(reference,i=None):
        file=reference['file'];selector=reference.get('locator','$');selector=selector.replace('{i}',str(i))if i is not None else selector
        p=path(file);assert p.is_file(),p
        proofs[(rel(p),selector)]={'file':rel(p),'sha256':sha(p),'locator':selector};dependencies.add(rel(p));return locate(load(p),selector)
    def identity(value,context,reference):
        values=locate(value,reference['sourceKey'])if reference.get('sourceKey')else value.get('source',value.get('src',value.get('sourceFiles',value.get('sourceHashes',{}))))
        if isinstance(values,dict)and isinstance(values.get('files'),dict):values=values['files']
        sources=normalized(values);assert all(sources.get(k)==v for k,v in frozen.items()),(context,'missing or stale runtime source identity')
        ash=locate(value,reference['asarKey'])if reference.get('asarKey')else value.get('asarSha256')or value.get('archiveSha256')or(value.get('asar',{}).get('sha256')if isinstance(value.get('asar'),dict)else None)
        assert ash==asar,(context,'wrong/missing actual ASAR identity',ash)
        return {k:sources[k]for k in frozen},ash
    for item in config['inputs']:
        if not path(item['recordFile']).is_file():
            if a.partial:continue
            raise FileNotFoundError(item['recordFile'])
        doc=load(item['recordFile']);root_selector=item.get('rowsLocator','$');original=locate(doc,root_selector)
        assert isinstance(original,list)and original,item['recordFile']
        for i,r in enumerate(original):
            if item.get('selectedSuites')and r.get('suite')not in item['selectedSuites']:continue
            if item.get('selectedIndices')and i not in item['selectedIndices']:
                reason=item.get('excludedIndices',{}).get(str(i));assert reason,('Unexplained excluded original row',item['id'],i)
                selector=(f'[{i}]'if root_selector=='$'else root_selector+f'[{i}]')
                proof({'file':item['recordFile'],'locator':selector})
                exclusions.append({'file':rel(item['recordFile']),'sha256':sha(item['recordFile']),'locator':selector,'reason':reason,'originalExitCode':r.get('exitCode'),'startedAt':r.get('startedAt'),'completedAt':r.get('completedAt')or r.get('finishedAt')or r.get('endedAt')})
                continue
            raw_mode=r['id'].split('/')[0]if item.get('modeIdPrefix')else r.get('mode',item.get('mode'));mode={'asar':'packaged','package':'packaged'}.get(raw_mode,raw_mode);assert mode in('source','packaged'),raw_mode
            domain=item['domain'];assert domain in('rules','imports','migration','classroom')
            selector=(f'[{i}]'if root_selector=='$'else root_selector+f'[{i}]')
            record=proof({'file':item['recordFile'],'locator':selector})
            before_ref={**item['before']};after_ref={**item['after']}
            if before_ref.get('fromRow'):before_ref['file']=r[before_ref.pop('fromRow')]
            if after_ref.get('fromRow'):after_ref['file']=r[after_ref.pop('fromRow')]
            before=proof(before_ref,i);after=proof(after_ref,i)
            sb,ab=identity(before,item['id']+' before',before_ref);sa,aa=identity(after,item['id']+' after',after_ref);assert sb==sa and ab==aa
            start=r.get('startedAt');end=r.get('completedAt')or r.get('finishedAt')or r.get('endedAt');assert r.get('exitCode')==0,(item['id'],r)
            assert m.timestamp(freeze['frozenAt'],'freeze')<=m.timestamp(start,'run start')<=m.timestamp(end,'run end')
            if before.get('checkedAt')or before.get('capturedAt'):assert m.timestamp(before.get('checkedAt')or before['capturedAt'],'identity before')<=m.timestamp(start,'run start')
            if after.get('checkedAt')or after.get('capturedAt'):assert m.timestamp(after.get('checkedAt')or after['capturedAt'],'identity after')>=m.timestamp(end,'run end')
            assert r.get('script')and r.get('scriptSha256')and sha(r['script'])==r['scriptSha256'],(item['id'],'runner identity')
            assert r.get('scriptUnchanged',True)is True,(item['id'],'runner changed during execution')
            if r.get('scriptSha256After'):assert r['scriptSha256After']==r['scriptSha256'],(item['id'],'runner before/after identity')
            raw_evidence=list(r.get(item.get('evidenceKey','evidenceFiles'),[]));selected=list(raw_evidence)
            if item.get('evidenceNames'):selected=[p for p in selected if Path(p).name in item['evidenceNames']]
            assert selected,(item['id'],r.get('suite'),'missing selected assertion files')
            names=[]
            for file in selected:
                file=rel(file);data=load(file);m.nested_execution_gate(data,file);leaves=m.collect_checks(data);assert leaves,file
                for pointer,c in leaves:
                    assert c['status']=='passed',(file,pointer,c)
                    key=(file,pointer);assert key not in leaves_seen,('duplicate selected result',key);leaves_seen.add(key);names.append(c['name'])
                dependencies.add(file)
            original_suite=r[item.get('suiteKey','suite')];suite=item['id']+'-'+mode+'-'+original_suite;assert suite not in {x['suite']for x in rows},suite
            rows.append({**record,'suite':suite,'mode':mode,'domain':domain,'originalSuite':original_suite,
                'originalExecutionFile':rel(item['recordFile']),'originalExecutionLocator':selector,
                'startedAt':start,'completedAt':end,'evidenceFiles':[rel(p)for p in selected],
                'supportingEvidenceFiles':[rel(p)for p in raw_evidence if p not in selected and path(p).is_relative_to(ROOT)],
                'sourceBefore':sb,'sourceAfter':sa,'sourceUnchanged':True,'asarSha256':asar,'asarSha256Before':asar,'asarSha256After':asar,
                'originalIdentityProofs':{'before':before_ref,'after':after_ref},
                'actualAssertionNames':names,'actualAssertionLeaves':len(names)})
            counts.setdefault(domain,{}).setdefault(mode,0);counts[domain][mode]+=len(names)
    assert rows,'No completed original rows selected'
    if not a.partial:
        assert {r['domain']for r in rows}=={'rules','imports','migration','classroom'}
        for domain in counts:assert set(counts[domain])=={'source','packaged'},domain
    rows.sort(key=lambda r:r['startedAt']);now=datetime.datetime.now(datetime.timezone.utc).isoformat()
    assert all(sha(k)==v for k,v in frozen.items()),'Current source differs from frozen bytes'
    envelope={'schemaVersion':1,'version':'1.3.0-rc.17','partial':a.partial,'assembledFromOriginalRecords':True,'aggregationCreatedAt':now,
        'frozenAt':freeze['frozenAt'],'sourceManifestSha256':sha(freeze_path),
        'startedAt':min(r['startedAt']for r in rows),'completedAt':max(r['completedAt']for r in rows),
        'intervalDefinition':'Original selected execution timestamps; aggregationCreatedAt is not an execution timestamp',
        'sourceAtStart':rows[0]['sourceBefore'],'sourceAtFinish':rows[-1]['sourceAfter'],'sourceUnchanged':True,
        'asarSha256Before':asar,'asarSha256After':asar,'asarUnchanged':True,'originalRuntimeProofs':list(proofs.values()),
        'suites':rows,'selectionExclusions':exclusions,'actualLeafCountsByDomain':counts,'actualUniqueAssertionLeaves':len(leaves_seen),
        'originalEvidenceSha256':{p:sha(p)for p in sorted(dependencies)},
        'currentAdditionalVerification':{'checkedAt':now,'sourceStillMatchesFreeze':True,'asarSha256':asar},
        'syntheticOnly':True,'windowsExecuted':False}
    out=path(a.output);assert not out.exists(),'Do not overwrite a selected final envelope';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(envelope,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'executions':len(rows),'assertions':len(leaves_seen),'domains':counts,'partial':a.partial,'output':rel(out)}))
if __name__=='__main__':main()
