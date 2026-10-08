"""Draft final report context. Identity/selection approval remains explicitly pending."""
from pathlib import Path
import json
OUT=Path(__file__).resolve().parent
read=lambda name:json.loads((OUT/name).read_text())
def main():
 d=read('development-context.json');bindings=read('requirement-bindings-draft.json')['requirementBindings']
 restore=next(f for f in read('findings-closure-draft.json')['findings'] if f['id']=='RC18-I03')['afterAssertions']['source']
 d.update(coordinatorFinalIdentityConfirmed=False,confirmedAsarSha256=None,requirementBindings=bindings,
  assertionAliases={'signed growth and zero round-trip distinctly from blank and upgrade only imported v1 panels as needed':{'name':'signed growth and zero round-trip distinctly from blank and upgrade every shared mirror','reason':'共享卡片要求对所有面板的同一规则镜像保持一致；保留有符号成长、显式零和空白区别，按共享内容升级对应JSON结构版本，不把宠物账本启用变成Excel参数。'},'Two copies preserve independent config and data roots':{'name':'Two copies preserve independent unified configuration and data roots','reason':'两份程序仍隔离数据和参数根目录；配置载体按用户要求从旧TXT改为统一工作簿，仍验证启动只读、缓存值和跨目录无写入。'},'Original countdown supports start pause resume skip and close without scores or writes':{'name':'Countdown supports pause resume skip and close while saving only its configured default','reason':'RC18新增未来工具默认持久化；倒计时启停和结束仍不改评分，提交时只保存选择的默认秒数。原无任何写入的预期被用户统一配置要求替代。'},'Legacy restore-preview returns exact validated state; revision metadata is opt-in':{'name':'Restore preview preserves exact validated state with required transaction metadata','reason':'统一原子还原必须绑定预览事务元数据；仍逐值保护原恢复payload，已保存继承QA合同修正，未增加案例数。'}},
  additionalRequirementAssertions={rid:{mode:restore for mode in ['source','package']} for rid in ['V013','R14-11']},
  requirementRepairs={'V013':'RC18-I03：备份还原将课堂JSON与整本配置同步提交；五文件链回滚、全状态回执和严格旧v1等价恢复均经最终两层重新验证。','R14-11':'EPERM、JSON保存与恢复链失败均保持已保存资料；新预览后显式重试。RC18-I03另覆盖.previous恢复点、同配置不同课堂状态及旧v1首次恢复中断。'},
  upgradeNote='先退出所有旧版窗口，完整保留并复制旧RC17文件夹。将RC18解压到新的空白可写目录。打开班级设置→查看文件夹与迁移旧版数据→从旧版数据文件夹迁移，选择旧版“数据”目录，核对来源、目标面板、人数、照片及资源后确认复制并重新启动；原课堂密码继续有效。重启后从同一文件夹菜单进入预览并刷新配置表→统一配置表→从配置表刷新，审阅共享卡片、各板累计进阶阈值、启动参数及旧配置来源，确认刷新整本配置。旧TXT、旧计分卡片工作簿和旧回执原字节保留；此后根配置.xlsx为唯一活跃参数表。启动尺寸、缩放及最小化参数需下次完全退出后重启才生效。核对学生、分数、成长、历史、照片、卡片并再启动一次；原文件夹与备份继续保留。',
  releaseGate='等待协调者确认全部选中批次、两班脱敏场景与最终身份；当前草案不构成发布通过。',
  evidenceFiles=['artifacts/rc18-report/completion-contract.json','artifacts/rc18-report/retired-candidates.json','artifacts/rc18/folder-ui-expectation-changes.json','artifacts/rc18/folder-ui-adapted-source/upgrade-click-path.json'])
 ui=json.loads((OUT.parents[1]/'artifacts/rc18/ui-final3-retry1-validation.json').read_text())
 d['screenshots']=ui['screenshots']
 d['evidenceFiles']+=['artifacts/rc18/ui-final3-retry1-validation.json',*[s['path'] for s in ui['screenshots']]]
 (OUT/'final-context-draft.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
 print('Draft context prepared; coordinatorFinalIdentityConfirmed=false')
if __name__=='__main__':main()
