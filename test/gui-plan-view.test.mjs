import assert from'node:assert/strict';import test from'node:test';import{renderPlanCard}from'../gui/app/plan-view.mjs';import{document,nodes,copy}from'./add-dom-fixture.mjs';
const model={language:'en',title:'cart empty state',branch:'cart-empty',phase:'ready',busy:false,problem:null,budget:null,extensions:[],
  tasks:[{id:'project:shop:1',title:'Empty state on the cart page',actor:'executor-shop',runsInLabel:'connected client, selected model, high',state:'todo'}]};
test('ready card exposes exact assignment Run and Edit without executing a task',()=>{
  let ran=0;const card=renderPlanCard(document,model,{onRun(){ran++;}});
  assert.match(copy(card),/Plan: cart empty state/);assert.match(copy(card),/cart-empty/);
  const controls=nodes(card).filter(n=>n.getAttribute('data-action'));
  assert.deepEqual(controls.map(n=>n.getAttribute('data-action')),['edit-assignment','run-plan','edit-plan']);
  assert.equal(ran,0);controls[1].listeners.click();assert.equal(ran,1);
});
test('running and warning states retain the same tasks and expose only their actions',()=>{
  const running=renderPlanCard(document,{...model,phase:'running',tasks:[{...model.tasks[0],state:'busy',elapsedMinutes:4}]},{});
  assert.match(copy(running),/4 min/);assert.match(copy(running),/Each task is committed on cart-empty/);
  const warning=renderPlanCard(document,{...model,language:'es',phase:'warning',problem:{kind:'stalled',agent:'executor-shop',lead:'overlord-shop',minutes:10},
    tasks:[{...model.tasks[0],state:'stuck',elapsedMinutes:14}]},{});
  assert.match(copy(warning),/no mostró avances durante 10 minutos/);
  assert.deepEqual(nodes(warning).filter(n=>n.tagName==='BUTTON').map(n=>n.getAttribute('data-action')),['stop-step','retry-task']);
  for(const[kind,action]of [['noStart','retry-start'],['unreadProblem','resend']]){
    const view=renderPlanCard(document,{...model,phase:'warning',problem:{kind,agent:'executor-shop',lead:'overlord-shop',minutes:10}},{});
    assert.deepEqual(nodes(view).filter(n=>n.tagName==='BUTTON').map(n=>n.getAttribute('data-action')),['stop-plan',action]);
  }
  const unsafe=renderPlanCard(document,{...model,title:'<script>fixture</script>'},{});
  assert.equal(nodes(unsafe).some(n=>n.tagName==='SCRIPT'),false);
});
