"""Apply the coordinator-approved unified-workbook scope to the stable matrix."""
from pathlib import Path
import copy
import datetime as dt
import hashlib
import json

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
REVISIONS={
 'R007':('宠物进阶工作表的累计门槛与旧模式',
  '根目录配置.xlsx实际包含宠物进阶工作表，以累计成长阈值表达阶段。sixstage六段5显示5、10、15、20、25、30；各面板legacy与sixstage按既有语义校验和应用。成长模式只读，表格不能启用或关闭成长账本；成长下限按明确合法策略处理。',
  '混合legacy/sixstage面板，读取实际sheet和累计阈值；边界计分、外部编辑预览取消/确认、重启后复核各板模式、阈值、旧成长及荣誉快照。',
  '原六段配置和旧档兼容保持；配置载体改为唯一活动配置.xlsx，累计表达不改变历史账本模式。'),
 'R14-06':('根目录唯一配置工作簿与显式打开',
  '目录版解压即含EXE同级配置.xlsx，包含九个数据工作表及填写说明；界面展示实际路径并提供打开入口。打开本身不改变参数，旧配置.txt与计分卡片.xlsx不再作为活动参数表。',
  '检查解压未启动目录、首次启动与路径信息，显式打开；核对文件、十个sheet、打开目标、参数及历史无多余写入。',
  '原同级计分卡片.xlsx被用户明确改为统一配置.xlsx，旧路径仅作为保留的迁移输入。'),
 'R14-07':('界面配置保存同步写入唯一工作簿',
  '从界面保存可持久参数后，配置.xlsx与最近有效内部配置事务一致；计分卡为全局唯一集合，面板参数按稳定面板ID隔离。保存只提交一次，未改的配置域、学生、积分、成长和历史保持。',
  '分别经界面修改共享卡、面板设置及列表配置；读回整本及JSON，跨窗切板和重启核对完整性、同步范围与提交次数。',
  '每面板独立卡片被全局共享取代；工作簿同步从卡片扩展为完整配置域。'),
 'R14-08':('外部编辑必须整本预览确认',
  '外部编辑配置.xlsx不会静默应用。显式刷新整本校验与预览，取消不改参数，确认才原子应用全部审阅改动；启动窗口参数下次重启生效。预览期间新增的积分和历史保留。',
  '同时修改多个sheet及面板；分别打开、整本预览、取消/确认；预览期间另窗计分及修改参数，复核生效范围、过期拒绝、运行态及下次启动行为。',
  '原仅计分卡刷新改为整本配置预览确认，禁止按sheet局部导入造成半套设置。'),
 'R14-09':('旧分歧卡片并集迁移与稳定全局ID',
  '旧面板卡片不一致时明确预览并确认非破坏性并集；独有卡和同ID不同内容均保留，相同卡去重。迁移后一套稳定全局卡ID不依赖当前板、班名或行顺序；各面板原历史和撤销快照不丢。',
  '合成相同卡、独有卡、同ID不同内容和同名不同值的旧多面板文件；预览取消后核对，再确认迁移、切板改名及重启，验证并集和旧历史。',
  '旧按面板ID区分卡集合的约定改为全局共享；旧来源文件原件保留。'),
 'R14-10':('完整配置工作簿整批校验与拒绝',
  '缺失/未知sheet或字段、错误类型、公式/错误单元格、重复或未知ID、缺面板、非法阈值与数值全部拒绝；保留最近有效整套参数和外部原件。删除仍被活动作业使用的科目应明确拒绝，不改任务记录。',
  '逐域构造非法值、结构缺失、重复键及跨sheet错配；测试在用科目删除；刷新/保存后比较配置、学生、工具记录、JSON与Excel原字节。',
  '校验对象由多面板卡表扩展为整本配置；参数变体作为子检查，不增加功能分母。'),
 'R14-11':('整本配置事务失败恢复与精确重试',
  '配置.xlsx和已确认内部配置在所有域按一个事务提交。写入、rename EPERM及JSON保存失败不留下半更新，保留草稿或待提交意图，错误解除后可明确重试且只提交一次；中断恢复不覆盖新的外部编辑。错误提示真实操作与路径，不猜用户系统原因。',
  '合成注入各提交边界错误、拒绝rename和回复丢失，比较整本及全部域；解除错误后重试，提交前后强制中断并重启，复核外部修改冲突与一次性提交。',
  '原计分卡事务扩展到全配置域；Linux注入不等同Windows Excel/WPS实际占用验收。'),
 'R14-12':('整本外部冲突、保护备份与重建',
  '预览或准备后任一工作表再被外部修改，旧令牌即失效。明确重建前复核整文件哈希并保留原件备份；备份失败不覆盖外部文件或已确认配置。',
  '预览后分别修改其他sheet和卡片sheet；尝试旧确认；对重建取消、备份失败及正确确认检查源文件、保护副本与课堂状态。',
  '冲突和备份范围从计分卡表扩展为配置.xlsx整文件。'),
 'R15-01':('完整目录版含统一配置与全部运行文件',
  '交付完整文件夹压缩包，解压前后逐文件核验。未启动时已有120张头像、可编辑配置.xlsx及空数据/备份目录；无额外说明MD，源码和测试报告不放入运行目录，不发行第二个活动参数文件。',
  '解压最终7z及ZIP并逐文件比对；首次启动前核对头像、十sheet配置工作簿、空目录、无多余活动参数文件和说明Markdown。',
  '原配置.txt与计分卡片.xlsx两个活动文件改为一个配置.xlsx，用户旧文件由迁移保留。'),
 'R15-09':('唯一配置.xlsx、最后有效缓存与生效时机',
  '所有清单内持久可修改参数集中到根目录配置.xlsx。启动只作整本只读校验并使用最后一次已确认的有效缓存，不自动采用外部编辑；外部改动经整本预览确认才应用，窗口启动参数在下次重启生效。缓存是恢复/启动依据，不是第二处可编辑参数表。',
  '核对40参数清单与九个数据sheet；外部同时修改启动和课堂参数后重启、只读校验、预览取消和确认，再重启比较实际值；检查旧文件不被活动读取、配置不含真实资料或凭据。',
  '原配置.txt启动即读取语义被用户明确改为唯一Excel与显式整本确认，文本BOM/注释只属旧迁移格式，不再是活动配置规范。'),
 'R15-10':('坏整本配置明确报错且不静默回退',
  '启动时整本配置只读校验；格式、字段、类型或数值非法必须明确报错并保留外部原字节。不得静默回退旧txt/旧卡表或默认值，不能自动覆盖外部编辑或建立半套已确认参数；最后有效缓存仅按明确受测恢复流程使用。',
  '构造坏结构、缺sheet、未知键、非法类型/值及超限文件，在启动与刷新路径核对提示、旧缓存、原工作簿和课堂数据，无静默旧文件回退或部分应用。',
  '原纯文本坏配置验收改为整本Excel只读启动校验和最后有效缓存语义。'),
 'R15-13':('初始统一工作簿绑定与已编辑文件保留',
  '解压已含真实配置工作簿。未编辑初始模板可按明确首次设置流程绑定当前课堂和稳定面板ID，形成完整有效缓存；已编辑或格式变化的外部文件不自动覆盖或应用，需显式预览/迁移/重建。失败和中断可恢复。',
  '合成未编辑种子、已编辑种子及格式变化文件；首次设置、取消/确认、错误及重启逐一比较整本与缓存，检查稳定ID和外部原件保留。',
  '种子绑定对象由卡片表扩展为十sheet配置.xlsx，外部修改仍需明确动作。'),
 'R15-14':('旧资料和旧参数明确迁移、原件保留',
  '用户明确选择旧目录后展示来源/目标及支持参数的迁移预览，确认后转换到配置.xlsx并保留旧配置.txt与计分卡片.xlsx原件。不同旧卡片作非破坏性并集；取消、失败或冲突不覆盖旧源或当前资料。已有真实课堂数据仍受原迁移保护条件约束。',
  '从合成旧目录迁移课堂、头像与旧参数；验证取消、非法旧参数、卡片分歧、写入失败及重试；比对旧源字节、当前资料、整本新配置、重启与旧文件停止活动使用。',
  '迁移新增旧参数的明确转换，不再要求用户手工把配置.txt复制成活动文件。'),
}

def main():
    p=OUT/'coverage-matrix-draft.json';d=json.loads(p.read_text())
    inventory_path=ROOT/'artifacts/rc18/configuration-inventory.json'
    inv=json.loads(inventory_path.read_text())
    assert len(inv['parameters'])==40 and len(inv['proposedSheets'])==10
    assert len(d['requirements'])==191 and not any(r['id']=='R18-02' for r in d['requirements'])
    for r in d['requirements']:
        if r['id'] in REVISIONS:
            title,expected,steps,replaces=REVISIONS[r['id']]
            r.update(title=title,expected=expected,steps=steps,replaces=replaces,definitionChangedIn='RC18',expectedExactAssertions={'source':[],'package':[]})
    d['requirements'].append({
      'id':'R18-02','category':'工具默认','module':'统一配置','baselineKind':'RC18新增2项','sourceKind':'本轮用户统一参数要求',
      'title':'未来工具默认持久化且保留运行中状态',
      'expected':'计时默认时长、普通点名/宠物抽取的默认对象/策略/数量及挑战默认时长独立持久化，只影响新的明确操作。配置刷新不更改正在计时的截止/剩余值，不重置抽取池、结果、轮次或事件身份，不改变进行中的挑战、奖项、作业或历史。',
      'steps':'各板设置八个不同未来默认；运行计时、普通点名、宠物抽取与挑战期间整本预览确认，再新开/明确重设相关操作与重启；核对默认取值及旧运行态、记录和面板隔离。',
      'requiredScopes':['source','package'],'expectedExactAssertions':{'source':[],'package':[]},
      'version':'1.3.0-rc.18','status':'未验证','sourceStatus':'未验证','packageStatus':'未验证',
      'sourceEvidence':'','packageEvidence':'','actual':'等待本轮最终冻结执行证据','implementationStatus':'待核验',
      'fix':'等待最终冻结复验','testTime':'','historicalStatus':'本轮新增','historicalVersion':'无','historicalExpected':'无',
      'historicalEvidence':'无历史通过结论','platformUnverified':False,'limits':'仅实际受测源码/精确ASAR及Linux运行层，Windows实机仍另列未验。',
    })
    d['denominatorFinalized']=True
    d['definitionStage']='完整参数清单与稳定功能定义已确认：192项；183项可在云端受测层验证，9项Windows实机保持未验证。当前结果仍等待最终冻结执行。'
    d['definitionApprovedAt']=dt.datetime.now(dt.timezone.utc).isoformat()
    d['reportLabel']='RC18 统一配置与课堂交互全面复核'
    d['requirementCounts']={'未验证':192}
    d['configurationScope']='根目录配置.xlsx是唯一活动参数工作簿。40个参数项覆盖九个数据sheet及填写说明；旧配置.txt和计分卡片.xlsx仅作明确迁移输入并保留原件。名单、计分记录、图片、凭据和工具运行态不进入配置。'
    d['configurationMigrationNote']='旧文件经明确选择、整本预览和确认后迁移，保留源文件原件；新工作簿建立后不静默回退旧文件。启动作整本只读校验并使用最后已确认缓存；外部修改需整本确认，启动显示参数下次重启生效。'
    d['parameterInventoryEvidence']='artifacts/rc18/configuration-inventory.json'
    d['parameterInventorySha256']=hashlib.sha256(inventory_path.read_bytes()).hexdigest()
    d['parameterInventorySummary']='40个参数项包含既有持久设置与8个明确分离的未来操作默认。参数项、sheet、值域和边界检查不各自重复计作功能要求。'
    scopes={'application':'整个程序','panel':'指定面板','shared':'所有面板共享'}
    d['parameterInventory']=[{'sheet':x['sheet'],'key':x['key'],'name':x['label'],'scope':scopes.get(x['scope'],x['scope']),
      'note':('新增未来默认；' if x['status'].startswith('new-default') else '')+json.dumps(x['allowed'],ensure_ascii=False,separators=(',',':')),
      'behavior':x['applicationBehavior'],'source':'; '.join(f"{e['file']}:{e['line']}" for e in x.get('evidence',[]))} for x in inv['parameters']]
    d['revisions']={**d.get('revisions',{}),**{k:{'title':v[0],'expected':v[1],'steps':v[2],'replaces':v[3]} for k,v in REVISIONS.items()}}
    d['pendingScope']='功能定义已确认；待冻结、完整source/ASAR复验和协调者脱敏名单摘要。'
    assert len(d['requirements'])==len({r['id'] for r in d['requirements']})==192
    p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'requirements':192,'cloudVerifiable':183,'nativeWindowsUnverified':9,'parameters':40,'dataSheets':9,'currentAssertions':0},ensure_ascii=False))

if __name__=='__main__':main()
