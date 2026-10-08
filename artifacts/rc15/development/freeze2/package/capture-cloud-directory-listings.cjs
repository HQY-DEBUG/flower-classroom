'use strict';
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{pathToFileURL}=require('node:url'),{createHash}=require('node:crypto');
const base=__dirname,root=path.join(base,'cloud-pristine-extraction'),records=[];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'flower-cloud-listing-browser-'));
app.setPath('userData',temp);app.setPath('sessionData',temp);app.disableHardwareAcceleration();
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1540,height:1050,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,offscreen:true}});
 try {
  for(const [name,directory] of [['cloud-directory-root-before-first-launch',root],['cloud-directory-120-avatars-before-first-launch',path.join(root,'头像')]]) {
   const url='http://127.0.0.1:40897/'+(directory===root?'':encodeURIComponent('头像')+'/');
   await win.loadURL(url);
   const details=await win.webContents.executeJavaScript('({text:document.body.innerText,height:document.documentElement.scrollHeight,title:document.title})');
   const required=directory===root?['配置.txt','计分卡片.xlsx','头像','数据','备份','花伴课堂.exe']:fs.readdirSync(directory);
   for(const item of required)if(!details.text.includes(item))throw new Error('Directory listing is missing '+item);
   win.setContentSize(1540,Math.max(1050,details.height));
   await new Promise(resolve=>setTimeout(resolve,300));
   const file=path.join(base,name+'.png'),screenshot=await win.webContents.capturePage();fs.writeFileSync(file,screenshot.toPNG());
   fs.writeFileSync(path.join(base,name+'.txt'),details.text);
   records.push({file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex'),url,title:details.title,imageLabel:'Cloud Electron Chromium actual file directory listing; before first application launch',source:'Python standard-library HTTP server actual directory listing rendered by cloud Electron Chromium, without listing/content/image editing',dimensions:screenshot.getSize()});
  }
  fs.writeFileSync(path.join(base,'cloud-directory-screenshots.json'),JSON.stringify(records,null,2)+'\n');console.log(JSON.stringify(records,null,2));app.exit(0);
 }catch(error){console.error(error.stack);app.exit(1);}
});
