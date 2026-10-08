"""Evidence-capture self-checks, excluded from application test totals."""
from pathlib import Path
import importlib.util
import json
import os
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/rc18_evidence.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class CaptureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='rc18-capture-selfcheck-')
        self.oldroot=m.ROOT;m.ROOT=Path(self.temp.name)
        self.raw=m.ROOT/'raw.json';self.raw.write_text('{"checks":[]}')
        os.utime(self.raw,ns=(1_000_000_000,1_000_000_000))
    def tearDown(self):m.ROOT=self.oldroot;self.temp.cleanup()
    def capture(self,name):
        c=m.Capture(m.ROOT/name,name,'source',['fixture'],['raw.json']);c.log.write_text('synthetic tool self-check');return c
    def test_stale_result_cannot_be_promoted(self):
        c=self.capture('stale');row=c.finish(0)
        self.assertEqual(row['exitCode'],1);self.assertEqual(row['availableEvidenceFiles'],[]);self.assertTrue(row['evidenceCaptureErrors'])
    def test_fresh_bytes_link_to_predeclared_output(self):
        c=self.capture('fresh');self.raw.write_text('{"checks":[{"name":"fixture","status":"passed"}]}')
        os.utime(self.raw,ns=(c.startNs+1000000,c.startNs+1000000))
        row=c.finish(0);self.assertEqual(row['exitCode'],0)
        self.assertEqual(row['evidenceFiles'],row['availableEvidenceFiles'])
        self.assertEqual(m.sha(m.ROOT/row['evidenceFiles'][0]),m.sha(self.raw))
        plan=json.loads((m.ROOT/'fresh/execution-plan.json').read_text())
        self.assertEqual(plan['evidenceFiles'],row['evidenceFiles']);self.assertTrue(plan['plannedBeforeExecution'])
    def test_failed_process_keeps_fresh_failure_evidence(self):
        c=self.capture('failed');self.raw.write_text('{"checks":[{"name":"fixture","status":"failed"}]}')
        os.utime(self.raw,ns=(c.startNs+1000000,c.startNs+1000000))
        row=c.finish(7,'simulated process failure');self.assertEqual(row['exitCode'],7);self.assertEqual(len(row['availableEvidenceFiles']),1)
    def test_all_regular_mappings_are_current_output_contracts(self):
        self.assertEqual(len(m.COMMON),24)
        for mode in ['source','packaged']:
            for suite in m.COMMON:self.assertNotIn('rc17',m.regular_outputs(mode,suite)[0])

if __name__=='__main__':unittest.main()
