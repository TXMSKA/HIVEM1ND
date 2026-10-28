import {CoreError} from './identity.mjs';
export function validateRunsIn(choice, clients) {
  const keys=['client','model','effort','mode'];
  const invalid=()=>{throw new CoreError(422,'unsupported_launch_choice','The selected launch choice cannot be applied.');};
  if(!choice||Object.keys(choice).length!==4||Object.keys(choice).some(k=>!keys.includes(k)))invalid();
  const client=clients.find(c=>c.id===choice.client&&c.connected===true);
  const model=client?.models.find(m=>m.id===choice.model);if(!model)invalid();
  if(choice.client==='lyra'){
    if(choice.effort!==null||!['fast','normal','thinking'].includes(choice.mode)||!model.modes.includes(choice.mode))invalid();
  }else if(choice.mode!==null||typeof choice.effort!=='string'||!model.efforts.includes(choice.effort))invalid();
  return Object.freeze({client:choice.client,model:choice.model,effort:choice.effort,mode:choice.mode});
}
export function launchChoice(unit, clients) {
  if(!unit.runsIn)throw new CoreError(409,'scope_unresolved','Choose Runs in before launching this agent.');
  return validateRunsIn(unit.runsIn,clients);
}
// How a connected client is held to its boundary: 'confined' (it confines itself, or ONEM1ND does)
// or 'supervised' (Claude Code and Cursor, which cannot be confined on Windows; every native change asks first).
// A report that names no boundary keeps the older meaning of scopeEnforced. Anything else, or a client that is
// not connected, has no boundary and fails closed.
export function launchBoundary(report) {
  if (!report || report.connected !== true) return null;
  const kind = report.boundary === undefined ? (report.scopeEnforced === true ? 'confined' : null) : report.boundary;
  if (kind === 'confined') return report.scopeEnforced === true ? kind : null;
  if (kind === 'supervised') return report.scopeEnforced !== true && ['claude', 'cursor'].includes(report.id) ? kind : null;
  return null;
}
