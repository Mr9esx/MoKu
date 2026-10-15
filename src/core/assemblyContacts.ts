import ClipperLib from "clipper-lib";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { Part, Project } from "./types";
import type { Assembly, AssemblyItem, AssemblyContact, ContactGeometry, PlacementCandidate, Vec3, Bounds3 } from "./assemblyTypes";
import { buildAssemblyModel, geometrySignature, quaternion, transformCell, transformPoint, vectorBounds } from "./assemblyGeometry";
import { cellsCollide, declaredFitIssue } from "./assemblyChecks";
import { matchingMortiseProfiles } from "./assemblyJoinery";
import { signedArea, pointInPolygon, pointSegmentDistance } from "./geometry";
const v=(p:Vec3)=>new Vector3(p.x,p.y,p.z);
const point=(p:{x:number;y:number;z:number}):Vec3=>({x:p.x,y:p.y,z:p.z});
const overlaps=(a:Bounds3,b:Bounds3)=>(["x","y","z"] as const).every(k=>Math.min(a.max[k],b.max[k])-Math.max(a.min[k],b.min[k])>1e-8);
const center=(points:Vec3[])=>point(points.reduce<Vector3>((s,p)=>s.add(v(p)),new Vector3()).multiplyScalar(1/points.length));
function contactGeometry(project:Project,assembly:Assembly,partId:string):ContactGeometry|null {
  if(assembly.items.some(item=>![...Object.values(item.position),...Object.values(item.rotation)].every(Number.isFinite)||Math.hypot(item.rotation.x,item.rotation.y,item.rotation.z,item.rotation.w)<1e-12))return null;
  const source=project.parts.find(p=>p.id===partId);if(!source)return null;
  const model=buildAssemblyModel(source,assembly.pocketFaces[partId]);
  if(!model.complete || model.cells.length>256)return null;
  const obstacles:ContactGeometry['obstacles']=[];let count=0;
  for(const item of assembly.items) {
    if(item.partId===partId)continue;
    const part=project.parts.find(p=>p.id===item.partId);if(!part)return null;
    const other=buildAssemblyModel(part,assembly.pocketFaces[part.id]);
    if(!other.complete || (count+=other.cells.length)>1024)return null;
    const cells=other.cells.map(c=>transformCell(c,item));
    obstacles.push({cells,bounds:vectorBounds(cells.flatMap(c=>c.vertices))});
  }
  if(!Number.isFinite(assembly.targets.tolerance) || assembly.targets.tolerance<0 || [assembly.targets.width,assembly.targets.depth,assembly.targets.height].some(n=>n!==undefined&&!Number.isFinite(n)))return null;
  const fits=assembly.fits.filter(f=>f.partId===partId||f.receiverId===partId),ids=new Set(fits.flatMap(f=>[f.partId,f.receiverId]));
  const rules=fits.length?{project:{name:project.name,units:project.units,parts:project.parts.filter(p=>ids.has(p.id)),sheets:[],original:{sheets:[],placements:[]},warnings:[]},assembly:{...assembly,items:assembly.items.filter(i=>ids.has(i.partId)),fits}}:undefined;
  return {source:model.cells,obstacles,targets:assembly.targets,rules};
}
/** Recheck the actual translated contact; tangential motion can reach other parts. */
export function contactPoseClear(geometry:ContactGeometry,pose:AssemblyItem) {
  if(geometry.rules) {
    const {project,assembly}=geometry.rules,trial={...assembly,items:assembly.items.map(i=>i.partId===pose.partId?pose:i)};
    if(assembly.fits.some(f=>declaredFitIssue(project,trial,f)))return false;
  }
  const cells=geometry.source.map(c=>transformCell(c,pose)),bounds=vectorBounds(cells.flatMap(c=>c.vertices));
  const all=vectorBounds([bounds.min,bounds.max,...geometry.obstacles.flatMap(o=>[o.bounds.min,o.bounds.max])]);
  for(const [name,axis] of [["width","x"],["depth","y"],["height","z"]] as const) {
    const max=geometry.targets[name];if(max!==undefined&&all.max[axis]-all.min[axis]>max+geometry.targets.tolerance+1e-7)return false;
  }
  const bounded=cells.map(cell=>({cell,bounds:vectorBounds(cell.vertices)}));let work=0;
  for(const other of geometry.obstacles) {
    if(!overlaps(bounds,other.bounds))continue;
    for(const a of bounded)for(const b of other.cells) {
      if(++work>30000)return false;
      if(overlaps(a.bounds,vectorBounds(b.vertices))&&cellsCollide(a.cell,b))return false;
    }
  }
  return true;
}
function overlapAnchor(source:Vec3[],target:Vec3[],normal:Vec3):Vec3|null {
  const origin=v(target[0]),n=v(normal),u=new Vector3(1,0,0);
  if(Math.abs(n.x)>0.8)u.set(0,1,0);
  u.addScaledVector(n,-u.dot(n)).normalize();const w=n.clone().cross(u);
  const paths=(vertices:Vec3[])=>Array.from({length:vertices.length/3},(_,i)=>{
    const path=vertices.slice(i*3,i*3+3).map(p=>{const q=v(p).sub(origin);return {X:Math.round(q.dot(u)*10000),Y:Math.round(q.dot(w)*10000)};});
    if(!ClipperLib.Clipper.Orientation(path))path.reverse();return path;
  });
  const clipper=new ClipperLib.Clipper(),result:ClipperLib.Paths=[];
  clipper.AddPaths(paths(source),ClipperLib.PolyType.ptSubject,true);clipper.AddPaths(paths(target),ClipperLib.PolyType.ptClip,true);
  if(!clipper.Execute(ClipperLib.ClipType.ctIntersection,result,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero))return null;
  if(result.reduce((s,p)=>s+ClipperLib.Clipper.Area(p),0)<1000)return null;
  // Any interior triangle intersection is enough to locate the contact cue.
  const polygon=result.find(p=>ClipperLib.Clipper.Area(p)>1000);if(!polygon)return null;
  const p=polygon[0];return point(origin.addScaledVector(u,p.X/10000).addScaledVector(w,p.Y/10000));
}
/** Preserve free motion along a face or along the usable length of a groove. */
export function resolveContact(raw:AssemblyItem,candidate:PlacementCandidate):{pose:AssemblyItem;anchor:Vec3}|null {
  const c=candidate.contact;if(!c)return null;
  const pose={...raw,position:{...raw.position},rotation:{...candidate.pose.rotation}};
  if(c.kind==="groove") {
    const axis=v(c.slideAxis!),currentAnchor=transformPoint(c.sourceAnchor,raw);
    const offset=Math.max(-c.slideRange!,Math.min(c.slideRange!,v(currentAnchor).sub(v(c.targetAnchor)).dot(axis)));
    pose.position=point(v(candidate.pose.position).addScaledVector(axis,offset));
    const anchor=overlapAnchor(c.sourceTriangles!.map(p=>transformPoint(p,pose)),c.targetTriangles!,c.normal);
    return anchor?{pose,anchor}:null;
  }
  const vertices=c.sourceTriangles!,a=v(vertices[0]),localNormal=v(vertices[1]).sub(a).cross(v(vertices[2]).sub(a)).normalize();
  const current=quaternion(raw.rotation),from=localNormal.applyQuaternion(current);
  const q=new Quaternion().setFromUnitVectors(from,v(c.normal).negate()).multiply(current).normalize();
  pose.rotation={...point(q),w:q.w};
  const source=transformPoint(c.sourceAnchor,pose),n=v(c.normal);
  pose.position=point(v(pose.position).addScaledVector(n,-v(source).sub(v(c.targetAnchor)).dot(n)));
  const anchor=overlapAnchor(c.sourceTriangles!.map(p=>transformPoint(p,pose)),c.targetTriangles!,c.normal);
  return anchor?{pose,anchor}:null;
}
type Patch={normal:Vec3;triangles:Vec3[];anchor:Vec3};
function trianglesWhere(part:Part,assembly:Assembly,predicate:(triangle:Vec3[])=>boolean) {
  const positions=buildAssemblyModel(part,assembly.pocketFaces[part.id]).positions,result:Vec3[]=[];
  for(let i=0;i<positions.length;i+=9) {
    const triangle=[0,3,6].map(j=>({x:positions[i+j],y:positions[i+j+1],z:positions[i+j+2]}));
    if(predicate(triangle))result.push(...triangle);
  }
  return result;
}
function patches(part:Part,assembly:Assembly):Patch[] {
  const model=buildAssemblyModel(part,assembly.pocketFaces[part.id]);if(!model.complete||model.positions.length>45000)return [];
  const groups=new Map<string,Patch>();
  for(let i=0;i<model.positions.length;i+=9) {
    const triangle=[0,3,6].map(j=>({x:model.positions[i+j],y:model.positions[i+j+1],z:model.positions[i+j+2]}));
    const n=v(triangle[1]).sub(v(triangle[0])).cross(v(triangle[2]).sub(v(triangle[0]))).normalize();
    const key=[n.x,n.y,n.z,n.dot(v(triangle[0]))].map(n=>Math.round(n*1e5)).join(":");
    const patch=groups.get(key)??{normal:point(n),triangles:[],anchor:triangle[0]};patch.triangles.push(...triangle);groups.set(key,patch);
  }
  return [...groups.values()].filter(p=>p.triangles.length<=768).sort((a,b)=>b.triangles.length-a.triangles.length).slice(0,24);
}
export function ordinaryContactCandidates(project:Project,assembly:Assembly,partId:string):PlacementCandidate[] {
  const male=project.parts.find(p=>p.id===partId),item=assembly.items.find(i=>i.partId===partId);
  if(!male||!item||item.locked)return [];
  const geometry=contactGeometry(project,assembly,partId);if(!geometry)return [];
  const result:PlacementCandidate[]=[];
  // Explicit fit rules retain priority and their manufacturing checks.
  const declared=assembly.fits.some(f=>f.partId===partId);
  for(const host of assembly.items) {
    if(host.partId===partId)continue;
    const receiver=project.parts.find(p=>p.id===host.partId)!;
    if(male.outline.length<=512) for(let index=0;index<receiver.pockets.length;index++) {
      const pocket=receiver.pockets[index],config=assembly.pocketFaces[receiver.id];
      const fit=assembly.fits.find(f=>f.partId===partId&&f.receiverId===host.partId&&f.feature.kind==="pocket"&&f.feature.index===index);
      if(declared&&(!fit||fit.insertionDepth!==pocket.depth))continue;
      const face=config?.signature===geometrySignature(receiver)?config.faces[index]:undefined;
      if(!face||pocket.depth===null||pocket.depth<=0||pocket.depth>=receiver.thickness)continue;
      const floor=face==="front"?receiver.thickness-pocket.depth:pocket.depth;
      const floorTriangles=trianglesWhere(receiver,assembly,triangle=>triangle.every(p=>Math.abs(p.z-floor)<1e-6)&&pointInPolygon(center(triangle),pocket.outline)&&v(triangle[1]).sub(v(triangle[0])).cross(v(triangle[2]).sub(v(triangle[0]))).z*(face==="front"?1:-1)>1e-7).map(p=>transformPoint(p,host));
      if(!floorTriangles.length)continue;
      for(let edge=0;edge<male.outline.length;edge++) {
        if(fit&&edge!==fit.maleEdge)continue;
        const a=male.outline[edge],b=male.outline[(edge+1)%male.outline.length],width=Math.hypot(b.x-a.x,b.y-a.y);if(width<2)continue;
        const u=new Vector3((b.x-a.x)/width,(b.y-a.y)/width,0),winding=signedArea(male.outline)>0?1:-1;
        const inward=new Vector3(-u.y*winding,u.x*winding,0);
        const sourceTriangles=trianglesWhere(male,assembly,triangle=>triangle.every(p=>pointSegmentDistance(p,a,b)<1e-6));
        if(!sourceTriangles.length)continue;
        for(const profile of matchingMortiseProfiles(pocket.outline,width,male.thickness,true)) {
          const targetU=new Vector3(profile.u.x,profile.u.y,0),outward=new Vector3(0,0,face==="front"?1:-1);
          if(u.clone().applyQuaternion(quaternion(item.rotation)).dot(targetU.clone().applyQuaternion(quaternion(host.rotation)))<0)targetU.negate();
          const source=new Matrix4().makeBasis(u,inward,new Vector3(0,0,1));
          const target=new Matrix4().makeBasis(targetU,outward,targetU.clone().cross(outward).multiplyScalar(winding));
          const q=new Quaternion().setFromRotationMatrix(target.multiply(source.transpose())).premultiply(quaternion(host.rotation)).normalize();
          const sourceAnchor={x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:male.thickness/2};
          const targetAnchor=transformPoint({...profile.center,z:face==="front"?receiver.thickness-pocket.depth:pocket.depth},host);
          const pose={...item,position:point(v(targetAnchor).sub(v(sourceAnchor).applyQuaternion(q))),rotation:{...point(q),w:q.w}};
          const contact:AssemblyContact={kind:"groove",sourceAnchor,targetAnchor,normal:point(outward.applyQuaternion(quaternion(host.rotation))),sourceTriangles,targetTriangles:floorTriangles,sourceEdge:edge,depth:pocket.depth,face,slideAxis:point(targetU.applyQuaternion(quaternion(host.rotation))),slideRange:(profile.length-width)/2,geometry};
          const candidate:PlacementCandidate={id:`groove:${partId}:${host.partId}:${index}:${edge}`,partId,receiverId:host.partId,pose,target:transformPoint({...profile.center,z:face==="front"?receiver.thickness+0.03:-0.03},host),label:`${receiver.name} 铣槽 ${index+1} · 深 ${pocket.depth} mm`,feature:{kind:"pocket",index},status:"valid",contact};
          const nominal=resolveContact(pose,candidate);
          if(!nominal||!contactPoseClear(geometry,pose)) {
            candidate.status="incomplete";candidate.message="沿槽拖近后核对当前接触位置";
          }
          result.push(candidate);
          if(result.length>=16)break;
        }
        if(result.length>=16)break;
      }
      if(result.length>=16)break;
    }
  }
  if(declared)return result;
  const sourcePatches=patches(male,assembly);let surfaceCount=0;
  for(const host of assembly.items) {
    if(host.partId===partId)continue;
    const receiver=project.parts.find(p=>p.id===host.partId)!;
    for(const s of sourcePatches)for(const t of patches(receiver,assembly)) {
      const from=v(s.normal).applyQuaternion(quaternion(item.rotation)),normal=v(t.normal).applyQuaternion(quaternion(host.rotation));
      if(from.dot(normal)>-Math.cos(8*Math.PI/180))continue;
      const q=new Quaternion().setFromUnitVectors(from,normal.clone().negate()).multiply(quaternion(item.rotation)).normalize();
      const targetTriangles=t.triangles.map(p=>transformPoint(p,host)),sourceAnchor=center(s.triangles),targetAnchor=center(targetTriangles);
      const pose={...item,position:point(v(targetAnchor).sub(v(sourceAnchor).applyQuaternion(q))),rotation:{...point(q),w:q.w}};
      const contact:AssemblyContact={kind:"surface",sourceAnchor,targetAnchor,normal:point(normal),sourceTriangles:s.triangles,targetTriangles,geometry};
      const candidate:PlacementCandidate={id:`contact:${partId}:${host.partId}:${surfaceCount++}`,partId,receiverId:host.partId,pose,target:targetAnchor,label:`${receiver.name} 表面贴合`,status:"valid",contact};
      if(!resolveContact(pose,candidate)||!contactPoseClear(geometry,pose)) {
        candidate.status="incomplete";candidate.message="拖近后核对当前接触位置";
      }
      result.push(candidate);if(surfaceCount>=24)return result;
    }
  }
  return result;
}
