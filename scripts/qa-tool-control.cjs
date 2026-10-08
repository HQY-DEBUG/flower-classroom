'use strict';
// QA navigation only. Follow the same visible launcher/dialog path as a teacher.
// Never changes app DOM, selector APIs, handlers, or state.
const migrated = new Set(['panel-create','panel-manage','clear-current-panel','clear-current-points','excel-summary','cw-prize','cw-toolbox','cw-challenge','gt-manage','org-sort-open','score-step','show-reasons','batch-photos','toggle-avatars','open-flower','open-sidebar','open-pet','open-pets','open-draw','open-timer','tools-pets','tools-import','backup','restore','bulk-add','bulk-group']);
const petFeatures = new Set(['pet-honors','pet-draw','pet-rules','pet-catalog','open-pets','open-pet','open-timer']);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function probe(selector) {
  const dialog = document.querySelector('#modal .dialog');
  const candidates = [...document.querySelectorAll(selector)];
  for (const element of candidates) {
    const style = getComputedStyle(element);
    if (element.hidden || element.closest('[inert]') || style.visibility === 'hidden' || style.display === 'none' || (dialog && !dialog.contains(element))) continue;
    if (!element.getClientRects().length) continue;
    element.scrollIntoView({block:'center',inline:'nearest'});
    const rect = element.getBoundingClientRect(), x = (rect.left+rect.right)/2, y = (rect.top+rect.bottom)/2, hit = document.elementFromPoint(x,y);
    if (rect.width <= 0 || rect.height <= 0 || x < 0 || x >= innerWidth || y < 0 || y >= innerHeight || !(hit === element || element.contains(hit))) continue;
    const parts=[]; let current=element;
    while(current && current!==document.body){const parent=current.parentElement;if(!parent)break;parts.unshift(current.tagName.toLowerCase()+':nth-child('+([...parent.children].indexOf(current)+1)+')');current=parent;}
    return {selector:'body > '+parts.join(' > '),x,y,disabled:element.disabled===true,text:element.innerText,dialog:!!dialog};
  }
  return null;
}
async function visibleControl(window, selector) {
  // The app's deferred modal autofocus can scroll a just-opened dialog. Wait for
  // that exact focus condition before measuring a native pointer coordinate.
  for(let n=0;n<30;n++){
    const pending=await window.webContents.executeJavaScript(`(()=>{const d=document.querySelector('#modal .dialog');return !!d&&!d.contains(document.activeElement)&&!document.querySelector('#classroom-lock-overlay:not([hidden])');})()`,true);
    if(!pending)break;
    await delay(10);
  }
  return window.webContents.executeJavaScript('('+probe.toString()+')('+JSON.stringify(selector)+')',true);
}
async function nativeClick(window, control) {
  if (!control || control.disabled) throw Error('QA navigation control is absent, covered, or disabled');
  for(const type of ['mouseDown','mouseUp']) window.webContents.sendInputEvent({type,x:Math.floor(control.x),y:Math.floor(control.y),button:'left',clickCount:1});
  await delay(35);
}
async function ensureToolControl(window, selector) {
  const match=selector.match(/\[data-do\s*=\s*["']?([\w-]+)["']?\]/), action=match?.[1];
  if (!migrated.has(action) && !petFeatures.has(action)) return selector;
  const generic=/^\[data-do\s*=\s*["']?[\w-]+["']?\]$/.test(selector);
  // Generic prize/honors launch must not silently choose a student-card shortcut.
  const requested=generic&&['cw-prize','pet-honors'].includes(action)?selector+':not([data-id])':selector;
  let found=await visibleControl(window,requested);
  if(found) return found.selector;
  if(!generic) throw Error('Requested scoped tool is not visible: '+selector);
  const close=await visibleControl(window,'#modal [data-do=modal-close]');
  if(close) await nativeClick(window,close);
  // RC18 rules/catalog moved into the visible secondary pet menu.
  if(['pet-rules','pet-catalog'].includes(action)){
    const more=await visibleControl(window,'[data-do=pet-more]');
    if(more){await nativeClick(window,more);for(let n=0;n<120;n++){const entry=await visibleControl(window,'#modal '+requested);if(entry)return entry.selector;await delay(25);}throw Error('Pet secondary menu did not expose visible entry '+selector);}
  }
  const petLauncher=petFeatures.has(action)&&await visibleControl(window,'[data-do=px-features]');
  if(petLauncher){
    await nativeClick(window,petLauncher);
    for(let n=0;n<120;n++){const entry=await visibleControl(window,'#modal [data-do=px-feature][data-entry="'+action+'"]');if(entry)return entry.selector;await delay(25);}
    throw Error('Pet features did not expose visible entry '+selector);
  }
  const launcher=await visibleControl(window,'[data-do=panel-toggle]');
  if(!launcher) throw Error('Visible classroom tools launcher missing for '+selector);
  await nativeClick(window,launcher);
  for(let n=0;n<120;n++){
    found=await visibleControl(window,'#modal .classroom-tools-palette '+requested);
    if(found) return found.selector;
    await delay(25);
  }
  const context=await window.webContents.executeJavaScript(`({dialog:document.querySelector('#modal h2')?.innerText,feedback:document.querySelector('#pet-feedback')?.innerText,entries:[...document.querySelectorAll('#modal [data-do]')].map(e=>e.dataset.do)})`,true);
  throw Error('Tool palette did not expose visible entry '+selector+' '+JSON.stringify(context));
}
module.exports={ensureToolControl,visibleControl,nativeClick};
