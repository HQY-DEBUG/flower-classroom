'use strict';
const {app}=require('electron');app.disableHardwareAcceleration();app.whenReady().then(()=>{try{require(process.env.FLOWER_MODEL_SCRIPT);app.exit(process.exitCode||0);}catch(error){console.error(error.stack);app.exit(2);}});
