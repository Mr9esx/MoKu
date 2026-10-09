import { expect, it, vi } from "vitest";
import * as nesting from "../src/core/nesting";
import { compactLayout } from "./support/local-nesting-baseline";
import { bounds, placedOutline, validateLayout, contourDistance } from "../src/core/geometry";
import type { Project, NestSettings, Part } from "../src/core/types";

const settings: NestSettings = {
  mode: "remnant", gap: 3, margin: 6, allowRotation: false,
  minRemnantWidth: 10, minRemnantHeight: 10, iterations: 1,
};
function fixture(): Project {
  const sheets = [{id:"s", name:"s", width:200, height:200, thickness:12, material:"wood"}];
  const parts: Part[] = ["a","b","c"].map(id => ({
    id,name:id,stockId:"s",material:"wood",thickness:12,layer:"",width:30,height:20,area:600,
    outline:[{x:0,y:0},{x:30,y:0},{x:30,y:20},{x:0,y:20}],holes:[],pockets:[],label:{x:15,y:10},
  }));
  return {name:"loose rows",units:"mm",parts,sheets,warnings:[],original:{sheets,
    placements:parts.map((p,i)=>({partId:p.id,sheetId:"s",x:20+i*50,y:40,rotation:0}))}};
}

it.each([1,3,9])("compacts excessive internal gaps to the configured %s mm", gap => {
  const p=fixture(), before=JSON.stringify(p), config={...settings,gap};
  const result=compactLayout(p,p.original,config);
  const xs=result.placements.map(v=>v.x).sort((a,b)=>a-b);
  expect(xs).toEqual([6,36+gap,66+2*gap]);
  expect(result.placements.map(v=>v.y)).toEqual([6,6,6]);
  expect(validateLayout(p,result,config)).toEqual([]);
  expect(JSON.stringify(p)).toBe(before);
});

it("keeps locked obstacles and rotations while compacting both axes", () => {
  const p=fixture();
  p.original.placements[0]={...p.original.placements[0],x:6,y:6,locked:true};
  p.original.placements[1]={...p.original.placements[1],x:90,y:6,rotation:90};
  p.original.placements[2]={...p.original.placements[2],x:110,y:110};
  const config={...settings,allowRotation:true};
  const result=compactLayout(p,p.original,config);
  expect(result.placements[0]).toEqual(p.original.placements[0]);
  expect(result.placements[1]).toMatchObject({rotation:90,x:39,y:6});
  expect(result.placements[2]).toMatchObject({x:6,y:29});
  expect(validateLayout(p,result,config)).toEqual([]);
});

it("can compact towards the opposite corner without changing clearance", () => {
  const p=fixture();
  const result=compactLayout(p,p.original,settings,()=>false,["y","x"],1);
  expect(result.placements.map(v=>v.x).sort((a,b)=>a-b)).toEqual([98,131,164]);
  expect(result.placements.map(v=>v.y)).toEqual([174,174,174]);
  expect(validateLayout(p,result,settings)).toEqual([]);
});

it("interrupted compaction returns only complete legal moves", () => {
  const p=fixture();
  let checks=0;
  const result=compactLayout(p,p.original,settings,()=>++checks>15);
  expect(validateLayout(p,result,settings)).toEqual([]);
  expect(result.placements).toHaveLength(3);
});

it("uses contour clearance when bounding boxes overlap", () => {
  const p=fixture();
  p.parts=p.parts.slice(0,2).map(v=>({...v,width:50,height:50,area:1250,
    outline:[{x:0,y:0},{x:50,y:0},{x:0,y:50}]}));
  p.original.placements=[
    {partId:"a",sheetId:"s",x:6,y:6,rotation:0,locked:true},
    {partId:"b",sheetId:"s",x:40,y:40,rotation:0},
  ];
  const result=compactLayout(p,p.original,settings);
  expect(validateLayout(p,result,settings)).toEqual([]);
  const a=placedOutline(p.parts[0],result.placements[0]),b=placedOutline(p.parts[1],result.placements[1]);
  expect(bounds(a).maxX).toBeGreaterThan(bounds(b).minX);
  expect(contourDistance(a,b)).toBeCloseTo(3,2);
  expect(result.placements[1].x).toBeLessThan(40);
});

it("allows a larger time setting to continue search after the short setting stops", () => {
  let time=0;
  const clock=vi.spyOn(performance,"now").mockImplementation(()=>time);
  try {
    const p=fixture();
    const run = (searchSeconds: number) => {
      let completedGeneration = 0;
      return nesting.optimizeLayout(p,{...settings,searchSeconds},(generation,_metrics,layout)=>{
        // Work consumes simulated time; group changes and heartbeats do not.
        if(layout || generation > completedGeneration) time+=1100;
        completedGeneration = generation;
      });
    };
    const short=run(1);
    time=0;
    const long=run(3);
    expect(short.search?.stoppedBy).toBe("time");
    expect(long.search!.candidates).toBeGreaterThan(short.search!.candidates);
    expect(validateLayout(p,long.layout!,settings)).toEqual([]);
  } finally { clock.mockRestore(); }
});

it.each([0,301,NaN,Infinity])("rejects invalid search duration %s", searchSeconds => {
  expect(()=>nesting.optimizeLayout(fixture(),{...settings,searchSeconds})).toThrow(/参数/);
});
