export const RUN_TIMING=Object.freeze({start:180000,scan:300000,execution:600000,planning:1800000,summary:1800000,retry:300000,unread:600000,escalation:300000});
const time=v=>typeof v==='number'?v:Date.parse(v);
export function dueRunActions(run,now){
  if(!['open','stopping'].includes(run.state))return [];
  if(!Number.isFinite(now))throw new TypeError('Invalid run clock');
  const out=[];const levels=['coordinator','overseer','person'];
  function escalation(kind,id,due,notifications,data){
    levels.forEach((target,index)=>{const at=due+index*RUN_TIMING.escalation;
      if(now>=at&&!notifications.includes(target))out.push({id:kind+':'+id+':'+target,kind,target,dueAt:at,...data});});
  }
  for(const a of run.attempts??[])if(!a.resolved&&a.confirmedAt==null)
    escalation('no_start',a.id,time(a.sentAt)+RUN_TIMING.start,a.notifications??[],{attemptId:a.id,role:a.role});
  for(const w of run.watches??[])if(!w.resolved)
    escalation('stalled',w.episodeId,time(w.lastStepAt)+RUN_TIMING[w.phase??run.mode],w.notifications??[],{attemptId:w.attemptId,role:w.role});
  for(const m of run.messages??[])for(const r of m.recipients)if(r.readAt==null){
    const due=time(m.sentAt);const data={messageId:m.id,recipientId:r.actorId};
    if(r.retriedAt==null&&now>=due+RUN_TIMING.retry)out.push({id:'retry:'+m.id+':'+r.actorId,kind:'unread_retry',dueAt:due+RUN_TIMING.retry,...data});
    escalation('unread',m.id+':'+r.actorId,due+RUN_TIMING.unread,r.notifications??[],data);
  }
  const slot=Math.floor((now-time(run.startedAt))/RUN_TIMING.summary);
  if(slot>(run.summarySlot??0))out.push({id:'summary:'+run.id+':'+slot,kind:'summary',target:'coordinator',slot,dueAt:time(run.startedAt)+slot*RUN_TIMING.summary});
  return out.sort((a,b)=>a.dueAt-b.dueAt||a.id.localeCompare(b.id));
}
export function runTaskEndState({report,processExited,cleanupVerified}){
  if(!['delivered','failed'].includes(report))return 'awaiting_report';
  if(processExited!==true)return 'awaiting_exit';
  if(cleanupVerified!==true)return 'cleanup_pending';
  return report==='delivered'?'done':'failed';
}
