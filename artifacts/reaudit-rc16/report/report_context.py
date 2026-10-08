"""Current RC16 fresh audit conventions; historical passes are never carried forward."""
ALIASES = {
    'Unrelated score, append import and log archive preserve recorded pet award status':
        'Unrelated score/archive preserve recorded status; roster append clears reset draw without losing history',
}
OVERRIDES = {}
QA_NOTES = [
    dict(id='QA-01',title='历史基线与本轮执行分开',actual='已交付RC16的190项要求、181通过、9未验证、5204条通过断言及8条观察仅作历史基线。本轮起点为2026-10-07 03:12 UTC，只有本轮新执行且绑定最终代码的证据支持当前结论。',evidence='artifacts/reaudit-rc16/report/baseline-delivery-identity.json'),
    dict(id='QA-02',title='稳定要求ID与来源',actual='保留190个要求ID、原片与补充教程的来源及时间点，后续新增要求保留原分组。新增边界场景是断言，不重复扩充功能分母。',evidence='artifacts/reaudit-rc16/report/baseline-report-input.json'),
    dict(id='QA-03',title='未验证范围',actual='9项Windows实机要求仍未验证。此前被平台停止的额外锁、权限与文件边界专项没有重试或绕路；普通I/O、合成写入失败及Linux UI结果不替代该专项。',evidence='artifacts/rc10/specialized-audit-status.json'),
    dict(id='QA-04',title='原始执行与版本绑定',actual='每条最终检查保留准确名称、原始结果位置、真实开始完成UTC与精确源码或ASAR身份。修前失败、脚本问题、环境故障、观察项与产品通过断言分开记录。',evidence='artifacts/reaudit-rc16/report/binding-index.json'),
]
