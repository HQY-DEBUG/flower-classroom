"""Strict final report binding to immutable bytes and original execution records."""
import datetime,hashlib,json,re
from pathlib import Path

def validate_index(root,cfg):
    def path(p):
        assert isinstance(p,str)and not Path(p).is_absolute(),('binding path must be relative',p)
        q=(root/p).resolve();assert q.is_relative_to(root.resolve())and q.is_file(),p
        return q
    def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
    def ref(obj):
        q=path(obj['path']);assert sha(q)==obj['sha256'],obj['path'];return json.loads(q.read_text())
    def locate(value,locator):
        if not locator or locator=='$':return value
        assert re.fullmatch(r'(?:[A-Za-z0-9_-]+|\[\d+\])(?:\.[A-Za-z0-9_-]+|\[\d+\])*',locator),('invalid original-record locator',locator)
        for name,index in re.findall(r'(?:^|\.)([^.\[\]]+)|\[(\d+)\]',locator):value=value[name]if name else value[int(index)]
        return value
    def resolve(obj):return locate(ref(obj),obj.get('locator','$'))
    def digest_map(m):
        assert isinstance(m,dict)and m
        return {(k if k.startswith(('src/','assets/'))else'src/'+k):v for k,v in m.items()if isinstance(v,str)and re.fullmatch('[0-9a-f]{64}',v)}
    def source_map(obj):
        m=digest_map(resolve(obj));assert all(m.get(k)==v for k,v in cfg['source']['files'].items()),('incomplete/mismatched source identity',obj['path']);return m
    def links(record,file,base=root):
        if isinstance(record,str):
            return record.replace('\\','/')==file or str((base/record).resolve())==str((root/file).resolve())
        if isinstance(record,list):return any(links(x,file,base)for x in record)
        if isinstance(record,dict):
            for k,v in record.items():
                if k in('evidenceDirectory','resultDirectory','outputDirectory')and isinstance(v,str):
                    directory=Path(v);directory=directory if directory.is_absolute()else root/directory
                    if(root/file).resolve().is_relative_to(directory.resolve()):return True
                if k in('evidence','evidenceFiles','result','results','report','resultFiles','file','artifact','artifacts','log','path','output')and links(v,file,base):return True
            return False
        return False
    def good(record):
        assert isinstance(record,dict),record
        if 'harnessError'in record:assert not record['harnessError'],record
        if 'exitCode'in record:assert record['exitCode']==0,record
        elif isinstance(record.get('passed'),bool):assert record['passed'],record
        elif isinstance(record.get('phases'),list):assert record['phases']and all(x.get('passed')is True for x in record['phases'])and record.get('passed')==len(record['phases']),record
        elif isinstance(record.get('failed'),int):assert record['failed']==0 and record.get('passed',0)>0,record
        elif isinstance(record.get('checks'),list):assert record['checks']and all(x.get('status')in('passed','observed')for x in record['checks']),record
        elif isinstance(record.get('results'),list):
            assert record['results'],record
            for child in record['results']:good(child)
        elif 'status'in record:assert record['status']in(0,'passed'),record
        else:raise AssertionError(('execution record lacks an explicit completed outcome',record))
    index_path=cfg['bindingIndex'];index=json.loads(path(index_path).read_text())
    assert index.get('schemaVersion')==1
    freeze=ref(index['freeze']);release=ref(index['release'])
    assert index['release']['path']==cfg['releaseManifest']
    frozen_map=freeze['files'];source_tree=hashlib.sha256(json.dumps(frozen_map,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    assert source_tree==cfg['source']['sha256']==release['sourceTreeSha256']
    assert frozen_map==cfg['source']['files']
    assert release.get('sourceAndPackageSame')and release.get('archiveVerificationPassed')
    if'releaseGate'in release:assert release['releaseGate'].get('fullFinalSourceAndAsarRegression')is True
    assert freeze['frozenAt']==cfg['source']['at']
    assert sha(path(index['asar']['path']))==index['asar']['sha256']==cfg['package']['asarSha256']==release['asarSha256']
    rows=index['runs'];assert len({r['runId']for r in rows})==len(rows)
    selected=[r for r in cfg['runs']if r.get('frozenEvidence')]
    assert {r['runId']for r in rows}=={r['id']for r in selected}
    assert len({(r['bindingScope'],r['evidence']['path'])for r in rows})==len(rows),'Duplicate final evidence file/scope'
    byid={r['runId']:r for r in rows};file_scopes={};freeze_time=datetime.datetime.fromisoformat(freeze['frozenAt'].replace('Z','+00:00'))
    audit_time=datetime.datetime.fromisoformat(cfg['auditNotBefore'].replace('Z','+00:00'))
    for spec in selected:
        b=byid[spec['id']];assert b['bindingScope']==spec['bindingScope']
        assert b['evidence']['path']==spec['file'];ref_file=path(b['evidence']['path']);assert sha(ref_file)==b['evidence']['sha256']
        assert spec['file']not in file_scopes or file_scopes[spec['file']]==spec['bindingScope'],'Evidence reused across source/package scopes'
        file_scopes[spec['file']]=spec['bindingScope']
        record=resolve(b['execution']);good(record)
        assert record.get('startedAt') and (record.get('completedAt') or record.get('finishedAt')), ('current run requires original execution times',spec['id'])
        linked=b['execution']['path']==spec['file']or links(record,spec['file'],(root/b['execution']['path']).parent)
        if not linked and b.get('resultReference'):linked=links(resolve(b['resultReference']),spec['file'],(root/b['resultReference']['path']).parent)
        if not linked and b.get('companionExtractedNodeLog'):
            assert spec['file']==str(Path(b['execution']['path']).with_name('run.log'))
            assert record.get('asarSha256')==cfg['package']['asarSha256']and record.get('sourceFilesEqual')==len(cfg['source']['files'])
            assert isinstance(record.get('excludedSourceOnlyTests'),list)
            txt=ref_file.read_text();p=re.search(r'(?:ℹ|#) pass (\d+)',txt);f=re.search(r'(?:ℹ|#) fail (\d+)',txt)
            assert p and f and int(p[1])==record['passed']and int(f[1])==record['failed']==0
            linked=True
        assert linked,('Original execution/release record does not link selected output',spec['id'],spec['file'])
        for k in('startedAt','completedAt'):
            actual=record.get(k)or(record.get('finishedAt')if k=='completedAt'else None)
            if actual:
                if spec.get(k):assert spec[k]==actual,(spec['id'],k)
                dt=datetime.datetime.fromisoformat(actual.replace('Z','+00:00'));assert dt>=max(freeze_time,audit_time),(spec['id'],k,'before current audit or final freeze')
        if record.get('startedAt')and(record.get('completedAt')or record.get('finishedAt')):
            assert datetime.datetime.fromisoformat(record['startedAt'].replace('Z','+00:00'))<=datetime.datetime.fromisoformat((record.get('completedAt')or record['finishedAt']).replace('Z','+00:00'))
        if spec['bindingScope']=='source':
            source_map(b['sourceBefore']);source_map(b['sourceAfter'])
            # Source checks cannot be promoted merely by pointing an old output
            # at a new freeze. Require a dated original execution record.
            assert record.get('startedAt') and (record.get('completedAt') or record.get('finishedAt')), ('source execution lacks original run times',spec['id'])
        else:
            actual=resolve(b['packageIdentity']);assert actual==cfg['package']['asarSha256'],('actual execution ASAR differs',spec['id'])
        # A normalized index is never an identity proof for itself.
        for k in('execution','resultReference','sourceBefore','sourceAfter','packageIdentity'):
            if b.get(k):assert b[k]['path']!=index_path
    return {'bindingIndex':index_path,'runs':len(rows),'sourceTreeSha256':source_tree,'asarSha256':index['asar']['sha256'],'allEvidenceDigestsAndExecutionLinksVerified':True}
