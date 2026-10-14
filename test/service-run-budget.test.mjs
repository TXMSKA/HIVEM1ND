import assert from'node:assert/strict';import test from'node:test';import{createRunBudget,projectRunBudget,applyRunBudget}from'../engine/service/run-budget.mjs';
const extra={id:'e',kind:'extend',extensionId:'x',count:2,reason:'Clarify the empty state',requester:'builder',approver:'planner',authority:'roles'};
test('retries spend one message and changed event identity is rejected',()=>{
  let ledger=createRunBudget(1);const send={id:'s',kind:'spend',messageId:'m'};
  ledger=applyRunBudget(ledger,send);assert.equal(applyRunBudget(ledger,send),ledger);
  ledger=applyRunBudget(ledger,{...send,id:'s2'});assert.equal(projectRunBudget(ledger).used,1);
  assert.throws(()=>applyRunBudget(ledger,{...send,messageId:'other'}),e=>e.code==='revision_conflict');
  assert.throws(()=>applyRunBudget(ledger,{id:'s3',kind:'spend',messageId:'m2'}),e=>e.code==='budget_exhausted');
});
test('odd plan count rounds half down and two distinct roles agree',()=>{
  const ledger=applyRunBudget(createRunBudget(5),extra);assert.equal(projectRunBudget(ledger).limit,7);
  assert.throws(()=>applyRunBudget(ledger,{...extra,id:'e2',extensionId:'x2',count:1}),e=>e.code==='extension_approval_required');
  assert.throws(()=>applyRunBudget(createRunBudget(10),{...extra,approver:'builder'}),e=>e.code==='invalid_extension');
  assert.throws(()=>applyRunBudget(createRunBudget(10),{...extra,reason:' '}),e=>e.code==='invalid_extension');
});
test('confirmed person extension never reapplies or increases the role allowance',()=>{
  let ledger=applyRunBudget(createRunBudget(10),{...extra,count:5});
  const event={...extra,id:'p',extensionId:'p',authority:'person',approvalId:'approved-once'};
  ledger=applyRunBudget(ledger,event);assert.equal(applyRunBudget(ledger,event),ledger);
  assert.deepEqual(projectRunBudget(ledger),{base:10,used:0,extra:7,roleExtra:5,limit:17});
  assert.throws(()=>applyRunBudget(ledger,{...event,id:'p2'}),e=>e.code==='revision_conflict');
});
