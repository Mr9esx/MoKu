import { describe, expect, it } from 'vitest';
import { readDrawing } from '../src/core/drawingDocument';
import { compileDrawing, drawingIssues } from '../src/core/drawingReview';
import { polygonArea, validContour } from '../src/core/geometry';
import type { DrawingRule } from '../src/core/drawingTypes';
import { effectiveDrawingShape } from '../src/core/drawingNormalization';

const dxf=(entities:string,unit=4,blocks='')=>`0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${unit}\n0\nENDSEC\n${blocks?`0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n`:''}0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const poly=(points:number[][],closed=false,id='region',layer='CUT',bulges:number[]=[])=>`0\nLWPOLYLINE\n5\n${id}\n8\n${layer}\n90\n${points.length}\n70\n${closed?1:0}\n`+points.map(([x,y],i)=>`10\n${x}\n20\n${y}\n${bulges[i]?`42\n${bulges[i]}\n`:''}`).join('');
const line=(id:string,a:number[],b:number[])=>`0\nLINE\n5\n${id}\n8\nCUT\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}\n`;
const returned=(gap:number)=>[[0,0],[10,0],[10,10],[0,10],[gap,0]];

it.each(['individual','layer'] as const)('uses normalized geometry after a %s centerline rule changes to an outer or hole role',scope=>{
 const document=readDrawing(dxf(poly([[0,0],[100,0],[100,80],[0,80]],true,'part','Outer')+poly(returned(.0009).map(([x,y])=>[x+20,y+20]),false,'slot','Machining')));
 const shape=document.shapes.find(shape=>shape.id==='slot')!;
 const centerline:DrawingRule={role:'pocket',depth:3,pocketGeometry:'centerline',slotWidth:2};
 expect(effectiveDrawingShape(shape,centerline).closed).toBe(false);
 for(const role of ['outer','hole'] as const){
  const changed:DrawingRule={...centerline,role};
  const layers={Outer:{role:role==='outer'?'ignore' as const:'outer' as const},Machining:scope==='layer'?changed:{role:'unknown' as const}};
  const overrides=scope==='individual'?{slot:changed}:{};
  expect(effectiveDrawingShape(shape,changed)).toMatchObject({closed:true,valid:true,points:[{x:20,y:20},{x:30,y:20},{x:30,y:30},{x:20,y:30}]});
  expect(drawingIssues(document,'model',layers,overrides)).toEqual([]);
  const project=compileDrawing(document,{mode:'parts'},layers,overrides);
  expect(project.parts).toHaveLength(1);
  expect(project.parts[0].holes).toHaveLength(role==='hole'?1:0);
  const restored={slot:{...changed,geometrySource:'original' as const}};
  expect(effectiveDrawingShape(shape,restored.slot).closed).toBe(false);
  expect(drawingIssues(document,'model',layers,restored).some(issue=>issue.shapeId==='slot'&&issue.message.includes('未闭合'))).toBe(true);
 }
});

describe('physical region normalization',()=>{
 it.each([0,.000004,.0009,.001])('normalizes returned endpoint gap %s mm, preserving source geometry',gap=>{
  const shape=readDrawing(dxf(poly(returned(gap)))).shapes[0];
  expect(shape.closed).toBe(true);expect(shape.valid).toBe(true);expect(shape.points).toHaveLength(4);
  expect(shape.normalization?.original).toMatchObject({closed:false,points:returned(gap).map(([x,y])=>({x,y}))});
  expect(shape.normalization?.endpointChanges.at(-1)?.displacement).toBeCloseTo(gap,8);
 });
 it('leaves a genuine open boundary and a tiny two-point line open',()=>{
  expect(readDrawing(dxf(poly(returned(.002)))).shapes[0].closed).toBe(false);
  const shape=readDrawing(dxf(line('tiny',[0,0],[.0009,0]))).shapes[0];
  expect(shape.points).toHaveLength(2);expect(shape.closed).toBe(false);expect(shape.pathValid).toBe(true);
 });
 it('removes multiple tiny trailing vertices before their backtracking closing edge is sampled',()=>{
  const shape=readDrawing(dxf(poly([...returned(.000004),[.000001,0]],true))).shapes[0];
  expect(shape.valid).toBe(true);expect(shape.points).toHaveLength(4);expect(shape.normalization?.original.closed).toBe(true);
 });
 it('retains a real bulge when replacing the returned endpoint',()=>{
  const shape=readDrawing(dxf(poly([[0,0],[10,0],[10,10],[.000004,0]],false,'arc','CUT',[0,0,1]))).shapes[0];
  expect(shape.valid).toBe(true);expect(shape.points.length).toBeGreaterThan(4);
  expect(polygonArea(shape.points)).toBeGreaterThan(100);
 });
 it('preserves almost-full arcs whose endpoints are physically near',()=>{
  const shape=readDrawing(dxf(poly([[0,0],[.0009,0]],false,'arc','CUT',[20000]))).shapes[0];
  expect(shape.valid).toBe(true);expect(shape.points.length).toBeGreaterThan(20);
  expect(polygonArea(shape.points)).toBeGreaterThan(50);
 });
 it('does not auto-normalize zero-area or crossing regions',()=>{
  for(const points of [[[0,0],[10,10],[0,10],[10,0],[.000004,0]],[[0,0],[10,0],[20,0],[.000004,0]]]){
   const shape=readDrawing(dxf(poly(points))).shapes[0];expect(shape.valid).toBe(false);expect(shape.normalization).toBeUndefined();
  }
 });
 it.each([[4,1],[5,10],[1,25.4]])('uses physical mm after source unit %s conversion', (unit,scale)=>{
  const shape=readDrawing(dxf(poly(returned(.0009).map(p=>p.map(v=>v/scale))),unit)).shapes[0];
  expect(shape.points).toEqual([{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}]);expect(shape.valid).toBe(true);
 });
 it('normalizes after mirrored OCS and scaled block transforms',()=>{
  const block=`0\nBLOCK\n2\nregion\n10\n0\n20\n0\n${poly(returned(.00045),false,'p','0')}210\n0\n220\n0\n230\n-1\n0\nENDBLK\n`;
  const shape=readDrawing(dxf('0\nINSERT\n5\ni\n2\nregion\n41\n2\n42\n2\n',4,block)).shapes[0];
  expect(shape.valid).toBe(true);expect(shape.points).toEqual([{x:0,y:0},{x:-20,y:0},{x:-20,y:20},{x:0,y:20}]);
 });
 it('restores original validation and uses original open geometry for centerline',()=>{
  const doc=readDrawing(dxf(poly([[0,0],[100,0],[100,80],[0,80]],true,'part','Outer')+poly(returned(.0009).map(([x,y])=>[x+20,y+20]),false,'slot','Machining')));
  const rules={Outer:{role:'outer' as const},Machining:{role:'pocket' as const,depth:3}};
  expect(drawingIssues(doc,'model',rules)).toEqual([]);
  expect(drawingIssues(doc,'model',rules,{slot:{role:'pocket',depth:3,geometrySource:'original'}}).some(i=>i.shapeId==='slot')).toBe(true);
  const rule:DrawingRule={role:'pocket',depth:3,pocketGeometry:'centerline',slotWidth:12};
  const project=compileDrawing(doc,{mode:'parts'},rules,{slot:rule});
  expect(project.parts[0].pockets[0].centerline).toEqual([{x:20,y:20},{x:30,y:20},{x:30,y:30},{x:20,y:30},{x:20.0009,y:20}]);
 });
});
describe('physical LINE/ARC chain matching',()=>{
 it('closes a uniquely matched chain at the inclusive physical tolerance',()=>{
  const shape=readDrawing(dxf(line('a',[0,0],[10,0])+line('b',[10.001,0],[10,10])+line('c',[10,10],[0,0]))).shapes[0];
  expect(shape.closed).toBe(true);expect(validContour(shape.points)).toBe(true);expect(shape.sourceIds).toHaveLength(3);
 });
 it('does not transitively weld ambiguous proximity groups',()=>{
  const doc=readDrawing(dxf(line('a',[0,0],[10,0])+line('b',[10.0009,0],[20,0])+line('c',[10.0018,0],[10,10])));
  expect(doc.shapes.every(s=>!s.valid)).toBe(true);
  expect(doc.shapes.every(s=>s.sourceIds.length===1)).toBe(true);
  expect(doc.diagnostics.some(d=>/分支|歧义/.test(d.message))).toBe(true);
 });
});
it('retains original near-returned spline geometry and declared closure',()=>{
 const points=returned(.0009);
 const spline='0\nSPLINE\n5\ns\n8\nCUT\n70\n0\n71\n1\n72\n7\n73\n5\n'+[0,0,1,2,3,4,4].map(k=>`40\n${k}\n`).join('')+points.map(([x,y])=>`10\n${x}\n20\n${y}\n`).join('');
 const shape=readDrawing(dxf(spline)).shapes[0];expect(shape.valid).toBe(true);expect(shape.normalization?.original.closed).toBe(false);
 expect(shape.normalization?.original.points.at(-1)).toEqual({x:.0009,y:0});
});
it('does not enlarge the physical endpoint tolerance through coordinate rounding',()=>{
 const shape=readDrawing(dxf(poly(returned(.0010004)))).shapes[0];
 expect(shape.closed).toBe(false);expect(shape.normalization).toBeUndefined();
});

it('renders collapsed automatic repair records without blockers and reflects restored geometry',async()=>{
 const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
 const {DrawingReview}=await import('../src/components/DrawingReview');
 const document=readDrawing(dxf(poly(returned(.0009))));
 const props={document,space:'model',setSpace:()=>{},layerRules:{CUT:{role:'outer' as const}},shapeRules:{},setLayerRule:()=>{},setShapeRule:()=>{},issues:[]};
 const normalized=renderToStaticMarkup(createElement(DrawingReview,props));
 expect(normalized).toContain('已自动修正');expect(normalized).toContain('0.001 mm');expect(normalized).not.toContain('is-invalid');
 const restored=renderToStaticMarkup(createElement(DrawingReview,{...props,shapeRules:{region:{role:'outer',geometrySource:'original'}}}));
 expect(restored).toContain('is-invalid');expect(restored).toContain('is-open-path');
});
it('does not join LINE chain endpoints just outside tolerance after sampling rounds them',()=>{
 const doc=readDrawing(dxf(line('a',[0,0],[10,0])+line('b',[10.0010004,0],[10,10])+line('c',[10,10],[0,0])));
 expect(doc.shapes.every(shape=>!shape.closed)).toBe(true);
});
it('does not close a spline just outside physical tolerance through sampler rounding',()=>{
 const spline='0\nSPLINE\n5\ns\n8\nCUT\n70\n0\n71\n1\n72\n7\n73\n5\n'+[0,0,1,2,3,4,4].map(k=>`40\n${k}\n`).join('')+returned(.0010004).map(([x,y])=>`10\n${x}\n20\n${y}\n`).join('');
 expect(readDrawing(dxf(spline)).shapes[0].closed).toBe(false);
});

const ellipse=(gap:number,radius=10)=>`0\nELLIPSE\n5\nellipse\n8\nCUT\n10\n0\n20\n0\n11\n${radius}\n21\n0\n40\n1\n41\n0\n42\n${2*Math.PI-gap/radius}\n`;
it.each([0,.000004,.0009,.001,.002])('normalizes an ellipse using a physical %s mm gap with reversible geometry',gap=>{
 const document=readDrawing(dxf(ellipse(gap))),shape=document.shapes[0];
 expect(shape.closed).toBe(gap<=.001);expect(shape.valid).toBe(gap<=.001);
 if(gap>0&&gap<=.001){
  expect(shape.normalization?.original.closed).toBe(false);
  expect(shape.normalization?.original.points.at(-1)?.y).toBeCloseTo(-gap,6);
  expect(drawingIssues(document,'model',{CUT:{role:'outer'}},{ellipse:{role:'outer',geometrySource:'original'}}).some(issue=>issue.shapeId==='ellipse')).toBe(true);
 }
 if(gap>.001)expect(shape.normalization).toBeUndefined();
});
it.each([[4,1],[5,10],[1,25.4]])('normalizes ellipse after source unit %s conversion',(unit,scale)=>{
 const shape=readDrawing(dxf(ellipse(.0009/scale,10/scale),unit)).shapes[0];
 expect(shape.valid).toBe(true);expect(shape.normalization?.endpointChanges[0].displacement).toBeCloseTo(.0009,8);
});
it('uses the scaled block physical ellipse gap and rejects a large near-full angular sweep',()=>{
 const block=`0\nBLOCK\n2\nellipse\n10\n0\n20\n0\n${ellipse(.00045)}0\nENDBLK\n`;
 const shape=readDrawing(dxf('0\nINSERT\n5\ni\n2\nellipse\n41\n-2\n42\n2\n',4,block)).shapes[0];
 expect(shape.valid).toBe(true);expect(shape.normalization?.endpointChanges[0].displacement).toBeCloseTo(.0009,8);
 // A small angular gap becomes physically open after block scaling; it must retain its endpoint.
 const large=readDrawing(dxf('0\nINSERT\n5\ni\n2\nellipse\n41\n100\n42\n100\n',4,block)).shapes[0];
 expect(large.closed).toBe(false);expect(large.normalization).toBeUndefined();
});
it('bounds nearby endpoint candidates and scan work after ambiguity is established',async()=>{
 const normalization=await import('../src/core/drawingNormalization');
 const endpoint={point:{x:0,y:0},shape:{id:'first'}};
 let visited=0;
 const first={point:{x:0,y:0},shape:{id:'second'}},second={point:{x:0,y:0},shape:{id:'third'}};
 function* neighbors(){for(const entry of [first,second,...Array.from({length:100},()=>({point:{x:0,y:0},shape:{}}))]){visited++;yield entry;}}
 expect(normalization.boundedEndpointMatches?.(endpoint,neighbors())).toEqual([first,second]);
 expect(visited).toBe(2);
});
it('leaves dense LINE rays separate and diagnoses ambiguous shared endpoints',()=>{
 const document=readDrawing(dxf(Array.from({length:128},(_,i)=>line(`ray-${i}`,[0,0],[10+i,100])).join('')));
 expect(document.shapes).toHaveLength(128);
 expect(document.shapes.every(shape=>!shape.closed&&shape.sourceIds.length===1&&shape.points.length===2)).toBe(true);
 expect(document.diagnostics.every(issue=>/分支|歧义/.test(issue.message))).toBe(true);
});
