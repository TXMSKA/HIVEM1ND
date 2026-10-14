import {CoreError}from'./identity.mjs';
export function publicGitRemote(value) {
  if(!value)return null;
  try{const url=new URL(value);if(!['https:','http:','ssh:','git:'].includes(url.protocol))return null;
    url.username='';url.password='';url.search='';url.hash='';return url.toString();
  }catch{const match=String(value).match(/^(?:[^@\s]+@)?([a-zA-Z0-9.-]+):([^\s?#]+)$/);return match?match[1]+'/'+match[2]:null;}
}
export function parseGitStatus(value) {
  if(typeof value!=='string'||Buffer.byteLength(value)>1048576)throw new CoreError(409,'git_unavailable','Git status exceeded its bound.');
  const parts=value.split('\0');const result=[];
  for(let i=0;i<parts.length;i++){
    if(!parts[i])continue;const record=parts[i];if(record.length<4||record[2]!==' ')throw new CoreError(409,'git_unavailable','Git status was incomplete.');
    const status=record.slice(0,2);const file=record.slice(3);let from=null;
    if(/[RC]/.test(status)){from=parts[++i];if(!from)throw new CoreError(409,'git_unavailable','Git rename was incomplete.');}
    result.push({path:file,status,from});if(result.length>10000)throw new CoreError(409,'git_unavailable','Too many Git changes.');
  }
  return result;
}
