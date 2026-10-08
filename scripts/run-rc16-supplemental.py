from pathlib import Path
import subprocess,os,json,hashlib,datetime
r=Path(__file__).resolve().parent.parent;out=r/'artifacts/rc16/supplemental';out.mkdir(parents=True,exist_ok=True);freeze=json.loads((r/'artifacts/rc16/frozen-source.json').read_text());archive=r/'dist-rc16-final/win-unpacked/resources/app.asar'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();hashes=lambda:{n:sha(r/n) for n in freeze['files']};now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
before=hashes();ash=sha(archive);start=now();rows=[]
env={**os.environ,'TMPDIR':str(r.parents[1]/'flower-rc16-temp'),'FLOWER_QA_WORKERS':'1'}
jobs=[('legacy-targeted-modals','source',['node','artifacts/rc9/modal-audit/audit.cjs'],{'FLOWER_PACKAGE_MAIN':str(r/'src/main.cjs'),'FLOWER_MODAL_OUT':str(out/'source-modals')}),('legacy-targeted-async-modals','source',['node','artifacts/rc9/modal-audit/extended.cjs'],{'FLOWER_PACKAGE_MAIN':str(r/'src/main.cjs'),'FLOWER_MODAL_OUT':str(out/'source-async-modals')}),('folder-ui','source',['node','scripts/qa-folder-ui-rc15.cjs'],{'FLOWER_PACKAGE_MAIN':str(r/'src/main.cjs'),'FLOWER_FOLDER_UI_OUT':str(r/'artifacts/rc16/folder-ui-source')}),('folder-ui','packaged',['node','scripts/qa-folder-ui-rc15.cjs'],{'FLOWER_PACKAGE_MAIN':str(archive/'src/main.cjs'),'FLOWER_FOLDER_UI_OUT':str(r/'artifacts/rc16/folder-ui-packaged')}),('inherited-folder','packaged',['python','scripts/qa-run-independent-folder-rc16.py','--mode','packaged','--payload','dist-rc16-final/win-unpacked','--out','artifacts/rc16-independent-review/final-asar'],{}),('preview-startup','packaged',['python','scripts/run-rc16-preview-startup.py'],{})]
for suite,mode,cmd,extra in jobs:
 assert hashes()==before==freeze['files'];assert sha(archive)==ash
 log=out/(suite+'-'+mode+'.log');started=now();script=cmd[1];scriptsha=sha(r/script)
 with log.open('w') as f:result=subprocess.run(cmd,cwd=r,env={**env,**extra},stdout=f,stderr=subprocess.STDOUT,timeout=650)
 row={'suite':suite,'mode':mode,'script':script,'scriptSha256':scriptsha,'scriptUnchanged':sha(r/script)==scriptsha,'command':cmd,'exitCode':result.returncode,'log':str(log.relative_to(r)),'startedAt':started,'completedAt':now()};rows.append(row);print(json.dumps(row),flush=True)
 record={'frozenAt':freeze['frozenAt'],'sourceManifestSha256':sha(r/'artifacts/rc16/frozen-source.json'),'sourceAtStart':before,'sourceAtFinish':hashes(),'sourceUnchanged':before==hashes(),'asarSha256':ash,'asarUnchanged':sha(archive)==ash,'startedAt':start,'completedAt':now(),'suites':rows};(out/'runs.json').write_text(json.dumps(record,indent=2))
assert all(x['exitCode']==0 for x in rows)
