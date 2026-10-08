'use strict';
// A renderer can lose an IPC response after the synchronous transaction saved.
// Keep small process-local receipts, scoped to that renderer, so it can recover
// the outcome without applying the action a second time. No classroom schema change.
const {createHash}=require('node:crypto');
function createActionReceipts({getState,limit=128}){
 const owners=new WeakMap();
 const valid=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(value);
 function execute(owner,action,run,preflight=()=>{}){
  if(!action||!Object.hasOwn(action,'_transportId')){preflight();return run(action);}
  const transportId=action._transportId;if(!valid(transportId))throw Error('操作回执编号无效，请重新打开操作');
  const command={...action};delete command._transportId;
  const fingerprint=createHash('sha256').update(JSON.stringify(command)).digest('hex');
  let receipts=owners.get(owner);if(!receipts){receipts=new Map();owners.set(owner,receipts);}
  const remember=value=>{receipts.set(transportId,value);while(receipts.size>limit)receipts.delete(receipts.keys().next().value);};
  const prior=receipts.get(transportId);
  if(prior&&prior.fingerprint!==fingerprint)throw Error('操作回执与内容不一致，请重新打开操作');
  try{preflight();}catch(error){if(!prior?.committed)remember({fingerprint,committed:false});throw error;}
  if(prior?.committed)return getState();
  const before=getState();
  try{return run(command);}
  finally{
   // Main-process dispatch is synchronous. A different state reference means
   // store.save succeeded, even if a later notification/response was lost.
   const after=getState();remember({fingerprint,committed:after!==before,...(after!==before?{revision:after.revision}:{})});
  }
 }
 function inspect(owner,transportId){if(!valid(transportId))throw Error('操作回执编号无效');const receipt=owners.get(owner)?.get(transportId);return receipt?{known:true,committed:receipt.committed,...(receipt.committed?{appliedRevision:receipt.revision,state:getState()}:{})}:{known:false,committed:false};}
 return {execute,inspect};
}
module.exports={createActionReceipts};
