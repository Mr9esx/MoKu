import type {DrawingDocument,DrawingRole,DrawingRules} from './drawingTypes';
import {effectiveDrawingShape} from './drawingNormalization';
import {containsFeature,stockAxes} from './dxfDomainGeometry';
import {contoursOverlap,validContour} from './geometry';
import {resolveDrawingRule} from './drawingReview';
export type DrawingSuggestion={shapeId:string;label:string;roles:DrawingRole[];basis:string;conflict:boolean};
/** Geometric evidence only; layer names carry no machining semantics. Acceptance is explicit. */
export function suggestDrawingRoles(document:DrawingDocument,space:string,layerRules:DrawingRules,shapeRules:DrawingRules={}):DrawingSuggestion[]{
 const shapes=document.shapes.filter(s=>s.space===space).map(source=>({source,shape:effectiveDrawingShape(source,resolveDrawingRule(source,layerRules,shapeRules)),rule:resolveDrawingRule(source,layerRules,shapeRules)}));
 const valid=shapes.filter(s=>s.shape.closed&&s.shape.valid&&validContour(s.shape.points));
 const confirmedOuters=valid.filter(s=>s.rule.role==='outer');
 const result:DrawingSuggestion[]=[];
 for(const {source,shape,rule} of shapes){
  if(rule.role==='ignore')continue;
  let roles:DrawingRole[]=[];let label='';let basis='';
  const owners=valid.filter(s=>s.source.id!==source.id&&s.rule.role==='outer'&&shape.closed&&shape.valid&&containsFeature(shape.points,s.shape.points));
  if(owners.length){roles=['hole','pocket'];label='内部加工候选';basis='完整位于已确认零件外轮廓内；二维边界不能确定通孔或槽深。';}
  else if(shape.closed&&shape.valid){
   let rectangular=false;try{stockAxes(shape.points);rectangular=true;}catch{/* Not a board candidate. */}
   const contained=confirmedOuters.filter(s=>s.source.id!==source.id&&containsFeature(s.shape.points,shape.points));
   const disjoint=contained.length>=2&&contained.every((a,i)=>contained.slice(i+1).every(b=>!contoursOverlap(a.shape.points,b.shape.points)));
   if(rectangular&&disjoint){roles=['stock'];label='板框候选';basis=`矩形完整包含 ${contained.length} 个互不重叠的已确认零件外轮廓。`;}
  }
  if(roles.length&&!(rule.role!=='unknown'&&roles.includes(rule.role)))result.push({shapeId:source.id,label,roles,basis,conflict:rule.role!=='unknown'});
 }
 return result;
}
