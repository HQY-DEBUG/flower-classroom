"""RC15 requirements supersede only the explicitly changed directory behavior."""
ALIASES={}
OVERRIDES={
 'N012':dict(title='解压已有120张头像并保留原40张',expected='最终目录包在首次运行前已含120张默认原创PNG，原40张字节保留。明确打开图库才扫描和选择；源码开发夹具可按需准备。',steps='重新解压最终目录包，启动前统计120张并比对哈希；显式打开图库后核对数量、选择和图片读取。',patterns=['fresh extraction resources contain all originals, real editable defaults and empty data/backup folders before launch','a staged fresh folder already has 120 original images and preserves deletion before first launch']),
 'N020':dict(expected='当前目录版使用EXE同级头像目录。增删和无效图片通过显式刷新反映；已选头像保存独立快照。旧AppData不自动扫描，旧资料只能明确迁移。',patterns=['Open folder targets the one explicit editable folder; add, remove and invalid-image refresh update choices only','Explicit refresh sees add/remove files while the selected snapshot','AppData avatars and absolute old-location indexes are never discovered or migrated automatically']),
 'R14-06':dict(expected='解压已含EXE同级计分卡片.xlsx。界面展示实际路径并提供打开入口；未修改初始模板在首次启动绑定当前课堂ID，已修改表不静默读取或导入。打开外部表本身不改变规则。',patterns=['existing workbook startup never loads Excel or trusts its bytes before explicit validation','blank first launch binds random panel IDs and durably saves once; restart preserves all bytes','Manager open failure is visible; opening a workbook never imports it']),
 'R14-13':dict(title='实际EXE同级资源与无备用目录',expected='正式目录版一律使用实际EXE父目录，不依赖cwd、便携外层变量或AppData。不可写时在原位置报错并停止，不暗移数据。',steps='设置实际EXE路径和干扰环境变量，切换cwd；检查模型和Electron实际路径；注入不可写并核对零备用目录。',patterns=['normal Windows folder launch follows actual EXE, ignoring cwd, AppData, launcher and test paths','Root resolution remains identical after changing working directory','unwritable EXE location reports a writable-folder remedy without touching AppData']),
 'R14-15':dict(expected='最终目录包在首次运行前已有120张默认素材。RC13原40张及RC14全部120张字节保留，最终包清单和实际图片解码一致。',steps='比较历史与最终素材SHA256；统计包内和解压后的120张图片；在图库实际读取解码。',patterns=['fresh extraction resources contain all originals, real editable defaults and empty data/backup folders before launch','a staged fresh folder already has 120 original images and preserves deletion before first launch']),
 'R14-16':dict(title='头像旧数据须明确迁移并保留自选删除',expected='停止RC14的自动AppData/旧目录发现。明确旧目录迁移保留有效自选图片与同名替换；当前目录的删除记录和相对索引随文件夹搬移，不自动复活旧图。',steps='设置未选择的旧AppData并确认不访问；明确迁移含自选/替换/删除的旧目录；搬移当前目录并比对原件和索引。',patterns=['AppData avatars and absolute old-location indexes are never discovered or migrated automatically','moving the whole folder preserves deleted defaults, custom bytes and snapshot IDs without the old location','avatar merge retains custom collisions and respects deleted untouched bundled defaults','external avatar references are only read after exact displayed paths are approved','Full import retains exact source, classroom history, avatars and local archive']),
 'R14-W01':dict(title='Windows目录版实际路径、搬移、副本及只读行为',expected='在真实Windows启动最终解压目录中的EXE，数据、头像、Excel和运行缓存均留在同级树。整目录搬移和双副本独立使用正常；只读位置停止并提示，不写AppData。',steps='在含中文空格的可写路径解压，保存资料后整目录搬移并重启；复制第二份分别保存；从只读位置启动并用系统文件监视核对原路径与AppData。',patterns=[],alwaysUnverified=True,limits='RC14外层便携启动器要求已由用户的目录版要求替代。Windows最终EXE原生效果未执行；Linux、Windows路径模型和故障注入均不能替代。')
}
OVERRIDES['N012']['patternsByScope']={'package':['All 120 extracted avatar bytes match bundled original manifest','a staged fresh folder already has 120 original images and preserves deletion before first launch']}
OVERRIDES['R14-15']['patternsByScope']={'package':['All 120 extracted avatar bytes match bundled original manifest','a staged fresh folder already has 120 original images and preserves deletion before first launch']}

OVERRIDES['R14-16']['patterns'] += [
    'Regression: whole deleted old avatar folder suppresses40 seeded originals and protects a destination replacement',
    'Regression: customized old default retains exact filename and future roster avatar-name matching',
    'Regression: an already customized destination avatar remains unchanged and incoming collision gets another filename',
    'Folder-edition relative avatar index resolves from selected 数据 and waits for displayed-resource confirmation']

QA_NOTES=[
 dict(id='Q15-01',title='RC14历史证据不转成RC15通过',actual='保留RC14的176项要求ID及历史状态。只使用本轮重新执行、明确选定且能绑定最终源码或精确ASAR的结果重新计算。旧报告及旧日志只作历史来源。',evidence='artifacts/rc14/report/report-input.json'),
 dict(id='Q15-02',title='目录需求取代旧延迟生成和便携外层路径',actual='首次解压已有资源，取代旧版首次点击才生成默认头像/Excel的要求。实际EXE目录取代外层便携启动器路径。相关旧ID保留并记录变更，旧预期不作为本轮缺陷或通过依据。',evidence='artifacts/rc15/report/new_requirements.py'),
 dict(id='Q15-03',title='源码、ASAR和Windows实机分层',actual='Node路径模型、Linux Electron中的精确ASAR以及最终压缩包结构分别记录。路径正确或模拟只读成功，不等于已经运行Windows EXE，也不等于验证真实Excel/WPS占用。',evidence='artifacts/rc15/report/binding-index.json'),
 dict(id='Q15-04',title='旧资料由用户明确迁移',actual='正常流程不自动寻找旧AppData。明确选择旧目录或使用完整JSON备份恢复属于用户触发的迁移流程；必须验证预览确认、现有资料保护和原件保留。',evidence='artifacts/rc15/report/new_requirements.py'),
 dict(id='Q15-05',title='目录写入观测的覆盖范围',actual='目录测试结合应用Node文件调用记录、Electron配置路径及创建文件清单。它不等于操作系统级全进程写入追踪。真实Windows EXE、原生缓存、快捷方式、只读介质和系统集成仍须现场核验，不能由云端路径模型推定全部通过。',evidence='artifacts/rc15-independent-review/application-write-inventory.json')
]
