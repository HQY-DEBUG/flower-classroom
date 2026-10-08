"""Small non-product checks for the release evidence selector's failure gates."""
import datetime as dt
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('finalizer',ROOT/'scripts/finalize-rc16.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def blocked(call):
    try:call()
    except m.GateError:return
    raise AssertionError('Expected gate rejection')

leaves=m.collect_checks({'runs':[{'passed':1,'report':{'checks':[{'name':'one','status':'passed'},{'name':'two','status':'observed'}]}}]})
assert len(leaves)==2 and [r['name']for _,r in leaves]==['one','two']
m.nested_execution_gate({'passed':True,'expectedExitCode':77,'exitCode':77,'signal':None},'expected injected termination')
blocked(lambda:m.nested_execution_gate({'exitCode':1,'report':{'checks':[{'name':'partial output','status':'passed'}]}},'failed subprocess with partial success'))
blocked(lambda:m.nested_execution_gate({'passed':True,'expectedExitCode':77,'exitCode':1,'signal':None},'wrong injected exit'))
blocked(lambda:m.nested_execution_gate({'expectedExitCode':77,'exitCode':77,'signal':None},'unasserted injected exit'))
f=m.Finalizer.__new__(m.Finalizer)
f.frozen_at=dt.datetime(2026,10,7,2,29,tzinfo=dt.timezone.utc)
blocked(lambda:f.times({'startedAt':'2026-10-07T02:28:00Z','completedAt':'2026-10-07T02:30:00Z'},'pre-freeze result'))
blocked(lambda:f.times({'startedAt':'2026-10-07T02:31:00Z','completedAt':'2026-10-07T02:30:00Z'},'reversed interval'))
blocked(lambda:f.times({'startedAt':'2026-10-07T02:30:00','completedAt':'2026-10-07T02:31:00Z'},'missing timezone'))
f.source={'src/a.cjs':'a','src/b.cjs':'b'};f.all_frozen=dict(f.source)
blocked(lambda:f.source_map_gate({'a.cjs':'a'},'incomplete source map'))
blocked(lambda:f.source_map_gate({'a.cjs':'old','b.cjs':'b'},'stale source map'))
assert f.source_map_gate({'a.cjs':'a','b.cjs':'b'},'complete source map')==f.source
print('Evidence gates passed: leaves counted once; failed/ambiguous exits, stale or reversed times, missing timezone and stale/incomplete source maps rejected.')
