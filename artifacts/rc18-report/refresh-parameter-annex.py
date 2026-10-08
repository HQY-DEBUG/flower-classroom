"""Refresh the human-readable parameter annex from the reviewed current inventory."""
from pathlib import Path
import hashlib
import json

ROOT=Path(__file__).resolve().parents[2]
def constraint(item):
    a=item['allowed'];t=a['type'];parts=[]
    number=lambda n:f'{n:,}' if isinstance(n,int) else str(n)
    if t in ['integer','number','nullable-integer']:
        parts.append(('整数' if t!='number' else '数值')+' '+number(a['minimum'])+' 至 '+number(a['maximum']))
        if 'not' in a:parts.append('不含 '+str(a['not']))
        if t=='nullable-integer':parts.append('空白沿用历史场景兼容语义；0明确不增加成长')
        if 'crossFields' in a:parts.append('六个累计阈值严格递增；legacy模式各级差相同且为1至100')
        if 'executionCap' in a:parts.append('实际抽取时不超过现有可用学生/小组数')
    elif t=='boolean':parts.append('是 / 否')
    elif t=='enum':
        vals=a['values'];zh={'students':'学生','groups':'小组','cycle':'轮内不重复','repeat':'允许重复'}
        parts.append('可选：'+'、'.join(vals.values() if isinstance(vals,dict) else [zh.get(v,v) for v in vals]))
    elif t=='url':parts.append('http/https；最多'+str(a['maxCodePoints'])+'字符；不含登录凭据、空白或反斜线')
    elif t=='string':
        if 'pattern' in a:parts.append('1至100位字母、数字、下划线或短横线')
        else:parts.append('文字 '+str(a.get('minCodePoints',a.get('minLength',1)))+'至'+str(a['maxCodePoints'])+'字符')
        if a.get('unique'):parts.append('ID全局唯一')
        if a.get('uniqueWithinPanel'):parts.append('ID在本面板内唯一')
        if a.get('controlCharacters') is False:parts.append('去首尾空白，不含控制字符')
    elif 'list' in t:
        parts.append(str(a['minRows'])+'至'+str(a['maxRows'])+'行，保留行序')
        if 'maxCodePoints' in a:parts.append('每项'+str(a.get('minCodePoints',1))+'至'+str(a['maxCodePoints'])+'字符')
        if 'unique' in t:parts.append('名称不重复')
    else:raise AssertionError(('Unformatted parameter constraint',item['key'],a))
    if item['status'].startswith('new-default'):parts.insert(0,'新增未来默认')
    return '；'.join(parts)

def main():
    inv_path=ROOT/'artifacts/rc18/configuration-inventory.json';inv=json.loads(inv_path.read_text())
    draft=ROOT/'artifacts/rc18-report/coverage-matrix-draft.json';d=json.loads(draft.read_text())
    scopes={'application':'整个程序','panel':'指定面板','shared':'所有面板共享','shared across all panels':'所有面板共享'}
    behaviors={
      '启动显示':'确认后的启动设置下次重启生效；启动只读校验，不自动应用外部改动。',
      '面板设置':'确认后对应面板实时使用；学生、分数及历史保持。',
      '计分卡片':'所有面板共用；只影响后续操作，旧历史与撤销快照保留。',
      '宠物进阶':'按面板保留既有成长模式；工作表不能启用或关闭成长账本。',
      '轮盘奖品':'按面板保存奖品及其顺序，不重写旧积分或兑换记录。',
      '趣味挑战':'按面板保存未来挑战选项，不改变正在运行的挑战。',
      '课堂网址':'按面板保存网址列表；任务和历史不改。',
      '作业科目':'不允许删除仍被活动作业引用的科目；任务与历史保持。',
      '工具默认':'供未来明确的新操作使用；当前计时、抽取结果及活动状态保持。',
    }
    rows=[]
    for item in inv['parameters']:
        assert item['scope'] in scopes,item['scope']
        behavior=behaviors[item['sheet']]
        if item['key']=='timerSound':behavior='计时响铃设置可保存；不改变当前剩余时长或运行状态。'
        rows.append({'sheet':item['sheet'],'key':item['key'],'name':item['label'],'scope':scopes[item['scope']],
          'note':constraint(item),'behavior':behavior,'source':'; '.join(e['file']+' / '+e.get('symbol','清单来源') for e in item.get('evidence',[]))})
    assert len(rows)==40
    d['parameterInventory']=rows;d['parameterInventorySha256']=hashlib.sha256(inv_path.read_bytes()).hexdigest()
    draft.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'parameterItems':len(rows),'inventorySha256':d['parameterInventorySha256']},ensure_ascii=False))

if __name__=='__main__':main()
