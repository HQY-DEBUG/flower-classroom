"""One-time adaptation of the retained report implementation for this fresh audit."""
from pathlib import Path
D = Path(__file__).resolve().parent

def patch(name, replacements):
    p = D / name
    text = p.read_text()
    for old, new in replacements:
        assert old in text, (name, old[:90])
        text = text.replace(old, new)
    p.write_text(text)

patch('prepare.py', [
    ("OLD=read(ROOT/'artifacts/rc14/report/report-input.json')", "OLD=read(D/'baseline-report-input.json')"),
    ("cfg=read(sys.argv[1])if len(sys.argv)>1 else dict(finalized=False,runs=[])", "cfg=read(sys.argv[1])if len(sys.argv)>1 else dict(finalized=False,runs=[])\n    version=cfg.get('version','1.3.0-rc.15')"),
    ('baselineSourceZipSha256','baselineArchiveSha256'),
    ("'待绑定RC14源码压缩包'", "'待绑定RC15交付7z'"),
    ("'RC14 source archive baseline hash required'", "'Delivered RC15 archive baseline hash required'"),
    ("'RC15开发过程'", "'本轮诊断过程'"),
    ("'version':'1.3.0-rc.15'if stage=='最终冻结'else'RC15开发候选，精确哈希见原始记录'", "'version':version if stage=='最终冻结'else spec.get('version','RC15交付版诊断，精确哈希见原始记录')"),
    ("historicalVersion='1.3.0-rc.14',version='1.3.0-rc.15'", "historicalVersion='1.3.0-rc.15',version=version"),
    ("r['fix']='RC14行为按本轮最终证据重新判定，历史通过不自动继承'", "r['fix']='RC15交付行为按本轮新执行证据重新判定，历史通过不自动继承'"),
    ("r['version']='1.3.0-rc.15';selected=[]", "r['version']=version;selected=[]"),
    ("'version':'1.3.0-rc.15','date'", "'version':version,'date'"),
    ("{'version':'1.3.0-rc.14','requirements':176,'passed':167,'unverified':9,'knownDefectGroups':4}", "{'version':'1.3.0-rc.15','requirements':190,'passed':181,'unverified':9,'knownDefectGroups':5}"),
    ("'artifacts/rc14/report/RC14-REPORT-MANIFEST.json','artifacts/rc14/report/report-input.json'", "'artifacts/rc15/report/RC15-REPORT-MANIFEST.json','artifacts/reaudit-rc15/report/baseline-report-input.json'"),
    ("r.setdefault('historicalStatus','RC15新要求')", "r.setdefault('historicalStatus','本轮新增要求')"),
    ("data['rc14AvatarIdentity']", "data['baselineAvatarIdentity']"),
])

patch('assemble.py', [
    ("default='artifacts/rc15/final-test-manifest.json'", "default='artifacts/reaudit-rc15/final-test-manifest.json'"),
    ("default='artifacts/rc15/frozen-source.json'", "default='artifacts/reaudit-rc15/frozen-source.json'"),
    ("default='artifacts/rc15/report/final-context.json'", "default='artifacts/reaudit-rc15/report/final-context.json'"),
    ("'bindingIndex':'artifacts/rc15/report/binding-index.json'", "'bindingIndex':'artifacts/reaudit-rc15/report/binding-index.json'"),
    ("'baselineSourceZipSha256':'d3269fabb33ffc2727c1835b46021143e45d870967a1eb8769caa7dcecb4064a'", "'baselineArchiveSha256':'45aa76715e4e85921aca2d52d920274d2884ca0e1077575b9f9b7d447c3c33cd'"),
])

patch('bindings.py', [
    ("freeze_time=datetime.datetime.fromisoformat(freeze['frozenAt'].replace('Z','+00:00'))", "freeze_time=datetime.datetime.fromisoformat(freeze['frozenAt'].replace('Z','+00:00'))\n    audit_time=datetime.datetime.fromisoformat(cfg['auditNotBefore'].replace('Z','+00:00'))"),
    ("dt>=freeze_time,(spec['id'],k,'before final freeze')", "dt>=max(freeze_time,audit_time),(spec['id'],k,'before current audit or final freeze')"),
    ("record=resolve(b['execution']);good(record)", "record=resolve(b['execution']);good(record)\n        assert record.get('startedAt') and (record.get('completedAt') or record.get('finishedAt')), ('current run requires original execution times',spec['id'])"),
])

patch('build-workbook.mjs', [
    ("const preview=process.argv.includes('--preview');", "const version=d.version,label=d.reportLabel,slug=d.reportSlug;\nconst preview=process.argv.includes('--preview');"),
    ("'RC14历史状态','RC14历史证据'", "'RC15历史状态','RC15历史证据'"),
    ("'RC15开发期间发现的问题及最终复验'", "'本轮新发现问题、原因与最终复验'"),
    ("'修复内容','最终源码'", "'原因与修复','最终源码'"),
    ("f.before,f.fix,f.sourceStatus", "f.before,[f.rootCause,f.fix].filter(Boolean).join('\\n'),f.sourceStatus"),
    ("else sheets['缺陷复验'].getRange('A6').values=[['待最终问题记录']];", "else sheets['缺陷复验'].getRange('A6').values=[['本轮未确认新的产品缺陷']];"),
    ("const processRows=[...(d.qaNotes||[])", "const processRows=[...(d.independentReviews||[]).map(r=>[r.id,'独立复核',r.title,[r.actual,r.limits].filter(Boolean).join('\\n'),r.evidence]),...(d.qaNotes||[])"),
    ("'190是176项历史要求及14项目录要求总数。", "'190是既有RC15全部要求总数。"),
    ("const ev=[['RC14基线','已验证交付源码ZIP SHA256',d.baselineSourceZipSha256,'作为本轮开发基线；不自动沿用测试通过'],['RC14基线','采用方式',d.baselineSourceProvenance||'核验后的本地RC14最终工作树复制到隔离目录；所列源码ZIP是恢复参考，本轮未重新解压。','本轮实际起点'],['RC15','版本',d.version,'报告目标']", "const ev=[['RC15已交付基线','原目录7z SHA256',d.baselineArchiveSha256,'本轮重新解压核验；不自动沿用历史通过'],['RC15已交付基线','原ASAR SHA256',d.baselineAsarSha256,'来自重新解压的已交付目录包'],['本轮复核','采用方式',d.baselineSourceProvenance,'本轮实际起点'],['当前版本','版本',d.version,'报告目标']"),
    ("['RC15','源码冻结UTC'", "['当前版本','源码冻结UTC'"),
    ("['RC15','源码集合SHA256'", "['当前版本','源码集合SHA256'"),
    ("['RC15','最终ASAR SHA256'", "['当前版本','最终ASAR SHA256'"),
    ("map(f=>['RC15',f.name", "map(f=>['当前版本',f.name"),
    ("'花伴课堂 RC15 全面测试结果'", "'花伴课堂 '+label"),
    ("'RC15本轮变化'", "'本轮复核'"),
    ("'仅完整目录版；解压已含120张头像、配置.txt、计分卡片.xlsx及数据/备份目录。正常启动、业务存档、Electron缓存均跟随实际EXE目录；配置可编辑；旧数据明确选择迁移；整目录搬移与双副本分别核验。'", "d.auditSummary"),
    ("'RC14报告历史176项为167通过、9未验证；此数只作历史追溯。RC15重新绑定当前证据，任何历史运行、开发轮或重复检查均不自动算本轮通过。'", "'已交付RC15历史报告为190项，其中181通过、9未验证。本轮重新执行并绑定当前证据，历史记录、修前诊断和重复检查不自动算本轮通过。'"),
    ("path.join(out,'花伴课堂_1.3.0-rc.15_全面测试表'+", "path.join(out,'花伴课堂_'+slug+'_全面测试表'+"),
])

patch('verify.py', [
    ("ROOT/'artifacts/rc14/report/report-input.json'", "D/'baseline-report-input.json'"),
    ("f'花伴课堂_1.3.0-rc.15_全面测试表{suffix}.xlsx',f'花伴课堂_1.3.0-rc.15_全面测试报告{suffix}.pdf'", "f'花伴课堂_{d[\"reportSlug\"]}_全面测试表{suffix}.xlsx',f'花伴课堂_{d[\"reportSlug\"]}_全面测试报告{suffix}.pdf'"),
    ('baselineSourceZipSha256','baselineArchiveSha256'),
    ("'RC15-REPORT-MANIFEST.json'", "'REAUDIT-REPORT-MANIFEST.json'"),
])

print('Fresh report scripts configured; no workbook or PDF exported.')
