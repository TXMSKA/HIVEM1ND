import{createOperation,request}from'./api.mjs';
async function write(api,path,body,params,retained){
  const operation=retained??createOperation({method:'POST',path,body,params});
  try{return{...await request(api,operation.method,operation.path,{operation}),operation};}
  catch(error){if(error&&typeof error==='object'&&error.operation==null)error.operation=operation;throw error;}
}
async function patch(api,path,body,params,retained){
  const operation=retained??createOperation({method:'PATCH',path,body,params});
  try{return{...await request(api,operation.method,operation.path,{operation}),operation};}
  catch(error){if(error&&typeof error==='object'&&error.operation==null)error.operation=operation;throw error;}
}
export const getClusters=(api,query={})=>request(api,'GET','/clusters',{query});
export const getClusterGit=(api,clusterId,machine)=>request(api,'GET','/clusters/:clusterId/git',{params:{clusterId},query:{machine}});
export const getClusterChanges=(api,clusterId,machine,query={})=>request(api,'GET','/clusters/:clusterId/changes',{params:{clusterId},query:{...query,machine}});
export const getSessionContext=(api,sessionId)=>request(api,'GET','/sessions/:sessionId/context',{params:{sessionId}});
export const getSessionCheckout=(api,sessionId)=>request(api,'GET','/sessions/:sessionId/checkout',{params:{sessionId}});
export const getSessionWork=(api,sessionId,query={})=>request(api,'GET','/sessions/:sessionId/work',{params:{sessionId},query});
export const getSessionTranscript=(api,sessionId,query={})=>request(api,'GET','/sessions/:sessionId/transcript',{params:{sessionId},query});
export const getRun=(api,runId)=>request(api,'GET','/runs/:runId',{params:{runId}});
export const getRunLog=(api,runId,query={})=>request(api,'GET','/runs/:runId/log',{params:{runId},query});
export function createCluster(api,input,retained=null){
  const{title,parentId,link,machine}=input;return write(api,'/clusters',{title,parentId,link,machine,confirmed:true},undefined,retained);
}
export function answerRepositoryOffer(api,offerId,input,retained=null){
  const{machine,repositoryIds,confirmed,expectedRevision}=input;return write(api,'/discovery/offers/:offerId/answer',{machine,repositoryIds,confirmed,expectedRevision},{offerId},retained);
}
export function createClusterAgent(api,clusterId,input,retained=null){
  const{machine,role,runsIn,useAsDefault,expectedRevision}=input;
  // Only a custom role carries a name and a description; the service refuses them on any other role.
  const custom=role==='custom'?{roleName:input.roleName,roleDescription:input.roleDescription}:{};
  return write(api,'/clusters/:clusterId/agents',{machine,role,runsIn,useAsDefault,expectedRevision,...custom},{clusterId},retained);
}
export function createOverseer(api,input,retained=null){
  const{machine,runsIn,fresh,expectedRevision}=input;return write(api,'/overseer',{machine,runsIn,fresh,expectedRevision},undefined,retained);
}
export function setRunsIn(api,unitId,input,retained=null){
  const{machine,runsIn,useAsDefault,expectedRevision}=input;return patch(api,'/units/:unitId/runs-in',{machine,runsIn,useAsDefault,expectedRevision},{unitId},retained);
}
export function changeContext(api,sessionId,input,retained=null){
  const{action,expectedRevision}=input;return write(api,'/sessions/:sessionId/context',{action,expectedRevision},{sessionId},retained);
}
export function createPlan(api,input,retained=null){
  const{machine,clusterId,chatId,title,branch,mode,tasks,roles,expectedChatRevision}=input;
  return write(api,'/plans',{machine,clusterId,chatId,title,branch,mode,tasks,roles,expectedChatRevision},undefined,retained);
}
export function editPlan(api,planId,input,retained=null){
  const body={expectedRevision:input.expectedRevision};for(const key of['title','branch','mode','tasks','roles'])if(Object.hasOwn(input,key))body[key]=input[key];
  return patch(api,'/plans/:planId',body,{planId},retained);
}
export const runPlan=(api,planId,expectedRevision,retained=null)=>write(api,'/plans/:planId/run',{confirmed:true,expectedRevision},{planId},retained);
export function controlPlan(api,runId,input,retained=null){
  const body={action:input.action,expectedRevision:input.expectedRevision};
  for(const key of['attemptId','role','assignment','messageId','recipientId'])if(Object.hasOwn(input,key))body[key]=input[key];
  return write(api,'/runs/:runId/control',body,{runId},retained);
}
export function grantAutomaticWork(api,input,retained=null){
  const body=retained?undefined:{machine:input.machine,unitId:input.unitId,client:input.client,action:'native.automatic',expectedRevision:input.expectedRevision};
  return write(api,'/settings/permissions',body,undefined,retained);
}
export async function revokeAutomaticWork(api,permissionId,input,retained=null){
  const operation=retained??createOperation({method:'DELETE',path:'/settings/permissions/:permissionId',params:{permissionId},body:{machine:input.machine,expectedRevision:input.expectedRevision}});
  try{return{...await request(api,operation.method,operation.path,{operation}),operation};}
  catch(error){if(error&&typeof error==='object'&&error.operation==null)error.operation=operation;throw error;}
}
export const stopSessionStep=(api,sessionId,retained=null)=>write(api,'/sessions/:sessionId/stop-step',{},{sessionId},retained);
export const openClusterEditor=(api,clusterId,machine,retained=null)=>write(api,'/clusters/:clusterId/open-editor',{machine},{clusterId},retained);
export function createClusterLink(api,input,retained=null){
  const{machine,kind,path,expectedReportRevision}=input;
  return write(api,'/cluster-links',{machine,kind,path,expectedReportRevision},undefined,retained);
}
export async function removeClusterLink(api,clusterId,input,retained=null){
  const{machine,expectedRevision}=input;
  const operation=retained??createOperation({method:'DELETE',path:'/cluster-links/:clusterId',params:{clusterId},body:{machine,confirmed:true,expectedRevision}});
  try{return{...await request(api,operation.method,operation.path,{operation}),operation};}
  catch(error){if(error&&typeof error==='object'&&error.operation==null)error.operation=operation;throw error;}
}
