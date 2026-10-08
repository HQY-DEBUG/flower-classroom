"""Create an explicitly new synthetic uncached-formula input, never historical bytes."""
from pathlib import Path
from openpyxl import Workbook
root=Path(__file__).resolve().parent.parent
out=root/'artifacts/rc19/recovered-roster-inputs/independent-repro/openpyxl-formula.xlsx'
out.parent.mkdir(parents=True,exist_ok=True)
workbook=Workbook();sheet=workbook.active;sheet.title='学生名单'
sheet.append(['姓名','小组','头像名称'])
sheet.append(['合成保留学生','合成组',''])
sheet.append(['="合成公式姓名"','合成组',''])
workbook.save(out)
