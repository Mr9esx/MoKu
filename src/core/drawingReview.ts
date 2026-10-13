import type {DrawingDocument,DrawingDiagnostic,DrawingRule,DrawingRules,DrawingShape} from "./drawingTypes";
import {pocketGeometry} from "./drawingPockets";
import {validContour} from "./geometry";
import {buildDrawingProject, resolvedDrawingIssues, type ResolvedShape} from "./drawingProject";
import {containsFeature,stockAxes} from "./dxfDomainGeometry";
import { effectiveDrawingShape } from "./drawingNormalization";
export type PlacementRule={mode:"pending"}|{mode:"stock";stockId:string};
export type ImportOptions={placementRules?:Record<string,PlacementRule>;mode?:"board"|"parts";unit?:"mm"|"cm"|"m"|"inch"|"foot";thickness?:number;material?:string;quantity?:number;space?:string;inferStock?:boolean;deferThicknessCheck?:boolean};
/** Compatibility preset only. Vendor names stay unresolved; numbers never imply machining. */
export function defaultDrawingRules(doc:DrawingDocument):DrawingRules {
 const rules:DrawingRules=Object.create(null);
 for(const layer of new Set([...doc.shapes.map(s=>s.layer),...doc.diagnostics.map(d=>d.layer)])) {
  let rule:DrawingRule={role:"unknown"};
  if(layer==="0" || /^CUT(?:_|$)/i.test(layer)) rule={role:"outer"};
  else if(/^REF_STOCK(?:_|$)/i.test(layer)) rule={role:"stock"};
  else if(/^HOLE(?:_|$)/i.test(layer)) rule={role:"hole"};
  else if(/^POCKET(?:_|$)/i.test(layer)) rule={role:"pocket"};
  if(rule.role!=="unknown") {
   const thickness=layer.match(/_(\d+(?:\.\d+)?)MM$/i);
   if(thickness) rule.thickness=Number(thickness[1]);
   const depth=layer.match(/DEPTH(\d+(?:\.\d+)?)$/i);
   if(rule.role==="pocket"&&depth) rule.depth=Number(depth[1])*doc.importInfo.scale;
  }
  rules[layer]=rule;
 }
 return rules;
}
export function resolveDrawingRule(shape:DrawingShape,layerRules:DrawingRules,shapeRules:DrawingRules={}):DrawingRule {
 return (Object.hasOwn(shapeRules,shape.id)?shapeRules[shape.id]:undefined)??(Object.hasOwn(layerRules,shape.layer)?layerRules[shape.layer]:undefined)??{role:"unknown"};
}
export const diagnosticRuleKey=(diagnostic:DrawingDiagnostic)=>`@diagnostic/${diagnostic.id}`;
export function drawingIssues(doc:DrawingDocument,space:string,layerRules:DrawingRules,shapeRules:DrawingRules={},options:ImportOptions={}):DrawingDiagnostic[] {
 const issues:DrawingDiagnostic[]=[];
 if(!doc.unitKnown) issues.push({id:"unit",layer:"",space,message:"单位未知，请选择原文件单位",severity:"blocking"});
 for(const diagnostic of doc.diagnostics.filter(d=>d.space===space&&d.severity==="blocking"&&d.id!=="units")) {
  if(Object.hasOwn(shapeRules,diagnosticRuleKey(diagnostic)) && shapeRules[diagnosticRuleKey(diagnostic)].role==="ignore") continue;
  const shape=doc.shapes.find(s=>s.id===diagnostic.shapeId);
  if(shape?.normalization && diagnostic.code) continue;
  if(shape && diagnostic.code==="open-path" && resolveDrawingRule(shape,layerRules,shapeRules).role==="pocket") continue;
  if((shape?resolveDrawingRule(shape,layerRules,shapeRules):(Object.hasOwn(layerRules,diagnostic.layer)?layerRules[diagnostic.layer]:undefined))?.role!=="ignore") issues.push(diagnostic);
 }
 for(const sourceShape of doc.shapes.filter(s=>s.space===space)) {
  const rule=resolveDrawingRule(sourceShape,layerRules,shapeRules);
  const shape=effectiveDrawingShape(sourceShape,rule);
  if(rule.role==="ignore") continue;
  let message="";
  if(rule.role==="pocket") {
    try {pocketGeometry(shape,rule);} catch(e) {message=(e as Error).message;}
    if(!Number.isFinite(rule.depth)||!(rule.depth!>0)) issues.push({id:`depth-${shape.id}`,layer:shape.layer,space,shapeId:shape.id,message:"请填写大于 0 的槽深（mm）",severity:"blocking"});
  } else if(!shape.closed||!shape.valid||!validContour(shape.points)) message=`图层 ${shape.layer}：轮廓未闭合、自交或无效，请修复或明确忽略`;
  if(rule.role==="unknown") issues.push({id:`purpose-${shape.id}`,layer:shape.layer,space,shapeId:shape.id,message:`图层 ${shape.layer}：用途未确认`,severity:"blocking"});
  if(message&&!issues.some(d=>d.shapeId===shape.id&&d.message===message)) issues.push({id:`review-${shape.id}`,layer:shape.layer,space,shapeId:shape.id,message,severity:"blocking"});
 }
 return [...issues,...drawingPlacementIssues(doc,{...options,space},layerRules,shapeRules)];
}
export function drawingPlacementIssues(doc:DrawingDocument,options:ImportOptions={},layerRules:DrawingRules=defaultDrawingRules(doc),shapeRules:DrawingRules={}):DrawingDiagnostic[] {
 const space=options.space??doc.spaces.find(s=>s.toLowerCase()==="model")??doc.spaces[0];
 const resolved:ResolvedShape[]=[];
 for(const shape of doc.shapes.filter(s=>s.space===space)) {
  const rule=resolveDrawingRule(shape,layerRules,shapeRules);
  if(rule.role==="ignore"||rule.role==="unknown") continue;
  try {
   const effective=effectiveDrawingShape(shape,rule);
   const geometry=rule.role==="pocket"?pocketGeometry(shape,rule):effective.closed&&effective.valid&&validContour(effective.points)?{points:effective.points}:undefined;
   if(geometry) resolved.push({...geometry,e:{handle:shape.id,layer:shape.layer,...rule}});
  } catch { /* Geometry review reports malformed paths separately. */ }
 }
 if(resolved.filter(s=>s.e.role==="outer").length>1000 || resolved.reduce((n,s)=>n+s.points.length,0)>50_000) return [];
 return resolvedDrawingIssues(doc,{...options,space},resolved);
}
export function compileDrawing(doc:DrawingDocument,options:ImportOptions={},layerRules:DrawingRules=defaultDrawingRules(doc),shapeRules:DrawingRules={}) {
 const space=options.space??doc.spaces.find(s=>s.toLowerCase()==="model")??doc.spaces[0];
 const shapes=doc.shapes.filter(s=>s.space===space&&resolveDrawingRule(s,layerRules,shapeRules).role!=="ignore");
 if(new Set(shapes.map(s=>s.id)).size!==shapes.length) throw Error("源实体 ID 重复，请修复图纸");
 const issues=drawingIssues(doc,space,layerRules,shapeRules,options);
 if(issues.length) throw Error(issues[0].message);
 if(!shapes.length) throw Error("没有可导入的闭合轮廓");
 const reviewedDocument={...doc,labels:doc.labels.filter(l=>(Object.hasOwn(layerRules,l.layer)?layerRules[l.layer].role:"unknown")!=="ignore")};
 const resolved=shapes.map(s=>{const rule=resolveDrawingRule(s,layerRules,shapeRules);return { ...(rule.role==="pocket"?pocketGeometry(s,rule):{points:effectiveDrawingShape(s,rule).points}),e:{handle:s.id,layer:s.layer,...rule}};});
 if(resolved.reduce((count,s)=>count+s.points.length,0)>50_000) throw Error("加工区域展开后总顶点超过 50,000，请简化路径或分批导入");
 const project=buildDrawingProject(reviewedDocument,{...options,space},resolved);
 return {...project,drawingSource:doc,drawingMapping:{space,layerRules,shapeRules}};
}

export {suggestDrawingRoles} from './drawingSuggestions';
/** Upload UI policy; direct compiler defaults intentionally retain the legacy API. */
export function reviewLayerRules(doc:DrawingDocument,choices:{preset?:boolean;template?:DrawingRules;manual?:DrawingRules}={}):DrawingRules {
 const unknown=Object.fromEntries([...new Set([...doc.shapes.map(s=>s.layer),...doc.diagnostics.map(d=>d.layer)])].map(layer=>[layer,{role:'unknown' as const}]));
 return {...unknown,...(choices.preset?defaultDrawingRules(doc):{}),...choices.template,...choices.manual};
}
/** Apply the whole displayed batch form; absent machining fields mean clear, not preserve. */
export function batchDrawingRules(doc:DrawingDocument,ids:string[],layerRules:DrawingRules,shapeRules:DrawingRules,patch:DrawingRule):DrawingRules {
 const next={...shapeRules},selected=new Set(ids);
 const geometry=patch.role==='pocket'?patch.pocketGeometry??'area':undefined;
 const payload={...patch,pocketGeometry:geometry,depth:patch.role==='pocket'?patch.depth:undefined,slotWidth:geometry==='centerline'?patch.slotWidth:undefined};
 for(const shape of doc.shapes)if(selected.has(shape.id))next[shape.id]={...resolveDrawingRule(shape,layerRules,shapeRules),...payload};
 return next;
}

/** Explicit layer batches override figure settings within this space only. */
export function applyDrawingLayer(doc:DrawingDocument,space:string,layer:string,layerRules:DrawingRules,shapeRules:DrawingRules,patch:DrawingRule):DrawingRules {
 const ids=doc.shapes.filter(shape=>shape.space===space&&shape.layer===layer).map(shape=>shape.id);
 const next=batchDrawingRules(doc,ids,layerRules,shapeRules,patch);
 for(const issue of doc.diagnostics.filter(issue=>issue.space===space&&issue.layer===layer)){
  if(patch.role==='ignore')next[diagnosticRuleKey(issue)]={role:'ignore'};
  else delete next[diagnosticRuleKey(issue)];
 }
 return next;
}
export function groupDrawingIssues(issues:DrawingDiagnostic[]) {
 const groups=new Map<string,{id:string;layer:string;message:string;issues:DrawingDiagnostic[];shapeIds:string[]}>();
 for(const issue of issues){
  const groupable=!issue.code&&(issue.message.includes('用途未确认')||issue.message.includes('槽深'));
  const key=groupable?JSON.stringify([issue.space,issue.layer,issue.message]):issue.id;
  if(!groups.has(key))groups.set(key,{id:key,layer:issue.layer,message:issue.message,issues:[],shapeIds:[]});
  const group=groups.get(key)!;group.issues.push(issue);group.shapeIds=[...new Set([...group.shapeIds,...issue.shapeIds??[],...issue.shapeId?[issue.shapeId]:[]])];
 }
 return [...groups.values()];
}

/** One editing task owns its dependent geometric errors; counts share this grouping. */
export function groupDrawingReviewIssues(issues:DrawingDiagnostic[]) {
 const confirmingPurpose=issues.some(issue=>issue.id.startsWith('purpose-'));
 const groups=groupDrawingIssues(issues.filter(issue=>issue.severity==='blocking'&&(!confirmingPurpose||!['relationship-conflict','placement-conflict'].includes(issue.code??''))));
 const edits=groups.filter(group=>group.message.includes('用途未确认')||group.message.includes('槽深'));
 const owner=(group:typeof groups[number])=>edits.includes(group)?undefined:edits.find(edit=>edit.id!==group.id&&group.issues.every(issue=>
  !!issue.shapeId&&edit.shapeIds.includes(issue.shapeId)&&issue.code!=='relationship-conflict'&&issue.code!=='placement-conflict'
 ));
 return groups.filter(group=>!owner(group)).map(group=>({...group,issues:[...group.issues,...groups.filter(other=>owner(other)?.id===group.id).flatMap(other=>other.issues)]}));
}

/** Accountability is per source object; instance/chained IDs may legitimately repeat. */
export function drawingAccountability(doc:DrawingDocument,space:string,layerRules:DrawingRules,shapeRules:DrawingRules={},destinations:Record<string,string>={}) {
 const shapes=doc.shapes.filter(shape=>shape.space===space);
 return shapes.map(shape=>{
  const rule=resolveDrawingRule(shape,layerRules,shapeRules);
  let destination=rule.role==='ignore'?'已排除':rule.role==='unknown'?'待确认':rule.role==='stock'?'板框':rule.role==='outer'?destinations[shape.id]??'零件待生成':'所属零件待核对';
  if(rule.role==='hole'||rule.role==='pocket'){
   try{
    const geometry=rule.role==='pocket'?pocketGeometry(shape,rule):effectiveDrawingShape(shape,rule);
    const owners=shapes.filter(outer=>outer.id!==shape.id&&resolveDrawingRule(outer,layerRules,shapeRules).role==='outer'&&containsFeature(geometry.points,effectiveDrawingShape(outer,resolveDrawingRule(outer,layerRules,shapeRules)).points));
    if(owners.length===1)destination=`零件 ${owners[0].id}`;
   }catch{/* Invalid geometry remains an actionable issue. */}
  }
  return {shapeId:shape.id,sourceIds:[...shape.sourceIds],role:rule.role,destination};
 });
}

/** Explicit compatibility stock convention, always below current-file decisions. */
export function reviewShapeRules(doc:DrawingDocument,choices:{preset?:boolean;template?:DrawingRules;manual?:DrawingRules;shapes?:DrawingRules}={}):DrawingRules {
 const rules:DrawingRules={};
 if(choices.preset){
  const defaults=defaultDrawingRules(doc);
  const outer=doc.shapes.filter(shape=>defaults[shape.layer]?.role==='outer'&&shape.closed&&shape.valid&&validContour(shape.points));
  for(const frame of outer){
   if(Object.hasOwn(choices.manual??{},frame.layer)||Object.hasOwn(choices.template??{},frame.layer))continue;
   if(outer.some(other=>other.id!==frame.id&&other.space===frame.space&&containsFeature(frame.points,other.points)))continue;
   if(!outer.some(other=>other.id!==frame.id&&other.space===frame.space&&containsFeature(other.points,frame.points)))continue;
   try{stockAxes(frame.points);rules[frame.id]={...defaults[frame.layer],role:'stock'};}catch{/* Invalid frames require manual review. */}
  }
 }
 return {...rules,...choices.shapes};
}
