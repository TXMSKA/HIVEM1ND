import assert from'node:assert/strict';import test from'node:test';import{RUN_TIMING,dueRunActions,runTaskEndState}from'../engine/service/run-policy.mjs';
const base={id:'run',state:'open',mode:'execution',startedAt:0,summarySlot:0,attempts:[],watches:[],messages:[]};
test('three-minute start and per-agent stalls escalate without resetting other agents',()=>{
  const run={...base,attempts:[{id:'a',role:'builder',sentAt:0,confirmedAt:null,notifications:[]}]};
  assert.deepEqual(dueRunActions(run,179999),[]);assert.equal(dueRunActions(run,180000)[0].target,'coordinator');
  assert.deepEqual(dueRunActions(run,780000).map(a=>a.target),['coordinator','overseer','person']);
  const watches=[{episodeId:'w1',attemptId:'1',role:'builder',lastStepAt:0},{episodeId:'w2',attemptId:'2',role:'reviewer',lastStepAt:599999}];
  assert.deepEqual(dueRunActions({...base,watches},600000).map(a=>a.role),['builder']);
  assert.equal(dueRunActions({...base,mode:'planning',watches},1799999).length,0);
  assert.equal(dueRunActions({...base,mode:'planning',watches},1800000).filter(a=>a.kind==='stalled').length,1);
  assert.equal(dueRunActions({...base,watches:[{...watches[0],phase:'planning'}]},600000).length,0);
  assert.equal(RUN_TIMING.scan,300000);
});
test('one unread retry precedes ordered alerts and recovery coalesces summary slots',()=>{
  const recipient={actorId:'reviewer',readAt:null,retriedAt:null,notifications:[]};
  const run={...base,messages:[{id:'m',sentAt:0,recipients:[recipient,{actorId:'builder',readAt:1}]}]};
  assert.equal(dueRunActions(run,299999).length,0);assert.equal(dueRunActions(run,300000)[0].kind,'unread_retry');
  recipient.retriedAt=300000;assert.deepEqual(dueRunActions(run,600000).map(a=>a.target),['coordinator']);
  recipient.notifications=['coordinator','overseer'];assert.equal(dueRunActions(run,1200000)[0].target,'person');
  recipient.readAt=1200001;const actions=dueRunActions(run,7200000);assert.equal(actions.length,1);assert.equal(actions[0].slot,4);
  assert.deepEqual(dueRunActions({...run,summarySlot:4},7200000),[]);
  assert.deepEqual(dueRunActions({...run,state:'completed'},7200000),[]);
});
test('report process exit and owned cleanup are independently required',()=>{
  assert.equal(runTaskEndState({processExited:true,cleanupVerified:true}),'awaiting_report');
  assert.equal(runTaskEndState({report:'delivered',cleanupVerified:true}),'awaiting_exit');
  assert.equal(runTaskEndState({report:'delivered',processExited:true}),'cleanup_pending');
  assert.equal(runTaskEndState({report:'delivered',processExited:true,cleanupVerified:true}),'done');
  assert.equal(runTaskEndState({report:'failed',processExited:true,cleanupVerified:true}),'failed');
});
