"""RC15 folder-only acceptance units; test cases do not expand the denominator."""
ROWS=[]
def R(n,module,title,expected,steps,patterns,limits=None):
    ROWS.append(dict(id=f'R15-{n:02}',module=module,title=title,expected=expected,steps=steps,
        patterns=patterns,baselineKind='RC15新增14项',sourceKind='用户RC15目录版新增要求',
        basis='用户RC15要求：仅完整文件夹版；文件、数据和缓存均跟随EXE；解压已有120张头像、配置.txt、计分卡片.xlsx、数据及备份；旧数据明确迁移；运行目录不增加说明MD。',
        requiredScopes=['source','package'],implementationStatus='待绑定',
        limits=limits or '合成数据与受控Linux Electron/Node检查。Windows原生移动、只读和双副本行为仍见R14-W01。'))
R(1,'解压目录','完整目录版直接包含全部运行文件',
  '交付完整文件夹压缩包；解压前后逐文件校验。未启动时已具有120张头像、可编辑配置、真实Excel模板及空数据/备份目录；无额外说明MD，源码和测试报告不放入运行目录。',
  '检查最终压缩包与重新解压目录，统计资源并读取配置和Excel；枚举根目录及文件树，验证所需组件和无额外MD。',
  ['fresh extraction resources contain all originals, real editable defaults and empty data/backup folders before launch','preparation rejects visible Markdown notes and redirected resource directories'])
R(2,'目录解析','正常启动以真实EXE目录为唯一根目录',
  '正式Windows目录版使用实际EXE父目录，不依赖工作目录、旧便携启动器变量、AppData或测试路径变量。开发/测试模式必须明确启用。',
  '给出含中文空格的Windows EXE路径，设置干扰变量并改变cwd；检查所有布局路径及副本根目录。',
  ['normal Windows folder launch follows actual EXE, ignoring cwd, AppData, launcher and test paths','Normal Windows root ignores cwd, test variables and obsolete launcher variables','Root resolution remains identical after changing working directory'])
R(3,'无隐式外部数据','正常流程不读取或写入旧AppData',
  '首次运行、重启、打开图库、保存和备份均不自动扫描、采用或修改旧AppData。旧位置只通过用户明确选择的迁移入口读取。',
  '设置带合成旧数据的AppData夹具并记录访问；执行正常业务，再核对零旧目录访问与原文件哈希。',
  ['No old AppData fixture was read','Normal flow never consulted legacy AppData','AppData avatars and absolute old-location indexes are never discovered or migrated automatically'])
R(4,'运行缓存','Electron运行路径在ready前定位到本目录',
  'userData、appData、sessionData、临时、日志与崩溃文件均在数据目录内准备并在Electron ready前配置；准备失败不继续到主窗口。',
  '记录启动路径设置顺序；检查真实Electron路径与写入目标、异常启动窗口数和终止行为。',
  ['Successful bootstrap sets every app runtime path before ready','Electron writable paths resolve under current folder','Observed app writes stay under portable root'])
R(5,'本地存档备份','业务保存和保护备份留在数据与备份目录',
  '课堂JSON和本地状态保存到同级数据；导出JSON和操作前保护快照默认放入同级备份。打开数据目录定位当前副本。',
  '积分后读取JSON；保存完整备份并核对内容；执行有保护快照的操作；打开数据目录并核对路径。',
  ['Score persists to sibling data directory','Selected backup export matches current class and defaults to 备份','Protective snapshots stay under sibling backup folder','Open data folder uses current copy'])
R(6,'文件对话框','导入导出默认路径明确且取消不写文件',
  '导入、照片、模板、还原、汇总与排行对话框提供当前根目录内的绝对默认路径；取消不创建导出或改数据。用户可明确选择外部文件。',
  '逐一取消相关原生对话框的受控调用，检查默认目录与文件写入记录，再执行一次选定备份。',
  ['Canceled imports and exports have absolute local defaults'])
R(7,'搬移','整目录搬移后保存内容与路径仍有效',
  '完整文件夹搬移后跟随新EXE位置继续使用原课堂、头像、配置及历史；不依赖旧绝对路径，不把删除的头像补回。',
  '保存合成课堂并删一张头像，退出后移动整目录；以新根重启，核对状态与资源，再保存。',
  ['moved and independently copied folders preserve all existing classroom and lock bytes','Restart or relocation retains the same classroom','moving the whole folder preserves deleted defaults, custom bytes and snapshot IDs without the old location'])
R(8,'副本隔离','独立目录副本保存彼此隔离',
  '复制整目录得到相同初始资料；以后每个副本的配置、课堂保存和缓存均只写各自目录。',
  '复制使用后的文件夹，分别调整配置和保存状态，比较另一个副本字节不变。',
  ['Two copies preserve independent config and data roots','moved and independently copied folders preserve all existing classroom and lock bytes'])
R(9,'启动配置','配置.txt是真实支持的启动设置',
  '解压即可编辑配置.txt。支持的窗口、缩放和启动设置在下次启动生效；允许BOM、CRLF和注释，保留用户原字节，不接受路径改写设置。',
  '解析默认和带中文注释的配置；修改支持项，重启检查窗口与缩放参数；检查文件未重写。',
  ['folder config template is supported configuration, with documented defaults','folder config accepts UTF-8 BOM, CRLF, comments, spaces and supported settings','bootstrap creates one editable default template when missing and keeps user edits on restart','Configured dimensions reach BrowserWindow and actual renderer zoom is applied','Configured minimized startup reaches real show/minimize hooks'])
R(10,'配置拒绝','坏配置停止启动且保留原文件',
  '重复项、未知项、非法数值/布尔、版本、编码或超大配置给出定位清楚的错误；不使用静默默认，不修改配置或建立半成品数据。',
  '分别使用各类坏配置启动；核对错误行、文件哈希、数据创建和主窗口。',
  ['folder config reports the exact bad line and does not accept unsupported destinations','folder config rejects oversized or non-UTF-8 input and preserves original bytes','Malformed .* config is preserved and prevents directory writes','Malformed UTF-8 config is preserved and blocks startup'])
R(11,'不可写目录','不可写或空间错误停止且无备用目录',
  '根目录或会话目录不可写、只读或空间不足时明确提示搬到可写位置，停止业务启动，不回落到AppData或更改课堂。',
  '注入EACCES、EROFS、ENOSPC并记录文件调用；验证失败前后文件、路径设置和窗口。',
  ['unwritable root is a terminal startup error with no AppData fallback or classroom changes','unwritable existing session directory stops before Electron path setup','Injected .* probe failure reports blocked boot with no alternate path','Unwritable folder blocks startup before application window','Blocked startup gives useful relocation/write message'],
  '普通本目录启动失败注入。未执行此前停止的锁/权限/文件边界专项，亦不替代真实Windows只读介质验收。')
R(12,'解压后头像','首次启动前删除头像也不会补回',
  '压缩包带相对资源种子记录。用户解压后、第一次运行前删除图片或整个头像目录，首次启动和后续刷新均尊重删除；搬移不恢复旧目录。',
  '解压后先删一张及整库，运行并刷新；搬移整目录后再次核对，检查相对元数据。',
  ['a staged fresh folder already has 120 original images and preserves deletion before first launch','removing the whole staged avatar folder before launch keeps it empty without restoring the bundle','packaged seed record preserves a prelaunch deletion and relocation without previous-root dependence','Manually deleted avatar is not restored on refresh'])
R(13,'解压后Excel','初始Excel绑定与用户修改安全保留',
  '真实Excel模板在解压后已存在。未修改模板首次启动按当前课堂随机稳定ID绑定并原子保存；已编辑或格式改变模板不自动覆盖，经明确刷新/重建才应用；失败和中断可恢复。',
  '比较两次生成模板字节；首次启动和重启核对ID；编辑模板/格式后启动；执行确认刷新、失败回滚和两侧中断恢复。',
  ['distribution template is reproducible across clocks and time zones with an explicit unbound marker','blank first launch binds random panel IDs and durably saves once; restart preserves all bytes','edited placeholder is retained at startup and binds only after explicit single-panel refresh','format-only template edits are never automatically overwritten','failed first JSON save restores the exact template or absence and allows retry','interrupted bootstrap recovers both sides of JSON save, including regenerated initial panel IDs'])
R(14,'旧版迁移','旧数据通过明确选择和保护检查迁移',
  '正常启动不搜索旧数据。用户明确选择旧资料目录后展示来源/目标并确认；仅无资料或精确未使用示例可接收，已有真实资料拒绝覆盖。取消、失败或冲突保留旧源和当前资料，并可重试。',
  '以合成旧目录走明确选择、预览、取消和确认；重复运行、已有资料、锁文件、坏标记及来源变动场景逐一核对原件和目标。',
  ['only exactly recorded unused example permits migration','new lock or unrecorded legacy classroom prevents pristine migration','missing damaged or malformed marker never authorizes replacing data','Explicit preview summarizes source without modifying source or target','Cancel invalidates pending import and preserves example','Confirmed migration saves source class and full local archive','Migrated used folder is no longer eligible to overwrite with another import','Source changed after preview rejects preparation without target mutation','Injected staged-copy EIO cleans up and same-token retry succeeds','Original source files remain byte-identical after application restart','Confirmation identifies source destination resources and original lock','Confirmation cancel discards preview and restores trigger focus','Double-click commits once with a successful durable migration response'])
assert len(ROWS)==14
ROWS[0]['patternsByScope']={'package':[
    'Extracted root already contains editable sidecars and empty data/backup directories',
    'All 120 extracted avatar bytes match bundled original manifest',
    'Distribution contains no loose Markdown files',
    'Folder executable is an actual standalone runtime alongside app.asar',
    'Production dependency entry points needed for startup and workbook operations are bundled',
    'Pre-extracted workbook is a real XLSX with the expected reproducible starter hash']}
ROWS[11]['patternsByScope']={'package':[
    'a staged fresh folder already has 120 original images and preserves deletion before first launch',
    'removing the whole staged avatar folder before launch keeps it empty without restoring the bundle',
    'Manually deleted avatar is not restored on refresh',
    'moving the whole folder preserves deleted defaults, custom bytes and snapshot IDs without the old location']}
