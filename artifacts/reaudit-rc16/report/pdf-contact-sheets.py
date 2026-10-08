"""Compose review-only contact sheets from the rendered final PDF pages."""
from pathlib import Path
import sys
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[3]
P=Path(sys.argv[1])if len(sys.argv)>1 else ROOT/'outputs/flower-rc16-next-reaudit-report/pdf-render'
files=sorted(P.glob('page-*.png'))
for start in range(0,len(files),4):
    pages=[Image.open(p).convert('RGB')for p in files[start:start+4]]
    width=max(p.width for p in pages);height=max(p.height for p in pages)+28
    sheet=Image.new('RGB',(width*2,height*2),'#D9DDE2');draw=ImageDraw.Draw(sheet)
    for i,page in enumerate(pages):
        x=(i%2)*width;y=(i//2)*height
        draw.text((x+12,y+8),f'PDF page {start+i+1}',fill='black')
        sheet.paste(page,(x,y+28))
    sheet.save(P/f'contact-{start//4+1:02}.png')
print({'pages':len(files),'contacts':(len(files)+3)//4})
