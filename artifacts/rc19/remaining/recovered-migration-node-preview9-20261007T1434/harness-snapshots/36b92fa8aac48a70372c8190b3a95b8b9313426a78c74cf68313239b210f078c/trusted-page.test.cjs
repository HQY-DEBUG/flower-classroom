'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {isTrustedPage}=require('../src/trusted-page.cjs');
for(const platform of ['linux','win32']){
 const windows=platform==='win32',base=windows?'C:\\Users\\ADMINI~1\\AppData\\Local\\Temp\\中文 class 50% #1\\resources\\app.asar\\src\\index.html':'/tmp/ADMINI~1/中文 class 50% #1/resources/app.asar/src/index.html';
 const url=pathToFileURL(base,{windows}).href;
 test(platform+' accepts the exact page with encoded spaces, Chinese, percent, hash and short-name tilde',()=>{assert.equal(isTrustedPage(url,base,platform),true);assert.equal(isTrustedPage(url+'?view=pet&narrow=0#safe',base,platform),true)});
 test(platform+' accepts equivalent unreserved tilde spellings, including lowercase escapes',()=>{assert.equal(isTrustedPage(url.replace(/%7E/g,'~'),base,platform),true);assert.equal(isTrustedPage(url.replace(/%7E/g,'%7e'),base,platform),true)});
 test(platform+' rejects suffix, neighboring files, wrong directory and extra path components',()=>{for(const changed of [url+'.evil',url.replace('index.html','preload.cjs'),url.replace('/src/','/other/'),url+'/index.html'])assert.equal(isTrustedPage(changed,base,platform),false,changed)});
 test(platform+' rejects double encoding and malformed escapes rather than decoding repeatedly',()=>{for(const changed of [url.replace(/%7E/g,'%257E'),url.replace('index.html','%GGindex.html'),url.replace('index.html','index%00.html')])assert.equal(isTrustedPage(changed,base,platform),false,changed)});
 test(platform+' rejects non-file protocols and another host',()=>{for(const changed of ['https://example.org/index.html','data:text/html,hello','javascript:1',url.replace('file:///','file://untrusted-host/')])assert.equal(isTrustedPage(changed,base,platform),false,changed)});
 test(platform+' rejects encoded path separators and relative expected entries',()=>{assert.equal(isTrustedPage(url.replace('/src/','%2Fsrc/'),base,platform),false);assert.equal(isTrustedPage(url,'src/index.html',platform),false)});
 test(platform+' preserves literal percent sequences as a distinct filename',()=>{const literal=windows?'C:\\test%23\\index.html':'/tmp/test%23/index.html';assert.equal(isTrustedPage(pathToFileURL(literal,{windows}).href,literal,platform),true);assert.equal(isTrustedPage(pathToFileURL(literal,{windows}).href.replace('%2523','%23'),literal,platform),false)});
}
test('Windows drive letter case is equivalent but path case is not broadly weakened',()=>{const p='C:\\Users\\Teacher\\resources\\app.asar\\src\\index.html';assert.equal(isTrustedPage('file:///c:/Users/Teacher/resources/app.asar/src/index.html',p,'win32'),true);assert.equal(isTrustedPage('file:///C:/Users/teacher/resources/app.asar/src/index.html',p,'win32'),false)});
test('Windows encoded backslashes and alternate drive reject',()=>{const p='C:\\test\\src\\index.html';assert.equal(isTrustedPage('file:///C:/test%5Csrc/index.html',p,'win32'),false);assert.equal(isTrustedPage('file:///D:/test/src/index.html',p,'win32'),false)});
test('Null, objects and invalid expected paths reject',()=>{for(const v of [null,{},undefined,''])assert.equal(isTrustedPage(v,'/tmp/index.html','linux'),false);assert.equal(isTrustedPage('file:///tmp/index.html',null,'linux'),false)});
