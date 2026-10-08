"""Prepare a fresh report workspace without promoting any historical outcomes."""
import copy, datetime, hashlib, json, shutil
from pathlib import Path

D = Path(__file__).resolve().parent
ROOT = D.parents[2]
PREV = ROOT.parents[1] / 'flower-rc16-work/FlowerClassroom-source/artifacts/reaudit-rc15/report'
read = lambda p: json.loads(p.read_text())
write = lambda p, value: p.write_text(json.dumps(value, ensure_ascii=False, indent=2))
old = read(PREV / 'report-input.json')
assert len(old['requirements']) == len({r['id'] for r in old['requirements']}) == 190
assert old['requirementCounts'] == {'通过': 181, '未验证': 9}
shutil.copyfile(PREV / 'report-input.json', D / 'baseline-report-input.json')
historical = {
    'version': '1.3.0-rc.16', 'requirements': 190, 'passed': 181, 'unverified': 9,
    'finalAssertionPasses': 5204, 'finalObservations': 8, 'finalExecutionRecords': 5212,
    'knownDefectGroups': len(old['findings']),
    'reportInputSha256': hashlib.sha256((D/'baseline-report-input.json').read_bytes()).hexdigest(),
    'scope': '历史基线；没有一条历史记录计入本轮执行结果',
}
identity = {
    'version': '1.3.0-rc.16',
    'archiveSha256': 'c3d3d381a8c30b4d22df9f8a764d40c593cdfae41eada963f55a20c79c456bd7',
    'asarSha256': '3b5d3b873b2f645409f3e503f41407b20b99ff2972379c84e77906a738a43587',
    'sourceTreeSha256': old['source']['sha256'],
    'auditNotBefore': '2026-10-07T03:12:00Z',
    'historicalBaseline': historical,
}
write(D/'baseline-delivery-identity.json', identity)
all_checks = {(run['file'], c['locator']): c['name'] for run in old['runs']
              if run['stage'] == '最终冻结' for c in run['checks']}
rows = []
for r in old['requirements']:
    expected = {}
    for scope in ('source', 'package'):
        names=[]; filename=None
        for line in r.get(scope+'Evidence','').splitlines():
            if line.startswith('artifacts/'): filename=line.strip(); continue
            for loc in line.split(', '):
                if (filename,loc) in all_checks: names.append(all_checks[(filename,loc)])
        expected[scope]=list(dict.fromkeys(names))
    rows.append({
        'id': r['id'], 'title': r['title'], 'baselineKind': r['baselineKind'],
        'module': r.get('module',r.get('category','')), 'expected': r.get('expected',''),
        'steps': r.get('steps',''), 'sourceKind': r.get('sourceKind',''),
        'implementationStatus': r.get('implementationStatus','待检查'),
        'implementationBasis': '沿用已交付RC16功能定义；本轮效果须由新证据另行判定',
        'historicalStatus': r['status'], 'historicalVersion':'1.3.0-rc.16',
        'requiredScopes':r.get('requiredScopes',['source','package']),
        'expectedExactAssertions':expected,
        'sourceStatus':'未验证', 'packageStatus':'未验证', 'status':'未验证',
        'currentEvidence':[], 'currentExecutionCount':0,
        'platformUnverified':r['id'] in {w['id'] for w in old['windows']},
        'limits':r.get('limits',''),
    })
draft={
    'schemaVersion':1,'draft':True,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'baseline':identity,'currentAssertions':0,'requirements':rows,
    'releaseRule':'没有确认缺陷则维持RC16；只有确认产品缺陷才发布RC17，并等待最终冻结回归及独立复核',
    'auditScopes':[
        {'id':'rules','title':'计分卡事务、回执及外部工作簿编辑','status':'等待新证据'},
        {'id':'migration','title':'迁移预览、同时确认、文件夹副本及重启','status':'等待新证据'},
        {'id':'imports','title':'导入快照、头像及资料交互','status':'等待新证据'},
        {'id':'classroom','title':'课堂计分、宠物抽取及跨窗口事务','status':'等待新证据'},
    ],
    'unverified':{'windowsIds':[w['id']for w in old['windows']],
        'stoppedSecurityAudit':'此前被平台停止的额外锁、权限及文件边界专项仍未验证；没有重试或绕路'},
    'upgradeNote':'显式迁移复制课堂资料、相关头像和计分卡工作簿；不会自动复制旧根目录配置.txt或整个备份文件夹。旧目录保留。',
}
write(D/'coverage-matrix-draft.json',draft)
for name in ('prepare.py','bindings.py','assemble.py','build-workbook.mjs','build-pdf.py','new_requirements.py'):
    shutil.copyfile(PREV/name,D/name)
print(json.dumps({'requirements':len(rows),'currentAssertions':0,'historical':historical,'output':str(D/'coverage-matrix-draft.json')},ensure_ascii=False))
