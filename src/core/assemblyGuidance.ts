import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Part, Project } from './types';
import type { Assembly, AssemblyItem, FitConstraint, PlacementCandidate, Vec3 } from './assemblyTypes';
import { buildAssemblyModel, geometrySignature, quaternion, transformPoint } from './assemblyGeometry';
import { MISSING_CHECK_BASIS_ID, add, analyzeAssembly, cross, dot, length, normalize, rectangularSlot, scale, subtract } from './assemblyChecks';
import { signedArea } from './geometry';
import { tenonInsertionCandidates } from './assemblyJoinery';
import { ordinaryContactCandidates, resolveContact, contactPoseClear } from './assemblyContacts';
function slotPose(male:Part,receiver:Part,host:AssemblyItem,assembly:Assembly,feature:{kind:'pocket'|'hole';index:number},fit?:FitConstraint):AssemblyItem|null {
  const outline=feature.kind==='pocket'?receiver.pockets[feature.index]?.outline:receiver.holes[feature.index];
  const slot=outline?rectangularSlot(outline):null;if(!slot)return null;
  const index=fit?.maleEdge??0,a=male.outline[index],b=male.outline[(index+1)%male.outline.length];if(!a||!b)return null;
  const u=normalize({x:b.x-a.x,y:b.y-a.y,z:0});if(length(subtract({...b,z:0},{...a,z:0}))<1e-9)return null;
  const winding=signedArea(male.outline)>0?1:-1;
  const n={x:-u.y*winding,y:u.x*winding,z:0};
  const face=feature.kind==='pocket'&&assembly.pocketFaces[receiver.id]?.signature===geometrySignature(receiver)?assembly.pocketFaces[receiver.id].faces[feature.index]:'front';
  const outward={x:0,y:0,z:face==='back'?-1:1},targetU={...slot.u,z:0};
  const current=assembly.items.find(i=>i.partId===male.id);
  if(current){const worldU=new Vector3(u.x,u.y,0).applyQuaternion(quaternion(current.rotation)),hostU=new Vector3(targetU.x,targetU.y,0).applyQuaternion(quaternion(host.rotation));if(worldU.dot(hostU)<0){targetU.x*=-1;targetU.y*=-1;}}
  const targetZ=scale(cross(targetU,outward),winding);
  const vector=(v:Vec3)=>new Vector3(v.x,v.y,v.z);
  const source=new Matrix4().makeBasis(vector(u),vector(n),new Vector3(0,0,1));
  const target=new Matrix4().makeBasis(vector(targetU),vector(outward),vector(targetZ));
  const q=new Quaternion().setFromRotationMatrix(target.multiply(source.transpose())).normalize();
  const depth=fit?.insertionDepth??(feature.kind==='pocket'?receiver.pockets[feature.index].depth??0:receiver.thickness);
  const desired=transformPoint({x:slot.center.x,y:slot.center.y,z:face==='back'?depth:receiver.thickness-depth},host);
  q.premultiply(quaternion(host.rotation)).normalize();
  const anchor=new Vector3((a.x+b.x)/2,(a.y+b.y)/2,male.thickness/2).applyQuaternion(q);
  return {partId:male.id,position:{x:desired.x-anchor.x,y:desired.y-anchor.y,z:desired.z-anchor.z},rotation:{x:q.x,y:q.y,z:q.z,w:q.w}};
}
function candidateStatus(project:Project,assembly:Assembly,pose:AssemblyItem):Pick<PlacementCandidate,'status'|'message'> {
  const trial={...assembly,items:assembly.items.map(i=>i.partId===pose.partId?pose:i)};
  const analysis=analyzeAssembly(project,trial);
  // Inventory and installation describe the whole build; candidate colour describes this pose.
  const relevant=analysis.issues.filter(i=>i.partIds.includes(pose.partId)||i.kind==='dimension'&&i.severity==='pending'&&i.id!==MISSING_CHECK_BASIS_ID||i.kind==='geometry'&&i.severity==='pending');
  const uncertainGeometry=relevant.find(i=>i.kind==='geometry'&&i.severity==='pending');if(uncertainGeometry)return {status:'incomplete',message:uncertainGeometry.message};
  const bad=relevant.find(i=>i.severity==='error'&&i.kind!=='missing');if(bad)return {status:'invalid',message:bad.message};
  const pending=relevant.find(i=>i.severity==='pending');if(pending)return {status:'incomplete',message:pending.message};
  if(analysis.bounds){
    for(const [name,k] of [['width','x'],['depth','y'],['height','z']] as const){const max=assembly.targets[name];if(max!==undefined&&analysis.bounds.max[k]-analysis.bounds.min[k]>max+assembly.targets.tolerance+1e-7)return {status:'invalid',message:'候选位置超出目标外形尺寸'};}
  }
  return {status:'valid'};
}
function faceSamples(part:Part,item:AssemblyItem,assembly:Assembly) {
  const model=buildAssemblyModel(part,assembly.pocketFaces[part.id]);
  const faces:{center:Vec3;normal:Vec3}[]=[];
  for(let i=0;i<model.positions.length;i+=9){
    const vs=[0,3,6].map(k=>transformPoint({x:model.positions[i+k],y:model.positions[i+k+1],z:model.positions[i+k+2]},item));
    const normal=normalize(cross(subtract(vs[1],vs[0]),subtract(vs[2],vs[0]))),center=scale(vs.reduce(add,{x:0,y:0,z:0}),1/3);
    if(!faces.some(f=>length(subtract(f.center,center))<1e-5&&dot(f.normal,normal)>1-1e-6))faces.push({center,normal});
    if(faces.length>=96)break;
  }
  return faces;
}
export function placementCandidates(project:Project,assembly:Assembly,partId:string):PlacementCandidate[] {
  const male=project.parts.find(p=>p.id===partId),item=assembly.items.find(i=>i.partId===partId);
  if(!male||!item||item.locked)return [];
  const insertions=tenonInsertionCandidates(project,assembly,partId);
  const generalContacts=ordinaryContactCandidates(project,assembly,partId);
  if(insertions.length || generalContacts.length) return [...insertions.map(candidate=>({...candidate,...candidateStatus(project,assembly,candidate.pose)})),...generalContacts];
  const result:PlacementCandidate[]=[];
  for(const host of assembly.items){
    if(host.partId===partId)continue;const receiver=project.parts.find(p=>p.id===host.partId);if(!receiver)continue;
    for(const kind of ['pocket','hole'] as const){
      const features=kind==='pocket'?receiver.pockets:receiver.holes;
      for(let index=0;index<features.length;index++){
        const feature={kind,index},fit=assembly.fits.find(f=>f.partId===partId&&f.receiverId===host.partId&&f.feature.kind===kind&&f.feature.index===index);
        const pose=slotPose(male,receiver,host,assembly,feature,fit);if(!pose)continue;
        const status=candidateStatus(project,assembly,pose);
        if(!fit&&status.status!=='invalid'){status.status='incomplete';status.message='矩形槽预览；需声明插入边、深度和制造间隙';}
        result.push({id:`slot:${partId}:${host.partId}:${kind}:${index}`,partId,receiverId:host.partId,pose,target:pose.position,label:`${receiver.name} ${kind==='pocket'?'槽':'通孔'} ${index+1}`,feature,...status});
        if(result.length>=48)return result;
      }
    }
  }
  const movingFaces=faceSamples(male,item,assembly);
  let contacts=0;
  for(const host of assembly.items){
    if(host.partId===partId)continue;const receiver=project.parts.find(p=>p.id===host.partId);if(!receiver)continue;
    const hostFaces=faceSamples(receiver,host,assembly);
    for(const source of movingFaces)for(const target of hostFaces){
      if(dot(source.normal,target.normal)>-1+1e-6)continue;
      const position=add(item.position,subtract(target.center,source.center));
      if(result.some(c=>!c.feature&&length(subtract(c.pose.position,position))<0.01&&c.receiverId===host.partId))continue;
      const pose={...item,position};
      result.push({id:`face:${partId}:${host.partId}:${contacts++}`,partId,receiverId:host.partId,pose,target:position,label:`${receiver.name} 表面接触`,...candidateStatus(project,assembly,pose)});
      if(contacts>=24)return result;
    }
  }
  return result;
}
export function weakSnap(pose:AssemblyItem,candidates:PlacementCandidate[],options:{enabled:boolean;suspended?:boolean;heldId?:string|null;axes?:string;project:(point:Vec3)=>{x:number;y:number}}):{pose:AssemblyItem;candidateId:string|null} {
  if(!options.enabled||options.suspended||pose.locked)return {pose,candidateId:null};
  const allowed=options.axes?.toLowerCase()??'xyz';
  const screen=options.project(pose.position);let best:PlacementCandidate|undefined,bestPose:AssemblyItem|undefined,bestPixels=Infinity,bestRank=Infinity;
  for(const candidate of candidates){
    if(candidate.partId!==pose.partId || candidate.status==='invalid')continue;
    const insertion=!!candidate.insertion?.geometryChecked || !!candidate.contact;
    const resolved=candidate.contact?resolveContact(pose,candidate):null;
    if(candidate.contact&&!resolved)continue;
    const destination=resolved?.pose??candidate.pose;
    if(candidate.status!=='valid'&&!insertion)continue;
    const held=options.heldId===candidate.id;
    const a=quaternion(pose.rotation),b=quaternion(destination.rotation);
    if(insertion ? a.angleTo(b)>(held?12:8)*Math.PI/180 : Math.abs(a.dot(b))<1-1e-7)continue;
    const delta=subtract(destination.position,pose.position);
    if((['x','y','z'] as const).some(k=>!allowed.includes(k)&&Math.abs(delta[k])>1e-6))continue;
    const anchor=candidate.contact?.sourceAnchor??candidate.insertion?.sourceAnchor;
    const from=insertion?transformPoint(anchor!,pose):pose.position;
    const to=insertion?transformPoint(anchor!,destination):destination.position;
    const origin=insertion?options.project(from):screen,projected=options.project(to),pixels=Math.hypot(projected.x-origin.x,projected.y-origin.y),world=length(subtract(to,from));
    if(!Number.isFinite(pixels)||world>(insertion?(held?18:12):(held?8:5))||pixels>(insertion?(held?16:10):(held?12:8)))continue;
    if(candidate.contact&&!contactPoseClear(candidate.contact.geometry,destination))continue;
    if(held){best=candidate;bestPose=destination;break;}
    const rank=candidate.contact?.kind==='surface'?1:0;
    if(rank<bestRank || rank===bestRank&&pixels<bestPixels){best=candidate;bestPose=destination;bestPixels=pixels;bestRank=rank;}
  }
  return best?{pose:{...pose,position:{...bestPose!.position},rotation:best.insertion||best.contact?{...bestPose!.rotation}:pose.rotation},candidateId:best.id}:{pose,candidateId:null};
}

/** Assembly contacts take precedence; otherwise each moving axis can settle at zero. */
export function weakMoveSnap(
  pose: AssemblyItem,
  candidates: PlacementCandidate[],
  options: Parameters<typeof weakSnap>[2] & { heldOriginAxes?: (keyof Vec3)[] },
): { pose: AssemblyItem; candidateId: string | null; zeroAxes: (keyof Vec3)[] } {
  const idle = { pose, candidateId: null, zeroAxes: [] as (keyof Vec3)[] };
  if (!options.enabled || options.suspended || pose.locked ||
      !Object.values(pose.position).every(Number.isFinite)) return idle;
  const contact = weakSnap(pose, candidates, options);
  if (contact.candidateId) return { ...contact, zeroAxes: [] };

  const allowed = options.axes?.toLowerCase() ?? "xyz";
  const screen = options.project(pose.position);
  const position = { ...pose.position }, zeroAxes: (keyof Vec3)[] = [];
  for (const axis of ["x", "y", "z"] as const) {
    if (!allowed.includes(axis)) continue;
    const held = options.heldOriginAxes?.includes(axis) ?? false;
    if (Math.abs(pose.position[axis]) > (held ? 6 : 3)) continue;
    const target = options.project({ ...pose.position, [axis]: 0 });
    const pixels = Math.hypot(target.x - screen.x, target.y - screen.y);
    if (!Number.isFinite(pixels) || pixels > (held ? 11 : 7)) continue;
    position[axis] = 0;
    zeroAxes.push(axis);
  }
  return zeroAxes.length
    ? { pose: { ...pose, position }, candidateId: null, zeroAxes }
    : idle;
}
