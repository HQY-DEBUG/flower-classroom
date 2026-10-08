'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),source=path.join(root,'src/core.cjs'),archive=process.env.FLOWER_QA_ASAR;
assert.equal(typeof require(source).createInitialState,'function');
assert.throws(()=>Module._resolveFilename(source,{filename:path.join(root,'unidentified-runtime.cjs')}),/RC19_UNIDENTIFIED_FIXTURE_PARENT/);
assert.throws(()=>Module._resolveFilename(source,{filename:path.join(archive,'src/main.cjs')}),/RC19_PRODUCT_DEPENDENCY_ESCAPE/);
console.log('Three observer-only classification checks passed; zero acceptance cases or product launches');
