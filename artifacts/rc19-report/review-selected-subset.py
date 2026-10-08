"""Read-only strict subset review; never emits the final release manifest."""
from pathlib import Path
from types import SimpleNamespace
import argparse
import copy
import importlib.util
import json
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('rc19_finalizer',ROOT/'scripts/finalize-rc19.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
ap=argparse.ArgumentParser();ap.add_argument('selection');ap.add_argument('output');args=ap.parse_args()
f=gate.Finalizer(SimpleNamespace(retests=None,check_only=True,selection=None,roster_summary=None,findings=None));f.current_files_gate()
selection=gate.read(args.selection);assert selection['sourceManifestSha256']==f.freeze_sha and selection['asarSha256']==f.asar_sha
results=[]
for item in selection['groups']:
    try:
        mode=item['mode'];group=item['group'];proof=f.proof(item['proof'],mode);row=copy.deepcopy(gate.read(item['executionFile']))
        for part in item.get('executionPointer','').split('/')[1:]:row=row[int(part)] if isinstance(row,list) else row[part]
        row['suite']=item['suite'];row['executedHarnessSnapshots']=item.get('executedHarnessSnapshots',row.get('executedHarnessSnapshots',{}))
        selected=f.choose(group,mode,row,item['evidenceFiles'],item['proof'])
        for file in item.get('executionEvidenceFiles',[]):
            data=gate.read(file);gate.nested_execution_gate(data,file)
            if isinstance(data,dict) and isinstance(data.get('expectedCases'),list) and isinstance(data.get('sourceBefore',{}).get('files'),dict) and 'childExitCode' in data:
                origin=next((c for c in row.get('evidenceCapture',[]) if gate.rel(c['file'])==gate.rel(file)),None)
                companions=None
                if origin:
                    directory=gate.path(origin['rawFile']).parent
                    companions={gate.path(c['rawFile']).name:c['file'] for c in row['evidenceCapture'] if gate.path(c['rawFile']).parent==directory}
                f.rc19_envelope_gate(data,file,mode,companions=companions,harness_snapshots=row['executedHarnessSnapshots'])
        actual=f.add(group,mode,selected,item['proof'],item['category'])
        contract=row['completionContract']
        assert actual['passed']==contract['expectedPassed']>0 and actual['observations']==contract['expectedObservations']
        assert sorted(c['name'] for c in actual['selectedAssertions'])==sorted(contract['expectedAssertionNames'])
        results.append({'mode':mode,'group':group,'verified':True,'passedAssertions':actual['passed'],'observations':actual['observations']})
    except Exception as error:results.append({'mode':item['mode'],'group':item['group'],'verified':False,'error':str(error)})
f.current_files_gate()
output={'scope':'Strict selected-subset evidence review only; full release acceptance still pending','sourceManifestSha256':f.freeze_sha,'asarSha256':f.asar_sha,'applicationSuitesExecuted':False,'groups':results,'verifiedGroups':sum(r['verified'] for r in results),'errors':[r for r in results if not r['verified']]}
gate.path(args.output).write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'verifiedGroups':output['verifiedGroups'],'totalGroups':len(results),'errors':output['errors']},ensure_ascii=False))
