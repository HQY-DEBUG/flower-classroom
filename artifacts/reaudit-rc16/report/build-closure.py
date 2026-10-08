"""Bind the three confirmed findings to unchanged before evidence and final named checks."""
import argparse,datetime,hashlib,json
from pathlib import Path
D=Path(__file__).resolve().parent;ROOT=D.parents[2]
load=lambda p:json.loads((ROOT/p).read_text())
sha=lambda p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
def reference(file,pointer):
    value=load(file)
    for token in pointer.split('/')[1:]:
        token=token.replace('~1','/').replace('~0','~');value=value[int(token)]if isinstance(value,list)else value[token]
    return {'file':file,'sha256':sha(file),'pointer':pointer,'equals':value}
def failures(file,exclude=()):
    data=load(file)
    return [reference(file,f'/checks/{i}/status')for i,c in enumerate(data['checks'])if c['status']=='failed'and c['name']not in exclude]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--envelope',default='artifacts/rc17/reaudit-final-runs.json');ap.add_argument('--output',default='artifacts/rc17/reaudit-findings-closure.json');a=ap.parse_args()
    envelope=load(a.envelope);assert envelope.get('partial')is not True and envelope['version']=='1.3.0-rc.17'
    freeze=load('artifacts/rc17/frozen-source.json');asar=sha('dist-rc17-final/win-unpacked/resources/app.asar');assert asar==envelope['asarSha256Before']==envelope['asarSha256After']
    assert sha('artifacts/rc17/frozen-source.json')==envelope['sourceManifestSha256']
    def after(domain,needle):
        out={}
        for mode in ('source','packaged'):
            selected=[r for r in envelope['suites']if r['domain']==domain and r['mode']==mode]
            names=list(dict.fromkeys(n for r in selected for n in r['actualAssertionNames']if needle(n)))
            assert names,(domain,mode,'missing final exact assertions');out[mode]=names
        assert set(out['source'])==set(out['packaged']),(domain,'source and ASAR closure assertions differ')
        return out
    classroom_after=after('classroom',lambda n:any(s in n for s in ('pet reward queued before','repeat reset-redraw-identical','repeat repeat-identical','cycle reset-redraw-identical','cycle repeat-identical','identical remote redraw offers a fresh reward','Fresh ordinary draw UI awards once')))
    for mode,names in classroom_after.items():assert len(names)>=19,(mode,'D01 closure misses tested stale-reward combinations')
    migration_after=after('migration',lambda n:any(s in n for s in ('source changes between classroom validation','snapshot','Snapshot','preview','Preview','workbook','Workbook','fallback','Fallback'))and'ordinary journal'not in n)
    rule_after=after('rules',lambda n:any(s in n for s in ('startup cleanup warning','successful reconciliation clears','Genuine unresolved startup workbook error','Unreadable current workbook','reconciled classroom and keeps the banner cleared')))
    for mode,names in rule_after.items():assert any('successful reconciliation clears' in n for n in names),mode
    before1=[]
    for file in ('artifacts/reaudit-rc16/classroom/pet-draw-strict-boundaries/audit-results.json','artifacts/reaudit-rc16/classroom/draw-identical-ui/audit-results.json'):
        before1.extend(failures(file))
    before1.extend(failures('artifacts/reaudit-rc16/classroom/draw-aba-boundaries/audit-results.json',exclude=('Pet students identical remote redraw offers a fresh reward after reopening','Pet groups identical remote redraw offers a fresh reward after reopening')))
    rows=[
      {'id':'RC17-D01','title':'抽取重置、替换或出现相同结果后，旧奖励与新一轮入口不一致','requirementIds':['V047','R008','V073'],
       'rootCause':'普通点名的旧签名可能在重新抽到相同结果时重复；宠物奖励没有在主进程校验当前抽取身份，界面也可能把新一轮相同名单误作已奖励的旧一轮。',
       'fix':'每次抽取、重置及相关分组变化更新抽取身份；普通点名与宠物共用包含身份的签名，主进程拒绝旧奖励，界面按新身份恢复可奖励状态。已提交但丢失响应的请求仍只记一次。普通点名渲染端遗漏共享签名的中间回归已修正并重新审查。',
       'before':before1,'repairIterations':[reference('artifacts/reaudit-rc16/classroom/candidate-renderer-integration-review.json','/observation'),reference('artifacts/reaudit-rc16/classroom/candidate-renderer-integration-review.json','/validation')],
       'afterAssertions':classroom_after,'limits':'相同场景在不同矩阵中重复执行，原始检查数不等于独立功能或缺陷数量；Windows未验证。'},
      {'id':'RC17-D02','title':'旧程序保存期间，迁移预览、课堂和工作簿可能取自不同快照','requirementIds':['R15-14'],
       'rootCause':'原版先解析课堂、再读取来源清单；旧程序的并发保存可让预览或生成工作簿依据旧课堂，而复制文件依据新课堂。',
       'fix':'先建立来源清单，解析课堂及相关元数据时核对同一清单的字节长度和SHA256，并在预览完成前复核清单。来源变化安全拒绝，重新预览后按一致快照迁移，确认、取消和重启继续保持数据与工作簿一致。',
       'before':[reference('artifacts/reaudit-rc16/migration/interactions/results.json','/checks/0/status'),reference('artifacts/reaudit-rc16/migration/preview-main/preview-result.json','/checks/0/previewPanels'),reference('artifacts/reaudit-rc16/migration/preview-main/preview-result.json','/checks/0/copiedPanels'),reference('artifacts/reaudit-rc16/migration/preview-main/restart-result.json','/checks/0/status')],
       'afterAssertions':migration_after,'limits':'显式迁移复制课堂、关联头像和工作簿，不复制旧根配置.txt或整个备份目录；旧目录保留。Windows和物理断电未验证。'},
      {'id':'RC17-D03','title':'事务记录已成功清理，启动时缓存的警告仍显示','requirementIds':['R14-11'],'severity':'low',
       'rootCause':'后续成功恢复虽已删除事务记录，但启动阶段缓存的清理警告没有清空，界面继续显示过期提示。',
       'fix':'成功重新核对并清理事务后同步清除旧警告；仍未解决的启动错误和不可读工作簿继续显示并阻止危险规则写入。普通计分、恢复、刷新和重启均复验。',
       'before':[reference('artifacts/reaudit-rc16/rules/native-results.json','/runs/2/report/checks/0/status')],
       'afterAssertions':rule_after,'limits':'低严重度状态提示问题；原版未发现由此导致的数据改写或丢失。未执行Windows Excel/WPS实机占用验证。'},
    ]
    out=ROOT/a.output;assert not out.exists(),'Refuse to overwrite finalized finding closure'
    result={'schemaVersion':1,'version':'1.3.0-rc.17','createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'frozenAt':freeze['frozenAt'],'sourceManifestSha256':sha('artifacts/rc17/frozen-source.json'),'asarSha256':asar,'independentEnvelope':a.envelope,'independentEnvelopeSha256':sha(a.envelope),'findings':rows,'windowsExecuted':False,'syntheticOnly':True}
    out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'findings':len(rows),'afterNames':{r['id']:{mode:len(names)for mode,names in r['afterAssertions'].items()}for r in rows},'output':a.output},ensure_ascii=False))
if __name__=='__main__':main()
