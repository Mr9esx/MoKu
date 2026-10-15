import ClipperLib from "clipper-lib";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { Point, Project } from "./types";
import type { Assembly, PlacementCandidate } from "./assemblyTypes";
import { analyzeAssembly } from "./assemblyChecks";
import { quaternion, transformPoint } from "./assemblyGeometry";
import { contourDistance, pointInPolygon, signedArea, validContour } from "./geometry";

const SCALE = 10000;
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const unique = (values: number[]) => [...new Set(values.map(v => Math.round(v * 1e6) / 1e6))].sort((a,b)=>a-b);
const path = (points: Point[]) => {
  const result = points.map(p=>({ X: Math.round(p.x*SCALE), Y: Math.round(p.y*SCALE) }));
  if (!ClipperLib.Clipper.Orientation(result)) result.reverse();
  return result;
};
function containedRectangle(rectangle: Point[], outline: Point[]) {
  const clipper = new ClipperLib.Clipper(), outside: ClipperLib.Paths = [];
  clipper.AddPath(path(rectangle), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPath(path(outline), ClipperLib.PolyType.ptClip, true);
  if (!clipper.Execute(ClipperLib.ClipType.ctDifference, outside, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero)) return false;
  return outside.reduce((area,p)=>area+Math.abs(ClipperLib.Clipper.Area(p)),0) / (SCALE*SCALE) < 1e-6;
}
/** Straight walls establish nominal dimensions; the real contour must contain every corner. */
export function matchingMortiseProfiles(outline: Point[], tenonWidth: number, thickness: number, longer = false) {
  const profiles: { center: Point; u: Point; length: number; width: number }[] = [];
  if (outline.length > 512 || !validContour(outline) || tenonWidth < 2 || thickness <= 0) return profiles;
  const edges = outline.map((a,i)=>{
    const b=outline[(i+1)%outline.length], length=Math.hypot(b.x-a.x,b.y-a.y);
    return { a, b, length, u: { x:(b.x-a.x)/length, y:(b.y-a.y)/length } };
  }).filter(e=>e.length>=2);
  const directions: Point[] = [];
  for (const edge of edges) {
    const u = edge.u.x < -1e-6 || (Math.abs(edge.u.x)<1e-6 && edge.u.y<0) ? {x:-edge.u.x,y:-edge.u.y} : edge.u;
    if (!directions.some(v=>Math.abs(dot(v,u))>1-1e-7)) directions.push(u);
  }
  for (const u of directions.slice(0,16)) {
    const v={x:-u.y,y:u.x};
    const horizontal=unique(edges.filter(e=>Math.abs(dot(e.u,u))>1-1e-7).map(e=>dot(e.a,v))).slice(0,32);
    const vertical=unique(edges.filter(e=>Math.abs(dot(e.u,v))>1-1e-7).map(e=>dot(e.a,u))).slice(0,32);
    for(let i=0;i<horizontal.length;i++)for(let j=i+1;j<horizontal.length;j++) {
      const width=horizontal[j]-horizontal[i];
      if(width<thickness-1e-6 || width>thickness+0.5) continue;
      for(let k=0;k<vertical.length;k++)for(let l=k+1;l<vertical.length;l++) {
        const length=vertical[l]-vertical[k];
        if(length<tenonWidth-1e-6 || length>(longer?1e8:tenonWidth+0.5)) continue;
        const point=(s:number,t:number)=>({x:u.x*s+v.x*t,y:u.y*s+v.y*t});
        const rectangle=[point(vertical[k],horizontal[i]),point(vertical[l],horizontal[i]),point(vertical[l],horizontal[j]),point(vertical[k],horizontal[j])];
        if (!containedRectangle(rectangle,outline)) continue;
        profiles.push({ center:point((vertical[k]+vertical[l])/2,(horizontal[i]+horizontal[j])/2), u, length, width });
      }
    }
  }
  return profiles;
}

/** A shoulder is a parallel ledge outside the tip span, including a relieved corner. */
function shoulderDepth(outline: Point[], edge: number, inward: Vector3, thickness: number) {
  const a=outline[edge],b=outline[(edge+1)%outline.length];
  const width=Math.hypot(b.x-a.x,b.y-a.y),u={x:(b.x-a.x)/width,y:(b.y-a.y)/width};
  const depths:number[]=[];
  for(const side of [-1,1]) {
    const endpoint=side<0?0:width;
    // Follow each tip endpoint's connected side, stopping at its first ledge.
    // This permits sampled tool relief without borrowing another feature's shoulder.
    for(let step=1;step<outline.length;step++) {
      const i=(edge+(side<0?-step:step)+outline.length)%outline.length;
      const c={x:outline[i].x-a.x,y:outline[i].y-a.y},next=outline[(i+1)%outline.length];
      const d={x:next.x-a.x,y:next.y-a.y};
      const depth=c.x*inward.x+c.y*inward.y;
      const min=Math.min(dot(c,u),dot(d,u)),max=Math.max(dot(c,u),dot(d,u));
      const parallel=depth>1e-6 && Math.abs(depth-d.x*inward.x-d.y*inward.y)<=1e-6 && Math.hypot(d.x-c.x,d.y-c.y)>=2;
      if(parallel) {
        if((side<0 && min< -1e-6 && max>=-2*thickness && max<=1e-6) || (side>0 && max>width+1e-6 && min>=width-1e-6 && min<=width+2*thickness)) depths.push(depth);
        break;
      }
      if(Math.max(Math.abs(min-endpoint),Math.abs(max-endpoint))>2*thickness) break;
    }
  }
  return depths.length?Math.min(...depths):null;
}

/** Only offer insertions that fit even when every unconfirmed shallow cut is filled. */
export function tenonInsertionCandidates(project: Project, assembly: Assembly, partId: string): PlacementCandidate[] {
  const male=project.parts.find(p=>p.id===partId), item=assembly.items.find(i=>i.partId===partId);
  if(!male || !item || item.locked || male.outline.length>512 || !validContour(male.outline)) return [];
  const conservative={...project,parts:project.parts.map(p=>({...p,pockets:[]}))};
  const result: PlacementCandidate[]=[];
  const winding=signedArea(male.outline)>0?1:-1;
  for(const host of assembly.items) {
    if(host.partId===partId) continue;
    const receiver=project.parts.find(p=>p.id===host.partId);
    if(!receiver || receiver.thickness<=0) continue;
    for(let index=0;index<receiver.holes.length;index++) {
      const hole=receiver.holes[index];
      if(!hole.every(p=>pointInPolygon(p,receiver.outline,true)) || contourDistance(hole,receiver.outline)<1e-7) continue;
      for(let edge=0;edge<male.outline.length;edge++) {
        const a=male.outline[edge],b=male.outline[(edge+1)%male.outline.length],edgeLength=Math.hypot(b.x-a.x,b.y-a.y);
        if(edgeLength<2) continue;
        const u=new Vector3((b.x-a.x)/edgeLength,(b.y-a.y)/edgeLength,0);
        const inward=new Vector3(-u.y*winding,u.x*winding,0);
        const midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
        const depth=shoulderDepth(male.outline,edge,inward,male.thickness);
        if(depth===null || !pointInPolygon({x:midpoint.x+inward.x*(depth+0.001),y:midpoint.y+inward.y*(depth+0.001)},male.outline)) continue;
        for(const profile of matchingMortiseProfiles(hole,edgeLength,male.thickness)) {
          const targetU=new Vector3(profile.u.x,profile.u.y,0);
          if(u.clone().applyQuaternion(quaternion(item.rotation)).dot(targetU.clone().applyQuaternion(quaternion(host.rotation)))<0) targetU.negate();
          const outward=new Vector3(0,0,1),targetZ=targetU.clone().cross(outward).multiplyScalar(winding);
          const source=new Matrix4().makeBasis(u,inward,new Vector3(0,0,1));
          const target=new Matrix4().makeBasis(targetU,outward,targetZ);
          const q=new Quaternion().setFromRotationMatrix(target.multiply(source.transpose())).premultiply(quaternion(host.rotation)).normalize();
          const sourceAnchor={...midpoint,z:male.thickness/2};
          const receiverAnchor={...profile.center,z:receiver.thickness-depth};
          const anchor=new Vector3(sourceAnchor.x,sourceAnchor.y,sourceAnchor.z).applyQuaternion(q);
          const destination=transformPoint(receiverAnchor,host);
          const pose={...item,position:{x:destination.x-anchor.x,y:destination.y-anchor.y,z:destination.z-anchor.z},rotation:{x:q.x,y:q.y,z:q.z,w:q.w}};
          const trial={...assembly,targets:{tolerance:0.5},pocketFaces:{},fits:[],steps:[],items:assembly.items.map(i=>i.partId===partId?pose:i)};
          const proof=analyzeAssembly(conservative,trial);
          if(proof.issues.some(i=>i.kind!=="missing" && i.id!=="basis:missing" && (i.partIds.includes(partId) || i.kind==="geometry" || !i.partIds.length))) continue;
          const direction=outward.applyQuaternion(quaternion(host.rotation));
          const shownDepth=Math.round(depth*1000)/1000;
          result.push({id:`insert:${partId}:${host.partId}:${index}:${edge}`,partId,receiverId:host.partId,pose,target:transformPoint({...profile.center,z:receiver.thickness+0.03},host),label:`${receiver.name} 通孔 ${index+1} · 插入 ${shownDepth} mm`,feature:{kind:"hole",index},status:"valid",insertion:{maleEdge:edge,depth:shownDepth,width:edgeLength,clearance:profile.width-male.thickness,sourceAnchor,receiverAnchor,direction:{x:direction.x,y:direction.y,z:direction.z},geometryChecked:true}});
          if(result.length>=16) return result;
        }
      }
    }
  }
  const distance=(candidate:PlacementCandidate)=>Object.entries(candidate.pose.position).reduce((sum,[axis,value])=>sum+(value-item.position[axis as "x"|"y"|"z"])**2,0);
  return result.sort((a,b)=>distance(a)-distance(b));
}
