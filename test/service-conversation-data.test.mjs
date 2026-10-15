import assert from'node:assert/strict';import test from'node:test';import{authoredMessages,unreadByAgent,workElapsedMinutes}from'../engine/service/conversation-data.mjs';
const message={id:'m',channel:'message',authorId:'root:master',recipientIds:['project:shop:a','project:shop:b','project:shop:b']};
test('bootstrap prompts and work never become chat or inbox counts',()=>{
  const records=[message,{...message},{...message,id:'boot',channel:'bootstrap'},{...message,id:'step',channel:'work'}];
  assert.deepEqual(authoredMessages(records),[message]);assert.deepEqual(unreadByAgent(records,[]),{'project:shop:a':1,'project:shop:b':1});
});
test('only each recipient acknowledgment clears its own unread message',()=>{
  assert.deepEqual(unreadByAgent([message],[{messageId:'m',readerId:'root:master'}]),{'project:shop:a':1,'project:shop:b':1});
  assert.deepEqual(unreadByAgent([message],[{messageId:'m',readerId:'project:shop:a'}]),{'project:shop:b':1});
  assert.deepEqual(unreadByAgent([message],[{messageId:'m',readerId:'project:shop:a'},{messageId:'m',readerId:'project:shop:b'}]),{});
});
test('elapsed work uses the actual step start and never implies progress or completion',()=>{
  const record={state:'busy',at:'2026-10-14T11:10:00.000Z'};
  assert.equal(workElapsedMinutes(record,Date.parse('2026-10-14T11:12:00.000Z')),2);
  assert.equal(workElapsedMinutes({...record,state:'done'},Date.now()),null);
  assert.equal(workElapsedMinutes({...record,at:'unknown'},Date.now()),null);
});
