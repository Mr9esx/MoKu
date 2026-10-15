import { describe, expect, it } from "vitest";
import type { AssemblyItem } from "../src/core/assemblyTypes";
import { emptyAssembly } from "../src/core/assemblyTypes";
import type { Part, Project } from "../src/core/types";
import { geometrySignature, rotationFromEuler, transformPoint } from "../src/core/assemblyGeometry";
import { placementCandidates, weakSnap } from "../src/core/assemblyGuidance";
const rect=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const plate=(id:string,w=100,h=80,t=12):Part=>({id,name:id,stockId:"s",layer:"CUT",thickness:t,width:w,height:h,area:w*h,outline:rect(0,0,w,h),holes:[],pockets:[],label:{x:w/2,y:h/2}});
const pose=(partId:string,x=0,y=0,z=0):AssemblyItem=>({partId,position:{x,y,z},rotation:{x:0,y:0,z:0,w:1}});
const options={enabled:true,project:(p:{x:number;y:number;z:number})=>({x:p.x*0.5,y:(p.y+p.z)*0.5})};
function fixture(parts=[plate("r"),plate("m",30,40)]) {const project:Project={name:"contact",units:"mm",parts,sheets:[],original:{sheets:[],placements:[]},warnings:[]};const assembly=emptyAssembly();assembly.items=parts.map((p,i)=>pose(p.id,i*130));return {project,assembly};}
describe("ordinary assembly contacts",()=>{
 it("snaps side-to-side while preserving arbitrary tangential position",()=>{
  const {project,assembly}=fixture();const candidates=placementCandidates(project,assembly,"m");
  const result=weakSnap(pose("m",105,23),candidates,{...options,axes:"xy"});
  expect(result.candidateId).not.toBeNull();expect(result.pose.position).toEqual({x:100,y:23,z:0});
 });
 it("stacks boards without centering their X/Y coordinates",()=>{
  const {project,assembly}=fixture();const candidates=placementCandidates(project,assembly,"m");
  const result=weakSnap(pose("m",17,19,16),candidates,{...options,axes:"z"});
  expect(result.candidateId).not.toBeNull();expect(result.pose.position).toEqual({x:17,y:19,z:12});
 });
 it("preserves the user's twist around the contact normal",()=>{
  const {project,assembly}=fixture(),raw={...pose("m",17,19,16),rotation:rotationFromEuler({x:0,y:0,z:5})};
  const result=weakSnap(raw,placementCandidates(project,assembly,"m"),{...options,axes:"z"});
  expect(result.candidateId).not.toBeNull();expect(result.pose.position.z).toBe(12);
  expect(result.pose.rotation.z).toBeCloseTo(raw.rotation.z);expect(result.pose.rotation.w).toBeCloseTo(raw.rotation.w);
 });
 it("does not snap onto empty space inside a through hole",()=>{
  const r=plate("r");r.holes=[rect(10,10,70,60)];const {project,assembly}=fixture([r,plate("m",20,20)]);
  expect(weakSnap(pose("m",30,30,16),placementCandidates(project,assembly,"m"),{...options,axes:"z"}).candidateId).toBeNull();
 });
 it("rejects a dynamically translated contact that collides with a third board",()=>{
  const {project,assembly}=fixture([plate("r"),plate("m",30,40),plate("obstacle",20,20)]);assembly.items[2]=pose("obstacle",105,45);
  expect(weakSnap(pose("m",105,23),placementCandidates(project,assembly,"m"),{...options,axes:"x"}).candidateId).toBeNull();
  assembly.items[2]=pose("obstacle",500,500);
  expect(weakSnap(pose("m",105,23),placementCandidates(project,assembly,"m"),{...options,axes:"x"}).candidateId).not.toBeNull();
 });
 it("supports a translated, rotated receiving board",()=>{
  const {project,assembly}=fixture();assembly.items[0]={...pose("r",80,40,30),rotation:rotationFromEuler({x:0,y:0,z:30})};
  assembly.items[1]={...pose("m"),position:transformPoint({x:130,y:0,z:0},assembly.items[0]),rotation:assembly.items[0].rotation};
  const raw={...assembly.items[1],position:transformPoint({x:105,y:23,z:0},assembly.items[0])};
  const result=weakSnap(raw,placementCandidates(project,assembly,"m"),options),expected=transformPoint({x:100,y:23,z:0},assembly.items[0]);
  expect(result.candidateId).not.toBeNull();for(const axis of ["x","y","z"] as const)expect(result.pose.position[axis]).toBeCloseTo(expected[axis]);
 });
 it("honors target dimensions after arbitrary tangential movement",()=>{
  const {project,assembly}=fixture();assembly.targets={width:100,depth:80,height:40,tolerance:0};
  expect(weakSnap(pose("m",90,19,16),placementCandidates(project,assembly,"m"),{...options,axes:"z"}).candidateId).toBeNull();
 });
 it("does not advertise automatic contacts for an invalid receiving pose",()=>{
  const {project,assembly}=fixture();assembly.items[0].position.x=NaN;
  expect(placementCandidates(project,assembly,"m").filter(c=>c.contact)).toHaveLength(0);
 });
});
describe("automatic routed groove contacts",()=>{
 function groove(){const r=plate("r",120,120);r.pockets=[{outline:rect(53.8,10,12.4,100),depth:6}];const {project,assembly}=fixture([r,plate("m",60,80)]);assembly.pocketFaces.r={signature:geometrySignature(r),faces:{0:"front"}};assembly.items[1]={...pose("m",70.4,10,6),rotation:rotationFromEuler({x:0,y:-90,z:0})};return {project,assembly};}
 it("finds the matching real edge without a declared fit, and seats it on the groove floor",()=>{
  const {project,assembly}=groove();const candidates=placementCandidates(project,assembly,"m");
  const result=weakSnap(assembly.items[1],candidates,{...options,axes:"xy"});
  expect(result.candidateId).not.toBeNull();expect(result.pose.position.x).toBeCloseTo(66);expect(result.pose.position.y).toBeCloseTo(10);expect(result.pose.position.z).toBeCloseTo(6);
  expect(assembly.fits).toEqual([]);
 });
 it("lets a shorter board slide along a longer groove",()=>{
  const {project,assembly}=groove();const raw={...assembly.items[1],position:{x:70.4,y:27,z:6}};
  const result=weakSnap(raw,placementCandidates(project,assembly,"m"),{...options,axes:"xy"});
  expect(result.candidateId).not.toBeNull();expect(result.pose.position.x).toBeCloseTo(66);expect(result.pose.position.y).toBeCloseTo(27);
 });
 it("keeps a free end of a long groove usable when another part blocks its center",()=>{
  const {project,assembly}=groove();project.parts[1]=plate("m",60,20);
  project.parts.push(plate("block",20,20));assembly.items.push(pose("block",50,50,6));
  const raw={...assembly.items[1],position:{x:70.4,y:10,z:6}};
  const result=weakSnap(raw,placementCandidates(project,assembly,"m"),{...options,axes:"xy"});
  expect(result.candidateId).not.toBeNull();expect(result.pose.position.x).toBeCloseTo(66);expect(result.pose.position.y).toBeCloseTo(10);
 });
 it("checks declared fits at the actual free end rather than the blocked groove center",()=>{
  const {project,assembly}=groove();project.parts[1]=plate("m",60,20);
  project.parts.push(plate("block",20,20));assembly.items.push(pose("block",50,50,6));
  assembly.fits=[{id:"fit",partId:"m",receiverId:"r",feature:{kind:"pocket",index:0},maleEdge:3,insertionDepth:6,minClearance:0.2,maxClearance:0.6,partSignature:geometrySignature(project.parts[1]),receiverSignature:geometrySignature(project.parts[0])}];
  const raw={...assembly.items[1],position:{x:70.4,y:10,z:6}};
  const result=weakSnap(raw,placementCandidates(project,assembly,"m"),{...options,axes:"xy"});
  expect(result.candidateId).not.toBeNull();expect(result.pose.position.x).toBeCloseTo(66);expect(result.pose.position.y).toBeCloseTo(10);
  assembly.fits[0].minClearance=0.5;
  expect(weakSnap(raw,placementCandidates(project,assembly,"m"),{...options,axes:"xy"}).candidateId).toBeNull();
 });
 it("keeps unknown machining faces neutral",()=>{
  const {project,assembly}=groove();assembly.pocketFaces={};
  expect(weakSnap(assembly.items[1],placementCandidates(project,assembly,"m"),options).candidateId).toBeNull();
 });
 it("supports an open groove that reaches the board edge",()=>{
  const {project,assembly}=groove();project.parts[0].pockets[0].outline=rect(53.8,20,12.4,100);assembly.pocketFaces.r.signature=geometrySignature(project.parts[0]);
  const raw={...assembly.items[1],position:{x:70.4,y:35,z:6}};
  const result=weakSnap(raw,placementCandidates(project,assembly,"m"),{...options,axes:"xy"});
  expect(result.candidateId).not.toBeNull();expect(result.pose.position.y).toBeCloseTo(35);expect(result.pose.position.x).toBeCloseTo(66);
 });
 it("seats against the back groove floor in the opposite insertion direction",()=>{
  const {project,assembly}=groove();assembly.pocketFaces.r.faces[0]="back";
  const raw={...assembly.items[1],position:{x:58.4,y:27,z:6},rotation:rotationFromEuler({x:0,y:90,z:0})};
  assembly.items[1]=raw;
  const result=weakSnap(raw,placementCandidates(project,assembly,"m"),{...options,axes:"xy"});
  expect(result.candidateId).not.toBeNull();expect(result.pose.position.x).toBeCloseTo(54);expect(result.pose.position.y).toBeCloseTo(27);expect(result.pose.position.z).toBeCloseTo(6);
 });
 it("does not seat a board on a nominal groove floor removed by a deeper cut",()=>{
  const {project,assembly}=groove();project.parts[0].pockets.push({...project.parts[0].pockets[0],depth:9});
  assembly.pocketFaces.r={signature:geometrySignature(project.parts[0]),faces:{0:"front",1:"front"}};
  const candidates=placementCandidates(project,assembly,"m").filter(c=>c.contact?.kind==="groove");
  expect(candidates.some(c=>c.feature?.index===0)).toBe(false);
  expect(weakSnap(assembly.items[1],candidates,{...options,axes:"xy"}).candidateId).toBeNull();
 });
});
