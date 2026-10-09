import { expect, it, vi, afterEach } from "vitest";
import { optimizeLayout } from "../src/core/nesting";
import { createWorkbenchStore, workbench, startSearch, stopWorker } from "../src/store";
import type { Project, SearchProgress } from "../src/core/types";
const settings = {mode:"remnant" as const,gap:1,margin:1,allowRotation:true,minRemnantWidth:1,minRemnantHeight:1,iterations:2,searchSeconds:2,stopRule:"limits" as const};
function project(): Project {
  const sheets = [5,12].map((thickness,i)=>({id:`s${i}`,name:`s${i}`,width:30,height:30,material:"wood",thickness}));
  const parts = sheets.map((s,i)=>({id:`p${i}`,name:`p${i}`,stockId:s.id,material:s.material,thickness:s.thickness,
    layer:"",width:5,height:5,area:25,outline:[{x:0,y:0},{x:5,y:0},{x:5,y:5},{x:0,y:5}],holes:[],pockets:[],label:{x:2,y:2}}));
  return {name:"progress",units:"mm",parts,sheets,warnings:[],original:{sheets,placements:parts.map((p,i)=>({partId:p.id,sheetId:sheets[i].id,x:5,y:5,rotation:0}))}};
}
afterEach(()=>{stopWorker();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
it("reports the second group at generation zero after the first group completes its limit",()=>{
  const reports: SearchProgress[] = [];
  const result = optimizeLayout(project(),settings,(_g,_m,_layout,progress)=>{if(progress)reports.push({...progress});});
  expect(result.attempts).toBe(4);
  expect(reports.some(p=>p.group===1 && p.generation===2)).toBe(true);
  expect(reports.some(p=>p.group===2 && p.generation===0 && p.phase==="preparing")).toBe(true);
  expect(reports.at(-1)?.phase).toBe("finalizing");
});
it("keeps progress alive during contour computation before a generation completes",()=>{
  let time=0; vi.spyOn(performance,"now").mockImplementation(()=>time+=80);
  const reports: SearchProgress[]=[];
  optimizeLayout(project(),{...settings,searchSeconds:1},(_g,_m,_layout,progress)=>{if(progress)reports.push(progress);});
  expect(reports.some(p=>p.phase==="preparing" && p.elapsedMs>=200)).toBe(true);
});
it("stores structured progress and ignores updates from an old search",()=>{
  const store=createWorkbenchStore(); store.getState().importProject(project()); store.getState().setSettings(settings);
  const run=store.getState().beginSearch();
  const progress={group:2,groups:2,generation:0,generationLimit:2,material:"wood",thickness:12,phase:"preparing" as const,elapsedMs:100,timeLimitMs:2000};
  store.getState().progress(run,2,undefined,progress);
  expect(store.getState().searchProgress).toEqual(progress);
  store.getState().cancel(); store.getState().progress(run,4,undefined,{...progress,generation:2});
  expect(store.getState().status).toBe("idle");
  expect(store.getState().searchProgress).toBeNull();
});
it("finishes a timed-out worker without applying or losing the last validated candidate",()=>{
  const store=createWorkbenchStore(); const p=project(); store.getState().importProject(p);store.getState().setSettings(settings);
  const run=store.getState().beginSearch(); store.getState().progress(run,0,p.original);
  store.getState().finishSearchTimeout(run);
  expect(store.getState().status).toBe("done");
  expect(store.getState().candidate?.layout).toEqual(p.original);
  expect(store.getState().current).toEqual(p.original);
  expect(store.getState().message).toMatch(/搜索时长/);
  store.getState().progress(run,100,p.original);
  expect(store.getState().status).toBe("done");
});
it("returns to the current layout when a timed-out worker has no legal candidate",()=>{
  const store=createWorkbenchStore();store.getState().importProject(project());const run=store.getState().beginSearch();
  store.getState().finishSearchTimeout(run);
  expect(store.getState().status).toBe("error");expect(store.getState().view).toBe("current");
  expect(store.getState().candidate).toBeNull();expect(store.getState().message).toMatch(/未收到合法候选/);
});

class SilentWorker {
  static instance: SilentWorker;
  onmessage: ((event: {data: Record<string, unknown>}) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { SilentWorker.instance=this; }
}
it("terminates a non-returning worker at the configured duration plus cleanup allowance",()=>{
  vi.useFakeTimers();vi.stubGlobal("Worker",SilentWorker);
  const before=workbench.getState(), p=project();
  try {
    workbench.getState().importProject(p);workbench.getState().setSettings(settings);startSearch();
    const worker=SilentWorker.instance;
    worker.onmessage!({data:{type:"progress",attempt:2,bestLayout:p.original}});
    vi.advanceTimersByTime(4999);
    expect(workbench.getState().status).toBe("searching");
    vi.advanceTimersByTime(1);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(workbench.getState().status).toBe("done");
    expect(workbench.getState().candidate?.layout).toEqual(p.original);
    expect(workbench.getState().current).toEqual(p.original);
    worker.onmessage!({data:{type:"progress",attempt:999,bestLayout:p.original}});
    expect(workbench.getState().attempt).toBe(2);
  } finally {stopWorker();workbench.setState(before,true);}
});
it("clears the timeout when the worker returns normally",()=>{
  vi.useFakeTimers();vi.stubGlobal("Worker",SilentWorker);
  const before=workbench.getState(), p=project();
  try {
    workbench.getState().importProject(p);workbench.getState().setSettings(settings);startSearch();
    const worker=SilentWorker.instance;
    const result=optimizeLayout(p,settings);
    worker.onmessage!({data:{type:"done",result}});
    expect(workbench.getState().status).toBe("done");
    vi.advanceTimersByTime(10000);
    expect(workbench.getState().message).toBe(result.message);
    expect(worker.terminate).toHaveBeenCalledOnce();
  } finally {stopWorker();workbench.setState(before,true);}
});
