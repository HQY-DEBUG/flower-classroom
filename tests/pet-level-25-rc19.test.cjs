'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Core=require('../src/core.cjs'),Pet=require('../src/pet-progress.js'),Art=require('../src/pet-art.js');
const act=(s,a)=>Core.applyAction(s,a,7100000);
test('all forty species support numeric levels24/25/26 with seven visual stages and exact score boundaries',()=>{
 let s=Core.importRows(Object.keys(Art.names).map((_,i)=>({name:'合成25级同学'+i,group:'验收组'})),Core.createInitialState(),'replace');
 assert.equal(s.students.length,40);const ids=Object.keys(Art.names);
 for(const [points,level,current,remaining] of [[-15,0,0,20],[4,0,4,1],[5,1,0,10],[469,24,19,1],[470,25,0,20],[489,25,19,1],[490,26,0,20]]){
  for(let i=0;i<s.students.length;i++){s.students[i].pet=ids[i];s.students[i].score=points;s.students[i].growth=10000+i;}
  s=Core.validateState(s);
  for(const student of s.students){const p=Pet.profile(s,student);assert.equal(p.level,level);assert.equal(p.current,current);assert.equal(p.remainingToNext,remaining);assert.equal(p.shape,Math.min(7,level));assert.equal(p.isEgg,level===0);assert.equal(p.maxed,false);}
 }
});
test('ordinary negative points and undo cross level25 boundary for all forty species without touching old growth',()=>{
 let s=Core.importRows(Object.keys(Art.names).map((_,i)=>({name:'合成撤销同学'+i,group:'验收组'})),Core.createInitialState(),'replace');
 s.students.forEach((student,i)=>{student.score=470;student.growth=i;student.pet=Object.keys(Art.names)[i];});s=Core.validateState(s);const historical=s.students.map(x=>x.growth),ids=s.students.map(x=>x.id);
 s=act(s,{type:'score',ids,delta:-1,reason:'合成25级扣分'});assert.ok(s.students.every(x=>Pet.profile(s,x).level===24));
 s=act(s,{type:'undo',logId:s.logs.at(-1).id});assert.ok(s.students.every(x=>Pet.profile(s,x).level===25));assert.deepEqual(s.students.map(x=>x.growth),historical);
 s=act(s,{type:'score',ids,delta:20,reason:'合成26级加分'});assert.ok(s.students.every(x=>Pet.profile(s,x).level===26));
 s=act(s,{type:'undo',logId:s.logs.at(-1).id});assert.ok(s.students.every(x=>Pet.profile(s,x).level===25));assert.deepEqual(s.students.map(x=>x.growth),historical);
});
