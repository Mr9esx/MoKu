import { expect, it } from "vitest";
import { compileDrawing, defaultDrawingRules, drawingIssues } from "../src/core/drawingReview";
import type {DrawingDocument,DrawingShape} from "../src/core/drawingTypes";
const shape=(id:string,layer:string,x:number,y:number,w:number,h:number):DrawingShape=>({id,layer,space:"Model",entityType:"LWPOLYLINE",closed:true,valid:true,sourceIds:[id],points:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
const doc=(shapes:DrawingShape[]):DrawingDocument=>({name:"vendor",unitKnown:true,importInfo:{sourceUnit:"毫米",scale:1,overridden:false},spaces:["Model"],shapes,labels:[],diagnostics:[]});
it("does not guess machining from vendor names, numbers or containment",()=>{
 const d=doc([shape("a","TOP-CUT-INSIDE_18.000MM",0,0,80,100),shape("b","Routing",10,10,20,20)]);
 expect(defaultDrawingRules(d)[d.shapes[0].layer].role).toBe("unknown");
 expect(()=>compileDrawing(d,{mode:"parts"})).toThrow(/未确认/);
 const p=compileDrawing(d,{mode:"parts"},{[d.shapes[0].layer]:{role:"outer"},Routing:{role:"hole"}});
 expect(p.parts[0]).toMatchObject({layer:"TOP-CUT-INSIDE_18.000MM",width:80,height:100,thickness:0});
 expect(p.parts[0].holes[0]).toEqual([{x:10,y:10},{x:30,y:10},{x:30,y:30},{x:10,y:30}]);
});
it("lets mixed layers be confirmed per shape without rewriting provenance",()=>{
 const d=doc([shape("a","Router",0,0,80,100),shape("b","Router",10,10,20,20)]);
 expect(()=>compileDrawing(d,{mode:"parts"},{Router:{role:"outer"}})).toThrow(/内部|语义/);
 const p=compileDrawing(d,{mode:"parts"},{Router:{role:"outer"}},{b:{role:"pocket",depth:3}});
 expect(p.parts[0].pockets[0].depth).toBe(3);
 expect(p.parts[0].layer).toBe("Router");
 expect(()=>compileDrawing(d,{mode:"parts"},{Router:{role:"outer"}},{b:{role:"pocket"}})).toThrow(/槽深/);
});
it("requires explicit exclusion of unreadable geometry while annotations remain informational",()=>{
 const d=doc([shape("a","Router",0,0,80,100)]);
 d.diagnostics=[{id:"bad",space:"Model",layer:"Mystery",severity:"blocking",message:"不支持实体 3DSOLID"},{id:"vp",space:"Model",layer:"Layout",severity:"info",message:"布局视口"}];
 expect(drawingIssues(d,"Model",{Router:{role:"outer"}},{})).toHaveLength(1);
 expect(compileDrawing(d,{mode:"parts"},{Router:{role:"outer"},Mystery:{role:"ignore"}}).parts).toHaveLength(1);
 d.unitKnown=false;
 expect(()=>compileDrawing(d,{mode:"parts"},{Router:{role:"outer"},Mystery:{role:"ignore"}})).toThrow(/单位/);
});
it("isolates layout geometry, keeps the stock transform and rejects duplicate sources",()=>{
 const d=doc([shape("board","Sheet",100,200,80,100),shape("a","Router",110,210,20,30)]);
 d.shapes.push({...shape("layout","Router",0,0,20,30),space:"Layout1"});d.spaces.push("Layout1");
 const rules={Sheet:{role:"stock" as const},Router:{role:"outer" as const}};
 const p=compileDrawing(d,{space:"Model"},rules);
 expect(p.original.placements[0]).toMatchObject({x:10,y:10});expect(p.parts).toHaveLength(1);
 d.shapes.push({...d.shapes[1]});expect(()=>compileDrawing(d,{space:"Model"},rules)).toThrow(/重复/);
});

it("keeps source review outside the undo transaction and discards stale parser results",async()=>{
 const {createWorkbenchStore}=await import("../src/store");const s=createWorkbenchStore();
 const d=doc([shape("a","CUT",0,0,20,30)]), id=s.getState().beginImport();
 s.getState().previewDrawing(id,d);expect(s.getState().project).toBeNull();expect(s.getState().history).toEqual([]);
 expect(s.getState().drawingDraft).toBe(d);s.getState().cancelImport();s.getState().previewDrawing(id,d);
 expect(s.getState().drawingDraft).toBeNull();
 const next=s.getState().beginImport();s.getState().previewDrawing(next,d);
 s.getState().confirmImport(compileDrawing(d,{mode:"parts"}),"new");
 expect(s.getState().drawingDraft).toBeNull();expect(s.getState().project?.parts).toHaveLength(1);
 s.getState().undo();expect(s.getState().project).toBeNull();
});
it("lets confirmed board metadata replace an unreliable preset thickness before machining checks",async()=>{
 const {confirmMetadata}=await import("../src/core/importTransaction");
 const d=doc([shape("stock","REF_STOCK",0,0,80,100),shape("a","CUT_12MM",5,5,30,30),shape("b","POCKET_DEPTH15",10,10,10,10)]);
 const p=compileDrawing(d,{deferThicknessCheck:true});
 expect(()=>confirmMetadata(p,{stocks:{stock:{thickness:12,material:"木"}}})).toThrow(/槽深/);
 expect(confirmMetadata(p,{stocks:{stock:{thickness:18,material:"木"}}}).parts[0].thickness).toBe(18);
});
it("handles prototype-like layer names as ordinary source names",()=>{
 const d=doc([shape("constructor","__proto__",0,0,20,30)]);
 expect(defaultDrawingRules(d).__proto__.role).toBe("unknown");
 expect(()=>compileDrawing(d,{mode:"parts"})).toThrow(/未确认/);
 expect(compileDrawing(d,{mode:"parts"},{["__proto__"]:{role:"outer"}}).parts[0].id).toBe("constructor");
});
it("ignores auxiliary labels without dropping individually confirmed contours",()=>{
 const d=doc([shape("s","Sheet",0,0,80,100),shape("a","Mixed",5,5,30,30)]);
 d.labels=[{id:"unused",space:"Model",layer:"Mixed",text:"P999",point:{x:300,y:300}}];
 d.diagnostics=[{id:"unsupported",space:"Model",layer:"Mixed",severity:"blocking",message:"不支持实体"}];
 const p=compileDrawing(d,{}, {Sheet:{role:"stock"},Mixed:{role:"ignore"}},{a:{role:"outer"}});
 expect(p.parts).toHaveLength(1);expect(p.parts[0].width).toBe(30);
 expect(p.drawingSource?.labels[0].text).toBe("P999");expect(p.drawingMapping?.shapeRules.a.role).toBe("outer");
});
it("independently rejects a corrupted contour even if the source reader marked it valid",()=>{
 const d=doc([shape("a","CUT",0,0,20,30)]);
 d.shapes[0].points=[{x:0,y:0},{x:20,y:30},{x:0,y:30},{x:20,y:0}];
 expect(()=>compileDrawing(d,{mode:"parts"})).toThrow(/自交|无效/);
});
it("allows board metadata confirmation when a hole thickness hint conflicts with its part",async()=>{
 const {confirmMetadata}=await import("../src/core/importTransaction");
 const d=doc([shape("s","REF_STOCK",0,0,80,100),shape("a","CUT_12MM",5,5,30,30),shape("b","HOLE_18MM",10,10,10,10)]);
 const p=compileDrawing(d,{deferThicknessCheck:true});
 expect(confirmMetadata(p,{stocks:{s:{thickness:18,material:"木"}}}).parts[0].holes).toHaveLength(1);
});
it("excludes one unsupported source without changing other mappings in the same layer",()=>{
 const d=doc([shape("a","CUT",0,0,20,30)]);
 d.diagnostics=[{id:"bad:source",layer:"CUT",space:"Model",message:"不支持实体",severity:"blocking"}];
 const p=compileDrawing(d,{mode:"parts"},{CUT:{role:"outer"}},{"@diagnostic/bad:source":{role:"ignore"}});
 expect(p.parts).toHaveLength(1);
});
