import { useEffect, useState } from "react";
import { Select } from "./Select";
import type { DrawingDocument, DrawingRules } from "../core/drawingTypes";
import { captureDrawingTemplate, parseDrawingTemplates, type MappingTemplate } from "../core/drawingTemplates";

const storageKey = "homemade.drawing-layer-templates.v1";
function readConfigurations(): MappingTemplate[] {
  if(typeof window === "undefined")return [];
  try { return parseDrawingTemplates(localStorage.getItem(storageKey)); } catch { return []; }
}

export function ImportConfiguration({ document, space, layerRules, shapeRules, preset, apply }: {
  document: DrawingDocument; space: string; layerRules: DrawingRules; shapeRules: DrawingRules; preset: boolean;
  apply: (rules: DrawingRules, preset: boolean) => { matched: number; skipped: number; preserved: number };
}) {
  const [configurations, setConfigurations] = useState(readConfigurations);
  const [choice, setChoice] = useState(preset ? "sample" : "");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { setChoice(preset ? "sample" : ""); setMessage(""); }, [document]);
  const captured = captureDrawingTemplate(document, space, layerRules, shapeRules);
  const count = Object.keys(captured.rules).length;
  const selected = choice.startsWith("saved:") ? configurations[Number(choice.slice(6))] : undefined;
  const store = (next: MappingTemplate[]) => {
    try { localStorage.setItem(storageKey, JSON.stringify(next)); setConfigurations(next); return true; }
    catch { setMessage("浏览器无法保存模板。"); return false; }
  };
  return <details className="import-configuration">
    <summary>图层设置模板<span>可选</span></summary>
    <p className="drawing-review-note">复用同名图层的用途、槽宽和槽深。</p>
    <div className="import-configuration-picker">
      <label><span>模板</span><Select aria-label="图层设置模板" value={choice} onChange={value => { setChoice(value); setMessage(""); }} options={[
        {value:"",label:"请选择模板",disabled:true}, {value:"manual",label:"不使用模板"}, {value:"sample",label:"示例图纸格式"},
        ...(choice==="current" ? [{value:"current",label:"当前图形设置",disabled:true}] : []),
        ...configurations.map((configuration,index)=>({value:`saved:${index}`,label:configuration.name})),
      ]} /></label>
      <button type="button" disabled={!choice || choice==="current"} onClick={() => {
        const result = apply(selected?.rules ?? {}, choice === "sample");
        setMessage(`${choice === "manual" ? "已取消模板，保留手动设置" : choice === "sample" ? "已应用示例图纸格式" : `已应用 ${result.matched} 个图层`}${result.skipped ? `；保留 ${result.skipped} 个手动设置图层` : ""}${result.preserved ? `；保留 ${result.preserved} 个图形的手动设置` : ""}。`);
      }}>应用</button>
    </div>
    {choice === "sample" && <p className="drawing-review-note">适用于示例的 CUT / REF_STOCK / HOLE / POCKET 图层约定。</p>}
    {message && <p className="import-configuration-message" role="status">{message}</p>}
    <div className="import-configuration-management">
      <strong>保存当前图层设置</strong>
      <div className="drawing-review-template-grid">
        <label><span>模板名称</span><input aria-label="模板名称" value={name} maxLength={80} placeholder="例如：家具加工图" onChange={event => setName(event.target.value)} /></label>
        <button type="button" disabled={!count || !name.trim()} onClick={() => {
          const trimmed = name.trim();
          const next = [...configurations.filter(configuration => configuration.name !== trimmed), { name: trimmed, rules: captured.rules }];
          if (next.length > 100 || count > 2_000 || Object.keys(captured.rules).some(layer=>layer.length>1_000)) { setMessage("模板数量或图层数量超过可保存范围。"); return; }
          if (store(next)) { setChoice(`saved:${next.length - 1}`); setMessage(`已保存“${trimmed}” · ${count} 个图层${captured.skipped.length ? `；${captured.skipped.length} 个图层未保存` : ""}。`); }
        }}>保存模板</button>
      </div>
      {captured.skipped.length > 0 && <div className="import-configuration-exclusions">
        <strong>{captured.skipped.length} 个图层无法复用</strong>
        <ul>{captured.skipped.map(item => <li key={item.layer}><span>{item.layer}</span><small>{item.reason}</small></li>)}</ul>
      </div>}
      {selected && <button type="button" className="import-configuration-delete" onClick={() => {
        if (store(configurations.filter(configuration => configuration !== selected))) { setChoice("current"); setMessage(`已删除“${selected.name}”。当前图纸设置保留。`); }
      }}>删除“{selected.name}”</button>}
      {configurations.some(configuration => configuration.name === name.trim()) && <p className="drawing-review-note">同名保存会更新已有模板。</p>}
    </div>
  </details>;
}
