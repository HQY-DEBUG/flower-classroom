'use strict';
const {ensureToolControl,visibleControl,nativeClick}=require('./qa-tool-control.cjs');
// Presentation screenshots only. A dedicated synthetic data directory never touches the user's classroom.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),data=path.join(root,'.qa-pet-showcase'),out=path.join(root,'artifacts/showcase');
fs.mkdirSync(data,{recursive:true});fs.mkdirSync(out,{recursive:true});
const {createInitialState,applyAction}=require('../src/core.cjs');let state=createInitialState();state.students=state.students.slice(0,8);state.students.forEach((s,i)=>s.pet=['penguin','panda','elephant','dragon','unicorn','otter','seal','deer'][i]);state.settings.petStep=5;state.settings.className='阳光示例班 · 全部为虚构同学';
const values=[4,7,13,16,22,25,30,2];for(let i=0;i<8;i++)state=applyAction(state,{type:'score',ids:[state.students[i].id],delta:values[i],reason:'合成展示数据'});
fs.writeFileSync(path.join(data,'classroom.json'),JSON.stringify(state));
process.env.FLOWER_HEADLESS_TEST='1';process.env.FLOWER_DATA_DIR=data;app.disableHardwareAcceleration();
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),js=(w,s)=>w.webContents.executeJavaScript(s,true);
const click=async(w,s)=>{s=await ensureToolControl(w,s);await nativeClick(w,await visibleControl(w,s));};
async function shot(w,name){await sleep(650);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());}
require('../src/main.cjs');
app.whenReady().then(async()=>{try{await sleep(600);const main=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='main');main.setSize(1440,1000);await sleep(200);
 await click(main,'[data-page="pets"]');await shot(main,'01-宠物花园');
 await click(main,'[data-do="pet-catalog"]');await shot(main,'09-40种宠物总览界面');await click(main,'[data-do="modal-close"]');
 await click(main,'[data-do="pet-detail"]');await shot(main,'02-个人成长');
 await click(main,'[data-do="edit-student"]');await shot(main,'10-搜索图卡选择伙伴');await click(main,'[data-do="modal-close"]');
 await click(main,'[data-do="pet-album"]');await click(main,'.album-tile[data-level="4"]');await shot(main,'03-七段进化图鉴');await click(main,'[data-do="modal-close"]');
 await click(main,'[data-do="pet-reward"]');await shot(main,'04-课堂鼓励原因');await click(main,'[data-do="pet-reason"][data-index="0"]');await shot(main,'05-进化成功');await click(main,'[data-do="pet-feedback-close"]');
 await js(main,`classroom.window({command:'open',role:'pet'})`);await sleep(500);const pet=BrowserWindow.getAllWindows().find(w=>w.flowerRole==='pet');pet.setSize(340,780);await shot(pet,'06-悬浮宠物侧栏');
 await click(pet,'[data-do="pet-reward"]');await shot(pet,'07-悬浮侧栏鼓励');await click(pet,'[data-do="pet-reason"][data-index="3"]');await shot(pet,'08-悬浮侧栏进化');
 console.log('SHOWCASE_DONE synthetic screenshots',out);app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
setTimeout(()=>app.exit(2),30000);
