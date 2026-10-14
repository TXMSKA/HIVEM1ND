import{CoreError}from'./identity.mjs';
const keys=new Set(['id','kind','source','role','taskId','at','step','outcome']);
const kinds=new Set(['start','step_start','step_end','report','exit','cleanup']);
const roles=new Set(['coordinator','planner','builder','reviewer']);
const sources=new Set(['native','hook','relay','process']);
const steps=new Set(['tests','build','edit','plan','review','work']);
export function normalizeRunSignal(value){
  const invalid=()=>{throw new CoreError(422,'invalid_run_event','Invalid bounded run evidence.');};
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.has(k)))invalid();
  if(typeof value.id!=='string'||!value.id||value.id.length>128||/[\x00-\x1f\x7f]/.test(value.id)
    ||!kinds.has(value.kind)||!roles.has(value.role)||!sources.has(value.source))invalid();
  const at=typeof value.at==='number'?value.at:typeof value.at==='string'?Date.parse(value.at):NaN;
  if(!Number.isFinite(at)||!Number.isFinite(new Date(at).getTime()))invalid();
  if(value.taskId!=null&&(typeof value.taskId!=='string'||!value.taskId||value.taskId.length>256))invalid();
  const step=value.step??null,outcome=value.outcome??null;
  if(value.kind.startsWith('step_')?!steps.has(step):step!==null)invalid();
  if(value.kind==='report'?!['delivered','failed'].includes(outcome):outcome!==null)invalid();
  if(['exit','cleanup'].includes(value.kind)&&value.source!=='process')invalid();
  if(value.kind==='report'&&value.source==='process')invalid();
  return{eventId:value.id,kind:value.kind,source:value.source,role:value.role,taskId:value.taskId??null,at:new Date(at).toISOString(),step,outcome};
}
