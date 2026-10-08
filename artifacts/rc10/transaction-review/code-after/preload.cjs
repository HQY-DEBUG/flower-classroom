const { contextBridge, ipcRenderer } = require('electron');
const uncertainActions=new Map();
const resolvingActions=new Map();
let observedRevision=-1;
const observeState=state=>{if(Number.isSafeInteger(state?.revision))observedRevision=Math.max(observedRevision,state.revision);return state;};
// Outcome replies can arrive after a newer state broadcast. Keep that boundary
// even when the renderer UI has already switched views or opened another form.
ipcRenderer.on('state:changed',(_event,state)=>observeState(state));
function committedOutcome(receipt){
  observeState(receipt.state);
  if(receipt.appliedRevision!==observedRevision)throw Error('上一笔操作曾保存，但课堂资料后来已变化。请核对最新记录后再执行新的操作');
  return receipt.state;
}
const uncertainMessage='上一笔操作结果暂时无法确认。请先核对课堂记录；通信恢复后可重试确认结果，或刷新界面重新核对，避免重复提交';
async function invokeWithReceipt(channel,request){
  const signature=channel+'\n'+JSON.stringify(request);
  if(resolvingActions.has(signature))return resolvingActions.get(signature);
  if(!uncertainActions.size)return resolveAndInvoke(channel,request,signature);
  const pending=resolveAndInvoke(channel,request,signature);resolvingActions.set(signature,pending);
  try{return await pending;}finally{if(resolvingActions.get(signature)===pending)resolvingActions.delete(signature);}
}
async function resolveAndInvoke(channel,request,signature){
  // An unknown result must not turn into a new implicit retry. Resolve the
  // original intent first; an absent/expired receipt stays explicitly unknown.
  for(const [key,transportId]of uncertainActions){
    let receipt;try{receipt=await ipcRenderer.invoke('state:receipt',{transportId});}catch{throw Error(uncertainMessage);}
    if(!receipt.known)throw Error(uncertainMessage);
    uncertainActions.delete(key);
    if(receipt.committed){
      const recovered=committedOutcome(receipt);
      if(key===signature)return recovered;
      throw Error('上一笔操作已保存，请核对最新记录后再执行新的操作');
    }
  }
  const transportId=globalThis.crypto.randomUUID();
  try{return observeState(await ipcRenderer.invoke(channel,{...request,_transportId:transportId}));}
  catch(error){
    // This is a read-only outcome check, never an automatic action retry.
    // Validation, locking and save failures still propagate their original error.
    let receipt;try{receipt=await ipcRenderer.invoke('state:receipt',{transportId});}catch{}
    if(receipt?.committed)return committedOutcome(receipt);
    if(receipt?.known)throw error;
    uncertainActions.set(signature,transportId);throw Error(uncertainMessage);
  }
}
contextBridge.exposeInMainWorld('classroom', {
  lock: request => ipcRenderer.invoke('lock:command', request),
  onLock: callback => { const listener = (_event, status) => callback(status); ipcRenderer.on('lock:changed', listener); return () => ipcRenderer.removeListener('lock:changed', listener); },
  get: async () => {const result=await ipcRenderer.invoke('state:get');observeState(result.state);return result;},
  action: action=>invokeWithReceipt('state:action',action),
  window: request => ipcRenderer.invoke('window:command', request),
  file: request => ['import-apply','restore-apply','archive','blank'].includes(request?.command)?invokeWithReceipt('file:command',request):ipcRenderer.invoke('file:command', request),
  subscribe: callback => { const listener = (_event, state, change) => callback(state, change); ipcRenderer.on('state:changed', listener); return () => ipcRenderer.removeListener('state:changed', listener); },
  onSidebarNarrow: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('sidebar:narrow', listener); return () => ipcRenderer.removeListener('sidebar:narrow', listener); },
  onCommand: callback => { const listener = (_event, command) => callback(command); ipcRenderer.on('ui:command', listener); return () => ipcRenderer.removeListener('ui:command', listener); },
  onTimerFinished: callback => { const listener = (_event, detail) => callback(detail); ipcRenderer.on('timer:finished', listener); return () => ipcRenderer.removeListener('timer:finished', listener); }
});
