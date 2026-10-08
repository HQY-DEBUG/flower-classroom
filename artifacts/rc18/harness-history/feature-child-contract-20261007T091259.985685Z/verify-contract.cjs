'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=process.cwd(),qa=require(path.join(root,'scripts/qa-feature-child.cjs'));
const {createScoreRuleWorkbook}=require(path.join(root,'src/score-rule-workbook.cjs'));
const {resolveFolderLayout}=require(path.join(root,'src/folder-layout.cjs'));
const first=qa.fixture('flower-feature-layout-diagnostic-'),second=qa.fixture('flower-feature-copy-diagnostic-');
const invalidRoot=path.join(first.root,'old-child-resource-root');fs.mkdirSync(invalidRoot);
assert.throws(()=>createScoreRuleWorkbook({resourceDirectory:invalidRoot,dataDirectory:first.root}),/配置数据目录必须保存在程序文件夹内/);
for(const item of [first,second]){
 assert.equal(path.relative(item.root,item.data),'数据');
 assert.doesNotThrow(()=>createScoreRuleWorkbook({resourceDirectory:item.root,dataDirectory:item.data}));
 const resolved=resolveFolderLayout({env:{FLOWER_FOLDER_ROOT:invalidRoot,FLOWER_EXTERNAL_RESOURCE_DIR:invalidRoot,...item.env},isPackaged:false,developmentDirectory:root});
 assert.equal(resolved.root,item.root);assert.equal(resolved.dataDirectory,item.data);
}
assert.notEqual(first.root,second.root);assert.ok(!second.data.startsWith(first.root+path.sep));
const reportFile=path.join(first.root,'report.json'),positive={checks:[{name:'Synthetic contract',status:'passed'}],errors:[]};
const results=[];
function verify(name,run,report,expected){if(report===null)fs.rmSync(reportFile,{force:true});else fs.writeFileSync(reportFile,typeof report==='string'?report:JSON.stringify(report));const result=qa.capture(run,reportFile,'flows');assert.equal(result.exitCode,expected,name);results.push({name,exitCode:result.exitCode,evidenceErrors:result.evidenceErrors});}
verify('Valid nonempty clean report',{status:0},positive,0);
verify('ETIMEDOUT even with status zero and valid report',{status:0,error:Object.assign(new Error('Timed out'),{code:'ETIMEDOUT'})},positive,1);
verify('Signal even with status zero',{status:0,signal:'SIGTERM'},positive,1);
verify('Null status',{status:null},positive,1);
verify('Nonzero status',{status:2},positive,1);
verify('Missing report despite status zero',{status:0},null,1);
verify('Zero cases despite status zero',{status:0},{checks:[]},1);
verify('Incomplete report',{status:0},{...positive,completed:false},1);
verify('Fatal report',{status:0},{...positive,fatal:'startup failed'},1);
verify('Failed case',{status:0},{checks:[{name:'failure',status:'failed'}]},1);
verify('Unexpected renderer errors',{status:0},{...positive,errors:['unexpected']},1);
verify('Malformed JSON',{status:0},'{bad',1);
fs.writeFileSync(reportFile,JSON.stringify(positive));qa.prepare(first.root,['report.json']);assert.equal(fs.existsSync(reportFile),false);assert.ok(fs.readdirSync(first.root).some(name=>name.startsWith('report.json.prior-')));assert.equal(qa.capture({status:0},reportFile,'flows').exitCode,1);
const freeze=JSON.parse(fs.readFileSync('artifacts/rc18/frozen-source.json'));const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.ok(Object.entries(freeze.files).every(([file,hash])=>sha(file)===hash));
const artifact={createdAt:new Date().toISOString(),syntheticOnly:true,electronProcessesLaunched:0,oldInvalidLayoutRejected:true,containedIndependentCopies:true,staleReportPreservedAndRejected:true,checks:results,runtimeMatchesFreeze:true,asarSha256:sha('dist-rc18-final/win-unpacked/resources/app.asar')};
fs.writeFileSync(path.join(__dirname,'diagnostic-results.json'),JSON.stringify(artifact,null,2));console.log(JSON.stringify({layout:'passed',childResultChecks:results.length,staleReport:'rejected',runtimeMatchesFreeze:true,asarSha256:artifact.asarSha256}));
