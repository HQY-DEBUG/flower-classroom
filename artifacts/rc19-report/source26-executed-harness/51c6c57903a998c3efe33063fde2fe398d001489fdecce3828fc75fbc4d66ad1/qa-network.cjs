'use strict';
const assert=require('node:assert/strict'),path=require('node:path');const {app,BrowserWindow,session}=require('electron');
process.env.FLOWER_HEADLESS_TEST='1';process.env.FLOWER_DATA_DIR=path.resolve(__dirname,'../.qa-network');app.disableHardwareAcceleration();require('../src/main.cjs');
app.whenReady().then(async()=>{try{for(const url of ['http://127.0.0.1:9/qa-no-data','https://example.invalid/qa-no-data']){await assert.rejects(session.defaultSession.fetch(url),/ERR_BLOCKED_BY_CLIENT/);console.log('PASS_NETWORK',url.split(':')[0]);}app.exit(0);}catch(e){console.error('FAIL_NETWORK',e);app.exit(1);}});setTimeout(()=>app.exit(2),10000);
