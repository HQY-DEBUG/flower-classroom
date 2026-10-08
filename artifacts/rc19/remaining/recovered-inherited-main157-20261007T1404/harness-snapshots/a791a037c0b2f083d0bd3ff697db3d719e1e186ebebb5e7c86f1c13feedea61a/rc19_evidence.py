"""Declare outputs before execution and capture only freshly rewritten RC18 evidence."""
from pathlib import Path
import datetime as dt
import hashlib
import json
import shutil
import time
import uuid
import re

ROOT=Path(__file__).resolve().parent.parent
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def rel(p):return str(Path(p).resolve().relative_to(ROOT))

# Existing harness output contracts, inspected before the first RC18 run.
# Prior result content is never used by this module.
COMMON={
 'ui':('artifacts/qa/qa-electron-results.json','artifacts/qa-packaged/qa-electron-results.json'),
 'pets':('artifacts/qa-pets/qa-pets-results.json','artifacts/qa-pets-packaged/qa-pets-results.json'),
 'catalog':('artifacts/qa-catalog/source/qa-catalog-results.json','artifacts/qa-catalog/packaged/qa-catalog-results.json'),
 'primary':('artifacts/parity/known-flows-results.json','artifacts/rc9-packaged/known-flows-results.json'),
 'care':('artifacts/rc19/frozen-care-results.json','artifacts/qa-pet-care-packaged/results.json'),
 'wheels':('artifacts/qa-wheels/results.json','artifacts/qa-wheels-packaged/results.json'),
 'lock':('artifacts/rc19/frozen-lock-results.json','artifacts/qa-classroom-lock-packaged/results.json'),
 'groups':('artifacts/qa-group-tools/results.json','artifacts/qa-group-tools-packaged/results.json'),
 'classroom':('artifacts/qa-classroom-tools-native/results.json','artifacts/qa-classroom-tools-native-packaged/results.json'),
 'switch':('artifacts/qa-pet-switch/source/results.json','artifacts/qa-pet-switch/packaged/results.json'),
 'narrow':('artifacts/qa-classroom-tools-240/results.json','artifacts/qa-classroom-tools-240-packaged/results.json'),
 'organization':('artifacts/qa-organization/results.json','artifacts/qa-organization-packaged/results.json'),
 'petextra':('artifacts/rc19/frozen-petextra-results.json','artifacts/qa-pet-extra-packaged/results.json'),
 'toolbox':('artifacts/qa-toolbox-extra-native/results.json','artifacts/qa-toolbox-extra-native-packaged/results.json'),
 'navigation':('artifacts/rc9/navigation-source/results.json','artifacts/rc9/navigation-packaged/results.json'),
 'palette':('artifacts/rc9/tool-palette-source-run.json','artifacts/rc9/tool-palette-packaged-run.json'),
 'focus':('artifacts/rc9/focus-contrast-source-run.json','artifacts/rc9/focus-contrast-packaged-run.json'),
 'lifecycle':('artifacts/qa-adventure-lifecycle/source/results.json','artifacts/qa-adventure-lifecycle/packaged/results.json'),
 'lazy-excel':('artifacts/rc9/lazy-excel/results.json','artifacts/rc9/lazy-excel-packaged/results.json'),
 'lock-layout':('artifacts/rc9/lock-dialog-source/results.json','artifacts/rc9/lock-dialog-packaged/results.json'),
 'modal-headers':('artifacts/rc9/modal-inventory-source-results.json','artifacts/rc9/modal-inventory-packaged-results.json'),
 'window-exits':('artifacts/rc9/window-exits-source-results.json','artifacts/rc9/window-exits-packaged-results.json'),
 'adversarial':('artifacts/rc9/adversarial-source/results.json','artifacts/rc9/adversarial-packaged/results.json'),
 'window-readonly':('artifacts/rc9/window-readonly-source-results.json','artifacts/rc9/window-readonly-packaged-results.json'),
}
def regular_outputs(mode,suite):
    assert mode in ['source','packaged']
    if suite=='migration':assert mode=='source';return ['artifacts/qa-pet-care-independent/results.json']
    if suite=='unit':return []
    return [COMMON[suite][0 if mode=='source' else 1]]

def run_directory(stem):
    stamp=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')+'-'+uuid.uuid4().hex[:8]
    out=ROOT/'artifacts/rc19'/stem/stamp;out.mkdir(parents=True,exist_ok=False);return out

def harness_hashes(command,node_unit=False):
    files={Path(__file__).resolve()}
    files.update((ROOT/'tests/fixtures').glob('*.json'))
    restore_helper=ROOT/'scripts/qa-restore-fixture.cjs'
    if restore_helper.is_file():files.add(restore_helper)
    for value in command:
        for candidate in [ROOT/value,ROOT/'scripts'/value]:
            if candidate.is_file() and candidate.suffix in ['.cjs','.js','.py','.mjs','.json']:files.add(candidate)
    if node_unit:files.update((ROOT/'tests').glob('*.test.cjs'));files.add(ROOT/'package.json')
    if 'scripts/ui-test.cjs' in command:
        files.update(ROOT/'scripts'/n for n in ['qa-electron.cjs','qa-recovery.cjs','qa-network.cjs'])
    if 'scripts/pet-test-runner.cjs' in command:files.add(ROOT/'scripts/qa-pets.cjs')
    if 'scripts/run-frozen-check.cjs' in command:
        kind=command[-1];files.add(ROOT/{'care':'scripts/qa-pet-care.cjs','petextra':'scripts/qa-pet-extra.cjs','lock':'tests/classroom-lock-fixture.cjs'}[kind])
    # Follow only explicit relative module dependencies of selected QA code.
    # Do not discover unrelated historical/specialist scripts.
    queue=list(files);seen=set()
    while queue:
        script=queue.pop()
        if script in seen or script.suffix not in ['.cjs','.js','.mjs']:continue
        seen.add(script)
        for module in re.findall(r"require\(['\"](\.[^'\"]+)['\"]\)",script.read_text()):
            stem=(script.parent/module).resolve()
            for candidate in [stem,Path(str(stem)+'.cjs'),Path(str(stem)+'.js'),Path(str(stem)+'.json')]:
                if not candidate.is_file() or not candidate.is_relative_to(ROOT) or 'rc18-private-roster-qa' in str(candidate):continue
                if candidate.suffix not in ['.cjs','.js','.mjs','.json'] or candidate.is_relative_to(ROOT/'src'):continue
                if candidate not in files:files.add(candidate);queue.append(candidate)
                break
    return {rel(p):sha(p) for p in sorted(files)}

class Capture:
    def __init__(self,directory,suite,mode,command,raw_files,log_is_evidence=False):
        self.directory=Path(directory);self.directory.mkdir(parents=True,exist_ok=False);self.log=self.directory/'run.log'
        self.raw=[ROOT/p if not Path(p).is_absolute() else Path(p) for p in raw_files]
        assert all(p.resolve().is_relative_to(ROOT) and 'rc18-private-roster-qa' not in str(p.resolve()) for p in self.raw)
        self.targets=[self.directory/(str(i+1)+'-'+p.name) for i,p in enumerate(self.raw)]
        self.before={str(p):{'mtimeNs':p.stat().st_mtime_ns,'sizeBytes':p.stat().st_size,'sha256':sha(p)} if p.is_file() else None for p in self.raw}
        self.startedAt=now();self.startNs=time.time_ns();self.log_is_evidence=log_is_evidence
        self.plan={'suite':suite,'mode':mode,'command':command,'startedAt':self.startedAt,
          'log':rel(self.log),'evidenceFiles':[rel(self.log)] if log_is_evidence else [rel(p) for p in self.targets],
          'evidenceDirectory':rel(self.directory),'plannedBeforeExecution':True,'rawEvidenceFiles':[rel(p) for p in self.raw],
          'rawEvidenceBefore':{rel(p):self.before[str(p)] for p in self.raw}}
        (self.directory/'execution-plan.json').write_text(json.dumps(self.plan,ensure_ascii=False,indent=2)+'\n')

    def finish(self,exit_code,harness_error=None,extra=None):
        captures=[];errors=[]
        for p,target in zip(self.raw,self.targets):
            before=self.before[str(p)]
            if not p.is_file():errors.append('Missing declared output: '+rel(p));continue
            stat=p.stat()
            if stat.st_mtime_ns < self.startNs or (before and stat.st_mtime_ns<=before['mtimeNs']):errors.append('Output was not written by this invocation: '+rel(p));continue
            digest=sha(p);shutil.copy2(p,target);assert sha(target)==digest
            captures.append({'rawFile':rel(p),'file':rel(target),'sha256':digest,'rawMtimeNs':stat.st_mtime_ns,'sizeBytes':stat.st_size})
        row={**self.plan,'exitCode':exit_code,'harnessError':harness_error,'completedAt':now(),'evidenceCapture':captures,'evidenceCaptureErrors':errors,'logSha256':sha(self.log),**(extra or {})}
        if errors and exit_code==0:row['exitCode']=1;row['harnessError']='Fresh evidence capture failed: '+'; '.join(errors)
        row['availableEvidenceFiles']=[rel(self.log)] if self.log_is_evidence else [v['file'] for v in captures]
        (self.directory/'execution.json').write_text(json.dumps(row,ensure_ascii=False,indent=2)+'\n');return row
