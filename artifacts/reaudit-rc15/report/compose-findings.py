"""Create issue narratives from independent delivered-RC15 reports; retests bind later."""
import json
from pathlib import Path
D=Path(__file__).resolve().parent
draw=json.loads((D/'findings-draft.json').read_text())[0]
draw['id']='RC16-D06'
def issue(id,module,title,ids,expected,steps,before,cause,fix,evidence,limits):
    return dict(id=id,module=module,title=title,requirementIds=ids,expected=expected,steps=steps,before=before,rootCause=cause,fix=fix,requiredScopes=['source','package'],patterns=['FINAL_ASSERTIONS_PENDING_'+id],beforeEvidence=evidence,limits=limits)
rows=[
issue('RC16-D01','计分卡启动与课堂可用性','计分卡读取异常导致整个课堂无法打开',['R14-10','R14-11','R15-13'],
 '有效课堂JSON和已保存规则应仍可使用；可选外部工作簿出现读取异常时保留原文件，明确提示问题及恢复办法，不应把可选文件失败变成整堂课无法启动。',
 '准备有效课堂及配置；分别将工作簿置为5 MiB加1字节、对读取注入普通EIO、将同名路径变成目录，然后启动精确ASAR。对照合法、缺失、初始模板和小于上限的损坏工作簿。',
 'RC15在三个异常场景均以退出码1结束，未创建窗口；课堂JSON、配置和问题工作簿保持原字节。属于可用性缺陷，没有观察到数据丢失。合法、缺失、初始及小型损坏工作簿对照能够打开课堂。',
 '主进程启动直接等待scoreWorkbook.bootstrap；对超限、非文件或读取失败抛出的异常没有隔离，直接触发全局启动失败退出。',
 '源码修复已实施；等待最终源码和ASAR验证后填入具体恢复行为。',
 'artifacts/reaudit-rc15/workbook/REPORT.md\nartifacts/reaudit-rc15/workbook/boot-results.json',
 '只覆盖普通合成I/O错误。无效配置及程序根目录无法正常使用的启动拒绝仍按原需求验证；未验证Windows文件占用。'),
issue('RC16-D02','规则事务与重启','规则保存后残留回执遇到改名或恢复备份会阻止重启',['R14-07','R14-09','R14-11'],
 '已成功写入的规则事务清理回执失败后，后续班级改名或备份恢复仍应保持一致并能重启；不能回退已明确保存的新课堂，也不能静默覆盖外部Excel。',
 '只在删除已完成事务回执时注入一次EBUSY；确认规则保存成功。解除错误后分别改名、恢复含不同规则的合法备份，再以同一ASAR新进程启动；无后续修改作为对照。',
 '改名和恢复均返回成功且JSON已保存，但重启时RC15在窗口出现前退出1，保留JSON和旧回执。无后续修改的对照能够在重启清理回执。模块诊断中成功复现坏行为的“通过”不代表产品恢复通过。',
 '规则签名含面板名称和规则。已完成回执只接受事务前/后指纹；普通commit允许之后的改名或恢复改变指纹，且没有先处理已完成事务，导致重启无法识别当前合法状态。',
 '源码修复已实施；等待最终独立复验确认回执处理、故障保留和后续操作行为。',
 'artifacts/reaudit-rc15/workbook/REPORT.md\nartifacts/reaudit-rc15/workbook/receipt-integration-results.json\nartifacts/reaudit-rc15/workbook/module-results.json',
 '使用真实打包预加载/IPC、本地保存和新进程重启；EBUSY为合成故障，不等于真实Excel/WPS占用。'),
issue('RC16-D03','迁移日志原子性','写入迁移日志中断会遗留损坏日志并阻止启动',['R15-14'],
 '目标课堂尚未变化时，普通日志写入或空间错误应保留原课堂且可重试。正式日志应在完整写入并同步后一次性发布。',
 '在写入迁移日志前缀后注入普通EIO，使目标文件变更循环尚未开始；检查课堂和来源字节，随后真实重启。最终还需覆盖ENOSPC、发布失败及重试。',
 'RC15在正式日志路径留下不完整JSON；下一次启动报INVALID_JSON并退出1，尽管目标课堂和来源均未变化。',
 'writeDurable以wx直接写最终日志；错误分支清理暂存回执却没有移除未写完的正式日志。',
 '日志改为临时文件写入、同步、关闭后原子发布；正式日志未发布前的EIO/ENOSPC不留下损坏恢复记录，并保留重试。已存在的损坏RC15日志保留原字节，明确提示人工恢复，不能安全推断缺失内容。',
 'artifacts/reaudit-rc15/migration/REPORT.md\nartifacts/reaudit-rc15/migration/validated-baseline/results.json\nartifacts/reaudit-rc15/migration/validated-baseline/full-startup-results.json',
 '修复避免新产生该损坏，不宣称自动修好已损坏的RC15日志。对本次已确认目标未变的旧故障，应保留故障文件夹，使用新的RC16文件夹明确迁移未改动的原始来源。未模拟突然断电。'),
issue('RC16-D04','迁移中断与整目录搬移','迁移中断后完整搬移或复制目录仍无法恢复',['R15-07','R15-08','R15-14'],
 '完整文件夹携带数据、备份、日志和阶段文件搬移或复制后，应依据当前文件夹中的匹配迁移记录恢复；未提交事务回滚、已提交事务清理均不依赖旧路径。',
 '在持久回执安装前和安装后、清理前分别真实结束进程；完整复制或搬移目录，并从新路径恢复及重启；同路径恢复作为对照，核对原来源与副本隔离。',
 'RC15四种组合均报RECOVERY_REQUIRED；同一快照在原路径可恢复。三种代表性失败目录由真正打包主进程启动，均在显示课堂前退出1。',
 '日志record.stage保存绝对路径，并要求与当前备份路径完全相等；搬移后未使用迁移token在当前目录重新确定有效stage。',
 '恢复按迁移token使用当前备份目录内匹配stage，兼容有效的RC15旧绝对路径日志；搬移后分别正确回滚或完成提交清理。',
 'artifacts/reaudit-rc15/migration/REPORT.md\nartifacts/reaudit-rc15/migration/validated-baseline/results.json\nartifacts/reaudit-rc15/migration/validated-baseline/full-startup-results.json',
 '四个失败属于一个目录恢复缺陷。仅完整、有效旧日志支持迁移恢复；缺失或损坏记录保留并提示。真实Windows和突然断电仍未验证。'),
issue('RC16-D05','批量照片与备份恢复','恢复备份后迟到的批量照片导入覆盖已恢复头像',['V023','V024','N018','R14-18'],
 '恢复备份应使此前排队、选文件或扫描中的批量照片操作失效，即使面板、学生ID、姓名和旧照片相同；已恢复内存和磁盘应保持原样。',
 '从真实batch-photos菜单发起导入；分别在命令排队、选图器等待、图片扫描期间，用另一实际窗口恢复相同ID的备份；随后完成旧回调并核对照片、revision和磁盘。',
 'RC15三种恢复竞态均把新照片写入已恢复课堂，revision分别从4到5、7到8、10到11；磁盘与误更新一致。集中基线另外7项正向和原子性控制通过，广泛流程另行复现同一缺陷。',
 '已有检查比较面板、学生ID、姓名和照片，但没有比较备份恢复代次；相同ID恢复不能阻止旧批量操作继续提交。',
 '在选图前记录恢复代次，并在排队命令、选图返回、扫描完成和提交时验证；恢复发生后旧批量导入失效，同时保留原有名单/面板并发检查。',
 'artifacts/reaudit-rc15/avatars/INDEPENDENT-AUDIT.md\nartifacts/reaudit-rc15/avatars/batch-boundaries-baseline/results.json\nartifacts/reaudit-rc15/avatars/verified-baseline/batch-restore-evidence.json',
 '仅合成照片与课堂，真实Linux Electron主进程、预加载和界面；选择器回答及I/O延迟由测试控制。三种边界计作同一产品缺陷，未验证Windows原生选择器。'),
draw]
(D/'findings-draft.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
ctx=json.loads((D/'working-context.json').read_text())
ctx.update(version='1.3.0-rc.16',reportLabel='RC16修复版全面复核',reportSlug='1.3.0-rc.16_20261007',auditSummary='从实际已交付RC15重新解压并独立复核，确认六类产品缺陷；RC16分别修复工作簿启动与回执、迁移日志与目录恢复、批量照片恢复竞态以及过期点名奖励。最终结论仅使用修复后重新执行并绑定最终版本的证据。')
(D/'working-context.json').write_text(json.dumps(ctx,ensure_ascii=False,indent=2))
print('Prepared six findings; final retest bindings remain pending.')
