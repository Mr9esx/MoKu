import { afterEach, expect, it } from "vitest";
import { createWorkbenchStore, workbench, displayedLayout } from "../src/store";
import type { Project } from "../src/core/types";
const fixture = (): Project => {
  const sheets=[{id:"s",name:"板材",width:500,height:500,thickness:12,material:"木"}];
  const parts=[{id:"p",name:"零件",stockId:"s",width:40,height:40,thickness:12,material:"木",area:1600,
    layer:"CUT",outline:[{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:0,y:40}],holes:[],pockets:[],label:{x:20,y:20}}];
  return {name:"实时预览",units:"mm",sheets,parts,warnings:[],original:{sheets,placements:[{partId:"p",sheetId:"s",x:20,y:20,rotation:0}]}};
};
const saved=workbench.getState();
afterEach(()=>workbench.setState(saved,true));
it("renders live verified positions in the current view without applying them",()=>{
  const p=fixture();workbench.getState().importProject(p);
  const run=workbench.getState().beginSearch();
  const candidate={...p.original,placements:[{...p.original.placements[0],x:150,y:100}]};
  workbench.getState().progress(run,1,candidate);
  expect(workbench.getState().view).toBe("current");
  expect(workbench.getState().current).toEqual(p.original);
  expect(displayedLayout(workbench.getState())).toEqual(candidate);
  workbench.getState().progress(run,2,{...candidate,placements:[]});
  expect(displayedLayout(workbench.getState())).toEqual(candidate);
  workbench.getState().setView("original");
  expect(displayedLayout(workbench.getState())).toEqual(p.original);
});
const mutations=[
  ["move",s=>s.movePart({...s.current!.placements[0],x:100})],
  ["settings",s=>s.setSettings({gap:4})],
  ["lock",s=>s.toggleLock("p")],
  ["thickness",s=>s.setThickness("s",5)],
  ["material",s=>s.setMaterial("s","桦木")],
  ["stock settings",s=>s.updateStock("s",{thickness:5,material:"桦木"})],
  ["add stock",s=>s.addStock({name:"新板",width:500,height:500,thickness:12,material:"木"})],
  ["remove stock",s=>s.removeStock(s.project!.sheets[1].id)],
  ["add part",s=>s.addPart({name:"新件",shape:"rectangle",width:20,height:20,thickness:12})],
  ["remove part",s=>s.removePart("p")],
  ["duplicate",s=>s.duplicatePart("p",1)],
  ["place",s=>s.placePart("p","s")],
  ["undo",s=>s.undo()],
  ["restore",s=>s.reset()],
  ["new project",s=>s.importProject(fixture())],
  ["confirm import",s=>s.confirmImport(fixture(),"replace")],
  ["begin import",s=>s.beginImport()],
  ["discard",s=>s.discardCandidate()],
  ["restart",s=>s.beginSearch()],
  ["apply",s=>s.apply()],
] as const satisfies ReadonlyArray<readonly [string,(s:ReturnType<ReturnType<typeof createWorkbenchStore>["getState"]>)=>unknown]>;
it.each(mutations)("blocks %s while searching without losing the run or preview",(_name,mutate)=>{
  const store=createWorkbenchStore();store.getState().importProject(fixture());
  store.getState().addStock({name:"空板",width:500,height:500,thickness:12,material:"木"});
  const run=store.getState().beginSearch();store.getState().progress(run,1,store.getState().current!);
  const before=store.getState();mutate(before);
  expect(store.getState()).toBe(before);
});
it("allows inspection during search and editing again after stop",()=>{
  const store=createWorkbenchStore(),p=fixture();store.getState().importProject(p);
  const run=store.getState().beginSearch();store.getState().select("p");store.getState().setView("original");
  expect(store.getState().status).toBe("searching");store.getState().setView("current");
  store.getState().cancel();expect(store.getState().movePart({...p.original.placements[0],x:100})).toBe(true);
  store.getState().progress(run,999,p.original);expect(store.getState().current!.placements[0].x).toBe(100);
});
