import { expect, it, vi, afterEach } from "vitest";
import { optimizeLayout } from "../src/core/nesting";
import { PatienceTracker } from "../src/core/patience";
import { validateLayout } from "../src/core/geometry";
import { createWorkbenchStore, workbench, startSearch, stopWorker } from "../src/store";
import type { Project, NestSettings, SearchProgress } from "../src/core/types";
const settings: NestSettings = {mode:"remnant",gap:1,margin:1,allowRotation:true,minRemnantWidth:1,minRemnantHeight:1,
  iterations:1,searchSeconds:1,stopRule:"patience",patienceGenerations:3};
function fixture(groups=1): Project {
  const sheets=Array.from({length:groups},(_,i)=>({id:`s${i}`,name:`s${i}`,width:20,height:20,thickness:i?5:12,material:"wood"}));
  const parts=sheets.map(s=>({id:`p${s.id}`,name:`p${s.id}`,stockId:s.id,material:s.material,thickness:s.thickness,layer:"CUT",width:4,height:4,area:16,
    outline:[{x:0,y:0},{x:4,y:0},{x:4,y:4},{x:0,y:4}],holes:[],pockets:[],label:{x:2,y:2}}));
  return {name:"patience",units:"mm",sheets,parts,warnings:[],original:{sheets,placements:parts.map((p,i)=>({partId:p.id,sheetId:sheets[i].id,x:5,y:5,rotation:0}))}};
}
afterEach(()=>{stopWorker();vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();});
it("counts exactly N completed generations with no improvement and resets only on a new best efficiency",()=>{
  const t=new PatienceTracker(3,0.8);
  expect(t.observe(1,0.8)).toBe(false);expect(t.unchanged).toBe(1);
  expect(t.observe(2,0.81)).toBe(false);expect(t.unchanged).toBe(0);
  expect(t.observe(3,0.805)).toBe(false);expect(t.best).toBe(0.81);
  expect(t.observe(4,0.81)).toBe(false);expect(t.observe(5,0.81)).toBe(true);
  expect(t.curve.map(p=>p.efficiency)).toEqual([0.8,0.8,0.81,0.81,0.81,0.81]);
});
it("does not treat floating point noise as an efficiency improvement",()=>{
  const t=new PatienceTracker(2,0.8);
  expect(t.observe(1,0.8+1e-12)).toBe(false);expect(t.observe(2,0.8)).toBe(true);
});
it("does not invent utilization before the first feasible complete layout",()=>{
  const t=new PatienceTracker(2,null);
  expect(t.observe(1,null)).toBe(false);expect(t.curve[1].efficiency).toBeNull();
  expect(t.observe(2,0.6)).toBe(false);expect(t.unchanged).toBe(0);
  expect(t.observe(3,0.6)).toBe(false);expect(t.observe(4,0.6)).toBe(true);
});
it("stops on efficiency plateau beyond the old time and generation ceilings",()=>{
  let now=0;vi.spyOn(performance,"now").mockImplementation(()=>now+=100);
  const p=fixture(), reports:SearchProgress[]=[];
  const r=optimizeLayout(p,settings,(_g,_m,_l,progress)=>{if(progress)reports.push(progress);});
  expect(r.search?.stoppedBy).toBe("plateau");expect(r.search?.rounds).toBe(3);
  expect(r.search?.improved).toBe(true); // A better remnant must not reset efficiency patience.
  expect(r.attempts).toBe(3);expect(r.elapsedMs).toBeGreaterThan(1000);
  expect(r.search?.curve.at(-1)?.unchanged).toBe(3);
  expect(validateLayout(p,r.layout!,settings)).toEqual([]);
  expect(reports.some(p=>p.patience?.unchanged===3)).toBe(true);
});
it("gives every material/thickness pool a generation before counting a patience step",()=>{
  const p=fixture(2), reports:SearchProgress[]=[];
  const r=optimizeLayout(p,settings,(_g,_m,_l,progress)=>{if(progress)reports.push(progress);});
  expect(r.attempts).toBe(6);expect(r.search?.rounds).toBe(3);
  for(const group of [1,2]) expect(reports.some(p=>p.group===group && p.generation===3)).toBe(true);
  expect(r.search?.curve.map(p=>p.generation)).toEqual([0,1,2,3]);
  expect(validateLayout(p,r.layout!,settings)).toEqual([]);
});
it("rejects invalid patience rather than silently stopping on the old limit",()=>{
  for(const patienceGenerations of [0,1.5,NaN,1001])
    expect(()=>optimizeLayout(fixture(),{...settings,patienceGenerations})).toThrow(/耐心/);
});
it("can complete more than 100 generations without hitting the old ceiling",()=>{
  const r=optimizeLayout(fixture(),{...settings,patienceGenerations:101});
  expect(r.attempts).toBe(101);
  expect(r.search?.stoppedBy).toBe("plateau");
  expect(r.search?.unchanged).toBe(101);
});
it("plots measured outline utilization even if cached part area differs",()=>{
  const p=fixture();p.parts[0].area=999;
  const r=optimizeLayout(p,settings);
  expect(r.search?.curve?.every(point=>point.efficiency===16/400)).toBe(true);
});
it("stops an infeasible plateau without inventing an efficiency value or a candidate",()=>{
  const p=fixture();p.sheets[0].width=2;p.sheets[0].height=2;
  const r=optimizeLayout(p,settings);
  expect(r.layout).toBeNull();expect(r.search?.stoppedBy).toBe("plateau");
  expect(r.search?.unchanged).toBe(3);
  expect(r.search?.curve?.map(point=>point.efficiency)).toEqual([null,null,null,null]);
});
it("ends immediately when all parts are locked rather than inventing completed generations",()=>{
  const p=fixture();p.original.placements[0].locked=true;
  const r=optimizeLayout(p,settings);
  expect(r.layout).toEqual(p.original);expect(r.attempts).toBe(0);
  expect(r.search?.stoppedBy).toBe("exhausted");
});
it("retains the curve and verified candidate after manual stop without applying it",()=>{
  const store=createWorkbenchStore(),p=fixture();store.getState().importProject(p);store.getState().setSettings(settings);
  const run=store.getState().beginSearch();
  const curve=[{generation:0,efficiency:0.04,unchanged:0},{generation:2,efficiency:0.04,unchanged:2}];
  store.getState().progress(run,2,p.original,{group:1,groups:1,generation:2,generationLimit:0,
    material:"wood",thickness:12,phase:"searching",elapsedMs:1000,timeLimitMs:0,
    rounds:2,patience:{limit:3,unchanged:2},curve,evaluations:25,restarts:1});
  store.getState().cancel();
  expect(store.getState().candidate?.search?.curve).toEqual(curve);
  expect(store.getState().candidate?.search?.stoppedBy).toBe("manual");
  expect(store.getState().current).toEqual(p.original);
  store.getState().progress(run,999,p.original);
  expect(store.getState().candidate?.search?.curve).toEqual(curve);
});
it("retains the final curve even when no independently legal candidate exists",()=>{
  const store=createWorkbenchStore(),p=fixture();p.sheets[0].width=2;p.sheets[0].height=2;
  store.getState().importProject(p);store.getState().setSettings(settings);
  const run=store.getState().beginSearch();
  const result=optimizeLayout(p,settings,(_g,_m,_l,progress)=>{
    if(progress)store.getState().progress(run,_g,undefined,progress);
  });
  store.getState().receiveResult(run,result);
  expect(store.getState().candidate).toBeNull();
  expect(store.getState().status).toBe("error");
  expect(store.getState().searchProgress?.curve).toEqual(result.search?.curve);
  expect(store.getState().current).toEqual(p.original);
});
it("defaults the website to a 50-generation plateau rule",()=>{
  const s=createWorkbenchStore().getState();expect(s.settings.stopRule).toBe("patience");expect(s.settings.patienceGenerations).toBe(50);
});
it("does not terminate a patience search at the old wall-time watchdog",()=>{
  vi.useFakeTimers();
  class WorkerStub { terminate=vi.fn();postMessage=vi.fn();onmessage=null;onerror=null; }
  vi.stubGlobal("Worker",WorkerStub);const saved=workbench.getState();
  try {
    workbench.getState().importProject(fixture());workbench.getState().setSettings(settings);startSearch();
    vi.advanceTimersByTime(100000);
    expect(workbench.getState().status).toBe("searching");workbench.getState().cancel();expect(workbench.getState().status).toBe("idle");
  } finally {stopWorker();workbench.setState(saved,true);}
});
