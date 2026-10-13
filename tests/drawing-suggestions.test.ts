import {expect,it,vi} from 'vitest';
import {createElement,isValidElement,type ReactElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as review from '../src/core/drawingReview';
import * as templates from '../src/core/drawingTemplates';
import {DrawingReview} from '../src/components/DrawingReview';
import {ImportPreview} from '../src/components/ImportPreview';
import {workbench} from '../src/store';
import type {DrawingDocument,DrawingShape,DrawingRules,DrawingRule} from '../src/core/drawingTypes';
const shape=(id:string,layer:string,x=0,y=0,w=10,h=10):DrawingShape=>({id,layer,space:'Model',entityType:'LWPOLYLINE',closed:true,valid:true,sourceIds:[id],points:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]});
const doc=(shapes:DrawingShape[]):DrawingDocument=>({name:'unseen',unitKnown:true,importInfo:{sourceUnit:'毫米',scale:1,overridden:false},spaces:['Model'],shapes,labels:[],diagnostics:[]});
const api=()=>{expect(review).toHaveProperty('suggestDrawingRoles');return review.suggestDrawingRoles;};

it('counts one actionable task for purpose and geometric errors on the same figures',()=>{
 const d=doc([{...shape('a','mixed'),closed:false,valid:false,pathValid:true},shape('b','mixed')]);
 const groups=review.groupDrawingReviewIssues(review.drawingIssues(d,'Model',{}));
 expect(groups).toHaveLength(1);expect(groups[0].shapeIds).toEqual(['a','b']);
 expect(groups[0].issues.map(issue=>issue.id)).toContain('review-a');
});
it('finishes purpose confirmation before presenting dependent ownership checks without weakening validation',()=>{
 const d=doc([shape('owner','cut',0,0,100,100),shape('feature','slot',30,30)]);
 const rules={feature:{role:'pocket' as const,depth:3}};
 const issues=review.drawingIssues(d,'Model',{},rules);
 expect(issues.some(issue=>issue.code==='relationship-conflict')).toBe(true);
 expect(review.groupDrawingReviewIssues(issues)).toHaveLength(1);
 expect(review.groupDrawingReviewIssues(issues)[0].shapeIds).toEqual(['owner']);
 expect(()=>review.compileDrawing(d,{mode:'parts'},{},rules)).toThrow();
 expect(review.groupDrawingReviewIssues(review.drawingIssues(d,'Model',{cut:{role:'ignore'}},rules))[0].issues[0].code).toBe('relationship-conflict');
});
it('explicit layer confirmation updates prior individual rules only in the current space and preserves provenance',()=>{
 const d=doc([shape('a','mixed'),shape('b','other'),{...shape('c','mixed'),space:'Paper'}]);
 d.diagnostics=[{id:'unsupported',layer:'mixed',space:'Model',severity:'blocking',message:'unsupported'},{id:'paper-unsupported',layer:'mixed',space:'Paper',severity:'blocking',message:'unsupported'}];
 const before={a:{role:'pocket' as const,depth:3,geometrySource:'original' as const},b:{role:'hole' as const},c:{role:'stock' as const}};
 const next=review.applyDrawingLayer(d,'Model','mixed',{},before,{role:'ignore'});
 expect(next.a).toMatchObject({role:'ignore',geometrySource:'original'});expect(next.a.depth).toBeUndefined();
 expect(next.b).toEqual({role:'hole'});expect(next.c).toEqual({role:'stock'});
 expect(next['@diagnostic/unsupported']).toEqual({role:'ignore'});expect(next['@diagnostic/paper-unsupported']).toBeUndefined();
 expect(before.a.role).toBe('pocket');
});
type ReviewElement=ReactElement<{children?:ReactNode;className?:string;onClick?:()=>void}>;
function reviewElements(node:ReactNode):ReviewElement[]{
 if(Array.isArray(node))return node.flatMap(reviewElements);
 if(!isValidElement<{children?:ReactNode}>(node))return [];
 return [node as ReviewElement,...reviewElements(node.props.children)];
}
function pendingFields(node:ReactNode){return reviewElements(node).find(element=>typeof element.type==='function'&&'rule' in element.props&&'onChange' in element.props) as ReactElement<{rule:DrawingRule;onChange:(rule:DrawingRule)=>void}>;}
function confirmPending(node:ReactNode){return reviewElements(node).find(element=>element.type==='button'&&JSON.stringify(element.props.children).includes('确认设置'))!;}
it('labels the selected normalized geometry consistently after switching away from centerline pocket',()=>{
 const normalized=shape('returned','mixed');
 normalized.normalization={original:{closed:false,valid:false,pathValid:true,points:[...normalized.points,{x:.0009,y:0}]},endpointChanges:[],repairLog:[]};
 const document=doc([normalized]);
 const centerline={role:'pocket' as const,pocketGeometry:'centerline' as const,slotWidth:2,depth:3};
 const selectedMarkup=(shapeRules:DrawingRules)=>{
  let selected=false;
  function Capture(){
   const tree=DrawingReview({document,space:'Model',setSpace:()=>{},layerRules:{},shapeRules,setLayerRule:()=>{},setShapeRule:()=>{},issues:[]});
   if(!selected){selected=true;const hit=reviewElements(tree).find(element=>element.props.className==='drawing-review-hit')!;(hit.props.onClick as (event:{shiftKey:boolean})=>void)({shiftKey:false});}
   return tree;
  }
  return renderToStaticMarkup(createElement(Capture));
 };
 expect(selectedMarkup({returned:centerline})).toContain('当前使用原始几何');
 expect(selectedMarkup({returned:{...centerline,role:'outer'}})).toContain('当前使用归一化几何');
 expect(selectedMarkup({returned:{...centerline,role:'outer',geometrySource:'original'}})).toContain('当前使用原始几何');
});
it('keeps different same-layer stock suggestion cards distinct and applies their own IDs after accepting one',()=>{
 const document=doc([shape('board-two','0',0,0,100,100),shape('board-three','0',200,0,100,100),
  shape('a','CUT',10,10),shape('b','CUT',40,40),shape('c','CUT',210,10),shape('d','CUT',240,40),shape('e','CUT',270,70)]);
 const shapeRules:DrawingRules=Object.fromEntries(['a','b','c','d','e'].map(id=>[id,{role:'outer' as const}])),accepted:string[]=[];
 const cards=()=>{
  let tree:ReactNode;
  function Capture(){tree=DrawingReview({document,space:'Model',setSpace:()=>{},layerRules:{},shapeRules,setLayerRule:()=>{},setShapeRule:(id,rule)=>{accepted.push(id);shapeRules[id]=rule;},issues:review.drawingIssues(document,'Model',{},shapeRules)});return tree;}
  renderToStaticMarkup(createElement(Capture));
  return reviewElements(tree).filter(element=>element.props.className==='drawing-review-suggestion'&&renderToStaticMarkup(element).includes('板框候选'));
 };
 const before=cards();expect(before).toHaveLength(2);
 expect(new Set(before.map(card=>card.key)).size).toBe(2);
 expect(renderToStaticMarkup(before[0])).toContain('包含 2 个');expect(renderToStaticMarkup(before[1])).toContain('包含 3 个');
 const apply=(card:ReviewElement)=>{
  let phase=0;
  function Apply(){
   const tree=DrawingReview({document,space:'Model',setSpace:()=>{},layerRules:{},shapeRules,setLayerRule:()=>{},setShapeRule:(id,rule)=>{accepted.push(id);shapeRules[id]=rule;},issues:review.drawingIssues(document,'Model',{},shapeRules)});
   const target=reviewElements(tree).find(element=>element.key===card.key)!;
   if(phase===0){phase++;pendingFields(target).props.onChange({role:'stock'});}
   else if(phase===1){phase++;confirmPending(target).props.onClick!();}
   return tree;
  }
  renderToStaticMarkup(createElement(Apply));expect(phase).toBe(2);
 };
 apply(before[0]);expect(accepted).toEqual(['board-two']);expect(shapeRules['board-two'].role).toBe('stock');
 const after=cards();expect(after).toHaveLength(1);expect(after[0].key).toBe(before[1].key);expect(renderToStaticMarkup(after[0])).toContain('包含 3 个');
 apply(after[0]);expect(accepted).toEqual(['board-two','board-three']);expect(shapeRules['board-three'].role).toBe('stock');expect(cards()).toHaveLength(0);
});
it('keeps a geometric suggestion and its full form in the same pending task, requiring depth before confirmation',()=>{
 const document=doc([shape('owner','arbitrary',0,0,100,100),shape('slot','POCKET_DEPTH18',30,30)]),shapeRules:DrawingRules={owner:{role:'outer'}};
 let phase=0;
 function Capture(){
  const tree=DrawingReview({document,space:'Model',setSpace:()=>{},layerRules:{},shapeRules,setLayerRule:()=>{},setShapeRule:(id,rule)=>{shapeRules[id]=rule;},issues:review.drawingIssues(document,'Model',{},shapeRules)});
  if(phase>=3)return tree;
  const tasks=reviewElements(tree).filter(element=>element.props.className==='drawing-review-task');expect(tasks).toHaveLength(1);
  const task=tasks[0];expect(reviewElements(task).filter(element=>element.props.className==='drawing-review-suggestion')).toHaveLength(1);
  const fields=pendingFields(task);
  if(phase===0){phase++;fields.props.onChange({role:'pocket'});}
  else if(phase===1){
   expect((confirmPending(task) as ReactElement<{disabled:boolean}>).props.disabled).toBe(true);expect(shapeRules.slot).toBeUndefined();
   phase++;fields.props.onChange({...fields.props.rule,depth:3});
  }else if(phase===2){phase++;confirmPending(task).props.onClick!();}
  return tree;
 }
 const html=renderToStaticMarkup(createElement(Capture));expect(html).not.toContain('用途建议 · 需明确应用');expect(html).not.toContain('drawing-review-suggestions');
 expect(phase).toBe(3);expect(shapeRules.slot).toMatchObject({role:'pocket',depth:3});expect(shapeRules.owner).toEqual({role:'outer'});
 expect(review.drawingIssues(document,'Model',{},shapeRules).some(issue=>issue.id==='depth-slot')).toBe(false);
});
it('keeps a conflicting recommendation in its pending task without offering an overwrite',()=>{
 const document=doc([shape('outer','mixed',0,0,100,100),shape('inner','mixed',10,10)]),layerRules={mixed:{role:'outer' as const}};
 let tree:ReactNode;
 function Capture(){tree=DrawingReview({document,space:'Model',setSpace:()=>{},layerRules,shapeRules:{},setLayerRule:()=>{},setShapeRule:()=>{},issues:review.drawingIssues(document,'Model',layerRules)});return tree;}
 renderToStaticMarkup(createElement(Capture));
 const suggestions=reviewElements(tree).filter(element=>element.props.className==='drawing-review-suggestion');
 expect(suggestions).toHaveLength(1);
 const task=reviewElements(tree).find(element=>element.props.className==='drawing-review-task'&&reviewElements(element).includes(suggestions[0]));
 expect(task).toBeDefined();
 expect(renderToStaticMarkup(suggestions[0])).toContain('与当前用途冲突');
 expect(renderToStaticMarkup(suggestions[0])).not.toContain('设为');
 expect(layerRules.mixed.role).toBe('outer');
});
it('starts every generic uploaded layer unknown, with consciously selected preset preserving legacy behavior',()=>{
 expect(review).toHaveProperty('reviewLayerRules');const d=doc(['0','CUT_18MM','HOLE','POCKET_DEPTH12'].map((l,i)=>shape(String(i),l,i*20)));
 expect(Object.values(review.reviewLayerRules(d,{})).map(v=>v.role)).toEqual(['unknown','unknown','unknown','unknown']);
 expect(review.reviewLayerRules(d,{preset:true}).CUT_18MM).toEqual({role:'outer',thickness:18});
});
it('enforces explicit layer over applied template over preset and individual over layer',()=>{
 expect(review).toHaveProperty('reviewLayerRules');const d=doc([shape('a','CUT')]);
 expect(review.reviewLayerRules(d,{preset:true,template:{CUT:{role:'hole'}},manual:{CUT:{role:'ignore'}}}).CUT.role).toBe('ignore');
 expect(review.resolveDrawingRule(d.shapes[0],review.reviewLayerRules(d,{preset:true,template:{CUT:{role:'hole'}}}),{a:{role:'pocket',depth:3}}).role).toBe('pocket');
});
it('configures open grooves completely inside the pending card before applying, without opening a second editor',()=>{
 const document=doc([{...shape('a','custom'),closed:false,valid:false,pathValid:true,points:[{x:20,y:20},{x:40,y:20}]},shape('b','other',60)]);
 const shapeRules:DrawingRules={a:{role:'unknown',geometrySource:'original'},b:{role:'hole'}};
 let tree:ReactNode,phase=0;
 function Capture(){
  tree=DrawingReview({document,space:'Model',setSpace:()=>{},layerRules:{},shapeRules,setLayerRule:()=>{},setShapeRule:(id,rule)=>{shapeRules[id]=rule;},issues:review.drawingIssues(document,'Model',{},shapeRules)});
  const task=reviewElements(tree).find(element=>element.props.className==='drawing-review-task')!;
  const fields=pendingFields(task);
  expect(fields).toBeDefined();
  if(phase===0){phase++;fields.props.onChange({...fields.props.rule,role:'pocket'});}
  else if(phase===1){
   expect(shapeRules.a.role).toBe('unknown');expect(fields.props.rule.role).toBe('pocket');
   phase++;fields.props.onChange({...fields.props.rule,pocketGeometry:'centerline',slotWidth:4,depth:3});
  }else if(phase===2){
   expect(fields.props.rule.slotWidth).toBe(4);
   const topEditor=reviewElements(tree).find(element=>element.props.className==='drawing-review-edit-selection');expect(topEditor).toBeUndefined();
   phase++;confirmPending(task).props.onClick!();
  }
  return tree;
 }
 renderToStaticMarkup(createElement(Capture));
 expect(phase).toBe(3);expect(shapeRules.a).toMatchObject({role:'pocket',geometrySource:'original',pocketGeometry:'centerline',slotWidth:4,depth:3});
 expect(shapeRules.b).toEqual({role:'hole'});
 expect(review.drawingIssues(document,'Model',{},shapeRules).some(issue=>issue.id==='depth-a'||issue.id==='review-a'||issue.id==='purpose-a')).toBe(false);
});
it('never infers purpose from layer words or numbers in generic drawings',()=>{
 const suggestions=api()(doc(['CUT_18MM','HOLE_12','POCKET_DEPTH18','INSIDE','SCUTTLE'].map((l,i)=>shape(String(i),l,i*20))),'Model',{});
 expect(suggestions).toEqual([]);
});
it('suggests rectangular stock only around multiple disjoint confirmed outer contours',()=>{
 const suggest=api();const stock=shape('s','0',0,0,100,100),a=shape('a','OUTSIDE',10,10,10,10),b=shape('b','OUTSIDE',40,40,10,10);
 expect(suggest(doc([stock,a,b]),'Model',{}).find(s=>s.shapeId==='s')).toBeUndefined();
 const rules={a:{role:'outer' as const},b:{role:'outer' as const}};
 expect(suggest(doc([stock,a]),'Model',{},rules).find(s=>s.shapeId==='s')).toBeUndefined();
 expect(suggest(doc([stock,a,b]),'Model',{},rules).find(s=>s.shapeId==='s')?.roles).toEqual(['stock']);
 const overlap=shape('b','OUTSIDE',15,15,10,10);expect(suggest(doc([stock,a,overlap]),'Model',{},rules).find(s=>s.shapeId==='s')).toBeUndefined();
});
it('applies the complete pending batch only to unresolved contours, retaining confirmed objects and geometry source',()=>{
 const document=doc([shape('a','custom'),shape('b','custom',20),shape('c','custom',40)]);
 const shapeRules:DrawingRules={a:{role:'unknown',geometrySource:'original'},c:{role:'hole'}};
 let phase=0;
 function Capture(){
  const tree=DrawingReview({document,space:'Model',setSpace:()=>{},layerRules:{},shapeRules,setLayerRule:()=>{},setShapeRule:(id,rule)=>{shapeRules[id]=rule;},issues:review.drawingIssues(document,'Model',{},shapeRules)});
  const task=reviewElements(tree).find(element=>element.props.className==='drawing-review-task')!;
  if(phase===0){phase++;pendingFields(task).props.onChange({role:'pocket',depth:3});}
  else if(phase===1){phase++;confirmPending(task).props.onClick!();}
  return tree;
 }
 renderToStaticMarkup(createElement(Capture));expect(phase).toBe(2);
 expect(shapeRules.a).toMatchObject({role:'pocket',depth:3,geometrySource:'original'});
 expect(shapeRules.b).toMatchObject({role:'pocket',depth:3});expect(shapeRules.c).toEqual({role:'hole'});
 expect(review.drawingIssues(document,'Model',{},shapeRules).some(issue=>issue.id.startsWith('depth-'))).toBe(false);
});
it('inside confirmed outer means an internal candidate with hole/pocket choices; stock alone never means a hole',()=>{
 const suggest=api(),d=doc([shape('o','0',0,0,100,100),shape('i','0',10,10)]);
 const inside=suggest(d,'Model',{'0':{role:'unknown'}},{o:{role:'outer'}}).find(s=>s.shapeId==='i');expect(inside).toMatchObject({label:'内部加工候选',roles:['hole','pocket']});
 expect(suggest(d,'Model',{}, {o:{role:'stock'}}).find(s=>s.shapeId==='i')).toBeUndefined();
});
it('uses full contour containment instead of a bounding box or vertex-only assumption',()=>{
 const suggest=api();const concave={...shape('o','0'),points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:60,y:100},{x:60,y:30},{x:40,y:30},{x:40,y:100},{x:0,y:100}]};
 const bridge=shape('b','0',20,50,60,10);expect(suggest(doc([concave,bridge]),'Model',{}, {o:{role:'outer'}}).find(s=>s.shapeId==='b')).toBeUndefined();
});
it('does not call a valid manual mixed-layer override a conflict based only on its layer name',()=>{
 expect(api()(doc([shape('o','CUT')]),'Model',{CUT:{role:'hole'}})).toEqual([]);
});
it('surfaces geometric nesting conflict while preserving explicit confirmed rules',()=>{
 const d=doc([shape('o','mixed',0,0,100,100),shape('i','mixed',10,10)]),rules={mixed:{role:'outer' as const}};
 expect(api()(d,'Model',rules).find(s=>s.shapeId==='i')).toMatchObject({roles:['hole','pocket'],conflict:true});
 expect(review.drawingIssues(d,'Model',rules).some(issue=>issue.code==='relationship-conflict')).toBe(true);expect(rules.mixed.role).toBe('outer');
});
it('groups repeated unknown/depth issues by exact message and layer, preserving all IDs',()=>{
 expect(review).toHaveProperty('groupDrawingIssues');const d=doc(Array.from({length:42},(_,i)=>shape(String(i),'OUTSIDE',i*20)));const issues=review.drawingIssues(d,'Model',{});
 const groups=review.groupDrawingIssues(issues);expect(groups).toHaveLength(1);expect(groups[0].shapeIds).toHaveLength(42);expect(groups[0].issues).toEqual(issues);
});
it('batch edits selected mixed-layer objects only, retaining unrelated overrides and geometry source',()=>{
 expect(review).toHaveProperty('batchDrawingRules');const d=doc([shape('a','mix'),shape('b','mix'),shape('c','other')]);
 const before={b:{role:'hole' as const},a:{role:'unknown' as const,geometrySource:'original' as const}};
 const result=review.batchDrawingRules(d,['a','c'],{},before,{role:'pocket',depth:6,pocketGeometry:'centerline',slotWidth:3});
 expect(result.b).toEqual({role:'hole'});expect(result.a).toMatchObject({role:'pocket',depth:6,geometrySource:'original'});expect(result.c).toMatchObject({role:'pocket',slotWidth:3});expect(before.a.role).toBe('unknown');
});
it('saves layer configuration without geometry source, shape IDs, or diagnostics',()=>{
 expect(templates).toHaveProperty('templateLayerRules');const saved=templates.templateLayerRules({mixed:{role:'pocket',depth:3,geometrySource:'original'},'@diagnostic/id':{role:'ignore'}});
 expect(saved).toEqual({mixed:{role:'pocket',depth:3}});expect(templates.parseDrawingTemplates(JSON.stringify([{name:'clean',rules:saved}]))).toHaveLength(1);
 expect(templates.parseDrawingTemplates(JSON.stringify([{name:'handles',rules:{mixed:{role:'outer',shapeIds:['a']}}}]))).toEqual([]);
});
it('collects geometry and process depth issues for the same invalid shape',()=>{
 const d=doc([{...shape('x','p'),closed:false,valid:false,pathValid:false}]);expect(review.drawingIssues(d,'Model',{p:{role:'pocket'}}).filter(v=>v.shapeId==='x')).toHaveLength(2);
});
it('renders 42 unknown objects as one actionable group with visible checkboxes and accountability',()=>{
 const d=doc(Array.from({length:42},(_,i)=>shape(String(i),'mixed',i*20))),issues=review.drawingIssues(d,'Model',{});
 const html=renderToStaticMarkup(createElement(DrawingReview,{document:d,space:'Model',setSpace:()=>{},layerRules:{},shapeRules:{},setLayerRule:()=>{},setShapeRule:()=>{},issues}));
 expect(html).toContain('42 个图形');expect(html.match(/type="checkbox"/g)).toHaveLength(42);expect(html).toContain('待确认');expect(html).toContain('全部图形');
});
it('generic upload UI keeps CUT and 0 unconfirmed, provides an explicit configuration and next-step action without importing unresolved figures',()=>{
 const d=doc([shape('s','0',0,0,100,100),shape('a','CUT',10,10),shape('b','CUT',50,50)]);const snapshot=vi.spyOn(workbench,'getInitialState').mockReturnValue({...workbench.getState(),drawingDraft:d,draft:null});
 try {const html=renderToStaticMarkup(createElement(ImportPreview,{close:()=>{}}));expect(html).toContain('图层设置模板');expect(html).toContain('aria-label="图层设置模板"');expect(html).toContain('role="combobox"');expect(html).toContain('继续确认图形');expect(html).not.toContain('张板材');expect(html).toContain('待确认 2 组');}finally{snapshot.mockRestore();}
});

it('reports unknown purpose as well as invalid geometry without losing either problem',()=>{
 const d=doc([{...shape('a','mixed'),closed:false,valid:false}]);const issues=review.drawingIssues(d,'Model',{});expect(issues.some(i=>i.message.includes('用途未确认'))).toBe(true);expect(issues.some(i=>i.message.includes('轮廓未闭合'))).toBe(true);
});
it('shows each feature destination and repeated chain source IDs without aggregating away provenance',()=>{
 expect(review).toHaveProperty('drawingAccountability');const d=doc([shape('o','cut',0,0,100,100),{...shape('a','inside',10,10),sourceIds:['chain']},{...shape('b','inside',40,40),sourceIds:['chain']}]);
 expect(review.drawingAccountability(d,'Model',{cut:{role:'outer'},inside:{role:'pocket',depth:3}}, {}, {o:'待放置零件'})).toMatchObject([{shapeId:'o',role:'outer',destination:'待放置零件'}, {shapeId:'a',sourceIds:['chain'],destination:'零件 o'}, {shapeId:'b',sourceIds:['chain'],destination:'零件 o'}]);
});
it('keeps exact-message/layer issue groups distinct and preserves related placement IDs',()=>{
 const d=doc([shape('a','p1'),shape('b','p2')]);const issues=review.drawingIssues(d,'Model',{p1:{role:'pocket'},p2:{role:'pocket'}});expect(review.groupDrawingIssues(issues).filter(g=>g.message.includes('槽深'))).toHaveLength(2);
 const relationship={id:'relationship',layer:'p1',space:'Model',severity:'blocking' as const,code:'placement-conflict' as const,shapeId:'a',shapeIds:['a','s'],message:'板框边界冲突'};
 expect(review.groupDrawingIssues([relationship])[0].shapeIds).toEqual(['a','s']);
});
it('reports template matching and skipped explicit layers while preserving prior templates and manual rules',()=>{
 expect(templates).toHaveProperty('applyDrawingTemplate');const manual={CUT:{role:'hole' as const}},template={CUT:{role:'outer' as const},Groove:{role:'pocket' as const,depth:3},absent:{role:'ignore' as const}};
 const applied=templates.applyDrawingTemplate(template,['CUT','Groove','unmatched'],manual,{old:{role:'stock'}});
 expect(applied).toEqual({matched:1,skipped:1,rules:{old:{role:'stock'},Groove:{role:'pocket',depth:3}}});expect(manual).toEqual({CUT:{role:'hole'}});
});
it('recomputes only preset source-unit depths and retains explicit mm layer/single/template edits on reread',()=>{
 const d=doc([shape('p','POCKET_DEPTH12')]),scaled={...d,importInfo:{...d.importInfo,scale:10}};
 expect(review.reviewLayerRules(scaled,{preset:true}).POCKET_DEPTH12.depth).toBe(120);
 expect(review.reviewLayerRules(scaled,{preset:true,template:{POCKET_DEPTH12:{role:'pocket',depth:2}}}).POCKET_DEPTH12.depth).toBe(2);
 expect(review.reviewLayerRules(scaled,{preset:true,manual:{POCKET_DEPTH12:{role:'pocket',depth:3}}}).POCKET_DEPTH12.depth).toBe(3);
 expect(review.resolveDrawingRule(scaled.shapes[0],review.reviewLayerRules(scaled,{preset:true}),{p:{role:'pocket',depth:4}}).depth).toBe(4);
});
it('keeps geometric suggestions identical when every layer is renamed',()=>{
 const d=doc([shape('s','0',0,0,100,100),shape('a','SIDE_CUT_OUTSIDE',10,10,30,30),shape('b','CUT_OUTSIDE',60,60,20,20),shape('f','ROUTING_CUT_INSIDE_18MM',15,15,5,5),shape('p','CUT_POCKET',65,65,5,5)]);
 const confirmed={a:{role:'outer' as const},b:{role:'outer' as const}};
 const suggestions=api()(d,'Model',{},confirmed);
 expect(suggestions.map(s=>[s.shapeId,s.roles])).toEqual([['s',['stock']],['f',['hole','pocket']],['p',['hole','pocket']]]);
 expect(api()({...d,shapes:d.shapes.map((s,i)=>({...s,layer:`任意图层${i}`}))},'Model',{},confirmed)).toEqual(suggestions);
});
it('uploaded sample compatibility derives stock preset below explicit single/layer/template rules',()=>{
 expect(review).toHaveProperty('reviewShapeRules');const d=doc([shape('s','0',0,0,100,100),shape('a','CUT',10,10,20,20),shape('b','CUT',60,60,20,20)]);
 expect(review.reviewShapeRules(d,{preset:true})).toEqual({s:{role:'stock'}});
 expect(review.compileDrawing(d,{deferThicknessCheck:true},review.reviewLayerRules(d,{preset:true}),review.reviewShapeRules(d,{preset:true})).sheets).toHaveLength(1);
 expect(review.reviewShapeRules(d,{preset:true,manual:{'0':{role:'outer'}}})).toEqual({});
 expect(review.reviewShapeRules(d,{preset:true,template:{'0':{role:'ignore'}}})).toEqual({});
 expect(review.reviewShapeRules(d,{preset:true,shapes:{s:{role:'outer'}}})).toEqual({s:{role:'outer'}});
});
it('applies displayed closed-area batch defaults over an existing centerline while preserving provenance and unselected rules',()=>{
 const d=doc([shape('selected','mixed'),shape('untouched','mixed',30,30)]);
 const before={selected:{role:'pocket' as const,pocketGeometry:'centerline' as const,slotWidth:4,depth:1,geometrySource:'original' as const},untouched:{role:'pocket' as const,pocketGeometry:'centerline' as const,slotWidth:2,depth:5}};
 const result=review.batchDrawingRules(d,['selected'],{},before,{role:'pocket',depth:3});
 expect(result.selected).toMatchObject({role:'pocket',pocketGeometry:'area',depth:3,geometrySource:'original'});expect(result.selected.slotWidth).toBeUndefined();
 expect(result.untouched).toEqual(before.untouched);expect(before.selected).toMatchObject({pocketGeometry:'centerline',slotWidth:4,depth:1});
});
it('blank batch depth and centerline width deliberately clear prior machining values and regenerate validation',()=>{
 const d=doc([{...shape('selected','mixed'),closed:false,valid:false,pathValid:true,points:[{x:0,y:0},{x:10,y:0}]}]);
 const before={selected:{role:'pocket' as const,pocketGeometry:'centerline' as const,slotWidth:4,depth:1,geometrySource:'original' as const}};
 const result=review.batchDrawingRules(d,['selected'],{},before,{role:'pocket',pocketGeometry:'centerline'});
 expect(result.selected.slotWidth).toBeUndefined();expect(result.selected.depth).toBeUndefined();expect(result.selected.geometrySource).toBe('original');
 const issues=review.drawingIssues(d,'Model',{},result);expect(issues.some(issue=>issue.message.includes('槽深'))).toBe(true);expect(issues.some(issue=>issue.message.includes('槽宽'))).toBe(true);
});
it('changing a batch role away from pocket clears hidden pocket geometry and machining fields',()=>{
 const d=doc([shape('a','mixed')]);const before={a:{role:'pocket' as const,pocketGeometry:'centerline' as const,depth:2,slotWidth:3,geometrySource:'original' as const}};
 const result=review.batchDrawingRules(d,['a'],{},before,{role:'hole',pocketGeometry:'centerline',depth:2,slotWidth:3});
 expect(result.a).toMatchObject({role:'hole',geometrySource:'original'});expect(result.a.pocketGeometry).toBeUndefined();expect(result.a.depth).toBeUndefined();expect(result.a.slotWidth).toBeUndefined();
});

it('keeps CAD separate from a task-first operation panel and uses plain figure actions',()=>{
 const d=doc([shape('a','mixed'),shape('b','mixed',30,30)]);
 const html=renderToStaticMarkup(createElement(DrawingReview,{document:d,space:'Model',setSpace:()=>{},layerRules:{},shapeRules:{},setLayerRule:()=>{},setShapeRule:()=>{},issues:review.drawingIssues(d,'Model',{})}));
 expect(html).toContain('aria-label="CAD 图纸"');expect(html).toContain('aria-label="导入操作区"');
 expect(html.indexOf('确认图形')).toBeLessThan(html.indexOf('全部图形'));
 expect(html).toContain('查看这 2 个图形');expect(html).not.toContain('对象与去向');expect(html).not.toContain('>定位<');
});

it('keeps compilation errors visible instead of announcing readiness after review',()=>{
 const d=doc([shape('a','mixed')]);
 const html=renderToStaticMarkup(createElement(DrawingReview,{document:d,space:'Model',setSpace:()=>{},layerRules:{mixed:{role:'ignore'}},shapeRules:{},setLayerRule:()=>{},setShapeRule:()=>{},issues:[],parameters:'parameters',unavailableReason:'没有可导入的闭合轮廓'}));
 expect(html).toContain('role="alert">没有可导入的闭合轮廓');expect(html).not.toContain('图形用途已确认');expect(html).not.toContain('继续填写板厚与材质');
});
