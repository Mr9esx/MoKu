import { useMemo, useState } from "react";
import { Maximize2 } from "lucide-react";
import { useWorkbench, workbench } from "../store";
import { bounds } from "../core/geometry";
import { previewRelief, reliefTargets, type ReliefInput } from "../core/joineryRelief";
import type { Point } from "../core/types";
import { Select } from "./Select";
import "./joineryPanel.css";

const svgPoints = (points: Point[]) => points.map(p => `${p.x},${-p.y}`).join(" ");

export function JoineryPanel({ close }: { close: () => void }) {
  const s = useWorkbench();
  const parts = s.project?.parts ?? [];
  const part = parts.find(p => p.id === s.selected);
  const targets = useMemo(() => part ? reliefTargets(part) : [], [part]);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const target = targets.find(t => t.id === targetId);
  const [corners, setCorners] = useState(target?.corners.map(c => c.index) ?? []);
  const [diameter, setDiameter] = useState("6");
  const [style, setStyle] = useState<ReliefInput["style"]>("dogbone");
  const [direction, setDirection] = useState<ReliefInput["direction"]>("long");
  const [overview, setOverview] = useState(false);
  const [previewCorner, setPreviewCorner] = useState("0");
  const [commitError, setCommitError] = useState("");
  const readonly = s.view !== "current" || s.status === "searching";
  const input = useMemo<ReliefInput>(() => ({ target: targetId, corners, diameter: Number(diameter), style, direction }),
    [targetId, corners, diameter, style, direction]);
  const preview = useMemo(() => {
    if (!part || !target || !corners.length) return { result: null, error: "" };
    try { return { result: previewRelief(part, input), error: "" }; }
    catch (e) { return { result: null, error: e instanceof Error ? e.message : "无法生成清角预览" }; }
  }, [part, target, corners, input]);
  const drawing = preview.result?.part ?? part;
  const focus = previewCorner === "all" ? undefined : target?.corners[Number(previewCorner)] ?? target?.corners[0];
  const focusSize = Math.max(8, Number.isFinite(input.diameter) ? Math.min(100, Math.max(0.1, input.diameter)) * 8 : 48);
  const frame = bounds(overview || !target ? part?.outline ?? [{ x: 0, y: 0 }, { x: 100, y: 100 }]
    : focus ? [{x:focus.point.x-focusSize/2,y:focus.point.y-focusSize/2},{x:focus.point.x+focusSize/2,y:focus.point.y+focusSize/2}] : target.points);
  const padding = !overview && focus ? 0 : Math.max(frame.width, frame.height) * 0.15;
  const width = frame.width + padding * 2, height = frame.height + padding * 2;
  const marker = Math.max(width, height) / 65;
  const currentBoundary = targetId === "outline" ? drawing?.outline
    : targetId.startsWith("hole:") ? drawing?.holes[Number(targetId.split(":")[1])]
    : drawing?.pockets[Number(targetId.split(":")[1])]?.outline;
  const toggle = (index: number) => {
    setCorners(values => values.includes(index) ? values.filter(v => v !== index) : [...values, index]);
    setCommitError("");
  };
  return <>
    <div className="joinery-layout">
      <section className="joinery-preview" aria-label="清角图纸预览">
        <div className="joinery-preview-heading">
          {overview || !target ? <span>{overview ? "整个零件" : "局部预览"}</span> : <Select aria-label="清角预览位置" value={previewCorner}
            options={[{value:"all",label:"整个加工轮廓"}, ...target.corners.map((_,i)=>({value:String(i),label:`放大角点 ${i+1}`}))]}
            onChange={setPreviewCorner} />}
          <button type="button" onClick={() => setOverview(!overview)} aria-pressed={overview}>
            <Maximize2 size={14} />{overview ? "查看清角位置" : "查看整个零件"}
          </button>
        </div>
        <svg role="img" aria-label={`${part?.name ?? "零件"} · ${style === "dogbone" ? "狗骨" : "T 骨"}清角预览`}
          viewBox={`${frame.minX - padding} ${-frame.maxY - padding} ${width} ${height}`}>
          {drawing && <>
            <polygon className="joinery-part" points={svgPoints(drawing.outline)} />
            {drawing.pockets.map((p, i) => <polygon key={`p${i}`} className="joinery-pocket" points={svgPoints(p.outline)} />)}
            {drawing.holes.map((h, i) => <polygon key={`h${i}`} className="joinery-hole" points={svgPoints(h)} />)}
            {preview.result && currentBoundary && <polygon className="joinery-result" points={svgPoints(currentBoundary)} />}
            {target && <polygon className="joinery-original" points={svgPoints(target.points)} />}
            {target?.corners.map((c, i) => <g key={c.index} role="button" tabIndex={0}
              aria-label={`预览角点 ${i + 1}`} aria-pressed={corners.includes(c.index)}
              className={`joinery-corner${corners.includes(c.index) ? " is-selected" : ""}`}
              onClick={() => toggle(c.index)} onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggle(c.index); }
              }}>
              <circle className="joinery-corner-hit" cx={c.point.x} cy={-c.point.y} r={marker * 2.1} />
              <circle className="joinery-corner-dot" cx={c.point.x} cy={-c.point.y} r={marker * 0.55} />
              <text x={c.point.x + marker * 1.1} y={-c.point.y - marker} fontSize={marker * 1.7}>{i + 1}</text>
            </g>)}
          </>}
        </svg>
        <div className="joinery-preview-caption">
          <div className="joinery-legend"><span>原轮廓</span><span>清角后</span></div>
          <span>单位 mm</span>
        </div>
        <p>点击编号，选择要清角的位置。</p>
      </section>
      <section className="joinery-controls" aria-label="清角设置">
        <div className="joinery-selected-part"><span>已选零件</span><strong data-tooltip-overflow={part?.name}>{part?.name ?? "请先选择零件"}</strong></div>
        {targets.length > 0 ? <>
          <label>加工轮廓<Select aria-label="清角加工轮廓" data-autofocus value={targetId}
            options={targets.map(t => ({ value: t.id, label: t.label }))} onChange={id => {
              setTargetId(id); setCorners(targets.find(t => t.id === id)?.corners.map(c => c.index) ?? []); setCommitError(""); setPreviewCorner("0");
            }} /></label>
          <fieldset className="joinery-style"><legend>清角样式</legend>
            {([['dogbone', '狗骨', '沿内角对角方向'], ['tbone', 'T 骨', '沿内角一侧边']] as const).map(([value, label, text]) =>
              <button key={value} type="button" aria-pressed={style === value} onClick={() => { setStyle(value); setCommitError(""); }}>
                <strong>{label}</strong><small>{text}</small>
              </button>)}
          </fieldset>
          <label>刀具直径<div className="input-unit"><input type="number" aria-label="清角刀具直径"
            min={0.1} max={100} step={0.1} value={diameter} onChange={e => { setDiameter(e.target.value); setCommitError(""); }} /><span>mm</span></div></label>
          {style === "tbone" && <label>T 骨方向<Select aria-label="T 骨方向" value={direction}
            options={[{ value: "long", label: "沿长边" }, { value: "short", label: "沿短边" }]}
            onChange={value => { setDirection(value as ReliefInput["direction"]); setCommitError(""); }} /></label>}
          <div className="joinery-corner-heading"><span>清角位置 <small>{corners.length} / {target?.corners.length ?? 0}</small></span>
            <button type="button" onClick={() => { setCorners(corners.length === target?.corners.length ? [] : target?.corners.map(c => c.index) ?? []); setCommitError(""); }}>
              {corners.length === target?.corners.length ? "清空" : "全选"}
            </button>
          </div>
          <div className="joinery-corner-list" role="group" aria-label="清角位置">
            {target?.corners.map((c, i) => <button key={c.index} type="button" aria-label={`清角角点 ${i + 1}`}
              aria-pressed={corners.includes(c.index)} onClick={() => toggle(c.index)}>{i + 1}</button>)}
          </div>
          {!corners.length && <p className="joinery-note">选择至少一个角点。</p>}
        </> : <p className="joinery-note">这个零件没有可清角的直角内角。</p>}
        <p className="joinery-note">支持通孔、铣槽和开口槽的直角内角。</p>
        {(preview.error || commitError) && <p className="warning" role="alert">{commitError || preview.error}</p>}
        {readonly && <p className="warning">{s.status === "searching" ? "请先停止排版搜索。" : `请切换到${s.project?.sheets.length ? "当前排版" : "当前图纸"}后编辑。`}</p>}
      </section>
    </div>
    <div className="joinery-footer"><span role="status">{preview.result ? `将添加 ${corners.length} 个清角口 · 应用后可撤销` : "预览不会修改图纸"}</span>
      <div><button onClick={close}>取消</button><button className="primary" disabled={!preview.result || readonly} onClick={() => {
        if (part && s.applyRelief(part.id, input)) close(); else setCommitError(workbench.getState().message || "图纸已改变，请重新打开清角工具");
      }}>应用清角</button></div>
    </div>
  </>;
}
