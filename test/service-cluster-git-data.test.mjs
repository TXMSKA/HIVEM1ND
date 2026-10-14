import assert from'node:assert/strict';import test from'node:test';import{publicGitRemote,parseGitStatus}from'../engine/service/cluster-git-data.mjs';
test('remote projection removes user information and opaque query and fragment',()=>{
  const url=new URL('https://example.com/shop.git');url.username='fixture';url.password='fixture';url.search='?fixture=fixture';url.hash='fixture';
  assert.equal(publicGitRemote(url.toString()),'https://example.com/shop.git');
  assert.equal(publicGitRemote('file:///private/repo'),null);assert.equal(publicGitRemote('not a remote'),null);
});
test('NUL status retains renames and bounds malformed or oversized data',()=>{
  assert.deepEqual(parseGitStatus(' M web/cart.mjs\0R  new name.mjs\0old name.mjs\0?? other.mjs\0'),
    [{path:'web/cart.mjs',status:' M',from:null},{path:'new name.mjs',status:'R ',from:'old name.mjs'},{path:'other.mjs',status:'??',from:null}]);
  assert.throws(()=>parseGitStatus('R  missing.mjs\0'),e=>e.code==='git_unavailable');
  assert.throws(()=>parseGitStatus('x'.repeat(1048577)),e=>e.code==='git_unavailable');
});
