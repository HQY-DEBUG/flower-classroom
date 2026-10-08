'use strict';
// Locks all 140 original renders before the additive adventure catalog change.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { DOMParser } = require('@xmldom/xmldom');
const PetArt = require('../src/pet-art.js');
const ORIGINAL = ['owl','fox','bunny','cat','penguin','panda','bear','dog','deer','squirrel','hedgehog','raccoon','koala','elephant','lion','tiger','dragon','unicorn','otter','seal'];
const ADVENTURE = ['robot','rover','mechcrab','mechbeetle','mechdragonfly','rex','raptor','triceratops','stegosaurus','ankylosaurus','pteranodon','mammoth','rhino','gorilla','wolf','boar','eagle','shark','orca','phoenix'];
const ORIGINAL_HASHES = {
  "owl/1": "e3c4dac1026988c1e39d8808d01716b7494f1b992a81569f29b0a5bc87c8b0ac",
  "owl/2": "1d8fd2003afe11ebeb015edcb8fc31ba1e1ea7d0a1957942b1bb14fc7163415f",
  "owl/3": "416dff5f0d9c28a96acfdba70d9fabd4d1f4be2c4b7f4f34b9c98c24d84cbd1a",
  "owl/4": "c4702aea6fc6981253f30f6e5175007685739812dd3592bec27ff3f88276b71f",
  "owl/5": "0f348992ac4bc127e3ea40f918e5e663648b953b3368f0b072bebf2e1cbcbc4a",
  "owl/6": "692f2d4a5a83050c1787a81d0524eaed472a7c6432a9a148a84fd82e3931019b",
  "owl/7": "c15beb7ede020e8f625ff13ea65603cd6af218fecef596981969149d0f2e506d",
  "fox/1": "8551299df3fb95fe8927f84fd69c4e0c7d693b6f2a348c199049067905f17884",
  "fox/2": "64c427eb1cfe69556c9d14cc0b4686965fd42bb8d11df1b0952765164039cfe1",
  "fox/3": "759b18751a1474bfff07eaa311ce356826c4ec6ac585436025c9906022d00360",
  "fox/4": "8b123f3eee26b1f16cf62d280a2aec6d90f691925d0c664de27598aa9a72dc9f",
  "fox/5": "231f4fa097d6ff39949169b47ba2bb9e48f429f472119a6f5f82ded760117c91",
  "fox/6": "4bce2c8c11c18e6d86abc54697b350611a6551ae2db8c9ccf996cbd6ad1c4c29",
  "fox/7": "5fe4960f5b71104960d6156433be9be6abf473fd66baec299aef28d80928875f",
  "bunny/1": "7d3de046f6172da86a17310e20b7316ae159fcd05f95b0b5da29d4cf9a0972ca",
  "bunny/2": "23d5070d5a10267a7b248fbb1e514be55280956510225e4a5f7c0d155042b584",
  "bunny/3": "188fe2c2783c3a7aedec4b53601cd909a7103166e6cf75a322c885b0abe7e5d3",
  "bunny/4": "eeb243789af4317fc26d3cc1e773aa9edce0d0450642028507e0e17ffc63650c",
  "bunny/5": "b2ef83cf194daa1c7e57c673dbd9ad575a48b69dedd5537203ee2d60a9bfcce0",
  "bunny/6": "0ab7197b07423930151af46f58110eef64fe78060fa5165e37a6d494e11868fb",
  "bunny/7": "a84fca4e73ffb6d51d2fa5c0cc215449c7a16e8065133d0db429013b1b24b753",
  "cat/1": "2871218f65796c06ecf2f5e8692d803b460fe4a0dfc73bd6994591352e952cdb",
  "cat/2": "fe07484c43920fdc6963f363f9f249e28f26db297bdd5c6197c0561d1999dcdc",
  "cat/3": "ecf8c8ff57c0e3cd8ed862e6481837571fa11a0ac4715495298e250e722fb570",
  "cat/4": "594019b7b308f351a95dc17093a73470dc8075ae0bcae6b6598ee89cbc9969b8",
  "cat/5": "3f567da0ceb3d8212e759609a2533e7165f522a3444a12b79bf70cdb4e013807",
  "cat/6": "a94f144247af6e3afde7b1e997bac2d4bd98e5c946a63f75dedc07c1ae48e64c",
  "cat/7": "81b985392b7dd1324396bb259061c0ee504ae900d38611c5d5c5a1d7142a00cf",
  "penguin/1": "a456325eaf02f6bb40dc042c98b9730798b566310e5c37fa2d1282d3b215e44e",
  "penguin/2": "fbb38daa484ee53c246ef141fed7ae72e274b5f594638c86fa94951c41fd9170",
  "penguin/3": "9dc85a24036995065730cae84174158602b1988b92ca79625156965e44220af5",
  "penguin/4": "5388038da19ddca8a1888e3dfd42cd7023d6628141e9dd96909d9386f4bfa588",
  "penguin/5": "4e8b637fd81ca09b63fb63f9221eb55a1b9c66692b2360ae1861d1af979901af",
  "penguin/6": "11605d435c1ca128507597a634d2bd64ace2602ed390bf3c25c830e8c72a8da8",
  "penguin/7": "899a1a032e786512d135b791bacd4716dec8c88c7f5f38a09f9ae294ec7a554d",
  "panda/1": "ff2f61cef34a5ba58a38a47351313aa3ac21b6a703eea4dc351cd5f67edf5dab",
  "panda/2": "cc5dd1387afa320a4679483611852bfbc27b558e16847db809922375aeaec432",
  "panda/3": "43be761d0b4a48edeb8cabe709c5f9261262a60d54e12ba027769a5be779f5c2",
  "panda/4": "e9980061d68ac687c12974514183f7359f87ae3c7672dd8572d424dcfed70825",
  "panda/5": "d60353b65d614b3ba595707588601ce5b86fe388acd41e1a5130de6903680377",
  "panda/6": "0ce34a7f07bac03ce2298655c17f7cff4680a7e461f5e24fe3407001f818ecc6",
  "panda/7": "a9a651319721680ed94173678e9b4256623fa039787780ac800ce6d91f0073b1",
  "bear/1": "6100e742785e6d7f3987242b40b5085443145c6ddfe75a03574e4f25185f30b2",
  "bear/2": "9309362de42aaad8e6a91fecc3d131218e3e15041defae334d5e87c0aaa847b8",
  "bear/3": "70f76107c111da3616d22217e9c50afcb0871b96dcb8980fba38c09ad887e737",
  "bear/4": "2a935efac8794e182223c38f8be0cf6d1f50a2c5b5be83a80e213d9de34306cb",
  "bear/5": "5dd9ce1ac6079031d3d090ee1115cf5e3bc750da1e8bc8b7f95c6ed7b3af40a0",
  "bear/6": "088519a7df01df1495d1f9336de2dc4af0b9a3ccab9ef780b223089846a215d4",
  "bear/7": "cb52cd497850ea8c7dcc128e68a00f2499cb42a5d7123aa3b3db26b1503430f3",
  "dog/1": "ce5002a324237bed2217aabddedff9def1e402288c39640e3b1c37a18c10f973",
  "dog/2": "9e9caf106cf428a78d9c03950779f6a29377cd1b230f741776a4ac696e07032c",
  "dog/3": "0f9b68493db13afdb76d4dc5126ea14d5b8898f7e986c26ea4b4264fcb6cb4aa",
  "dog/4": "56b7c77075061a81c0b5931ee9f8ca13b8277eef3e1e700ead63432369bde751",
  "dog/5": "969eaf8848ad7b811382f2815e463a7f748b3e8968bbfb9c38b253a8516b3d8d",
  "dog/6": "ed6956b24d349f8a0a29395e7c9481fb1b72a5763251b7e6f6f7ab97dd24b68d",
  "dog/7": "119abe7a04cdf535a45ab660692d99e73994e3bffec950b7fe2034324f0e68a3",
  "deer/1": "ea2626bc4b887b70486c2b5e5d2870f13e7a07ce4d5fac388b76475856f5b7ef",
  "deer/2": "26a35adaede7af0d49b9128ee4762d67064984dbf14b30e2d10856c28a178d11",
  "deer/3": "c83aee17a489b22e240c4fc9fa1d832cfe2343dd9c142351e35fe0b9ed0fddae",
  "deer/4": "fb470ebe5bb1a3e3744a5c5c1bf5aa1bacfa4a0ca3082e426c58b21f825f9cf2",
  "deer/5": "7a65651626435de8b07a8a7a9adf0fa9ed659160cf01ef165d83e51df12415b4",
  "deer/6": "944535307cb0798b9c25462fcbc3427611348a8d9b4323ecf6353279d17eb0a9",
  "deer/7": "cf9c9bf84374faa218868b7324092dbbf35f293f6211608e6bb154ff1c4296bf",
  "squirrel/1": "7b9e9c721059d9095eb376f4e4fa3c0b1c598be4f39e42b12697ce1091f9abc6",
  "squirrel/2": "a0424120321173a66f6cbd939deb04c2ebe81fd4eefde32c0a545fbebdcf9bfc",
  "squirrel/3": "0a73903fe043e22350e29013e9ed2f530b8596ba75118c7ac86b67e6a14e5ea8",
  "squirrel/4": "d25cb11b006053856a14ae08a88acf66f54ec91f1459c54376c7e877e75b3aed",
  "squirrel/5": "4954e5bbec00d9c7ca2689538bc0e7542829c7ee824a5e5c56d327fc29d3601a",
  "squirrel/6": "fda439805ca71f7f7538cf8e29b26abfb31453ee2736bd7194e000b176cbcaff",
  "squirrel/7": "1743e1cc14d6a92ce048ed21fa2f93da9545af23d405c2fa28621d09cba6c3cd",
  "hedgehog/1": "5ce7240d691e0f505a30cb8fc8f2df8e16f5b7516a304f4487f5a58c74b08e14",
  "hedgehog/2": "8f3342d28af0256c25cf552ae279f01dd8bc5884bb80253462143153c725ce08",
  "hedgehog/3": "e6fd9c7fd14ebef804203b1a3745a79f66f3e85c146e93fc5094ef9ad869462c",
  "hedgehog/4": "760e2130b506d37425c8d2c81aa5b489da092eeb000772461e08cd24c6c2cf3b",
  "hedgehog/5": "1a1bcd0ab7b317d94b3ea03f1cac896ddc6865f0758f7b327c38e4bb92f63296",
  "hedgehog/6": "da2c4f58bf19dfd956f2fa05c8441806716353e5dbfc8a63f3e519ecbac18bb7",
  "hedgehog/7": "9b6d47d97f7c69d02ed8b82d699a18a94510f15e10200fee621350e22821c201",
  "raccoon/1": "b79975d8c38a30ac4b7c2b8fc05f9dfd63cabe68e7317f7a86317923ddb75cc1",
  "raccoon/2": "3b750219b485a52c36a985719f849fa517ca885d2b1a096e4432eab5ab0274fc",
  "raccoon/3": "332f5b03777511bb3585dd11a9ce11b73722bd7389bd201ba37aa0f63ec3370d",
  "raccoon/4": "39ac06f9d79d6e07e0f97936ff6a5eaa1e2d663c7a8febf75f688022963f8fdb",
  "raccoon/5": "c8f43c8b3543071b53dea7156255927187bd51a362045a5c30708358ebc72d6a",
  "raccoon/6": "6225010ef62178195d8a471f3e061eff4538803633a598b24e8e1634a977d34b",
  "raccoon/7": "e900b1de0ee5f828d662534db7ca0a74de4f574e72d5d79e55519211f201a587",
  "koala/1": "1312406b28c797e66d6bc0287a6286d65bfc8f3131c0b7a941dd1f187d4c8118",
  "koala/2": "d33abfdbf78a2cb95c77f9fe4d8dd90774aed4da542a99fa595070d879208974",
  "koala/3": "d3e17b6ebdcdb3aedeef1dd471140c18979eaa5f3654f50e50076ac43ee673eb",
  "koala/4": "652821c0d055a42e3df8c8af40442cd6fefb8da94b222731d1d98d357f2f33d3",
  "koala/5": "34281fa57d4834fc8396beec58d542ffc491395669c76a4ddc83386d39aa0725",
  "koala/6": "0aa13b9f701394bd80a4982ad712a4beff36acf5698b0f2e06104a081bd7c775",
  "koala/7": "d0bdb14efe79bafb8fb0c567f18064e7c4a8d73dfef29181c4a23d4f71628aa1",
  "elephant/1": "a02e2ff1c8ea2fba9e8e0b5d3b9a78b9ddddb1bad9af6142485517d78df5a528",
  "elephant/2": "3da740ea37d4df675e19eade7939cfc8310e15c5e79989c84e884abd63ec7b98",
  "elephant/3": "2d6fc9e4c2bdd35bc3e1c1962b3fa9036144beff604a002ce8fad656e1b79581",
  "elephant/4": "15748ea88ef6b2c849556d32f865192cb799b62752cd9a689a9f94cc5d11a680",
  "elephant/5": "811f28117c6f644b6d64ae52f119b477f5f4cc555639b44fd9bb2526bbd0dd37",
  "elephant/6": "71f2160c170a3bf1c8329b26248a2d333a5684760b064af676528e180832a68e",
  "elephant/7": "9a3d4e3915ec0e41a5290682399c3bab43b18537d189383aef7a46f4ba17e330",
  "lion/1": "7ada1bde5d86f2aa060843457bcef0cd19a95f33197d6ffadfbf199c4e69c421",
  "lion/2": "0f501468bb2dcc81418d83d83373514f863d50382288f78cf76b81c7db52e77a",
  "lion/3": "e1b2463aeaa59213ad442f80807ae4a01db12fd3406ac2ba6d1033fcaa9c2840",
  "lion/4": "91e7d37eace40dc806f6c40987fd0295dc2be77bd1d4f89ce17b81473b265e18",
  "lion/5": "6ac91efbebbdad954bc13dcf05aa4c202faa8316b3160b578b11ac5b3afc03df",
  "lion/6": "dacb45efb8f6184ad40818751b9901784f4518f2c00ef1104ba60a389c936fb3",
  "lion/7": "c219b81e529b6c0ff2eda717f6761eca2d9c13d7a0e07b2eae3e84d993f72323",
  "tiger/1": "3ff3e865f0e84f0632caece9a128dc57d75a6b39d851291bfecf38356ab4a032",
  "tiger/2": "1e0067e9db6c8e12c9266d9241d483a6ef7377823961a6c9a0312b361e3e5456",
  "tiger/3": "331fe54012d2fcc6a2ddaea9a2ee929a7a393585c5c1109397922c70e4fc9b24",
  "tiger/4": "4a789e7462004aebb6ff8269e1018fe666ed9b9469c932dd98f89e20a1f9f659",
  "tiger/5": "65284508a0eb57b94c766d313a37c80d32fbc5a12efcd99be402baca21e7ab6e",
  "tiger/6": "e69be68bc4f5d1425b6ab537db141e6697dc815b707c170c9a78ceef4b2ff132",
  "tiger/7": "0d28b60daaa725d4bb6c60bdb2917c19ee8233870d2ec7559bc2ca20f0286db7",
  "dragon/1": "28074cb61d899711d42e3eb646cbb465921056d7edd98ff1b385e660edb6c010",
  "dragon/2": "02b8a6ba2abcb63aa10ba48f256dad6b39f1a0cbc514b9ffe0243e2e1890925b",
  "dragon/3": "da82eaf74c02ffa3f2453007286b29e3cf8419178cd8b1f1bcfc30ee10d22d1d",
  "dragon/4": "c4f6d761304218f0e097747f4f8b5e83259f67adf77d74273de7a41e6d86fbd8",
  "dragon/5": "96f8a30f0f3818973e190766aaf6563b5c532105c69a1d6e94be6edf08dd2f40",
  "dragon/6": "28387ef5ce20c0fffe51171b69044e982bc5e6fecfb83249e2d0f17750cacab5",
  "dragon/7": "78e8b0e689c890e886795ed4225b2d933316d92172b3978632be45c913d1fb72",
  "unicorn/1": "e4c7b36c7db9e1a9bd08835ece6af1b08b30bd3603c0899093969621f33f7bbb",
  "unicorn/2": "a58dd294c4b3bddccf54325df1baf1a54427830cae2f2fab6376166754c4308c",
  "unicorn/3": "faf73ecb0f9239808541965f4878f569b65f3689513d0619ffae3086b510cfe8",
  "unicorn/4": "7158fa047e457ccea0ab9b3fbfd2eb4f5ff6b8e1d0f229eba48a9a2cc7c19731",
  "unicorn/5": "d97898cf2090f3ad6f7a9499036a663667ba5dac392aa10c57a7fbbeab8ce557",
  "unicorn/6": "fe247754153c32784d614220002c2ca6509a7adb494012b0f9d606145102d14b",
  "unicorn/7": "9a87dc69a3ad83ecba125007a8e93b2a0af7cb9b75fa12da74a6fc3cb0325477",
  "otter/1": "3a4ff6a37d06c2f52ab366dcaf9cbd4edd4430983fdee13854e99947a4dfc0a0",
  "otter/2": "ffa967f1edfa8ee1072175b34dc46ebef40580fa7913104a6e3fceb159971c59",
  "otter/3": "6a7b8843c8e8ae8e7e87227d5b415999e05bae9aa45229d4b38f8d0bcc64896c",
  "otter/4": "687bcdd48b20a86568304062253c4f0d78f994e2e33ae910529ddb0a9ad42491",
  "otter/5": "e9da1327c832152d81d0d984f61a8d055146157a24e438119acbfaf1a63b35db",
  "otter/6": "eef0539424235292e7bd5645de09c2dcf7f59bab54c3ddb6b17418162d839e37",
  "otter/7": "8819e6c4ebbae46e02230ec212b6497792d3c8ffaa719cc56bcc37379f223b15",
  "seal/1": "d9eff443e10e9727cba9ef9583bfbcd1009ebdba9cdde2c87b2f4540e93eea22",
  "seal/2": "7ca889af6539cadc618da47793870acc17e63440d797485429f37399e30ae116",
  "seal/3": "ee5c482efecfb22da6b3b8a81691154ef4564f04f74c0c7e1835c177afea88cc",
  "seal/4": "c0eced0a4def3400ae3c074bb3dc2d7dd8af66941c223d5f76eb5ff0864e84da",
  "seal/5": "d7dd367f4c5264d3b0a0c9044628c2761228c4c8dbf407b5b8d8f197cc3c2be2",
  "seal/6": "da4af67ca7c1c3160222a3b6fedd7ffb053d7d5677ad339311ab5e0266b923de",
  "seal/7": "0b5402a86bc88dad5e2182dc594f4875ccbced44054900d4591cddf436df0ff5"
};
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
function geometry(svg) {
  return [...svg.matchAll(/<(g|path|rect|circle|ellipse|line|polyline|polygon)\b([^>]*)>/g)].map(m => m[1] + '(' + [...m[2].matchAll(/\b(d|points|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|transform)="([^"]*)"/g)].map(a => a[1]+'='+a[2]).sort().join(';') + ')').join('|');
}
test('Adventure catalog appends exactly 20 original named species after the unchanged original20', () => {
  assert.deepEqual(Object.keys(PetArt.names), [...ORIGINAL, ...ADVENTURE]);
  assert.equal(new Set(Object.values(PetArt.names)).size,40);
  assert.equal(PetArt.names.gorilla, '岩臂大猩猩');
  assert.ok(Object.isFrozen(PetArt.names));
  assert.deepEqual(PetArt.stages,['破壳宝宝','元气运动','力量伙伴','出发旅行','飞行探索','智慧学者','星光守护']);
});
test('Adventure addition leaves all 140 original default SVG outputs byte-identical', () => {
  assert.equal(Object.keys(ORIGINAL_HASHES).length,140);
  for (const [key, expected] of Object.entries(ORIGINAL_HASHES)) {
    const [id,level] = key.split('/');
    assert.equal(hash(PetArt.render(id,Number(level))),expected,key);
  }
});
test('All 140 new SVGs parse as XML and use finite legal path data', () => {
  for (const id of ADVENTURE) for(let stage=1;stage<=7;stage++) {
    const svg=PetArt.render(id,stage), errors=[];
    const doc=new DOMParser({errorHandler:{warning:e=>errors.push(e),error:e=>errors.push(e),fatalError:e=>errors.push(e)}}).parseFromString(svg,'image/svg+xml');
    assert.deepEqual(errors,[],id+'/'+stage);
    assert.equal(doc.documentElement.tagName,'svg');
    assert.equal(doc.documentElement.getAttribute('data-pet'),id);
    assert.equal(doc.documentElement.getAttribute('data-stage'),String(stage));
    assert.ok(doc.getElementsByTagName('path').length>10,id+'/'+stage);
    assert.doesNotMatch(svg,/NaN|Infinity|undefined|null/);
    for(const p of Array.from(doc.getElementsByTagName('path'))) {
      const d=p.getAttribute('d'); assert.ok(d.trim(),id+'/'+stage);
      assert.doesNotMatch(d,/[^MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]/,id+'/'+stage+': '+d);
    }
  }
});
test('Every species has distinct anatomy after stripping all color, labels, and metadata',()=>{
  for(let stage=1;stage<=7;stage++) assert.equal(new Set([...ORIGINAL,...ADVENTURE].map(id=>geometry(PetArt.render(id,stage)))).size,40,'stage '+stage);
  const newForms=ADVENTURE.flatMap(id=>Array.from({length:7},(_,i)=>geometry(PetArt.render(id,i+1))));
  assert.equal(new Set(newForms).size,140);
  for(const id of ADVENTURE) assert.equal(new Set(Array.from({length:7},(_,i)=>geometry(PetArt.render(id,i+1)))).size,7,id);
});
test('Adventure stages preserve the render API, real levels, safe fallback and injection resistance',()=>{
  for(const id of ADVENTURE) {
    for(const lv of [8,20,1_000_000]) {
      const svg=PetArt.render(id,lv); assert.match(svg,/data-stage="7"/);
      assert.match(svg,new RegExp('data-level="'+lv+'"'));
      assert.equal(geometry(svg),geometry(PetArt.render(id,7)));
    }
    for(let stage=1;stage<=7;stage++) {
      const svg=PetArt.render(id,stage,{animated:true,className:'preview'});
      assert.doesNotMatch(svg,/<script|<image|<foreignObject|\s(?:href|src|id|on[a-z]+)=|url\(/i);
      assert.doesNotMatch(svg.replace('http://www.w3.org/2000/svg',''),/https?:\/\//);
    }
    const escaped=PetArt.render(id,1,{className:'\"><img src=x onerror=alert(1)>'});
    assert.doesNotMatch(escaped,/<img/);
  }
  for(const id of ['__proto__','constructor','toString','unknown',{},null]) assert.equal(PetArt.render(id,1),PetArt.render('owl',1));
});
