"""List every current requirement's binding gaps without promoting provisional results."""
from pathlib import Path
import json,importlib.util,collections
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('selection',ROOT/'scripts/select-rc18-runs.py');S=importlib.util.module_from_spec(spec);spec.loader.exec_module(S)
draft=S.read('artifacts/rc18-report/coverage-matrix-draft.json');ctx=S.read('artifacts/rc18-report/final-context-draft.json');availability=S.read('artifacts/rc18-report/evidence-availability.json')
current={'source':set(),'package':set()};historic={};cache={};helper=S.F.Finalizer.__new__(S.F.Finalizer)
def checks(file):
 if file not in cache:cache[file]=helper.node_log(file)[1] if file.endswith('.log') else S.F.collect_checks(S.read(file))
 return cache[file]
for g in availability['groups']:
 if not g['availableForStrictReview']:continue
 mode='source' if g['mode']=='source' else 'package'
 for file in g['evidenceFiles']:
  for _,c in checks(file):
   if c['status']=='passed':current[mode].add(c['name'])
for g in S.read('artifacts/rc17/final-test-manifest.json')['groups']:
 mode='source' if g['mode']=='source' else 'package'
 for file in g['evidenceFiles']:
  for _,c in checks(file):historic.setdefault((mode,c['name']),set()).add(g['mode']+'/'+g['group'])
aliases=ctx.get('assertionAliases',{});baseline=S.read(draft['historicalBaseline']['reportInputFile']);old_count=len(baseline['source']['files']);new_count=len(S.read('artifacts/rc18/frozen-source.json')['files'])
aliases[f'Loaded production entry matches all {old_count} frozen source files']={'name':f'Loaded production entry matches all {new_count} frozen source files'}
rows=[]
for r in draft['requirements']:
 names=ctx.get('requirementBindings',{}).get(r['id'],{}).get('exactAssertions',r.get('expectedExactAssertions',{}));scopes=r.get('requiredScopes',['source','package']);gaps={}
 for mode in scopes:
  required=list(dict.fromkeys(names.get(mode,[])+ctx.get('additionalRequirementAssertions',{}).get(r['id'],{}).get(mode,[])))
  gaps[mode]=[{'name':aliases.get(n,{}).get('name',n),'oldExactName':n,'historicalDefinitionGroups':sorted(historic.get((mode,n),[]))} for n in required if aliases.get(n,{}).get('name',n) not in current[mode]]
 rows.append({'id':r['id'],'feature':r.get('feature',r.get('title')),'requiredScopes':scopes,'missing':gaps,'allRequiredNamesAvailable':bool(scopes) and all(not a for a in gaps.values())})
oldset={(g['mode'],g['group']) for g in S.read('artifacts/rc17/final-test-manifest.json')['groups']};newset={(g['mode'],g['group']) for g in S.plan()}
out={'partial':True,'finalized':False,'currentPassContribution':0,'featureDenominator':len(rows),'allHistoricalGroupsInCurrentPlan':oldset<=newset,'missingHistoricalGroups':sorted(oldset-newset),'requirements':rows,'requirementsWithBindingGaps':[r['id'] for r in rows if any(r['missing'].values())]}
S.write('artifacts/rc18-report/requirement-binding-availability.json',out)
print(json.dumps({k:out[k] for k in ['featureDenominator','allHistoricalGroupsInCurrentPlan','missingHistoricalGroups','requirementsWithBindingGaps']},ensure_ascii=False))
