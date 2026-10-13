import { useEffect, useMemo, useRef, useState } from "react";
import { MaterialSelect } from "./MaterialSelect";
import { Select } from "./Select";
import { ImportDrawingPreview } from "./ImportDrawingPreview";
import { useWorkbench } from "../store";
import { cancelImportDrawing, importDrawing } from "../import";
import { confirmMetadata, importMetadataIssues, reconcileStockMetadata, reconcilePartMetadata, type PartMetadata, type StockMetadata, type ImportTarget } from "../core/importTransaction";
import { compileDrawing, reviewLayerRules, reviewShapeRules, drawingIssues, groupDrawingReviewIssues, applyDrawingLayer, type ImportOptions, type PlacementRule } from "../core/drawingReview";
import type { DrawingRules } from "../core/drawingTypes";
import {applyDrawingTemplate} from "../core/drawingTemplates";
import { ImportConfiguration } from "./ImportConfiguration";
import { DrawingReview } from "./DrawingReview";

export function ImportPreview({ close, sample = false }: { close: () => void; sample?: boolean }) {
  const s = useWorkbench(), input = useRef<HTMLInputElement>(null), form = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"board" | "parts">("board");
  const [file, setFile] = useState<File>();
  const [unit, setUnit] = useState<ImportOptions["unit"]>();
  const [thickness, setThickness] = useState(""), [material, setMaterial] = useState("");
  const [reviewRequest,setReviewRequest]=useState(0);
  const [parameterRequest, setParameterRequest] = useState(0);
  const [previewRequest, setPreviewRequest] = useState<{shapeId:string;revision:number}>();
  const [quantity, setQuantity] = useState("1");
  const [target, setTarget] = useState<ImportTarget>(sample ? "new" : "append");
  const [stocks, setStocks] = useState<StockMetadata>({}), [stockId, setStockId] = useState("");
  const [parts, setParts] = useState<PartMetadata>({});
  const [placementRules,setPlacementRules] = useState<Record<string,PlacementRule>>({});
  const [submitted, setSubmitted] = useState(false), [error, setError] = useState("");
  const [space,setSpace]=useState("");
  const [manualRules,setManualRules]=useState<DrawingRules>({}), [shapeRules,setShapeRules]=useState<DrawingRules>({});
  const [preset,setPreset]=useState(sample);
  const [templateRules,setTemplateRules]=useState<DrawingRules>({});
  const document=s.drawingDraft;
  const selectedSpace=space && document?.spaces.includes(space)?space:document?.spaces.find(v=>v.toLowerCase()==="model")??document?.spaces[0]??"";
  const layerRules=useMemo(()=>document?reviewLayerRules(document,{preset,template:templateRules,manual:manualRules}):{},[document,preset,templateRules,manualRules]);
  const effectiveShapeRules=useMemo(()=>document?reviewShapeRules(document,{preset,template:templateRules,manual:manualRules,shapes:shapeRules}):shapeRules,[document,preset,templateRules,manualRules,shapeRules]);
  const reviewIssues=useMemo(()=>document?drawingIssues(document,selectedSpace,layerRules,effectiveShapeRules,{mode,placementRules,inferStock:false}):[],[document,selectedSpace,layerRules,effectiveShapeRules,mode,placementRules]);
  const compiled=useMemo(()=>{
    if(!document) return {project:s.draft,error:""};
    try {return {project:compileDrawing(document,{mode,space:selectedSpace,inferStock:false,deferThicknessCheck:true,placementRules},layerRules,effectiveShapeRules),error:""};}
    catch(e){return {project:null,error:(e as Error).message};}
  },[document,s.draft,mode,selectedSpace,layerRules,effectiveShapeRules,placementRules]);
  const draft=compiled.project;
  useEffect(() => {
    if (sample) void importDrawing();
    return () => cancelImportDrawing();
  }, []);
  useEffect(() => {
    // beginImport temporarily clears the draft; retain edits until a new draft arrives.
    if (!draft) return;
    if(mode==="board")setStocks(previous => reconcileStockMetadata(draft!.sheets, previous, sample));
    setParts(previous => reconcilePartMetadata(draft!.parts, previous));
    if(mode==="board")setStockId(previous => draft!.sheets.some(stock => stock.id === previous) ? previous : draft!.sheets[0]?.id ?? "");
    setSubmitted(false); setError("");
  }, [draft, sample, mode]);
  const parse = (chosen: File | undefined, nextMode: "board" | "parts", nextUnit: ImportOptions["unit"], reset = false) => {
    setSubmitted(false); setError(""); setParameterRequest(0); setPreviewRequest(undefined);
    if (reset) { setPreset(false); setTemplateRules({}); setManualRules({}); setShapeRules({}); setSpace(""); setPlacementRules({}); setParts({}); setStocks({}); setStockId(""); setThickness(""); setMaterial(""); setQuantity("1"); }
    void importDrawing(chosen, { mode: nextMode, unit: nextUnit });
  };
  const metadata = { thickness: Number(thickness), material, quantity: Number(quantity), stocks, ...(mode === "board" ? {parts} : {}) };
  const issues = draft ? importMetadataIssues(draft, metadata) : [];
  const fieldError = (field: string) => submitted ? issues.find(issue => issue.field === field)?.message : undefined;
  const errorProps = (field: string) => ({ "data-field": field, "aria-invalid": !!fieldError(field),
    "aria-describedby": fieldError(field) ? `import-error-${field}` : undefined });
  const showError = (field: string) => {
    let message = fieldError(field);
    if (!message) return null;
    const part = draft?.parts.find(part => field.startsWith(`part.${part.id}.`));
    if (part && message.startsWith(`${part.name}：`)) message = message.slice(part.name.length + 1);
    const stock = draft?.sheets.find(stock => field.startsWith(`stock.${stock.id}.`));
    if (stock && message.startsWith(`${stock.name}：`)) message = message.slice(stock.name.length + 1);
    return <small className="import-field-error" id={`import-error-${field}`}>{message}</small>;
  };
  const confirm = () => {
    setSubmitted(true); setError("");
    if (issues.length) {
      setParameterRequest(value=>value+1);
      return;
    }
    try {
      const confirmed = confirmMetadata(draft!, metadata);
      s.confirmImport(confirmed, s.project ? target : "new"); close();
    } catch (e) { setError((e as Error).message); }
  };
  const pendingParts = draft?.parts.filter(part => !part.stockId) ?? [];
  const selectedStockMetadata = stocks[stockId];
  const canApplyStock = selectedStockMetadata && Number.isFinite(selectedStockMetadata.thickness) && selectedStockMetadata.thickness >= 1 && selectedStockMetadata.thickness <= 100 && !!selectedStockMetadata.material.trim() && selectedStockMetadata.material.trim() !== "未指定";
  const sourceShapes=document?.shapes.filter(shape=>shape.space===selectedSpace)??[];
  const reviewGroups=groupDrawingReviewIssues(reviewIssues);
  const warnings = draft?.warnings.filter(w => !w.includes("板厚未知") && !w.includes("请输入零件板厚")) ?? [];
  return <div className="import-preview" ref={form}>
    <div className="import-header">
      {!sample && <div className="import-modes" role="group" aria-label="图纸类型">
        {(["board", "parts"] as const).map(value => <button key={value} aria-pressed={mode === value}
          className={mode === value ? "active" : ""} onClick={() => {
            if (value === mode) return;
            setMode(value); setSubmitted(false); setError("");
          }}><strong>{value === "board" ? "整板图纸" : "零件轮廓"}</strong>
          <small>{value === "board" ? "板框与已有排版" : "独立轮廓，加入待放置"}</small></button>)}
      </div>}
      <input ref={input} type="file" accept=".dxf" hidden onChange={e => {
        const chosen = e.target.files?.[0];
        if (chosen) { setFile(chosen); setUnit(undefined); parse(chosen, mode, undefined, true); }
        e.target.value = "";
      }} />
      <div className="import-file-heading">
        <div><strong data-tooltip-overflow={file?.name ?? draft?.name}>{file?.name ?? (sample ? "示例图纸 · sample.dxf" : "选择要导入的图纸")}</strong>
          </div>
        {!sample && <button className={!file ? "primary" : ""} onClick={() => input.current?.click()}>{file ? "更换文件" : "选择 DXF 文件"}</button>}
      </div>
    </div>
    <div className="import-workspace">
      {document ? <>
        <DrawingReview document={document} space={selectedSpace} setSpace={setSpace} layerRules={layerRules} shapeRules={effectiveShapeRules}
          setLayerRule={(layer,rule)=>setShapeRules(previous=>applyDrawingLayer(document,selectedSpace,layer,layerRules,previous,rule))}
          setShapeRule={(id,rule)=>setShapeRules(previous=>({...previous,[id]:rule}))}
          setPlacementRule={(id,rule)=>setPlacementRules(previous=>({...previous,[id]:rule}))}
          destinations={draft?Object.fromEntries(draft.parts.map(part=>[part.id,part.stockId?`板框 ${part.stockId}`:'待放置零件'])):undefined} issues={reviewIssues} reviewRequest={reviewRequest} parameterRequest={parameterRequest} previewRequest={previewRequest} unavailableReason={!reviewIssues.length ? compiled.error : undefined}
          unitControls={<label className={`import-source-unit${!document.unitKnown?" is-required":""}`}><span>单位</span><Select aria-label="原文件单位" value={unit??""} onChange={value=>{
            const next=value as ImportOptions["unit"];
            setUnit(next||undefined);if(file||sample)parse(file,mode,next||undefined);
          }} options={[{value:"",label:document.unitKnown?document.importInfo.sourceUnit:"请选择",disabled:!document.unitKnown},
            {value:"mm",label:"毫米 mm"},{value:"cm",label:"厘米 cm"},{value:"m",label:"米 m"},{value:"inch",label:"英寸 inch"},{value:"foot",label:"英尺 foot"}]} /></label>}
          configuration={<ImportConfiguration document={document} space={selectedSpace} layerRules={layerRules} shapeRules={effectiveShapeRules} preset={preset} apply={(rules,nextPreset)=>{
            const result=applyDrawingTemplate(rules,[...sourceShapes.map(shape=>shape.layer),...document.diagnostics.filter(issue=>issue.space===selectedSpace).map(issue=>issue.layer)],manualRules);
            setPreset(nextPreset);setTemplateRules(result.rules);
            return {...result,preserved:sourceShapes.filter(shape=>Object.hasOwn(shapeRules,shape.id)).length};
          }}/>}
          status={<>{s.importing && <div className="import-progress" role="status">正在读取图纸…<button onClick={cancelImportDrawing}>取消解析</button></div>}
            {s.importMessage && <div className="warning" role="alert">{s.importMessage}{(file||sample)&&!s.importing&&<button onClick={()=>parse(file,mode,unit)}>重新读取</button>}</div>}</>}
          resultPreview={draft?<ImportDrawingPreview draft={draft} stockId={stockId} selectStock={id=>{setStockId(id);setPreviewRequest(previous=>({shapeId:id,revision:(previous?.revision??0)+1}));}}/>:undefined}
          parameters={<>      {!draft && <p className="import-description">{!reviewIssues.length && compiled.error ? compiled.error : "先完成图形用途确认，再填写板厚与材质。"}</p>}{draft && <>
        <div className="import-counts"><span><strong>{draft.sheets.length}</strong> 张板材</span><span><strong>{draft.parts.length}</strong> {mode === "parts" ? "种轮廓" : "个零件"}</span>
          <span>{draft.original.placements.length} 个已放置 · {draft.parts.length - draft.original.placements.length} 个待放置</span>
          <span>{draft.parts.reduce((n, p) => n + p.holes.length, 0)} 个通孔 · {draft.parts.reduce((n, p) => n + p.pockets.length, 0)} 个铣槽</span></div>
        {warnings.length > 0 && <section className="import-notices" aria-label="图纸核对提醒"><strong>{warnings.length} 项需要核对</strong><ul>{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></section>}
        <div className="import-content">

          <section className="import-metadata" aria-label={mode === "parts" ? "零件参数" : "板材参数"}>
            <h3>{mode === "parts" ? "零件参数" : "板材参数"}</h3>
            {mode === "parts" ? <>
              <label>板厚<span className="input-unit"><input aria-label="零件板厚" type="number" min={1} max={100} value={thickness} placeholder="必填"
                {...errorProps("thickness")} onChange={e => setThickness(e.target.value)} /><span>mm</span></span>{showError("thickness")}</label>
              <label>材质<MaterialSelect aria-label="零件材质" value={material} {...errorProps("material")} onChange={setMaterial} />{showError("material")}</label>
              <label>每种轮廓数量<input aria-label="导入数量" type="number" min={1} max={100} value={quantity} {...errorProps("quantity")} onChange={e => setQuantity(e.target.value)} />{showError("quantity")}</label>
              <p className="import-description">共 {draft.parts.length * (Number(quantity) || 0)} 个待放置零件。</p>
            </> : draft.sheets.map(stock => <section className={`import-stock${stock.id === stockId ? " selected" : ""}`} key={stock.id}>
              <button className="import-stock-name" aria-label={`预览${stock.name}`} onClick={() => {setStockId(stock.id);setPreviewRequest(previous=>({shapeId:stock.id,revision:(previous?.revision??0)+1}));}}>{stock.name}<span>{stock.width.toFixed(0)} × {stock.height.toFixed(0)} mm</span></button>
              <div className="form-grid">
                <label>板厚<span className="input-unit"><input aria-label={`${stock.name} 导入板厚`} type="number" min={1} max={100}
                  value={Number.isFinite(stocks[stock.id]?.thickness) ? stocks[stock.id].thickness || "" : ""} {...errorProps(`stock.${stock.id}.thickness`)}
                  onChange={e => setStocks(previous => ({ ...previous, [stock.id]: { ...previous[stock.id], thickness: e.target.valueAsNumber } }))} /><span>mm</span></span>{showError(`stock.${stock.id}.thickness`)}</label>
                <label>材质<MaterialSelect aria-label={`${stock.name} 导入材质`} value={stocks[stock.id]?.material ?? ""} {...errorProps(`stock.${stock.id}.material`)}
                  onChange={value => setStocks(previous => ({ ...previous, [stock.id]: { ...previous[stock.id], material: value } }))} />{showError(`stock.${stock.id}.material`)}</label>
              </div>
            </section>)}
            {mode === "board" && !!pendingParts.length && <section className="import-pending-metadata" aria-label="待放置零件参数">
              <h3>待放置零件参数 <span>{pendingParts.length} 个</span></h3>
              <button type="button" className="import-pending-bulk" disabled={!canApplyStock} data-tooltip="将所选板材的板厚与材质应用到全部待放置零件" onClick={() => {
                if (!canApplyStock) return;
                setParts(previous => ({ ...previous, ...Object.fromEntries(pendingParts.map(part => [part.id, { ...selectedStockMetadata }])) }));
              }}>沿用所选板材参数</button>
              {pendingParts.map(part => <section className="import-pending-part" key={part.id}>
                <strong>{part.name}</strong><small>{part.width.toFixed(1)} × {part.height.toFixed(1)} mm · 源标识 {part.id}</small>
                <div className="form-grid">
                  <label>板厚<span className="input-unit"><input aria-label={`${part.name} 导入板厚`} type="number" min={1} max={100}
                    value={Number.isFinite(parts[part.id]?.thickness) ? parts[part.id].thickness || "" : ""} {...errorProps(`part.${part.id}.thickness`)}
                    onChange={e => setParts(previous => ({ ...previous, [part.id]: { ...previous[part.id], thickness: e.target.valueAsNumber } }))} /><span>mm</span></span>{showError(`part.${part.id}.thickness`)}</label>
                  <label>材质<MaterialSelect aria-label={`${part.name} 导入材质`} value={parts[part.id]?.material ?? ""} {...errorProps(`part.${part.id}.material`)}
                    onChange={value => setParts(previous => ({ ...previous, [part.id]: { ...previous[part.id], material: value } }))} />{showError(`part.${part.id}.material`)}</label>
                </div>
              </section>)}
            </section>}
          </section>
        </div>
        <details className="import-dimensions"><summary>零件尺寸明细 <span>{draft.parts.length} 项</span></summary>
          <table><thead><tr><th>零件</th><th>宽 × 长 / mm</th><th>通孔 / 铣槽</th></tr></thead><tbody>{draft.parts.map(part => <tr key={part.id}>
            <td data-tooltip-overflow={part.name}>{part.name}</td><td>{part.width.toFixed(1)} × {part.height.toFixed(1)}</td><td>{part.holes.length} / {part.pockets.length}</td>
          </tr>)}</tbody></table></details>
      </>}
</>} summary={<>      <details className="import-format"><summary>图纸格式与识别规则</summary>
        <p>支持二维多段线、圆、椭圆、样条、LINE/ARC 链及块引用。文字、尺寸和视口不作为加工轮廓。</p>
      </details>
</>} />
      </> : <div className="import-empty-preview">{s.importing && <><p role="status">正在读取图纸…</p><button onClick={cancelImportDrawing}>取消解析</button></>}{s.importMessage && <p role="alert">{s.importMessage}</p>}{s.importMessage && !s.importing && (file || sample) && <button onClick={()=>parse(file,mode,unit)}>重新读取</button>}</div>}
    </div>
    <div className="import-actions">
      {s.project && draft && <label className="import-target">导入方式<Select aria-label="导入方式" value={target} onChange={value => setTarget(value as ImportTarget)} options={[{value:"append",label:"追加到当前项目"},{value:"new",label:"打开为新项目"}]} /></label>}
      {s.project && draft && target === "new" && <p className="import-replace">将替换当前工作区，可撤销恢复；刷新页面会丢失未保存的工作。</p>}
      {(error || (submitted && issues.length > 0)) && <p className="import-submit-error" role="alert">{error || issues[0].message}</p>}
      <div className="import-footer-navigation">
        <p className="import-next-step" role="status">{s.importing?"正在读取图纸":reviewGroups.length?`待确认 ${reviewGroups.length} 组`:!draft?(document?compiled.error:"请选择 DXF 文件"):issues.length?`${issues.length} 项参数待填写`:`${draft.sheets.length} 张板材 · ${draft.parts.length} 个零件`}</p>
        <div className="import-action-buttons"><button onClick={close}>取消</button><button className="primary" disabled={!document || s.importing} onClick={()=>{
          if(reviewGroups.length||!draft){setReviewRequest(value=>value+1);return;}
          confirm();
        }}>{s.importing?"正在读取…":reviewGroups.length?"继续确认图形":!draft?(document?"检查图纸":"导入图纸"):issues.length?"填写板厚与材质":sample?"使用示例图纸":`导入 · ${draft.parts.length} 个零件`}</button></div>
      </div>
    </div>
  </div>;
}
