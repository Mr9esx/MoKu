import { expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileDrawing, drawingIssues } from '../src/core/drawingReview';
import * as review from '../src/core/drawingReview';
import * as imports from '../src/core/importTransaction';
import { createWorkbenchStore, defaults } from '../src/store';
import { exportEligibility } from '../src/core/export';
import { ImportPreview } from '../src/components/ImportPreview';
import { DrawingReview } from '../src/components/DrawingReview';
import { workbench } from '../src/store';
import { ImportDrawingPreview } from '../src/components/ImportDrawingPreview';
import type { DrawingDocument, DrawingShape } from '../src/core/drawingTypes';
const shape=(id:string,layer:string,x:number,y:number,w:number,h:number):DrawingShape=>({id,layer,space:'Model',entityType:'LWPOLYLINE',closed:true,valid:true,sourceIds:[id],points:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
const doc=(shapes:DrawingShape[]):DrawingDocument=>({name:'mixed',unitKnown:true,importInfo:{sourceUnit:'毫米',scale:1,overridden:false},spaces:['Model'],shapes,labels:[],diagnostics:[]});
const mixed=()=>doc([shape('s','REF_STOCK',100,200,100,200),shape('pending','CUT',400,500,40,30),shape('placed','CUT',110,220,20,30),shape('h','HOLE',405,505,5,5),shape('p','POCKET_DEPTH3',420,510,5,5)]);
const metadata={stocks:{s:{thickness:18,material:'板材'}},parts:{pending:{thickness:12,material:'独立零件'}}};
it('creates every outer part in source order, preserves outside coordinates, and attaches pending machining',()=>{
 const d=mixed(), before=structuredClone(d),p=compileDrawing(d,{deferThicknessCheck:true});
 expect(p.parts.map(v=>v.id)).toEqual(['pending','placed']);expect(p.parts[0]).toMatchObject({stockId:'',width:40,height:30,thickness:0,material:'未指定'});
 expect(p.parts[0].holes[0]).toEqual([{x:5,y:5},{x:10,y:5},{x:10,y:10},{x:5,y:10}]);expect(p.parts[0].pockets[0]).toMatchObject({depth:3,outline:[{x:20,y:10},{x:25,y:10},{x:25,y:15},{x:20,y:15}]});
 expect(p.original.placements).toEqual([{partId:'placed',sheetId:'s',x:10,y:20,rotation:0}]);expect(p.drawingSource).toEqual(before);expect(d).toEqual(before);
});
it('parts mode retains confirmed frames as reference while all outer parts remain pending',()=>{
 const p=compileDrawing(mixed(),{mode:'parts',thickness:12,material:'木',quantity:2});
 expect(p.sheets).toEqual([]);expect(p.original.placements).toEqual([]);expect(p.parts).toHaveLength(4);expect(p.parts.every(v=>v.stockId==='')).toBe(true);expect(p.drawingSource?.shapes[0].id).toBe('s');
});
it('collects every partial-board, multiple-board, orphan-feature and nested conflict with source IDs',()=>{
 const d=doc([shape('s','REF_STOCK',0,0,100,200),shape('s2','REF_STOCK',0,0,100,200),shape('cross','CUT',90,20,20,20),shape('multi','CUT',10,20,20,20),shape('o1','HOLE',500,500,5,5),shape('o2','POCKET_DEPTH3',600,500,5,5),shape('inside','CUT',12,22,3,3)]);
 const issues=drawingIssues(d,'Model',review.defaultDrawingRules(d),{}, {mode:'board'});
 expect(issues.filter(v=>v.code==='placement-conflict').map(v=>v.shapeId)).toEqual(['cross','multi','inside']);
 expect(issues.some(v=>v.shapeId==='o1')).toBe(true);expect(issues.some(v=>v.shapeId==='o2')).toBe(true);expect(issues.some(v=>v.shapeIds?.includes('multi')&&v.shapeIds.includes('inside'))).toBe(true);
 expect(review.drawingPlacementIssues(d,{mode:'board'},review.defaultDrawingRules(d))).toEqual(issues);
});
it('allows explicit pending resolution of a crossing contour without moving its source geometry',()=>{
 const d=doc([shape('s','REF_STOCK',0,0,100,200),shape('cross','CUT',90,20,20,20)]);
 expect(()=>compileDrawing(d)).toThrow(/板框/);
 const p=compileDrawing(d,{placementRules:{cross:{mode:'pending'}}});expect(p.parts[0].stockId).toBe('');expect(p.original.placements).toEqual([]);expect(p.drawingSource?.shapes[1].points[0]).toEqual({x:90,y:20});
});
it('independently rejects forced board choices without full containment or from another file',()=>{
 const d=doc([shape('s','REF_STOCK',0,0,100,200),shape('cross','CUT',90,20,20,20)]);
 for(const stockId of ['s','old']) expect(()=>compileDrawing(d,{placementRules:{cross:{mode:'stock',stockId}}})).toThrow(/完整包含|板框/);
});
it('permits choosing one of multiple fully containing boards',()=>{
 const d=doc([shape('s','REF_STOCK',0,0,100,200),shape('s2','REF_STOCK',0,0,100,200),shape('part','CUT',10,20,20,30)]);
 expect(()=>compileDrawing(d)).toThrow(/多个板框/);
 const p=compileDrawing(d,{placementRules:{part:{mode:'stock',stockId:'s2'}}});expect(p.parts[0].stockId).toBe('s2');expect(p.original.placements[0]).toMatchObject({sheetId:'s2',x:10,y:20});
});
it('keeps rotated board transforms and pending open centerline and text transforms independent',()=>{
 const d=mixed();d.shapes[0].points=[{x:100,y:200},{x:100,y:300},{x:-100,y:300},{x:-100,y:200}];d.shapes[2].points=[{x:90,y:220},{x:90,y:240},{x:60,y:240},{x:60,y:220}];
 d.shapes.push({...shape('line','Groove',0,0,1,1),closed:false,valid:false,pathValid:true,points:[{x:410,y:520},{x:425,y:520}]});d.labels=[{id:'label',layer:'TEXT',space:'Model',text:'待放置标签',point:{x:410,y:525}}];
 const p=compileDrawing(d,{deferThicknessCheck:true},{...review.defaultDrawingRules(d),Groove:{role:'pocket',depth:2,pocketGeometry:'centerline',slotWidth:2}});
 expect(p.parts[1]).toMatchObject({width:20,height:30});expect(p.original.placements[0]).toMatchObject({x:20,y:10});expect(p.parts[0]).toMatchObject({name:'待放置标签',label:{x:10,y:25}});expect(p.parts[0].pockets[1].centerline).toEqual([{x:10,y:20},{x:25,y:20}]);
});
it.each([['HOLE','HOLE'],['HOLE','POCKET_DEPTH3'],['POCKET_DEPTH3','POCKET_DEPTH3']])('diagnoses unsupported nested %s/%s islands instead of flattening them',(outer,inner)=>{
 const d=doc([shape('part','CUT',0,0,100,100),shape('f1',outer,10,10,50,50),shape('f2',inner,20,20,10,10)]);
 const issues=drawingIssues(d,'Model',review.defaultDrawingRules(d),{}, {mode:'parts'});expect(issues.some(v=>v.shapeIds?.includes('f1')&&v.shapeIds.includes('f2'))).toBe(true);expect(()=>compileDrawing(d,{mode:'parts'})).toThrow(/嵌套|岛/);
});
it('collects multiple feature owners without assigning a first owner',()=>{
 const d=doc([shape('s','REF_STOCK',0,0,100,200),shape('a','CUT',10,10,40,40),shape('b','CUT',30,10,40,40),shape('h','HOLE',35,20,5,5)]);
 expect(drawingIssues(d,'Model',review.defaultDrawingRules(d)).some(v=>v.shapeId==='h'&&v.shapeIds?.includes('a')&&v.shapeIds.includes('b'))).toBe(true);
});
it('requires independent pending metadata and confirms it immutably without inheriting a neighbor board',()=>{
 const p=compileDrawing(mixed(),{deferThicknessCheck:true}),before=structuredClone(p);
 expect(imports.importMetadataIssues(p,{stocks:metadata.stocks}).map(v=>v.field)).toEqual(['part.pending.thickness','part.pending.material']);
 const confirmed=imports.confirmMetadata(p,metadata);expect(confirmed.parts[0]).toMatchObject({thickness:12,material:'独立零件',stockId:''});expect(confirmed.parts[1]).toMatchObject({thickness:18,material:'板材'});expect(p).toEqual(before);
});
it.each([0,3,101,NaN])('validates pending thickness %s and its own pocket depth',(thickness)=>{
 const p=compileDrawing(mixed(),{deferThicknessCheck:true});expect(()=>imports.confirmMetadata(p,{...metadata,parts:{pending:{thickness,material:'木'}}})).toThrow(/板厚|槽深/);
});
it('rejects nonpositive or nonfinite pocket depths in confirmed metadata',()=>{
 const p=compileDrawing(mixed(),{deferThicknessCheck:true});for(const depth of [0,-1,NaN,Infinity]) {p.parts[0].pockets[0].depth=depth;expect(()=>imports.confirmMetadata(p,metadata)).toThrow(/槽深/);}
});
it('reconciles only current unplaced IDs and retains explicit mm edits across rereads',()=>{
 const p=compileDrawing(mixed());const previous={pending:{thickness:18,material:'桦木'},old:{thickness:6,material:'旧'}};
 expect(imports.reconcilePartMetadata(p.parts,previous)).toEqual({pending:{thickness:18,material:'桦木'}});p.parts[0].id='new';expect(imports.reconcilePartMetadata(p.parts,previous)).toEqual({new:{thickness:0,material:''}});
});
it('renders board placements together with the normal pending gallery',()=>{
 const p=compileDrawing(mixed());const html=renderToStaticMarkup(createElement(ImportDrawingPreview,{draft:p,stockId:'s',selectStock:()=>{}}));expect(html).toContain('板材 1 · 1 个零件图形预览');expect(html).toContain('待放置零件');expect(html).toContain('零件 pending 轮廓预览');
});
it('imports, cancels, appends with ID remap, restores pending origins, and undoes as complete transactions',()=>{
 const p=imports.confirmMetadata(compileDrawing(mixed(),{deferThicknessCheck:true}),{...metadata,parts:{pending:{thickness:18,material:'板材'}}}),s=createWorkbenchStore();
 const token=s.getState().beginImport();s.getState().previewDrawing(token,mixed());s.getState().cancelImport();expect(s.getState().project).toBeNull();expect(s.getState().history).toHaveLength(0);
 s.getState().confirmImport(p,'new');expect(s.getState().project?.parts).toHaveLength(2);expect(s.getState().current?.placements).toHaveLength(1);expect(exportEligibility(s.getState().project!,s.getState().current!,defaults).allowed).toBe(false);
 expect(s.getState().placePart('pending','s')).toBe(true);expect(s.getState().addPart({name:'用户添加',shape:'rectangle',width:10,height:10,thickness:18,material:'板材',place:true})).toBe(true);
 const userId=s.getState().selected!;s.getState().reset();expect(s.getState().current?.placements.map(v=>v.partId)).toEqual(['placed',userId]);s.getState().undo();expect(s.getState().current?.placements).toHaveLength(3);
 s.getState().confirmImport(p,'append');expect(s.getState().project?.parts).toHaveLength(5);expect(s.getState().project?.parts.find(v=>v.id==='pending-import-1')?.stockId).toBe('');expect(s.getState().current?.placements.at(-1)).toMatchObject({partId:'placed-import-1',sheetId:'s-import-1',x:10,y:20});s.getState().undo();expect(s.getState().project?.parts).toHaveLength(3);
});
it('restore brings back an originally placed surviving part after manual unplacement',()=>{
 const p=imports.confirmMetadata(compileDrawing(mixed(),{deferThicknessCheck:true}),metadata),s=createWorkbenchStore();s.getState().confirmImport(p,'new');
 s.setState({current:{sheets:p.sheets,placements:[]}});s.getState().reset();expect(s.getState().current?.placements).toEqual([{partId:'placed',sheetId:'s',x:10,y:20,rotation:0}]);s.getState().undo();expect(s.getState().current?.placements).toEqual([]);
});

it('mixed metadata UI identifies each pending field and provides an explicit board bulk apply action',()=>{
 const snapshot=vi.spyOn(workbench,'getInitialState').mockReturnValue({...workbench.getState(),drawingDraft:mixed(),draft:null});
 try {
  const html=renderToStaticMarkup(createElement(ImportPreview,{close:()=>{},sample:true}));
  expect(html).toContain('aria-label="零件 pending 导入板厚"');expect(html).toContain('data-field="part.pending.thickness"');expect(html).toContain('data-field="part.pending.material"');expect(html).toContain('沿用所选板材参数');expect(html).toContain('将所选板材的板厚与材质应用到全部待放置零件');expect(html).toContain('个已放置');expect(html).toContain('个待放置');
 } finally {snapshot.mockRestore();}
});
it('placement review exposes pending and only fully containing board choices with source positioning',()=>{
 const d=doc([shape('s','REF_STOCK',0,0,100,200),shape('s2','REF_STOCK',0,0,100,200),shape('s3','REF_STOCK',90,0,100,200),shape('part','CUT',10,20,20,30)]),rules=review.defaultDrawingRules(d);
 const html=renderToStaticMarkup(createElement(DrawingReview,{document:d,space:'Model',setSpace:()=>{},layerRules:rules,shapeRules:{},setLayerRule:()=>{},setShapeRule:()=>{},setPlacementRule:()=>{},issues:drawingIssues(d,'Model',rules)}));
 expect(html).toContain('作为待放置零件');expect(html).toContain('aria-label="图形 part 所属板框"');expect(html).toContain('选择板框');
 const conflict=drawingIssues(d,'Model',rules).find(issue=>issue.shapeId==='part'&&issue.code==='placement-conflict');
 expect(conflict?.eligibleStockIds).toEqual(['s','s2']);expect(conflict?.eligibleStockIds).not.toContain('s3');expect(html).toContain('源标识：part');
});

it('retains a declared through-hole inside a shallow pocket as supported counterbore machining',()=>{
 const d=doc([shape('part','CUT',0,0,100,100),shape('p','POCKET_DEPTH3',10,10,50,50),shape('h','HOLE',20,20,10,10)]);
 expect(drawingIssues(d,'Model',review.defaultDrawingRules(d),{}, {mode:'parts'})).toEqual([]);
 const p=compileDrawing(d,{mode:'parts',thickness:12,material:'木'});expect(p.parts[0].holes[0]).toEqual([{x:20,y:20},{x:30,y:20},{x:30,y:30},{x:20,y:30}]);expect(p.parts[0].pockets[0]).toMatchObject({depth:3,outline:[{x:10,y:10},{x:60,y:10},{x:60,y:60},{x:10,y:60}]});
});
it('restoring a moved imported part whose original stock was deleted retains its current stock and coordinates',()=>{
 const p=imports.confirmMetadata(compileDrawing(mixed(),{deferThicknessCheck:true}),metadata),s=createWorkbenchStore();s.getState().confirmImport(p,'new');
 const replacement={...p.sheets[0],id:'replacement'},current={partId:'placed',sheetId:'replacement',x:40,y:60,rotation:0 as const};
 s.setState({project:{...s.getState().project!,sheets:[replacement]},current:{sheets:[replacement],placements:[current]}});s.getState().reset();expect(s.getState().current?.placements).toEqual([current]);expect(s.getState().message).toMatch(/原板已删除/);
});
it('keeps a through-hole visible above an enclosing pocket in the import preview',()=>{
 const d=doc([shape('part','CUT',0,0,100,100),shape('p','POCKET_DEPTH3',10,10,50,50),shape('h','HOLE',20,20,10,10)]),p=compileDrawing(d,{mode:'parts'});
 const html=renderToStaticMarkup(createElement(ImportDrawingPreview,{draft:p,stockId:'',selectStock:()=>{}}));
 expect(html.indexOf('class="import-hole-shape"')).toBeGreaterThan(html.indexOf('class="import-pocket-shape"'));
});
