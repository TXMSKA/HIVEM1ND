import assert from'node:assert/strict';import test from'node:test';import{normalizeRunSignal}from'../engine/service/run-signals.mjs';
const base={id:'witness:1',kind:'start',source:'native',role:'builder',taskId:'project:shop:1',at:1000};
test('verified witnesses have fixed bounded metadata and no raw text',()=>{
  const signal=normalizeRunSignal({...base,kind:'step_start',step:'tests'});
  assert.equal(signal.at,'1970-01-01T00:00:01.000Z');assert.equal(signal.step,'tests');assert.equal(signal.taskId,'project:shop:1');
  assert.equal(normalizeRunSignal({...base,kind:'report',source:'relay',outcome:'delivered'}).outcome,'delivered');
});
test('byte chatter heartbeat arbitrary command and forged exits cannot be milestones',()=>{
  for(const change of [{output:'private fixture'},{kind:'heartbeat'},{kind:'exit'},{kind:'cleanup',source:'relay'},
    {kind:'report',source:'process',outcome:'delivered'},{at:'never'},{role:'executor'},{kind:'step_start',step:'arbitrary command'}])
    assert.throws(()=>normalizeRunSignal({...base,...change}),e=>e.code==='invalid_run_event');
});
