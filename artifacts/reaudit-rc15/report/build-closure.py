"""Bind the six narrated defects to exact original failures and final assertions."""
import hashlib,json,re
from pathlib import Path
D=Path(__file__).resolve().parent;ROOT=D.parents[2]
AUDIT=ROOT.parents[1]/'flower-rc16-audit-work'/'FlowerClassroom-source'
def load(p):return json.loads(Path(p).read_text())
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def original(file):
    p=ROOT/file
    return p if p.is_file() else AUDIT/file
def ref(file,pointer,equals):
    p=original(file);value=load(p)
    for token in pointer.split('/')[1:]:value=value[int(token)]if isinstance(value,list)else value[token]
    assert value==equals,(file,pointer,value,equals)
    return dict(file=file,sha256=sha(p),pointer=pointer,equals=equals)
def names(file):
    d=load(ROOT/file);rows=d if isinstance(d,list)else d['checks']
    return [r['name']for r in rows]
rows=load(D/'findings-draft.json');byid={r['id']:r for r in rows}
work='artifacts/rc16-independent-review/workbook-final/source/'
start=names(work+'startup/assertions.json');receipt=names(work+'receipt-lifecycle/assertions.json');rebuild=names(work+'explicit-rebuild-ui/assertions.json')
migration=list((ROOT/'artifacts/rc16-independent-review/migration-final').glob('frozen-*/source/migration-combinations/results.json'))
assert len(migration)==1,'Select the one coordinated final migration run explicitly if several exist'
combinations=names(migration[0].relative_to(ROOT))
supplement=names(migration[0].parent.parent/'migration-setup-and-legacy-compatibility/results.json')
final_names={
 'RC16-D01':[n for n in start if n.startswith(('Startup oversize:','Startup read-failed:','Startup directory:'))]+[n for n in rebuild if n.startswith('Rebuild oversize:')],
 'RC16-D02':[n for n in receipt if n.startswith(('Receipt rename','Receipt restore'))]+[n for n in rebuild if n.startswith(('Rebuild old-rename:','Rebuild old-restore:','Rebuild malformed-receipt:'))],
 'RC16-D03':[n for n in combinations if n.startswith('ordinary journal write')]+[n for n in supplement if n.startswith('ordinary setup')or n.startswith('actual malformed RC15 journal')],
 'RC16-D04':[n for n in combinations if 'interrupted complete-folder'in n]+[n for n in supplement if n.startswith('actual preserved RC15')],
 'RC16-D05':['Restore while batch '+part+' is pending cancels stale photo commit'for part in['queued','chooser','scan']],
 'RC16-D06':['single reward queued before reset','single reward queued before overlapping-new-draw','batch reward queued before overlapping-new-draw','uniform reward queued before reset','uniform reward queued before overlapping-new-draw'],
}
before={
 'RC16-D01':[ref('artifacts/reaudit-rc15/workbook/boot-results.json',f'/results/{i}/exitCode',1)for i in[2,3,4]],
 'RC16-D02':[ref('artifacts/reaudit-rc15/workbook/receipt-integration-results.json',f'/results/{i}/exitCode',1)for i in[3,5]],
 'RC16-D03':[ref('artifacts/reaudit-rc15/migration/validated-baseline/results.json','/checks/17/status','failed')],
 'RC16-D04':[ref('artifacts/reaudit-rc15/migration/validated-baseline/results.json',f'/checks/{i}/status','failed')for i in[10,11,14,15]],
}
for id,file in [('RC16-D05','artifacts/reaudit-rc15/avatars/batch-boundaries-baseline/results.json'),('RC16-D06','artifacts/reaudit-rc15/interactions/draw-matrix-rc15/audit-results.json')]:
    raw=load(original(file));before[id]=[ref(file,f'/checks/{i}/status','failed')for i,c in enumerate(raw['checks'])if c.get('status')=='failed']
    assert before[id]
byid['RC16-D01']['fix']='将外部工作簿的普通启动/读取异常隔离为持续可见提示；有效课堂和已保存规则继续使用，原表与事务记录保留。规则管理提供核对和显式重建。超大原表仍需先由用户修复，程序不静默覆盖；无效配置继续按原要求拒绝启动。'
byid['RC16-D02']['fix']='后续改名或恢复改变规则签名前先处理已完成规则事务。对RC15已遗留的歧义回执，课堂可打开并正常计分，规则修改受保护；用户明确确认重建后，旧表和回执分别完整备份，再由当前JSON重建Excel并清除提示。'
byid['RC16-D03']['fix']+=' 独立二次复核又发现准备数据/previous目录时发生EIO或ENOSPC会使同一token无法重试，已补足该错误路径的清理与重试；最终使用同一边界场景重新验证。'
byid['RC16-D03']['repairIterationNote']='首轮日志原子发布修复后，独立二次复核在prepare-data-directory与prepare-previous-directory注入普通错误，发现同token重试仍失败。此为D03修复遗漏，明确保留两条失败记录；后续修复后重跑。'
byid['RC16-D06']['fix']='学生点名的单行、批量、统一奖励均附带原点名快照，由主进程既有校验拒绝失效结果。普通手工加分保持独立；先完成提交的奖励仍按回执在迟回或丢失响应后确认一次。'
closure=[]
for row in rows:
    required=final_names[row['id']];assert required
    row['patterns']=[re.escape(n)+'$'for n in required]
    row['patternsByScope']={s:[r'^'+re.escape(n)+'$'for n in required]for s in['source','package']}
    entry={k:row[k]for k in['id','title','rootCause','fix','limits','requirementIds']}
    entry.update(before=before[row['id']],afterAssertions={s:required for s in['source','packaged']})
    if row['id']=='RC16-D03':
        entry['repairIterations']=[ref('artifacts/rc16-independent-review/migration-supplement/results.json',f'/checks/{i}/status','failed')for i in[7,8]]
        entry['existingMalformedJournalRetained']=True
        row['beforeEvidence']+='\nartifacts/rc16-independent-review/migration-supplement/results.json'
    closure.append(entry)
cfg=dict(schemaVersion=1,version='1.3.0-rc.16',asarSha256=sha(ROOT/'dist-rc16-final/win-unpacked/resources/app.asar'),sourceManifestSha256=sha(ROOT/'artifacts/rc16/frozen-source.json'),findings=closure)
(ROOT/'artifacts/rc16/reaudit-findings-closure.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2))
(D/'findings-draft.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
print(json.dumps({'findings':len(closure),'assertions':{r['id']:len(r['afterAssertions']['source'])for r in closure},'readyToValidateAgainstSelectedRuns':True}))
