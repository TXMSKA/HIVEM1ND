import{CoreError,canonicalJson}from'./identity.mjs';
const roles=new Set(['coordinator','planner','builder','reviewer']);
const fail=(code)=>{throw new CoreError(code==='invalid_extension'?422:409,code,'The run budget event was rejected.');};
export function createRunBudget(base){
  if(!Number.isSafeInteger(base)||base<1||base>10000)fail('invalid_extension');
  return{base,messages:[],extensions:[],events:[]};
}
export function projectRunBudget(ledger){
  const extra=ledger.extensions.reduce((n,e)=>n+e.count,0);
  return{base:ledger.base,used:ledger.messages.length,extra,roleExtra:ledger.extensions.filter(e=>e.authority==='roles').reduce((n,e)=>n+e.count,0),limit:ledger.base+extra};
}
export function applyRunBudget(ledger,event){
  if(!event||typeof event.id!=='string'||!event.id||event.id.length>128)fail('invalid_extension');
  const encoded=canonicalJson(event),prior=ledger.events.find(e=>e.id===event.id);
  if(prior){if(prior.encoded!==encoded)fail('revision_conflict');return ledger;}
  const next=structuredClone(ledger),budget=projectRunBudget(ledger);
  if(event.kind==='spend'){
    if(typeof event.messageId!=='string'||!event.messageId)fail('invalid_extension');
    if(!next.messages.includes(event.messageId)){if(budget.used>=budget.limit)fail('budget_exhausted');next.messages.push(event.messageId);}
  }else if(event.kind==='extend'){
    if(!Number.isSafeInteger(event.count)||event.count<1||event.count>10000||!roles.has(event.requester)
      ||typeof event.reason!=='string'||!event.reason.trim()||event.reason.length>1000||/[\x00-\x1f\x7f]/.test(event.reason))fail('invalid_extension');
    if(event.authority==='roles'){
      if(!roles.has(event.approver)||event.approver===event.requester)fail('invalid_extension');
      if(budget.roleExtra+event.count>Math.floor(ledger.base/2))fail('extension_approval_required');
    }else if(event.authority!=='person'||typeof event.approvalId!=='string'||!event.approvalId)fail('invalid_extension');
    if(typeof event.extensionId!=='string'||!event.extensionId||next.extensions.some(e=>e.extensionId===event.extensionId))fail('revision_conflict');
    next.extensions.push({extensionId:event.extensionId,count:event.count,reason:event.reason.trim(),requester:event.requester,approver:event.approver??null,authority:event.authority,approvalId:event.approvalId??null});
  }else fail('invalid_extension');
  next.events.push({id:event.id,encoded});return next;
}
