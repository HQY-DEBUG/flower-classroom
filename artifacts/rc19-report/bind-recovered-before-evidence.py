"""Bind newly executed genuine before-code failures, not missing original logs."""
from pathlib import Path
import hashlib
import json
ROOT=Path(__file__).resolve().parents[2];OUT=Path(__file__).resolve().parent
def read(p):return json.loads(p.read_text())
def write(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def pointer(value,where):
    for part in where.split('/')[1:]:value=value[int(part)] if isinstance(value,list) else value[part]
    return value
def ref(file,where):return {'file':file,'sha256':sha(ROOT/file),'pointer':where,'equals':pointer(read(ROOT/file),where)}
badge_file='artifacts/rc19/recovered-review/BADGE-01-before-after.json';ui_file='artifacts/rc19/recovered-review/UI-before-checkpoint3/results.json';validation_file='artifacts/rc19/recovered-review/UI-before-validation.json'
badge=read(ROOT/badge_file);ui=read(ROOT/ui_file);validation=read(ROOT/validation_file)
assert badge['reexecutedAfterEnvironmentReset'] and badge['originalExecutionLogsAvailable'] is False and badge['syntheticOnly']
assert badge['before']['initial']['known'] is False and badge['before']['afterDraw']['known'] is True and badge['before']['redemptionSucceeded'] is True
assert validation['genuinePrerepairExecution'] and validation['originalExecutionLogsAvailable'] is False and validation['sourceUnchanged'] and validation['realMainPreloadRenderer'] and not validation['rendererErrors']
assert validation['runId']==ui['runId'] and ui['errors']==[]
draft=read(OUT/'independent-findings-draft.json');context=read(OUT/'final-context-draft.json')
for finding in draft['findings']:
    if finding['id']=='RC19-BADGE-01':
        finding['before']=[ref(badge_file,p) for p in ['/before/initial/known','/before/afterDraw/known','/before/redemptionSucceeded','/before/expectedInvariantAssertionFailure']]
        finding['beforeSummary']='恢复后于 '+badge['startedAt']+' 至 '+badge['completedAt']+'，用真实检查点2源码重新复现：仅一次宠物抽取便把未知余额变为已知5枚，并允许兑换。原始重置前日志仍丢失，此记录是有输入和源码哈希的新复现。'
        finding['reproductionStartedAt']=badge['startedAt'];finding['reproductionCompletedAt']=badge['completedAt']
    else:
        indices=[0,1,2] if finding['id']=='RC19-DRAW-02' else [4,6]
        assert all(ui['checks'][i]['status']=='failed' and ui['checks'][i].get('error') for i in indices)
        finding['before']=[ref(ui_file,'/checks/'+str(i)+'/error') for i in indices]
        issue='外部积分或全局规则改变后，已打开抽取结果保留旧等级/造型' if finding['id']=='RC19-DRAW-02' else '未领养详情的可见领养按钮真实点击后未打开选择器'
        finding['beforeSummary']='恢复后于 '+validation['startedAt']+' 至 '+validation['completedAt']+'，用真实检查点3源码在Electron main/preload/renderer中重新复现：'+issue+'。原始重置前ASAR日志仍丢失，此记录是有源码及检查点哈希的新源码复现。'
        finding['reproductionStartedAt']=validation['startedAt'];finding['reproductionCompletedAt']=validation['completedAt']
        finding['reproductionProvenance']=validation_file
    finding['beforeEvidenceStatus']='fresh-genuine-prerepair-reproduction-after-recovery'
    finding['status']='修前已重新复现，等待最终源码及ASAR复验'
    finding['limits']='原始重置前失败记录未恢复；本条修前证据为恢复后的真实旧代码新复现。最终通过只采用恢复后当前冻结源码与ASAR的明确选择。'
context['evidenceFiles']=list(dict.fromkeys(context['evidenceFiles']+[badge_file,ui_file,validation_file,'artifacts/rc19/recovered-review/UI-before-inputs.json','artifacts/rc19/recovered-review/UI-before-checkpoint3/runtime-binding.json']))
context['journeyBindings']['J19-11']['before']=next(f['beforeSummary'] for f in draft['findings'] if f['id']=='RC19-DRAW-02')
context['journeyBindings']['J19-09']['before']=next(f['beforeSummary'] for f in draft['findings'] if f['id']=='RC19-ADOPT-03')
context['journeyBindings']['J19-08']['before']='开发过程曾观察到已选性别保存后为空；原始失败文件未恢复。此事实仅作过程说明，当前保存、取消和重新打开路径须从恢复后最终运行重新验证。'
context['journeyBindings']['J19-10']['before']='原始开发失败记录未恢复。现已恢复可信RC18源码，可用它重新生成真实旧版配置和待处理收据作为合成输入，完整验证当前迁移与恢复流程。'
for rid,file,title in [('D19-RECOVERED-BADGE',badge_file,'恢复后新复现未知徽章余额错误'),('D19-RECOVERED-UI',ui_file,'恢复后新复现抽取同步和领养点击错误')]:
    context['developmentRuns']=[r for r in context['developmentRuns'] if r['id']!=rid]
    context['developmentRuns'].append({'id':rid,'file':file,'sha256':sha(ROOT/file),'title':title,'classification':'product','version':'真实修前检查点的恢复后新执行','scope':'修前诊断，不计RC19最终','outcome':'confirmed-defect','actual':'真实修前代码新复现；原始重置前运行记录仍记丢失。'})
write(OUT/'independent-findings-draft.json',draft);write(OUT/'final-context-draft.json',context)
print(json.dumps({'genuineNewBeforeReproductionsBound':3,'originalRawLogsRecovered':False,'finalPassesAssigned':0}))
