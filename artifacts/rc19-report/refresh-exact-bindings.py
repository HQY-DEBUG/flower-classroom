"""Apply reviewed exact case-name migrations to report expectations only."""
from pathlib import Path
from collections import defaultdict
import json
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
records=json.loads((ROOT/'artifacts/rc19/inherited-application-exact-name-map.json').read_text())
baseline_root=ROOT.parent.parent/'flower-rc18-work/FlowerClassroom-source'
baseline=json.loads((baseline_root/'artifacts/rc18/final-test-manifest.json').read_text())
matrix=json.loads((OUT/'coverage-matrix-draft.json').read_text())
scoped={}
for requirement in matrix['requirements']:
    for mode,label in [('source','source'),('packaged','package')]:
        names=defaultdict(set)
        for group in baseline['groups']:
            if group['mode']!=mode or not any(file+'#' in requirement.get('historicalEvidence','') for file in group['evidenceFiles']):continue
            scripts=set(group.get('execution',{}).get('harnessAtStart',{}))
            for record in records:
                if record.get('file') in scripts:names[record['original']].add(record['replacement'])
        scoped[(requirement['id'],label)]=names
def expand(names,rid,mode):
    mapping=scoped.get((rid,mode),{})
    return list(dict.fromkeys(y for x in names for y in sorted(mapping.get(x,{x}))))
changes=0
for filename in ['coverage-matrix-draft.json','final-context-draft.json','proposed-current-bindings.json']:
    p=OUT/filename;d=json.loads(p.read_text())
    def fix(value,rid):
        global changes
        for k,v in value.items():
            if isinstance(v,list) and all(isinstance(x,str) for x in v):
                new=expand(v,rid,k);changes+=new!=v;value[k]=new
    for requirement in d.get('requirements',[]):fix(requirement.get('expectedExactAssertions',{}),requirement['id'])
    for rid,binding in d.get('requirementBindings',{}).items():fix(binding.get('exactAssertions',{}),rid)
    for rid,bindings in d.get('additionalRequirementAssertions',{}).items():fix(bindings,rid)
    if filename=='final-context-draft.json':
        d['qaNotes']=[q for q in d['qaNotes'] if q['id']!='Q19-05']+[{'id':'Q19-05','title':'旧测试模板说明不代表当前实现','actual':'部分继承工具自动生成的历史说明仍含旧六段成长、新毕业或LV1描述。正式结论只采用本轮精确断言、状态与版本证据，不把旧报告模板文字当作RC19行为。','evidence':'artifacts/rc19/legacy-harness-report-prose-clarifications.json'}]
        optional_explanations=['artifacts/rc19/inherited-application-exact-name-map.json','artifacts/rc19/legacy-harness-report-prose-clarifications.json']
        d['evidenceFiles']=list(dict.fromkeys([f for f in d['evidenceFiles'] if f not in optional_explanations or (ROOT/f).is_file()]+[f for f in optional_explanations if (ROOT/f).is_file()]))
        for note in d['qaNotes']:
            if note['id']=='Q19-05' and not (ROOT/optional_explanations[1]).is_file():note['evidence']='原说明JSON未恢复；当前精确名称迁移表及任务记录保留该解释'
    p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'assertionListsUpdated':changes,'scriptScopedCaseNameMappingsAvailable':len(records),'executionOutcomesChanged':0}))
