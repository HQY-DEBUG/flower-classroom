'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluate}=require('../scripts/qa-rc19-runtime-evidence.cjs');
function valid(){return {child:{status:0,signal:null,stdout:'FLOWER_QA_COMPLETE run_fixture 2\n'},report:{runId:'run_fixture',entry:'/product/src/main.cjs',complete:true,checks:[{name:'first journey',status:'passed'},{name:'second journey',status:'passed'}],errors:[]},runtime:{runId:'run_fixture',entry:'/product/src/main.cjs',passed:true},identity:{runId:'run_fixture',entry:'/product/src/main.cjs',expectedCases:['first journey','second journey'],sourceBefore:{sha256:'unchanged'},archive:null,archiveSha256:null},after:{sha256:'unchanged'},archiveAfter:null};}
test('QA accepts the exact clean completion with matched run and runtime identities',()=>assert.equal(evaluate(valid()).passed,true));
for(const [name,change] of [
 ['exit zero with no report',v=>v.report=null],
 ['exit zero with zero completed journeys',v=>v.report.checks=[]],
 ['exit zero with a missing journey',v=>v.report.checks.pop()],
 ['duplicated journey replacing another',v=>v.report.checks[1].name='first journey'],
 ['wrong journey name with same count',v=>v.report.checks[1].name='unplanned journey'],
 ['failed journey',v=>v.report.checks[0].status='failed'],
 ['renderer error',v=>v.report.errors.push('renderer failure')],
 ['missing completion marker',v=>v.child.stdout=''],
 ['nonterminal report',v=>v.report.complete=false],
 ['report from a previous run',v=>v.report.runId='old_run'],
 ['report from another product entry',v=>v.report.entry='/development/src/main.cjs'],
 ['missing runtime provenance',v=>v.runtime=null],
 ['failed runtime provenance',v=>v.runtime.passed=false],
 ['runtime from previous run',v=>v.runtime.runId='old_run'],
 ['child process spawn error despite status zero',v=>v.child.error=new Error('spawn failed')],
 ['child signal despite status zero',v=>v.child.signal='SIGTERM'],
 ['changed source or harness',v=>v.after.sha256='changed'],
 ['changed archive bytes',v=>v.archiveAfter='changed'],
 ['package execution missing dependency boundary',v=>{v.identity.archive='/product/app.asar';}],
 ['package execution with boundary escape',v=>{v.identity.archive='/product/app.asar';v.boundary={archive:v.identity.archive,status:'passed',violations:['escaped']};}]
])test('QA rejects '+name,()=>{const value=valid();change(value);assert.equal(evaluate(value).passed,false);});
