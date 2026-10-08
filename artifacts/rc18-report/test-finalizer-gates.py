"""Report tooling self-checks; never part of application assertion totals."""
from pathlib import Path
import datetime as dt
import importlib.util
import json
import os
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('f',ROOT/'scripts/finalize-rc18.py')
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

class ReleaseGates(unittest.TestCase):
    def test_private_roster_path_is_rejected_before_read(self):
        with self.assertRaises(f.GateError):f.read('/tmp/rc18-private-roster-qa/input.json')

    def test_leaf_records_replace_scenario_summary(self):
        checks=f.collect_checks({'checks':[{'name':'scenario','status':'passed'}], 'leaves':[{'case':'scenario','name':'a','status':'passed'},{'case':'scenario','name':'b','status':'passed'}]})
        self.assertEqual([c['name'] for _,c in checks],['scenario / a','scenario / b'])

    def test_failed_subprocess_cannot_hide_behind_passed_checks(self):
        with self.assertRaises(f.GateError):f.nested_execution_gate({'exitCode':1,'checks':[{'name':'partial','status':'passed'}]},'fixture')

    def test_phase_envelopes_count_leaf_results_and_check_process_failure(self):
        record={'passed':1,'failed':0,'phases':[{'phase':'flows','exitCode':0,'report':{'results':[{'name':'one','status':'passed'}]}}]}
        self.assertEqual(len(f.collect_checks(record)),1)
        record['phases'][0]['exitCode']=1
        with self.assertRaises(f.GateError):f.nested_execution_gate(record,'fixture')

    def test_intentional_crash_requires_explicit_expected_outcome(self):
        f.nested_execution_gate({'passed':True,'expectedExitCode':None,'exitCode':None,'expectedSignal':'SIGKILL','signal':'SIGKILL'},'fixture')
        with self.assertRaises(f.GateError):f.nested_execution_gate({'exitCode':None,'signal':'SIGKILL'},'fixture')

    def test_zero_exit_does_not_hide_timeout_at_any_depth(self):
        for key in ['error','childError','spawnError','processError']:
            record={'exitCode':0,'children':[{'exitCode':0,key:{'code':'ETIMEDOUT'},'report':{'checks':[{'name':'partial','status':'passed'}]}}]}
            with self.subTest(key=key),self.assertRaises(f.GateError):f.nested_execution_gate(record,'fixture')

    def test_zero_exit_does_not_hide_missing_or_empty_phase_report(self):
        for report in [None,{}, {'checks':[]}]:
            with self.subTest(report=report),self.assertRaises(f.GateError):
                f.nested_execution_gate({'runs':[{'phase':'flows','exitCode':0,'report':report}]},'fixture')

    def test_zero_exit_does_not_hide_signal_or_pending_work(self):
        for extra in [{'signal':'SIGTERM'},{'timedOut':True},{'completed':False},{'passed':0},{'checkCount':0}]:
            with self.subTest(extra=extra),self.assertRaises(f.GateError):
                f.nested_execution_gate({'exitCode':0,**extra},'fixture')

    def test_missing_required_phase_is_rejected(self):
        record={'requiredPhases':['flows','restart'],'phases':[{'phase':'flows','exitCode':0,'report':{'checks':[{'name':'one','status':'passed'}]}}]}
        with self.assertRaises(f.GateError):f.nested_execution_gate(record,'fixture')

    def test_expected_negative_domain_result_is_not_execution_error(self):
        f.nested_execution_gate({'checks':[{'name':'negative case','status':'passed','detail':{'error':'EPERM','status':'blocked'}}]},'fixture')
        f.nested_execution_gate({'checks':[{'name':'negative import','status':'passed','detail':{'results':[{'name':'synthetic file','status':'failed'}]}}]},'fixture')

    def test_exact_declared_crash_control_may_have_empty_control_report(self):
        f.nested_execution_gate({'phase':'terminate','boundary':'temp-fsynced','exitCode':None,'signal':'SIGKILL','expectedExit':None,'expectedSignal':'SIGKILL','result':{'checks':[]}},'fixture')

    def test_preserved_unselected_failure_is_not_counted_or_promoted(self):
        f.nested_execution_gate({'exitCode':0,'initialAttempt':{'exitCode':1,'error':'ETIMEDOUT'}},'fixture')

    def test_retained_harness_must_match_both_genuine_execution_hashes(self):
        with tempfile.TemporaryDirectory(prefix='rc18-retained-harness-') as tmp:
            current=Path(tmp)/'helper.cjs';current.write_text('new helper')
            archived=Path(tmp)/'executed-helper.cjs';archived.write_text('old helper')
            digest=f.sha(archived);now=dt.datetime.now(dt.timezone.utc)
            obj=f.Finalizer.__new__(f.Finalizer);obj.frozen_at=now-dt.timedelta(minutes=1);obj.proof_dependencies=set()
            row={'exitCode':0,'startedAt':now.isoformat(),'completedAt':now.isoformat(),
                 'harnessAtStart':{str(current):digest},'harnessAtFinish':{str(current):digest},
                 'executedHarnessSnapshots':{str(current):{'file':str(archived),'sha256':digest,'reason':'explicit preserved version'}}}
            obj.execution(row,'fixture')
            row['harnessAtFinish'][str(current)]=f.sha(current)
            with self.assertRaises(f.GateError):obj.execution(row,'changed during execution')
            row['harnessAtFinish'][str(current)]=digest;archived.write_text('forged later bytes')
            with self.assertRaises(f.GateError):obj.execution(row,'wrong retained bytes')

    def test_timestamp_requires_timezone_and_after_freeze(self):
        obj=f.Finalizer.__new__(f.Finalizer);obj.frozen_at=f.timestamp('2026-10-07T07:00:00Z','fixture')
        with self.assertRaises(f.GateError):f.timestamp('2026-10-07T07:00:00','fixture')
        with self.assertRaises(f.GateError):obj.times({'startedAt':'2026-10-07T06:59:59Z','completedAt':'2026-10-07T07:01:00Z'},'fixture')

    def test_incomplete_source_hash_map_rejected(self):
        obj=f.Finalizer.__new__(f.Finalizer);obj.source={'src/a.js':'a','src/b.js':'b'};obj.all_frozen=obj.source
        with self.assertRaises(f.GateError):obj.source_map_gate({'src/a.js':'a'},'fixture')
        with self.assertRaises(f.GateError):obj.source_map_gate({'src/a.js':'old','src/b.js':'b'},'fixture')

    def test_duplicate_selected_leaf_rejected(self):
        with tempfile.TemporaryDirectory(prefix='rc18-report-gate-') as tmp:
            result=Path(tmp)/'result.json';result.write_text(json.dumps({'checks':[{'name':'one','status':'passed'}]}))
            now=dt.datetime.now(dt.timezone.utc)
            obj=f.Finalizer.__new__(f.Finalizer);obj.frozen_at=now-dt.timedelta(minutes=1);obj.selected=set();obj.check_names={};obj.groups=[]
            row={'suite':'fixture','startedAt':(now-dt.timedelta(seconds=1)).isoformat(),'completedAt':(now+dt.timedelta(seconds=1)).isoformat(),'resultFiles':[str(result)]}
            group=obj.add('fixture','source',row,str(result));self.assertEqual(group['passed'],1);self.assertEqual(len(group['selectedAssertions']),1)
            with self.assertRaises(f.GateError):obj.add('duplicate','source',row,str(result))

    def test_observation_not_counted_as_assertion_pass(self):
        with tempfile.TemporaryDirectory(prefix='rc18-report-gate-') as tmp:
            result=Path(tmp)/'result.json';result.write_text(json.dumps({'checks':[{'name':'Workbook format observation: sample','status':'passed'}]}))
            now=dt.datetime.now(dt.timezone.utc)
            obj=f.Finalizer.__new__(f.Finalizer);obj.frozen_at=now-dt.timedelta(minutes=1);obj.selected=set();obj.check_names={};obj.groups=[]
            row={'suite':'fixture','startedAt':(now-dt.timedelta(seconds=1)).isoformat(),'completedAt':(now+dt.timedelta(seconds=1)).isoformat(),'resultFiles':[str(result)]}
            group=obj.add('fixture','source',row,str(result));self.assertEqual(group['passed'],0);self.assertEqual(group['observations'],1)

if __name__=='__main__':unittest.main()
