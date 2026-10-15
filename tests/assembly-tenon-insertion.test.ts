import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDxf } from "../src/core/dxf";
import { emptyAssembly } from "../src/core/assemblyTypes";
import { placementCandidates } from "../src/core/assemblyGuidance";
import { analyzeAssembly } from "../src/core/assemblyChecks";
import { rotationFromEuler, transformPoint } from "../src/core/assemblyGeometry";
import { createWorkbenchStore } from "../src/store";
import { pointInPolygon } from "../src/core/geometry";
import { matchingMortiseProfiles, tenonInsertionCandidates } from "../src/core/assemblyJoinery";

const sample = parseDxf(readFileSync("public/sample.dxf", "utf8"));
function fixture() {
  const receiver = sample.parts.find(p => p.name === "P01")!;
  const moving = sample.parts.find(p => p.name === "P20")!;
  const project = { ...sample, parts: [receiver, moving] };
  const assembly = emptyAssembly();
  assembly.items = [receiver, moving].map((p,i) => ({ partId: p.id, position: { x: i * 200, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } }));
  return { project, assembly, receiver, moving };
}
function longTenonFixture() {
  const { project, assembly, receiver, moving } = fixture();
  const host = { ...receiver, outline: [{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}], holes: [[{x:30,y:40},{x:75,y:40},{x:75,y:52},{x:30,y:52}]], pockets: [] };
  const male = { ...moving, outline: [{x:0,y:20},{x:25,y:20},{x:25,y:0},{x:70,y:0},{x:70,y:100},{x:0,y:100}], holes: [], pockets: [] };
  return { project: {...project,parts:[host,male]}, assembly, receiver:host, moving:male };
}
describe("real tenons and relieved mortises", () => {
  it("seats the actual shoulder when a tenon is longer than the receiving board thickness", () => {
    const {project,assembly,moving} = longTenonFixture();
    const candidate = tenonInsertionCandidates(project,assembly,moving.id).find(c=>c.insertion?.sourceAnchor.y===0)!;
    expect(candidate).toBeDefined();
    expect(candidate.insertion!.depth).toBe(20);
    expect(transformPoint({x:47.5,y:0,z:6},candidate.pose).z).toBeCloseTo(-8);
    expect(transformPoint({x:47.5,y:20,z:6},candidate.pose).z).toBeCloseTo(12);
  });
  it("keeps an insertion available when two unrelated stationary boards collide", () => {
    const {project,assembly,receiver,moving} = longTenonFixture();
    const other = {...receiver,id:"other-a",outline:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}],holes:[]};
    project.parts.push(other,{...other,id:"other-b"});
    for(const partId of ["other-a","other-b"]) assembly.items.push({partId,position:{x:500,y:500,z:0},rotation:{x:0,y:0,z:0,w:1}});
    expect(tenonInsertionCandidates(project,assembly,moving.id).some(c=>c.receiverId===receiver.id)).toBe(true);
  });
  it("follows the tenon sides to their shoulders instead of using an unrelated nearby ledge", () => {
    const {project,assembly,moving} = longTenonFixture();
    project.parts[0] = {...project.parts[0],outline:[{x:0,y:0},{x:60,y:0},{x:60,y:100},{x:0,y:100}],holes:[[{x:5,y:40},{x:50,y:40},{x:50,y:52},{x:5,y:52}]]};
    project.parts[1] = {...moving,outline:[{x:27.5,y:0},{x:72.5,y:0},{x:72.5,y:20},{x:100,y:20},{x:100,y:100},{x:0,y:100},{x:0,y:12},{x:10,y:12},{x:10,y:20},{x:27.5,y:20}]};
    const candidate=tenonInsertionCandidates(project,assembly,moving.id).find(c=>c.insertion?.maleEdge===0)!;
    expect(candidate).toBeDefined();
    expect(candidate.insertion!.depth).toBe(20);
    expect(transformPoint({x:50,y:20,z:6},candidate.pose).z).toBeCloseTo(12);
  });
  it("transforms the fitted tip and shoulder with a rotated, translated receiver", () => {
    const {project,assembly,moving} = fixture();
    assembly.items[0] = {...assembly.items[0],position:{x:40,y:-70,z:90},rotation:rotationFromEuler({x:24,y:36,z:53})};
    const candidate = tenonInsertionCandidates(project,assembly,moving.id).find(c=>c.feature?.index===0 && c.insertion?.sourceAnchor.y===0)!;
    expect(candidate).toBeDefined();
    for(const [local,receiverLocal] of [[{x:72.5,y:0,z:6},{x:72.5,y:46,z:0}],[{x:72.5,y:12,z:6},{x:72.5,y:46,z:12}]] as const) {
      const actual=transformPoint(local,candidate.pose),expected=transformPoint(receiverLocal,assembly.items[0]);
      for(const axis of ["x","y","z"] as const) expect(actual[axis]).toBeCloseTo(expected[axis]);
    }
  });
  it("keeps the arc midpoint at each nominal mortise corner during DXF tessellation", () => {
    const { receiver } = fixture();
    for (const [x,y] of [[50,40],[95,40],[95,52],[50,52]]) expect(pointInPolygon({x,y},receiver.holes[0])).toBe(true);
  });
  it("finds the 45×12 P20 end tenon and inserts it through the first P01 mortise", () => {
    const { project, assembly, moving } = fixture();
    const candidate = placementCandidates(project, assembly, moving.id).find(c => c.insertion && c.feature?.index === 0 && c.insertion.sourceAnchor.y === 0);
    expect(candidate).toBeDefined();
    expect(candidate!.insertion!.depth).toBe(12);
    expect(candidate!.insertion!.width).toBeCloseTo(45);
    const tip = transformPoint({ x: 72.5, y: 0, z: 6 }, candidate!.pose);
    const shoulder = transformPoint({ x: 72.5, y: 12, z: 6 }, candidate!.pose);
    expect(tip.x).toBeCloseTo(72.5); expect(tip.y).toBeCloseTo(46); expect(tip.z).toBeCloseTo(0);
    expect(shoulder.z).toBeCloseTo(12);
  });
  it("proves no overlap even with all shallow cuts filled, so either machining face remains collision-free", () => {
    const { project, assembly, moving } = fixture();
    const candidate = placementCandidates(project, assembly, moving.id).find(c => c.insertion && c.feature?.index === 0 && c.insertion.sourceAnchor.y === 0)!;
    expect(candidate).toBeDefined();
    const result = analyzeAssembly({ ...project, parts: project.parts.map(p=>({...p,pockets:[]})) }, { ...assembly, items: [assembly.items[0], candidate.pose] });
    expect(result.checkedPairs).toBe(1);
    expect(result.collisions).toHaveLength(0);
    expect(result.issues.filter(i => i.kind === "geometry")).toHaveLength(0);
  });
  it("does not confuse a chamfered or rounded aperture bounding box with a usable rectangular cross section", () => {
    const outline = [{x:2,y:0},{x:43,y:0},{x:45,y:2},{x:45,y:10},{x:43,y:12},{x:2,y:12},{x:0,y:10},{x:0,y:2}];
    expect(matchingMortiseProfiles(outline,45,12)).toEqual([]);
  });
  it("rejects a board thicker than the usable straight-wall width despite corner relief space", () => {
    const { project, assembly, moving } = fixture();
    const thick = { ...moving, thickness: 12.5 };
    const candidates = placementCandidates({ ...project, parts: [project.parts[0], thick] }, assembly, moving.id);
    expect(candidates.filter(c => c.insertion && c.feature?.index === 0)).toHaveLength(0);
  });
  it("saves insertion as one undoable pose without inventing machining-face or tolerance declarations", () => {
    const { project, assembly, moving } = fixture();
    const store = createWorkbenchStore(); store.getState().importProject({ ...project, assembly });
    const before = structuredClone(store.getState().project!);
    const candidate = placementCandidates(project, assembly, moving.id).find(c => c.insertion && c.feature?.index === 0 && c.insertion.sourceAnchor.y === 0)!;
    expect(candidate).toBeDefined();
    expect(store.getState().updateAssembly({ ...assembly, items: [assembly.items[0], candidate.pose] })).toBe(true);
    expect(store.getState().project!.assembly!.fits).toEqual([]);
    expect(store.getState().project!.assembly!.pocketFaces).toEqual({});
    store.getState().undo(); expect(store.getState().project).toEqual(before);
  });
});
