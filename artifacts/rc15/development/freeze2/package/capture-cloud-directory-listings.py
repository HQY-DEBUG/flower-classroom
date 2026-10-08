from pathlib import Path
from playwright.sync_api import sync_playwright
import hashlib,json
base=Path(__file__).resolve().parent
root=base/'cloud-pristine-extraction'
assert (root/'花伴课堂.exe').is_file()
records=[]
with sync_playwright() as playwright:
 browser=playwright.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-gpu','--disable-background-networking','--disable-extensions','--disable-sync'])
 context=browser.new_context(viewport={'width':1540,'height':1050},device_scale_factor=1,locale='zh-CN')
 page=context.new_page()
 for name,directory in [('cloud-directory-root-before-first-launch',root),('cloud-directory-120-avatars-before-first-launch',root/'头像')]:
  page.goto(directory.as_uri()+'/',wait_until='load')
  page.wait_for_selector('table')
  text=page.locator('body').inner_text()
  if directory==root:
   for required in ['配置.txt','计分卡片.xlsx','头像','数据','备份','花伴课堂.exe']: assert required in text,required
  else:
   assert len(list(directory.glob('*.png')))==120
   for file in directory.glob('*.png'): assert file.name in text,file.name
  file=base/(name+'.png')
  page.screenshot(path=str(file),full_page=True)
  (base/(name+'.txt')).write_text(text,encoding='utf-8')
  records.append({'file':str(file),'sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'url':page.url,'title':page.title(),'imageLabel':'Cloud Chromium actual file directory listing; before first application launch','source':'Chromium file:// built-in directory listing, without content or image editing'})
 browser.close()
(base/'cloud-directory-screenshots.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(records,ensure_ascii=False,indent=2))
