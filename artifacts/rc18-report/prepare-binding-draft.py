"""Explicit proposed assertion names for revised definitions; no outcomes are inferred."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parents[2]
OUT=Path(__file__).resolve().parent
same=lambda names:{'source':names,'package':names}
N={
 'R007':[
  'RC18 uses one shared card sheet and exact cumulative growth for both existing progression modes',
  'RC18 rejects invalid, missing, duplicate, switched-mode and nonmonotonic progression without accepting card edits',
  'RC18 config: workbook configuration cannot enable a legacy pet ledger',
  'pet threshold UI action persists to progression sheet as cumulative values'],
 'RC6-01':[
  'Pet main starts at navigation and pets with no purple overview or explanatory banners',
  'Secondary pet menu supports keyboard focus, Escape, rule entry and catalog entry without mutation',
  'Secondary menu close and keyboard trap stay accessible at 200 percent in short viewport',
  'Secondary pet menu opens and closes through touch input with full-size targets'],
 'R14-06':[
  'single active configuration workbook has every expected sheet and excludes operational records',
  'unified first bootstrap persists app cache and one shared collection, exposes ten sheets, and changes no classroom records',
  'Unified configuration is visible in class settings with one active workbook path',
  'Manager open failure is visible; opening a workbook never imports it'],
 'R14-07':[
  'every additional configuration action reaches the unified workbook through real preload',
  'card-only UI save preserves previously imported startup and unrelated domain values',
  'blank, roster-copy and full-copy panels immediately support shared edits and synchronized sheet rows',
  'RC18 shared rules: create blank/roster/full, switch, remove and clear keep one shared identity and independent score histories',
  'ordinary scoring does not read or write the configuration workbook'],
 'R14-08':[
  'external workbook edits are read-only on restart and full refresh applies settings together while preserving live tools',
  'all domains apply in one transaction while running timer, draws, scores and homework stay exact',
  'external card-plus-threshold refresh preserves later scoring from another window',
  'Unified workbook previews classified before/after values and applies all sheets only after explicit confirmation',
  'Workbook preview shows one shared collection and per-panel cumulative progression; cancel is safe'],
 'R14-09':[
  'RC18 shared rules: union retains same-ID conflicts, same-name values, zero versus omitted growth and original snapshots',
  'RC18 shared rules: all 2000 legacy variants survive merge, nested validation, editing, switching and JSON backup',
  'old TXT and workbook migrate only via explicit full preview, source hashes remain unchanged, and changes after preview reject',
  'legacy differences remain until explicit shared consent through real preload/main',
  'Different legacy card sets require explicit conflict preview; cancel and close do not change data',
  'Double confirmation shares once, preserves conflicting variants and the old panel snapshots'],
 'R14-10':[
  'RC18 config: complete schema rejects unknown state/ledger keys, missing fields, forged identities and unsupported versions',
  'RC18 rejects invalid, missing, duplicate, switched-mode and nonmonotonic progression without accepting card edits',
  'one invalid startup field prevents every other modified sheet from applying',
  'removing a subject used by an active task rejects the complete workbook',
  'new subject dependency created after preview is checked against latest tasks before apply',
  'new unified workbook requires its 启动显示 sheet','new unified workbook requires its 面板设置 sheet',
  'new unified workbook requires its 工具默认 sheet','new unified workbook requires its 课堂网址 sheet','new unified workbook requires its 作业科目 sheet',
  'omitted panel in links cannot silently erase that panel configuration',
  'duplicate startup parameter is rejected with all external bytes unchanged'],
 'R14-11':[
  'RC18 EPERM after temp creation preserves old workbook and JSON; release and explicit re-preview retry commits once',
  'JSON failure rolls back all multi-sheet edits together and retains operational state',
  'EPERM in real main leaves JSON and workbook unchanged and retry updates exactly once',
  'Failed Excel replacement keeps the editor draft and supports an explicit safe retry',
  'Failed workbook apply requires a fresh preview token before explicit retry',
  'restart after process interruption on either side of JSON commit chooses its last valid rules',
  'recovery will not overwrite an externally edited file after an interrupted transaction'],
 'R14-12':[
  'external change in startup sheet blocks stale card editor through full-workbook fingerprint',
  'external changes before prepare, after prepare, and invalid cells never silently overwrite',
  'confirmed rebuild checks latest hash again and backup failure leaves both stores unchanged',
  'A newer external workbook edit invalidates the older refresh preview',
  'Explicit rebuild preserves exact external workbook backup and current classroom'],
 'R15-01':[
  'fresh extraction resources contain all originals, real editable defaults and empty data/backup folders before launch',
  'preparation rejects visible Markdown notes and redirected resource directories',
  'single active configuration workbook has every expected sheet and excludes operational records'],
 'R15-09':[
  'external workbook edits are read-only on restart and full refresh applies settings together while preserving live tools',
  'established malformed or missing new config never reads or falls back to old TXT or score workbook',
  'single active configuration workbook has every expected sheet and excludes operational records',
  'fresh process retains exact final shared JSON, thresholds and workbook'],
 'R15-10':[
  'established malformed or missing new config never reads or falls back to old TXT or score workbook',
  'explicit repair of a missing established config rebuilds current cached settings without resurrecting old files',
  'one invalid startup field prevents every other modified sheet from applying',
  'duplicate startup parameter is rejected with all external bytes unchanged'],
 'R15-13':[
  'unified first bootstrap persists app cache and one shared collection, exposes ten sheets, and changes no classroom records',
  'custom new workbook with absent app cache takes precedence over old migration sources and never imports old TXT',
  'edited unbound template preserves current class name when only startup zoom was edited',
  'edited unbound template honors explicitly edited class name',
  'format-only template edits are never automatically overwritten',
  'interrupted bootstrap recovers both sides of JSON save, including regenerated initial panel IDs'],
 'R15-14':[
  'old TXT and workbook migrate only via explicit full preview, source hashes remain unchanged, and changes after preview reject',
  'pending old workbook receipt is read-only evidence; migration uses current authoritative JSON card settings',
  'copied migration sources are read from verified current-root backup paths and missing/tampered evidence blocks migration'],
 'R18-01':[
  'Quick-score tray stays at bottom while 120 students scroll independently and the last row remains reachable',
  'Quick-score header, selected count and all actions remain usable at small size and 200 percent',
  'Batch score suppresses accidental double click and keeps the selected students and scroll'],
 'R18-02':[
  'RC18 config: external refresh preserves running timer, draw pools/results/identity, every record and existing shared catalog',
  'RC18 config: tool actions persist chosen defaults while standalone default changes preserve operational sessions',
  'Fresh ordinary draw reads persisted defaults; passive updates preserve selections and reward drafts',
  'Loading draw defaults preserves the old results until a new draw explicitly starts, then persists choices',
  'Timer drafts and a running timer survive default refresh; explicit reset consumes the saved duration',
  'Failed timer preset preserves the time draft through a later unrelated state update',
  'Pet draw defaults persist when submitted and passive refresh preserves current draw and input draft',
  'Challenge stale defaults refuse to overwrite new configuration, retaining the local seconds draft',
  'Starting challenge saves its duration once; later defaults do not interrupt the current round'],
}
def main():
    baseline=json.loads((ROOT/'artifacts/reaudit-rc16/report/report-input.json').read_text())
    old={r['id']:r for r in baseline['requirements']}
    bindings={}
    for rid,names in N.items():
        assertions=same(names)
        if rid=='R15-14':assertions={mode:list(dict.fromkeys(old[rid]['exactBindings'][mode]+names)) for mode in ['source','package']}
        bindings[rid]={'reason':'按协调者确认的RC18统一配置/界面定义改绑；原定义与RC17证据保留为历史。该清单只指定需要出现的精确断言，不继承任何执行结果。','exactAssertions':assertions}
    (OUT/'requirement-bindings-draft.json').write_text(json.dumps({'version':'1.3.0-rc.18','finalized':False,'requirementBindings':bindings},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'revisedRequirements':len(bindings),'outcomesInferred':0}))
if __name__=='__main__':main()
