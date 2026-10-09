import { expect, it } from "vitest";
import { optimizeLayout } from "../src/core/nesting";
import { validateLayout, concentratedRemnantArea } from "../src/core/geometry";
import type { Project, NestSettings } from "../src/core/types";

const settings: NestSettings = {
  mode: "remnant", gap: 0, margin: 0, allowRotation: false,
  minRemnantWidth: 1, minRemnantHeight: 1, iterations: 3,
};

function fixture(scale: number, height: number, reverse: boolean): Project {
  const sheets = ["front", "back"].map(id => ({id,name:id,width:100*scale,height,thickness:12,material:"wood"}));
  const widths = [60,30,55,25,15];
  const parts = widths.map((width,i)=>({
    id:`p${i}`,name:`p${i}`,stockId:i<2?"front":"back",layer:"",material:"wood",thickness:12,
    width:width*scale,height,area:width*scale*height,
    outline:[{x:0,y:0},{x:width*scale,y:0},{x:width*scale,y:height},{x:0,y:height}],
    holes:[],pockets:[],label:{x:width*scale/2,y:height/2},
  }));
  if(reverse) parts.reverse();
  const placements = parts.map(part=>({
    partId:part.id,sheetId:part.stockId,x:[0,60,0,55,80][Number(part.id.slice(1))]*scale,y:0,
    rotation:0 as const,locked:part.id==="p0"||part.id==="p2",
  }));
  return {name:"distributed remnant",units:"mm",parts,sheets,warnings:[],original:{sheets,placements}};
}

it.each([[1,100,false],[3,70,true],[0.5,160,true]] as const)(
  "concentrates remnants for scale %s / height %s independent of part order",
  (scale,height,reverse)=>{
    const project=fixture(scale,height,reverse);
    const result=optimizeLayout(project,settings);
    expect(result.metrics?.sheetCount).toBe(2);
    // Both layouts leave 15% unused, but 15% on one sheet is better than 10% + 5%.
    expect(Math.max(...result.metrics!.remnants.map(r=>r.area))).toBeCloseTo(15*scale*height);
    expect(result.layout!.placements.find(p=>p.partId==="p1")?.sheetId).toBe("back");
    expect(result.layout!.placements.find(p=>p.partId==="p3")?.sheetId).toBe("front");
    expect(result.layout!.placements.find(p=>p.partId==="p4")?.sheetId).toBe("front");
    expect(validateLayout(project,result.layout!,settings)).toEqual([]);
    for(const locked of project.original.placements.filter(p=>p.locked))
      expect(result.layout!.placements.find(p=>p.partId===locked.partId)).toEqual(locked);
  },
);


it("consolidates with real spacing and edge margins", () => {
  const project=fixture(1,100,false);
  project.sheets.forEach(s=>{s.width=106;s.height=104;});
  project.original.placements.forEach(p=>{p.x=[2,63,2,58,84][Number(p.partId.slice(1))];p.y=2;});
  const config={...settings,gap:1,margin:2};
  expect(validateLayout(project,project.original,config)).toEqual([]);
  const result=optimizeLayout(project,config);
  expect(result.metrics?.sheetCount).toBe(2);
  expect(Math.max(...result.metrics!.remnants.map(r=>r.area))).toBeCloseTo(1500);
  expect(validateLayout(project,result.layout!,config)).toEqual([]);
});

it("consolidates compatible stocks with different widths", () => {
  const project=fixture(1,100,false);
  project.sheets[1].width=110;
  const result=optimizeLayout(project,settings);
  expect(Math.max(...result.metrics!.remnants.map(r=>r.area))).toBeCloseTo(2500);
  expect(result.metrics?.sheetCount).toBe(2);
  expect(validateLayout(project,result.layout!,settings)).toEqual([]);
});

it("scores large continuous remnants separately by thickness and material", () => {
  const project=fixture(1,100,false);
  project.sheets.push({...project.sheets[0],id:"thin",thickness:5});
  project.sheets.push({...project.sheets[0],id:"metal",material:"metal"});
  const remnants=[
    {sheetId:"front",x:90,y:0,width:10,height:100,area:1000},
    {sheetId:"back",x:95,y:0,width:5,height:100,area:500},
    {sheetId:"thin",x:70,y:0,width:30,height:100,area:3000},
    {sheetId:"metal",x:80,y:0,width:20,height:100,area:2000},
  ];
  // One largest rectangle per pool: 1000 + 3000 + 2000, not 6500 or just 3000.
  expect(concentratedRemnantArea(project,{remnants})).toBe(6000);
});

it("fills earlier stock when the largest continuous remnant is unchanged", () => {
  const project=fixture(1,100,false);
  const widths=[80,10,20,20];
  project.parts=project.parts.slice(0,4).map((p,i)=>({...p,stockId:i===0?"front":"back",
    width:widths[i],area:widths[i]*100,
    outline:[{x:0,y:0},{x:widths[i],y:0},{x:widths[i],y:100},{x:0,y:100}]}));
  project.original.placements=project.parts.map((p,i)=>({partId:p.id,sheetId:p.stockId,
    x:[0,0,10,80][i],y:0,rotation:0,locked:i!==1}));
  const result=optimizeLayout(project,settings);
  expect(result.layout!.placements.find(p=>p.partId==="p1")?.sheetId).toBe("front");
  expect(concentratedRemnantArea(project,result.metrics!)).toBe(5000);
  expect(validateLayout(project,result.layout!,settings)).toEqual([]);
});
