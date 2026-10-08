"""Non-product checks for release selection integrity and failure handling."""
import datetime as dt
import importlib.util,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('finalizer',ROOT/'scripts/finalize-rc17.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
verified=[]
def blocked(name,call):
    try:call()
    except m.GateError:verified.append(name);return
    raise AssertionError('Expected gate rejection: '+name)
leaves=m.collect_checks({'runs':[{'passed':1,'report':{'checks':[{'name':'one','status':'passed'},{'name':'two','status':'observed'}]}}]})
assert len(leaves)==2 and [r['name']for _,r in leaves]==['one','two'];verified.append('Nested assertion rows count once')
leaves=m.collect_checks({'checks':[{'name':'scenario','status':'passed'}], 'leaves':[{'case':'case A','name':'same assertion','status':'passed'},{'case':'case B','name':'same assertion','status':'passed'}]})
assert len(leaves)==2 and [r['name']for _,r in leaves]==['case A / same assertion','case B / same assertion'];verified.append('Import wrappers excluded; case/leaf pairs remain distinct')
m.nested_execution_gate({'passed':True,'expectedExitCode':77,'exitCode':77,'signal':None},'expected injected termination');verified.append('Explicitly asserted expected termination is allowed')
blocked('Failed subprocess with passing partial report is rejected',lambda:m.nested_execution_gate({'exitCode':1,'report':{'checks':[{'name':'partial','status':'passed'}]}},'partial success'))
blocked('Summary failure is rejected even if child assertions look passed',lambda:m.nested_execution_gate({'exitCode':0,'failed':1,'checks':[{'name':'partial','status':'passed'}]},'failed summary'))
blocked('Incomplete report is rejected',lambda:m.nested_execution_gate({'exitCode':0,'status':'unverified'},'incomplete report'))
blocked('Wrong expected termination is rejected',lambda:m.nested_execution_gate({'passed':True,'expectedExitCode':77,'exitCode':1,'signal':None},'wrong injected exit'))
blocked('Unasserted nonzero exit is rejected',lambda:m.nested_execution_gate({'expectedExitCode':77,'exitCode':77,'signal':None},'unasserted injected exit'))
f=m.Finalizer.__new__(m.Finalizer);f.frozen_at=dt.datetime(2026,10,7,3,58,53,tzinfo=dt.timezone.utc)
blocked('Pre-freeze candidate execution is rejected',lambda:f.times({'startedAt':'2026-10-07T03:34:00Z','completedAt':'2026-10-07T03:35:00Z'},'pre-freeze'))
blocked('Pre-request history is rejected',lambda:f.times({'startedAt':'2026-10-07T02:50:00Z','completedAt':'2026-10-07T02:51:00Z'},'history'))
blocked('Reversed execution interval is rejected',lambda:f.times({'startedAt':'2026-10-07T04:01:00Z','completedAt':'2026-10-07T04:00:00Z'},'reversed'))
blocked('Timezone-free timestamp is rejected',lambda:f.times({'startedAt':'2026-10-07T04:00:00','completedAt':'2026-10-07T04:01:00Z'},'missing timezone'))
assert f.times({'startedAt':'2026-10-07T04:00:00Z','endedAt':'2026-10-07T04:01:00Z'},'leaf format')==('2026-10-07T04:00:00Z','2026-10-07T04:01:00Z');verified.append('Original endedAt timestamps supported')
f.source={'src/a.cjs':'a','src/b.cjs':'b'};f.all_frozen=dict(f.source)
blocked('Incomplete source map is rejected',lambda:f.source_map_gate({'a.cjs':'a'},'incomplete'))
blocked('Stale source map is rejected',lambda:f.source_map_gate({'a.cjs':'old','b.cjs':'b'},'stale'))
assert f.source_map_gate({'a.cjs':'a','b.cjs':'b'},'complete')==f.source;verified.append('Complete exact source map accepted')
out=Path(__file__).with_name('finalizer-gate-verification.json')
out.write_text(json.dumps({'verifiedAt':dt.datetime.now(dt.timezone.utc).isoformat(),'scope':'Report/release-selector tooling, excluded from product assertion counts','checks':verified},ensure_ascii=False,indent=2))
print(json.dumps({'verifiedGates':len(verified),'productAssertions':0,'output':str(out)}))
