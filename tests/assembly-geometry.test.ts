import { describe, expect, it } from 'vitest';
import type { Part } from '../src/core/types';
import { buildAssemblyModel, geometrySignature, rotationFromEuler, transformPoint } from '../src/core/assemblyGeometry';
export const rect=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
export const plate=(id='a',w=100,h=80,t=12):Part=>({id,name:id,stockId:'s',layer:'CUT',thickness:t,width:w,height:h,area:w*h,outline:rect(0,0,w,h),holes:[],pockets:[],label:{x:w/2,y:h/2}});
export function volume(p:number[]) {let v=0;for(let i=0;i<p.length;i+=9){const a=p.slice(i,i+3),b=p.slice(i+3,i+6),c=p.slice(i+6,i+9);v+=a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]);}return v/6;}
describe('assembly material geometry',()=>{
 it('extrudes a 100×80×12 rectangle with outward mesh winding',()=>{const m=buildAssemblyModel(plate());expect(m.complete).toBe(true);expect(volume(m.positions)).toBeCloseTo(96000,4);expect(m.bounds.max).toEqual({x:100,y:80,z:12});});
 it('subtracts a 20×10 through hole and triangulates its island-free ring',()=>{const p=plate();p.holes=[rect(20,20,20,10)];expect(volume(buildAssemblyModel(p).positions)).toBeCloseTo(93600,4);});
 it.each(['front','back'] as const)('subtracts a depth 3 %s pocket without internal slab caps',face=>{const p=plate();p.pockets=[{outline:rect(20,20,20,10),depth:3}];const m=buildAssemblyModel(p,{signature:geometrySignature(p),faces:{0:face}});expect(m.complete).toBe(true);expect(volume(m.positions)).toBeCloseTo(95400,4);});
 it('keeps unconfirmed and stale pocket faces incomplete',()=>{const p=plate();p.pockets=[{outline:rect(20,20,20,10),depth:3}];expect(buildAssemblyModel(p).complete).toBe(false);expect(buildAssemblyModel(p,{signature:'stale',faces:{0:'front'}}).complete).toBe(false);});
 it('subtracts overlapping holes as a union and clips cuts at the outline',()=>{const p=plate();p.holes=[rect(20,20,20,10),rect(30,20,20,10),rect(-10,0,20,10)];expect(volume(buildAssemblyModel(p).positions)).toBeCloseTo(91200,4);});
 it('supports concave outlines and overlapping front/back depths',()=>{const p=plate();p.outline=[{x:0,y:0},{x:100,y:0},{x:100,y:20},{x:20,y:20},{x:20,y:80},{x:0,y:80}];p.pockets=[{outline:rect(5,5,10,10),depth:8},{outline:rect(5,5,10,10),depth:8}];expect(volume(buildAssemblyModel(p,{signature:geometrySignature(p),faces:{0:'front',1:'back'}}).positions)).toBeCloseTo(37200,4);});
 it('normalizes quaternions before transforming millimetre geometry',()=>{const r=rotationFromEuler({x:0,y:0,z:90});const p=transformPoint({x:10,y:0,z:0},{partId:'a',position:{x:5,y:0,z:0},rotation:{x:r.x*3,y:r.y*3,z:r.z*3,w:r.w*3}});expect(p.x).toBeCloseTo(5);expect(p.y).toBeCloseTo(10);});
 it('rejects invalid thickness and self-intersecting outlines as pending geometry',()=>{const p=plate();p.thickness=0;expect(buildAssemblyModel(p).complete).toBe(false);p.thickness=12;p.outline=[{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}];expect(buildAssemblyModel(p).complete).toBe(false);});
});
it('does not mark a fully removed part as a usable complete solid',()=>{const p=plate();p.holes=[rect(-1,-1,102,82)];expect(buildAssemblyModel(p).complete).toBe(false);});
it('returns pending before unbounded contour validation and slab construction',()=>{const p=plate();p.outline=Array.from({length:3000},(_,i)=>({x:50+40*Math.cos(i*Math.PI/1500),y:40+30*Math.sin(i*Math.PI/1500)}));expect(buildAssemblyModel(p).complete).toBe(false);});
it('rejects an unsupported persisted machining face',()=>{const p=plate();p.pockets=[{outline:rect(20,20,20,10),depth:3}];expect(buildAssemblyModel(p,{signature:geometrySignature(p),faces:{0:'left' as 'front'}}).complete).toBe(false);});
