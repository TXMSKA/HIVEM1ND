import assert from'node:assert/strict';import test from'node:test';import{validateRunsIn,launchChoice}from'../engine/service/runs-in.mjs';
const clients=[{id:'codex',connected:true,models:[{id:'verified-model',efforts:['high','xhigh'],modes:[]}]},
  {id:'lyra',connected:true,models:[{id:'lyra-base',efforts:[],modes:['fast','normal']},{id:'lyra-thinking',efforts:[],modes:['thinking']}]}];
test('stored external choice is exact and rejects silent fallback',()=>{
  const choice={client:'codex',model:'verified-model',effort:'xhigh',mode:null};
  assert.deepEqual(launchChoice({runsIn:choice},clients),choice);
  assert.throws(()=>validateRunsIn({...choice,effort:'max'},clients),e=>e.code==='unsupported_launch_choice');
  assert.throws(()=>validateRunsIn({...choice,client:'cursor'},clients),e=>e.code==='unsupported_launch_choice');
  assert.throws(()=>launchChoice({model:'verified-model'},clients),e=>e.code==='scope_unresolved');
});
test('local mode belongs to a resolvable installed model and has no effort',()=>{
  const choice={client:'lyra',model:'lyra-thinking',effort:null,mode:'thinking'};
  assert.deepEqual(validateRunsIn(choice,clients),choice);
  for(const change of [{mode:'normal'},{effort:'high'},{model:'not-installed'},{model:'qwen3.5:9b'}])
    assert.throws(()=>validateRunsIn({...choice,...change},clients),e=>e.code==='unsupported_launch_choice');
  assert.throws(()=>validateRunsIn({...choice,extra:true},clients),e=>e.code==='unsupported_launch_choice');
});
