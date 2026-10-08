"""One-time metadata-only addition for the seven existing extension runner families."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
NAMES=['run-rc18-features.py','run-rc18-inherited-independent.py','run-rc18-extension-regression.py','run-rc18-legacy-targeted.py','run-rc18-new-audit.py','run-rc18-focused.py','run-rc18-rule-regression.py']
for name in NAMES:
    p=ROOT/'scripts'/name;s=p.read_text()
    if 'from rc18_evidence import harness_hashes' in s:continue
    s=s.replace('from pathlib import Path','from pathlib import Path\nfrom rc18_evidence import harness_hashes',1)
    marker=" with log.open('w')"
    assert marker in s,name
    s=s.replace(marker," harness_before=harness_hashes(['node',script])\n"+marker,1)
    key='rec' if name=='run-rc18-focused.py' else 'row'
    needle=' '+key+"={'suite':name,"
    assert needle in s,name
    s=s.replace(needle," harness_after=harness_hashes(['node',script])\n"+needle+"'harnessAtStart':harness_before,'harnessAtFinish':harness_after,",1)
    p.write_text(s)
print('Seven extension runner families record primary-script and relative-QA dependency fingerprints')
