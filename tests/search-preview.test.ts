import { expect, it } from "vitest";
import { searchSvgNest } from "../src/core/svgNest";
import { optimizeLayout } from "../src/core/nesting";
import { repairLayout } from "../src/core/repair";
import { createWorkbenchStore, displayedLayout } from "../src/store";
import { LatestTrialSampler } from "../src/core/trialSampler";
import type { Project, NestSettings, SearchTrial } from "../src/core/types";

const settings: NestSettings = { mode:"utilization",gap:1,margin:1,allowRotation:false,
  minRemnantWidth:1,minRemnantHeight:1,iterations:2,searchSeconds:2 };
function fixture(): Project {
  const sheets = [12,5].map((thickness,i)=>({id:`s${i}`,name:`板${i}`,width:100,height:100,thickness,material:"wood"}));
  const parts = [0,0,1].map((stock,i)=>({id:`p${i}`,name:`P${i}`,stockId:`s${stock}`,thickness:sheets[stock].thickness,
    material:"wood",layer:"CUT",width:10,height:10,area:100,
    outline:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],holes:[],pockets:[],label:{x:5,y:5}}));
  return {name:"代内试排",units:"mm",sheets,parts,warnings:[],original:{sheets,placements:parts.map((p,i)=>({
    partId:p.id,sheetId:p.stockId,x:20+i*15,y:20,rotation:0}))}};
}
function trial(individual:number,x=1):SearchTrial {
  const p=fixture();return {layout:{...p.original,placements:p.original.placements.map((v,i)=>i===0?{...v,x,y:1}:v)},
    group:2,groups:2,generation:1,individual,evaluations:individual,complete:true};
}
it("publishes multiple complete attempts within a generation, even when none beats the incumbent",()=>{
  const p=fixture(),before=structuredClone(p),trials:SearchTrial[]=[];
  let accepted=0;
  searchSvgNest(p,settings,{seed:23,exhausted:()=>false,rank:l=>[l.sheets.length],onLayout:()=>accepted++,onTrial:t=>trials.push(structuredClone(t))});
  const batch=trials.filter(t=>t.group===2 && t.generation===1);
  expect(batch.length).toBeGreaterThan(1);
  expect(new Set(batch.map(t=>t.individual)).size).toBe(batch.length);
  expect(batch.every(t=>t.layout.placements.length===3)).toBe(true);
  expect(batch.every(t=>t.layout.placements.some(v=>v.partId==="p2" && v.sheetId==="s1"))).toBe(true);
  expect(p).toEqual(before);
  expect(accepted).toBe(0);
});
it("forwards real trial snapshots through the optimizer without replacing the best result",()=>{
  const trials:SearchTrial[]=[];
  const result=optimizeLayout(fixture(),settings,undefined,t=>trials.push(t));
  expect(trials.length).toBeGreaterThan(1);
  expect(trials.every(t=>t.layout.placements.length===3)).toBe(true);
  expect(result.layout?.placements).toHaveLength(3);
});
it("keeps user locks at their original positions across every attempted snapshot",()=>{
  const p=fixture();p.original.placements[0].locked=true;
  const trials:SearchTrial[]=[];
  searchSvgNest(p,settings,{seed:23,exhausted:()=>false,rank:l=>[l.sheets.length],onLayout:()=>{},onTrial:t=>trials.push(t)});
  expect(trials.length).toBeGreaterThan(0);
  expect(trials.every(t=>t.layout.placements.some(v=>v.partId==="p0" && v.x===20 && v.y===20 && v.locked))).toBe(true);
});
it("forwards repair snapshots while restoring user locks rather than exposing temporary fixed obstacles",()=>{
  const trials:SearchTrial[]=[];
  const result=repairLayout(fixture(),{...settings,gap:8},undefined,t=>trials.push(t));
  expect(trials.length).toBeGreaterThan(0);
  expect(trials.every(t=>t.layout.placements.find(v=>v.partId==="p2")?.locked!==true)).toBe(true);
  expect(result.layout?.placements).toHaveLength(3);
});
it("does not alter the seeded search trajectory when observing attempts",()=>{
  const collect=(observe:boolean)=>{
    const layouts:SearchTrial["layout"][]=[],trials:SearchTrial[]=[];
    const stats=searchSvgNest(fixture(),settings,{seed:23,exhausted:()=>false,
      rank:l=>[l.sheets.length,l.placements.reduce((sum,p)=>sum+p.x+p.y,0)],
      onLayout:l=>layouts.push(structuredClone(l)),onTrial:observe?t=>trials.push(t):undefined});
    return {stats,layouts,trials};
  };
  const ordinary=collect(false),observed=collect(true);
  expect(observed.layouts.length).toBeGreaterThan(0);
  expect(observed.trials.length).toBeGreaterThan(1);
  expect(observed.layouts).toEqual(ordinary.layouts);
  expect(observed.stats).toEqual(ordinary.stats);
});
it("adapts sampling to computation speed and flushes the newest attempt instead of replaying a backlog",()=>{
  const sampler=new LatestTrialSampler(300);
  expect(sampler.offer(trial(1),0)?.individual).toBe(1);
  for(let i=2;i<=100;i++)expect(sampler.offer(trial(i),i)).toBeNull();
  expect(sampler.flush(299)).toBeNull();
  expect(sampler.flush(300)?.individual).toBe(100);
  expect(sampler.flush(600)).toBeNull();
  expect(sampler.offer(trial(101),1000)?.individual).toBe(101); // slow attempts can each be shown
});
it("displays the latest trial independently from the best candidate, ignores corrupt frames, and applies only the best",()=>{
  const store=createWorkbenchStore(),p=fixture();store.getState().importProject(p);store.getState().setSettings(settings);
  const run=store.getState().beginSearch();store.getState().progress(run,0,p.original);
  store.getState().receivePreview(run,trial(3));
  expect(displayedLayout(store.getState())?.placements[0].x).toBe(1);
  expect(store.getState().current).toEqual(p.original);
  expect(store.getState().candidate?.layout).toEqual(p.original);
  store.getState().receivePreview(run,{...trial(4),layout:{...p.original,placements:[{...p.original.placements[0],partId:"unknown"}]}});
  expect(store.getState().searchPreview?.individual).toBe(3);
  store.getState().setView("original");expect(displayedLayout(store.getState())).toEqual(p.original);
  store.getState().setView("current");expect(displayedLayout(store.getState())?.placements[0].x).toBe(1);
  store.getState().cancel();expect(store.getState().searchPreview).toBeNull();
  store.getState().receivePreview(run,trial(5));expect(store.getState().searchPreview).toBeNull();
  store.getState().apply();expect(store.getState().current).toEqual(p.original);
});
it("keeps the last complete preview when a later attempt omits pieces despite claiming completeness",()=>{
  const store=createWorkbenchStore(),p=fixture();store.getState().importProject(p);store.getState().setSettings(settings);
  const run=store.getState().beginSearch();store.getState().progress(run,0,p.original);
  store.getState().receivePreview(run,trial(3));
  store.getState().receivePreview(run,{...trial(4),layout:{...p.original,placements:[p.original.placements[0]]}});
  expect(displayedLayout(store.getState())?.placements).toHaveLength(3);
  expect(store.getState().searchPreview?.individual).toBe(3);
  expect(store.getState().candidate?.layout?.placements).toHaveLength(3);
  store.getState().cancel();
});
it.each(["overlap","boundary","duplicate","incomplete-flag"])("rejects a %s trial without replacing the full legal display",kind=>{
  const store=createWorkbenchStore(),p=fixture();store.getState().importProject(p);store.getState().setSettings(settings);
  const run=store.getState().beginSearch();store.getState().progress(run,0,p.original);
  const bad=trial(4);
  if(kind==="overlap")bad.layout.placements[1]={...bad.layout.placements[1],x:1,y:1};
  if(kind==="boundary")bad.layout.placements[0].x=95;
  if(kind==="duplicate")bad.layout.placements[1]={...bad.layout.placements[0]};
  if(kind==="incomplete-flag")bad.complete=false;
  store.getState().receivePreview(run,bad);
  expect(store.getState().searchPreview).toBeNull();
  expect(displayedLayout(store.getState())).toEqual(p.original);
  store.getState().cancel();
});
it("ignores incomplete trials without discarding pending complete frames or consuming the sample interval",()=>{
  const sampler=new LatestTrialSampler(300);
  expect(sampler.offer({...trial(1),complete:false},0)).toBeNull();
  expect(sampler.offer(trial(2),10)?.individual).toBe(2);
  expect(sampler.offer(trial(3),100)).toBeNull();
  expect(sampler.offer({...trial(4),complete:false},400)).toBeNull();
  expect(sampler.flush(400)?.individual).toBe(3);
});
it.each(["done","timeout"])("removes trial previews on %s and ignores late snapshots",ending=>{
  const store=createWorkbenchStore(),p=fixture();store.getState().importProject(p);store.getState().setSettings(settings);
  const run=store.getState().beginSearch();store.getState().progress(run,0,p.original);store.getState().receivePreview(run,trial(2));
  if(ending==="done")store.getState().receiveResult(run,store.getState().candidate!);
  else store.getState().finishSearchTimeout(run);
  expect(store.getState().searchPreview).toBeNull();
  store.getState().receivePreview(run,trial(4));expect(store.getState().searchPreview).toBeNull();
  expect(store.getState().candidate?.layout).toEqual(p.original);
});
