import {expect,it} from 'vitest';
import {compileDrawing,drawingIssues} from '../src/core/drawingReview';
import {readDrawing} from '../src/core/drawingDocument';
import {bounds,polygonArea} from '../src/core/geometry';
import {confirmMetadata} from '../src/core/importTransaction';
import {exportSvg} from '../src/core/export';
import {parseDrawingTemplates} from '../src/core/drawingTemplates';
import type {DrawingDocument,DrawingRule} from '../src/core/drawingTypes';
const drawing=(points:{x:number;y:number}[],layer='Machining'):DrawingDocument=>({name:'vendor',unitKnown:true,importInfo:{sourceUnit:'毫米',scale:1,overridden:false},spaces:['model'],labels:[],shapes:[{id:'part',layer:'Outer',space:'model',entityType:'LWPOLYLINE',closed:true,valid:true,sourceIds:['part'],points:[{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80}]},{id:'slot',layer,space:'model',entityType:'LWPOLYLINE',closed:false,valid:false,pathValid:true,sourceIds:['slot'],points}],diagnostics:[{id:'slot:geometry',shapeId:'slot',layer,space:'model',severity:'blocking',code:'open-path',message:'轮廓未闭合'}]});
const rules=(rule:DrawingRule)=>({Outer:{role:'outer' as const},Machining:rule});
it('accepts an explicitly defined open centerline as a real-width groove, retaining original endpoints',()=>{
 const d=drawing([{x:20,y:30},{x:70,y:30}]);
 const p=compileDrawing(d,{mode:'parts'},rules({role:'pocket',depth:3,pocketGeometry:'centerline',slotWidth:6}));
 const pocket=p.parts[0].pockets[0];
 const b=bounds(pocket.outline);for(const [key,value] of Object.entries({minX:17,maxX:73,minY:27,maxY:33})) expect(Math.abs(b[key as keyof typeof b]-value)).toBeLessThanOrEqual(0.025);
 expect(polygonArea(pocket.outline)).toBeCloseTo(50*6+Math.PI*9,0);
 expect(pocket.centerline).toEqual(d.shapes[1].points);expect(pocket.width).toBe(6);expect(pocket.depth).toBe(3);
 expect(d.shapes[1].closed).toBe(false);expect(d.shapes[1].points).toHaveLength(2);
});
it('does not accept an open slot on a role assignment alone or guess width',()=>{
 const d=drawing([{x:20,y:30},{x:70,y:30}]);
 expect(drawingIssues(d,'model',rules({role:'pocket',depth:3}),{}).length).toBeGreaterThan(0);
 expect(()=>compileDrawing(d,{mode:'parts'},rules({role:'pocket',depth:3,pocketGeometry:'centerline'}))).toThrow(/槽宽/);
 expect(()=>compileDrawing(d,{mode:'parts'},rules({role:'hole'}))).toThrow(/闭合/);
});
it('closes a boundary only after explicit user instruction, with independent contour validation',()=>{
 const d=drawing([{x:20,y:20},{x:40,y:20},{x:40,y:30},{x:20,y:30}]);
 const p=compileDrawing(d,{mode:'parts'},rules({role:'pocket',depth:3,pocketGeometry:'close-boundary'}));
 expect(p.parts[0].pockets[0].outline).toEqual(d.shapes[1].points);expect(p.parts[0].pockets[0].boundaryClosedByUser).toBe(true);
 d.shapes[1].points=[{x:20,y:20},{x:40,y:30},{x:20,y:30},{x:40,y:20}];
 expect(()=>compileDrawing(d,{mode:'parts'},rules({role:'pocket',depth:3,pocketGeometry:'close-boundary'}))).toThrow(/自交|区域/);
});
it('checks the expanded footprint against part ownership, rather than only the centerline',()=>{
 const d=drawing([{x:1,y:10},{x:1,y:60}]);
 expect(()=>compileDrawing(d,{mode:'parts'},rules({role:'pocket',depth:3,pocketGeometry:'centerline',slotWidth:6}))).toThrow(/归属/);
});
it('continues to block branching, malformed paths and missing depth even with a machining assignment',()=>{
 const d=drawing([{x:20,y:30},{x:70,y:30}]);
 d.shapes[1].pathValid=false;d.diagnostics[0].code='invalid-geometry';d.diagnostics[0].message='链存在分支';
 expect(()=>compileDrawing(d,{mode:'parts'},rules({role:'pocket',depth:3,pocketGeometry:'centerline',slotWidth:6}))).toThrow(/分支/);
 d.shapes[1].pathValid=true;d.diagnostics[0].code='open-path';
 expect(()=>compileDrawing(d,{mode:'parts'},rules({role:'pocket',pocketGeometry:'centerline',slotWidth:6}))).toThrow(/槽深/);
});
it('reader distinguishes an open machining path from an invalid closed contour',()=>{
 const text=[0,'SECTION',2,'HEADER',9,'$INSUNITS',70,4,0,'ENDSEC',0,'SECTION',2,'ENTITIES',0,'LINE',5,'line',8,'Routing',10,0,20,0,11,50,21,0,0,'ENDSEC',0,'EOF',''].join('\n');
 const d=readDrawing(text);expect(d.shapes[0].pathValid).toBe(true);expect(d.diagnostics[0].code).toBe('open-path');
});
it('retains groove centerline and width in templates and SVG after rotation',()=>{
 const templates=parseDrawingTemplates(JSON.stringify([{name:'open grooves',rules:{Machining:{role:'pocket',pocketGeometry:'centerline',depth:3,slotWidth:6}}}]));
 expect(templates[0]?.rules.Machining.slotWidth).toBe(6);
 const d=drawing([{x:20,y:30},{x:70,y:30}]);
 const p=confirmMetadata(compileDrawing(d,{mode:'parts'},rules(templates[0]?.rules.Machining??{role:'pocket'})),{thickness:12,material:'木'});
 const sheet={id:'s',name:'板',width:200,height:200,thickness:12,material:'木'};
 const svg=exportSvg(p,{sheets:[sheet],placements:[{partId:p.parts[0].id,sheetId:'s',x:10,y:20,rotation:90}]});
 expect(svg).toContain('data-pocket-width-mm="6"');expect(svg).toContain('data-feature="pocket-centerline"');expect(svg).toContain('points="60,160 60,110"');
});

it.each([0,-3,NaN,Infinity])('rejects invalid centerline width %s without removing source geometry',width=>{
 const d=drawing([{x:20,y:30},{x:70,y:30}]);
 expect(()=>compileDrawing(d,{mode:'parts'},rules({role:'pocket',depth:3,pocketGeometry:'centerline',slotWidth:width}))).toThrow(/槽宽/);
 expect(d.shapes[1].points).toHaveLength(2);
});
it('keeps user width and depth in mm when the drawing coordinates are converted from cm',()=>{
 const text=[0,'SECTION',2,'HEADER',9,'$INSUNITS',70,5,0,'ENDSEC',0,'SECTION',2,'ENTITIES',
 0,'LWPOLYLINE',5,'part',8,'Outer',90,4,70,1,10,0,20,0,10,10,20,0,10,10,20,8,10,0,20,8,
 0,'LINE',5,'slot',8,'Machining',10,2,20,3,11,7,21,3,0,'ENDSEC',0,'EOF',''].join('\n');
 const d=readDrawing(text);const p=compileDrawing(d,{mode:'parts'},rules({role:'pocket',depth:3,pocketGeometry:'centerline',slotWidth:6}));
 expect(p.parts[0].width).toBe(100);expect(p.parts[0].pockets[0].width).toBe(6);expect(p.parts[0].pockets[0].depth).toBe(3);
 expect(p.parts[0].pockets[0].centerline).toEqual([{x:20,y:30},{x:70,y:30}]);
});
it('supports mixed closed regions and open grooves through individual overrides',()=>{
 const d=drawing([{x:20,y:30},{x:70,y:30}]);
 d.shapes.push({...d.shapes[0],id:'area',layer:'Machining',points:[{x:40,y:40},{x:50,y:40},{x:50,y:50},{x:40,y:50}]});
 const layers=rules({role:'pocket',depth:3});const overrides={slot:{role:'pocket' as const,depth:3,pocketGeometry:'centerline' as const,slotWidth:6}};
 const p=compileDrawing(d,{mode:'parts'},layers,overrides);expect(p.parts[0].pockets).toHaveLength(2);expect(p.parts[0].pockets[1].centerline).toBeUndefined();
 expect(()=>compileDrawing(d,{mode:'parts'},layers)).toThrow(/画法/);
});
it('does not interpret closed rings as solid centerline grooves',()=>{
 const d=drawing([{x:20,y:20},{x:40,y:20},{x:40,y:30},{x:20,y:30}]);d.shapes[1].closed=true;d.shapes[1].valid=true;d.diagnostics=[];
 expect(()=>compileDrawing(d,{mode:'parts'},rules({role:'pocket',depth:3,pocketGeometry:'centerline',slotWidth:6}))).toThrow(/闭合环/);
});
it('rejects invalid groove configuration restored from local templates',()=>{
 for(const rule of [{role:'pocket',pocketGeometry:'auto'},{role:'pocket',slotWidth:-1},{role:'pocket',slotWidth:'6'}])
 expect(parseDrawingTemplates(JSON.stringify([{name:'broken',rules:{Machining:rule}}]))).toEqual([]);
});

it('keeps centerline aligned with the footprint in a rotated stock frame',()=>{
 const d=drawing([{x:30,y:30},{x:70,y:30}]);
 d.shapes[0].points=[{x:10,y:10},{x:110,y:10},{x:110,y:90},{x:10,y:90}];
 d.shapes.unshift({...d.shapes[0],id:'frame',layer:'Frame',points:[{x:0,y:0},{x:120,y:0},{x:120,y:160},{x:0,y:160}]});
 const turn=(p:{x:number;y:number})=>({x:200-p.y,y:100+p.x});for(const shape of d.shapes)shape.points=shape.points.map(turn);
 const p=compileDrawing(d,{mode:'board'},{...rules({role:'pocket',depth:3,pocketGeometry:'centerline',slotWidth:6}),Frame:{role:'stock',thickness:12}});
 expect(p.parts[0].pockets[0].centerline).toEqual([{x:20,y:20},{x:60,y:20}]);
 expect(p.parts[0].width).toBe(100);expect(p.original.placements[0]).toMatchObject({x:10,y:10});
 const b=bounds(p.parts[0].pockets[0].outline);expect(Math.abs(b.minX-17)).toBeLessThanOrEqual(.025);expect(b.minY).toBe(17);
});
it('validates groove depth against the actual thickness during confirmation',()=>{
 const d=drawing([{x:20,y:30},{x:70,y:30}]);const p=compileDrawing(d,{mode:'parts'},rules({role:'pocket',depth:6,pocketGeometry:'centerline',slotWidth:6}));
 expect(()=>confirmMetadata(p,{thickness:5,material:'木'})).toThrow(/槽深/);
});
it('applies the total point limit to generated machining geometry before project construction',()=>{
 const d=drawing([{x:20,y:30},{x:70,y:30}]);const slot=d.shapes.pop()!;
 d.diagnostics=[];for(let i=0;i<2500;i++)d.shapes.push({...slot,id:`slot-${i}`});
 expect(()=>compileDrawing(d,{mode:'parts'},rules({role:'pocket',depth:3,pocketGeometry:'centerline',slotWidth:6}))).toThrow(/总顶点/);
});
