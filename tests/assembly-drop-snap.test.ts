import { describe, expect, it } from "vitest";
import { createAssemblyDemo } from "../src/core/assemblyDemo";
import { placementCandidates, weakMoveSnap } from "../src/core/assemblyGuidance";
import { contactPoseClear, resolveContact } from "../src/core/assemblyContacts";
import { analyzeAssembly } from "../src/core/assemblyChecks";

function fixture(declared=true) {
  const project=createAssemblyDemo(),assembly=project.assembly!;
  if(!declared){assembly.fits=[];assembly.targets={tolerance:0.5};}
  const raw={...assembly.items[1],position:{x:70.4,y:27.42,z:0}};
  assembly.items[1]=raw;
  return {project,assembly,raw,candidates:placementCandidates(project,assembly,raw.partId)};
}
const projectScreen=(p:{x:number;y:number;z:number})=>({x:p.x*4,y:(p.y+p.z)*4});
const options={enabled:true,axes:"xy",freePlacement:true,project:projectScreen};

describe("drop a nearby board into its joint",()=>{
  it("reproduces the screenshot: normal body movement seats the board from Z=0 on the Z=6 groove floor",()=>{
    const {project,assembly,raw,candidates}=fixture();
    const snapped=weakMoveSnap(raw,candidates,options);
    expect(snapped.candidateId?.startsWith("groove:")).toBe(true);
    expect(snapped.pose.position.x).toBeCloseTo(66);
    expect(snapped.pose.position.y).toBeCloseTo(20);
    expect(snapped.pose.position.z).toBeCloseTo(6);
    expect(snapped.zeroAxes).toEqual([]);
    const check=analyzeAssembly(project,{...assembly,items:[assembly.items[0],snapped.pose]});
    expect(check.collisions).toHaveLength(0);
    expect(check.issues.filter(i=>i.partIds.includes(raw.partId))).toEqual([]);
  });
  it("seats a correctly aligned edge even when zoom makes the automatic depth correction large on screen",()=>{
    const {raw,candidates}=fixture();raw.position={x:66,y:20,z:0};
    const result=weakMoveSnap(raw,candidates,{...options,project:p=>({x:p.x*100,y:(p.y+p.z)*100})});
    expect(result.candidateId?.startsWith("groove:")).toBe(true);expect(result.pose.position.z).toBeCloseTo(6);
  });
  it("preserves strict inactive axes when the user drags an axis arrow",()=>{
    const {raw,candidates}=fixture();
    expect(weakMoveSnap(raw,candidates,{...options,freePlacement:false}).candidateId).toBeNull();
  });
  it("still respects disabled magnet, Alt, locks and out-of-range placement",()=>{
    const {raw,candidates}=fixture();
    for(const override of [{enabled:false},{suspended:true}])expect(weakMoveSnap(raw,candidates,{...options,...override}).candidateId).toBeNull();
    expect(weakMoveSnap({...raw,locked:true},candidates,options).candidateId).toBeNull();
    expect(weakMoveSnap({...raw,position:{...raw.position,z:-100}},candidates,options).candidateId).toBeNull();
  });
  it("prefers insertion into a nearby groove over a held ordinary surface contact",()=>{
    const {raw,candidates}=fixture(false);raw.position.z=12;
    const surface=candidates.find(c=>c.contact?.kind==="surface"&&c.contact.normal.z>0.9&&(()=>{const r=resolveContact(raw,c);return r&&contactPoseClear(c.contact!.geometry,r.pose);})());
    expect(surface).toBeDefined();
    const result=weakMoveSnap(raw,candidates,{...options,heldId:surface!.id});
    expect(result.candidateId?.startsWith("groove:")).toBe(true);expect(result.pose.position.z).toBeCloseTo(6);
  });
  it("does not relax the final material or manufacturing checks",()=>{
    const {project,assembly,raw}=fixture();assembly.fits[0].minClearance=0.5;
    expect(weakMoveSnap(raw,placementCandidates(project,assembly,raw.partId),options).candidateId).toBeNull();
  });
  it("uses a wider release range so the user can still pull a snapped piece away",()=>{
    const {raw,candidates}=fixture(),candidate=candidates.find(c=>c.contact?.sourceEdge===3)!;
    const near={...raw,position:{x:85,y:20,z:6}};
    expect(weakMoveSnap(near,[candidate],{...options,project:p=>({x:p.x,y:p.y})}).candidateId).toBeNull();
    expect(weakMoveSnap(near,[candidate],{...options,heldId:candidate.id,project:p=>({x:p.x,y:p.y})}).candidateId).toBe(candidate.id);
    expect(weakMoveSnap({...near,position:{...near.position,x:94}},[candidate],{...options,heldId:candidate.id,project:p=>({x:p.x,y:p.y})}).candidateId).toBeNull();
  });
});
