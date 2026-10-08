"""Read-only integrity/provenance triage, never a final selected pass ledger."""
from pathlib import Path
import json,importlib.util,types,copy,datetime
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('selection',ROOT/'scripts/select-rc18-runs.py');S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
f=S.F.Finalizer(types.SimpleNamespace(retests=None,check_only=True));f.current_files_gate()
plan={(g['mode'],g['group']):g for g in S.plan()};config=S.read('artifacts/rc18-report/selection-locations.json')
available=S.read('artifacts/rc18-report/evidence-availability.json');results=[]
for item in available['groups']:
 if not item['availableForStrictReview']:continue
 p=plan[(item['mode'],item['group'])];error=None
 try:
  proof=f.proof(item['proof'],item['mode']);data=S.read(proof['runsFile']) if proof.get('runsFile') else proof
  if isinstance(data,list):candidates=data
  else:candidates=data.get('suites',data.get('runs',data.get('results')))
  if isinstance(candidates,list):
   rows=[r for r in candidates if r.get('suite',r.get('kind'))==p['suite'] and r.get('mode',item['mode'])==item['mode']];S.F.require(len(rows)==1,'Cannot uniquely resolve original execution row');row=copy.deepcopy(rows[0])
  else:row=copy.deepcopy(data)
  if 'exitCode' not in row and 'childExitCode' in row:row['exitCode']=row['childExitCode'];row['script']=row.get('harnessPath');row['scriptSha256']=row.get('harnessSha256')
  key=item['mode']+'/'+item['group']
  if key in config.get('harnessSnapshotMappings',{}):row['executedHarnessSnapshots']=config['harnessSnapshotMappings'][key]
  f.execution(row,key)
  row.setdefault('suite',p['suite']);row['resultFiles']=item['evidenceFiles']
  if p['category']=='node':f.add(item['group'],item['mode'],row,item['proof'],'node',f.node_log(item['evidenceFiles'][0])[1])
  else:f.add(item['group'],item['mode'],row,item['proof'],p['category'])
  for file in item.get('executionEvidenceFiles',[]):
   S.F.nested_execution_gate(S.read(file),file)
   start,end=f.times(row,key);mtime=datetime.datetime.fromtimestamp(S.F.path(file).stat().st_mtime,datetime.timezone.utc)
   S.F.require(S.F.timestamp(start,key)-datetime.timedelta(seconds=2)<=mtime<=S.F.timestamp(end,key)+datetime.timedelta(seconds=2),key+': process record outside original execution interval: '+file)
 except (S.F.GateError,KeyError,TypeError,OSError) as e:error=str(e)
 results.append({**item,'provenanceReviewPassed':error is None,'provenanceGap':error})
out={'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'partial':True,'finalized':False,'currentAssertionContribution':0,'sourceManifestSha256':f.freeze_sha,'asarSha256':f.asar_sha,'groups':results,'checked':len(results),'provenanceReady':sum(v['provenanceReviewPassed'] for v in results),'blocked':sum(not v['provenanceReviewPassed'] for v in results)}
S.write('artifacts/rc18-report/available-provenance-review.json',out)
print(json.dumps({k:out[k] for k in ['checked','provenanceReady','blocked']}))
for v in results:
 if v['provenanceGap']:print(v['mode'],v['group'],v['provenanceGap'])
