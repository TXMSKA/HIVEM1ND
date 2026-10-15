import{element}from'./components.mjs';import{startText}from'./start-copy.mjs';
function svg(document,path,size=14){
  const node=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const[key,value]of Object.entries({viewBox:'0 0 24 24',width:size,height:size,'aria-hidden':'true',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round'}))node.setAttribute(key,value);
  const shape=document.createElementNS('http://www.w3.org/2000/svg','path');shape.setAttribute('d',path);node.append(shape);return node;
}
const paths={play:'M7 4l13 8-13 8z',edit:'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',stop:'M6 6h12v12H6z',retry:'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',check:'M5 12l4.5 4.5L19 7',alert:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v6M12 16.5v.5',chevron:'M6 9l6 6 6-6',graph:'M8.5 6a2.5 2.5 0 1 0-5 0a2.5 2.5 0 1 0 5 0M20.5 8a2.5 2.5 0 1 0-5 0a2.5 2.5 0 1 0 5 0M11.5 18a2.5 2.5 0 1 0-5 0a2.5 2.5 0 1 0 5 0M8.3 7l7.4.8M7 8.4l1.4 7.2M16.6 10l-5.8 6.3',list:'M9 6h11M9 12h11M9 18h11M4 6h.1M4 12h.1M4 18h.1'};
function action(document,text,id,glyph,primary,busy,callback){
  return element(document,'button',{type:'button',class:'plan-action'+(primary?' is-primary':''),'data-action':id,disabled:busy?'':null,'aria-busy':busy?'true':null,onclick:callback},
    busy?element(document,'span',{class:'spinner','aria-hidden':'true'}):svg(document,paths[glyph]),element(document,'span',{text}));
}
export function renderPlanCard(document,model,actions={}){
  const t=(key,values)=>startText(model.language,key,values);
  const root=element(document,'section',{class:'plan-card'+(model.phase==='warning'?' is-warning':''),'aria-label':t('plan',{title:model.title})});
  root.append(element(document,'header',{class:'plan-title'},svg(document,paths.list,15),
    element(document,'strong',{text:t('plan',{title:model.title})}),element(document,'span',{class:'plan-branch'},svg(document,paths.graph,11),element(document,'span',{text:model.branch}))));
  for(const[ordinal,task]of model.tasks.entries()){
    let mark;
    if(model.phase==='ready')mark=element(document,'span',{class:'plan-number',text:ordinal+1});
    else if(task.state==='busy')mark=element(document,'span',{class:'spinner plan-state','aria-label':t('busy'),role:'status'});
    else if(task.state==='done')mark=element(document,'span',{class:'plan-state is-done','aria-label':t('done')},svg(document,paths.check,12));
    else if(task.state==='stuck'||task.state==='failed')mark=element(document,'span',{class:'plan-state is-stuck','aria-label':t(task.state)},svg(document,paths.alert,17));
    else mark=element(document,'span',{class:'plan-state is-pending','aria-label':t('pending')});
    const assignment=element(document,model.phase==='ready'?'button':'div',{class:'plan-assignment',type:model.phase==='ready'?'button':null,
      'data-action':model.phase==='ready'?'edit-assignment':null,'aria-label':model.phase==='ready'?t('edit')+': '+task.title:null,
      onclick:model.phase==='ready'?()=>actions.onAssignment?.(task.id):null},
      element(document,'span',{class:'plan-actor',text:task.actor}),element(document,'span',{text:task.runsInLabel}),
      model.phase==='ready'?svg(document,paths.chevron,12):null);
    const elapsed=task.elapsedMinutes!=null?t('minutes',{count:task.elapsedMinutes}):task.endedLabel??'';
    root.append(element(document,'div',{class:'plan-task','data-task-id':task.id,'data-state':task.state},mark,
      element(document,'div',{class:'plan-task-body'},element(document,'div',{class:'plan-task-title',text:task.title}),assignment),
      elapsed?element(document,'span',{class:'plan-time',text:elapsed}):null));
  }
  if(model.problem)root.append(element(document,'p',{class:'plan-problem',role:'status',text:t(model.problem.kind,model.problem)}));
  if(model.budget)root.append(element(document,'p',{class:'plan-budget',text:t('budget',model.budget)}));
  for(const extra of model.extensions??[])root.append(element(document,'p',{class:'plan-budget',text:t('extra',extra)}));
  const controls=element(document,'div',{class:'plan-actions'});
  if(model.phase==='ready'){
    controls.append(action(document,t('run'),'run-plan','play',true,model.busy,()=>actions.onRun?.()),
      action(document,t('edit'),'edit-plan','edit',false,model.busy,()=>actions.onEdit?.()),
      element(document,'span',{class:'plan-note',text:t('editableHint')}));
  }else if(model.phase==='warning'){
    if(model.problem?.kind==='stalled')controls.append(
      action(document,t('stopStep'),'stop-step','stop',true,model.busy,()=>actions.onStopStep?.()),
      action(document,t('retryTask'),'retry-task','retry',false,model.busy,()=>actions.onRetryTask?.()));
    else controls.append(action(document,t('stop'),'stop-plan','stop',true,model.busy,()=>actions.onStop?.()),
      action(document,t('retry'),model.problem?.kind==='noStart'?'retry-start':'resend','retry',false,model.busy,
        ()=>model.problem?.kind==='noStart'?actions.onRetryStart?.():actions.onResend?.()));
  }else{
    controls.append(action(document,t('stop'),'stop-plan','stop',false,model.busy,()=>actions.onStop?.()),
      element(document,'span',{class:'plan-note',text:t('commitsHint',{branch:model.branch})}));
  }
  root.append(controls);return root;
}
