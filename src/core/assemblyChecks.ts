import type { Part, Point, Project } from './types';
import type { Assembly, AssemblyAnalysis, AssemblyIssue, AssemblyItem, Bounds3, ConvexCell, FitConstraint, Vec3 } from './assemblyTypes';
import { CONTACT_EPSILON } from './assemblyTypes';
import { buildAssemblyModel, geometrySignature, inversePoint, transformCell, vectorBounds } from './assemblyGeometry';
import { contourDistance, contoursOverlap, pointInPolygon, signedArea } from './geometry';
import { assemblyMachiningWarnings } from './assemblyMachining';
export const add=(a:Vec3,b:Vec3):Vec3=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
export const subtract=(a:Vec3,b:Vec3):Vec3=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
export const scale=(a:Vec3,s:number):Vec3=>({x:a.x*s,y:a.y*s,z:a.z*s});
export const dot=(a:Vec3,b:Vec3)=>a.x*b.x+a.y*b.y+a.z*b.z;
export const cross=(a:Vec3,b:Vec3):Vec3=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
export const length=(a:Vec3)=>Math.hypot(a.x,a.y,a.z);
export const normalize=(a:Vec3)=>scale(a,1/(length(a)||1));
const finite=(v:Vec3)=>[v.x,v.y,v.z].every(Number.isFinite);
function planes(cell:ConvexCell) {
  const center=scale(cell.vertices.reduce(add,{x:0,y:0,z:0}),1/cell.vertices.length);
  return cell.faces.map(f=>{
    const a=cell.vertices[f[0]],b=cell.vertices[f[1]],c=cell.vertices[f[2]];
    let normal=normalize(cross(subtract(b,a),subtract(c,a)));
    if(dot(normal,subtract(center,a))>0)normal=scale(normal,-1);
    return {normal,d:dot(normal,a)};
  });
}
function edges(cell:ConvexCell):Vec3[] {return cell.faces.flatMap(f=>f.map((i,k)=>subtract(cell.vertices[f[(k+1)%f.length]],cell.vertices[i])));}
function axes(a:ConvexCell,b:ConvexCell):Vec3[] {
  const result:Vec3[]=[];
  const addAxis=(n:Vec3)=>{if(length(n)<1e-9)return;const u=normalize(n);if(!result.some(v=>Math.abs(dot(v,u))>1-1e-9))result.push(u);};
  for(const p of [...planes(a),...planes(b)])addAxis(p.normal);
  for(const ea of edges(a))for(const eb of edges(b))addAxis(cross(ea,eb));
  return result;
}
function projection(cell:ConvexCell,n:Vec3) {const vs=cell.vertices.map(v=>dot(v,n));return {min:Math.min(...vs),max:Math.max(...vs)};}
const NUMERIC_EPSILON=1e-9;
function inNormalCone(direction:Vec3,normals:Vec3[]):boolean {
  const close=(v:Vec3)=>length(subtract(v,direction))<1e-7;
  for(const n of normals)if(close(n))return true;
  for(let i=0;i<normals.length;i++)for(let j=i+1;j<normals.length;j++){
    const a=normals[i],b=normals[j],ab=dot(a,b),denominator=1-ab*ab;
    if(denominator<1e-12)continue;
    const x=(dot(direction,a)-ab*dot(direction,b))/denominator,y=(dot(direction,b)-ab*dot(direction,a))/denominator;
    if(x>=-1e-9&&y>=-1e-9&&close(add(scale(a,x),scale(b,y))))return true;
  }
  for(let i=0;i<normals.length;i++)for(let j=i+1;j<normals.length;j++)for(let k=j+1;k<normals.length;k++){
    const a=normals[i],b=normals[j],c=normals[k],determinant=dot(a,cross(b,c));
    if(Math.abs(determinant)<1e-12)continue;
    const x=dot(direction,cross(b,c))/determinant,y=dot(a,cross(direction,c))/determinant,z=dot(a,cross(b,direction))/determinant;
    if(x>=-1e-9&&y>=-1e-9&&z>=-1e-9&&close(add(add(scale(a,x),scale(b,y)),scale(c,z))))return true;
  }
  return false;
}
/** A support is physical only when its outward direction belongs to the
 * normal cone of actual boundary faces at every supporting vertex. Internal
 * diagonals/caps therefore receive only numerical, never contact, tolerance. */
function boundarySupport(cell:ConvexCell,direction:Vec3):boolean {
  if(!cell.boundaryFaces)return true;
  const maximum=projection(cell,direction).max,facePlanes=planes(cell);
  return cell.vertices.every((v,index)=>{
    if(maximum-dot(v,direction)>1e-7)return true;
    const normals=cell.boundaryNormals?.[index]??cell.faces.flatMap((face,i)=>cell.boundaryFaces![i]&&face.includes(index)?[facePlanes[i].normal]:[]);
    return inNormalCone(direction,normals);
  });
}
function supportAllowance(a:ConvexCell,b:ConvexCell,axis:Vec3):number {
  return boundarySupport(a,axis)&&boundarySupport(b,scale(axis,-1))?CONTACT_EPSILON:NUMERIC_EPSILON;
}
export function cellsCollide(a:ConvexCell,b:ConvexCell):boolean {
  return axes(a,b).every(n=>{
    const x=projection(a,n),y=projection(b,n);
    return x.max-y.min>supportAllowance(a,b,n)&&y.max-x.min>supportAllowance(b,a,n);
  });
}
/** Continuous fixed-orientation SAT with the same real-boundary allowances. */
function sweptCollisionInterval(a:ConvexCell,b:ConvexCell,motion:Vec3):{enter:number;leave:number}|null {
  let enter=0,leave=1;
  for(const n of axes(a,b)){
    const x=projection(a,n),y=projection(b,n),speed=dot(motion,n);
    const lo=y.min+supportAllowance(a,b,n)-x.max,hi=y.max-supportAllowance(b,a,n)-x.min;
    if(Math.abs(speed)<1e-12){if(lo>=0||hi<=0)return null;continue;}
    const t0=lo/speed,t1=hi/speed;
    enter=Math.max(enter,Math.min(t0,t1));leave=Math.min(leave,Math.max(t0,t1));
    if(enter>=leave)return null;
  }
  return enter<leave?{enter,leave}:null;
}
export function sweptCellsCollide(a:ConvexCell,b:ConvexCell,motion:Vec3):boolean {return sweptCollisionInterval(a,b,motion)!==null;}
/** Clip outward polygon faces against every half-space, adding ordered cut caps. */
export function intersectionPositions(a:ConvexCell,b:ConvexCell):number[] {
  let polygons=a.faces.map(f=>f.map(i=>a.vertices[i]));
  const EPS=1e-8;
  for(const {normal,d} of planes(b)){
    const next:Vec3[][]=[],cuts:Vec3[]=[];
    for(const poly of polygons){
      const clipped:Vec3[]=[];
      for(let i=0;i<poly.length;i++){
        const p=poly[i],q=poly[(i+1)%poly.length],dp=dot(normal,p)-d,dq=dot(normal,q)-d;
        if(dp<=EPS)clipped.push(p);
        if((dp>EPS)!==(dq>EPS)){
          const hit=add(p,scale(subtract(q,p),dp/(dp-dq)));clipped.push(hit);cuts.push(hit);
        }
      }
      if(clipped.length>=3)next.push(clipped);
    }
    const unique=cuts.filter((v,i)=>!cuts.slice(0,i).some(w=>length(subtract(v,w))<EPS));
    if(unique.length>=3){
      const center=scale(unique.reduce(add,{x:0,y:0,z:0}),1/unique.length);
      const u=normalize(subtract(unique[0],center)),v=cross(normal,u);
      unique.sort((p,q)=>Math.atan2(dot(subtract(p,center),v),dot(subtract(p,center),u))-Math.atan2(dot(subtract(q,center),v),dot(subtract(q,center),u)));
      next.push(unique);
    }
    polygons=next;if(!polygons.length)break;
  }
  const out:number[]=[];
  for(const poly of polygons)for(let i=1;i+1<poly.length;i++)for(const p of [poly[0],poly[i],poly[i+1]])out.push(p.x,p.y,p.z);
  return out;
}
function broadOverlap(a:Bounds3,b:Bounds3,epsilon=CONTACT_EPSILON) {return (['x','y','z'] as const).every(k=>Math.min(a.max[k]-b.min[k],b.max[k]-a.min[k])>epsilon);}
export type RectangularSlot={center:Point;u:Point;v:Point;length:number;width:number};
export function rectangularSlot(outline:Point[]):RectangularSlot|null {
  let p=outline.filter((v,i)=>{const a=outline[(i+outline.length-1)%outline.length],b=outline[(i+1)%outline.length];return Math.abs((v.x-a.x)*(b.y-v.y)-(v.y-a.y)*(b.x-v.x))>1e-7;});
  if(p.length!==4)return null;
  let e=p.map((v,i)=>({x:p[(i+1)%4].x-v.x,y:p[(i+1)%4].y-v.y}));
  if(e.some((v,i)=>Math.abs(v.x*e[(i+1)%4].x+v.y*e[(i+1)%4].y)>1e-6*Math.hypot(v.x,v.y)*Math.hypot(e[(i+1)%4].x,e[(i+1)%4].y)))return null;
  if(Math.hypot(e[0].x,e[0].y)<Math.hypot(e[1].x,e[1].y)){p=[...p.slice(1),p[0]];e=p.map((v,i)=>({x:p[(i+1)%4].x-v.x,y:p[(i+1)%4].y-v.y}));}
  const l=Math.hypot(e[0].x,e[0].y),w=Math.hypot(e[1].x,e[1].y);
  if(l<=0||w<=0)return null;
  return {center:{x:p.reduce((a,v)=>a+v.x,0)/4,y:p.reduce((a,v)=>a+v.y,0)/4},u:{x:e[0].x/l,y:e[0].y/l},v:{x:-e[0].y/l,y:e[0].x/l},length:l,width:w};
}
export function declaredFitIssue(project:Project,assembly:Assembly,fit:FitConstraint):AssemblyIssue|null {
  const issue=(severity:AssemblyIssue['severity'],message:string):AssemblyIssue=>({id:`fit:${fit.id}`,kind:'fit',severity,message,partIds:[fit.partId,fit.receiverId],constraintId:fit.id});
  const male=project.parts.find(p=>p.id===fit.partId),receiver=project.parts.find(p=>p.id===fit.receiverId),item=assembly.items.find(i=>i.partId===fit.partId),host=assembly.items.find(i=>i.partId===fit.receiverId);
  if(!male||!receiver||!item||!host)return issue('pending','配合零件尚未就位');
  if(fit.partSignature!==geometrySignature(male)||fit.receiverSignature!==geometrySignature(receiver))return issue('pending','配合声明的几何已变更，请重新确认');
  const feature=fit.feature.kind==='pocket'?receiver.pockets[fit.feature.index]?.outline:receiver.holes[fit.feature.index];
  const slot=feature?rectangularSlot(feature):null;
  if(!slot)return issue('pending','当前只校验明确的矩形槽或孔配合');
  // An un-clipped source rectangle is insufficient evidence of a real cavity.
  // Open/clipped or merged machining has no supported rectangular fit semantics.
  if(!feature!.every(p=>pointInPolygon(p,receiver.outline,true))||contourDistance(feature!,receiver.outline)<1e-7)return issue('pending','声明槽孔未形成接收零件材料内的完整封闭腔体');
  const otherCuts=[...receiver.holes.filter((_,i)=>fit.feature.kind!=='hole'||i!==fit.feature.index),...receiver.pockets.filter((_,i)=>fit.feature.kind!=='pocket'||i!==fit.feature.index).map(p=>p.outline)];
  if(otherCuts.some(cut=>contoursOverlap(feature!,cut)||contourDistance(feature!,cut)<1e-7))return issue('pending','声明槽孔与其他加工区域相连，合并腔体配合尚不支持');
  const face=fit.feature.kind==='pocket'?(assembly.pocketFaces[receiver.id]?.signature===geometrySignature(receiver)?assembly.pocketFaces[receiver.id].faces[fit.feature.index]:undefined):'front';
  if(!face)return issue('pending','槽加工面未确认');
  const depth=fit.feature.kind==='pocket'?receiver.pockets[fit.feature.index].depth:receiver.thickness;
  if(depth===null||!Number.isFinite(depth)||depth<=0)return issue('pending','槽深未知');
  if(!Number.isInteger(fit.maleEdge)||fit.maleEdge<0||fit.maleEdge>=male.outline.length)return issue('pending','插入边无效');
  if(![fit.insertionDepth,fit.minClearance,fit.maxClearance].every(Number.isFinite)||fit.insertionDepth<=0||fit.minClearance<0||fit.maxClearance<fit.minClearance)return issue('pending','配合参数无效');
  if(fit.insertionDepth>depth+1e-7)return issue('error','插入深度超过槽深');
  const edge0=male.outline[fit.maleEdge],edge1=male.outline[(fit.maleEdge+1)%male.outline.length],edgeLength=Math.hypot(edge1.x-edge0.x,edge1.y-edge0.y);
  if(edgeLength<1e-8)return issue('pending','插入边长度无效');
  const clearances=[slot.length-edgeLength,slot.width-male.thickness];
  if(clearances[0]<-1e-7||clearances[1]<fit.minClearance-1e-7||clearances[1]>fit.maxClearance+1e-7)return issue('error','槽长/槽宽与插入边/板厚的制造间隙不匹配');
  // Transform the entire insertion edge and thickness vector into receiver coordinates.
  const world=(p:Vec3)=>{
    const q=transformCell({vertices:[p],faces:[]},item).vertices[0];return inversePoint(q,host);
  };
  const p0=world({...edge0,z:male.thickness/2}),p1=world({...edge1,z:male.thickness/2}),pZ=world({...edge0,z:male.thickness});
  const mid=scale(add(p0,p1),0.5),edge=normalize(subtract(p1,p0)),thickness=normalize(subtract(pZ,p0));
  const sign=signedArea(male.outline)>0?1:-1;
  const inward={x:-(edge1.y-edge0.y)/edgeLength*sign,y:(edge1.x-edge0.x)/edgeLength*sign,z:0};
  const inwardWorld=normalize(subtract(world({...edge0,x:edge0.x+inward.x,y:edge0.y+inward.y,z:male.thickness/2}),p0));
  const expectedZ=face==='front'?receiver.thickness-fit.insertionDepth:fit.insertionDepth;
  if(Math.abs(Math.abs(edge.x*slot.u.x+edge.y*slot.u.y)-1)>1e-6||Math.abs(edge.z)>1e-6||Math.abs(thickness.z)>1e-6||Math.abs(Math.abs(thickness.x*slot.v.x+thickness.y*slot.v.y)-1)>1e-6||inwardWorld.z*(face==='front'?1:-1)<1-1e-6)return issue('error','插入边方向、板厚方向或插入面方向未对齐');
  // Clearance may be distributed unevenly, but the complete cross section must remain inside.
  const dx=mid.x-slot.center.x,dy=mid.y-slot.center.y;
  if(Math.abs(dx*slot.u.x+dy*slot.u.y)>clearances[0]/2+CONTACT_EPSILON||Math.abs(dx*slot.v.x+dy*slot.v.y)>clearances[1]/2+CONTACT_EPSILON||Math.abs(mid.z-expectedZ)>CONTACT_EPSILON)return issue('error','插入位置或实际深度未达到声明配合');
  if(!buildAssemblyModel(male,assembly.pocketFaces[male.id]).complete||!buildAssemblyModel(receiver,assembly.pocketFaces[receiver.id]).complete)return issue('pending','配合实体几何不完整');
  return null;
}
export const MISSING_CHECK_BASIS_ID='basis:missing';
export function analyzeAssembly(project:Project,assembly:Assembly,options:{installation?:boolean;machining?:boolean}={}):AssemblyAnalysis {
  const result:AssemblyAnalysis={issues:[],collisions:[],bounds:null,complete:true,checkedPairs:0};
  const addIssue=(kind:AssemblyIssue['kind'],severity:AssemblyIssue['severity'],message:string,partIds:string[],id=kind+':'+result.issues.length)=>result.issues.push({id,kind,severity,message,partIds});
  const solids:{item:AssemblyItem;cells:ConvexCell[];bounds:Bounds3;complete:boolean}[]=[];
  const seen=new Set<string>();
  for(const item of assembly.items){
    const part=project.parts.find(p=>p.id===item.partId);
    if(!part){addIssue('missing','error','装配引用了不存在的零件',[item.partId]);continue;}
    if(seen.has(item.partId)){addIssue('missing','error','同一库存零件重复装配',[item.partId]);continue;}seen.add(item.partId);
    if(assembly.sparePartIds.includes(item.partId)){addIssue('missing','error','备用零件不能同时参与装配',[item.partId]);continue;}
    if(!finite(item.position)||!finite(item.rotation)||!Number.isFinite(item.rotation.w)||length(item.rotation)+Math.abs(item.rotation.w)<1e-12){addIssue('geometry','pending','零件位置或旋转无效',[part.id]);solids.push({item,cells:[],bounds:vectorBounds(finite(item.position)?[item.position]:[]),complete:false});continue;}
    const model=buildAssemblyModel(part,assembly.pocketFaces[part.id]);
    for(const message of model.issues)addIssue('geometry','pending',message,[part.id]);
    // Fallback solids remain useful for display bounds, but cannot establish
    // either material interference or a verified straight installation path.
    const displayCells=model.cells.map(c=>transformCell(c,item));
    solids.push({item,cells:model.complete?displayCells:[],bounds:vectorBounds(displayCells.length?displayCells.flatMap(c=>c.vertices):[item.position]),complete:model.complete});
  }
  for(const part of project.parts)if(!seen.has(part.id)&&!assembly.sparePartIds.includes(part.id))addIssue('missing','error',`${part.name} 尚未参与装配或标记为备用`,[part.id]);
  for(const id of assembly.sparePartIds)if(!project.parts.some(p=>p.id===id))addIssue('missing','error','备用声明引用了不存在的零件',[id]);
  if(solids.length)result.bounds=vectorBounds(solids.flatMap(s=>[s.bounds.min,s.bounds.max]));
  let work=0,exhausted=false;
  const budget=()=>{if(++work>200000){exhausted=true;return false;}return true;};
  pairLoop:for(let i=0;i<solids.length;i++)for(let j=i+1;j<solids.length;j++){
    if(!budget())break pairLoop;
    const a=solids[i],b=solids[j];
    if(!a.complete||!b.complete){addIssue('collision','pending','零件实体几何未确认，干涉尚未完整检测',[a.item.partId,b.item.partId]);continue;}
    result.checkedPairs++;
    if(!broadOverlap(a.bounds,b.bounds))continue;
    const positions:number[]=[];let collision=false;
    for(const ca of a.cells)for(const cb of b.cells){
      if(!budget())break pairLoop;
      if(!broadOverlap(vectorBounds(ca.vertices),vectorBounds(cb.vertices),NUMERIC_EPSILON)||!cellsCollide(ca,cb))continue;
      collision=true;const clipped=intersectionPositions(ca,cb);for(const v of clipped)positions.push(v);
      if(positions.length>2_000_000){exhausted=true;break pairLoop;}
    }
    if(collision){result.collisions.push({partIds:[a.item.partId,b.item.partId],positions});addIssue('collision','error','实体材料发生干涉',[a.item.partId,b.item.partId]);}
  }
  const hasTargets=(['width','depth','height'] as const).some(name=>assembly.targets[name]!==undefined);
  if(!hasTargets&&!assembly.fits.length)addIssue('dimension','pending','尚未设置检测依据：可设置目标尺寸或适用的配合规则',[],MISSING_CHECK_BASIS_ID);
  const dimensionsKnown=solids.every(s=>s.complete);
  if(hasTargets&&!dimensionsKnown)addIssue('dimension','pending','零件实体几何未确认，目标尺寸尚未完整检测',[]);
  if(result.bounds){
    const tolerance=assembly.targets.tolerance;
    if(!Number.isFinite(tolerance)||tolerance<0)addIssue('dimension','pending','目标尺寸公差无效',[]);
    for(const [name,axis] of [['width','x'],['depth','y'],['height','z']] as const){const target=assembly.targets[name];if(target===undefined)continue;if(!Number.isFinite(target)||target<=0){addIssue('dimension','pending','目标尺寸无效',[]);continue;}if(!dimensionsKnown)continue;const actual=result.bounds.max[axis]-result.bounds.min[axis];if(Math.abs(actual-target)>tolerance+1e-7)addIssue('dimension','error',`${({width:'宽',depth:'深',height:'高'})[name]} 实际 ${actual.toFixed(2)} mm，目标 ${target} ± ${tolerance} mm`,[]);}
  }
  for(const fit of assembly.fits){const issue=declaredFitIssue(project,assembly,fit);if(issue)result.issues.push(issue);}
  if(options.installation){
    const installed:typeof solids=[];const stepsSeen=new Set<string>();
    sweepLoop:for(const step of assembly.steps){
      const s=solids.find(s=>s.item.partId===step.partId);
      if(!s||stepsSeen.has(step.partId)){addIssue('installation','pending','安装顺序包含不存在或重复的零件',[step.partId]);continue;}stepsSeen.add(step.partId);
      if(!s.complete){addIssue('installation','pending','零件实体几何未确认，安装行程无法完整检测',[step.partId]);installed.push(s);continue;}
      if(!finite(step.direction)||length(step.direction)<1e-9||!Number.isFinite(step.distance)||step.distance<=0){addIssue('installation','pending','安装方向和行程必须明确且有效',[step.partId]);installed.push(s);continue;}
      const motion=scale(normalize(step.direction),step.distance);
      const start=s.cells.map(c=>({...c,vertices:c.vertices.map(v=>subtract(v,motion))}));
      let first:{enter:number;leave:number;other:typeof solids[number]}|undefined;
      const sweptBounds=vectorBounds(start.flatMap(c=>c.vertices).concat(s.cells.flatMap(c=>c.vertices)));
      for(const other of installed){
        if(!other.complete){addIssue('installation','pending','已安装零件的实体几何未确认，该行程尚未完整检测',[s.item.partId,other.item.partId]);continue;}
        if(!broadOverlap(sweptBounds,other.bounds))continue;
        for(const ca of start)for(const cb of other.cells){
          if(!budget())break sweepLoop;
          const interval=sweptCollisionInterval(ca,cb,motion);
          if(interval&&(!first||interval.enter<first.enter))first={...interval,other};
        }
      }
      if(first){
        // The exact open SAT time interval supplies an interior overlap pose.
        // This evaluates one known blocked time; it never samples the path.
        const time=(first.enter+first.leave)/2,offset=scale(motion,time);
        const movingPosition=add(subtract(s.item.position,motion),offset);
        const movingCells=start.map(c=>({...c,vertices:c.vertices.map(v=>add(v,offset))}));
        const collisionPositions:number[]=[];
        for(const ca of movingCells)for(const cb of first.other.cells){
          if(!budget())break sweepLoop;
          if(!broadOverlap(vectorBounds(ca.vertices),vectorBounds(cb.vertices),NUMERIC_EPSILON)||!cellsCollide(ca,cb))continue;
          for(const coordinate of intersectionPositions(ca,cb))collisionPositions.push(coordinate);
          if(collisionPositions.length>2_000_000){exhausted=true;break sweepLoop;}
        }
        result.issues.push({id:`installation:${step.partId}`,kind:'installation',severity:'error',message:'声明的直线安装行程穿过已安装实体',partIds:[s.item.partId,first.other.item.partId],position:movingPosition,movingPosition,collisionPositions});
      }
      installed.push(s);
    }
    for(const s of solids)if(!stepsSeen.has(s.item.partId))addIssue('installation','pending','未声明该零件的安装顺序、方向和行程',[s.item.partId]);
  }
  if(exhausted)addIssue('geometry','pending','检测达到资源上限，未完成全部实体/行程检查',[]);
  if(options.machining)result.machiningWarnings=assemblyMachiningWarnings(project,assembly);
  result.complete=!result.issues.some(i=>i.severity==='pending');return result;
}
