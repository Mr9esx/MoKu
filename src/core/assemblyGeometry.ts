import ClipperLib from 'clipper-lib';
import { Euler, Quaternion, ShapeUtils, Vector2, Vector3 } from 'three';
import type { Part, Point } from './types';
import type { AssemblyItem, AssemblyModel, Bounds3, ConvexCell, PocketFaces, Rotation3, Vec3 } from './assemblyTypes';
import { pointInPolygon, pointSegmentDistance, signedArea, validContour } from './geometry';
const SCALE=10000;
const CACHE_LIMIT=64;
const VERTEX_LIMIT=20000;
const CELL_LIMIT=20000;
const cache=new Map<string,AssemblyModel>();
let cacheWeight=0;
const weight=(model:AssemblyModel)=>model.positions.length+model.cells.length*36;
export function geometrySignature(part:Part):string {
  // Exact source serialization makes face declarations stale after any geometric edit.
  return JSON.stringify([part.thickness,part.outline,part.holes,part.pockets]);
}
export function quaternion(rotation:Rotation3):Quaternion {
  const q=new Quaternion(rotation.x,rotation.y,rotation.z,rotation.w);
  return q.lengthSq()>0 && [q.x,q.y,q.z,q.w].every(Number.isFinite)?q.normalize():new Quaternion();
}
export function rotationFromEuler(degrees:Vec3):Rotation3 {
  const q=new Quaternion().setFromEuler(new Euler(degrees.x*Math.PI/180,degrees.y*Math.PI/180,degrees.z*Math.PI/180,'XYZ'));
  return {x:q.x,y:q.y,z:q.z,w:q.w};
}
export function eulerFromRotation(rotation:Rotation3):Vec3 {
  const e=new Euler().setFromQuaternion(quaternion(rotation),'XYZ');
  return {x:e.x*180/Math.PI,y:e.y*180/Math.PI,z:e.z*180/Math.PI};
}
export function transformPoint(point:Vec3,item:AssemblyItem):Vec3 {
  const v=new Vector3(point.x,point.y,point.z).applyQuaternion(quaternion(item.rotation));
  return {x:v.x+item.position.x,y:v.y+item.position.y,z:v.z+item.position.z};
}
export function inversePoint(point:Vec3,item:AssemblyItem):Vec3 {
  const v=new Vector3(point.x-item.position.x,point.y-item.position.y,point.z-item.position.z).applyQuaternion(quaternion(item.rotation).invert());
  return {x:v.x,y:v.y,z:v.z};
}
export function vectorBounds(points:Vec3[]):Bounds3 {
  const b:Bounds3={min:{x:Infinity,y:Infinity,z:Infinity},max:{x:-Infinity,y:-Infinity,z:-Infinity}};
  for(const p of points)for(const k of ['x','y','z'] as const){b.min[k]=Math.min(b.min[k],p[k]);b.max[k]=Math.max(b.max[k],p[k]);}
  return points.length?b:{min:{x:0,y:0,z:0},max:{x:0,y:0,z:0}};
}
export function transformCell(cell:ConvexCell,item:AssemblyItem):ConvexCell {return {vertices:cell.vertices.map(v=>transformPoint(v,item)),faces:cell.faces,boundaryFaces:cell.boundaryFaces};}
type Region={outer:Point[];holes:Point[][]};
function path(poly:Point[],positive=true):ClipperLib.Path {
  const p=poly.map(v=>({X:Math.round(v.x*SCALE),Y:Math.round(v.y*SCALE)}));
  if(ClipperLib.Clipper.Orientation(p)!==positive)p.reverse();
  return p;
}
function polygons(regions:Region[]):ClipperLib.Paths {return regions.flatMap(r=>[path(r.outer),...r.holes.map(h=>path(h,false))]);}
function difference(subject:ClipperLib.Paths,clip:ClipperLib.Paths,operation=ClipperLib.ClipType.ctDifference):Region[] {
  if(!subject.length)return [];
  const c=new ClipperLib.Clipper(),tree=new ClipperLib.PolyTree();
  c.StrictlySimple=true;
  c.AddPaths(subject,ClipperLib.PolyType.ptSubject,true);
  if(clip.length)c.AddPaths(clip,ClipperLib.PolyType.ptClip,true);
  if(!c.Execute(operation,tree,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero))throw new Error('材料布尔运算失败');
  const regions:Region[]=[];
  const points=(node:ClipperLib.PolyNode,ccw:boolean)=>{const p=node.Contour().map(v=>({x:v.X/SCALE,y:v.Y/SCALE}));if((signedArea(p)>0)!==ccw)p.reverse();return p;};
  const visit=(node:ClipperLib.PolyNode)=>{if(node.Contour().length && !node.IsHole())regions.push({outer:points(node,true),holes:node.Childs().filter(n=>n.IsHole()).map(n=>points(n,false))});for(const child of node.Childs())visit(child);};
  visit(tree);return regions;
}
function triangulate(region:Region):{points:Point[];triangles:number[][]} {
  const points=[...region.outer,...region.holes.flat()];
  const triangles=ShapeUtils.triangulateShape(region.outer.map(v=>new Vector2(v.x,v.y)),region.holes.map(h=>h.map(v=>new Vector2(v.x,v.y))));
  // Verify triangulation area rather than declaring an empty/truncated decomposition complete.
  const area=(p:Point[])=>Math.abs(signedArea(p));
  const expected=area(region.outer)-region.holes.reduce((a,h)=>a+area(h),0);
  let actual=0;
  for(const t of triangles){if(signedArea(t.map(i=>points[i]))<0)t.reverse();actual+=area(t.map(i=>points[i]));}
  if(Math.abs(actual-expected)>Math.max(0.0001,expected*1e-8))throw new Error('材料区域三角剖分不完整');
  return {points,triangles};
}
function triangle(out:number[],a:Vec3,b:Vec3,c:Vec3) {out.push(a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z);}
function cap(out:number[],regions:Region[],z:number,up:boolean) {
  for(const r of regions){const {points,triangles}=triangulate(r);for(const t of triangles){const v=t.map(i=>({...points[i],z}));triangle(out,v[0],v[up?1:2],v[up?2:1]);}}
}
function prism(points:Point[],z0:number,z1:number,boundaryFaces:boolean[]):ConvexCell {
  return {vertices:[...points.map(v=>({...v,z:z0})),...points.map(v=>({...v,z:z1}))],faces:[[2,1,0],[3,4,5],[0,1,4,3],[1,2,5,4],[2,0,3,5]],boundaryFaces};
}
export function buildAssemblyModel(part:Part,faces?:PocketFaces):AssemblyModel {
  const key=part.id+geometrySignature(part)+JSON.stringify(faces);
  const cached=cache.get(key);if(cached){cache.delete(key);cache.set(key,cached);return cached;}
  const model:AssemblyModel={partId:part.id,positions:[],cells:[],complete:true,issues:[],bounds:{min:{x:0,y:0,z:0},max:{x:0,y:0,z:0}}};
  const incomplete=(message:string)=>{model.complete=false;model.issues.push(message);};
  const contours=[part.outline,...part.holes,...part.pockets.map(p=>p.outline)];
  const count=contours.reduce((n,p)=>n+p.length,0);
  if(count>VERTEX_LIMIT||contours.reduce((n,p)=>n+p.length*p.length,0)>4_000_000||part.pockets.length>128)incomplete('几何复杂度超过检测资源上限');
  else if(!Number.isFinite(part.thickness)||part.thickness<=0)incomplete('板厚必须为已确认的正数');
  else if(contours.some(p=>p.some(v=>Math.abs(v.x)>1e8||Math.abs(v.y)>1e8)||!validContour(p)))incomplete('轮廓无效或自交');
  if(model.complete){
    const cuts:{outline:Point[];lo:number;hi:number}[]=part.holes.map(outline=>({outline,lo:0,hi:part.thickness}));
    for(let i=0;i<part.pockets.length;i++){
      const pocket=part.pockets[i],face=faces?.signature===geometrySignature(part)?faces.faces[i]:undefined;
      if(face!=='front'&&face!=='back'){incomplete(`槽 ${i+1} 加工面未确认或几何已变更`);continue;}
      if(pocket.depth===null||!Number.isFinite(pocket.depth)||pocket.depth<=0||pocket.depth>=part.thickness){incomplete(`槽 ${i+1} 深度未知或超出板厚`);continue;}
      cuts.push({outline:pocket.outline,lo:face==='front'?part.thickness-pocket.depth:0,hi:face==='front'?part.thickness:pocket.depth});
    }
    try{
      const zs=[...new Set([0,part.thickness,...cuts.flatMap(c=>[c.lo,c.hi])])].sort((a,b)=>a-b);
      const layers=zs.slice(0,-1).map((z,i)=>difference([path(part.outline)],cuts.filter(c=>c.lo<(z+zs[i+1])/2&&c.hi>(z+zs[i+1])/2).map(c=>path(c.outline))));
      for(let i=0;i<layers.length;i++){
        const z0=zs[i],z1=zs[i+1],regions=layers[i];
        cap(model.positions,difference(polygons(regions),i?polygons(layers[i-1]):[]),z0,false);
        cap(model.positions,difference(polygons(regions),i+1<layers.length?polygons(layers[i+1]):[]),z1,true);
        for(const r of regions){
          // Partition at adjacent slab boundaries. Every cap is now wholly external
          // or wholly internal, including triangles near pocket floors and roofs.
          let pieces=[r];
          for(const neighbour of [layers[i-1],layers[i+1]]){
            if(!neighbour?.length)continue;
            const clip=polygons(neighbour);
            pieces=pieces.flatMap(piece=>[...difference(polygons([piece]),clip),...difference(polygons([piece]),clip,ClipperLib.ClipType.ctIntersection)]);
            if(pieces.length>CELL_LIMIT)throw new Error('实体分区超过检测资源上限');
          }
          const inMaterial=(p:Point,regions:Region[]|undefined)=>!!regions?.some(region=>pointInPolygon(p,region.outer)&&!region.holes.some(h=>pointInPolygon(p,h)));
          const onBoundary=(a:Point,b:Point)=>[r.outer,...r.holes].some(ring=>ring.some((v,k)=>pointSegmentDistance(a,v,ring[(k+1)%ring.length])<1e-7&&pointSegmentDistance(b,v,ring[(k+1)%ring.length])<1e-7));
          for(const piece of pieces){
            const {points,triangles}=triangulate(piece);
            for(const indices of triangles){
              const t=indices.map(k=>points[k]);
              const center={x:t.reduce((n,p)=>n+p.x,0)/3,y:t.reduce((n,p)=>n+p.y,0)/3};
              model.cells.push(prism(t,z0,z1,[!inMaterial(center,layers[i-1]),!inMaterial(center,layers[i+1]),...t.map((p,k)=>onBoundary(p,t[(k+1)%3]))]));
              if(model.cells.length>CELL_LIMIT)throw new Error('实体单元超过检测资源上限');
            }
          }
          for(const ring of [r.outer,...r.holes])for(let k=0;k<ring.length;k++){
            const a={...ring[k],z:z0},b={...ring[(k+1)%ring.length],z:z0},c={...b,z:z1},d={...a,z:z1};triangle(model.positions,a,b,c);triangle(model.positions,a,c,d);
          }
        }
        if(model.cells.length>CELL_LIMIT)throw new Error('实体单元超过检测资源上限');
      }
      model.bounds=vectorBounds(model.cells.flatMap(c=>c.vertices));
      if(!model.cells.length)incomplete('加工后零件没有可检测的实体材料');
    }catch(error){incomplete(error instanceof Error?error.message:'无法构建实体');model.positions=[];model.cells=[];}
  }
  const size=weight(model);
  while(cache.size&&(cache.size>=CACHE_LIMIT||cacheWeight+size>500_000)){const oldest=cache.keys().next().value!;cacheWeight-=weight(cache.get(oldest)!);cache.delete(oldest);}
  if(size<=500_000){cache.set(key,model);cacheWeight+=size;}return model;
}
