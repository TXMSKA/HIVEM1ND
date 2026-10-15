import assert from'node:assert/strict';import test from'node:test';import{createApi}from'../gui/app/api.mjs';import*as ops from'../gui/app/start-api.mjs';
const id='00000000-0000-8000-8000-000000000001',choice={client:'codex',model:'fixture-model',effort:'high',mode:null};
function fixture(statuses=[]){const calls=[];const api=createApi({location:{origin:'http://127.0.0.1:4310',hash:''},history:{replaceState(){}},fetch:async(url,options)=>{
  calls.push({path:new URL(url).pathname,query:Object.fromEntries(new URL(url).searchParams),method:options.method,body:options.body?JSON.parse(options.body):null,key:options.headers['Idempotency-Key']});
  const status=statuses.shift()??200;return new Response(JSON.stringify({contract:'hivem1nd-gui-v3',data:{id},meta:{requestId:'fixture',readAt:'2026-10-14T00:00:00.000Z',eventCursor:'1',sync:'local'},
    ...(status>=400?{error:{code:'service_unavailable',message:'Service unavailable'}}:{})}),{status,headers:{'Content-Type':'application/json'}});}});
  api.token='public-fixture-token';return{api,calls};}
test('browser operations expose the exact cluster plan and context routes',async()=>{
  const{api,calls}=fixture();await ops.getClusters(api);await ops.getClusterGit(api,id,'DESKTOP');await ops.getClusterChanges(api,id,'DESKTOP');
  await ops.getSessionWork(api,id);await ops.getSessionTranscript(api,id);await ops.getRun(api,id);await ops.getRunLog(api,id);
  await ops.createCluster(api,{title:'ideas',parentId:null,link:{kind:'none'},machine:'DESKTOP',extra:true});
  await ops.answerRepositoryOffer(api,id,{machine:'DESKTOP',repositoryIds:['repo'],confirmed:true,expectedRevision:'r'});
  await ops.createClusterAgent(api,id,{machine:'DESKTOP',role:'executor',runsIn:choice,useAsDefault:false,expectedRevision:'r'});
  await ops.createOverseer(api,{machine:'DESKTOP',runsIn:choice,fresh:true,expectedRevision:null});await ops.setRunsIn(api,'root:overseer',{machine:'DESKTOP',runsIn:choice,useAsDefault:false,expectedRevision:'r'});
  await ops.changeContext(api,id,{action:'compact',expectedRevision:'r'});await ops.createPlan(api,{machine:'DESKTOP',clusterId:id,chatId:id,title:'Cart',branch:'cart-empty',mode:'execution',tasks:[],roles:{},expectedChatRevision:'r'});
  await ops.editPlan(api,id,{title:'Changed',expectedRevision:'r',executable:'excluded'});await ops.runPlan(api,id,'r');
  await ops.controlPlan(api,id,{action:'retry_task',attemptId:id,expectedRevision:'r',pid:42});await ops.openClusterEditor(api,id,'DESKTOP');
  await ops.getSessionContext(api,id);await ops.createClusterLink(api,{machine:'DESKTOP',kind:'folder',path:'C:/Web',expectedReportRevision:'r'});
  await ops.removeClusterLink(api,id,{machine:'DESKTOP',expectedRevision:'r'});
  assert.deepEqual(calls.slice(0,7).map(c=>c.path),['/clusters','/clusters/'+id+'/git','/clusters/'+id+'/changes','/sessions/'+id+'/work','/sessions/'+id+'/transcript','/runs/'+id,'/runs/'+id+'/log'].map(p=>'/api/v1'+p));
  assert.deepEqual(calls[7].body,{title:'ideas',parentId:null,link:{kind:'none'},machine:'DESKTOP',confirmed:true});
  assert.deepEqual(calls[14].body,{title:'Changed',expectedRevision:'r'});
  assert.deepEqual(calls[15].body,{confirmed:true,expectedRevision:'r'});
  assert.deepEqual(calls[16].body,{action:'retry_task',attemptId:id,expectedRevision:'r'});
  assert.ok(calls.slice(7).filter(c=>c.method!=='GET').every(c=>c.key));
  assert.equal(calls[10].body.machine,'DESKTOP');assert.equal(calls[17].body.machine,'DESKTOP'); assert.equal(calls[1].query.machine,'DESKTOP'); assert.equal(calls[2].query.machine,'DESKTOP');
  assert.equal(calls[18].path,'/api/v1/sessions/'+id+'/context');
  assert.deepEqual(calls[19].body,{machine:'DESKTOP',kind:'folder',path:'C:/Web',expectedReportRevision:'r'});
  assert.equal(calls[20].method,'DELETE');assert.equal(calls[20].body.confirmed,true);
  await assert.rejects(ops.getRun(api,'../foreign'));
});
test('retry retains the approved plan revision and original operation identity',async()=>{
  const{api,calls}=fixture([503,202]);let retained;
  try{await ops.runPlan(api,id,'approved-revision');}catch(error){retained=error.operation;}
  assert.ok(retained);await ops.runPlan(api,id,'changed-revision',retained);
  assert.equal(calls[0].key,calls[1].key);assert.deepEqual(calls[0].body,calls[1].body);
  assert.equal(calls[1].body.expectedRevision,'approved-revision');
});
