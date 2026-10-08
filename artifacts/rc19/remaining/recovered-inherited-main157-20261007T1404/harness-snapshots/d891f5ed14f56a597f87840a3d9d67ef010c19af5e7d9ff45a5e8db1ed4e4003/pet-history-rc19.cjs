'use strict';
// Fixed synthetic pre-RC19 records. No retired production action is invoked
// to prepare these histories: validation must continue to protect them.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Core=require('../src/core.cjs'),Pet=require('../src/pet-progress.js');
const clone=value=>structuredClone(value),now=1_800_000_000_000;
const first=s=>s.students[0],account=(s,id=first(s).id)=>s.petAccounts.find(a=>a.studentId===id),cycle=(s,id=first(s).id)=>account(s,id).cycles.find(c=>c.id===account(s,id).activeCycleId);
const act=(s,a)=>Core.applyAction(s,a,now),score=(s,delta,ids=[first(s).id])=>act(s,{type:'score',ids,delta,reason:'纯合成 RC19 积分'}),profile=(s,id=first(s).id)=>Pet.profile(s,id);
const historic=()=>Core.validateState(JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/pet-score-history-rc19.json'),'utf8')));
function graduatedArchive(){const s=historic(),id=first(s).id,a=account(s);a.cycles=a.cycles.filter(c=>c.status==='graduated');a.activeCycleId=null;a.lifetimeNetGrowth=a.unassignedGrowth+a.cycles.reduce((n,c)=>n+c.netGrowth,0);s.petLogs=s.petLogs.filter(l=>l.changes.every(c=>c.id!==id));first(s).adopted=false;return Core.validateState(s);}
function reject(s,a,re){const before=clone(s);assert.throws(()=>act(s,a),re);assert.deepEqual(s,before);}
const initLedger=(s=Core.createInitialState())=>act(s,{type:'pet.draw.reset'});
const guard=(s,extra={})=>({expectedRevision:s.revision,requestId:'rc19_'+s.revision,...extra});
module.exports={Core,Pet,clone,first,account,cycle,act,score,profile,historic,graduatedArchive,reject,initLedger,guard};
