"""Draft RC18 coverage without carrying a previous execution into current counts."""
from pathlib import Path
import copy
import datetime as dt
import hashlib
import json

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
BASE = ROOT / 'artifacts/reaudit-rc16/report/report-input.json'
WINDOWS = ['V033','V035','V037','V038','V052','V054','V067','R14-W01','R14-W02']

# A changed acceptance criterion replaces its former criterion. It is not a
# second feature merely because it has additional edge cases or test layers.
REVISIONS = {
 'R14-07': {
  'title':'所有面板共享计分卡并同步根目录Excel',
  'expected':'全局只保存一套计分卡；从任一面板编辑后所有面板及关联窗口使用同一规则集合。根目录计分卡片.xlsx与JSON事务一致。学生、分数、成长、历史仍按面板隔离。',
  'steps':'建立多个不同名单面板，在其中一个面板编辑卡名、积分和成长；逐板及跨窗检查同一卡集合，再重启并检查JSON与根目录工作簿。',
  'replaces':'原每面板规则保存语义由用户明确改为全局共享；不再把面板各自拥有一套卡片作为通过条件。'},
 'R14-08': {
  'title':'共享卡片外部编辑须经预览确认刷新',
  'expected':'外部编辑根目录计分卡片.xlsx不自动入账或生效。显式刷新先校验并预览，取消保持全局规则，确认后全部面板使用同一新集合；各面板既有历史及预览期间新增积分保留。',
  'steps':'外部编辑共享卡片；分别预览、取消与确认；预览期间另窗给另一面板计分，确认后逐板核对规则同步及历史不变。',
  'replaces':'原多面板分别刷新卡片更新为一次确认刷新全局集合。'},
 'R14-09': {
  'title':'旧分歧卡片明确合并为共享集合',
  'expected':'旧面板卡片不一致时先明确预览并确认非破坏性并集迁移；所有不同卡片均保留，相同卡去重，同ID不同内容不得覆盖丢失。迁移后稳定全局卡ID不依赖班名、面板顺序或当前班，重启继续共享。',
  'steps':'构造相同卡、独有卡、同ID不同内容及同名不同值的旧多面板档；预览取消核对原数据，再确认并集、切板、改班名、重启，检查卡片与历史完整。',
  'replaces':'工作簿按面板ID区分不同卡集合的旧约定已被全局共享取代；历史要求和旧结果仅保留用于追溯。'},
 'R14-10': {
  'title':'整批拒绝非法共享卡片或进阶工作簿',
  'expected':'重复或缺失卡ID、缺格、额外数据、非法积分/成长以及不完整或非法宠物进阶配置导致整批拒绝；保留最近有效规则、各面板进阶配置与原工作簿字节。共享卡表不再要求每个面板重复一套卡。',
  'steps':'逐个构造共享卡与宠物进阶表损坏、重复、缺失、越界和不支持的单元格；刷新及保存，核对内存、JSON、原Excel无部分更新。',
  'replaces':'原逐面板卡表的缺失/未知面板检查按新共享卡表结构替换；宠物进阶仍按明确面板身份校验。'},
 'R14-11': {
  'title':'拒绝重命名后的回滚、恢复及原操作重试',
  'expected':'写入或rename返回EPERM等错误时不留下半更新，不覆盖已有效原文件；保留草稿或待提交意图，错误解除后明确重试只提交一次。提示真实操作与路径、提供恢复入口，不猜测用户系统上具体占用或权限原因。中断恢复不覆盖新外部修改。',
  'steps':'合成注入rename拒绝，比较文件及内存、检查提示与恢复入口；解除错误后同操作重试与重启复核；分别测试提交前后中断及外部再修改。',
  'replaces':'沿用原事务要求并补充用户提供的EPERM失败场景；Linux故障注入不能证明Windows Excel/WPS实际占用行为。'},
 'R007': {
  'title':'宠物进阶工作表显示累计门槛并保留旧模式',
  'expected':'根目录计分卡片.xlsx实际包含宠物进阶工作表，以累计成长阈值表达阶段。六段5的累计门槛为5、10、15、20、25、30；各面板legacy与sixstage模式按各自既有含义展示、校验及应用，不把旧档静默改为新模式。',
  'steps':'创建legacy及sixstage面板，导出并读取实际工作表；核对累计阈值及边界分级；外部编辑后预览取消/确认，重启后检查各面板模式和原有成长账本。',
  'replaces':'保留原六个5与旧档兼容要求，增加真实Excel进阶配置及累计门槛表达；不另增重复功能分母。'},
 'RC6-01': {
  'title':'主要展示区域与可收起的宠物介绍',
  'expected':'学生及宠物卡片占主要区域；宠物页顶部紫色介绍条可隐藏，相关选项收进可发现、可操作的二级菜单，隐藏后不妨碍计分、进阶与管理。',
  'steps':'打开宠物页，隐藏顶部紫色介绍条；从二级菜单访问相关选项，在正常及窄窗缩放条件核对名单与主要操作可用。',
  'replaces':'沿用原学生/宠物主体布局要求，增加本轮隐藏介绍条及二级菜单的明确交互。'},
}

def main():
    old=json.loads(BASE.read_text())
    assert old['version']=='1.3.0-rc.17'
    assert len(old['requirements'])==190
    assert old['requirementCounts']=={'通过':181,'未验证':9}
    historic={
      'version':old['version'],'requirements':190,'passed':181,'unverified':9,
      'finalAssertionPasses':5515,'finalObservations':8,
      'reportInputFile':str(BASE.relative_to(ROOT)),
      'reportInputSha256':hashlib.sha256(BASE.read_bytes()).hexdigest(),
      'scope':'仅历史追溯；无一条旧执行计入RC18断言数或当前通过状态',
    }
    requirements=[]
    for prior in old['requirements']:
        r=copy.deepcopy(prior)
        r.update(historicalStatus=prior['status'],historicalVersion=old['version'],
                 historicalExpected=prior['expected'],historicalTitle=prior['title'],
                 historicalEvidence='\n'.join([prior['sourceEvidence'],prior['packageEvidence']]),
                 version='1.3.0-rc.18',sourceStatus='未验证',packageStatus='未验证',status='未验证',
                 sourceEvidence='',packageEvidence='',actual='等待本轮最终冻结执行证据',
                 implementationStatus='待核验',testTime='',currentEvidence=[],
                 sourceMissing=[],packageMissing=[],missingSummary='等待冻结与新执行',
                 auditFindings='待本轮复核',fix='本轮尚未完成复验；RC17结果不自动继承')
        r['expectedExactAssertions']=copy.deepcopy(prior.get('exactBindings',{}))
        for k in ('exactBindings','additionalExactBindings','legacyExactBindings','patterns','patternsByScope','observed'):
            r.pop(k,None)
        if r['id'] in REVISIONS:
            r.update(copy.deepcopy(REVISIONS[r['id']]))
            r['expectedExactAssertions']={'source':[],'package':[]}
            r['definitionChangedIn']='RC18'
        r['platformUnverified']=r['id'] in WINDOWS
        requirements.append(r)
    requirements.append({
      'id':'R18-01','category':'快捷积分窗','module':'快捷积分窗','baselineKind':'RC18新增1项',
      'sourceKind':'本轮用户明确要求','title':'快捷积分选择工具栏固定、名单独立滚动',
      'expected':'快捷积分窗底部选择工具栏保持可见可操作；学生名单在独立区域滚动，末尾学生可达，选择状态、批量计分与清除选择不受滚动影响。',
      'steps':'用120人合成长名单选择首尾及多人，滚动到底再返回；在423×669、360×400、540×340及600×600/200%等受控窗口检查底栏、末行可达、批量计分、双击保护、选择与滚动保留。',
      'requiredScopes':['source','package'],'expectedExactAssertions':{'source':[],'package':[]},
      'version':'1.3.0-rc.18','status':'未验证','sourceStatus':'未验证','packageStatus':'未验证',
      'sourceEvidence':'','packageEvidence':'','actual':'等待本轮最终冻结执行证据',
      'implementationStatus':'待核验','fix':'等待实现与最终复验','testTime':'',
      'historicalStatus':'本轮新增','historicalVersion':'无','historicalExpected':'无',
      'historicalEvidence':'无历史通过结论','platformUnverified':False,
      'limits':'Linux Electron窗口与受控缩放验证；不替代V037的Windows实机拖移、触屏或课件覆盖验收',
    })
    assert len(requirements)==len({r['id'] for r in requirements})==191
    draft={
      'schemaVersion':1,'finalized':False,'version':'1.3.0-rc.18',
      'denominatorFinalized':False,
      'definitionStage':'等待统一配置工作簿的完整参数清单；191为共享计分卡阶段中间草案，不是最终功能分母',
      'pendingScope':'所有可修改参数统一到根目录配置.xlsx并按sheet区分；旧配置.txt及计分卡片.xlsx停止活跃使用但原件保留；名单、真实计分记录、图片及凭据不得写入配置工作簿。',
      'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),
      'auditNotBefore':'2026-10-07T06:40:00Z',
      'reportLabel':'RC18 共享计分卡与课堂界面复核','reportSlug':'1.3.0-rc.18_20261007',
      'historicalBaseline':historic,'requirements':requirements,
      'requirementCounts':{'未验证':191},'runs':[],'findings':[],'currentAssertions':0,
      'revisions':REVISIONS,'windowsIds':WINDOWS,
      'releaseGate':'等待最终源码冻结、精确ASAR和协调者选择的新执行证据，当前不作通过结论。',
      'privacy':{'allPublicTestFixturesSynthetic':True,'privateRosterQa':'等待协调者提供脱敏聚合结果；真实姓名、原输入和原截图均不进入报告、源码或发行包','privateRosterChecksCountedInFinalAssertions':False},
      'limits':[
        '9项Windows实机验收保持未验证；Linux错误注入不替代Windows原生占用与权限场景。',
        '此前已停止的额外锁、权限与文件边界专项独立保持未验证，不检查或重启该专项。',
        '用户截图中的SmartScreen未知发布者提示仍是未解决的签名/信誉问题；本轮不提供绕过办法，也不宣称已修复。',
      ],
      'selectionPolicy':'仅协调者明确选定的冻结后唯一断言叶子计最终数；独立重复子集仅作旁证，失败、脚本修正、开发运行和观察分开记录。',
    }
    OUT.mkdir(parents=True,exist_ok=True)
    (OUT/'coverage-matrix-draft.json').write_text(json.dumps(draft,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'requirements':191,'changedStableIds':list(REVISIONS),'newIds':['R18-01'],'currentAssertions':0},ensure_ascii=False))

if __name__=='__main__':
    main()
