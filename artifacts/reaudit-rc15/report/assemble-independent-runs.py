"""Aggregate existing original reviewer records without running any product tests."""
import datetime,hashlib,importlib.util,json
from pathlib import Path
D=Path(__file__).resolve().parent;ROOT=D.parents[2]
def load(p):return json.loads(Path(p).read_text())
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rel(p):return str(Path(p).resolve().relative_to(ROOT))
def locate(d,selector):
    import re
    if selector=='$':return d
    for name,index in re.findall(r'(?:^|\.)([^.\[\]]+)|\[(\d+)\]',selector):d=d[name]if name else d[int(index)]
    return d
def normalized(m):return {(k if k.startswith('src/')else'src/'+k):(v['sha256']if isinstance(v,dict)else v)for k,v in m.items()}
freeze=load(ROOT/'artifacts/rc16/frozen-source.json');frozen=freeze['files'];asar=sha(ROOT/'dist-rc16-final/win-unpacked/resources/app.asar')
spec=importlib.util.spec_from_file_location('finalizer',ROOT/'scripts/finalize-rc16.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
rows=[];proofs={};leaf_ids=set();domain_counts={};dependencies=set()
def proof(file,selector):
    p=Path(file);data=load(p);proofs[(rel(p),selector)]=dict(file=rel(p),sha256=sha(p),locator=selector)
    dependencies.add(rel(p));return locate(data,selector)
def add(row,file,selector,before,after,selected):
    old=dict(row);source_before=normalized(before.get('source',before.get('src',{})));source_after=normalized(after.get('source',after.get('src',{})))
    assert source_before==source_after==frozen,(row['domain'],row['suite'],'source identity')
    assert before['asar']['sha256']==after['asar']['sha256']==asar
    assert row['exitCode']==0,(row['suite'],row['exitCode'])
    start=m.timestamp(row['startedAt'],row['suite']);end=m.timestamp(row['completedAt'],row['suite']);assert m.timestamp(freeze['frozenAt'],'freeze')<=start<=end
    record=proof(file,selector);assert all(record.get(k)==row.get(k)for k in['suite','mode','startedAt','completedAt','exitCode'])
    all_files=[str(p)for p in old.get('evidenceFiles',[])]
    selected=[Path(p)for p in selected]
    names=[]
    for p in selected:
        assert p.is_file(),p
        data=load(p);m.nested_execution_gate(data,str(p));leaves=m.collect_checks(data);assert leaves,p
        for pointer,leaf in leaves:
            assert leaf['status']=='passed',(p,pointer,leaf)
            identity=(str(p.resolve()),pointer);assert identity not in leaf_ids,identity;leaf_ids.add(identity);names.append(leaf['name'])
        dependencies.add(rel(p))
    suite=row['domain']+'-'+row['mode']+'-'+row['suite']
    rows.append({**old,'suite':suite,'originalSuite':old['suite'],'originalExecutionFile':rel(file),'originalExecutionLocator':selector,
                 'evidenceFiles':[rel(p)for p in selected], 'supportingEvidenceFiles':[str(p)for p in all_files if str(p)not in {str(x)for x in selected}],
                 'sourceBefore':source_before,'sourceAfter':source_after,'sourceUnchanged':True,'asarSha256':asar,'asarSha256Before':asar,'asarSha256After':asar,
                 'actualAssertionNames':names,'actualAssertionLeaves':len(names)})
    domain_counts.setdefault(row['domain'],{}).setdefault(row['mode'],0);domain_counts[row['domain']][row['mode']]+=len(names)

root=ROOT/'artifacts/rc16-independent-review'
file=root/'avatars-final/execution-rows.json'
for i,row in enumerate(load(file)):
    directory=Path(row['log']).parent
    before=proof(directory/'runtime-before.json','$');after=proof(directory/'runtime-after.json','$')
    add(row,file,f'[{i}]',before,after,[directory/'results.json'])

file=root/'workbook-final/execution-envelope.json';all_workbook=load(file)
selected_workbook=load(root/'workbook-final/final-selected-executions.json')
for row in selected_workbook['rows']:
    matches=[i for i,r in enumerate(all_workbook['rows'])if all(r.get(k)==row.get(k)for k in['suite','mode','startedAt','completedAt','exitCode'])];assert len(matches)==1
    before={'source':row['sourceBegin'],'asar':{'sha256':row['asarBegin']}}
    after={'source':row['sourceEnd'],'asar':{'sha256':row['asarEnd']}}
    add(row,file,f'rows[{matches[0]}]',before,after,[p for p in row['evidenceFiles']if Path(p).name=='assertions.json'])

file=root/'migration-final/final-rerun-envelope.json';data=load(file);before=proof(file,'before')
for i,row in enumerate(data['suites']):
    after=proof(file,f'suites[{i}].after')
    add(row,file,f'suites[{i}]',before,after,[p for p in row['evidenceFiles']if Path(p).name=='results.json'])
    before=after

file=root/'interactions-final/execution-envelope.json';data=load(file)
assert len(data['suites'])==len({(r['suite'],r['mode'])for r in data['suites']})
for i,row in enumerate(data['suites']):
    before=proof(file,f'suites[{i}].before');after=proof(file,f'suites[{i}].after')
    files=[p for p in row['evidenceFiles']if Path(p).name in['audit-results.json','restart-results.json','floor-model-results.json']]
    add(row,file,f'suites[{i}]',before,after,files)

assert {r['domain']for r in rows}=={'avatars','workbook','migration','interactions'}
rows.sort(key=lambda r:r['startedAt'])
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
envelope=dict(schemaVersion=1,version='1.3.0-rc.16',assembledFromOriginalRecords=True,aggregationCreatedAt=now,
              frozenAt=freeze['frozenAt'],sourceManifestSha256=sha(ROOT/'artifacts/rc16/frozen-source.json'),
              startedAt=min(r['startedAt']for r in rows),completedAt=max(r['completedAt']for r in rows),
              intervalDefinition='Minimum and maximum timestamps recorded by the selected original executions; aggregationCreatedAt is not an execution timestamp',
              sourceAtStart=rows[0]['sourceBefore'],sourceAtFinish=rows[-1]['sourceAfter'],sourceUnchanged=True,
              asarSha256Before=asar,asarSha256After=asar,asarUnchanged=True,
              originalRuntimeProofs=list(proofs.values()),suites=rows,actualLeafCountsByDomain=domain_counts,
              actualUniqueAssertionLeaves=len(leaf_ids),originalEvidenceSha256={p:sha(ROOT/p)for p in sorted(dependencies)},
              currentAdditionalVerification=dict(checkedAt=now,sourceStillMatchesFreeze=all(sha(ROOT/p)==h for p,h in frozen.items()),asarSha256=asar),
              syntheticOnly=True,windowsExecuted=False)
assert envelope['currentAdditionalVerification']['sourceStillMatchesFreeze']
out=ROOT/'artifacts/rc16/reaudit-final-runs.json';out.write_text(json.dumps(envelope,ensure_ascii=False,indent=2))
print(json.dumps({'executions':len(rows),'assertionLeaves':len(leaf_ids),'domains':domain_counts,'output':rel(out)},ensure_ascii=False))
