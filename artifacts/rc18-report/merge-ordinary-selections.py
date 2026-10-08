"""Merge explicitly supplied domain selections, never discover arbitrary latest passes."""
from pathlib import Path
import argparse,json,importlib.util
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('s',ROOT/'scripts/select-rc18-runs.py');S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
a=argparse.ArgumentParser();a.add_argument('--input',action='append',required=True);v=a.parse_args()
plan={(g['mode'],g['group']):g for g in S.plan() if g['family']=='ordinary-independent'}
outfile='artifacts/rc18/ordinary-independent-selections.json';old=S.read(outfile) if S.F.path(outfile).is_file() else {'groups':[],'domainSelectionFiles':[]};groups={(g['mode'],g['group']):g for g in old['groups']}
for file in v.input:
 d=S.read(file);seen=set()
 for g in d['groups']:
  k=(g['mode'],g['group']);assert k in plan and k not in seen,k;seen.add(k)
  for field in ['suite','proof','executionFile','executionPointer','evidenceFiles','selectionReason']:assert field in g,(k,field)
  if k in groups:assert groups[k]==g,'Refuse implicit replacement of an existing explicit domain selection'
  groups[k]=g
 old['domainSelectionFiles']=list(dict.fromkeys(old['domainSelectionFiles']+[file]))
ordered=[groups[k] for k in plan if k in groups]
out={'version':'1.3.0-rc.18','expectedGroups':42,'selectedGroups':len(ordered),'complete':len(ordered)==len(plan),'domainSelectionFiles':old['domainSelectionFiles'],'domainSelectionSha256':{f:S.sha(f) for f in old['domainSelectionFiles']},'groups':ordered}
S.write(outfile,out);print(json.dumps({'groups':len(ordered),'required':len(plan),'complete':out['complete']}))
