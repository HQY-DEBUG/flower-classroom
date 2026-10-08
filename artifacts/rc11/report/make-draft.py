import json,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[3];directory=Path(__file__).resolve().parent
def defect(id,type,title,before,fix,evidence):return dict(id=id,type=type,title=title,before=before,fix=fix,retest='开发候选复验通过；等待最终冻结源码/ASAR绑定',status='待最终复验',evidence=evidence,version='RC11开发候选 → 最终RC11')
defects=[
defect('D001','产品缺陷','较早照片回复覆盖后选头像','学生编辑表先开始照片导入，再选择库图片，迟到照片回复覆盖较新选择。','为照片请求引入代次，较新头像选择取消早先意图。','artifacts/rc11/avatars-source-form-races/flows.json'),
defect('D002','产品缺陷','同照片备份恢复后旧草稿可保存','学生编辑草稿跨过相同照片的备份恢复，仍能提交并改变已恢复档案。','按恢复代次使学生表草稿失效，不能仅比较照片字段。','artifacts/rc11/avatars-source-form-restore/flows.json'),
defect('D003','可访问性缺陷','键盘选择后焦点丢失','键盘选头像后重新绘制选项，焦点未留在已选头像。','重新绘制后恢复选项焦点。','artifacts/rc11/avatars-source-selection-focus/flows.json'),
defect('D004','可访问性缺陷','头像库路径展开栏无法Tab到达','头像管理器搜索框按Tab跳过可展开的文件夹位置栏。','把summary纳入焦点约束范围。','artifacts/rc11/avatars-source-manager-keyboard/flows.json'),
defect('D005','界面生命周期缺陷','迟到导入预览重新打开','较新学生窗口打开再关闭后，旧导入预览迟到重新出现；重复导入可能显示旧回复。','共享预览序号和弹窗/导航代次；较新取消同样使旧意图失效。','artifacts/rc11/independent-review/findings-before.json'),
defect('D006','界面可用性缺陷','失效头像草稿出现可用选择','恢复使快速头像草稿失效后，迟到列表重画40个可选按钮。保存仍禁用，未发现数据写入。','无效会话绘制禁用选项，保留后台拒绝保护。','artifacts/rc11/independent-review/findings-before.json'),
defect('D007','提示缺陷','迟到列表清掉恢复说明','恢复后学生表头像库本应显示失效原因，却被迟到列表替换为“40 / 40 个头像”；按钮仍禁用。','集中处理状态文案，在加载、结果、搜索、刷新和错误中保留失效说明。','artifacts/rc11/independent-review/findings-before.json'),
defect('D008','打包兼容缺陷','ASAR内默认素材枚举失败','默认图在开发文件夹可读取，ASAR内opendir调用不兼容。','归档内使用受限readdir枚举，用户可编辑目录继续使用原文件边界检查。','artifacts/rc11/avatar-library/native-asar-results.json'),
defect('H001','仅测试脚本','首轮切板夹具引用不存在面板','初轮切板用例在执行前收到“找不到要切换的面板”。','纠正合成夹具面板ID后重新执行；不记产品缺陷。','artifacts/rc11/avatars-source-attempt1/flows.json'),
defect('H002','仅测试预期','旧UI断言未适应新蛋与异步头像','首轮回归沿用旧等级大小写、旧徽标/文案及同步头像加载预期。','按统一LV大小写、新蛋徽标、当前文案及文件夹头像异步加载更新测试预期；保留原失败行。','artifacts/rc11/source-first-pass/status.json'),
dict(id='P001',type='候选轮中止',title='初次冻结被最终提示修复替代',before='19:22冻结后发现失效说明被迟到列表清除，首轮完整源码执行停止，退出码130。',fix='完成提示修复后重新冻结并重跑完整源码及最终ASAR；旧轮不纳入最终统计。',retest='等待新冻结后运行清单',status='旧轮排除',evidence='artifacts/rc11/source-first-pass/status.json',version='已废弃19:22冻结 → 最终RC11')
]
(directory/'defects-draft.json').write_text(json.dumps(defects,ensure_ascii=False,indent=2))
specs=[('candidate-avatars','头像交互','artifacts/rc11/avatars-source/results.json'),('candidate-eggs','宠物蛋生命周期','artifacts/rc11/egg-lifecycle/results.json'),('candidate-import','名单头像导入','artifacts/rc11/avatar-import-source/results.json')]
cfg={'finalized':False,'source':{},'package':{},'runs':[dict(id=i,title=t,file=f,scope='开发候选')for i,t,f in specs],'defects':defects,'evidenceFiles':list(dict.fromkeys(x['evidence']for x in defects))}
(directory/'draft-config.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2))
