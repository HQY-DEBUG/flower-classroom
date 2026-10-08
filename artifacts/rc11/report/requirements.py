"""RC11 user-visible requirements, independent of execution results."""

def row(id, category, title, expected, steps, patterns, implementation, fix='新增功能；最终修复与复验过程见问题记录'):
    return dict(id=id, category=category, title=title, expected=expected, steps=steps,
                patterns=patterns, implementation=implementation, fix=fix)

ROWS = [
row('N001','宠物蛋','40种新伙伴统一从蛋开始','新领养、零成长的40种伙伴显示同一枚蛋；仍保留原有七阶段数值规则。','为40种伙伴分别新建或领养，查看零成长造型与等级。',['All 40 species share one egg at zero'], 'src/pet-progress.js: eggState；src/pet-art.js；src/core.cjs'),
row('N002','宠物蛋','首次正成长孵化','首次获得正成长即显示本物种原始造型，等级未变化也出现破壳反馈。','对零成长的蛋加1成长，检查造型、等级与反馈。',['Visible \\+1 growth hatches'], 'src/pet-progress.js；src/pet-extra-ui.js；src/egg-pet.css'),
row('N003','宠物蛋','沿用旧成长门槛','快速增加成长时按原门槛定位阶段，蛋不占用或替换原七阶段。','从0直接加5成长，再核对各原有等级边界。',['Fast \\+5 hatches at original LV.2'], 'src/pet-progress.js；tests/pet-egg-lifecycle.test.cjs'),
row('N004','宠物蛋','撤销、扣减与清零回到蛋','新周期成长回到0后恢复蛋；撤销清零可恢复原成长造型。','孵化后撤销，扣减到0并执行已确认成长重置。',['Undo to zero shows the egg again','Fast \\+5 hatches at original LV.2'], 'src/pet-ledger.cjs；src/pet-progress.js'),
row('N005','宠物蛋','旧存档无标记伙伴保持','RC10及更旧未带蛋起始标记的伙伴保留原造型和成长，不批量变蛋。','加载旧零成长及非零成长档案，并核对导入、切换、暂停/恢复。',['All 40 species share one egg at zero'], 'src/core.cjs: optional startFromEgg；src/pet-progress.js'),
row('N006','宠物蛋','图鉴保留七造型','图鉴显示蛋序章以及原七幅造型，蛋状态不误把LV.1标为当前。','打开蛋的图鉴，成长后保持图鉴打开并观察刷新。',['Album has egg prelude','All 40 eggs hatch to their own original art together'], 'src/pet-extra-ui.js'),
row('N007','宠物蛋','排行、鼓励与荣誉卡一致','当前造型在排行、随机鼓励和荣誉卡均显示蛋；本地PNG正常导出。','打开相关视图、预览荣誉卡并导出合成学生PNG。',['Rankings, random encouragement and honor card current art use eggs'], 'src/pet-progress.js；src/pet-extra-ui.js'),
row('N008','宠物蛋','毕业快照与重新领养','毕业保持原LV.7快照和荣誉；重新领养不同物种建立新蛋周期。','成长至毕业，保存毕业后重新领养另一物种。',['Graduate preserves original LV.7 snapshot'], 'src/pet-ledger.cjs；src/pet-extra-ui.js'),
row('N009','宠物蛋','多窗口同步蛋和孵化','悬浮宠物、课堂展示和窄侧栏同步当前周期造型。','在主窗加成长，检查300px悬浮窗、侧栏及课堂展示。',['Pet float, classroom display and compact sidebar retain correct synchronized'], 'src/app.js；src/pet-extra-ui.js'),
row('N010','宠物蛋','高缩放破壳反馈可关闭','200%缩放与窄窗口下，蛋及孵化反馈的关闭栏保持可达。','打开相关反馈，200%缩放并滚动检查关闭、键盘路径。',['Egg and hatch feedback keep fixed close headers usable'], 'src/egg-pet.css；src/modal-shell.css'),
row('N011','宠物蛋','40种各自孵化且280造型保留','40种蛋分别恢复本物种原始美术；普通积分与280幅原造型保持。','批量孵化40种再回到蛋；比较原造型及持久化资料。',['All 40 eggs hatch to their own original art together','No renderer errors and all persisted student scores and original 280 art assets stay intact'], 'src/pet-art.js；assets'),
row('N012','头像库','首次按需准备40张头像','启动不创建或扫描头像库；首次明确打开时准备40张原创PNG。','在干净合成目录启动，点击学生头像，检查文件夹与头像数。',['Startup creates no avatar folder; first native avatar click seeds exactly 40'], 'src/avatar-library.cjs；assets/avatar-defaults'),
row('N013','头像库','学生卡片快捷选择','点击头像只打开该学生头像编辑器；搜索、键盘选择和取消不改档案。','点击学生头像，搜索并用键盘选择，再取消。',['Native search, keyboard selection and cancel leave persisted state unchanged'], 'src/avatar-ui.js；src/app.js'),
row('N014','头像库','照片导入和显式保存','选择照片仅更新草稿，点击保存才持久化；重复点击不重复提交。','用受控选择器提供合成图片，观察保存前后并连续点击保存。',['Quick import decodes a synthetic photo'], 'src/avatar-ui.js；src/main.cjs'),
row('N015','头像库','多窗口保留较新字段','另一窗口普通加分不阻止头像草稿，也不会被旧草稿覆盖。','保持头像草稿，在另一真实窗口加分，再保存头像。',['Unrelated score from another real window allows'], 'src/avatar-ui.js；src/core.cjs'),
row('N016','头像库','同字段冲突保留草稿','另一窗口已修改照片时，旧头像草稿拒绝覆盖并保留供核对。','先开草稿，再从另一窗口改变照片，尝试保存旧草稿。',['Conflicting photo from another window rejects stale save'], 'src/avatar-ui.js；src/core.cjs'),
row('N017','头像库','迟到选择器不写错对象','关窗、切学生或在同窗选择更新图片后，较早导入回复不覆盖新选择。','延迟图片选择回复，关闭重开学生或先选择另一库图片后释放回复。',['Late import after closing and opening another student','Choosing a newer library image supersedes'], 'src/avatar-ui.js: photoRequest/session'),
row('N018','头像库','恢复备份与切板作废旧草稿','恢复或切换面板使未完成头像操作失效，不覆盖恢复后或另一班资料。','延迟导入，恢复备份或切板后释放旧回复。',['Backup restore invalidates an open draft','Switching panels while import is pending'], 'src/avatar-ui.js: sync；src/app.js'),
row('N019','头像库','学生编辑器共用头像库','原学生编辑表可选同一头像库，保留未保存姓名等输入，保存嵌入快照。','在学生编辑表改文字、打开头像库、选图并保存，核对宠物未改变。',['Student edit form uses the same library'], 'src/avatar-ui.js；src/app.js'),
row('N020','头像库','单一持久文件夹与手动刷新','打开目标为既有资料目录中的avatars；增删及无效图片在刷新后明确反映。','打开头像文件夹，加入/删除合成图片及损坏图片，再点击刷新。',['Open folder targets the one explicit editable folder'], 'src/avatar-library.cjs；src/main.cjs'),
row('N021','头像库','删除素材不删除已选头像','完整备份与恢复保留已选快照；删除素材或整个库后不会自动补回默认图。','保存选图，删源图并清空库，备份/恢复并重启。',['Full backup and restore retain a selected snapshot'], 'src/avatar-library.cjs；src/core.cjs；src/storage.cjs'),
row('N022','头像库','缩放与键盘可用','900×640及100%/125%/150%/200%等组合下关闭可见，保存键盘可达。','在四种视口/缩放组合滚动头像库，检查标题关闭和键盘保存。',['Avatar header close remains visible at top and bottom'], 'src/avatar-ui.css；src/modal-shell.css'),
row('N023','头像库','只读取支持的有效静态图片','损坏、超大、动画和不支持图片被跳过并提示，不遍历子目录。','运行头像库模型边界测试，提供静态图、异常图、子目录及容量边界。',['corrupt, oversized, huge-dimension, animated and unsupported entries','the listing caps images and top-level entries'], 'src/avatar-library.cjs', '模型边界专项；不冒充Windows文件系统现场效果'),
row('N024','头像库','种子中断及只读目录明确处理','已有同名图不覆盖；首次准备中断不会重补被删默认图；只读问题明确提示。','注入种子中断、只读标记与不可创建目录，核对已有文件和提示。',['an existing same-name user image is never overwritten','partial first seed records an interruption','an existing read-only library remains selectable'], 'src/avatar-library.cjs', '受控文件系统测试；不替代被平台中止的旧专项'),
row('N025','名单头像','CSV/XLSX可选第三列','姓名、小组后的头像名称可选；旧两列模板与空白头像列继续可用。','分别解析旧两列、新三列CSV和XLSX，核对空白默认姓名头像。',['CSV old two-column template and new optional avatar-name column parse','XLSX optional avatar name parses and duplicate aliases reject'], 'src/io.cjs；src/main.cjs'),
row('N026','名单头像','完整文件名及唯一短名匹配','优先填写完整文件名，如01-星星猫头鹰.png；无后缀只在唯一匹配时使用。','提供完整文件名、唯一短名和大小写变化名称。',['Avatar filename matcher resolves explicit, unique stem and case-normalized names'], 'src/io.cjs: resolveAvatarRows'),
row('N027','名单头像','缺失、歧义、非法名称明示','未找到、大小写冲突、多后缀同名、路径或网址均明确提示并使用默认姓名头像。','导入缺失/重复/路径/网址名称，逐行检查预览状态。',['Empty, missing and ambiguous avatar names stay explicit','Avatar column never follows a path or URL','Case-colliding filenames and omitted extensions'], 'src/io.cjs；src/app.js'),
row('N028','名单头像','确认保存预览快照','预览后素材变化不更换已匹配图片；确认后存储预览时的头像。','生成匹配预览，改变源列表/素材，再确认导入并比较快照。',['Resolved photo snapshots do not change if the source listing mutates after preview'], 'src/io.cjs；src/main.cjs；src/core.cjs'),
row('N029','名单头像','追加、替换及坏图原子验证','追加保留既有头像/历史；替换保存有效快照并新建蛋；后行坏图拒绝整次导入。','执行追加与替换，再构造后行无效照片并确认无部分导入。',['RC11 roster photo snapshots: append preserves existing avatars/history','RC11 roster photo snapshots: an invalid later photo rejects'], 'src/core.cjs: prepareImport'),
]

# Model-only requirements are deliberately reported separately from GUI effects.
for item in ROWS:
    item['testLayer'] = '模型与文件边界' if item['id'] in ['N023','N024','N025','N026','N027','N028','N029'] else 'Linux Electron界面'
    item['requiredScopes'] = ['source','package']

for item in ROWS:
    if item['id']=='N021': item['patterns'].append('Fresh process preserves exact photos')
    if item['id']=='N025': item['packagePatterns']=['CSV old two-column native preview','XLSX old two-column native preview','XLSX optional avatarName native preview']
    if item['id']=='N026': item['packagePatterns']=['CSV every row shows exact, stem, blank, missing, ambiguous, invalid and NFC results']
    if item['id']=='N027': item['packagePatterns']=['CSV every row shows exact, stem, blank, missing, ambiguous, invalid and NFC results']
    if item['id']=='N028': item['packagePatterns']=['Deleted avatar after preview keeps the exact reviewed snapshot','Same-filename replaced avatar after preview keeps the exact reviewed snapshot']
    if item['id']=='N029': item['packagePatterns']=['Append preserves every original student field','Successful replace saves protection backup','Malformed photo in second import row rejects']

ROWS += [
row('N030','名单头像','原生模板含填写说明','下载的XLSX首表含姓名、小组、头像名称，说明页给出文件名规则和备份方式。','通过桌面导出模板，读取表头、示例与5条中文填写说明。',['Downloaded native XLSX has optional third column and full Chinese instructions'],'src/main.cjs: template'),
row('N031','名单头像','旧两列名单实际导入','CSV与XLSX旧两列名单经过预览与确认后正常保存，头像为默认姓名。','分别使用两列CSV/XLSX打开原生导入预览，确认并检查保存内容。',['CSV old two-column native preview','XLSX old two-column native preview'],'src/main.cjs；src/io.cjs；src/app.js'),
row('N032','名单头像','逐行预览匹配结果','精确、短名、空白、缺失、歧义、非法及Unicode名称逐行显示准确结果。','用包含八类合成姓名/头像名称的CSV，比较头像、状态和确认后结果。',['CSV every row shows exact, stem, blank, missing, ambiguous, invalid and NFC results'],'src/io.cjs；src/app.js'),
row('N033','名单头像','取消与并发修改保护','取消选择器或替换预览不写资料；替换预览过期后拒绝覆盖并发更新。','取消两种入口；在另一窗口加分后确认旧替换预览。',['Cancel native chooser and cancel replace preview','Replace rejects stale revision without removing concurrent score'],'src/main.cjs；src/app.js；src/core.cjs'),
row('N034','名单头像','保护备份及素材变化保持','成功替换先保留保护备份；删图或同名换图后仍保存已预览快照。','确认替换并核对备份；预览后删图/同名替换，再分别确认。',['Successful replace saves protection backup','Deleted avatar after preview keeps the exact reviewed snapshot','Same-filename replaced avatar after preview keeps the exact reviewed snapshot'],'src/main.cjs；src/storage.cjs；src/core.cjs'),
row('N035','名单头像','导入快照经恢复与重启保留','删除全部素材后，完整备份恢复和新进程启动保持已导入头像及名单。','导入后删除素材，备份、恢复并重启，再逐项比较。',['Backup and native restore preserve imported snapshots','Fresh process restores exact reviewed avatar snapshots and roster'],'src/main.cjs；src/storage.cjs'),
row('N036','名单头像','恢复作废预览及坏行整批拒绝','备份恢复使旧追加预览失效；第二行坏照片拒绝整次追加或替换。','另一窗口恢复备份后提交旧预览；分别输入第二行无效照片。',['Restore from another window invalidates the old append preview','Malformed photo in second import row rejects'],'src/main.cjs；src/core.cjs'),
row('N037','名单头像','预览200%缩放关闭可达','短视口、200%缩放下滚动预览，关闭按钮保持可见可点击。','在900×640窗口设置200%缩放，滚动头像预览后检查关闭矩形。',['Short viewport and 200 percent zoom keep preview close reachable'],'src/avatar-ui.css；src/modal-shell.css'),
]
for item in ROWS:
    item.setdefault('testLayer','Linux Electron界面')
    item.setdefault('requiredScopes',['source','package'])

OBSERVED = {
'N001':'40种零成长伙伴的蛋图完全相同；数值等级仍为1，旧无标记样本显示原造型。',
'N002':'加1成长后孵化为本物种LV.1原图，并出现独立破壳反馈。',
'N003':'0直接加5到原LV.2；七阶段数值规则保留，未新增第八等级。',
'N004':'撤销正成长、扣回0及已确认成长重置后均显示蛋，数值等级仍按原规则计算。',
'N005':'加载的旧无标记零成长样本保留原美术；旧资料相关模型/差异检查另列执行记录。',
'N006':'图鉴有蛋序章和七原造型；当前为蛋时LV.1未误标当前，打开的图鉴随成长刷新。',
'N007':'排行、随机鼓励及荣誉卡均取当前蛋图；生成的本地PNG可解码。',
'N008':'毕业快照保持原LV.7；换物种重新领养建立新蛋周期，毕业记录保持。',
'N009':'主窗变化同步到300px悬浮宠物、课堂展示与紧凑侧栏，蛋/孵化状态一致。',
'N010':'200%缩放及窄窗口下固定关闭栏可达，反馈弹层无相关渲染错误。',
'N011':'40种分别孵化为自己的原图，40种回零后回蛋；原280幅美术及普通积分保持。',
'N012':'应用启动未建立头像目录；第一次头像操作准备40张默认PNG且未改变选中学生。',
'N013':'原生键鼠搜索/选择/取消保持持久化资料原样，选中项保留键盘焦点。',
'N014':'合成照片解码后先留在草稿；明确保存后只提交一次，选择器返回受控文件。',
'N015':'另一窗口更新普通分后仍可保存头像，较新的普通分及其他字段完整保留。',
'N016':'并发修改同一照片字段后旧保存被拒绝，所选头像草稿仍显示供核对。',
'N017':'关窗切换学生、后选库图片后，旧文件选择回复均未覆盖新对话框/新选择。',
'N018':'恢复和切板使旧草稿及待返回导入失效，恢复后照片及新面板未被旧操作改动。',
'N019':'学生编辑表保留文字修改，头像嵌入档案，原宠物不变；更早照片回复无法改后选图。',
'N020':'受控openPath指向唯一avatars目录；新增、删除、坏图刷新反映在选项与提示中。',
'N021':'清空素材后备份、恢复及新进程启动保留同一照片快照，空库未自动补回默认图。',
'N022':'900×640@100%、1280×720@125%、1024×640@150%、900×640@200%关闭可见且键盘保存可达。',
'N023':'模型用例跳过损坏、超限、动画及不支持文件，静态PNG/JPEG/WebP保留；不遍历子目录。',
'N024':'同名用户图未覆盖，中断不重补，已有只读图仍可选，不可创建目录给明确错误。',
'N025':'旧两列CSV/XLSX与新可选列可解析并导入；空白头像列得到默认姓名头像。',
'N026':'精确文件名、唯一无后缀名和大小写规范化匹配到预期图；多义名不擅选。',
'N027':'预览明确区分matched/default/missing/ambiguous/invalid等结果；路径/网址不读取外部文件。',
'N028':'预览后删除源图、替换同名源图或改变列表，确认保存的仍是同一预览快照。',
'N029':'追加保留原同学字段，替换持久化已核对头像及蛋起始标记；第二行坏图整批拒绝。',
'N030':'实际导出的XLSX含3列表头和5条中文填写说明。',
'N031':'CSV、XLSX旧两列样本各导入2人，均为0张照片、2个默认姓名头像。',
'N032':'八行预览结果依次为匹配、匹配、默认、缺失、歧义、非法、歧义、匹配，保存3张照片与5个默认头像。',
'N033':'取消选择器/预览未改内存或磁盘；过期替换拒绝执行，保留另一窗口新分数。',
'N034':'成功替换8人并生成保护备份；预览后删图/同名换图两种情况都保留精确快照。',
'N035':'删除全部素材后完整备份恢复成功；新进程恢复5人名单和1张已核对照片。',
'N036':'备份恢复使旧追加预览失效，第二行坏图未造成追加/替换部分写入。',
'N037':'900×640窗口200%缩放形成450×320视口，关闭控件44×44且位于可见范围。',
}
for item in ROWS: item['observed']=OBSERVED[item['id']]
