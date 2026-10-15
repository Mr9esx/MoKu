import { describe, expect, it } from "vitest";
import type { AssemblyItem, PlacementCandidate } from "../src/core/assemblyTypes";
import { weakMoveSnap } from "../src/core/assemblyGuidance";
import { rotationFromEuler, transformPoint } from "../src/core/assemblyGeometry";

const pose=(x=0,y=0,z=0,degrees=90):AssemblyItem=>({partId:"tenon",position:{x,y,z},rotation:rotationFromEuler({x:degrees,y:0,z:0})});
const candidate:PlacementCandidate={id:"mortise",partId:"tenon",receiverId:"host",pose:pose(50,20),target:{x:50,y:20,z:12},label:"榫卯",status:"incomplete",insertion:{maleEdge:0,depth:12,width:45,clearance:0,sourceAnchor:{x:0,y:0,z:6},receiverAnchor:{x:50,y:14,z:0},direction:{x:0,y:0,z:1},geometryChecked:true}};
const options={enabled:true,axes:"xy",project:(p:{x:number;y:number})=>({x:p.x*0.5,y:p.y*0.5})};
describe("direct tenon magnet",()=>{
  it("snaps a rotated board near a geometrically proven mortise during ordinary movement",()=>{
    const result=weakMoveSnap(pose(40,20),[candidate],options);
    expect(result.candidateId).toBe("mortise");
    expect(result.pose.position).toEqual(candidate.pose.position);
  });
  it("only makes a small angular correction, never turns a flat board upright",()=>{
    expect(weakMoveSnap(pose(50,20,0,0),[candidate],options).candidateId).toBeNull();
    const result=weakMoveSnap(pose(50,20,0,85),[candidate],{...options,axes:"xyz"});
    expect(result.candidateId).toBe("mortise");
    expect(result.pose.rotation).toEqual(candidate.pose.rotation);
    expect(weakMoveSnap(pose(50,20,0,81),[candidate],{...options,axes:"xyz"}).candidateId).toBeNull();
  });
  it("uses a short capture range and a slightly wider release range",()=>{
    expect(weakMoveSnap(pose(37.9,20),[candidate],options).candidateId).toBeNull();
    expect(weakMoveSnap(pose(33,20),[candidate],{...options,heldId:"mortise"}).candidateId).toBe("mortise");
    expect(weakMoveSnap(pose(31.9,20),[candidate],{...options,heldId:"mortise"}).candidateId).toBeNull();
    expect(weakMoveSnap(pose(40,20),[candidate],{...options,project:p=>({x:p.x*2,y:p.y*2})}).candidateId).toBeNull();
  });
  it("measures proximity at the actual tenon rather than a distant part origin",()=>{
    const anchor={x:0,y:700,z:6},c={...candidate,insertion:{...candidate.insertion!,sourceAnchor:anchor}};
    const destination=transformPoint(anchor,c.pose),rotated=pose(0,0,0,85),offset=transformPoint(anchor,rotated);
    rotated.position={x:destination.x-offset.x,y:destination.y-offset.y,z:destination.z-offset.z};
    expect(Math.hypot(rotated.position.x-c.pose.position.x,rotated.position.y-c.pose.position.y,rotated.position.z-c.pose.position.z)).toBeGreaterThan(50);
    expect(weakMoveSnap(rotated,[c],{...options,axes:"xyz"}).candidateId).toBe("mortise");
  });
  it("respects Alt, disabled magnet, active axes, locks and failed geometry",()=>{
    for(const override of [{suspended:true},{enabled:false}]) expect(weakMoveSnap(pose(49,20),[candidate],{...options,...override}).candidateId).toBeNull();
    expect(weakMoveSnap(pose(49,20,2),[candidate],options).candidateId).toBeNull();
    expect(weakMoveSnap({...pose(49,20),locked:true},[candidate],options).candidateId).toBeNull();
    expect(weakMoveSnap(pose(49,20),[{...candidate,status:"invalid"}],options).candidateId).toBeNull();
    expect(weakMoveSnap(pose(49,20),[{...candidate,insertion:{...candidate.insertion!,geometryChecked:false}}],options).candidateId).toBeNull();
  });
});
