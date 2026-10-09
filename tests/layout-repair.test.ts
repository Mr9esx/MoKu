import { expect, it } from "vitest";
import { repairLayout } from "../src/core/repair";
import { validateLayout } from "../src/core/geometry";
import type { Layout, NestSettings, Project } from "../src/core/types";
const config: NestSettings = { mode: "remnant", gap: 1, margin: 1, allowRotation: false,
  minRemnantWidth: 1, minRemnantHeight: 1, iterations: 4, searchSeconds: 2 };
function fixture(): Project {
  const sheets = [{id:"s",name:"s",width:20,height:10,thickness:12,material:"wood"}];
  const parts = [0,1,2].map(i => ({id:`p${i}`,name:`p${i}`,stockId:"s",layer:"CUT_12MM",
    thickness:12,width:4,height:4,area:16,outline:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}],
    holes:[],pockets:[],label:{x:2,y:2}}));
  return {name:"repair",units:"mm",sheets,parts,warnings:[],original:{sheets,placements:[
    {partId:"p0",sheetId:"s",x:1,y:1,rotation:0},
    {partId:"p1",sheetId:"s",x:5.5,y:1,rotation:0},
    {partId:"p2",sheetId:"s",x:14,y:1,rotation:0},
  ]}};
}
it("repairs a gap with SVGnest while preserving unrelated positions and source", () => {
  const p = fixture(), before = structuredClone(p), checkpoints: Layout[] = [];
  const r = repairLayout(p,config,(_,__,layout) => { if(layout) checkpoints.push(layout); });
  expect(r.layout).not.toBeNull();
  expect(validateLayout(p,r.layout!,config)).toEqual([]);
  expect(r.layout!.placements.find(p => p.partId === "p2")).toEqual(p.original.placements[2]);
  expect(r.layout!.placements.every(p => !p.locked)).toBe(true);
  for (const layout of checkpoints) {
    expect(validateLayout(p,layout,config)).toEqual([]);
    expect(layout.placements.every(p => !p.locked)).toBe(true);
  }
  expect(p).toEqual(before);
});
it("retains user locks and reports an unrepairable pair without a candidate", () => {
  const p = fixture(); p.original.placements[0].locked = p.original.placements[1].locked = true;
  const r = repairLayout(p, config);
  expect(r.layout).toBeNull();
  expect(r.issues.some(i => i.kind === "gap")).toBe(true);
  expect(p.original.placements.slice(0,2).every(p => p.locked)).toBe(true);
});

it("includes a neighboring obstacle that needs to yield space for the requested gap", () => {
  const p = fixture(); p.sheets[0].width = 16; p.sheets[0].height = 6;
  p.parts[2].width = 1; p.parts[2].area = 4;
  p.parts[2].outline = [{x:0,y:0},{x:1,y:0},{x:1,y:4},{x:0,y:4}];
  p.original.placements[2].x = 10.5;
  expect(validateLayout(p,p.original,config).map(i => i.kind)).toEqual(["gap"]);
  const r = repairLayout(p,config);
  expect(r.layout).not.toBeNull();
  expect(validateLayout(p,r.layout!,config)).toEqual([]);
  expect(r.layout!.placements.find(p => p.partId === "p2")!.x).not.toBe(10.5);
  expect(r.layout!.placements.every(p => !p.locked)).toBe(true);
});
it("rejects an invalid overall repair duration instead of truncating it into a valid first phase", () => {
  expect(() => repairLayout(fixture(),{ ...config, searchSeconds: 400 })).toThrow(/时长/);
});
it("uses the efficiency plateau rule during repair while preserving source positions and user locks", () => {
  const p=fixture(), before=structuredClone(p);
  const settings: NestSettings={...config,iterations:1,searchSeconds:1,stopRule:"patience",patienceGenerations:3};
  const limits:number[]=[];
  const r=repairLayout(p,settings,(_g,_m,_l,progress)=>{if(progress)limits.push(progress.timeLimitMs);});
  expect(r.search?.stoppedBy).toBe("plateau");expect(r.search?.unchanged).toBe(3);
  expect(r.attempts).toBeGreaterThan(1);expect(limits.every(n=>n===0)).toBe(true);
  expect(validateLayout(p,r.layout!,settings)).toEqual([]);
  expect(r.layout!.placements.find(p=>p.partId==="p2")).toEqual(before.original.placements[2]);
  expect(r.layout!.placements.every(p=>!p.locked)).toBe(true);expect(p).toEqual(before);
});
