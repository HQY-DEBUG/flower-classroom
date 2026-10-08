'use strict';
// Pure illustration preview: no classroom state, user data, app windows or network.
// node_modules/.bin/electron --no-sandbox --ozone-platform=headless --disable-gpu scripts/capture-adventure-pets.cjs
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PetArt = require('../src/pet-art.js');
const out = path.resolve(__dirname, '../artifacts/adventure-pets');
app.setPath('userData', path.join(require('node:os').tmpdir(), 'flower-adventure-preview-profile'));
const ids = Object.keys(PetArt.names).slice(20);
const details = ['方形能量胸甲 · 关节机械臂', '四轮履带 · 越野车身', '六足支架 · 双机械钳', '分瓣甲壳 · 双角铲', '四片旋翼 · 分节尾身', '大圆吻 · 短前爪', '后掠羽冠 · 长尾弯爪', '三根角 · 扇形骨盾', '棱叶背板 · 双尾刺', '铆钉背甲 · 锤形尾端', '长喙头冠 · 宽翼膜', '蓬松长毛 · 弯牙长鼻', '厚皮褶线 · 双角大吻', '宽肩巨臂 · 银灰面盘', '尖耳长吻 · 蓬松尾尖', '赤鬃短尾 · 圆鼻獠牙', '羽缘宽翼 · 钩形鹰喙', '三角背鳍 · 流线尾鳍', '浅色眼斑 · 扇形尾鳍', '火焰冠羽 · 三束长尾'];
fs.mkdirSync(out, { recursive: true });
const css = `*{box-sizing:border-box}body{margin:0;background:#f4f7f4;color:#304b49;font-family:"Noto Sans CJK SC","Microsoft YaHei",sans-serif;padding:42px}header{margin-bottom:24px}.eyebrow{font-size:15px;letter-spacing:3px;color:#78948b}h1{font-size:34px;margin:10px 0 8px}p{font-size:17px;color:#72827c;margin:6px 0}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:17px}.card{border:1px solid #dce6df;border-radius:24px;background:#fff;padding:9px 8px 17px;text-align:center}.card svg{width:210px;height:210px;display:block;margin:auto}.name{font-size:20px;font-weight:700}.detail{font-size:12px;color:#819088;margin-top:7px}.tag{display:inline-block;padding:5px 10px;font-size:12px;border-radius:9px;background:#edf4f0;color:#648278;margin-top:10px}.row{background:white;border:1px solid #dce6df;border-radius:20px;padding:13px 12px;margin-bottom:15px;display:grid;grid-template-columns:112px repeat(7,1fr);gap:4px;align-items:center}.row-title{padding-left:5px;font-weight:700;font-size:18px}.cell{text-align:center}.cell svg{width:160px;height:160px;display:block;margin:auto}.stage{font-size:12px;color:#72887e}.row-title small{font-size:11px;display:block;color:#8b9c94;font-weight:400;margin-top:8px}footer{margin-top:22px;color:#8d9d94;font-size:13px}`;
function doc(title, subtitle, body) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title><style>${css}</style><header><div class="eyebrow">花伴课堂 · 原创成长伙伴</div><h1>${title}</h1><p>${subtitle}</p></header>${body}<footer>新增伙伴设计预览 · 每位同学均可选择 · 原有20种伙伴保持原样 · 全部为本项目原创矢量绘制</footer></html>`;
}
function rows(group) {
  return group.map(id => `<div class="row"><div class="row-title">${PetArt.names[id]}<small>${id}</small></div>${Array.from({ length: 7 }, (_, i) => `<div class="cell">${PetArt.render(id, i + 1)}<div class="stage">${i + 1} · ${PetArt.stages[i]}</div></div>`).join('')}</div>`).join('');
}
const previews = [{ name: '01-新增20伙伴总览', width: 1420, height: 1370, html: doc('20位冒险伙伴，准备出发', '机甲、恐龙、山野与海空 · 20种全新轮廓 × 7段成长形态', `<div class="grid">${ids.map((id, i) => `<article class="card">${PetArt.render(id, 2)}<div class="name">${PetArt.names[id]}</div><div class="detail">${details[i]}</div><div class="tag">${i < 5 ? '机械探索' : i < 11 ? '远古探险' : i < 16 ? '山野伙伴' : '海空巡游'}</div></article>`).join('')}</div>`) }];
const examples = ['robot', 'mechcrab', 'triceratops', 'mammoth', 'orca', 'phoenix'];
previews.push({ name: '02-代表伙伴七阶段', width: 1450, height: 1490, html: doc('从破壳宝宝到星光守护', '6位代表伙伴的七段完整造型 · 姿态、装备和场景随成长变化', rows(examples)) });
for (let page = 0; page < 4; page++) previews.push({ name: `03-${page + 1}-全部新伙伴七阶段`, width: 1450, height: 1270, html: doc(`20位新伙伴 · 完整图鉴 ${page + 1}/4`, '每行同一伙伴 · 从左至右为第1至第7阶段', rows(ids.slice(page * 5, page * 5 + 5))) });
for (const id of ids) for (let stage = 1; stage <= 7; stage++) fs.writeFileSync(path.join(out, `${id}-${stage}.svg`), PetArt.render(id, stage));
for (const preview of previews) fs.writeFileSync(path.join(out, preview.name + '.html'), preview.html);
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const network = [];
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (/^https?:/i.test(details.url)) { network.push(details.url); callback({ cancel: true }); }
    else callback({});
  });
  const checks = [];
  try {
    for (const preview of previews) {
      const w = new BrowserWindow({ width: preview.width, height: preview.height, show: false, useContentSize: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, offscreen: true } });
      await w.loadFile(path.join(out, preview.name + '.html'));
      w.setContentSize(preview.width, preview.height);
      await w.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
      await new Promise(resolve => setTimeout(resolve, 400));
      const metrics = await w.webContents.executeJavaScript(`({height:document.documentElement.scrollHeight,svgCount:document.querySelectorAll('svg').length,overflow:[...document.querySelectorAll('svg')].flatMap(s=>{const b=s.getBBox();return b.x < -1 || b.y < -1 || b.x+b.width > 241 || b.y+b.height > 241 ? [{id:s.dataset.pet,stage:s.dataset.stage,x:b.x,y:b.y,width:b.width,height:b.height}] : []})})`);
      if (metrics.height > 6000) throw Error(preview.name + ' unexpected page height: ' + metrics.height);
      if (metrics.height > preview.height) {
        w.setContentSize(preview.width, metrics.height);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      fs.writeFileSync(path.join(out, preview.name + '.png'), (await w.webContents.capturePage()).toPNG());
      checks.push({ name: preview.name, ...metrics });
      w.destroy();
    }
    const hashes = Object.fromEntries(ids.flatMap(id => Array.from({ length: 7 }, (_, i) => [`${id}/${i + 1}`, crypto.createHash('sha256').update(PetArt.render(id, i + 1)).digest('hex')])));
    fs.writeFileSync(path.join(out, 'preview-verification.json'), JSON.stringify({ sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../src/pet-art.js'))).digest('hex'), species: ids.length, images: Object.keys(hashes).length, networkRequests: network, checks, hashes }, null, 2));
    console.log(JSON.stringify({ previews: checks, networkRequests: network }, null, 2));
    app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});
