#!/usr/bin/env python3
"""Run only the explicitly selected inherited RC19 groups, preserving every attempt.

The default is preparation only. --execute additionally requires explicit frozen
manifest and ASAR identities supplied after the coordinator's build verification.
Old evidence is read solely to declare the expected assertion names before launch.
"""
from pathlib import Path
import argparse, collections, copy, datetime, hashlib, importlib.util, json, os, re, signal, shutil, subprocess, sys, time, uuid, tarfile
from rc19_evidence import Capture, harness_hashes, now, sha, rel

ROOT = Path(__file__).resolve().parent.parent
PLAN = ROOT / 'artifacts/rc19/inherited-remaining-run-plan.json'
FREEZE = ROOT / 'artifacts/rc19/frozen-source.json'
BASELINE = ROOT.parent.parent / 'flower-rc18-work/FlowerClassroom-source'
# Reuse the publication gate's assertion and nested process semantics.
spec = importlib.util.spec_from_file_location('rc19_finalizer', ROOT/'scripts/finalize-rc19.py')
gate = importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)

def write(p, value):
    p=Path(p); p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')

def require(ok, message):
    if not ok: raise RuntimeError(message)

def load(p): return json.loads(Path(p).read_text())
def identity(g): return g['mode']+'/'+g['group']
def sorted_names(values): return sorted(str(x) for x in values)

def node_checks(p):
    log=Path(p).read_text()
    passed=re.findall(r'^(?:ℹ|#) pass (\d+)\s*$',log,re.M)
    failed=re.findall(r'^(?:ℹ|#) fail (\d+)\s*$',log,re.M)
    require(len(passed)==len(failed)==1 and int(passed[0])>0 and int(failed[0])==0,'Node log lacks one completed positive, zero-failure summary')
    for key in ['cancelled','skipped','todo']:
        matches=re.findall(r'^(?:ℹ|#) '+key+r' (\d+)\s*$',log,re.M)
        require(len(matches)==1 and int(matches[0])==0,'Node summary has incomplete '+key)
    names=[m.group(1).strip() for m in re.finditer(r'^\s*✔ (.*?) \([\d.]+(?:ms|s)\)\s*$',log,re.M)]
    if not names: names=[m.group(1).strip() for m in re.finditer(r'^ok \d+ - (.+)$',log,re.M)]
    require(len(names)==int(passed[0]),'Node named assertions do not match completed pass summary')
    return [{'name':n,'status':'passed'} for n in names]

def mapped_contracts(groups, baseline):
    old={(g['mode'],g['group']):g for g in baseline['groups']}
    require(len(old)==210,'Historical inventory must contain exactly 210 distinct groups')
    remaining={(g['mode'],g['group']) for g in groups}
    regular={(g['mode'],g['group']) for g in baseline['groups'] if g['mode']=='source' and g['group'].startswith('source-')}
    require(len(groups)==184 and len(remaining)==184 and len(regular)==26 and remaining.isdisjoint(regular) and remaining|regular==set(old),'184 extended + 26 source regular must equal exactly 210 inherited groups')
    mappings=[]
    for filename in ['inherited-application-case-migrations.json','regular-contract-corrections.json']:
        p=ROOT/'artifacts/rc19'/filename
        if p.exists():
            value=load(p)
            for script in value if isinstance(value,list) else value.get('files',[]):
                for c in script.get('changedCases',[]):
                    if isinstance(c.get('original'),str) and isinstance(c.get('replacement'),str): mappings.append((script.get('file'),c))
    exact_map=ROOT/'artifacts/rc19/inherited-application-exact-name-map.json'
    if exact_map.exists():
        for change in load(exact_map):mappings.append((change['file'],change))
    identity_adaptations=load(ROOT/'artifacts/rc19/extended-identity-adaptations.json') if (ROOT/'artifacts/rc19/extended-identity-adaptations.json').exists() else {'files':[]}
    for change in identity_adaptations['files']:
        mappings.append((change['file'],{'original':change['oldAssertionName'],'replacement':change['newAssertionName'],'mapping':change['change']}))
    contracts=[]
    for g in groups:
        b=old[(g['mode'],g['group'])]
        names=[c['name'] for c in b['selectedAssertions']]
        changes=[]
        executed_files={value.replace('{ROOT}/','').replace(str(ROOT)+'/', '') for value in g['command']}
        executed_files|={'scripts/'+value for value in executed_files if '/' not in value and value.endswith('.cjs')}
        for file,c in mappings:
            if file in executed_files and c['original'] in names and c['original']!=c['replacement']:
                names=[c['replacement'] if n==c['original'] else n for n in names]
                changes.append({'file':file,**c})
        contracts.append({'mode':g['mode'],'group':g['group'],'category':g['category'],'expectedPassed':b['passed'],'expectedObservations':b['observations'],'expectedAssertionNames':names,'baselineNamesOnly':True,'baselineManifestSha256':sha(BASELINE/'artifacts/rc18/final-test-manifest.json'),'reviewedNameMappings':changes})
    workbook_map=ROOT/'artifacts/rc19/workbook-inherited-case-name-migrations.json'
    if workbook_map.exists():
        mapping=load(workbook_map);by_id={identity(c):c for c in contracts}
        for group in mapping['groups']:
            key=identity(group)
            if key not in by_id:continue
            c=by_id[key]
            require(c['baselineManifestSha256']==mapping['sources']['baselineFinalTestManifest']['sha256'],'Workbook name mapping baseline identity differs')
            require(len(group['expectedNames'])==group['expectedCount'] and group['expectedCount']>=group['originalCount'],'Workbook expected set silently omitted original cases')
            c.update(expectedPassed=group['expectedCount'],expectedAssertionNames=group['expectedNames'],workbookNameMapping=rel(workbook_map),workbookNameMappingSha256=sha(workbook_map),contractMapping='Reviewed RC19 global current-score/25-level workbook adaptation; exact script-scoped renames and additive deduction case, no removed coverage')
    return contracts

def snapshot(freeze):
    return {kind:{n:sha(ROOT/n) for n in freeze[kind]} for kind in ['files','assetFiles','packageFiles']}

def verify_snapshot(value, freeze):
    for kind in ['files','assetFiles','packageFiles']: require(value[kind]==freeze[kind],'Frozen '+kind+' mismatch; refreeze/rebuild/retest')

def make_adapters():
    """Only outer fixed paths change; inner assertions remain byte-identical."""
    changes=[]
    for old,new,replacements in [
      ('qa-startup-identity-rc18.cjs','qa-startup-identity-rc19.cjs',{
        "out=path.join(root,'artifacts/rc18/startup-identity')":"out=path.resolve(process.env.FLOWER_STARTUP_OUT||path.join(root,'artifacts/rc19/startup-identity'))",
        "'dist-rc18-final/win-unpacked/resources/app.asar'":"'dist-rc19-final/win-unpacked/resources/app.asar'"}),
      ('qa-extracted-unit-rc18.cjs','qa-extracted-unit-rc19.cjs',{
        "archive=path.join(root,'dist-rc18-final/win-unpacked/resources/app.asar')":"archive=path.resolve(process.env.FLOWER_QA_ASAR||path.join(root,'dist-rc19-final/win-unpacked/resources/app.asar'))",
        "out=path.join(root,'artifacts/rc18/package-unit')":"out=path.resolve(process.env.FLOWER_PACKAGE_UNIT_OUT||path.join(root,'artifacts/rc19/package-unit'))",
        "'artifacts/rc18/frozen-source.json'":"'artifacts/rc19/frozen-source.json'",
        "'artifacts/rc18/source-unit.log'":"'artifacts/rc19/source-unit.log'",
        "'scripts/qa-extracted-unit-rc18.cjs'":"'scripts/qa-extracted-unit-rc19.cjs'",
        "{cwd:temp,encoding:'utf8'":"{cwd:temp,env:{...process.env,FLOWER_RC19_EXTRACTED:temp},encoding:'utf8'"})]:
        source=ROOT/'scripts'/old; target=ROOT/'scripts'/new; content=source.read_text(); replacements_done=[]
        for a,b in replacements.items():
            require(a in content,'Outer adapter input changed: '+old+': '+a)
            count=content.count(a); content=content.replace(a,b); replacements_done.append({'old':a,'new':b,'occurrences':count})
        if target.exists(): require(target.read_text()==content,'Prepared adapter changed; review before replacing '+new)
        else: target.write_text(content)
        changes.append({'original':rel(source),'originalSha256':sha(source),'adapter':rel(target),'adapterSha256':sha(target),'scope':'launch/output identity only; assertions unchanged','replacements':replacements_done})
    return changes

def rules_leaves(kind, raw, expected):
    """Preserve the inherited rules/run.cjs positive field and phase contracts."""
    def same(a,b,label): require(a==b,'Rules '+kind+': '+label)
    def yes(row,keys):
        for k in keys: same(row.get(k),True,k)
    rows=raw.get('results',[])
    if kind=='ordinary-modules': return raw['checks']
    if kind=='warning-controls':
        same([r['phase'] for r in raw['runs']],['recovery','restart','unresolved'],'complete ordered phases')
        return [c for r in raw['runs'] for c in r['report']['checks']]
    if kind=='native-interactions':
        require(not raw.get('error'),'Rules native interaction error');same(raw.get('passed'),True,'passed');return rows
    if kind=='startup':
        same([x['mode'] for x in rows],['valid','malformed','oversize','read-failed','directory','missing','initial','badconfig','duplicateconfig','boundsconfig','invalidutf8config'],'complete ordered startup cases')
        for x in rows:
            yes(x,['mainWindowCreated','stateEqualsExpected','stateBytesPreserved','configBytesPreserved']);same(x.get('readOnly'),False,'readOnly')
            if x.get('workbookBytesPreserved') is not None:same(x['workbookBytesPreserved'],True,'workbook bytes')
            if x['mode'].endswith('config'):same(x.get('migrationRejected'),True,'migration rejected')
            else:
                same(x.get('zoom'),1.25,'zoom')
                require(x.get('workbookWarning')=='' if x['mode']=='valid' else bool(x.get('workbookWarning')),'required workbook warning')
    elif kind=='receipt-lifecycle':
        same([x['variant']+'/'+x['phase'] for x in rows],['no-change/operate','no-change/restart','rename/operate','rename/restart','restore/operate','restore/restart'],'complete ordered receipt phases')
        for x in rows:
            yes(x,['mainWindowCreated'])
            if x['phase']=='operate':yes(x,['mutationAccepted','studentsAndHistoryPreserved']);require(x.get('cleanupFaultCount',0)>0,'cleanup fault was exercised')
            else:yes(x,['loadedExpectedState','startupJsonPreserved']);same(x.get('receiptAfter'),False,'receipt cleared')
    elif kind=='explicit-rebuild-ui':
        same([x['variant'] for x in rows],['old-rename','old-restore','malformed-receipt','oversize'],'complete ordered rebuild cases')
        for x in rows:
            yes(x,['passed','loadedExactPriorClassroom','noticeSurvivesNavigationAndScoring','rulesGuarded','repairedJsonRulesUnchanged','warningClearedAfterRepair'])
            yes(x,['pairedBackupsByteExact'] if x['variant']!='oversize' else ['oversizeRebuildPreservesOriginal'])
    else: raise RuntimeError('Unknown inherited rules contract '+kind)
    same(len(rows),len(expected),'expected named leaves')
    for x in rows:
        same(x.get('exitCode'),0,'child exit');require(x.get('signal') is None and not x.get('error'),'child signal/error')
    return [{'name':name,'status':'passed','evidence':row} for name,row in zip(expected,rows)]

def extra_contract(g, reports, env, start_ns):
    """Check complete observers and inherited multi-process contracts."""
    proofs=[]
    def evidence(p):
        p=Path(p);require(p.is_file() and p.stat().st_mtime_ns>=start_ns,'Missing/freshness failure for '+str(p));value=load(p);proofs.append(p);return value
    if g['family']=='new-rc19':
        entry=g['entry']
        if g['group'] in ['current-score-journeys','secondary-pet-ui','pet-draw-live']:
            folder=Path(g['outputDirectory']);envelope=evidence(folder/'run-envelope.json');start=evidence(folder/'run-start.json');runtime=evidence(folder/'runtime-binding.json');report=reports[0]
            require(envelope.get('passed') is True and envelope.get('entry')==entry and envelope.get('sourceBefore',{}).get('sha256')==envelope.get('sourceAfter',{}).get('sha256'),'Current RC19 UI envelope must pass complete source/entry binding')
            require(report.get('complete') is True and report.get('runId')==envelope.get('runId')==start.get('runId')==runtime.get('runId') and runtime.get('entry')==entry and runtime.get('passed') is True and not report.get('errors'),'RC19 report/run/runtime identity')
            marker='FLOWER_QA_COMPLETE '+envelope['runId']+' '+str(g['contract']['expectedPassed'])
            require(marker in (folder/'run.log').read_text().splitlines(),'RC19 positive completion marker absent')
        if g['group']=='group-create-assign':
            folder=Path(g['outputDirectory']);summary=evidence(folder/'results.json');phases=summary.get('results',[])
            require(summary.get('mainEntry')==entry and summary.get('sourceChanged') is False and summary.get('sourceAtStart')==summary.get('sourceAtFinish'),'Group source and selected entry binding')
            require([p.get('phase') for p in phases]==['journeys','restart'],'Group journey/restart phases missing')
            for p,definition in zip(phases,g['expectedPhases']):
                report=load(definition['rawAssertionReport']);require(p.get('exitCode')==0 and not p.get('error') and p.get('report')==report and not report.get('errors') and not report.get('error'),'Group phase report/child mismatch')
                lines=(folder/(p['phase']+'.log')).read_text().splitlines();actual=[line[len('PASS_RC19_GROUP '):] for line in lines if line.startswith('PASS_RC19_GROUP ')]
                require(sorted_names(actual)==sorted_names(definition['expectedCases']) and not any('FAIL_RC19_GROUP' in line for line in lines),'Group positive per-case phase markers')
        if g['group']=='workbook-main-migration':
            summary=evidence(Path(g['outputDirectory'])/'summary.json');require(summary.get('passed') is True and summary.get('entry')==entry,'Workbook summary/entry binding')
            actual=[(r.get('scenario'),r.get('phase')) for r in summary.get('runs',[])];expected=[(r['scenario'],r['phase']) for r in g['expectedPhases']];require(actual==expected,'Workbook exact seven ordered phases')
            for phase,definition in zip(summary['runs'],g['expectedPhases']):
                folder=Path(definition['rawAssertionReport']).parent;report=load(folder/'results.json');envelope=evidence(folder/'run-envelope.json');runtime=evidence(folder/'runtime-binding.json')
                require(phase.get('exitCode')==0 and phase.get('passed') is True and not phase.get('error') and phase.get('report')==report,'Workbook child/report outcome')
                require(report.get('complete') is True and report.get('entry')==entry and not report.get('errors') and report.get('runId')==envelope.get('runId')==runtime.get('runId') and report.get('runtime')==runtime and runtime.get('passed') is True,'Workbook phase/run/runtime identity')
                require(envelope.get('sourceStable') is True and envelope.get('sourceBefore',{}).get('sha256')==envelope.get('sourceAfter',{}).get('sha256') and envelope.get('archiveBefore')==envelope.get('archiveAfter') and envelope.get('expectedCheckCount')==definition['expectedAssertionCount'],'Workbook frozen phase envelope')
                require('WORKBOOK_MAIN_COMPLETE '+envelope['runId']+' '+str(definition['expectedAssertionCount']) in (folder/'run.log').read_text().splitlines(),'Workbook phase completion marker')
    if g['group'].startswith('reaudit-migration-'):
        folder=Path(env['FLOWER_MIGRATION_EVIDENCE']);starts=sorted(folder.glob('process-*-start.json'));ends=sorted(p for p in folder.glob('process-*.json') if not p.name.endswith('-start.json'))
        require(starts and len(starts)==len(ends),'Every migration process must finish its observer')
        observed=[evidence(p) for p in ends]
        for p in observed:
            require(p.get('sourceUnchanged') and p.get('asarUnchanged') and p.get('harnessUnchanged') and not p.get('violations'),'Migration observer integrity')
            require(p.get('exitCode')==p.get('expectedExit') and all(c.get('passed') is True for c in p.get('children',[])),'Migration child outcome')
        require(any(str(Path(env['FLOWER_PACKAGE_MAIN']).parent/'legacy-migration.cjs') in p['runtimeLoads'] for p in observed),'Actual selected migration module was not observed')
        if 'migration-main-' in g['suite']:
            require(any(w['role']=='main' and w['preload']==str(Path(env['FLOWER_PACKAGE_MAIN']).parent/'preload.cjs') and w['url'].startswith((Path(env['FLOWER_PACKAGE_MAIN']).parent/'index.html').as_uri()) for p in observed for w in p['windows']),'Missing actual native main/preload/renderer')
    if g['group'].startswith('reaudit-classroom-'):
        folder=Path(env['CLASSROOM_OBSERVER_OUT']);observed=[evidence(p) for p in sorted(folder.glob('*-runtime.json'))];require(observed,'Missing classroom observer')
        if len(g['rawAssertionReports'])==2:
            manifest=evidence(Path(env['FLOWER_CLASSROOM_OUT'])/'run-manifest.json')
            require([r['phase'] for r in manifest.get('runs',[])]==['audit','restart'],'Classroom audit/restart phases incomplete');gate.nested_execution_gate(manifest,'classroom phases')
            require(sum(bool(o.get('electron')) for o in observed)==2,'Classroom must observe exactly two native phases')
        for o in observed:
            require(not o.get('violations') and o.get('dependenciesUnchanged') and o.get('runtimeUnchanged'),'Classroom dependency/runtime observer failed')
            gate.nested_execution_gate(o.get('spawns',[]),'classroom child')
            if o.get('electron') and 'identity-model' not in g['group']:
                require(o.get('windows'),'Classroom native phase has no renderer')
                for w in o['windows']:
                    require('/src/index.html' in w['url'] and w['url'].startswith('file://'+env['CLASSROOM_RUNTIME_ROOT']) and w['preload']==str(Path(env['CLASSROOM_RUNTIME_ROOT'])/'src/preload.cjs'),'Classroom selected renderer/preload mismatch')
        for report in reports:require(report.get('runtimeUnchanged') is True and report.get('archiveUnchanged') is not False,'Classroom reported runtime mismatch')
    if g['group'].startswith('reaudit-rules-'):
        observations=[evidence(p) for p in sorted(Path(env['RULE_AUDIT_OBSERVER_OUT']).glob('*-dependencies.json'))];require(observations,'Missing rules dependency observers')
        for o in observations:
            require(o.get('dependenciesUnchanged') is True and not o.get('violations'),'Rules dependency boundary');gate.nested_execution_gate(o.get('spawns',[]),'rules child')
    if g['group'].startswith('reaudit-imports-'):
        raw=reports[0];require(raw.get('completed') is True,'Imports did not finish all cases')
        proc=evidence(Path(env['AUDIT_OUT'])/'process.json');gate.nested_execution_gate(proc,'imports process')
        require(proc.get('exitCode')==proc.get('status')==0 and not proc.get('error') and not proc.get('signal') and not proc.get('evidenceErrors'),'Imports child did not finish cleanly')
        casefile=load(ROOT/'scripts/qa-rc18-import-cases.json');kind='snapshot' if 'snapshot' in g['group'] else 'focused'
        require(sorted_names(c['name'] for c in raw['checks'])==sorted_names(casefile[kind]['expectedCaseNames']),'Imports required scenario names differ')
    return proofs

def retain_temporary(directory, archive, runroot, invocation):
    """Release only byte-identical disposable runtime copies, archive all fixture data."""
    directory=Path(directory)
    if not directory.exists():return
    released=[]
    for p in sorted(directory.rglob('*')):
        if not p.is_file() or p.is_symlink():continue
        reference=None
        if p.name=='app.asar' and p.stat().st_size==archive.stat().st_size and sha(p)==sha(archive):reference=archive
        elif 'node_modules' in p.parts:
            parts=p.parts;index=parts.index('node_modules');candidate=ROOT/'node_modules'/Path(*parts[index+1:])
            if candidate.is_file() and candidate.stat().st_size==p.stat().st_size and sha(p)==sha(candidate):reference=candidate
        if reference is not None:released.append({'file':rel(p),'sha256':sha(p),'sizeBytes':p.stat().st_size,'identicalRetainedRuntime':rel(reference) if reference.resolve().is_relative_to(ROOT) else str(reference.resolve())})
    if released:
        write(runroot/'temporary-retention'/invocation/'identical-runtime-copies.json',{'completedInvocation':invocation,'scope':'Only independently hash-matched disposable runtime copies; no fixture data removed','files':released})
        for item in released:(ROOT/item['file']).unlink()
    target=runroot/'temporary-retention'/invocation/'synthetic-fixtures.tar.xz';target.parent.mkdir(parents=True,exist_ok=True)
    with tarfile.open(target,'w:xz',preset=7) as archive_file:archive_file.add(directory,arcname='temporary-fixtures')
    # Verify archive structure and every file digest before replacing the original temporary directory.
    with tarfile.open(target,'r:xz') as archive_file:
        for member in archive_file.getmembers():
            if member.isfile():
                original=directory/Path(member.name).relative_to('temporary-fixtures')
                require(hashlib.sha256(archive_file.extractfile(member).read()).hexdigest()==sha(original),'Temporary evidence archive mismatch')
    write(target.with_suffix('.manifest.json'),{'archive':rel(target),'sha256':sha(target),'sizeBytes':target.stat().st_size,'verifiedEveryMember':True,'originalTemporaryDirectory':rel(directory),'completedInvocation':invocation,'retainedAllSyntheticFixtureBytes':True})
    shutil.rmtree(directory)

def evidence_checkpoint(runroot, results, first=0):
    """Persist a bounded complete evidence chunk; explicitly not a release archive."""
    target=ROOT/'artifacts/rc19/evidence-checkpoints'/(runroot.name+'-through-'+str(len(results))+'.tar.xz')
    target.parent.mkdir(parents=True,exist_ok=True);paths=set()
    for filename in ['plan.json','completion-contract.json','runs.json','selections.json','summary.json','launch-adapters.json','extraction-binding.json']:
        p=runroot/filename
        if p.is_file():paths.add(p)
    paths.add(FREEZE)
    for row in results[first:]:
        folder=ROOT/row['evidenceDirectory']
        paths.update(p for p in folder.iterdir() if p.is_file())
        paths.add(ROOT/row['physicalLaunchLog'])
        for snapshot in row.get('executedHarnessSnapshots',{}).values():paths.add(ROOT/snapshot['file'])
        for capture in row.get('evidenceCapture',[]):
            paths.add(ROOT/capture['file'])
            # Screenshots directly beside a declared synthetic assertion/phase report only.
            raw=ROOT/capture['rawFile']
            if raw.parent.exists():paths.update(raw.parent.glob('*.png'))
    require(all(p.is_file() and p.resolve().is_relative_to(ROOT) and 'private-roster' not in str(p) for p in paths),'Checkpoint contains an unsafe or missing input')
    manifest={'schema':'rc19-partial-evidence-checkpoint-v1','incompleteRelease':True,'runDirectory':rel(runroot),'completedGroups':len(results),'chunkGroups':[r['group'] for r in results[first:]],'files':{rel(p):sha(p) for p in sorted(paths)},'notes':'Exact execution records, synthetic screenshots and harness bytes only; no user profiles or private rosters; not final acceptance or a release archive'}
    index=target.with_suffix('.json');write(index,manifest)
    with tarfile.open(target,'w:xz',preset=7) as archive_file:
        archive_file.add(index,arcname='checkpoint-manifest.json')
        for p in sorted(paths):archive_file.add(p,arcname=rel(p))
    with tarfile.open(target,'r:xz') as archive_file:
        for name,digest in manifest['files'].items():require(hashlib.sha256(archive_file.extractfile(name).read()).hexdigest()==digest,'Checkpoint archive member mismatch')
    record={'path':rel(target),'sha256':sha(target),'sizeBytes':target.stat().st_size,'completedGroups':len(results),'verifiedEveryMember':True,'incompleteRelease':True}
    write(target.with_suffix('.verified.json'),record);print('EVIDENCE_CHECKPOINT '+json.dumps(record),flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute',action='store_true');parser.add_argument('--mode',choices=['source','packaged','both'],default='both')
    parser.add_argument('--only',help='Comma-separated exact group identities or family names')
    parser.add_argument('--run-id');parser.add_argument('--expected-freeze-sha');parser.add_argument('--expected-asar-sha')
    parser.add_argument('--asar',default=str(ROOT/'dist-rc19-final/win-unpacked/resources/app.asar'))
    parser.add_argument('--extras',action='store_true',help='Include the eight explicitly declared RC19 groups before inherited groups')
    parser.add_argument('--contract',help='Reviewed explicit group completion overrides; no inferred omissions')
    parser.add_argument('--timeout',type=int,default=720);parser.add_argument('--minimum-free-mb',type=int,default=700)
    args=parser.parse_args()
    plan=load(PLAN);baseline=load(BASELINE/'artifacts/rc18/final-test-manifest.json');contracts=mapped_contracts(plan['groups'],baseline);by_contract={identity(c):c for c in contracts}
    extras=[]
    if args.extras:
        extra_plan=load(ROOT/'artifacts/rc19/new-group-launch-contracts.json')
        for g in extra_plan['groups']:
            g['suite']=g['group'];g['category']='regression'
            by_contract[identity(g)]={'mode':g['mode'],'group':g['group'],'category':'regression','expectedPassed':g['expectedAssertionCount'],'expectedObservations':0,'expectedAssertionNames':g['expectedCases'],'definition':'Inspected exact current QA declarations before execution','definitionFile':'artifacts/rc19/new-group-launch-contracts.json'}
            extras.append(g)
    if args.contract:
        overrides=load(args.contract);require(overrides.get('coordinatorReviewed') is True,'Contract overrides require coordinator review')
        for c in overrides['groups']:
            require(identity(c) in by_contract,'Unknown override group');require(c.get('reason') or c.get('contractMapping'),'Override needs explicit RC19 contract mapping')
            require(c.get('expectedPassed',0)>0 and len(c.get('expectedAssertionNames',[]))==c['expectedPassed']+c.get('expectedObservations',0),'Override needs complete positive named cases')
            by_contract[identity(c)]={**by_contract[identity(c)],**c}
    stamp=args.run_id or datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')+'-'+uuid.uuid4().hex[:8]
    require(re.fullmatch(r'[A-Za-z0-9_.-]+',stamp),'Unsafe run identifier')
    runroot=ROOT/'artifacts/rc19/remaining'/stamp;require(not runroot.exists(),'Never overwrite a previous attempt');runroot.mkdir(parents=True)
    freeze=load(FREEZE);before=snapshot(freeze);freeze_sha=sha(FREEZE)
    if args.execute:verify_snapshot(before,freeze)
    archive=Path(args.asar).resolve();archive_sha=sha(archive) if archive.is_file() else None;extracted=runroot/'extracted-runtime'
    adapters=make_adapters();write(runroot/'launch-adapters.json',adapters)
    values={'ROOT':str(ROOT),'RUN_ID':stamp,'ASAR':str(archive),'ASAR_RELATIVE':rel(archive),'ASAR_SHA256':archive_sha or 'UNVERIFIED_ASAR','PAYLOAD':str(archive.parent.parent),'EXTRACTED_RUNTIME':str(extracted)}
    def expand(value):
        if isinstance(value,str):
            for k,v in values.items():value=value.replace('{'+k+'}',v)
            return value.replace(str(ROOT/'dist-rc18-final/win-unpacked'),values['PAYLOAD'])
        if isinstance(value,list):return [expand(v) for v in value]
        if isinstance(value,dict):return {k:expand(v) for k,v in value.items()}
        return value
    selected=[];only=set(args.only.split(',')) if args.only else None
    for original in extras+plan['groups']:
        if args.mode!='both' and original['mode']!=args.mode:continue
        if only and identity(original) not in only and original['family'] not in only:continue
        g=expand(copy.deepcopy(original));g['contract']=by_contract[identity(g)]
        if g['group']=='startup-identity':
            g['command']=['node','scripts/qa-startup-identity-rc19.cjs'];dest=runroot/'standalone/packaged/startup-identity';g['environment']['FLOWER_STARTUP_OUT']=str(dest);g['rawAssertionReports']=[str(dest/'results.json')]
        if g['group']=='package-unit':
            g['command']=['node','scripts/qa-extracted-unit-rc19.cjs'];dest=runroot/'standalone/packaged/package-unit';g['environment']['FLOWER_PACKAGE_UNIT_OUT']=str(dest);g['rawAssertionReports']=[str(dest/'run.log'),str(dest/'results.json')]
        g['environment'].update({'FLOWER_FREEZE_DIR':'artifacts/rc19','FLOWER_QA_FREEZE_FILE':str(FREEZE),'FLOWER_QA_ASAR':str(archive),'FLOWER_QA_ASAR_SHA256':archive_sha or '', 'FLOWER_QA_FREEZE_SHA256':freeze_sha})
        g['environment'].pop('FLOWER_QA_ALLOW_UNFROZEN',None)
        selected.append(g)
    require(selected,'No selected groups')
    # One physical launch for both restore phases; separate Capture and selections.
    invocations=collections.OrderedDict()
    for g in selected:invocations.setdefault(g['invocationKey'],[]).append(g)
    for key,gs in invocations.items():
        require(all(x['command']==gs[0]['command'] and x['environment']==gs[0]['environment'] for x in gs),'Shared invocation differs: '+key)
    document={'schema':'rc19-extended-preexecution-v1','runId':stamp,'createdAt':now(),'executionAuthorized':args.execute,'sourceManifestSha256':freeze_sha,'asarSha256':archive_sha,'historicalManifestNamesOnly':str(BASELINE/'artifacts/rc18/final-test-manifest.json'),'historicalManifestSha256':sha(BASELINE/'artifacts/rc18/final-test-manifest.json'),'fullInheritedCount':210,'sourceRegularCount':26,'remainingGroupCount':184,'selectedGroupCount':len(selected),'physicalLaunchCount':len(invocations),'windowsExecuted':False,'groups':selected}
    write(runroot/'plan.json',document);write(runroot/'completion-contract.json',{'coordinatorReviewed':False,'declaredBeforeExecution':True,'groups':[g['contract'] for g in selected]})
    print(json.dumps({'prepared':rel(runroot/'plan.json'),'groups':len(selected),'launches':len(invocations),'executed':False,'sourceMatchesFreeze':all(before[k]==freeze[k] for k in before)}),flush=True)
    if not args.execute:return 0
    require(args.expected_freeze_sha==freeze_sha,'Execution requires the coordinator-verified current freeze SHA')
    require(args.expected_asar_sha and args.expected_asar_sha==archive_sha,'Execution requires the coordinator-verified complete ASAR SHA')
    require(os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize>=args.minimum_free_mb*1024**2,'Insufficient free space for evidence; no launches started')
    # Extract once, verify all frozen production bytes before any packaged job.
    if any('{EXTRACTED_RUNTIME}' in json.dumps(g) for g in plan['groups'] if any(identity(g)==identity(s) for s in selected)):
        subprocess.run(['node','-e',"require('@electron/asar').extractAll(process.argv[1],process.argv[2])",str(archive),str(extracted)],cwd=ROOT,check=True)
        for n,h in {**freeze['files'],**freeze['assetFiles']}.items():require(sha(extracted/n)==h,'Extracted byte mismatch: '+n)
        write(runroot/'extraction-binding.json',{'asar':rel(archive),'asarSha256':archive_sha,'frozenSourceManifestSha256':freeze_sha,'files':{n:sha(extracted/n) for n in {**freeze['files'],**freeze['assetFiles']}},'exactFrozenBytes':True})
    results=[];selections=[];checkpoint_count=0;started=now();source_log=ROOT/'artifacts/rc19/source-unit.log'
    for invocation,gs in invocations.items():
        g=gs[0];captures=[];execution_proof_files=[];errors=[];code=125;sig=None;error=None
        invocation_dir=runroot/'invocations'/invocation;invocation_dir.mkdir(parents=True,exist_ok=True)
        require(os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize>=args.minimum_free_mb*1024**2,'Free space below safety floor before '+invocation+'; previous results retained')
        env={**os.environ,**g['environment'],'ELECTRON_CACHE':'/tmp/flower-electron-cache','XDG_CACHE_HOME':'/tmp/flower-cache'}
        env.pop('FLOWER_QA_ALLOW_UNFROZEN',None)
        Path(env.get('TMPDIR',str(runroot/'tmp'))).mkdir(parents=True,exist_ok=True)
        env['TMPDIR']=str(runroot/'tmp'/invocation);Path(env['TMPDIR']).mkdir(parents=True,exist_ok=True)
        dependency_out=invocation_dir/'dependency-observers'
        observer=ROOT/'scripts/qa-rc19-dependency-observer.cjs'
        env.update(FLOWER_RC19_DEPENDENCY_OUT=str(dependency_out),FLOWER_RC19_REPO=str(ROOT),FLOWER_RC19_MODE=g['mode'],FLOWER_RC19_EXTRACTED=str(extracted))
        env['NODE_OPTIONS']=(env.get('NODE_OPTIONS','')+' --require='+str(observer)).strip()
        if g['group']=='workbook-main-migration':
            seed_spec=load(ROOT/'artifacts/rc19/new-group-launch-contracts.json')['workbookSeedObserverContract'];seed_file=invocation_dir/'fixture-seed-contract.json';write(seed_file,seed_spec);env['FLOWER_RC19_SEED_CONTRACT']=str(seed_file)
        sb=snapshot(freeze);verify_snapshot(sb,freeze);ab=sha(archive);require(ab==archive_sha,'ASAR changed before launch')
        if g['group']=='rc18-independent-workbook':
            try:
                prior=next(r for r in reversed(results) if r['mode']==g['mode'] and r['group']=='rc18-independent-domain')
                require(prior.get('passed') is True and prior['exitCode']==0,'Current domain fixture producer did not pass')
                domain=next(x for x in selected if x['mode']==g['mode'] and x['group']=='rc18-independent-domain')
                fixture=Path(domain['environment']['RC18_AUDIT_OUT'])/'max-union.json';require(fixture.is_file(),'Fresh domain max-union fixture missing')
                target=ROOT/'artifacts/rc18-independent/source-domain/max-union.json';target.parent.mkdir(parents=True,exist_ok=True)
                if target.exists():shutil.copy2(target,invocation_dir/'prior-max-union.json')
                shutil.copy2(fixture,target);require(sha(fixture)==sha(target),'Generated fixture copy mismatch')
                write(invocation_dir/'generated-input-binding.json',{'producerGroup':identity(domain),'source':rel(fixture),'copy':rel(target),'sha256':sha(target),'producerExecution':prior['evidenceDirectory']+'/execution.json','currentRunOnly':True})
            except Exception as e:errors.append('Generated fixture dependency not satisfied: '+str(e))
        if 'migration-main-restart' in g['group']:
            previous=[r for r in results if r['mode']==g['mode'] and 'migration-main-preview' in r['group']]
            if not previous or previous[-1].get('passed') is not True:errors.append('Migration main restart requires the successful current preview phase')
        if g['group']=='package-unit':
            try:
                source_names=[c['name'] for c in node_checks(source_log)]
                excluded=[]
                for filename in ['preview-target-generation-rc13.test.cjs','preview-assets-rc18.test.cjs']:
                    excluded.extend(re.findall(r"test\('([^']+)'",(ROOT/'tests'/filename).read_text()))
                require(len(excluded)==2 and all(n in source_names for n in excluded),'Both excluded source-only preview tests must pass')
                names=[n for n in source_names if n not in excluded];g['contract'].update(expectedPassed=len(names),expectedAssertionNames=names,expectedObservations=0,sourceNodeNamesBoundTo=rel(source_log),sourceNodeLogSha256=sha(source_log))
            except Exception as e:errors.append('Package Node dependency not satisfied: '+str(e))
        hh=harness_hashes(g['command'],g['group']=='package-unit');hh.update({rel(Path(__file__)):sha(Path(__file__)),rel(ROOT/'scripts/finalize-rc19.py'):sha(ROOT/'scripts/finalize-rc19.py')})
        for key,value in env.items():
            if key in ['NODE_OPTIONS','FLOWER_MODEL_SCRIPT']:
                for filename in re.findall(r'(?:--require=)?([^ ]+\.(?:cjs|js))',value):
                    p=Path(filename)
                    if p.is_file() and p.is_relative_to(ROOT):hh[rel(p)]=sha(p)
        # Preserve execution-time harness bytes, even when later tests need corrections.
        snapshots={}
        for name,digest in hh.items():
            dest=runroot/'harness-snapshots'/digest/Path(name).name;dest.parent.mkdir(parents=True,exist_ok=True)
            if not dest.exists():dest.write_bytes((ROOT/name).read_bytes())
            snapshots[name]={'file':rel(dest),'sha256':digest,'reason':'Exact QA bytes preserved before this invocation'}
        for member in gs:
            for raw_file in member['rawAssertionReports']+member['executionProofReports']:Path(raw_file).parent.mkdir(parents=True,exist_ok=True)
            captures.append((member,Capture(invocation_dir/member['group'],member['suite'],member['mode'],g['command'],member['rawAssertionReports']+list(dict.fromkeys(p for p in member['executionProofReports'] if p not in member['rawAssertionReports'])))))
        write(runroot/'completion-contract.json',{'coordinatorReviewed':False,'declaredBeforeExecution':True,'groups':[m['contract'] for m in selected]})
        for member,capture in captures:
            capture.plan.update(environment={k:v for k,v in env.items() if k in g['environment'] or k in ['NODE_OPTIONS','TMPDIR','FLOWER_RC19_DEPENDENCY_OUT','FLOWER_RC19_REPO','FLOWER_RC19_MODE','FLOWER_RC19_EXTRACTED','FLOWER_RC19_SEED_CONTRACT']},plannedObserverDirectory=rel(dependency_out),expectedAssertionNames=member['contract']['expectedAssertionNames'])
            write(capture.directory/'execution-plan.json',capture.plan)
        begin_ns=time.time_ns();outer_log=invocation_dir/'outer.log';outer_log.parent.mkdir(parents=True,exist_ok=True)
        with outer_log.open('w') as log:
            if errors:log.write('\n'.join(errors)+'\n')
            else:
                try:
                    proc=subprocess.Popen(g['command'],cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                    try:code=proc.wait(timeout=args.timeout)
                    except subprocess.TimeoutExpired:
                        error='Outer timeout after '+str(args.timeout)+' seconds';os.killpg(proc.pid,signal.SIGTERM)
                        try:proc.wait(timeout=5)
                        except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait()
                        code=124
                    if code<0:sig=signal.Signals(-code).name
                except Exception as e:error=str(e);code=125
        sa=snapshot(freeze);aa=sha(archive);ha={name:sha(ROOT/name) for name in hh}
        for member,capture in captures:
            # Preserve the identical physical log under each group's capture envelope.
            capture.log.write_bytes(outer_log.read_bytes());group_errors=list(errors);leaves=[];proof_files=[]
            try:
                reports=[]
                for file in member['rawAssertionReports']:
                    p=Path(file);require(p.exists() and p.stat().st_mtime_ns>=begin_ns,'Missing/current report: '+file)
                    if p.suffix=='.json':
                        value=load(p);gate.nested_execution_gate(value,file);reports.append(value)
                if member['category']=='node':leaves=node_checks(member['rawAssertionReports'][0])
                elif member['group'].startswith('reaudit-rules-'):
                    kind=next(k for k in ['ordinary-modules','warning-controls','startup','receipt-lifecycle','native-interactions','explicit-rebuild-ui'] if member['group'].endswith('-'+k))
                    leaves=rules_leaves(kind,reports[0],member['contract']['expectedAssertionNames'])
                    normalized=Path(member['rawAssertionReports'][0]).parent/'assertions.json';write(normalized,leaves)
                    proof_files.append(Path(member['rawAssertionReports'][0]))
                else:leaves=[c for value in reports for _,c in gate.collect_checks(value)]
                positive=sum(c.get('status')=='passed' or c.get('passed') is True for c in leaves);observed=sum(c.get('status')=='observed' for c in leaves)
                require(positive==member['contract']['expectedPassed'] and observed==member['contract']['expectedObservations'] and positive+observed==len(leaves),'Incomplete/failed assertion count: '+str(positive)+'/'+str(len(leaves))+' expected '+str(member['contract']['expectedPassed']))
                require(sorted_names(c['name'] for c in leaves)==sorted_names(member['contract']['expectedAssertionNames']),'Exact predeclared assertion names differ')
                for file in member['executionProofReports']:
                    require(Path(file).is_file() and Path(file).stat().st_mtime_ns>=begin_ns,'Missing current phase proof '+file)
                    if Path(file).suffix=='.json':gate.nested_execution_gate(load(file),file);proof_files.append(Path(file))
                for phase in member.get('expectedPhases',[]):
                    phase_file=phase['rawAssertionReport'];phase_data=load(phase_file);phase_checks=[c for _,c in gate.collect_checks(phase_data)]
                    require(len(phase_checks)==phase['expectedAssertionCount'] and all(c.get('status')=='passed' or c.get('passed') is True for c in phase_checks),'Required phase count/outcome '+phase_file)
                    if phase.get('expectedCases'):require(sorted_names(c['name'] for c in phase_checks)==sorted_names(phase['expectedCases']),'Required phase names '+phase_file)
                proof_files+=extra_contract(member,reports,env,begin_ns)
                observer_files=sorted(dependency_out.glob('*.json'));require(observer_files,'Missing launch dependency evidence')
                dependency_count=0
                for observer_file in observer_files:
                    require(observer_file.stat().st_mtime_ns>=begin_ns,'Stale dependency observer')
                    observation=load(observer_file);require(observation.get('dependenciesUnchanged') is True and not observation.get('violations'),'Dependency boundary/integrity failure')
                    if observation.get('role')=='fixture-seed':
                        require(member['group']=='workbook-main-migration' and observation.get('seedSourcesUnchanged') is True and observation.get('observedExitCode')==observation.get('expectedSeedExitCode'),'Unverified fixture-seed outcome')
                    else:dependency_count+=len(observation.get('dependencies',[]))
                    proof_files.append(observer_file)
                if member['group']=='workbook-main-migration':
                    observations=[load(p) for p in observer_files];seeds=[o for o in observations if o.get('role')=='fixture-seed'];native=[o for o in observations if o.get('role')=='rc19-electron']
                    require(len(seeds)==6 and sorted(o['scenario'] for o in seeds)==sorted(s['scenario'] for s in member['seedProcesses']) and len(native)==7,'Workbook requires exactly six declared seeds and seven native product phases')
                # Static folder inspection and source-preview run without require-ing product modules.
                if member['group'] not in ['rc15-independent-package','preview']:require(dependency_count>0,'No actual selected runtime module was observed')
            except Exception as e:group_errors.append(str(e))
            if sb!=sa or any(sa[k]!=freeze[k] for k in sa):group_errors.append('Frozen source/assets/package changed')
            if ab!=aa or aa!=archive_sha:group_errors.append('ASAR changed')
            if hh!=ha:group_errors.append('Harness changed during invocation')
            row=capture.finish(code,error,extra={'group':member['group'],'category':member['category'],'invocationKey':invocation,'physicalLaunchLog':rel(outer_log),'signal':sig,'validationErrors':group_errors,'expectedPassed':member['contract']['expectedPassed'],'actualPassed':sum(c.get('status')=='passed' or c.get('passed') is True for c in leaves),'actualCaseCount':len(leaves),'harnessAtStart':hh,'harnessAtFinish':ha,'scriptUnchanged':hh==ha,'executedHarnessSnapshots':snapshots,'executionEvidenceFiles':[rel(p) for p in dict.fromkeys(proof_files)],'passed':code==0 and not error and not sig and not group_errors,'completionContract':member['contract']})
            # Resolve every phase companion to immutable preserved bytes before another mode can overwrite fixed paths.
            companion_map={v['rawFile']:v['file'] for v in row['evidenceCapture']}
            for i,proof_file in enumerate(dict.fromkeys(proof_files)):
                raw_name=rel(proof_file)
                if raw_name not in companion_map:
                    target=capture.directory/('extra-'+str(i+1)+'-'+proof_file.name);shutil.copy2(proof_file,target);require(sha(target)==sha(proof_file),'Proof copy changed')
                    row['evidenceCapture'].append({'rawFile':raw_name,'file':rel(target),'sha256':sha(target),'rawMtimeNs':proof_file.stat().st_mtime_ns,'sizeBytes':target.stat().st_size,'plannedObserverDirectory':rel(dependency_out) if proof_file.parent==dependency_out else None})
                    companion_map[raw_name]=rel(target)
            row['executionCompanionMap']=companion_map
            row['executionEvidenceFiles']=[companion_map[rel(p)] for p in dict.fromkeys(proof_files)]
            # Group reports stay separate even when one process emitted both phases.
            evidence=[v['file'] for v in row['evidenceCapture'] if v['rawFile'] in [rel(p) for p in member['rawAssertionReports']]]
            if member['category']=='node':evidence=evidence[:1];summary=next((load(v['file'] if Path(v['file']).is_absolute() else ROOT/v['file']) for v in row['evidenceCapture'] if v['rawFile'].endswith('/results.json')),{});row.update({k:summary[k] for k in ['passed','failed','sourceFilesEqual','excludedSourceOnlyTests'] if k in summary})
            if member['group'].startswith('reaudit-rules-') and not group_errors:
                normalized=capture.directory/'normalized-assertions.json';write(normalized,leaves);evidence=[rel(normalized)];row['evidenceFiles']+=evidence;row['availableEvidenceFiles']+=evidence
            row['resultFiles']=evidence;write(capture.directory/'execution.json',row)
            binding={'schema':'rc19-extended-binding-v1','mode':member['mode'],'version':freeze['candidateVersion'],'frozenAt':freeze['frozenAt'],'sourceManifestSha256':freeze_sha,'sourceAtStart':sb['files'],'sourceAtFinish':sa['files'],'assetsAtStart':sb['assetFiles'],'assetsAtFinish':sa['assetFiles'],'packageAtStart':sb['packageFiles'],'packageAtFinish':sa['packageFiles'],'sourceUnchanged':sb==sa,'asarSha256Before':ab,'asarSha256After':aa,'asarUnchanged':ab==aa,'startedAt':row['startedAt'],'completedAt':row['completedAt'],'syntheticOnly':True,'windowsExecuted':False}
            write(capture.directory/'binding.json',binding);results.append(row)
            selections.append({'mode':member['mode'],'group':member['group'],'suite':member['suite'],'category':member['category'],'proof':rel(capture.directory/'binding.json'),'executionFile':rel(capture.directory/'execution.json'),'executionPointer':'','evidenceFiles':evidence,'executionEvidenceFiles':row['executionEvidenceFiles'],'executedHarnessSnapshots':snapshots,'passed':row['exitCode']==0 and not group_errors and not row['evidenceCaptureErrors']})
            print(json.dumps({'group':identity(member),'exitCode':row['exitCode'],'passed':selections[-1]['passed'],'positive':row['actualPassed'],'expected':row['expectedPassed'],'errors':group_errors+row['evidenceCaptureErrors']}),flush=True)
        write(runroot/'runs.json',results);write(runroot/'selections.json',{'schemaVersion':1,'partial':True,'sourceManifestSha256':freeze_sha,'asarSha256':archive_sha,'groups':selections})
        retain_temporary(env['TMPDIR'],archive,runroot,invocation)
        if len(results)-checkpoint_count>=20:
            evidence_checkpoint(runroot,results,checkpoint_count);checkpoint_count=len(results)
    write(runroot/'completion-contract.json',{'coordinatorReviewed':False,'declaredBeforeExecution':True,'groups':[g['contract'] for g in selected]})
    write(runroot/'summary.json',{'startedAt':started,'completedAt':now(),'plannedGroups':len(selected),'completedGroups':len(results),'passedGroups':sum(s['passed'] for s in selections),'failedGroups':[identity(s) for s in selections if not s['passed']],'complete':len(results)==len(selected),'allPassed':all(s['passed'] for s in selections),'windowsExecuted':False})
    if len(results)>checkpoint_count:evidence_checkpoint(runroot,results,checkpoint_count)
    return 0 if all(s['passed'] for s in selections) else 1

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as error:print('RC19_EXTENDED_BLOCKED:',str(error),file=sys.stderr);sys.exit(2)
