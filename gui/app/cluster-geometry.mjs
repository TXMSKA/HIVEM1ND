export function clusterCamera(bounds,viewport,padding=48){
  if(!bounds.length)return{x:0,y:0,zoom:1};
  if(viewport.width<=padding*2||viewport.height<=padding*2)throw new RangeError('Map viewport is too small');
  for(const b of bounds)if(![b.x,b.y,b.width,b.height].every(Number.isFinite)||b.width<0||b.height<0)throw new TypeError('Invalid graph bounds');
  const minX=Math.min(...bounds.map(b=>b.x)),minY=Math.min(...bounds.map(b=>b.y));
  const width=Math.max(1,Math.max(...bounds.map(b=>b.x+b.width))-minX);
  const height=Math.max(1,Math.max(...bounds.map(b=>b.y+b.height))-minY);
  const zoom=Math.min(2.5,(viewport.width-padding*2)/width,(viewport.height-padding*2)/height);
  return{x:(viewport.width-width*zoom)/2-minX*zoom,y:(viewport.height-height*zoom)/2-minY*zoom,zoom};
}
export function interpolateCamera(from,to,fraction){
  const t=Math.max(0,Math.min(1,fraction)),ease=1-Math.pow(1-t,3);
  return{x:from.x+(to.x-from.x)*ease,y:from.y+(to.y-from.y)*ease,zoom:from.zoom+(to.zoom-from.zoom)*ease};
}
