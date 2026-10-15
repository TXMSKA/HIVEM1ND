export function authoredMessages(records){
  const seen=new Set();return records.filter(record=>{
    if(record.channel!=='message'||seen.has(record.id))return false;
    seen.add(record.id);return true;
  });
}
export function unreadByAgent(records,receipts){
  const read=new Set(receipts.map(r=>r.messageId+'\0'+r.readerId)),counts=new Map();
  for(const record of authoredMessages(records))for(const recipient of new Set(record.recipientIds??[])){
    if(recipient===record.authorId||read.has(record.id+'\0'+recipient))continue;
    counts.set(recipient,(counts.get(recipient)??0)+1);
  }
  return Object.fromEntries([...counts].sort(([a],[b])=>a.localeCompare(b)));
}
export function workElapsedMinutes(record,now){
  if(record.state!=='busy')return null;
  const start=Date.parse(record.at);if(!Number.isFinite(start)||!Number.isFinite(now))return null;
  return Math.max(0,Math.floor((now-start)/60000));
}
