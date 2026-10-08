"""Exercise complete technical gates while explicitly leaving approvals pending.

Only five coordinator-review preconditions are collected rather than raised.
No input flags are modified, no finalizer file is modified, finish() is never
called, and no release manifest is emitted.
"""
from pathlib import Path
from types import SimpleNamespace
from collections import Counter
import datetime
import hashlib
import importlib.util
import json
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('candidate_gate',ROOT/'scripts/finalize-rc19.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
selection='artifacts/rc19/final220-selection-candidate.json'
pending_messages={
 'A partial availability or selection draft cannot finalize RC19',
 'Final selections must be explicitly confirmed by the coordinator',
 'Coordinator has not declared full inherited source/ASAR regression selection',
 'Coordinator has not confirmed independent review of this final runtime',
 'Suite completion expectations have not been reviewed',
}
pending=[];original_require=gate.require
def read_only_requirement(condition,message):
    if not condition and message in pending_messages:
        pending.append(message);return
    original_require(condition,message)
gate.require=read_only_requirement
f=gate.Finalizer(SimpleNamespace(retests=None,check_only=True,selection=selection,roster_summary=None,findings=None))
error=None
try:
    f.current_files_gate();f.selected_manifest();f.current_files_gate()
except Exception as exception:error=type(exception).__name__+': '+str(exception)
finally:gate.require=original_require
counts=Counter(c['status'] for g in f.groups for c in g['selectedAssertions'])
result={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Read-only technical selection/proof/execution/expected-case gates; coordinator approval and release artifact/finding gates remain separate','selectionFile':selection,'selectionSha256':hashlib.sha256((ROOT/selection).read_bytes()).hexdigest(),'finalizerSha256':hashlib.sha256((ROOT/'scripts/finalize-rc19.py').read_bytes()).hexdigest(),'coordinatorApprovalGranted':False,'pendingReviewRequirements':pending,'technicalGatesPassed':error is None,'groupsTraversed':len(f.groups),'selectedRecordsTraversed':dict(counts),'blocker':error,'applicationSuitesExecuted':False,'finalizationAttempted':False,'finalManifestWritten':False}
(ROOT/'artifacts/rc19-report/full-candidate-technical-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['technicalGatesPassed','groupsTraversed','selectedRecordsTraversed','blocker','pendingReviewRequirements']},ensure_ascii=False))
