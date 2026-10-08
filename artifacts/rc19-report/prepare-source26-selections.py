"""Validate the coordinator's explicit fresh source26 choices without rerunning."""
from pathlib import Path
from types import SimpleNamespace
import copy
import hashlib
import importlib.util
import json
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'artifacts/rc19'
BASE=ROOT.parent.parent/'flower-rc18-work/FlowerClassroom-source'
FIRST='artifacts/rc19/regular-source/20261007T135121.548819Z-c46bc923'
RETRY='artifacts/rc19/regular-source/20261007T135953.716839Z-ee00fe76'
spec=importlib.util.spec_from_file_location('rc19_finalizer',ROOT/'scripts/finalize-rc19.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
def read(p):return json.loads(Path(p).read_text())
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def write(p,d):Path(p).write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
f=gate.Finalizer(SimpleNamespace(retests=None,check_only=True,selection=None,roster_summary=None,findings=None))
f.current_files_gate()
baseline=read(BASE/'artifacts/rc18/final-test-manifest.json')
old=[g for g in baseline['groups'] if g['mode']=='source' and g['group'].startswith('source-')]
assert len(old)==26
first=read(ROOT/FIRST/'runs.json');retry=read(ROOT/RETRY/'runs.json')
assert len(first)==26 and len(retry)==1 and retry[0]['suite']=='modal-headers'
maps=[]
for filename in ['inherited-application-exact-name-map.json','workbook-inherited-case-name-migrations.json']:
    p=OUT/filename
    if p.is_file():
        value=read(p);maps+=(value if isinstance(value,list) else value.get('migrations',[]))
selections=[];contracts=[];review=[];errors=[]
for historical in old:
    suite=historical['suite'];is_retry=suite=='modal-headers';folder=RETRY if is_retry else FIRST
    rows=retry if is_retry else first;matches=[(i,r) for i,r in enumerate(rows) if r['suite']==suite];assert len(matches)==1
    index,raw=matches[0];row=copy.deepcopy(raw);proof=folder+'/binding.json';execution=folder+'/runs.json'
    outputs=row.get('availableEvidenceFiles') or row.get('evidenceFiles');assert outputs
    item={'mode':'source','group':historical['group'],'suite':suite,'category':historical['category'],'proof':proof,'executionFile':execution,'executionPointer':'/'+str(index),'evidenceFiles':outputs}
    if is_retry:
        original_index=next(i for i,r in enumerate(first) if r['suite']==suite);original=first[original_index]
        item.update(replaces={'executionFile':FIRST+'/runs.json','executionPointer':'/'+str(original_index),'suite':suite,'proof':FIRST+'/binding.json','evidenceFiles':original.get('availableEvidenceFiles') or original.get('evidenceFiles',[])},selectionReason='协调者明确选用恢复后同一最终冻结源码的完整317例modal重试；原始失败运行保留，不计最终。',initialClassification='harness')
    expected=[c['name'] for c in historical['selectedAssertions']];changes=[]
    old_identity=f'Loaded production entry matches all {baseline["sourceFileCount"]} frozen source files'
    new_identity=f'Loaded production entry matches all {len(f.source)} frozen source files'
    if old_identity in expected and old_identity!=new_identity:
        expected=[new_identity if n==old_identity else n for n in expected]
        changes.append({'original':old_identity,'replacement':new_identity,'reason':'Only the frozen source-file count changes; the actual production entry must still match every file in this exact freeze','definitionFile':'artifacts/rc19/frozen-source.json','sourceManifestSha256':f.freeze_sha})
    scripts=set(row.get('harnessAtStart',{}))
    for mapping in maps:
        a=mapping.get('original');b=mapping.get('replacement')
        if mapping.get('file') in scripts and isinstance(a,str) and isinstance(b,str) and a in expected and a!=b:
            expected=[b if n==a else n for n in expected];changes.append({'file':mapping['file'],'original':a,'replacement':b})
    try:
        f.proof(proof,'source')
        selected=f.choose(historical['group'],'source',row,outputs,proof)
        if historical['category']=='node':
            count,checks=f.node_log(outputs[0]);assert count==834,'Coordinator declared expected final source Node count834'
            command_tests={gate.rel(p) for p in row['command'] if isinstance(p,str) and p.endswith('.test.cjs')}
            assert '--test' in row['command'] and command_tests=={gate.rel(p) for p in (ROOT/'tests').glob('*.test.cjs')}
            actual=f.add(historical['group'],'source',selected,proof,'node',checks)
            expected=[c['name'] for c in actual['selectedAssertions']]
            provenance={'currentFullTestFileCommandVerified':True,'expectedCountApprovedByCoordinator':834,'namesBoundToActualCompletedFullNodeLog':outputs[0],'logSha256':sha(ROOT/outputs[0])}
        else:
            actual=f.add(historical['group'],'source',selected,proof,historical['category'])
            provenance={'historicalNamesOnly':True,'reviewedCurrentNameMappings':changes}
        actual_names=[c['name'] for c in actual['selectedAssertions']]
        if sorted(expected)!=sorted(actual_names):
            from collections import Counter
            missing=list((Counter(expected)-Counter(actual_names)).elements());extra=list((Counter(actual_names)-Counter(expected)).elements())
            raise AssertionError('Declared current name-set mismatch: '+json.dumps({'missing':missing,'extra':extra},ensure_ascii=False))
        expected_passed=834 if historical['category']=='node' else historical['passed']
        assert actual['passed']==expected_passed and actual['observations']==historical['observations']
        contract={'mode':'source','group':historical['group'],'category':historical['category'],'expectedPassed':expected_passed,'expectedObservations':historical['observations'],'expectedAssertionNames':expected,**provenance}
        contracts.append(contract);selections.append(item);review.append({'group':historical['group'],'verified':True,'passedAssertions':actual['passed'],'observations':actual['observations'],'selectedExecution':execution+'#/'+str(index)})
    except Exception as error:
        errors.append({'group':historical['group'],'error':str(error),'selectedExecution':execution+'#/'+str(index)})
result={'schemaVersion':1,'version':'1.3.0-rc.19','partial':True,'coordinatorSelected':False,'sourceManifestSha256':f.freeze_sha,'asarSha256':f.asar_sha,'scope':'Only the26 explicitly chosen fresh source groups; not final220-group acceptance','groups':selections,'unresolvedValidationErrors':errors}
write(OUT/'source26-final-selection-candidate.json',result)
write(OUT/'source26-completion-contract-candidate.json',{'version':'1.3.0-rc.19','coordinatorReviewed':False,'scope':'Source26 exact completion contract for coordinator full-union review','groups':contracts})
write(OUT/'source26-final-selection-review.json',{'checkedGroups':len(old),'verifiedGroups':len(review),'errors':errors,'groups':review,'applicationSuitesExecuted':False,'previousLostResultsUsed':False})
print(json.dumps({'verifiedSourceGroups':len(review),'expectedSourceGroups':26,'errors':errors},ensure_ascii=False))
