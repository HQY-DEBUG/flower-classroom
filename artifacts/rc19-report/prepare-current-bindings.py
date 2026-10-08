"""Name current-contract checks in advance; this file never assigns pass status."""
from pathlib import Path
import json
import re
import ast

OUT=Path(__file__).resolve().parent;ROOT=OUT.parents[1]
def read(path):return json.loads(path.read_text())
def names(relative):
    match=re.search(r'const expectedCases\s*=\s*(\[[\s\S]*?\]);',(ROOT/relative).read_text())
    assert match,relative
    return ast.literal_eval(match.group(1))
primary=names('scripts/qa-rc19-current-score-journeys.cjs')
secondary=names('scripts/qa-rc19-secondary-pet-ui.cjs')
group=re.findall(r"await check\('([^']+)'",(ROOT/'scripts/qa-group-create-assign-rc19.cjs').read_text())
workbook=re.findall(r"test\('([^']+)'",(ROOT/'tests/configuration-workbook-rc19.test.cjs').read_text())
progress=re.findall(r"test\('([^']+)'",(ROOT/'tests/pet-score-progression-rc19.test.cjs').read_text())
level25=re.findall(r"test\('([^']+)'",(ROOT/'tests/pet-level-25-rc19.test.cjs').read_text())
mainbook=re.findall(r"await check\('([^']+)'",(ROOT/'scripts/qa-rc19-workbook-main-migration.cjs').read_text())
mainbook=[name for name in mainbook if name!='RC18 ']
mainbook += ['RC18 '+scenario+' receipt resolves against durable old classroom state before any partial config import' for scenario in ['pending-before','pending-after','restore-before','restore-after']]
def find(items,fragment):
    found=[name for name in items if fragment in name];assert found,(fragment,items);return found
def p(fragment):return find(primary,fragment)
def s(fragment):return find(secondary,fragment)
def w(fragment):return find(workbook,fragment)
def n(fragment):return find(progress,fragment)
def both(values):return {'source':list(dict.fromkeys(values)),'package':list(dict.fromkeys(values))}

bindings={}
def bind(ids,values):
    for rid in ids.split(','):
        bindings[rid]={'reason':'按用户RC19当前积分、全局进阶与新毕业停用定义，绑定本轮明确的界面/模型断言；不继承旧版本执行状态。','exactAssertions':both(values)}
bind('N001,N005',n('all 40 species')+p('Negative current score'))
bind('N002,V070',p('Teacher clicks actual plus-one'))
bind('N003,V064,V065',n('exact egg, every boundary')+level25+p('Rendered score card')+p('levels 24 25 and 26'))
bind('N004,V066,R013',n('ordinary addition, subtraction and undo')+level25[1:]+p('Teacher clicks actual plus-one')+p('Pet-page custom subtract'))
bind('N006,N011',n('all 40 species')+level25+p('Rendered score card'))
bind('N008,R009,V075',n('retired growth, reset and graduation')+n('existing history and graduation snapshots')+s('Honor card and badge ledger')+s('Secondary feature menu'))
bind('R014',n('repeat adoption after historical graduation')+n('first readoption from a previously graduated')+s('Batch adoption starts'))
bind('V010',w('duplicate panel names')+p('Editing the global progression'))
bind('V028,F005',group)
bind('V059',p('Negative current score')+p('Rendered score card')+p('levels 24 25 and 26'))
bind('V068,V069,R14-03,F007',p('Pet-page custom subtract')+s('Batch score confirmation')+n('old negative independent growth metadata'))
bind('V072',n('pet controls work before any legacy ledger')+s('Batch score confirmation'))
bind('V073',s('Batch scoring handoff')+s('Batch score confirmation')+s('Batch preview blocks concurrent'))
bind('R006,R007',w('one global progression sheet')+w('25-level export')+w('global costs edit')+w('global progression rejects')+p('Editing the global progression')+p('Rule-form cancellation')+s('Workbook preview shows'))
bind('R016',n('redemption lowers current level')+p('Teacher clicks actual plus-one'))
bind('R017',p('Rendered score card journeys'))
bind('F008,RC6-13',s('Batch adoption starts')+n('existing history and graduation snapshots')+n('retired growth, reset and graduation'))
bind('R14-02',s('Score editor exposes only')+s('Shared score editor keeps'))
bind('R14-10',w('exported IDs are hidden')+w('reviewed add, cancel')+w('duplicate IDs')+w('all-sheet refresh rejects')+w('global progression rejects'))
bind('R19-01',n('roster gender')+p('Student gender editor'))

# New journey checks supplement existing unaffected safeguards.  They do not
# silently remove older atomicity, visual-asset, sorting or redemption coverage.
matrix=read(OUT/'coverage-matrix-draft.json')
for rid in ['F005','R016','F008','RC6-13','R014','N006','N011','V010']:
    existing=next(row for row in matrix['requirements'] if row['id']==rid)
    for mode in ['source','package']:
        bindings[rid]['exactAssertions'][mode]=list(dict.fromkeys(bindings[rid]['exactAssertions'][mode]+existing['expectedExactAssertions'][mode]))

journeys={
 'J19-01':p('Teacher clicks actual plus-one'),
 'J19-02':p('Negative current score'),
 'J19-03':p('Rendered score card')+p('levels 24 25 and 26')+level25,
 'J19-04':p('Pet-page custom subtract')+s('Batch scoring handoff')+s('Batch score confirmation'),
 'J19-05':p('Editing the global progression')+p('Rule-form cancellation')+s('Workbook preview shows')+w('25-level export'),
 'J19-06':s('Score editor exposes only')+s('Shared score editor keeps')+w('exported IDs are hidden')+w('reviewed add, cancel'),
 'J19-07':group,
 'J19-08':n('roster gender')+p('Student gender editor'),
 'J19-09':n('retired growth, reset and graduation')+s('Honor card and badge ledger'),
 'J19-10':mainbook,
}
result={'version':'1.3.0-rc.19','purpose':'Expected exact assertion names only; all executions and pass statuses await coordinator final selection.','requirementBindings':bindings,'journeyBindings':{rid:{'exactAssertions':both(values)} for rid,values in journeys.items()},'needsAdditionalReview':['N025,N030,N031 roster field/alias exact bindings','R008 pet draw current-score exact binding','R012 visibility current-level exact binding','All retained historical expected assertions must still be found in fresh final selections'],'finalPassesAssigned':0}
(OUT/'proposed-current-bindings.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'currentRequirementBindings':len(bindings),'userJourneyBindings':len(journeys),'exactGroupCases':len(group),'mainWorkbookCases':len(mainbook)}))
