'use strict';
// Records only the untouched generated example, never guesses from student names.
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {writeFileAtomic}=require('./io.cjs');
const MARKER='folder-initial-state.json';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stateHash=state=>hash(JSON.stringify(state));
const names=['classroom.json','classroom.json.previous','classroom-v2.json','classroom-v2.json.previous','classroom-v2.enabled','classroom-lock.json'];
function classroomFiles(directory){const files={};for(const name of names){const file=path.join(directory,name);try{const stat=fs.statSync(file);if(!stat.isFile())return null;files[name]=hash(fs.readFileSync(file));}catch(error){if(error.code!=='ENOENT')return null;}}return files;}
function hasClassroomFiles(directory){const files=classroomFiles(directory);return files===null||Object.keys(files).length>0;}
function recordInitialState(directory,state,resourceDirectory){const files=classroomFiles(directory);if(files===null)throw Error('初始示例状态未能校验，请保留数据目录');const workbook=resourceDirectory&&path.join(resourceDirectory,'计分卡片.xlsx');const value={version:1,stateHash:stateHash(state),files,...(workbook&&fs.existsSync(workbook)?{workbookHash:hash(fs.readFileSync(workbook))}:{})};writeFileAtomic(path.join(directory,MARKER),JSON.stringify(value)+'\n');return value;}
function allowedPristineFiles(directory,state){try{const stat=fs.statSync(path.join(directory,MARKER));if(!stat.isFile()||stat.size>8192)return null;const marker=JSON.parse(fs.readFileSync(path.join(directory,MARKER),'utf8'));if(marker.version!==1||marker.stateHash!==stateHash(state))return null;const current=classroomFiles(directory);if(!current||JSON.stringify(current)!==JSON.stringify(marker.files)||Object.hasOwn(current,'classroom-lock.json'))return null;return current;}catch{return null;}}
function allowedPristineWorkbookHash(directory,state,resourceDirectory){try{if(!allowedPristineFiles(directory,state))return null;const marker=JSON.parse(fs.readFileSync(path.join(directory,MARKER),'utf8'));return marker.workbookHash===hash(fs.readFileSync(path.join(resourceDirectory,'计分卡片.xlsx')))?marker.workbookHash:null;}catch{return null;}}
module.exports={allowedPristineWorkbookHash,MARKER,stateHash,classroomFiles,hasClassroomFiles,recordInitialState,allowedPristineFiles};
