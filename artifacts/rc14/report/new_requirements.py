"""RC14 functional acceptance units. Assertion repetitions do not create new requirements."""
ROWS = []

def R(n, module, title, expected, steps, patterns, limits=None):
    ROWS.append(dict(id=f'R14-{n:02}', module=module, title=title, expected=expected, steps=steps,
        patterns=patterns, baselineKind='RC14新增21项', sourceKind='用户新增要求',
        basis='用户RC14新增要求：就地编辑计分卡；EXE同级头像文件夹与120张头像；同级计分卡片.xlsx、显式刷新、面板隔离和历史保留。',
        requiredScopes=['source','package'], implementationStatus='待绑定',
        limits=limits or '合成数据；Linux Electron源码及精确ASAR、Node模型。Windows原生效果见R14-W01、R14-W02。'))

R(1,'计分卡编辑','从计分选卡处直接编辑并返回',
  '普通积分和宠物奖励选卡界面有独立编辑入口。打开、取消或保存规则均不直接给学生加分或成长；保存后返回原选卡上下文。',
  '打开普通计分和宠物奖励选卡；分别编辑、取消、保存；核对积分、成长、历史不变和返回界面。',
  ['Opening contextual editor and canceling never awards','Contextual rule save writes score and growth separately','Pet reward grid edit is separate'])
R(2,'计分卡编辑','名称分值成长独立输入与校验',
  '卡片名称、积分及成长可独立编辑。正负值、零和空白默认语义明确，越界或无效值拒绝，不写入无效规则。',
  '修改名称；试正积分负成长、零成长、空白旧规则和数值边界；保存并读取UI与Excel。',
  ['RC14 reason growth: signed growth has strict numeric bounds','signed growth and zero round-trip distinctly','Contextual edit saves name points and negative growth'])
R(3,'计分和宠物','按所选卡片分别应用积分与成长',
  '普通积分操作只按积分字段加分；独立宠物奖励按成长字段改变成长且不改普通积分。旧成长模式和显式零值按其兼容规则执行。',
  '在普通、独立宠物和旧成长模式分别使用定制卡片，检查相关与无关账本、零成长按钮和实际变化。',
  ['Edited ordinary score card awards its points','Pet card uses custom growth','Legacy contextual zero growth saves','Zero-growth pet card is disabled','Legacy-linked ordinary-score confirmation accurately discloses linked pet growth','Mixed linked and independent score targets receive accurate per-target growth effects'])
R(4,'历史与撤销','规则更新保留旧历史并准确撤销',
  '规则编辑或Excel刷新只影响之后的动作；旧积分和成长日志保存原数值、理由及实际变化，撤销按历史快照恢复。',
  '先加分或奖励，再修改规则及刷新Excel；逐项比对旧日志，撤销原动作并复查真实增减。',
  ['Award uses reviewed rule snapshot and undo','RC14 reason growth: new rules never recalculate saved historical values','Explicit Excel refresh updates future cards and preserves every historical log'])
R(5,'并发与恢复','过期选卡和编辑草稿不可误提交',
  '另一窗口改卡、切换面板或同ID恢复后，旧选卡确认和旧编辑提交拒绝。可恢复失败保留本地草稿，迟到回复不替换新弹窗。',
  '双窗口修改同卡；打开旧确认或编辑后恢复、切班；延迟保存回复并打开新弹窗；核对无多余写入和草稿。',
  ['Old score confirmation rejects another window','Concurrent rule editor save fails','Same-ID restore invalidates old rule editor','Late rule save acknowledgement cannot replace','Exact rule-save retry recovers existing receipt after lost action and receipt responses'])
R(6,'Excel配置','同级计分卡文件路径及显式打开',
  '计分卡片.xlsx使用程序资源目录；界面展示实际路径并提供打开及管理入口。启动或查询路径不擅自读取外部表；打开文件不导入规则。',
  '检查初次启动和信息查询，再显式打开；核对文件名、资源目录、打开目标及当前规则无变化。',
  ['construction does not read files or load Excel','explicit first open creates workbook','Manager open failure is visible; opening a workbook never imports it'])
R(7,'Excel配置','界面规则保存同步写入Excel',
  '从界面首次或后续保存规则后，Excel与课堂存档一致，保留面板/规则ID及其他课堂状态。只提交一次有效更改。',
  '不存在工作簿时首次保存；再编辑已有规则；读取Excel与JSON，核对无关积分、历史及提交次数。',
  ['saving the first UI rule change can create the workbook transactionally','synchronous commit writes the file before JSON','Contextual rule save writes score and growth separately'])
R(8,'Excel配置','外部修改须经预览确认刷新',
  '外部表格编辑不会自动生效。显式刷新先校验并预览，取消不改数据，确认才更新规则；预览期间新积分和旧历史保留。',
  '外部修改多面板规则；分别打开、刷新预览、取消及确认；预览期间另窗加分，确认后核对。',
  ['External workbook edits block stale UI save; refresh preview and cancel','Explicit Excel refresh updates future cards','External multi-panel refresh preserves scores changed after preview','Cancel external refresh confirmation leaves'])
R(9,'面板隔离','稳定ID区分面板并兼容改名重启',
  '工作簿以面板ID和规则ID匹配，重排或同名不串班；班名更改和重启后仍能保存，并更新展示名；未知或缺失ID拒绝。',
  '创建多面板和重复规则ID；调换行列、切班、班级改名并重启；保存和刷新后核对各班规则。',
  ['Multiple panels keep separate workbook rules','rows and columns can be reordered without crossing panels','renamed classroom after restart uses stable panel IDs','renamed display names never hide real external rule changes'])
R(10,'Excel校验','整批拒绝不完整或非法工作簿',
  '未知/缺失面板、重复ID、缺格、额外数据和非法积分/成长导致整批拒绝；保留最后有效规则与外部原文件。',
  '逐个构造损坏、重复、缺失、越界和不受支持单元格；刷新及保存，核对内存、JSON和原Excel字节。',
  ['refresh rejects unknown/missing panels, duplicate IDs, partial rows','Malformed workbook leaves last valid rules','failed first save removes the newly created workbook'])
R(11,'原子保存','文件失败回滚及中断重启恢复',
  'Excel写入或JSON保存失败时不留下半更新；草稿可重试。提交前后中断及回滚失败后的重启依据已持久化状态恢复，不覆盖新的外部修改。',
  '注入写入/改名、JSON和回滚失败；重启恢复并重试；检查两份存储、事务记录和精确旧历史。',
  ['Excel file lock fails atomically','Classroom save failure rolls Excel back','rollback failure preserves receipt','restart after process interruption on either side of JSON commit','recovery will not overwrite an externally edited file'])
R(12,'文件并发','外部修改冲突与备份重建',
  '准备或预览后新的外部修改会使旧令牌失效。确认重建前复核文件哈希并保留原Excel备份；备份失败不覆盖文件或课堂数据。',
  '编辑外部Excel后尝试旧保存/刷新；确认重建并逐字节核对备份；注入备份失败并再次检查。',
  ['external changes before prepare, after prepare','A newer external workbook edit invalidates','Explicit rebuild preserves exact external workbook backup','confirmed rebuild checks latest hash again'])
R(13,'头像目录','资源目录模型统一使用EXE同级头像',
  '头像资源以程序同级“头像”目录为目标；便携模型选择外层EXE，安装/文件夹模型选实际EXE目录，不受cwd影响。不可写时明确报原路径，不暗移到AppData。',
  '对Windows便携、安装、文件夹路径做模型测试；实际Electron查询同级目录；模拟不可写位置。',
  ['Windows portable resources follow the launched outer EXE','folder and installed Windows builds resolve','unwritable EXE location reports a writable-folder remedy','Startup and folder-info only resolve'])
R(14,'头像入口','设置和选头像处显示可复制路径',
  '设置、图库管理和快捷/完整学生编辑处显示相同实际路径，有明确打开和刷新按钮；路径可以选择复制。打开失败提示真实错误，不误报成功或打开备用目录。',
  '逐个入口选择路径、打开目录、显式刷新；注入系统打开错误和目录不可用；核对打开目标和提示。',
  ['Settings exposes an immediately selectable actual path','Settings manager uses its own folder controls','Quick chooser exposes the same path','OS open failures and exceptions remain visible','An unavailable real avatar directory reports failure'])
R(15,'头像素材','保留原40张并新增80张共120张',
  '默认素材总数120，原40张文件保持身份和字节；新增80张为合成卡通图。最终包、外部初次生成和真实图片解码一致。',
  '比对RC13与最终素材清单及哈希；统计新增文件；首次加载图库并用真实图片解码读取120张。',
  ['Startup creates no avatar folder; first native avatar click seeds exactly 120 original PNGs','fresh external avatar creation is lazy and produces 120 defaults'])
R(16,'头像升级','迁移自选图片并保留用户替换删除',
  '旧图库及程序目录升级迁移保留有效自选图与同名替换；已删的旧默认图不复活，新增80图只初始化一次；中断迁移可恢复。',
  '用合成旧图库含替换/删除/自选图升级；删图重启、迁移中断后重启，再次升级检查文件与原件。',
  ['legacy migration copies valid top-level images once','a later program-folder upgrade migrates current choices','legacy deletion of the whole avatar folder preserves old40 deletions','in-place default catalog upgrade adds only new names','an interrupted first migration preserves source files'])
R(17,'头像刷新','增删素材刷新且已选快照保留',
  '文件夹增删有效PNG/JPEG/WebP后显式刷新才更新图库，无效/动画图片排除。已选头像、JSON备份及重启不依赖原图文件继续存在。',
  '加入和删除合成图片，刷新前后比较；选定头像后删除原件，备份、恢复并重启检查嵌入快照。',
  ['corrupt, oversized, huge-dimension, animated and unsupported entries are skipped while static PNG/JPEG/WebP remain','Open folder targets the one explicit editable folder; add, remove and invalid-image refresh update choices only','Full backup and restore retain a selected snapshot after source removal','Explicit refresh sees add/remove files while the selected snapshot'])
R(18,'异步界面','头像迟到回复不破坏新草稿',
  '关闭、导航、恢复或打开新学生后，旧打开/刷新回复失效；编辑文字、照片草稿和焦点保留，路径上按Enter不误提交。',
  '延迟目录打开和刷新，关闭/换学生/恢复后释放回复；编辑文字并用键盘选择路径，核对新草稿和焦点。',
  ['Closed quick chooser ignores a delayed open failure','A delayed refresh from a closed chooser cannot overwrite','Full student editor keeps edited text and keyboard focus','Restore invalidates a quick draft'])
R(19,'窄窗与缩放','新增规则及头像控件保持可达',
  '在受测窄窗口及100%、125%、150%、200%受控缩放下，路径、编辑、打开、刷新和关闭按钮可见或可滚动到达，不遮住必要操作。',
  '按受测窗口大小与缩放逐个检查规则及头像界面；键盘移动焦点、关闭和路径选择。',
  ['Rule controls stay reachable at 900x640 zoom 2','Folder controls, path and close remain usable at 900x640 / 100%','Folder controls, path and close remain usable at 1280x720 / 125%','Folder controls, path and close remain usable at 1024x640 / 150%','Folder controls, path and close remain usable at 900x640 / 200%'])

for identifier,title,expected,steps in [
 ('R14-W01','Windows便携外层EXE实际资源目录','在Windows实际启动最终便携EXE，头像和计分卡文件位于用户启动的外层EXE同级，退出重启仍使用该目录。','在Windows把便携EXE放到含中文空格的可写目录，启动、打开头像及计分卡、保存、退出重启，再核对路径和内容。'),
 ('R14-W02','Windows资源管理器及Excel或WPS实机行为','最终Windows程序可以真实打开正确文件夹和工作簿；Excel/WPS真实占用时提示清楚，关闭后重试成功且不损坏文件。','在Windows使用资源管理器和已安装Excel/WPS打开文件；实际保持占用、保存失败、关闭后重试；核对原始和最终文件。')]:
    ROWS.append(dict(id=identifier,module='Windows新增现场验收',title=title,expected=expected,steps=steps,patterns=[],baselineKind='RC14新增21项',sourceKind='用户新增要求的Windows平台验收',basis='RC14新增功能依赖的Windows现场效果，独立列示，不混入原7项。',requiredScopes=['source','package'],implementationStatus='接口已提供，现场未验证',alwaysUnverified=True,limits='未执行Windows EXE。路径模型、官方NSIS代码核对、shell.openPath受控替身、失败注入、ExcelJS读写不能替代此项现场证据。'))

assert len(ROWS)==21
