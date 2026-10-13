import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DrawingDiagnostic, DrawingDocument, DrawingRole, DrawingRule, DrawingRules, DrawingShape } from "../core/drawingTypes";
import { resolveDrawingRule, diagnosticRuleKey, suggestDrawingRoles, groupDrawingReviewIssues, batchDrawingRules, drawingAccountability, type PlacementRule } from "../core/drawingReview";
import { pocketGeometry } from "../core/drawingPockets";
import { effectiveDrawingShape } from "../core/drawingNormalization";
import { bounds } from "../core/geometry";
import "./drawingReview.css";
import { Select } from "./Select";

const roles: { value: DrawingRole; label: string }[] = [
  { value: "unknown", label: "未确认" }, { value: "outer", label: "零件外轮廓" },
  { value: "hole", label: "通孔" }, { value: "pocket", label: "铣槽" },
  { value: "stock", label: "板框" }, { value: "ignore", label: "忽略" },
];
function RuleFields({ rule, onChange, label }: { rule: DrawingRule; onChange: (rule: DrawingRule) => void; label: string }) {
  return <div className="drawing-review-rule-fields">
    <label><span>用途</span><Select aria-label={`${label}用途`} value={rule.role} options={roles}
      onChange={value => onChange({ ...rule, role: value as DrawingRole })} /></label>
    {rule.role === "pocket" && <>
    <label className="drawing-review-geometry-choice"><span>槽的画法</span><Select aria-label={`${label}槽的画法`} value={rule.pocketGeometry ?? "area"}
      options={[{value:"area",label:"闭合区域"},{value:"centerline",label:"中心路径（圆头槽）"},{value:"close-boundary",label:"连接两端成区域"}]}
      onChange={value => onChange({ ...rule, pocketGeometry: value as DrawingRule["pocketGeometry"] })} /></label>
    {rule.pocketGeometry === "centerline" && <label><span>槽宽</span><div className="drawing-review-unit">
      <input aria-label={`${label}槽宽（mm）`} type="number" min="0.001" step="any" placeholder="填写槽宽" value={rule.slotWidth ?? ""}
        onChange={event => onChange({ ...rule, slotWidth: Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : undefined })} /><span>mm</span>
    </div></label>}
    <label><span>槽深</span><div className="drawing-review-unit">
      <input aria-label={`${label}铣槽深度（mm）`} type="number" min="0.001" step="any" placeholder="填写深度"
        value={rule.depth ?? ""} onChange={event => {
          const depth = event.target.valueAsNumber;
          onChange({ ...rule, depth: Number.isFinite(depth) ? depth : undefined });
        }} /><span>mm</span>
    </div></label>
    {(rule.pocketGeometry === "centerline" || rule.pocketGeometry === "close-boundary") && <p className="drawing-review-rule-help drawing-review-note">{rule.pocketGeometry === "centerline" ? "按槽宽展开，端部为圆头。" : "两端以直线连接。"}</p>}
    </>}
  </div>;
}

function shapePath(shape: DrawingShape) {
  if (!shape.points.length || shape.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return "";
  return shape.points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ") + (shape.closed ? " Z" : "");
}

function FigureThumbnail({shapes}:{shapes:DrawingShape[]}) {
  const points=shapes.flatMap(shape=>shape.points).filter(point=>Number.isFinite(point.x)&&Number.isFinite(point.y));
  if(!points.length) return <span className="drawing-review-thumbnail">?</span>;
  const box=bounds(points), padding=Math.max(box.width,box.height,1)*.08;
  return <svg className="drawing-review-thumbnail" aria-label="待确认图形缩略图" viewBox={`${box.minX-padding} ${-box.maxY-padding} ${box.width+padding*2} ${box.height+padding*2}`}><g transform="scale(1 -1)">{shapes.map(shape=><path key={shape.id} d={shapePath(shape)} vectorEffect="non-scaling-stroke"/>)}</g></svg>;
}

export function DrawingReview({ document, space, setSpace, layerRules, shapeRules, setLayerRule, setShapeRule, setPlacementRule, destinations, issues, unitControls, configuration, status, resultPreview, parameters, summary, reviewRequest = 0, parameterRequest = 0, previewRequest, unavailableReason }: {
  document: DrawingDocument; space: string; setSpace: (space: string) => void;
  layerRules: DrawingRules; shapeRules: DrawingRules;
  setLayerRule: (layer: string, rule: DrawingRule) => void;
  setShapeRule: (id: string, rule: DrawingRule) => void;
  setPlacementRule?: (id: string, rule: PlacementRule) => void;
  destinations?: Record<string,string>;
  issues: DrawingDiagnostic[];
  unitControls?: ReactNode; configuration?: ReactNode; status?: ReactNode; resultPreview?: ReactNode; parameters?: ReactNode; summary?: ReactNode; reviewRequest?: number; parameterRequest?: number; previewRequest?: {shapeId:string;revision:number}; unavailableReason?: string;
}) {
  const [tab, setTab] = useState<"confirm" | "all" | "parameters">("confirm");
  useEffect(()=>{if(parameterRequest)setTab("parameters");},[parameterRequest]);
  const [previewMode,setPreviewMode]=useState<"source"|"result">("source");
  useEffect(()=>{if(!resultPreview)setPreviewMode("source");},[!!resultPreview]);
  const [appliedTasks,setAppliedTasks]=useState<Array<{ids:string[];layer:string;scope:string}>>([]);
  const [actionMessage,setActionMessage]=useState("");
  const [zoomSelected, setZoomSelected] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const handledParameterRequest = useRef(0);
  useEffect(()=>{
    if(tab!=="parameters" || parameterRequest<=handledParameterRequest.current)return;
    handledParameterRequest.current=parameterRequest;
    controls.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
  },[tab,parameterRequest]);
  const [selection, setSelection] = useState<{ layer: string; shapeId?: string; shapeIds?: string[] } | null>(null);
  const [pendingDrafts,setPendingDrafts] = useState<Record<string,DrawingRule>>({});
  useEffect(() => { setSelection(null); setZoomSelected(false); setPendingDrafts({}); setAppliedTasks([]); setActionMessage(""); }, [document, space]);
  const shapes = document.shapes.filter(shape => shape.space === space);
  useEffect(()=>{
    const shape=document.shapes.find(shape=>shape.id===previewRequest?.shapeId && shape.space===space);
    if(shape){setSelection({layer:shape.layer,shapeId:shape.id});setZoomSelected(true);}
  },[previewRequest,document,space]);
  const selectedIds=selection?.shapeIds??(selection?.shapeId?[selection.shapeId]:[]);
  const chooseSelection = (value: typeof selection) => {
    setSelection(value); setZoomSelected(true); setPreviewMode("source");
    if(tab === "parameters" && value?.shapeId) setTab("all");
    else if(tab === "confirm" && value?.shapeId && !issues.some(issue=>issue.shapeId===value.shapeId || issue.shapeIds?.includes(value.shapeId!))) setTab("all");
  };
  useEffect(() => { if(selection && tab==="all") editor.current?.scrollIntoView({block:"nearest"}); }, [selection,tab]);
  const toggleShape=(shape:DrawingShape,extend=true)=>{
    if(!extend){chooseSelection({layer:shape.layer,shapeId:shape.id});return;}
    const next=selectedIds.includes(shape.id)?selectedIds.filter(id=>id!==shape.id):[...selectedIds,shape.id];
    chooseSelection(next.length===1?{layer:shape.layer,shapeId:next[0]}:{layer:shape.layer,shapeIds:next});
  };
  const suggestions=useMemo(()=>suggestDrawingRoles(document,space,layerRules,shapeRules),[document,space,layerRules,shapeRules]);
  const suggestionGroups=[...new Set(suggestions.map(s=>JSON.stringify([s.label,s.basis,s.roles,s.conflict,shapes.find(shape=>shape.id===s.shapeId)?.layer])))].map(key=>{
    const matches=suggestions.filter(s=>JSON.stringify([s.label,s.basis,s.roles,s.conflict,shapes.find(shape=>shape.id===s.shapeId)?.layer])===key);
    return {...matches[0],groupId:key,shapeIds:matches.map(s=>s.shapeId),layer:shapes.find(shape=>shape.id===matches[0].shapeId)!.layer};
  });
  const accountability=drawingAccountability(document,space,layerRules,shapeRules,destinations);
  const labels = document.labels.filter(label => label.space === space);
  const grooveGeometry = useMemo(() => {
    const result = new Map<string, ReturnType<typeof pocketGeometry>>();
    for (const shape of document.shapes.filter(shape => shape.space === space)) {
      const rule = resolveDrawingRule(shape, layerRules, shapeRules);
      if (rule.role === "pocket") try { result.set(shape.id, pocketGeometry(shape, rule)); } catch { /* Validation is shown in the issue list. */ }
    }
    return result;
  }, [document, space, layerRules, shapeRules]);
  const diagnostics = useMemo(() => {
    const byId = new Map(document.diagnostics.filter(issue => !(issue.code && document.shapes.find(shape => shape.id === issue.shapeId)?.normalization)).map(issue => [issue.id, issue]));
    issues.forEach(issue => byId.set(issue.id, issue));
    return [...byId.values()].filter(issue => issue.space === space);
  }, [document.diagnostics, issues, space]);
  const layers = [...new Set([
    ...shapes.map(shape => shape.layer),
    ...diagnostics.filter(issue => issue.severity === "blocking" && issue.id !== "unit").map(issue => issue.layer),
  ])].sort((a, b) => a.localeCompare(b));
  const selectedShape = selectedIds.length === 1 ? shapes.find(shape => shape.id === selectedIds[0]) : undefined;
  const selectedRule = selectedShape ? resolveDrawingRule(selectedShape, layerRules, shapeRules) : undefined;
  const selectedGeometry = selectedShape && selectedRule ? effectiveDrawingShape(selectedShape, selectedRule) : undefined;
  const selectedBounds = selectedGeometry?.points.length ? bounds(selectedGeometry.points) : undefined;
  const normalizationRecords = shapes.filter(shape => shape.normalization);
  const focusedShapes = zoomSelected && selection ? shapes.filter(shape => selectedIds.length ? selectedIds.includes(shape.id) : shape.layer === selection.layer) : [];
  const previewShapes = focusedShapes.length ? focusedShapes : shapes;
  const finitePoints = [...previewShapes.flatMap(shape => shape.points), ...(focusedShapes.length ? [] : labels.map(label => label.point))]
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  finitePoints.forEach(point => { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); });
  if (!finitePoints.length) { minX = minY = 0; maxX = maxY = 100; }
  const width = Math.max(maxX - minX, 1), height = Math.max(maxY - minY, 1);
  const padding = Math.max(width, height) * 0.06;
  const activeIssueIds = new Set(issues.map(issue => issue.id));
  const activeBlockers = diagnostics.filter(issue => activeIssueIds.has(issue.id) && issue.severity === "blocking");
  const issueGroups = groupDrawingReviewIssues(activeBlockers);
  const handledReviewRequest=useRef(0);
  useEffect(()=>{
    if(!reviewRequest||reviewRequest<=handledReviewRequest.current)return;
    setTab("confirm");setPreviewMode("source");
    if(tab!=="confirm")return;
    handledReviewRequest.current=reviewRequest;
    const first=issueGroups[0];
    if(first){setSelection({layer:first.layer,shapeIds:first.shapeIds});setZoomSelected(!!first.shapeIds.length);}
    const target=first?.issues.some(issue=>issue.id==="unit")
      ? controls.current?.closest('.drawing-review')?.querySelector<HTMLElement>('[aria-label="原文件单位"]')
      : controls.current?.querySelector<HTMLElement>('.drawing-review-confirm-panel [role=combobox], .drawing-review-confirm-panel input')??controls.current?.querySelector<HTMLElement>('.drawing-review-confirm-panel button');
    // Unit controls are in the persistent preview toolbar.
    (target??controls.current?.closest('.drawing-review')?.querySelector<HTMLElement>('[aria-label="原文件单位"]'))?.focus();
  },[reviewRequest,tab]);
  const completedTasks=appliedTasks.filter(task=>!activeBlockers.some(issue=>task.ids.some(id=>issue.shapeId===id||issue.shapeIds?.includes(id))));
  const pendingFigureCount=new Set(issueGroups.flatMap(group=>group.shapeIds)).size;
  const taskSuggestions = issueGroups.map(group => suggestionGroups.flatMap(suggestion => {
    // Each recommendation appears once, beside its unresolved purpose or geometric conflict.
    const shapeIds = suggestion.shapeIds.filter(id => issueGroups.find(candidate => candidate.issues.some(issue =>
      suggestion.conflict
        ? issue.code === "relationship-conflict" && (issue.shapeId === id || issue.shapeIds?.includes(id))
        : issue.id === `purpose-${id}`
    ))?.id === group.id);
    return shapeIds.length ? [{ ...suggestion, shapeIds }] : [];
  }));
  const reminders = diagnostics.filter(issue => !activeIssueIds.has(issue.id) || issue.severity !== "blocking");
  const focusIssue = (issue: DrawingDiagnostic) => {
    if (issue.space !== space) setSpace(issue.space);
    setTab("confirm");
    chooseSelection({ layer: issue.layer, shapeId: issue.shapeId, shapeIds: issue.shapeIds });
  };
  const renderIssue = (issue: DrawingDiagnostic, compact = false) => {
    const shape = issue.shapeId ? document.shapes.find(value => value.id === issue.shapeId) : undefined;
    const layerRule = Object.hasOwn(layerRules, issue.layer) ? layerRules[issue.layer] : undefined;
    const ignored = (Object.hasOwn(shapeRules,diagnosticRuleKey(issue)) && shapeRules[diagnosticRuleKey(issue)].role === "ignore") || (shape ? resolveDrawingRule(shape, layerRules, shapeRules).role === "ignore" : layerRule?.role === "ignore");
    const explicitIgnoreKey = Object.hasOwn(shapeRules,diagnosticRuleKey(issue)) && shapeRules[diagnosticRuleKey(issue)].role === "ignore" ? diagnosticRuleKey(issue) : shape && Object.hasOwn(shapeRules,shape.id) && shapeRules[shape.id].role === "ignore" ? shape.id : undefined;
    const blocking = activeIssueIds.has(issue.id) && issue.severity === "blocking";
    const resolvedOpen = shape && issue.code === "open-path" && grooveGeometry.has(shape.id);
    return <div key={issue.id} className={`drawing-review-issue${blocking ? " is-blocking" : ""}${compact ? " is-compact" : ""}`}>
      <button type="button" onClick={() => focusIssue(issue)}>
        {!compact && <span className="drawing-review-issue-layer">{issue.layer || "（空图层名）"} · {issue.space}</span>}
        <span>{resolvedOpen ? "已按指定画法定义为铣槽" : compact && issue.id.startsWith("purpose-") ? "用途未确认" : issue.message}</span>
        {!compact && (issue.shapeIds || shape) && <span className="drawing-review-note">图形：{issue.shapeIds?.join("、")??shape!.id}{shape?` · 源标识：${shape.sourceIds.join("、")}`:""}</span>}
      </button>
      {blocking && shape && issue.code === "placement-conflict" && setPlacementRule && <div className="drawing-review-placement-actions">
        <button type="button" onClick={() => { focusIssue(issue); setPlacementRule(shape.id, { mode: "pending" }); }}>作为待放置零件</button>
        {!!issue.eligibleStockIds?.length && <label><span>完整包含的板框</span><Select aria-label={`图形 ${shape.id} 所属板框`} value="" options={[{value:"",label:"选择板框",disabled:true},...issue.eligibleStockIds.map(id=>({value:id,label:`板框 ${id}`}))]} onChange={value => {
          if (value) { focusIssue(issue); setPlacementRule(shape.id, { mode: "stock", stockId: value }); }
        }} /></label>}
      </div>}
      {!ignored && blocking && shape?.pathValid && !shape.closed && resolveDrawingRule(shape, layerRules, shapeRules).role !== "pocket" && <button type="button" className="drawing-review-ignore-action"
        onClick={() => { focusIssue(issue); setShapeRule(shape.id, { ...resolveDrawingRule(shape, layerRules, shapeRules), role: "pocket" }); }}>定义为铣槽</button>}
      {ignored ? <><span className="drawing-review-note">已忽略</span>{explicitIgnoreKey && <button type="button" onClick={()=>setShapeRule(explicitIgnoreKey,{role:"unknown"})}>恢复核对</button>}</> : blocking && issue.id !== "unit" && <button type="button" className="drawing-review-ignore-action"
        onClick={() => { focusIssue(issue); setShapeRule(issue.shapeId ?? diagnosticRuleKey(issue), { role: "ignore" });
        }}>忽略此图形</button>}
    </div>;
  };

  const renderPendingEditor = (ids:string[], scope:string, label?:string, applyLayer?:string) => {
    const targets=shapes.filter(shape=>ids.includes(shape.id));
    if(!targets.length)return null;
    const current=targets.map(shape=>resolveDrawingRule(shape,layerRules,shapeRules));
    const key=JSON.stringify([scope,targets.map(shape=>shape.id),current]);
    const common=<K extends keyof DrawingRule>(field:K):DrawingRule[K]|undefined => current.every(rule=>rule[field]===current[0][field]) ? current[0][field] : undefined;
    const rule=pendingDrafts[key] ?? {role:common("role")??"unknown",pocketGeometry:common("pocketGeometry"),depth:common("depth"),slotWidth:common("slotWidth")};
    const required=rule.role==="unknown" ? "" : rule.role==="pocket" && !(Number.isFinite(rule.depth) && rule.depth!>0) ? "请填写槽深" : rule.role==="pocket" && rule.pocketGeometry==="centerline" && !(Number.isFinite(rule.slotWidth) && rule.slotWidth!>0) ? "请填写槽宽" : "";
    return <div className="drawing-review-task-fields" key={key}>
      <RuleFields rule={rule} label={label??`待确认 ${targets[0].layer}${targets.length===1?` ${targets[0].id}`:""} `} onChange={next=>setPendingDrafts(previous=>({...previous,[key]:next}))}/>
      {required && <p className="drawing-review-note">{required}</p>}
      <button type="button" disabled={rule.role==="unknown" || !!required} onClick={()=>{
        if(rule.role==="unknown" || required)return;
        const next=batchDrawingRules(document,targets.map(shape=>shape.id),layerRules,shapeRules,rule);
        if(applyLayer!==undefined)setLayerRule(applyLayer,rule);
        else targets.forEach(shape=>setShapeRule(shape.id,next[shape.id]));
        setAppliedTasks(previous=>[...previous.filter(task=>task.scope!==scope && JSON.stringify([...task.ids].sort())!==JSON.stringify(targets.map(shape=>shape.id).sort())),{ids:targets.map(shape=>shape.id),layer:targets[0].layer,scope}]);
        setActionMessage(`已应用设置 · ${targets.length} 个图形`);
      }}>{applyLayer!==undefined?"应用到本层全部图形":"确认设置"}{targets.length>1?` · ${targets.length} 个图形`:""}</button>
      {targets.length===1 && targets[0].normalization && <details className="drawing-review-normalization-actions"><summary>查看自动修正与原始路径</summary>
        <p>当前使用{effectiveDrawingShape(targets[0],current[0])===targets[0]?"归一化几何":"原始几何"}。</p>
        <div className="drawing-review-normalization-buttons"><button type="button" onClick={()=>setShapeRule(targets[0].id,{...current[0],geometrySource:"original"})}>使用原始路径</button>
        <button type="button" onClick={()=>{const {geometrySource:_source,...next}=current[0];setShapeRule(targets[0].id,next);}}>使用修正后路径</button></div>
      </details>}
    </div>;
  };

  return <section className="drawing-review" aria-label="原图与图层用途确认">
    <div className="drawing-review-workbench">
      <section className="drawing-review-source" aria-label="CAD 图纸">
        <div className="drawing-review-source-heading"><strong>CAD 图纸</strong><div className="drawing-review-preview-tabs" role="group" aria-label="预览内容">
          <button type="button" aria-pressed={previewMode==="source"} onClick={()=>setPreviewMode("source")}>原图</button>
          <button type="button" aria-pressed={previewMode==="result"} disabled={!resultPreview} data-tooltip={!resultPreview?"确认图形用途后可查看导入结果":undefined} onClick={()=>setPreviewMode("result")}>导入结果</button>
        </div><span>{shapes.length} 个图形</span></div>
        <div className="drawing-review-view-tools">
          {document.spaces.length > 1 && <Select className="drawing-review-space-select" value={space} aria-label="模型 / 布局空间" onChange={value=>{setSelection(null);setZoomSelected(false);setSpace(value);}} options={document.spaces.map(name=>({value:name,label:name.toLowerCase()==="model"?"模型空间":name.toLowerCase()==="paper"?"布局空间":name}))} />}
          {unitControls}
          {previewMode==="source" && <><button type="button" onClick={()=>setZoomSelected(false)} aria-label="查看整张图" data-tooltip="查看整张图" aria-pressed={!zoomSelected}>全图</button>
          <button type="button" disabled={!selection} onClick={()=>setZoomSelected(true)} aria-label="放大选中图形" data-tooltip="放大选中图形" aria-pressed={zoomSelected}>放大选中</button></>}
        </div>
        {previewMode==="result" && resultPreview ? <div className="drawing-review-result">{resultPreview}</div> : <><div className="drawing-review-stage">
          <svg aria-label="原图预览，点击图形确认用途" viewBox={`${minX - padding} ${-maxY - padding} ${width + padding * 2} ${height + padding * 2}`}>
            <g transform="scale(1 -1)">
              {[...shapes].sort((a,b)=>{const x=bounds(a.points),y=bounds(b.points);return y.width*y.height-x.width*x.height;}).map(shape => {
                const rule = resolveDrawingRule(shape, layerRules, shapeRules);
                const geometry = effectiveDrawingShape(shape, rule), d = shapePath(geometry);
                const groove = grooveGeometry.get(shape.id);
                const invalid = !geometry.valid && !groove;
                const highlighted = selection?.shapeIds ? selection.shapeIds.includes(shape.id) : selection?.shapeId ? selection.shapeId === shape.id : selection?.layer === shape.layer;
                const title = `${shape.id} · ${shape.layer} · ${shape.entityType} · ${roles.find(role => role.value === rule.role)?.label}${invalid ? " · 几何需处理" : ""}`;
                return <g key={shape.id} className={`drawing-review-shape is-${rule.role}${highlighted ? " is-selected" : ""}${invalid ? " is-invalid" : ""}${selection && !highlighted ? " is-dimmed" : ""}`}>
                  <title>{title}</title>
                  {groove && !geometry.closed && <path d={shapePath({ ...shape, points: groove.points, closed: true })} className={`drawing-review-geometry${groove.boundaryClosedByUser ? " is-user-closed-area" : ""}`} fillRule="evenodd" vectorEffect="non-scaling-stroke" />}
                  <path d={d} className={`drawing-review-geometry${!geometry.closed ? " is-open-path" : ""}`} fillRule="evenodd" vectorEffect="non-scaling-stroke" />
                  {groove?.boundaryClosedByUser && <path d={`M${geometry.points.at(-1)!.x},${geometry.points.at(-1)!.y} L${geometry.points[0].x},${geometry.points[0].y}`} className="drawing-review-closing-edge" vectorEffect="non-scaling-stroke" />}
                  {highlighted && shape.normalization && <>
                    <path d={shapePath({ ...shape, ...shape.normalization.original })} className="drawing-review-original-path" vectorEffect="non-scaling-stroke" />
                    <path d={shapePath(shape)} className="drawing-review-normalized-path" vectorEffect="non-scaling-stroke" />
                  </>}
                  <path d={d} className="drawing-review-hit" vectorEffect="non-scaling-stroke" tabIndex={d ? 0 : undefined}
                    role="button" aria-label={`选择图形：${title}`} aria-pressed={selectedIds.includes(shape.id)}
                    onClick={event => toggleShape(shape,event.shiftKey)}
                    onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleShape(shape,event.shiftKey); } }} />
                </g>;
              })}
            </g>
            {labels.filter(label => Number.isFinite(label.point.x) && Number.isFinite(label.point.y)).map(label => <text key={label.id} x={label.point.x} y={-label.point.y}
              className="drawing-review-label" fontSize={Math.max(width, height) / 65}>{label.text}</text>)}
          </svg>
          {!shapes.length && <p className="drawing-review-empty">没有加工轮廓</p>}
        </div>
        <div className="drawing-review-legend" aria-label="图形颜色说明">
          <span className="is-outer">外轮廓</span><span className="is-hole">通孔</span><span className="is-pocket">铣槽</span>
          <span className="is-stock">板框</span><span className="is-unknown">未确认 / 待处理</span><span className="is-ignore">忽略</span>
        </div>
        </>}
        {selection && previewMode==="source" && <div className="drawing-review-selection-status" role="status">{selectedIds.length ? `已选 ${selectedIds.length} 个图形：${selectedIds.slice(0,4).join("、")}${selectedIds.length>4?"…":""}` : `图层：${selection.layer}`}</div>}
      </section>
      <section className="drawing-review-controls" aria-label="导入操作区">
        <div className="drawing-review-tabs" role="group" aria-label="导入步骤">
          <button type="button" aria-pressed={tab==="confirm"} onClick={()=>setTab("confirm")}>确认图形 <span>{issueGroups.length || (unavailableReason?"":"✓")}</span></button>
          <button type="button" aria-pressed={tab==="all"} onClick={()=>setTab("all")}>全部图形</button>
          {parameters && <button type="button" aria-pressed={tab==="parameters"} onClick={()=>setTab("parameters")}>板厚与材质</button>}
        </div>
        <div className="drawing-review-control-scroll" ref={controls} role="region" aria-label="导入内容与图层设置" tabIndex={0}>
          {configuration}
          {status}
          {actionMessage && <p className="drawing-review-action-message" role="status">{actionMessage}</p>}
          {tab==="all" && <div ref={editor} className="drawing-review-edit-selection">
        {selectedShape && selectedRule && <div className="drawing-review-individual">
          <div><strong data-tooltip="单个图形设置优先于图层设置">图形 {selectedShape.id}</strong><button type="button" onClick={() => setSelection({ layer: selectedShape.layer })}>查看同层图形</button></div>
          <p>{selectedShape.layer} · {selectedGeometry?.closed ? "闭合边界" : selectedGeometry?.pathValid ? "开放路径" : "无效路径"}</p>
          <p className="drawing-review-note">尺寸 {selectedBounds ? `${selectedBounds.width.toFixed(1)} × ${selectedBounds.height.toFixed(1)} mm` : "尺寸未知"}</p>
          {renderPendingEditor([selectedShape.id],`selected/${selectedShape.id}`,"单个图形")}
        </div>}
      {selectedIds.length > 1 && <div className="drawing-review-batch">
        <strong>批量设置 · {selectedIds.length} 个图形</strong>
        {renderPendingEditor(selectedIds,"selected-batch","批量设置")}
        <button type="button" onClick={()=>setSelection(null)}>清空选择</button>
      </div>}
          </div>}
          <div hidden={tab!=="confirm"} className="drawing-review-confirm-panel">
            {issueGroups.length>0 && <div className="drawing-review-section-heading"><h4>待确认</h4><span>{issueGroups.length} 组{pendingFigureCount ? ` · ${pendingFigureCount} 个图形` : ""}</span></div>}
            {issueGroups.map((group,index)=><div className="drawing-review-task" key={group.id}>
              <button type="button" className="drawing-review-task-view" onClick={event=>{const ids=group.shapeIds.filter(id=>shapes.some(shape=>shape.id===id));chooseSelection({layer:group.layer,shapeIds:ids});if(!ids.length){const details=event.currentTarget.parentElement?.querySelector("details");if(details)details.open=true;}if(group.issues.some(issue=>issue.id==="unit"))controls.current?.querySelector<HTMLElement>('[aria-label="原文件单位"]')?.focus();}}>
                <FigureThumbnail shapes={shapes.filter(shape=>group.shapeIds.includes(shape.id))}/>
                <span><strong>{group.message.includes("用途未确认") ? "请选择图形用途" : group.message}</strong><small>{group.layer || "文件信息"}{group.shapeIds.length ? ` · ${group.shapeIds.length} 个图形` : ""}</small><em>{group.shapeIds.length ? `查看这 ${group.shapeIds.length} 个图形 →` : "查看详情 →"}</em></span>
              </button>
              {taskSuggestions[index].map(suggestion=><div key={suggestion.groupId} className="drawing-review-suggestion">
                <strong>{suggestion.label}{taskSuggestions[index].length > 1 ? ` · ${suggestion.shapeIds.length} 个图形` : ""}</strong>
                <p>{suggestion.basis}</p>
                {suggestion.conflict && <p role="status">与当前用途冲突，请核对。</p>}
                {(taskSuggestions[index].length > 1 || suggestion.shapeIds.length !== group.shapeIds.length) && <button type="button" onClick={()=>chooseSelection({layer:suggestion.layer,shapeIds:suggestion.shapeIds})}>查看这 {suggestion.shapeIds.length} 个图形</button>}
                {!suggestion.conflict && renderPendingEditor(suggestion.shapeIds,`${group.id}/${suggestion.groupId}`)}
              </div>)}
              {group.issues.some(issue=>issue.code==="relationship-conflict")
                ? group.shapeIds.map(id=><div key={id}><strong className="drawing-review-task-object">图形 {id}</strong>{renderPendingEditor([id],`${group.id}/${id}`)}</div>)
                : renderPendingEditor([...new Set(group.issues.flatMap(issue=>issue.shapeId?[issue.shapeId]:[]))].filter(id=>!taskSuggestions[index].some(suggestion=>!suggestion.conflict && suggestion.shapeIds.includes(id))),group.id)}
              <details className="drawing-review-individual-list"><summary>逐个查看与处理 <span>{group.shapeIds.length} 个图形</span></summary>
                {group.issues.filter(issue=>!issue.shapeId).map(issue=>renderIssue(issue))}
                {[...new Set(group.issues.flatMap(issue=>issue.shapeId?[issue.shapeId]:[]))].map(id=>{
                  const shape=shapes.find(shape=>shape.id===id);
                  const geometry=shape?effectiveDrawingShape(shape,resolveDrawingRule(shape,layerRules,shapeRules)):undefined;
                  const box=geometry?bounds(geometry.points):undefined;
                  return <article className="drawing-review-individual-task" aria-label={`图形 ${id} 设置`} key={id}>
                    <header>{shape && <FigureThumbnail shapes={[shape]}/>}<div><strong data-tooltip={shape?`源标识：${shape.sourceIds.join("、")}`:undefined}>图形 {id}</strong>
                      {box && <small>{box.width.toFixed(1)} × {box.height.toFixed(1)} mm · {geometry?.closed?"闭合边界":"开放路径"}</small>}</div>
                      <button type="button" onClick={()=>chooseSelection({layer:group.layer,shapeId:id})}>查看</button>
                    </header>
                    {group.issues.filter(issue=>issue.shapeId===id).map(issue=>renderIssue(issue,true))}
                    {group.shapeIds.length>1 && renderPendingEditor([id],`${group.id}/individual/${id}`,`图形 ${id} `)}
                  </article>;
                })}
              </details>
            </div>)}
            {completedTasks.length>0 && <details className="drawing-review-completed-tasks"><summary>已确认 · {completedTasks.length} 组</summary>{completedTasks.map(task=><div key={task.scope}>
              <span>{task.layer} · {task.ids.length} 个图形</span><button type="button" onClick={()=>{setTab("all");chooseSelection({layer:task.layer,shapeIds:task.ids});}}>修改设置</button>
            </div>)}</details>}
            {!activeBlockers.length && <div className="drawing-review-complete"><strong>{unavailableReason ? "暂时无法导入" : "图形用途已确认"}</strong>{unavailableReason && <p role="alert">{unavailableReason}</p>}{parameters && !unavailableReason && <button type="button" onClick={()=>setTab("parameters")}>继续填写板厚与材质 →</button>}</div>}
          </div>
          <div hidden={tab!=="all"}>
      <div className="drawing-review-layers">
        <div className="drawing-review-section-heading"><h4>按图层批量设置</h4><span>{layers.length} 个图层</span></div>
        {layers.map(layer => {
          const unresolved=shapes.some(shape=>shape.layer===layer&&resolveDrawingRule(shape,layerRules,shapeRules).role==="unknown");
          const count = shapes.filter(shape => shape.layer === layer).length;
          const distribution=roles.map(role=>{const count=shapes.filter(shape=>shape.layer===layer&&resolveDrawingRule(shape,layerRules,shapeRules).role===role.value).length;return count?`${role.label} ${count}`:'';}).filter(Boolean).join(' · ');
          const overrides = shapes.filter(shape => shape.layer === layer && Object.hasOwn(shapeRules, shape.id)).length;
          return <div key={layer} className={`drawing-review-layer${selection?.layer === layer ? " is-selected" : ""}${unresolved ? " is-unresolved" : ""}`}
            >
            <button type="button" className="drawing-review-layer-name" aria-pressed={selection?.layer === layer}
              onClick={() => chooseSelection({ layer })}><strong>{layer || "（空图层名）"}</strong><span>{count} 个图形{overrides ? ` · ${overrides} 个单独设置` : ""}</span></button>
            <p className="drawing-review-note">{distribution}</p>
            {selection?.layer===layer && !selectedIds.length && (count ? renderPendingEditor(shapes.filter(shape=>shape.layer===layer).map(shape=>shape.id),`layer/${layer}`,`图层 ${layer} `,layer) : <button type="button" onClick={()=>setLayerRule(layer,{role:"ignore"})}>忽略本层未识别内容</button>)}
          </div>;
        })}
        {!layers.length && <p className="drawing-review-note">此空间没有图层。</p>}
      </div>
    <section className="drawing-review-object-section" aria-label="全部图形">
      <div className="drawing-review-section-heading"><h4>全部图形</h4><span>{selectedIds.length} 个已选</span></div>
      <div className="drawing-review-object-list">{shapes.map(shape=>{
        const rule=resolveDrawingRule(shape,layerRules,shapeRules),box=bounds(effectiveDrawingShape(shape,rule).points);
        const destination=accountability.find(record=>record.shapeId===shape.id)!.destination;
        return <div key={shape.id} className="drawing-review-object-row"><label><input type="checkbox" aria-label={`勾选图形 ${shape.id}`} checked={selectedIds.includes(shape.id)} onChange={()=>toggleShape(shape)}/><span>{shape.id} · {shape.layer} · {roles.find(role=>role.value===rule.role)?.label}</span></label>
          <button type="button" onClick={()=>toggleShape(shape,false)}>在图中查看</button>
          <small>{box.width.toFixed(3)} × {box.height.toFixed(3)} mm · {destination} · 源标识 {shape.sourceIds.join('、')}</small>
        </div>;
      })}</div>
    </section>
          </div>
          {parameters && <div hidden={tab!=="parameters"}>{parameters}</div>}
          <details className="drawing-review-checks"><summary>图纸检查 <span>{normalizationRecords.length ? `已自动修正 ${normalizationRecords.length} 个图形` : ""}</span></summary>
    {shapes.some(shape=>resolveDrawingRule(shape,layerRules,shapeRules).role==='ignore')&&<details className="drawing-review-reminders"><summary>已忽略图形 · {shapes.filter(shape=>resolveDrawingRule(shape,layerRules,shapeRules).role==='ignore').length} 个</summary>
      {shapes.filter(shape=>resolveDrawingRule(shape,layerRules,shapeRules).role==='ignore').map(shape=><div className="drawing-review-object-row" key={shape.id}><span>{shape.id} · {shape.layer} · 源标识 {shape.sourceIds.join('、')}</span><button type="button" onClick={()=>setShapeRule(shape.id,{role:'unknown'})}>恢复核对</button></div>)}
    </details>}
    {!!normalizationRecords.length && <details className="drawing-review-normalization-records">
      <summary>已自动修正 · {normalizationRecords.length} 个图形</summary>
      <p className="drawing-review-note">端点容差 0.001 mm。</p>
      {normalizationRecords.map(shape => <div key={shape.id}>
        <button type="button" onClick={() => chooseSelection({ layer: shape.layer, shapeId: shape.id })}>{shape.layer} · 源标识 {shape.sourceIds.join("、")}</button>
        {shape.normalization!.repairLog.map((message, index) => <p key={index}>{message}</p>)}
      </div>)}
    </details>}
{reminders.length > 0 && <details className="drawing-review-reminders"><summary>其他提示 · {reminders.length} 项</summary>{reminders.map(issue=>renderIssue(issue))}</details>}          {summary}
          </details>
        </div>
      </section>
    </div>
  </section>;
}
