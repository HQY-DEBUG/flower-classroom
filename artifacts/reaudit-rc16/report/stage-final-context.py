"""Prepare the final reader-facing context from the immutable selected release evidence."""
import argparse,copy,hashlib,json,re
from pathlib import Path
D=Path(__file__).resolve().parent;ROOT=D.parents[2]
read=lambda p:json.loads((ROOT/p).read_text())
sha=lambda p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--identity-confirmed',action='store_true');a=ap.parse_args()
    release=read('artifacts/rc17/final-test-manifest.json');closure=read('artifacts/rc17/reaudit-findings-closure.json');envelope=read('artifacts/rc17/reaudit-final-runs.json')
    assert release['version']==closure['version']==envelope['version']=='1.3.0-rc.17'
    assert release['releaseGate']['unresolvedDiscoveredDefects']==0 and release['releaseGate']['fullFinalSourceAndAsarRegression']
    asar_path='dist-rc17-final/win-unpacked/resources/app.asar';asar=sha(asar_path);assert asar==release['asarSha256']==closure['asarSha256']==envelope['asarSha256After']
    ctx=read('artifacts/reaudit-rc16/report/working-context.json')
    ctx.update(coordinatorFinalIdentityConfirmed=a.identity_confirmed,confirmedAsarSha256=asar,asarPath=asar_path)
    ctx['releaseGate']='本轮确认的三类缺陷已修复，并经独立复查及最终源码、精确RC17 ASAR重新验证。190项既有要求以本轮证据重算；9项Windows实机效果仍未验证。已完成范围内没有未关闭的已确认产品问题。'
    ctx['auditSummary']='从实际已交付RC16重新提取ASAR审查，确认抽取奖励身份、迁移快照一致性和恢复警告三类问题。修复后再次独立复查，再对最终冻结RC17运行标准回归、新边界及上一轮缺陷回归。原始失败与脚本修正保留，历史5204条通过断言不计本轮。'
    ctx['upgradeNote']='关闭全部旧版窗口，先复制整个RC16程序文件夹留作备份。把RC17解压到新的可写文件夹，勿以空白发行包覆盖旧资料。启动新版，在班级设置依次点击“查看文件夹与迁移旧版数据”→“从旧版数据文件夹迁移”，选择旧目录中的“数据”子目录，核对预览及关联资源后确认。显式迁移复制课堂资料、已保存头像及关联头像目录和计分卡片工作簿；核对名单、积分、宠物、历史和头像后重启。迁移不会自动复制旧根目录的配置.txt或整个备份文件夹。若修改过启动配置，完全关闭新版后另行复制旧配置.txt；旧备份留在原目录。完成核验后仍保留旧目录及整目录备份。'
    byid={f['id']:f for f in ctx['findings']};ctx['requirementOverrides']={}
    for closed in closure['findings']:
        f=byid[closed['id']];f.update(rootCause=closed['rootCause'],fix=closed['fix'],requirementIds=closed['requirementIds'])
        f['patternsByScope']={scope:['^'+re.escape(name)+'$'for name in closed['afterAssertions'][mode]]for scope,mode in [('source','source'),('package','packaged')]}
        for id in closed['requirementIds']:
            extra=ctx['requirementOverrides'].setdefault(id,{'additionalExactBindings':{'source':[],'package':[]}})['additionalExactBindings']
            for scope,mode in [('source','source'),('package','packaged')]:extra[scope]=list(dict.fromkeys(extra[scope]+closed['afterAssertions'][mode]))
    ctx['findings']=list(byid.values())
    texts={
      'migration':('迁移快照、确认与文件夹恢复','新快照交错、真实主进程确认/取消/重启、旧版日志搬移，以及上一轮目录准备和迁移中断回归分别执行。'),
      'rules':('计分卡事务及恢复提示','新事务模型和警告清理对照，以及上一轮启动、回执、外部修改和显式重建回归分别执行。'),
      'imports':('导入、头像及备份快照','新导入快照与并发修改场景按具名断言叶统计；另运行上一轮批量头像恢复竞态。场景摘要不与其断言重复计数。'),
      'classroom':('点名、宠物及跨窗口交互','旧请求、重复结果、丢失响应、草稿、共享身份模型与上一轮普通奖励矩阵分别执行；相同场景的重跑不扩大功能分母。'),
    }
    ctx['independentReviews']=[]
    for domain,(title,description)in texts.items():
        count=envelope['actualLeafCountsByDomain'][domain]
        proofs=[r['originalExecutionFile']for r in envelope['suites']if r['domain']==domain]
        ctx['independentReviews'].append({'id':'REVIEW-'+domain.upper(),'title':title,'actual':f'最终源码{count["source"]}条、精确ASAR {count["packaged"]}条具名检查全部通过。'+description,'evidence':'\n'.join(dict.fromkeys(proofs)),'limits':'仅合成资料。Node模块与Linux Electron检查按实际执行层解释；Windows、真实硬件及Excel/WPS原生行为未验证。'})
    ctx['qaNotes'].append({'id':'HARNESS-UI-RESET','title':'名单追加后的旧抽取按钮预期修正','actual':'未修改的RC16已在追加名单时重置宠物抽取。原测试错误要求旧结果按钮继续存在；修正后分别验证普通计分/归档保留同一事件状态，以及追加名单清空已重置结果、保留已获成长和历史。源运行初始失败和旧脚本保留，未新增产品缺陷。','evidence':'artifacts/rc17/harness-history/ui-reset-expectation/classification.json\nartifacts/rc17/harness-history/ui-reset-expectation/initial-results/results.json'})
    ctx['developmentRuns'].append({'id':'RC17-HARNESS-UI-RESET','title':'名单追加旧按钮预期的初始失败','file':'artifacts/rc17/harness-history/ui-reset-expectation/initial-results/results.json','scope':'RC17修正前测试脚本','version':'1.3.0-rc.17 冻结源码的初始脚本运行','frozenEvidence':False,'checkClassifications':{'Unrelated score, append import and log archive preserve recorded pet award status':'harness'}})
    roster_file='artifacts/rc17/harness-history/missing-roster-fixtures/initial-results/results.json'
    if (ROOT/roster_file).is_file():
        from prepare import flatten
        failed_names=[c['name']for c in flatten(read(roster_file))if c['status']=='failed']
        assert len(failed_names)==6,failed_names
        ctx['developmentRuns'].append({'id':'RC17-ENV-ROSTER-FIXTURES','title':'旧名单工作簿输入缺失的初始运行','file':roster_file,'scope':'RC17源码测试输入缺失','version':'1.3.0-rc.17 冻结源码初始运行','frozenEvidence':False,'checkClassifications':{name:'environment'for name in failed_names}})
        ctx['qaNotes'].append({'id':'ENV-ROSTER-FIXTURES','title':'六份历史名单测试输入缺失','actual':'新审查副本最初只复制了文本和脚本，遗漏六份原始合成XLSX，导致六条用例得到ENOENT而未检验预期行为。按SHA256恢复完全相同的原始输入后明确重跑；原始失败保留为测试环境问题，运行代码和测试断言未修改。','evidence':'artifacts/rc17/harness-history/missing-roster-fixtures/restoration.json\n'+roster_file})
    package_roster='artifacts/rc17/rc13-inherited-packaged/roster-exact/results.json'
    if (ROOT/package_roster).is_file():
        from prepare import flatten
        failed_names=[c['name']for c in flatten(read(package_roster))if c['status']=='failed']
        assert len(failed_names)==1,failed_names
        ctx['developmentRuns'].append({'id':'RC17-ENV-ROSTER-PACKAGED','title':'ASAR旧名单工作簿末项输入缺失的初始运行','file':package_roster,'scope':'RC17精确ASAR测试输入缺失','version':'1.3.0-rc.17 精确ASAR初始运行','frozenEvidence':False,'checkClassifications':{name:'environment'for name in failed_names}})
        ctx['qaNotes'].append({'id':'ENV-ROSTER-PACKAGED','title':'ASAR名单回归的一个输入尚未恢复','actual':'打包版首次名单专项早于最后一份openpyxl-formula.xlsx恢复完成，保留一条ENOENT失败。输入按原始SHA256恢复后，未修改测试脚本或ASAR，明确重跑11条全部通过。','evidence':package_roster+'\nartifacts/rc17/retest-selections.json'})
    ctx['qaNotes'].append({'id':'REPAIR-ITERATION-D01','title':'修改后复查发现并纠正渲染端共享签名遗漏','actual':'修复抽取身份后，独立源码复查发现普通点名渲染端仍生成旧签名。发布前补齐共享函数，并重新执行普通奖励与跨窗口原生检查。属于未发布中间修复的回归，未记为第四类RC16缺陷。','evidence':'artifacts/reaudit-rc16/classroom/candidate-renderer-integration-review.json'})
    ctx['qaNotes'].append({'id':'META-RC17-DRAW','title':'可选存档字段说明校正','actual':'RC17新增可选draw.eventId、drawSessions[*].eventId和petDraw.eventId。课堂存档格式保持版本2，单纯读取旧档不改变原档。已保留说明校正前的清单，修正元数据后重新校验版本绑定；运行代码、程序归档和执行结果未改变。','evidence':'artifacts/rc17/harness-history/persistence-metadata/correction.json'})
    for i,x in enumerate(envelope.get('selectionExclusions',[]),1):
        ctx['qaNotes'].append({'id':f'HARNESS-FINAL-{i}','title':'最终复验中保留的测试准备失败','actual':'初始准备阶段未产生产品断言：'+x['reason']+'。该记录不计最终通过，随后明确重试的完整结果单独选定。','evidence':x['file']})
    ctx['screenshots']=[{'file':'artifacts/rc17-independent-review/rules-final/packaged/warning-controls/recovered-screen.png','title':'事务恢复后的课堂界面','caption':'最终RC17 ASAR的合成课堂。成功核对并清理事务后，旧警告已消失，已保存的课堂积分仍在。截图已等待重绘并目视确认；状态及文件一致性由对应断言另外验证。','syntheticOnly':True}]
    ctx['evidenceFiles']=list(dict.fromkeys(ctx.get('evidenceFiles',[])+[
        'artifacts/rc17/reaudit-final-runs.json','artifacts/rc17/reaudit-findings-closure.json',
        'artifacts/reaudit-rc16/report/finalizer-gate-verification.json',
        'artifacts/reaudit-rc16/report/independent-inputs.json',
        'artifacts/reaudit-rc16/report/preceding-fix-required-assertions.json',
        'artifacts/rc17-independent-review/rules-final/review.json',
        'artifacts/rc17-independent-review/migration-final/final-audit.md',
        'artifacts/reaudit-rc16/classroom/candidate-renderer-integration-review.json',
        'artifacts/rc17/harness-history/ui-reset-expectation/classification.json']))
    ctx['evidenceFiles'].append('artifacts/rc17/harness-history/persistence-metadata/correction.json')
    for id,file,suite in [
        ('RC17-HARNESS-UI-RESET','artifacts/rc17/new-targeted-source/runs.json','ui'),
        ('RC17-ENV-ROSTER-FIXTURES','artifacts/rc17/rc13-inherited-source/runs.json','roster-exact'),
        ('RC17-ENV-ROSTER-PACKAGED','artifacts/rc17/rc13-inherited-packaged/runs.json','roster-exact'),
    ]:
        selected=next((r for r in ctx['developmentRuns']if r['id']==id),None)
        if selected:
            original=read(file);rows=original.get('suites',original.get('results',[]));matches=[(i,r)for i,r in enumerate(rows)if r.get('suite')==suite]
            assert len(matches)==1 and matches[0][1]['exitCode']!=0
            i,row=matches[0];selected.update(startedAt=row['startedAt'],completedAt=row.get('completedAt')or row['finishedAt'],bindingProof=file,originalExecutionLocator=f'suites[{i}]')
            ctx['evidenceFiles'].append(file)
    (D/'final-context.json').write_text(json.dumps(ctx,ensure_ascii=False,indent=2))
    print(json.dumps({'identityConfirmed':a.identity_confirmed,'findings':len(ctx['findings']),'independentReviews':len(ctx['independentReviews']),'output':str(D/'final-context.json')}))
if __name__=='__main__':main()
