'use strict';
/**
 * Original 花伴课堂 student portrait badges, 384 × 384 PNG.
 * Run: node scripts/generate-avatar-defaults.cjs
 * Build-only requirements: Python 3 + Pillow + system librsvg/Cairo.
 * No runtime dependencies, downloads, third-party art, photos, or fonts in PNGs.
 * Reuses the project's original character heads through an isolated in-memory
 * adapter; src/pet-art.js and all 280 public PetArt.render results stay intact.
 * The user avatar directory is never touched by this generator.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'assets/avatar-defaults');
const evidence = path.join(root, 'artifacts/avatar-defaults');
const sourcePath = path.join(root, 'src/pet-art.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const PetArt = require(sourcePath);
const sourceSha256 = sha256(source);
const petHashes = Object.fromEntries(Object.keys(PetArt.names).flatMap(id => Array.from({length: 7}, (_, i) => [`${id}/${i + 1}`, sha256(PetArt.render(id, i + 1))])));
const anchor = 'const api = Object.freeze({ render, names, stages });';
if (!source.includes(anchor)) throw new Error('PetArt adapter anchor changed; inspect the original heads before regenerating.');
const context = { module: { exports: {} } };
vm.runInNewContext(source.replace(anchor, 'const api = Object.freeze({ render, names, stages, head, palettes });'), context, {timeout: 1000});
const art = context.module.exports;
const CREAM = '#FFFDF5';
const stroke = (p, width = 2.8) => `stroke="${p.ink}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"`;
const shape = (d, fill, p, w) => `<path d="${d}" fill="${fill}" ${stroke(p, w)}/>`;
const line = (d, fill, width = 2.8) => `<path d="${d}" fill="none" stroke="${fill}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const circle = (x, y, r, fill, extra = '') => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" ${extra}/>`;
const star = (x, y, r, fill, p) => `<path d="M0 -10 3 -3 10 -2 5 3 6 10 0 6 -6 10 -5 3 -10 -2 -3 -3Z" transform="translate(${x} ${y}) scale(${r / 10})" fill="${fill}" ${p ? stroke(p, 1.8) : ''}/>`;
const leaf = (x, y, fill, p, rotate = 0) => `<g transform="translate(${x} ${y}) rotate(${rotate})">${shape('M0 6Q-14 -10 3 -18Q16 -3 0 6Z', fill, p, 1.8)}${line('M0 5 1 -10', p.light, 1.8)}</g>`;
const mix = (a, b, t) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
const descriptors = [
  ['owl','星星猫头鹰','星光读书会','scholar'], ['fox','暖暖小狐狸','森林探险队','scarf'],
  ['bunny','软软兔','花园手作家','bow'], ['cat','薄荷猫','绿叶观察员','leaf'],
  ['penguin','围巾企鹅','冰原旅行家','scarf'], ['panda','竹叶熊猫','自然守护员','leaf'],
  ['bear','蜂蜜小熊','暖阳收藏家','vest'], ['dog','饼干小狗','友谊邮递员','scarf'],
  ['deer','森林小鹿','森林向导','leaf'], ['squirrel','橡果松鼠','种子收藏家','vest'],
  ['hedgehog','栗子刺猬','秋日读书家','scholar'], ['raccoon','月光浣熊','月光侦察员','vest'],
  ['koala','云朵考拉','云朵漫游者','bow'], ['elephant','泡泡小象','泡泡观察员','vest'],
  ['lion','太阳小狮','阳光领队','scarf'], ['tiger','橙纹小虎','元气运动员','vest'],
  ['dragon','芽芽小龙','新芽守护员','leaf'], ['unicorn','星愿独角兽','星愿编织者','bow'],
  ['otter','溪流海獭','溪流探险家','scarf'], ['seal','雪团海豹','雪花旅行家','bow'],
  ['robot','星核机甲','星核探索员','mech'], ['rover','岩虎机车','岩地巡游员','mech'],
  ['mechcrab','铁钳蟹','珊瑚工程师','mech'], ['mechbeetle','锹甲先锋','绿野工程师','mech'],
  ['mechdragonfly','旋翼蜻蜓','旋翼观察员','mech'], ['rex','炎石霸王龙','远古冒险家','scarf'],
  ['raptor','疾风迅猛龙','疾风侦察员','vest'], ['triceratops','岩盾三角龙','岩盾护卫员','vest'],
  ['stegosaurus','棱叶剑龙','棱叶采集员','leaf'], ['ankylosaurus','锤尾甲龙','岩洞探险家','vest'],
  ['pteranodon','长空翼龙','天空旅行家','scarf'], ['mammoth','雪岭猛犸','雪岭领航员','scarf'],
  ['rhino','岩角犀牛','山野守护员','vest'], ['gorilla','岩臂大猩猩','勇气收藏家','vest'],
  ['wolf','霜影狼','霜林寻路员','scarf'], ['boar','赤鬃野猪','橡林探险家','vest'],
  ['eagle','峰翼鹰','高峰观察员','scarf'], ['shark','深蓝鲨','蓝海探险家','vest'],
  ['orca','逐浪虎鲸','逐浪领航员','scarf'], ['phoenix','曦羽凤凰','晨光守护员','bow']
];
function shoulders(p, kind) {
  let out = shape('M81 164Q60 169 47 194L35 246H206L194 194Q181 169 159 164Z', p.accent, p);
  out += shape('M92 164Q120 156 148 164L150 240H89Z', p.light, p, 2.2);
  out += line('M61 208 55 230M181 208 187 230', mix(p.accent, p.ink, .3), 2.5);
  if (kind === 'scarf') {
    out += shape('M93 165 88 198 105 201 113 177Z', p.dark, p, 2.2);
    out += shape('M89 164Q120 157 153 166L150 181Q117 191 90 179Z', p.accent, p, 2.2);
    out += line('M98 169Q120 176 145 171M94 190 106 194', p.light, 2.4);
    out += star(153, 211, 7, CREAM, p);
  } else if (kind === 'bow') {
    out += shape('M120 182Q99 165 92 178L96 196Q107 198 120 186Q133 199 145 195L149 177Q137 167 120 182Z', p.dark, p, 2.2);
    out += circle(120, 183, 6, p.accent, stroke(p, 2));
    out += circle(120, 207, 3, p.dark) + circle(120, 221, 3, p.dark);
    out += star(160, 213, 8, CREAM, p);
  } else if (kind === 'leaf') {
    out += shape('M92 168 119 188 101 198 83 178ZM148 168 121 188 139 198 157 178Z', p.light, p, 2.2);
    out += line('M120 189V238', p.dark, 2.4);
    out += leaf(159, 213, '#8FBE94', p, 25);
    out += circle(120, 207, 2.4, p.ink) + circle(120, 222, 2.4, p.ink);
  } else if (kind === 'mech') {
    out = shape('M79 163 58 179 42 214 60 240H182L201 214 181 179 159 163Z', p.fur, p);
    out += shape('M95 170H145L159 204 147 233H93L81 204Z', p.dark, p, 2.5);
    out += shape('M103 186H137L147 203 136 219H104L93 203Z', p.light, p, 2.1);
    out += star(120, 202, 10, p.accent, p);
    out += circle(70, 199, 7, p.light, stroke(p, 2)) + circle(171, 199, 7, p.light, stroke(p, 2));
    out += line('M66 220H79M162 220H176', p.accent, 4);
  } else if (kind === 'scholar') {
    out += shape('M92 167 120 187 148 167 142 192 127 190 123 225 112 214 116 190 99 193Z', p.dark, p, 2.2);
    out += star(159, 211, 8, CREAM, p);
  } else {
    out += shape('M92 167 87 193 106 207 118 183ZM148 167 154 193 136 207 122 183Z', p.light, p, 2.2);
    out += line('M120 186V237', p.dark, 2.4);
    out += shape('M153 209H173V223Q163 231 153 223Z', p.dark, p, 1.8);
    out += star(163, 217, 5, p.light);
    out += circle(120, 211, 2.6, p.ink) + circle(120, 226, 2.6, p.ink);
  }
  return out;
}
function head(id, p) {
  let result = art.head(id, p, 'happy');
  // The original elephant draws its trunk in the scene foreground, after clothes.
  if (id === 'elephant') result += shape('M111 122Q111 134 112 143Q114 155 128 158Q145 161 151 147Q155 138 148 135Q142 133 140 140Q139 147 133 147Q125 147 127 136L130 122', p.fur, p) + line('M113 132 128 133M115 140 126 141', p.dark, 2.2);
  return result;
}
const entries = descriptors.map(([id, name, role, outfit], i) => ({id, name, role, outfit, fileName: `${String(i + 1).padStart(2, '0')}-${name}.png`, palette: art.palettes[id], head: head(id, art.palettes[id])}));
if (entries.length !== 40 || new Set(entries.map(e => e.fileName)).size !== 40) throw new Error('The portrait collection must contain exactly 40 unique files.');
fs.mkdirSync(output, {recursive: true}); fs.mkdirSync(evidence, {recursive: true});
const python = String.raw`
import ctypes as C, ctypes.util, io, json, sys
from PIL import Image, ImageDraw, ImageFont
rsvg=C.CDLL(ctypes.util.find_library('rsvg-2')); cairo=C.CDLL(ctypes.util.find_library('cairo')); obj=C.CDLL(ctypes.util.find_library('gobject-2.0'))
rsvg.rsvg_handle_new_from_data.argtypes=[C.c_char_p,C.c_size_t,C.c_void_p]; rsvg.rsvg_handle_new_from_data.restype=C.c_void_p
rsvg.rsvg_handle_render_cairo.argtypes=[C.c_void_p,C.c_void_p]; rsvg.rsvg_handle_render_cairo.restype=C.c_int
cairo.cairo_image_surface_create.argtypes=[C.c_int,C.c_int,C.c_int]; cairo.cairo_image_surface_create.restype=C.c_void_p
cairo.cairo_create.argtypes=[C.c_void_p]; cairo.cairo_create.restype=C.c_void_p
cairo.cairo_scale.argtypes=[C.c_void_p,C.c_double,C.c_double]
cairo.cairo_destroy.argtypes=[C.c_void_p]; cairo.cairo_surface_destroy.argtypes=[C.c_void_p]; obj.g_object_unref.argtypes=[C.c_void_p]
writer=C.CFUNCTYPE(C.c_int,C.c_void_p,C.POINTER(C.c_ubyte),C.c_uint)
cairo.cairo_surface_write_to_png_stream.argtypes=[C.c_void_p,writer,C.c_void_p]
def render(svg, size):
 data=svg.encode(); handle=rsvg.rsvg_handle_new_from_data(data,len(data),None)
 if not handle: raise RuntimeError('SVG parse failed')
 surface=cairo.cairo_image_surface_create(0,size,size); ctx=cairo.cairo_create(surface); cairo.cairo_scale(ctx,size/240,size/240)
 if not rsvg.rsvg_handle_render_cairo(handle,ctx): raise RuntimeError('SVG render failed')
 buf=bytearray()
 @writer
 def write(_,chunk,length): buf.extend(C.string_at(chunk,length)); return 0
 if cairo.cairo_surface_write_to_png_stream(surface,write,None): raise RuntimeError('PNG encode failed')
 cairo.cairo_destroy(ctx); cairo.cairo_surface_destroy(surface); obj.g_object_unref(handle)
 return Image.open(io.BytesIO(buf)).convert('RGBA')
job=json.load(sys.stdin)
if job['mode']=='bounds':
 result={}
 for item in job['entries']:
  svg='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">'+item['head']+'</svg>'
  result[item['id']]=[v/3 for v in render(svg,720).getchannel('A').getbbox()]
 print(json.dumps(result)); sys.exit(0)
checks=[]
for item in job['entries']:
 image=render(item['svg'],768).resize((384,384),Image.Resampling.LANCZOS)
 # Fully opaque badges ensure consistent appearance in square and round UI masks.
 assert image.getchannel('A').getextrema()==(255,255)
 image.save(job['output']+'/'+item['fileName'],optimize=True,compress_level=9)
 checks.append({'id':item['id'],'size':list(image.size),'opaque':True,'headBounds':item['headBounds'],'headMargin':round(min(item['headBounds'][0],item['headBounds'][1],240-item['headBounds'][2],240-item['headBounds'][3]),2)})
fontpath='/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
boldpath='/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
try:
 fonts={s:ImageFont.truetype(fontpath,s) for s in [16,18,22,26,32,44]}; bold={s:ImageFont.truetype(boldpath,s) for s in [22,26,44]}
except OSError:
 raise RuntimeError('Contact sheet labels require Noto Sans CJK SC. PNG assets were generated, but visual QA is incomplete.')
def sheet(items, filename, label):
 cols=5; rows=(len(items)+cols-1)//cols; margin=42; gap=20; cardw=236; cardh=304
 width=margin*2+cols*cardw+(cols-1)*gap; height=182+rows*cardh+(rows-1)*gap+64
 im=Image.new('RGB',(width,height),'#F4F6F1'); d=ImageDraw.Draw(im)
 d.text((margin,28),'花伴课堂 · 原创卡通头像',font=bold[44],fill='#35534C')
 d.text((margin,92),'40 位伙伴  /  384 × 384 PNG  /  同一头像文件夹',font=fonts[22],fill='#627C70')
 d.text((margin,131),label,font=fonts[18],fill='#71897E')
 bounds=[]
 for n,item in enumerate(items):
  x=margin+(n%cols)*(cardw+gap); y=182+(n//cols)*(cardh+gap)
  d.rounded_rectangle((x,y,x+cardw,y+cardh),radius=20,fill='#FFFFFF',outline='#DCE5DB',width=1)
  asset=Image.open(job['output']+'/'+item['fileName']).convert('RGB').resize((212,212),Image.Resampling.LANCZOS)
  im.paste(asset,(x+12,y+10))
  title=item['fileName'].removesuffix('.png').replace('-','  ',1)
  bbox=d.textbbox((0,0),title,font=bold[22]); textw=bbox[2]-bbox[0]
  assert textw<=cardw-12, (title,textw)
  d.text((x+(cardw-textw)/2,y+227),title,font=bold[22],fill='#35534C')
  role=item['role']; rw=d.textlength(role,font=fonts[16])
  assert rw<=cardw-12
  d.text((x+(cardw-rw)/2,y+265),role,font=fonts[16],fill='#74867D')
  bounds.append({'fileName':item['fileName'],'titleWidth':textw,'cardWidth':cardw})
 d.text((margin,height-39),'本项目原创几何绘制 · 大头像构图 · 无照片 / 无外部素材',font=fonts[18],fill='#768B80')
 im.save(job['evidence']+'/'+filename,optimize=True)
 return {'fileName':filename,'size':list(im.size),'count':len(items),'labels':bounds}
sheets=[sheet(job['entries'],'01-全部40头像总览.png','经典伙伴 × 20  +  冒险伙伴 × 20'),sheet(job['entries'][:20],'02-经典20头像.png','经典伙伴 · 星星、森林与云朵'),sheet(job['entries'][20:],'03-冒险20头像.png','冒险伙伴 · 机甲、远古、山野与海空')]
# Native display-size check: faces must remain distinct at typical 48px/64px UI sizes.
im=Image.new('RGB',(920,450),'#F4F6F1'); d=ImageDraw.Draw(im)
d.text((22,16),'48 px 实际头像尺寸预览',font=bold[26],fill='#35534C')
for i,item in enumerate(job['entries']):
 x=22+(i%10)*90; y=68+(i//10)*91
 small=Image.open(job['output']+'/'+item['fileName']).convert('RGB').resize((48,48),Image.Resampling.LANCZOS)
 im.paste(small,(x,y)); d.text((x+53,y+12),str(i+1).zfill(2),font=fonts[16],fill='#627C70')
im.save(job['evidence']+'/04-实际尺寸预览.png',optimize=True)
im64=Image.new('RGB',(1120,530),'#F4F6F1'); d64=ImageDraw.Draw(im64)
d64.text((22,16),'64 px 实际头像尺寸预览',font=bold[26],fill='#35534C')
for i,item in enumerate(job['entries']):
 x=22+(i%10)*110; y=72+(i//10)*110
 small=Image.open(job['output']+'/'+item['fileName']).convert('RGB').resize((64,64),Image.Resampling.LANCZOS)
 im64.paste(small,(x,y)); d64.text((x+69,y+20),str(i+1).zfill(2),font=fonts[16],fill='#627C70')
im64.save(job['evidence']+'/05-64像素预览.png',optimize=True)
print(json.dumps({'images':checks,'contactSheets':sheets},ensure_ascii=False))
`;
function pythonJob(job) {
  const result = spawnSync(process.env.PYTHON || 'python3', ['-c', python], {input: JSON.stringify(job), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Avatar render failed');
  return JSON.parse(result.stdout);
}
const bounds = pythonJob({mode: 'bounds', entries});
for (const entry of entries) {
  const p = entry.palette, b = bounds[entry.id];
  // Scale only the head, retaining horns, antlers, whiskers and trunk in full.
  const scale = Math.min(1.52, 174 / (b[2] - b[0]), 155 / (b[3] - b[1]));
  const dx = 120 - (b[0] + b[2]) * scale / 2, dy = 184 - b[3] * scale;
  entry.headBounds = [b[0] * scale + dx, b[1] * scale + dy, b[2] * scale + dx, b[3] * scale + dy].map(v => +v.toFixed(3));
  const bg = mix(p.fur, '#FFFFFF', .78), ring = mix(p.fur, '#FFFFFF', .48);
  let behind = `<rect width="240" height="240" fill="${mix(p.light, '#FFFFFF', .5)}"/>`;
  behind += circle(120, 120, 111, bg) + circle(120, 120, 102, 'none', `stroke="${ring}" stroke-width="1.4" stroke-dasharray="2 7"`);
  behind += circle(50, 60, 16, '#FFFFFF', 'opacity=".4"') + circle(190, 148, 22, '#FFFFFF', 'opacity=".32"');
  behind += star(33, 108, 5, p.accent) + star(198, 72, 6, p.accent) + circle(194, 96, 3, p.dark, 'opacity=".35"') + circle(44, 158, 3, p.accent);
  const body = `<g clip-path="url(#badge)">${shoulders(p, entry.outfit)}</g>`;
  const face = `<g transform="translate(${dx.toFixed(6)} ${dy.toFixed(6)}) scale(${scale.toFixed(6)})">${entry.head}</g>`;
  entry.svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><title>${entry.name} · 原创学生头像</title><defs><clipPath id="badge"><circle cx="120" cy="120" r="111"/></clipPath></defs>${behind}${body}${face}</svg>`;
  fs.writeFileSync(path.join(evidence, entry.id + '.svg'), entry.svg);
}
const qa = pythonJob({mode: 'render', entries, output, evidence});
const files = entries.map(({id, name, role, outfit, fileName}) => ({id, name, role, outfit, fileName, width: 384, height: 384, sha256: sha256(fs.readFileSync(path.join(output, fileName))), bytes: fs.statSync(path.join(output, fileName)).size}));
if (new Set(files.map(file => file.sha256)).size !== 40) throw new Error('Duplicate avatar pixels detected.');
if (qa.images.some(image => image.headMargin < 20)) throw new Error('A portrait head is too close to the image edge.');
const currentFiles = fs.readdirSync(output).filter(name => /\.png$/i.test(name));
if (currentFiles.length !== 40 || currentFiles.some(name => !files.some(f => f.fileName === name))) throw new Error('Unexpected PNGs in bundled avatar defaults; inspect rather than deleting files automatically.');
if (sourceSha256 !== sha256(fs.readFileSync(sourcePath))) throw new Error('Original PetArt source changed during avatar generation.');
for (const [key, hash] of Object.entries(petHashes)) {
  const [id, stage] = key.split('/');
  if (hash !== sha256(PetArt.render(id, Number(stage)))) throw new Error(`PetArt output changed: ${key}`);
}
const manifest = {schema: 1, collection: '花伴课堂原创卡通学生头像', license: 'MIT', generation: 'Original project geometry, composed as dedicated portrait badges. No photographs or external artwork.', count: files.length, width: 384, height: 384, sourceSha256, petIllustrationsUnchanged: Object.keys(petHashes).length, files};
fs.writeFileSync(path.join(evidence, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(evidence, 'pixel-qa.json'), JSON.stringify(qa, null, 2) + '\n');
fs.writeFileSync(path.join(evidence, 'pet-source-baseline.json'), JSON.stringify({sourceSha256, hashes: petHashes}, null, 2) + '\n');
fs.writeFileSync(path.join(evidence, 'SHA256SUMS.txt'), files.map(f => `${f.sha256}  ${f.fileName}`).join('\n') + '\n');
console.log(JSON.stringify({count: files.length, output, contactSheet: path.join(evidence, '01-全部40头像总览.png'), manifest: path.join(evidence, 'manifest.json'), petIllustrationsUnchanged: Object.keys(petHashes).length, totalBytes: files.reduce((n, f) => n + f.bytes, 0)}, null, 2));
