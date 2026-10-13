import type { DrawingDocument, DrawingRole, DrawingRule, DrawingRules } from "./drawingTypes";
import { resolveDrawingRule } from "./drawingReview";
export type MappingTemplate = { name: string; rules: DrawingRules };

const roles: DrawingRole[] = ["unknown", "outer", "hole", "pocket", "stock", "ignore"];

export function isValidDrawingRule(value: unknown): value is DrawingRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rule = value as Record<string, unknown>;
  return Object.hasOwn(rule, "role") && roles.some(role => role === rule.role)
    && Object.keys(rule).every(key => ["role", "depth", "thickness", "pocketGeometry", "slotWidth"].includes(key))
    && (rule.pocketGeometry===undefined || ["area","centerline","close-boundary"].includes(rule.pocketGeometry as string))
    && [rule.depth, rule.thickness,rule.slotWidth].every(number => number === undefined
      || (typeof number === "number" && Number.isFinite(number) && number > 0));
}

/** Browser storage is untrusted. Restore configuration only, never drawing data. */
export function parseDrawingTemplates(raw: string | null): MappingTemplate[] {
  if (!raw || raw.length > 500_000) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed) || parsed.length > 100) return [];
  const templates: MappingTemplate[] = [];
  for (const value of parsed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 80
      || !item.rules || typeof item.rules !== "object" || Array.isArray(item.rules)) continue;
    const entries = Object.entries(item.rules);
    if (entries.length > 2_000 || entries.some(([layer, rule]) => layer.length > 1_000 || !isValidDrawingRule(rule))) continue;
    const rules: DrawingRules = Object.create(null);
    for (const [layer, value] of entries) {
      const rule = value as DrawingRule;
      rules[layer] = { role: rule.role };
      if (rule.pocketGeometry!==undefined) rules[layer].pocketGeometry=rule.pocketGeometry;
      if (rule.slotWidth!==undefined) rules[layer].slotWidth=rule.slotWidth;
      if (Object.hasOwn(rule, "depth") && rule.depth !== undefined) rules[layer].depth = rule.depth;
      if (Object.hasOwn(rule, "thickness") && rule.thickness !== undefined) rules[layer].thickness = rule.thickness;
    }
    templates.push({ name: item.name, rules });
  }
  return templates;
}

/** Save only reusable layer configuration; geometry provenance belongs to this file. */
export function templateLayerRules(layerRules:DrawingRules):DrawingRules {
 const rules:DrawingRules=Object.create(null);
 for(const [layer,value] of Object.entries(layerRules)){
  if(layer.startsWith('@diagnostic/'))continue;
  const {geometrySource:_geometry,...rule}=value;
  rules[layer]={...rule};
 }
 return rules;
}

export function applyDrawingTemplate(template:DrawingRules,layers:string[],manual:DrawingRules,previous:DrawingRules={}) {
 const rules={...previous};let matched=0,skipped=0;
 for(const layer of new Set(layers))if(Object.hasOwn(template,layer)){
  if(Object.hasOwn(manual,layer)){skipped++;continue;}
  rules[layer]={...template[layer]};matched++;
 }
 return {rules,matched,skipped};
}

/** Capture effective, uniform rules; never persist file-specific figure IDs or geometry. */
export function captureDrawingTemplate(document:DrawingDocument,space:string,layerRules:DrawingRules,shapeRules:DrawingRules) {
 const rules:DrawingRules=Object.create(null),skipped:Array<{layer:string;reason:string}>=[];
 const shapes=document.shapes.filter(shape=>shape.space===space);
 for(const layer of new Set(shapes.map(shape=>shape.layer))){
  const configurations=shapes.filter(shape=>shape.layer===layer).map(shape=>{
   const current=resolveDrawingRule(shape,layerRules,shapeRules);
   const rule:DrawingRule={role:current.role};
   if(current.thickness!==undefined)rule.thickness=current.thickness;
   if(current.role==='pocket'){
    rule.pocketGeometry=current.pocketGeometry??'area';
    if(current.depth!==undefined)rule.depth=current.depth;
    if(rule.pocketGeometry==='centerline' && current.slotWidth!==undefined)rule.slotWidth=current.slotWidth;
   }
   return rule;
  });
  let reason='';
  if(configurations.some(rule=>rule.role==='unknown'))reason='用途未确认';
  else if(configurations.some(rule=>!isValidDrawingRule(rule)||(rule.role==='pocket'&&(!rule.depth||(rule.pocketGeometry==='centerline'&&!rule.slotWidth)))))reason='槽参数未填完整';
  else if(configurations.some(rule=>JSON.stringify(rule)!==JSON.stringify(configurations[0])))reason='同层设置不一致';
  if(reason)skipped.push({layer,reason});else rules[layer]=configurations[0];
 }
 return {rules,skipped};
}
