"""Prepare the complete RC18 run plan or exact selections from existing execution rows.

This never reruns tests or invents timestamps/results. A missing suite blocks
selection. Explicit retests are handled later by finalize-rc18.py --retests.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import hashlib

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('finalizer',ROOT/'scripts/finalize-rc18.py')
F=importlib.util.module_from_spec(spec);spec.loader.exec_module(F)
TARGETED={
 'legacy-targeted':['cross-panel','destructive','imports','pets','receipts','modals','async-modals'],
 'new-targeted':['storage','crash','transactions','ui','independent-ui','restore-toolbox','restore-classroom','queued-restore','startup-restore','missed-restore-notice'],
 'features':['egg','avatars','avatar-import','egg-comprehensive','avatar-comprehensive','pet-feedback','keyboard'],
 'extension':['rc12-review','rc12-tools','rc12-import','rc12-format','rc12-text','target-confirmations','album-refresh'],
 'rc13-inherited':['confirmations','roster','roster-exact','feedback','cross-feature'],
 'focused':['score-editor','avatar-access'],
 'rc14-inherited':['feature','crash-recovery','response-loss'],
}
REGULAR=['ui','pets','catalog','primary','care','wheels','lock','groups','classroom','switch','narrow','organization','petextra','toolbox','navigation','palette','focus','lifecycle','lazy-excel','lock-layout','modal-headers','window-exits','adversarial','window-readonly']
DEFAULT_UI={
 'source':{'layout':'artifacts/rc18/ui-final3-source','defaults':'artifacts/rc18/configuration-ui-final3-source','restore':'artifacts/rc18/restore-ui-final3-source'},
 'packaged':{'layout':'artifacts/rc18/ui-final3-asar','defaults':'artifacts/rc18/configuration-ui-final3-asar','restore':'artifacts/rc18/restore-ui-final3-asar'},
}
def read(name):return F.read(name)
def sha(name):return F.sha(name)
def rel(name):return F.rel(name)
def write(name,d):
    p=F.path(name);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')

def plan():
    groups=[]
    names={'primary':'known-flows','care':'pet-care','switch':'pet-switch','petextra':'pet-extra'}
    for mode in ['source','packaged']:
        suites=(['unit']+REGULAR+['migration']) if mode=='source' else REGULAR
        for suite in suites:groups.append({'mode':mode,'group':('source-'+names.get(suite,suite)) if mode=='source' else suite,'suite':suite,'family':'regular','category':'node' if suite=='unit' else 'regression'})
        for stem,suites in TARGETED.items():
            for suite in suites:groups.append({'mode':mode,'group':('rc14-' if stem=='focused' else stem+'-')+suite,'suite':suite,'family':stem,'category':'regression'})
        for suite in ['modules','runtime','migration','migration-ipc']+(['package'] if mode=='packaged' else []):
            groups.append({'mode':mode,'group':'rc15-independent-'+suite,'suite':suite,'family':'inherited-folder','category':'regression'})
        groups.append({'mode':mode,'group':'rc15-folder-ui','suite':'folder-ui','family':'supplemental','category':'regression'})
        for suite in ['domain','workbook','unified','migration','electron']:
            groups.append({'mode':mode,'group':'rc18-independent-'+suite,'suite':suite,'family':'rc18-independent','category':'regression'})
        groups.append({'mode':mode,'group':'rc18-independent-folder-configuration','suite':'folder-configuration','family':'rc18-independent-folder','category':'regression'})
        for suite in ['layout','defaults','restore-normal','restore-protected']:
            groups.append({'mode':mode,'group':'rc18-ui-'+suite,'suite':suite,'family':'rc18-ui','category':'regression'})
        groups.append({'mode':mode,'group':'rc18-independent-restore','suite':'independent-ordinary-restore','family':'independent-restore','category':'regression'})
    groups.extend([
      {'mode':'packaged','group':'package-unit','suite':'package-unit','family':'standalone','category':'node'},
      {'mode':'packaged','group':'startup-identity','suite':'startup','family':'standalone','category':'startup'},
      {'mode':'source','group':'preview','suite':'preview','family':'standalone','category':'preview'},
    ])
    ordinary=read('artifacts/rc18-report/ordinary-independent-execution-plan.json')
    groups.extend({'mode':g['mode'],'group':g['group'],'suite':g['suite'],'family':'ordinary-independent','domain':g['domain'],'category':'regression'} for g in ordinary['groups'])
    assert len({(g['mode'],g['group']) for g in groups})==len(groups)
    return groups

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--plan-only',action='store_true')
    ap.add_argument('--config',help='Optional explicit uiDirectories/independentDirectories/supplementalVerifications paths')
    ap.add_argument('--confirm-coordinator-selection',action='store_true')
    ap.add_argument('--output',default='artifacts/rc18/final-selection.json')
    a=ap.parse_args();planned=plan();cfg=read(a.config) if a.config else {}
    if a.plan_only:
        out={'version':'1.3.0-rc.18','groups':planned,'requiredGroupCount':len(planned),'targetedFamilies':TARGETED,
          'uiDirectories':DEFAULT_UI,'status':'execution plan only; no results selected',
          'rules':['All seven inherited extension families must appear in both source and packaged scopes.','Every selected execution must start after the final freeze and bind current source/ASAR bytes.','Select assertion leaves only; do not also add the same suite aggregate or independent summary.','Private two-class scenario is separately summarized, never added to final synthetic assertion totals.','Old interrupted/candidate runs and harness corrections remain development evidence.']}
        write('artifacts/rc18-report/required-run-plan.json',out);print(json.dumps({'requiredGroups':len(planned),'plan':'artifacts/rc18-report/required-run-plan.json'}));return
    freeze=read('artifacts/rc18/frozen-source.json');groups=[];cache={}
    ui=cfg.get('uiDirectories',DEFAULT_UI)
    helper=F.Finalizer.__new__(F.Finalizer)
    def get(file):
        if file not in cache:cache[file]=read(file)
        return cache[file]
    def one(rows,predicate,label):
        matches=[(i,row) for i,row in enumerate(rows) if predicate(row)]
        F.require(len(matches)==1,f'{label}: expected one original execution, got {len(matches)}')
        return matches[0]
    for p in planned:
        mode,suite,family=p['mode'],p['suite'],p['family'];proof=execution=None;pointer='';files=[];execution_files=[]
        if family=='ordinary-independent':
            registry=get(cfg.get('ordinaryIndependentSelections','artifacts/rc18/ordinary-independent-selections.json'))
            _,selection=one(registry['groups'],lambda g:g['mode']==mode and g['group']==p['group'],p['group'])
            F.require(selection.get('selectionReason'),'Ordinary inherited independent selection requires its source description')
            selected={**selection,'category':'regression'}
            if cfg.get('harnessSnapshotMappings',{}).get(mode+'/'+p['group']):selected['executedHarnessSnapshots']=cfg['harnessSnapshotMappings'][mode+'/'+p['group']]
            if cfg.get('harnessVersionIndexes',{}).get(mode+'/'+p['group']):selected['harnessVersionIndex']=cfg['harnessVersionIndexes'][mode+'/'+p['group']]
            groups.append(selected)
            continue
        if family=='regular':
            proof=cfg.get('regularBindingProofs',{}).get(mode,f'artifacts/rc18/{mode}-run-binding.json');binding=get(proof)
            execution=binding.get('runsFile',f'artifacts/rc18/{mode}-runs.json');data=get(execution)
            rows=data if isinstance(data,list) else data['results']
            expected=set(REGULAR)|({'unit','migration'} if mode=='source' else set())
            F.require({r['suite'] for r in rows}==expected,f'{mode}: regular suite set incomplete')
            i,row=one(rows,lambda r:r['suite']==suite,p['group']);pointer=('/' if isinstance(data,list) else '/results/')+str(i);files=row['evidenceFiles']
        elif family in TARGETED:
            base=Path(cfg.get('targetedDirectories',{}).get(mode,{}).get(family,'artifacts/rc18/'+family+'-'+mode));proof=str(base/'runs.json');execution=proof;data=get(proof)
            F.require({r['suite'] for r in data['suites']}==set(TARGETED[family]),f'{family}/{mode}: missing inherited suite; partial wrappers are not final evidence')
            i,row=one(data['suites'],lambda r:r['suite']==suite,p['group']);pointer='/suites/'+str(i)
            files=row.get('evidenceFiles') or [rel(v) for v in helper.suite_paths(family,suite,row,F.path(base))]
            if suite in ['confirmations','target-confirmations'] or (family=='new-targeted' and suite in ['transactions','startup-restore','missed-restore-notice']):
                directory=F.path(row.get('evidenceDirectory') or base/suite)
                execution_files=[rel(directory/'run.json')]
            elif family=='extension' and suite in ['rc12-review','rc12-tools','rc12-format','rc12-text','album-refresh']:
                directory=F.path(row.get('evidenceDirectory') or base/suite)
                execution_files=[rel(directory/'execution.json')]
            elif family=='focused' and suite=='avatar-access':
                directory=F.path(row.get('evidenceDirectory') or (Path(row['result']).parent if row.get('result') else base/suite))
                execution_files=[rel(directory/'execution.json')]
        elif family=='inherited-folder':
            folder='final-source' if mode=='source' else 'final-asar'
            base=cfg.get('inheritedFolderDirectories',{}).get(mode,f'artifacts/rc18/independent-review/{folder}')
            proof=str(Path(base)/'run-manifest.json');execution=proof;data=get(proof)
            i,row=one(data['results'],lambda r:r['suite']==suite,p['group']);pointer='/results/'+str(i);files=[rel(row['report'])]
        elif family=='supplemental':
            proof=execution='artifacts/rc18/supplemental/runs.json';data=get(proof)
            i,row=one(data['suites'],lambda r:r['suite']==suite and r['mode']==mode,p['group']);pointer='/suites/'+str(i);files=row['evidenceFiles']
        elif family=='rc18-independent':
            folder=cfg.get('independentDirectories',{}).get(mode,'artifacts/rc18-independent/'+('final3-source' if mode=='source' else 'final3-asar'))
            proof=execution=str(Path(folder)/'manifest.json');data=get(proof)
            F.require({r['kind'] for r in data['runs']}=={'domain','workbook','unified','migration','electron'},f'{mode}: new independent domains incomplete')
            i,row=one(data['runs'],lambda r:r['kind']==suite,p['group']);pointer='/runs/'+str(i);files=[rel(row['report'])]
        elif family=='rc18-ui':
            folder=Path(ui[mode]['restore'])/suite.split('-',1)[1] if suite.startswith('restore-') else Path(ui[mode][suite])
            proof=execution=str(folder/'run-envelope.json');data=get(proof);files=[rel(v) for v in data['evidenceFiles']]
        elif family=='rc18-independent-folder':
            proof=execution=cfg.get('independentFolderProofs',{}).get(mode,'artifacts/rc18-independent/final3-folder-'+('source' if mode=='source' else 'asar')+'-evidence.json')
            data=get(proof);files=[rel(data['report'])]
        elif family=='independent-restore':
            folder=cfg.get('independentRestoreDirectories',{}).get(mode)
            F.require(folder,f'{mode}: supply the verified independent restore output directory explicitly')
            proof=execution=str(Path(folder)/'run-envelope.json');data=get(proof);files=[rel(v) for v in data['evidenceFiles']]
        elif family=='standalone':
            proof=execution='artifacts/rc18/package-unit/results.json' if suite=='package-unit' else f'artifacts/rc18/{suite}-binding.json'
            row=get(proof);files=row.get('evidenceFiles') or [row['result']]
        else:raise AssertionError(family)
        selected={**{k:p[k] for k in ['mode','group','suite','category']},'proof':proof,'executionFile':execution,'executionPointer':pointer,'evidenceFiles':[rel(f) for f in files],'executionEvidenceFiles':execution_files}
        override=cfg.get('groupSelections',{}).get(mode+'/'+p['group'])
        if override:
            F.require(override.get('reason'),'An explicit suite replacement requires its reason')
            replacement=get(override['proof']);replacement_file=override.get('executionFile') or replacement.get('runsFile') or override['proof'];replacement_data=get(replacement_file)
            top_level=isinstance(replacement_data,dict) and 'suite' in replacement_data
            candidates=[replacement_data] if top_level else replacement_data if isinstance(replacement_data,list) else replacement_data.get('results',replacement_data.get('suites',[]))
            j,newrow=one(candidates,lambda r:r.get('suite')==override.get('suite',suite),p['group']+' replacement')
            newpointer='' if top_level else ('/' if isinstance(replacement_data,list) else '/results/' if 'results' in replacement_data else '/suites/')+str(j)
            selected['replaces']={k:selected[k] for k in ['proof','executionFile','executionPointer','evidenceFiles','executionEvidenceFiles']}
            selected['replaces']['suite']=suite
            previous=selected['replaces']
            missing_previous=[f for f in previous['evidenceFiles'] if not F.path(f).is_file()]
            if missing_previous:
                previous['missingEvidenceFiles']=missing_previous
                previous['evidenceFiles']=[f for f in previous['evidenceFiles'] if F.path(f).is_file()]
                if row.get('log') and F.path(row['log']).is_file():previous['evidenceFiles'].append(row['log'])
            previous['missingExecutionEvidenceFiles']=[f for f in previous['executionEvidenceFiles'] if not F.path(f).is_file()]
            previous['executionEvidenceFiles']=[f for f in previous['executionEvidenceFiles'] if F.path(f).is_file()]
            replacement_files=override.get('evidenceFiles') or newrow.get('evidenceFiles') or newrow.get('resultFiles') or ([newrow['result']] if isinstance(newrow.get('result'),str) else None)
            F.require(replacement_files,'Explicit replacement needs its original result references')
            selected.update(proof=override['proof'],executionFile=replacement_file,executionPointer=newpointer,evidenceFiles=replacement_files,selectionReason=override['reason'])
            selected['suite']=newrow['suite']
            if 'executionEvidenceFiles' in override:selected['executionEvidenceFiles']=override['executionEvidenceFiles']
            if override.get('initialClassification'):selected['initialClassification']=override['initialClassification']
        snapshot=cfg.get('harnessSnapshotMappings',{}).get(mode+'/'+p['group'])
        if snapshot:selected['executedHarnessSnapshots']=snapshot
        groups.append(selected)
    result={'schemaVersion':1,'version':freeze['candidateVersion'],'coordinatorSelected':a.confirm_coordinator_selection,
      'fullInheritedRegression':True,'independentReviewComplete':True,
      'sourceManifestSha256':sha('artifacts/rc18/frozen-source.json'),'asarSha256':sha('dist-rc18-final/win-unpacked/resources/app.asar'),
      'expectedGroups':[g['mode']+'/'+g['group'] for g in groups],'groups':groups,
      'supplementalVerifications':cfg.get('supplementalVerifications',[]),
      'completionContract':'artifacts/rc18-report/completion-contract.json','completionContractSha256':sha('artifacts/rc18-report/completion-contract.json'),
      'counting':'Exact assertion leaves selected once per execution/scope; aggregate manifests and summary subset counts are not added again.'}
    write(a.output,result);print(json.dumps({'groups':len(groups),'coordinatorSelected':a.confirm_coordinator_selection,'output':a.output}))

if __name__=='__main__':
    try:main()
    except (F.GateError,KeyError,TypeError,OSError) as error:raise SystemExit('RC18 SELECTION BLOCKED: '+str(error))
