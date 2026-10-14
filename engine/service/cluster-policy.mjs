import path from 'node:path';
import {CoreError} from './identity.mjs';
export function clusterMembers(clusters, ids, units) {
  const active=new Map(clusters.filter(c=>!c.deleted).map(c=>[c.id,c]));
  const existing=new Set(units.filter(u=>u.id!=='root:master'&&!u.removed).map(u=>u.id));
  const result=new Set();const visited=new Set();
  function visit(id,chain=new Set()) {
    if(chain.has(id))throw new CoreError(409,'cluster_cycle','Cluster parent cycle.');
    if(visited.has(id))return;
    const c=active.get(id);if(!c)throw new CoreError(409,'cluster_changed','A selected cluster is unavailable.');
    const next=new Set(chain);next.add(id);
    for(const member of c.members)if(existing.has(member))result.add(member);
    for(const child of active.values())if(child.parentId===id)visit(child.id,next);
    visited.add(id);
  }
  for(const id of ids)visit(id);
  return [...result].sort();
}
export function withinClusterRoot(root, candidate, platform='win32') {
  if(root==null)return false;
  const paths=platform==='win32'?path.win32:path.posix;
  if(!paths.isAbsolute(root)||!paths.isAbsolute(candidate))return false;
  const left=platform==='win32'?root.toLowerCase():root;
  const right=platform==='win32'?candidate.toLowerCase():candidate;
  const relative=paths.relative(paths.normalize(left),paths.normalize(right));
  return relative===''||(!relative.startsWith('..'+paths.sep)&&relative!=='..'&&!paths.isAbsolute(relative));
}
