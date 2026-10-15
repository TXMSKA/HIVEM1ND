import assert from'node:assert/strict';import test from'node:test';import{clusterCamera,interpolateCamera}from'../gui/app/cluster-geometry.mjs';
test('all clusters remain inside the fit even beyond the old minimum zoom',()=>{
  const boxes=[{x:-10000,y:-6000,width:300,height:200},{x:12000,y:7000,width:300,height:200}],viewport={width:736,height:818};
  const camera=clusterCamera(boxes,viewport);assert.ok(camera.zoom<0.25);
  for(const b of boxes){assert.ok(b.x*camera.zoom+camera.x>=47.99);assert.ok(b.y*camera.zoom+camera.y>=47.99);
    assert.ok((b.x+b.width)*camera.zoom+camera.x<=viewport.width-47.99);assert.ok((b.y+b.height)*camera.zoom+camera.y<=viewport.height-47.99);}
});
test('cluster flight and reduced-motion final position use one deterministic target',()=>{
  const from={x:0,y:0,zoom:1},to=clusterCamera([{x:20,y:48,width:720,height:690}],{width:736,height:818});
  assert.deepEqual(interpolateCamera(from,to,0),from);assert.deepEqual(interpolateCamera(from,to,1),to);
  assert.deepEqual(interpolateCamera(from,to,2),to);assert.deepEqual(clusterCamera([],{width:736,height:818}),from);
});
