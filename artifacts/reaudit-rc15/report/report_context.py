"""Fresh October 7 re-audit report conventions. No historical passes are reused."""
ALIASES = {}
OVERRIDES = {}
QA_NOTES = [
    dict(id='QA-01', title='历史与本轮验证分开', actual='RC15历史报告的190项要求、181项通过和9项未验证只作基线。本轮从实际已交付7z重新提取ASAR，使用新运行记录重新计算结果；不把旧报告或旧日志算作本轮通过。', evidence='artifacts/reaudit-rc15/report/baseline-report-input.json'),
    dict(id='QA-02', title='需求来源原样保留', actual='保留190个稳定要求ID、原始109秒视频与补充教程的来源和时间点，并区分后续用户新增要求。新增边界组合记录为独立检查，不重复扩大功能分母。', evidence='artifacts/reaudit-rc15/report/baseline-report-input.json'),
    dict(id='QA-03', title='平台和专项限制保留', actual='9项Windows现场效果仍未验证。此前停止的额外锁、权限与文件边界专项没有重试或绕路。本轮普通I/O和UI测试只支持其明确场景，不能替代该专项。', evidence='artifacts/rc10/specialized-audit-status.json'),
    dict(id='QA-04', title='当前执行必须可追溯', actual='每个最终检查绑定原始结果文件、SHA256、实际开始和完成时间、源码前后身份或精确ASAR身份。只在本轮重新执行且对应最终版本的记录才支持当前结论。', evidence='artifacts/reaudit-rc15/report/binding-index.json'),
]
