"""Adapt the existing report format to the delivered RC16 fresh re-audit."""
from pathlib import Path
import json, shutil

D=Path(__file__).resolve().parent
def replace(name, pairs):
    p=D/name; s=p.read_text()
    for old,new in pairs:
        assert old in s,(name,old)
        s=s.replace(old,new)
    p.write_text(s)

replace('prepare.py',[
    ('Build the RC15 report model','Build the new re-audit report model'),
    ("version=cfg.get('version','1.3.0-rc.15')","version=cfg.get('version','1.3.0-rc.16')"),
    ('Delivered RC15 archive baseline hash required','Delivered RC16 archive baseline hash required'),
    ("historicalVersion='1.3.0-rc.15'","historicalVersion='1.3.0-rc.16'"),
    ('RC15交付行为按本轮新执行证据重新判定','RC16交付行为按本轮新执行证据重新判定'),
    ('RC15交付版诊断','RC16交付版诊断'),
    ('RC15诊断观察','RC16诊断观察'),
    ('RC15过程问题原始失败','RC16本轮问题原始失败'),
    ('artifacts/reaudit-rc15/report/','artifacts/reaudit-rc16/report/'),
    ("'artifacts/rc15/report/RC15-REPORT-MANIFEST.json'","'artifacts/rc16-report/RC16-REPORT-MANIFEST.json'"),
    ('RC15最终发布门槛','本轮最终发布门槛'),
    ('待绑定RC15交付7z','待绑定RC16交付7z'),
    ("'historicalBaseline':{'version':'1.3.0-rc.15','requirements':190,'passed':181,'unverified':9,'knownDefectGroups':5}","'historicalBaseline':read(D/'baseline-delivery-identity.json')['historicalBaseline']"),
    ("stage='最终冻结'if spec.get('frozenEvidence')else'本轮诊断过程'","stage='最终冻结'if spec.get('frozenEvidence')else'测试环境或脚本问题'if spec.get('classification')in('harness','environment')else'本轮诊断过程'"),
])
replace('assemble.py',[
    ('artifacts/reaudit-rc15/','artifacts/reaudit-rc16/'),
    ("'45aa76715e4e85921aca2d52d920274d2884ca0e1077575b9f9b7d447c3c33cd'","'c3d3d381a8c30b4d22df9f8a764d40c593cdfae41eada963f55a20c79c456bd7'"),
    ("'dist-rc15-final/win-unpacked/resources/app.asar'","'dist-rc17-final/win-unpacked/resources/app.asar'"),
    ("'interactions':'跨功能交互'","'interactions':'跨功能交互','rules':'计分卡事务','imports':'导入与快照','classroom':'课堂交互'"),
])
replace('build-workbook.mjs',[
    ('RC15历史状态','RC16历史状态'),('RC15历史证据','RC16历史证据'),
    ('RC15已交付基线','RC16已交付基线'),
    ('190是既有RC15全部要求总数','190是已交付RC16全部要求总数'),
    ('RC15目录要求独立标记为用户本轮要求','RC15目录要求保留为此前用户新增要求'),
    ('已交付RC15历史报告为190项，其中181通过、9未验证。本轮重新执行并绑定当前证据，历史记录、修前诊断和重复检查不自动算本轮通过。',
     '已交付RC16有190项要求，181通过、9未验证；历史5,204条通过断言与8条观察合计5,212条，均不计本轮。修前诊断和最终复验分开。'),
    ('r.testTime,bounded(r.missingSummary?.replaceAll("\\n","; "),1400)]',
     'r.testTime,bounded(r.missingSummary?.replaceAll("\\n","; "),1400),r.implementationStatus||"待核验",bounded(r.implementationEvidence||r.implementation||"沿用RC16功能定义；效果状态单独判定") ]'),
    ("'测试时间UTC','仍缺少的证据'],req,[14,23,23,47,78,82,93,16,16,18,22,95,95,72,85,105,19,95,38,58,110]",
     "'测试时间UTC','仍缺少的证据','功能提供状态','实现依据'],req,[14,23,23,47,78,82,93,16,16,18,22,95,95,72,85,105,19,95,38,58,110,19,100]"),
    ("r.bindingProof||'诊断过程，不支持最终通过']);","r.bindingProof||'诊断过程，不支持最终通过',r.classification==='harness'?'测试脚本问题':r.classification==='environment'?'测试环境问题':'产品行为断言或明确观察']);"),
    ("'冻结绑定依据'],execution,[37,24,31,38,40,100,15,112,50,35,35,110,74,100]",
     "'冻结绑定依据','记录类别'],execution,[37,24,31,38,40,100,15,112,50,35,35,110,74,100,28]"),
])
replace('build-pdf.py',[
    ('Chinese PDF companion: scoped conclusions, RC15 details and every requirement ID.','Chinese PDF companion: current conclusions, historical RC16 and every stable requirement ID.'),
    ('190项均来自已交付RC15的既有要求','190项均来自已交付RC16的既有要求'),
    ('已交付RC15原件','已交付RC16原件'),
    ('旧版1508等历史总数不作为当前统计输入','RC16历史5,204条通过断言及8条观察不作为当前统计输入'),
    ("head('RC15历史结果')","head('RC16历史结果')"),
    ('已交付RC15报告为190项，其中181通过、9未验证，5类当时发现的问题已在历史版本复验。它们仅作历史追溯。',
     '已交付RC16报告为190项，其中181通过、9未验证，6类当时发现的问题已在历史版本复验。历史5,204条通过断言与8条观察只作追溯，不计本轮。'),
    ('最终哈希另保存在RC16-REPORT-MANIFEST.json','最终哈希另保存在随附的报告清单JSON'),
])

prev=D.parents[4]/'flower-rc16-work/FlowerClassroom-source/artifacts/reaudit-rc15/report'
if not (prev/'verify.py').is_file():prev=D.parents[2].parents[1]/'flower-rc16-work/FlowerClassroom-source/artifacts/reaudit-rc15/report'
shutil.copyfile(prev/'verify.py',D/'verify.py')
replace('verify.py',[
    ('45aa76715e4e85921aca2d52d920274d2884ca0e1077575b9f9b7d447c3c33cd','c3d3d381a8c30b4d22df9f8a764d40c593cdfae41eada963f55a20c79c456bd7'),
    ('193ae2b1be926229478b41dad5abf6222e6c7ca2df5e7d53e04b34aa85ee064a','3b5d3b873b2f645409f3e503f41407b20b99ff2972379c84e77906a738a43587'),
    ("D/'RC16-REPORT-MANIFEST.json',OUT/'RC16-REPORT-MANIFEST.json'","D/d.get('reportManifestName','RC16-NEXT-REAUDIT-REPORT-MANIFEST.json'),OUT/d.get('reportManifestName','RC16-NEXT-REAUDIT-REPORT-MANIFEST.json')"),
])
print('Current report builders adapted; no workbook or PDF exported yet.')
