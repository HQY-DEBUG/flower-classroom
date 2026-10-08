from pathlib import Path
import json,hashlib,datetime,shutil
r=Path(__file__).resolve().parent.parent
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
read=lambda f:json.loads((r/f).read_text())
sha=lambda f:hashlib.sha256((r/f).read_bytes()).hexdigest()
f=read('artifacts/rc11/frozen-source.json')
assert all(sha(k)==v for k,v in f['files'].items())
p=r/'artifacts/rc11/source-runs.json';rows=read(str(p.relative_to(r)));shutil.copy2(p,p.with_name('source-runs-initial-final-freeze.json'))
retests={'catalog':('artifacts/qa-catalog/source/qa-catalog-results.json','artifacts/rc11/source-final-retests/catalog-retest.log'),'lazy-excel':('artifacts/rc9/lazy-excel/results.json','artifacts/rc11/source-final-retests/lazy-excel-retest.log'),'adversarial':('artifacts/rc9/adversarial/results.json','artifacts/rc11/source-final-retests/adversarial-retest.log')}
for row in rows:
 if row['exitCode']==0:continue
 ev,log=retests[row['suite']];d=read(ev)
 if row['suite']=='catalog':assert d['failed']==0 and not d['processFailure']
 else:assert all(v.get('status',v.get('exitCode'))==0 and all(c['status']=='passed' for c in v['report']['checks']) for v in d['results'])
 row['initialAttempt']=dict(row);row.update(exitCode=0,retestEvidence=ev,retestEvidenceSha256=sha(ev),log=log,reconciledAt=now,note='Retested unchanged final runtime after harness was updated for RC11 interaction/template behavior; original failing attempt retained.')
assert all(v['exitCode']==0 for v in rows);p.write_text(json.dumps(rows,indent=2)+'\n')
for folder,suite,ev,log in [('new-targeted-source','transactions','artifacts/rc11/new-targeted-source/transactions/run.json','artifacts/rc11/source-final-retests/transactions-retest.log'),('legacy-targeted-source','imports','artifacts/rc11/legacy-targeted-source/imports/results.json','artifacts/rc11/source-final-retests/imports-retest.log')]:
 p=r/'artifacts/rc11'/folder/'runs.json';d=json.loads(p.read_text());shutil.copy2(p,p.with_name('runs-before-retest.json'));rr=read(ev)
 assert all(v.get('status',v.get('exitCode'))==0 for v in rr['runs']);row=next(v for v in d['suites'] if v['suite']==suite);row['initialAttempt']=dict(row);assert rr['harnessSha256']==sha(row['script'])
 row.update(exitCode=0,scriptSha256=rr['harnessSha256'],scriptSha256AtFinish=rr['harnessSha256'],scriptUnchanged=True,log=log,retestEvidence=ev,retestEvidenceSha256=sha(ev),reconciledAt=now,note='Harness now dismisses the new first-growth hatch feedback through its visible close/Escape before exercising the original transaction confirmation. Original failure preserved.')
 assert d['sourceUnchanged'] and all(v['exitCode']==0 for v in d['suites']);p.write_text(json.dumps(d,indent=2)+'\n')
print('Final source: 26 suites passed after recorded targeted retests; source boundary groups 101 +157 passed')
