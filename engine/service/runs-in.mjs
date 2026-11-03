import {CoreError} from './identity.mjs';
// `account` names one of the client's several accounts; absent means the default account, so older records stay valid.
// A choice that names the default account is stored without the key.
const ACCOUNT_CLIENTS=['claude','codex'];
export function choiceAccount(choice){return typeof choice?.account==='string'&&choice.account!=='default'?choice.account:null;}
export function withoutAccount(choice){if(!choice||!Object.hasOwn(choice,'account'))return choice;const {account,...rest}=choice;return rest;}
// The report of one account standing for its client, so a launch can check a pick against that account alone.
export function accountClients(report,account){
  if(!account||!report)return report?[report]:[];
  return [{...report,accounts:[{id:account,label:account,connected:report.connected,models:report.models,quota:report.quota}]}];
}
export function validateRunsIn(choice, clients) {
  const keys=['client','model','effort','mode','account'];
  const invalid=()=>{throw new CoreError(422,'unsupported_launch_choice','The selected launch choice cannot be applied.');};
  if(!choice||Object.keys(choice).some(k=>!keys.includes(k))||Object.keys(choice).filter(k=>k!=='account').length!==4)invalid();
  if(Object.hasOwn(choice,'account')&&(typeof choice.account!=='string'||!choice.account||!ACCOUNT_CLIENTS.includes(choice.client)))invalid();
  const account=choiceAccount(choice);
  const client=clients.find(c=>c.id===choice.client&&c.connected===true);
  const source=account===null?client:client?.accounts?.find(a=>a.id===account&&a.connected!==false);
  const model=source?.models.find(m=>m.id===choice.model);if(!model)invalid();
  if(choice.client==='lyra'){
    if(choice.effort!==null||!['fast','normal','thinking'].includes(choice.mode)||!model.modes.includes(choice.mode))invalid();
  }else if(choice.mode!==null||typeof choice.effort!=='string'||!model.efforts.includes(choice.effort))invalid();
  return Object.freeze({client:choice.client,model:choice.model,effort:choice.effort,mode:choice.mode,...(account===null?{}:{account})});
}
// A pick checked against the report of the one account it runs on.
export function launchChoiceOn(runsIn, report) {
  const account=choiceAccount(runsIn);
  const choice=launchChoice({runsIn:withoutAccount(runsIn)},report?[report]:[]);
  return Object.freeze({...choice,...(account===null?{}:{account})});
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
