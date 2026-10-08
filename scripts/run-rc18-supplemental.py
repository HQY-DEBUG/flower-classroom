from pathlib import Path
import subprocess,os,json,hashlib,datetime
from rc18_evidence import harness_hashes
r=Path(__file__).resolve().parent.parent;out=r/'artifacts/rc18/supplemental';out.mkdir(parents=True,exist_ok=True);freeze=json.loads((r/'artifacts/rc18/frozen-source.json').read_text());archive=r/'dist-rc18-final/win-unpacked/resources/app.asar'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();hashes=lambda:{n:sha(r/n) for n in freeze['files']};now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
before=hashes();ash=sha(archive);start=now();rows=[]
env={**os.environ,'TMPDIR':str(r.parents[1]/'flower-rc18-temp'),'FLOWER_QA_WORKERS':'1'}
jobs=[('ui-lifecycle','source',['node','scripts/qa-ui-lifecycle-rc10.cjs'],{'FLOWER_PACKAGE_MAIN':str(r/'src/main.cjs'),'FLOWER_UI_OUT':str(out/'ui-source')}),('folder-ui','source',['node','scripts/qa-folder-ui-rc15.cjs'],{'FLOWER_PACKAGE_MAIN':str(r/'src/main.cjs'),'FLOWER_FOLDER_UI_OUT':str(r/'artifacts/rc18/folder-ui-source')}),('folder-ui','packaged',['node','scripts/qa-folder-ui-rc15.cjs'],{'FLOWER_PACKAGE_MAIN':str(archive/'src/main.cjs'),'FLOWER_FOLDER_UI_OUT':str(r/'artifacts/rc18/folder-ui-packaged')}),('inherited-folder','source',['python','scripts/qa-run-independent-folder-rc18.py','--mode','source','--payload','dist-rc18-final/win-unpacked','--out','artifacts/rc18/independent-review/final-source'],{}),('inherited-folder','packaged',['python','scripts/qa-run-independent-folder-rc18.py','--mode','packaged','--payload','dist-rc18-final/win-unpacked','--out','artifacts/rc18/independent-review/final-asar'],{}),('preview-startup','packaged',['python','scripts/run-rc18-preview-startup.py'],{})]
for suite,mode,cmd,extra in jobs:
 evidence={('ui-lifecycle','source'):['artifacts/rc18/supplemental/ui-source/results.json'],('folder-ui','source'):['artifacts/rc18/folder-ui-source/results.json'],('folder-ui','packaged'):['artifacts/rc18/folder-ui-packaged/results.json'],('inherited-folder','source'):['artifacts/rc18/independent-review/final-source/run-manifest.json'],('inherited-folder','packaged'):['artifacts/rc18/independent-review/final-asar/run-manifest.json'],('preview-startup','packaged'):['artifacts/rc18/preview-binding.json','artifacts/rc18/startup-binding.json']}[(suite,mode)]
 assert hashes()==before==freeze['files'];assert sha(archive)==ash
 log=out/(suite+'-'+mode+'.log');started=now();script=cmd[1];scriptsha=sha(r/script)
 harness_before=harness_hashes(cmd)
 with log.open('w') as f:result=subprocess.run(cmd,cwd=r,env={**env,**extra},stdout=f,stderr=subprocess.STDOUT,timeout=650)
 harness_after=harness_hashes(cmd)
 row={'suite':suite,'mode':mode,'script':script,'scriptSha256':scriptsha,'harnessAtStart':harness_before,'harnessAtFinish':harness_after,'scriptUnchanged':sha(r/script)==scriptsha and harness_before==harness_after,'command':cmd,'evidenceFiles':evidence,'plannedBeforeExecution':True,'exitCode':result.returncode,'log':str(log.relative_to(r)),'startedAt':started,'completedAt':now()};rows.append(row);print(json.dumps(row),flush=True)
 record={'frozenAt':freeze['frozenAt'],'sourceManifestSha256':sha(r/'artifacts/rc18/frozen-source.json'),'sourceAtStart':before,'sourceAtFinish':hashes(),'sourceUnchanged':before==hashes(),'asarSha256':ash,'asarUnchanged':sha(archive)==ash,'startedAt':start,'completedAt':now(),'suites':rows};(out/'runs.json').write_text(json.dumps(record,indent=2))
assert all(x['exitCode']==0 for x in rows)
