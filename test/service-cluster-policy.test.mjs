import assert from 'node:assert/strict';import test from 'node:test';
import{clusterMembers,withinClusterRoot}from'../engine/service/cluster-policy.mjs';
test('nested scope deduplicates members and excludes archived agents',()=>{
  const units=[{id:'root:master'},{id:'project:shop:a'},{id:'project:shop:b'},{id:'project:shop:c',removed:true}];
  const clusters=[{id:'folder',parentId:null,members:['root:master','project:shop:a']},{id:'repo',parentId:'folder',members:['project:shop:a','project:shop:b','project:shop:c']},
    {id:'deleted',parentId:'folder',members:['project:shop:b'],deleted:true}];
  assert.deepEqual(clusterMembers(clusters,['folder','repo'],units),['project:shop:a','project:shop:b']);
  assert.throws(()=>clusterMembers(clusters,['deleted'],units),e=>e.code==='cluster_changed');
  assert.throws(()=>clusterMembers([{id:'a',parentId:'b',members:[]},{id:'b',parentId:'a',members:[]}],['a'],[]),e=>e.code==='cluster_cycle');
});
test('path boundary rejects siblings relative paths and an unlinked cluster',()=>{
  assert.equal(withinClusterRoot('C:/Web/shop','c:/web/SHOP/src/cart.mjs'),true);
  assert.equal(withinClusterRoot('C:/Web/shop','C:/Web/shop-extra/cart.mjs'),false);
  assert.equal(withinClusterRoot('C:/Web/shop','C:/Web/shop/../other/cart.mjs'),false);
  assert.equal(withinClusterRoot(null,'C:/Web/shop'),false);
  assert.equal(withinClusterRoot('/web/shop','relative','linux'),false);
  assert.equal(withinClusterRoot('/web/shop','/web/Shop/a','linux'),false);
});
