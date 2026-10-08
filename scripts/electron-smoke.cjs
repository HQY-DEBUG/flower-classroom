const {app,BrowserWindow}=require('electron');
process.on('uncaughtException',e=>{console.error('UNCAUGHT',e);app.exit(1)});
process.on('unhandledRejection',e=>{console.error('REJECTION',e);app.exit(1)});
app.disableHardwareAcceleration();
const fs=require('node:fs');const path=require('node:path');
process.env.FLOWER_HEADLESS_TEST='1';
process.env.FLOWER_DATA_DIR=path.join(__dirname,'../.electron-test');
require('../src/main.cjs');
app.whenReady().then(async()=>{
 try{
  for(let i=0;i<100&&!BrowserWindow.getAllWindows().length;i++)await new Promise(r=>setTimeout(r,100));
  const w=BrowserWindow.getAllWindows()[0];
  await new Promise(resolve=>w.webContents.once('did-finish-load',resolve));
  await new Promise(r=>setTimeout(r,1000));
  console.log(await w.webContents.executeJavaScript('document.body.innerText.slice(0,1000)'));
  fs.writeFileSync(path.join(__dirname,'../artifacts/01-main.png'),(await w.webContents.capturePage()).toPNG());
  console.log('SMOKE_OK');app.quit();
 }catch(e){console.error(e);app.exit(1);}
});
setTimeout(()=>app.exit(2),30000);
