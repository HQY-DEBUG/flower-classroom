'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../src/core.cjs');
for(const type of ['panel.clear','panel.remove']){
 test(type+' rejects older confirmation and preserves newer score, student and history',()=>{let s=C.applyAction(C.createInitialState(),{type:'panel.create',mode:'full',name:'合成清理副本'});const expectedRevision=s.revision;for(const action of [{type:'score',ids:[s.students[0].id],delta:3},{type:'student.add',name:'合成新增',group:'合成组',pet:'owl'}]){const next=C.applyAction(s,action),before=structuredClone(next);assert.throws(()=>C.applyAction(next,{type,panelId:C.panelId(next),expectedRevision}),/更新/);assert.deepEqual(next,before);}});
 test(type+' accepts fresh confirmation, ignores renderer-only viewport changes, retains legacy caller compatibility',()=>{const s=C.applyAction(C.createInitialState(),{type:'panel.create',mode:'full',name:'合成清理副本'}),next=C.applyAction(s,{type,panelId:C.panelId(s),expectedRevision:s.revision});assert.equal(next.revision,s.revision+1);assert.doesNotThrow(()=>C.applyAction(s,{type}));});
}
