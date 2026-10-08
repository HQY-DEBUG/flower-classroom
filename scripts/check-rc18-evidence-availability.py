"""Read-only availability review. This is never a passing final selection."""
from pathlib import Path
import argparse
import importlib.util
import json
import datetime as dt

ROOT=Path(__file__).resolve().parent.parent
s=importlib.util.spec_from_file_location('selection',ROOT/'scripts/select-rc18-runs.py');S=importlib.util.module_from_spec(s);s.loader.exec_module(S)
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--config');a=ap.parse_args();cfg=S.read(a.config) if a.config else {}
    plan=S.plan();freeze=S.read('artifacts/rc18/frozen-source.json');frozen=dt.datetime.fromisoformat(freeze['frozenAt'].replace('Z','+00:00'))
    ui=cfg.get('uiDirectories',S.DEFAULT_UI);rows=[];cache={};helper=S.F.Finalizer.__new__(S.F.Finalizer)
    contracts={(v['mode'],v['group']):v for v in S.read('artifacts/rc18-report/completion-contract.json')['groups']}
    def read(p):
        if p not in cache:cache[p]=S.read(p)
        return cache[p]
    for g in plan:
        mode,suite,family=g['mode'],g['suite'],g['family'];proof=None;row=None;error=None;files=[];execution_files=[];actual_count=None
        try:
            if family=='regular':
                proof=cfg.get('regularBindingProofs',{}).get(mode,f'artifacts/rc18/{mode}-run-binding.json');envelope=read(proof);runs=read(envelope.get('runsFile',f'artifacts/rc18/{mode}-runs.json'));items=runs if isinstance(runs,list) else runs['results'];matches=[v for v in items if v['suite']==suite]
            elif family in S.TARGETED:
                target_base=cfg.get('targetedDirectories',{}).get(mode,{}).get(family,f'artifacts/rc18/{family}-{mode}');proof=target_base+'/runs.json';matches=[v for v in read(proof)['suites'] if v['suite']==suite]
            elif family=='ordinary-independent':
                registry=read(cfg.get('ordinaryIndependentSelections','artifacts/rc18/ordinary-independent-selections.json'))
                chosen=[v for v in registry['groups'] if v['mode']==mode and v['group']==g['group']];assert len(chosen)==1,'Missing original ordinary independent selection'
                selected=chosen[0];proof=selected['proof'];original=read(selected.get('executionFile',proof))
                for token in selected.get('executionPointer','').split('/')[1:]:
                    token=token.replace('~1','/').replace('~0','~');original=original[int(token)] if isinstance(original,list) else original[token]
                matches=[original]
            elif family=='inherited-folder':
                folder=cfg.get('inheritedFolderDirectories',{}).get(mode,'artifacts/rc18/independent-review/'+('final-source' if mode=='source' else 'final-asar'));proof=str(Path(folder)/'run-manifest.json');matches=[v for v in read(proof)['results'] if v['suite']==suite]
            elif family=='supplemental':
                proof='artifacts/rc18/supplemental/runs.json';matches=[v for v in read(proof)['suites'] if v['suite']==suite and v['mode']==mode]
            elif family=='rc18-independent':
                folder=cfg.get('independentDirectories',{}).get(mode,'artifacts/rc18-independent/'+('final3-source' if mode=='source' else 'final3-asar'));proof=str(Path(folder)/'manifest.json');matches=[v for v in read(proof)['runs'] if v['kind']==suite]
            elif family=='rc18-ui':
                folder=Path(ui[mode]['restore'])/suite.split('-',1)[1] if suite.startswith('restore-') else Path(ui[mode][suite]);proof=str(folder/'run-envelope.json');matches=[read(proof)]
            elif family=='rc18-independent-folder':
                proof=cfg.get('independentFolderProofs',{}).get(mode,'artifacts/rc18-independent/final3-folder-'+('source' if mode=='source' else 'asar')+'-evidence.json');matches=[read(proof)]
            elif family=='independent-restore':
                folder=cfg.get('independentRestoreDirectories',{}).get(mode);assert folder,'Explicit independent restore output directory is not configured';proof=str(Path(folder)/'run-envelope.json');matches=[read(proof)]
            else:
                proof='artifacts/rc18/package-unit/results.json' if suite=='package-unit' else f'artifacts/rc18/{suite}-binding.json';matches=[read(proof)]
            assert len(matches)==1,f'Expected exactly one suite row, found {len(matches)}'
            override=cfg.get('groupSelections',{}).get(mode+'/'+g['group'])
            if override:
                proof=override['proof'];envelope=read(proof);data=read(override.get('executionFile') or envelope.get('runsFile') or proof)
                items=[data] if isinstance(data,dict) and 'suite' in data else data if isinstance(data,list) else data.get('results',data.get('suites',[]));matches=[v for v in items if v.get('suite')==override.get('suite',suite)]
                assert len(matches)==1,'Explicit replacement did not resolve to exactly one execution'
            row=matches[0];start=dt.datetime.fromisoformat(row['startedAt'].replace('Z','+00:00'));end=dt.datetime.fromisoformat((row.get('completedAt') or row.get('finishedAt') or row.get('endedAt')).replace('Z','+00:00'))
            if start<frozen or end<start:error='Original execution predates current freeze or dates are reversed'
            elif row.get('exitCode',row.get('childExitCode'))!=0:error='Original execution has not completed successfully'
            elif row.get('provisionalRuntime') is True:error='Provisional runtime; development evidence only'
            elif row.get('passed') is False or row.get('matchingRunIdentity') is False:error='Execution envelope failed outcome or result-identity checks'
            if error is None:
                S.F.nested_execution_gate(row,proof+' selected '+suite)
                if override and family not in S.TARGETED:
                    files=override.get('evidenceFiles') or row.get('evidenceFiles') or row.get('resultFiles') or [row['result']]
                    execution_files=override.get('executionEvidenceFiles', [])
                elif family in S.TARGETED:
                    base=S.F.path(cfg.get('targetedDirectories',{}).get(mode,{}).get(family,'artifacts/rc18/'+family+'-'+mode))
                    files=row.get('evidenceFiles') or [S.rel(p) for p in helper.suite_paths(family,suite,row,base)]
                    if suite in ['confirmations','target-confirmations'] or (family=='new-targeted' and suite in ['transactions','startup-restore','missed-restore-notice']):
                        execution_files=[str(S.F.path(row.get('evidenceDirectory') or base/suite)/'run.json')]
                    elif family=='extension' and suite in ['rc12-review','rc12-tools','rc12-format','rc12-text','album-refresh']:
                        execution_files=[str(S.F.path(row.get('evidenceDirectory') or base/suite)/'execution.json')]
                    elif family=='focused' and suite=='avatar-access':
                        directory=S.F.path(row.get('evidenceDirectory') or (Path(row['result']).parent if row.get('result') else base/suite))
                        execution_files=[str(directory/'execution.json')]
                elif family=='ordinary-independent':files=selected['evidenceFiles'];execution_files=selected.get('executionEvidenceFiles',[])
                elif family in ['inherited-folder','rc18-independent','rc18-independent-folder']:files=[row['report']]
                elif family=='standalone':files=row.get('evidenceFiles') or [row['result']]
                else:files=row['evidenceFiles']
                if override:
                    files=override.get('evidenceFiles') or row.get('evidenceFiles') or row.get('resultFiles') or ([row['result']] if isinstance(row.get('result'),str) else files)
                    execution_files=override.get('executionEvidenceFiles',execution_files)
                for file in execution_files:S.F.nested_execution_gate(read(file),file)
                leaves=[]
                for file in files:
                    if g['category']=='node':leaves.extend(helper.node_log(file)[1])
                    else:
                        result=read(file);S.F.nested_execution_gate(result,file);found=S.F.collect_checks(result)
                        assert found,f'{file}: no assertion leaves'
                        leaves.extend(found)
                assert all(v['status'] in ['passed','observed'] for _,v in leaves),'A selected assertion is not a completed pass/observation'
                observations=sum(v['status']=='observed' or v.get('name','').startswith('Workbook format observation:') for _,v in leaves)
                actual_count=len(leaves)-observations;contract=contracts[(mode,g['group'])]
                if g['category']!='node':
                    assert actual_count==contract['expectedPassed'] and observations==contract['expectedObservations'],f'Suite completion mismatch: actual {actual_count}/{observations}, expected {contract["expectedPassed"]}/{contract["expectedObservations"]}'
                    if contract.get('expectedAssertionNames'):assert sorted(v['name'] for _,v in leaves)==sorted(contract['expectedAssertionNames']),'Complete named assertion set differs from declared inherited scenarios'
        except (S.F.GateError,AssertionError,KeyError,ValueError,TypeError,OSError) as e:error=str(e)
        rows.append({'mode':mode,'group':g['group'],'family':family,'proof':proof,'availableForStrictReview':error is None,'gap':error,'observedLeafCountForIntegrityReviewOnly':actual_count,'evidenceFiles':files,'executionEvidenceFiles':execution_files,'startedAt':row.get('startedAt') if row else None,'completedAt':(row.get('completedAt') or row.get('finishedAt') or row.get('endedAt')) if row else None})
    expected={**freeze['files'],**freeze['assetFiles'],**freeze['packageFiles'],**freeze['packagedDocuments']}
    retired=S.read('artifacts/rc18-report/retired-candidates.json')['candidates']
    candidate_retired=S.sha('artifacts/rc18/frozen-source.json') in {v['frozenSourceManifestSha256'] for v in retired}
    if candidate_retired:
        for row in rows:row.update(availableForStrictReview=False,gap='This candidate was explicitly retired; diagnostic only')
    mismatches=[p for p,h in expected.items() if not S.F.path(p).is_file() or S.sha(p)!=h]
    file_set={S.rel(p) for p in (ROOT/'src').iterdir() if p.is_file()}
    result={'version':freeze['candidateVersion'],'partial':True,'finalized':False,'coordinatorSelected':False,'currentAssertions':None,'frozenAt':freeze['frozenAt'],
      'scope':'Availability only; all source/ASAR hashes, original evidence, duplicate checks and requirements still need finalizer/report gates.',
      'requiredGroups':len(rows),'availableForStrictReview':sum(r['availableForStrictReview'] for r in rows),'missingOrBlocked':sum(not r['availableForStrictReview'] for r in rows),
      'candidateRetired':candidate_retired,'runtimeStillMatchesFreeze':not candidate_retired and not mismatches and file_set==set(freeze['files']),'changedFrozenFiles':mismatches,'sourceFileSetChanged':file_set!=set(freeze['files']),'groups':rows}
    S.write('artifacts/rc18-report/evidence-availability.json',result)
    print(json.dumps({k:result[k] for k in ['requiredGroups','availableForStrictReview','missingOrBlocked','runtimeStillMatchesFreeze','sourceFileSetChanged']},ensure_ascii=False))
if __name__=='__main__':main()
