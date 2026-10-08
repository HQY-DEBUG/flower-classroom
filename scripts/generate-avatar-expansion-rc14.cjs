'use strict';
/**
 * Add original portraits 41–120 without rewriting the original forty PNGs.
 * Run: node scripts/generate-avatar-expansion-rc14.cjs
 * Build-only: Python 3, Pillow, system librsvg/Cairo and Noto Sans CJK.
 * Assets are lossless opaque RGB PNGs, 384×384, from 2× SVG supersampling.
 * Runtime and original PetArt are never imported, edited or regenerated.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {entries}=require('./avatar-expansion-art.cjs');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'assets/avatar-defaults');
const evidence=path.join(root,'artifacts/avatar-expansion-rc14');
const original=JSON.parse(fs.readFileSync(path.join(root,'artifacts/avatar-defaults/manifest.json'),'utf8'));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const old=original.files.map(f=>({...f,group:'original',index:Number(f.fileName.split('-')[0])}));
if(old.length!==40)throw new Error('Expected original40 manifest');
for(const f of old)if(sha(fs.readFileSync(path.join(output,f.fileName)))!==f.sha256)throw new Error(`Original PNG differs from baseline: ${f.fileName}`);
fs.mkdirSync(evidence,{recursive:true});
const mix=(a,b,t)=>'#'+[1,3,5].map(i=>Math.round(parseInt(a.slice(i,i+2),16)*(1-t)+parseInt(b.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');
for(const e of entries){
 const p=e.palette;
 const bg=mix(p.fur,'#FFFFFF',.80),ring=mix(p.fur,'#FFFFFF',.47);
 const backdrop=`<rect width="240" height="240" fill="${mix(p.light,'#FFFFFF',.5)}"/><circle cx="120" cy="120" r="111" fill="${bg}"/><circle cx="120" cy="120" r="102" fill="none" stroke="${ring}" stroke-width="1.4" stroke-dasharray="2 7"/><circle cx="51" cy="61" r="16" fill="#FFFFFF" opacity=".4"/><circle cx="190" cy="148" r="22" fill="#FFFFFF" opacity=".32"/><path d="M32 105 34 110 39 112 34 114 32 119 30 114 25 112 30 110Z M201 72 203 77 208 79 203 81 201 86 199 81 194 79 199 77Z" fill="${p.accent}"/><circle cx="44" cy="158" r="3" fill="${p.accent}"/>`;
 e.svg=`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><title>${e.name} · 花伴课堂原创头像</title><defs><clipPath id="badge"><circle cx="120" cy="120" r="111"/></clipPath></defs>${backdrop}<g clip-path="url(#badge)">${e.body}</g>${e.head}</svg>`;
 fs.writeFileSync(path.join(evidence,`${e.index}-${e.id}.svg`),e.svg);
}
const python=String.raw`
import ctypes as C, ctypes.util, io, json, sys, hashlib
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageStat
rsvg=C.CDLL(ctypes.util.find_library('rsvg-2')); cairo=C.CDLL(ctypes.util.find_library('cairo')); obj=C.CDLL(ctypes.util.find_library('gobject-2.0'))
rsvg.rsvg_handle_new_from_data.argtypes=[C.c_char_p,C.c_size_t,C.c_void_p];rsvg.rsvg_handle_new_from_data.restype=C.c_void_p
rsvg.rsvg_handle_render_cairo.argtypes=[C.c_void_p,C.c_void_p];rsvg.rsvg_handle_render_cairo.restype=C.c_int
cairo.cairo_image_surface_create.argtypes=[C.c_int,C.c_int,C.c_int];cairo.cairo_image_surface_create.restype=C.c_void_p
cairo.cairo_create.argtypes=[C.c_void_p];cairo.cairo_create.restype=C.c_void_p
cairo.cairo_scale.argtypes=[C.c_void_p,C.c_double,C.c_double]
cairo.cairo_destroy.argtypes=[C.c_void_p];cairo.cairo_surface_destroy.argtypes=[C.c_void_p];obj.g_object_unref.argtypes=[C.c_void_p]
writer=C.CFUNCTYPE(C.c_int,C.c_void_p,C.POINTER(C.c_ubyte),C.c_uint)
cairo.cairo_surface_write_to_png_stream.argtypes=[C.c_void_p,writer,C.c_void_p]
def render(svg,size=768):
 data=svg.encode();handle=rsvg.rsvg_handle_new_from_data(data,len(data),None)
 if not handle:raise RuntimeError('SVG parse failed')
 surface=cairo.cairo_image_surface_create(0,size,size);ctx=cairo.cairo_create(surface);cairo.cairo_scale(ctx,size/240,size/240)
 if not rsvg.rsvg_handle_render_cairo(handle,ctx):raise RuntimeError('SVG render failed')
 buf=bytearray()
 @writer
 def write(_,chunk,length):buf.extend(C.string_at(chunk,length));return 0
 if cairo.cairo_surface_write_to_png_stream(surface,write,None):raise RuntimeError('PNG encode failed')
 cairo.cairo_destroy(ctx);cairo.cairo_surface_destroy(surface);obj.g_object_unref(handle)
 return Image.open(io.BytesIO(buf)).convert('RGBA')
job=json.load(sys.stdin);out=Path(job['output']);ev=Path(job['evidence']);checks=[]
for item in job['entries']:
 im=render(item['svg']).resize((384,384),Image.Resampling.LANCZOS)
 assert im.getchannel('A').getextrema()==(255,255),item['fileName']
 rgb=im.convert('RGB');rgb.save(out/item['fileName'],optimize=True,compress_level=9)
 assert Image.open(out/item['fileName']).convert('RGBA').tobytes()==im.tobytes(),'RGB encoding changed pixels'
 fg=render('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">'+item['head']+'</svg>',480)
 bounds=[v/2 for v in fg.getchannel('A').getbbox()]
 assert bounds[0]>0 and bounds[1]>0 and bounds[2]<240 and bounds[3]<=240,(item['id'],bounds)
 checks.append({'fileName':item['fileName'],'size':[384,384],'mode':'RGB','alphaExtrema':[255,255],'headAndAccessoryBounds':bounds,'pixelSha256':hashlib.sha256(rgb.tobytes()).hexdigest(),'losslessEncode':True,'centerStdDev':[round(v,3) for v in ImageStat.Stat(rgb.crop((75,75,309,309))).stddev]})
all_items=job['old']+job['entries']
all_hashes=[]
for item in all_items:
 im=Image.open(out/item['fileName']).convert('RGBA')
 assert im.size==(384,384) and im.getchannel('A').getextrema()==(255,255)
 all_hashes.append(hashlib.sha256(im.tobytes()).hexdigest())
assert len(set(all_hashes))==120,'Duplicate decoded pixels'
fontpath='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';boldpath='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
fonts={s:ImageFont.truetype(fontpath,s) for s in [12,13,15,17,20,24]};bold={s:ImageFont.truetype(boldpath,s) for s in [16,17,24,36]}
def sheet(items,name,title,subtitle,cols=10):
 margin=30;gap=12;cw=184;ch=223;top=138;rows=(len(items)+cols-1)//cols
 w=margin*2+cols*cw+(cols-1)*gap;h=top+rows*ch+(rows-1)*gap+51
 im=Image.new('RGB',(w,h),'#F4F6F1');d=ImageDraw.Draw(im)
 d.text((margin,22),title,font=bold[36],fill='#35534C')
 d.text((margin,77),subtitle,font=fonts[20],fill='#627C70')
 d.text((margin,108),'384 × 384 PNG · 原创几何绘制 · 可按编号或中文名查找',font=fonts[15],fill='#71897E')
 for n,item in enumerate(items):
  x=margin+(n%cols)*(cw+gap);y=top+(n//cols)*(ch+gap)
  d.rounded_rectangle((x,y,x+cw,y+ch),radius=14,fill='#FFFFFF',outline='#DCE5DB')
  asset=Image.open(out/item['fileName']).convert('RGB').resize((166,166),Image.Resampling.LANCZOS);im.paste(asset,(x+9,y+7))
  title=item['fileName'][:-4].replace('-',' ',1);tw=d.textlength(title,font=bold[16]);assert tw<=cw-8,(title,tw)
  d.text((x+(cw-tw)/2,y+179),title,font=bold[16],fill='#35534C')
  role=item['role'];rw=d.textlength(role,font=fonts[12]);d.text((x+(cw-rw)/2,y+204),role,font=fonts[12],fill='#74867D')
 d.text((margin,h-29),'花伴课堂 RC14 · 原有 40 个头像保持原文件 · 新增 80 个不同角色',font=fonts[15],fill='#768B80')
 im.save(ev/name,optimize=True)
 return {'fileName':name,'size':[w,h],'count':len(items)}
sheets=[sheet(all_items,'01-全部120头像总览.png','花伴课堂 · 120 位原创卡通伙伴','原有经典 40 + 新增野趣 24 / 海空 12 / 机甲 12 / 远古 12 / 人物 20'),sheet(job['entries'],'02-新增80头像总览.png','花伴课堂 · 新增 80 位伙伴','不同物种、轮廓与装备，编号 41–120，全部采用原有温和描边风格')]
for group,title in [('wildlife','野趣24'),('ocean','海空12'),('mech','机甲12'),('ancient','远古12'),('human','人物20')]:
 items=[e for e in job['entries'] if e['group']==group];sheets.append(sheet(items,'03-'+title+'详情.png','花伴课堂 · '+title+' 位原创伙伴','独立角色几何设计 · 同一头像文件夹',cols=6 if group!='human' else 5))
im=Image.new('RGB',(1220,1140),'#F4F6F1');d=ImageDraw.Draw(im);d.text((24,14),'48 px 实际头像尺寸 · 全部 120 位',font=bold[24],fill='#35534C')
for i,item in enumerate(all_items):
 x=24+(i%12)*99;y=64+(i//12)*103
 asset=Image.open(out/item['fileName']).convert('RGB').resize((48,48),Image.Resampling.LANCZOS);im.paste(asset,(x,y));d.text((x+53,y+14),str(item['index']).zfill(2),font=fonts[13],fill='#627C70')
im.save(ev/'04-全部120实际48像素.png',optimize=True)
print(json.dumps({'newImages':checks,'allDecodedPixelsUnique':120,'allOpaque':True,'contactSheets':sheets},ensure_ascii=False))
`;
const rendered=spawnSync(process.env.PYTHON||'python3',['-c',python],{input:JSON.stringify({entries,old,output,evidence}),encoding:'utf8',maxBuffer:16*1024*1024});
if(rendered.status!==0)throw new Error(rendered.stderr||rendered.error?.message||'Avatar render failed');
const qa=JSON.parse(rendered.stdout);
const files=old.concat(entries.map(({id,name,role,group,fileName,index})=>({id,name,role,group,fileName,index,width:384,height:384,sha256:sha(fs.readFileSync(path.join(output,fileName))),bytes:fs.statSync(path.join(output,fileName)).size})));
for(const f of old)if(sha(fs.readFileSync(path.join(output,f.fileName)))!==f.sha256)throw new Error(`Original PNG changed: ${f.fileName}`);
const actual=fs.readdirSync(output).filter(f=>/\.png$/i.test(f));
if(actual.length!==120||actual.some(f=>!files.some(e=>e.fileName===f)))throw new Error('Expected exactly120 approved PNG filenames');
const manifest={schema:2,collection:'花伴课堂原创卡通学生头像',license:'MIT',generation:'Original code-native vector portraits. Original40 preserved byte-for-byte; eighty distinct new characters, no photographs or external artwork.',count:120,width:384,height:384,originalCount:40,newCount:80,files};
fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(evidence,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
fs.writeFileSync(path.join(evidence,'pixel-qa.json'),JSON.stringify(qa,null,2)+'\n');
fs.writeFileSync(path.join(evidence,'SHA256SUMS.txt'),files.map(f=>`${f.sha256}  ${f.fileName}`).join('\n')+'\n');
const summary={count:120,original40Unchanged:true,newCount:80,oldBytes:old.reduce((n,f)=>n+f.bytes,0),newBytes:files.slice(40).reduce((n,f)=>n+f.bytes,0),totalBytes:files.reduce((n,f)=>n+f.bytes,0),manifestBytes:fs.statSync(path.join(output,'manifest.json')).size,output,evidence};
fs.writeFileSync(path.join(evidence,'summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
