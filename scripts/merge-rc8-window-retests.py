"""Keep first attempts and bind effective final suites to explicit successful retests."""
from pathlib import Path
import json,hashlib
r=Path(__file__).resolve().parent.parent;d=r/'artifacts/rc8';records=json.loads((d/'window-retest-runs.json').read_text());assert len(records)==4 and all(x['exitCode']==0 for x in records)
for kind,name in [('source','source-runs.json'),('packaged','packaged-runs.json')]:
 p=d/name;obj=json.loads(p.read_text());first=d/name.replace('.json','-first-attempt.json')
 if not first.exists():first.write_bytes(p.read_bytes())
 original=json.loads(first.read_text());runs=original if kind=='source' else original['results']
 for run in [x for x in records if x['kind']==kind]:
  entry={k:v for k,v in run.items() if k!='kind'}
  i=next((i for i,v in enumerate(runs) if v['suite']==run['suite']),None)
  if i is None:runs.append(entry)
  else:
   entry['previousAttempts']=[runs[i]];entry['retestReason']='Synchronized native Ctrl+A/Backspace and insertText in the timer draft test; production source unchanged; original attempts preserved.';entry['retestNote']='artifacts/rc8/window-before-harness/window-harness-retest-note.json';runs[i]=entry
 assert all(v['exitCode']==0 for v in runs)
 assert len(runs)==(26 if kind=='source' else 24)
 if kind=='source':obj=runs
 else:obj={**original,'results':runs,'firstAttemptManifest':'artifacts/rc8/'+first.name}
 p.write_text(json.dumps(obj,indent=2)+'\n')
files=json.loads((d/'frozen-source.json').read_text())['files'];assert all(hashlib.sha256((r/k).read_bytes()).hexdigest()==v for k,v in files.items())
print('Final effective suites: source 26/26, production ASAR 24/24; first attempts retained.')
