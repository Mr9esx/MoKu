import { useEffect, useMemo, useRef, useState } from "react";
import { Check, LocateFixed } from "lucide-react";
import { useWorkbench, workbench } from "../store";
import { previewRelief, reliefContours, type ReliefInput } from "../core/joineryRelief";
import { JoineryCanvas, type ReliefFocus } from "./JoineryCanvas";
import { Select } from "./Select";
import "./joineryPanel.css";

export function JoineryPanel({ close }: { close: () => void }) {
  const s = useWorkbench();
  const parts = s.project?.parts ?? [];
  const part = parts.find(p => p.id === s.selected);
  const targets = useMemo(() => part ? reliefContours(part) : [], [part]);
  const [targetId, setTargetId] = useState(targets.find(t=>t.corners.length)?.id ?? targets[0]?.id ?? "");
  const target = targets.find(t => t.id === targetId);
  const [cornerSelection, setCornerSelection] = useState<Record<string, number[]>>({});
  const corners = useMemo(() => cornerSelection[targetId] ?? target?.corners.map(c => c.index) ?? [], [cornerSelection, targetId, target]);
  const [diameter, setDiameter] = useState("6");
  const [style, setStyle] = useState<ReliefInput["style"]>("dogbone");
  const [direction, setDirection] = useState<ReliefInput["direction"]>("long");
  const [focus, setFocus] = useState<ReliefFocus | null>(null);
  const [hoveredCorner, setHoveredCorner] = useState<number | null>(null);
  const contourList = useRef<HTMLDivElement>(null);
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
  const toggle = (index: number) => {
    setCornerSelection(previous => {
      const values = previous[targetId] ?? target?.corners.map(c => c.index) ?? [];
      return { ...previous, [targetId]: values.includes(index) ? values.filter(v => v !== index) : [...values, index] };
    });
    setCommitError("");
  };
  const selectTarget = (id: string) => {
    const next = targets.find(t => t.id === id);
    if (!next) return;
    setTargetId(id);
    setCommitError(""); setHoveredCorner(null);
    setFocus({ points: next.points });
  };
  const locateCorner = (index: number) => {
    const corner = target?.corners.find(c => c.index === index);
    if (!corner) return;
    const radius = Math.max(12, Number.isFinite(input.diameter) ? Math.min(100, Math.max(0.1, input.diameter)) * 8 : 48) / 2;
    setFocus({ points: [
      { x: corner.point.x - radius, y: corner.point.y - radius }, { x: corner.point.x + radius, y: corner.point.y + radius },
    ] });
    setHoveredCorner(index);
  };
  useEffect(() => {
    const list = contourList.current;
    if (!list) return;
    const revealSelection = () => {
      const selected = list.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!selected) return;
      if (selected.offsetTop < list.scrollTop) list.scrollTop = selected.offsetTop;
      else if (selected.offsetTop + selected.offsetHeight > list.scrollTop + list.clientHeight)
        list.scrollTop = selected.offsetTop + selected.offsetHeight - list.clientHeight;
    };
    revealSelection();
    const observer = new ResizeObserver(revealSelection);
    observer.observe(list);
    return () => observer.disconnect();
  }, [targetId]);
  return <>
    <div className="joinery-layout">
      {part && drawing && <JoineryCanvas part={part} drawing={drawing} targets={targets} targetId={targetId} corners={corners}
        hasResult={!!preview.result} focus={focus} hoveredCorner={hoveredCorner} selectTarget={selectTarget}
        toggleCorner={toggle} hoverCorner={setHoveredCorner} />}
      <section className="joinery-controls" aria-label="清角设置">
        {targets.length > 0 ? <>
          <div className="joinery-setting-section">
            <h3>加工位置<span>也可在图上点选</span></h3>
            <div ref={contourList} className="joinery-contour-list" role="group" aria-label="加工轮廓">
              {targets.map(t => <button key={t.id} type="button" aria-label={`加工轮廓：${t.label}`}
                data-autofocus={t.id === targetId || undefined} aria-pressed={t.id === targetId} onClick={() => selectTarget(t.id)}>
                <span><strong>{t.label.split(" · ")[0]}</strong><small>{t.label.split(" · ")[1] ?? "零件边缘"}</small></span>
                <span className="joinery-contour-count">{t.corners.length ? `${t.corners.length} 处` : "无清角"}{t.id === targetId && <Check size={13} />}</span>
              </button>)}
            </div>
            {!target?.corners.length && <p className="joinery-note">此轮廓没有可清角位置。槽口、圆形孔和已有狗骨 / T 骨不重复处理。</p>}
          </div>
          <div className="joinery-setting-section">
          <h3>刀具与样式</h3>
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
          {(preview.error || commitError) && <p className="warning" role="alert">{commitError || preview.error}</p>}
          </div>
          {!!target?.corners.length && <div className="joinery-setting-section">
          <div className="joinery-corner-heading"><h3>清角位置 <small>已选 {corners.length} / {target.corners.length}</small></h3>
            <button type="button" onClick={() => {
              setCornerSelection(previous => ({ ...previous, [targetId]: corners.length === target.corners.length ? [] : target.corners.map(c => c.index) }));
              setCommitError("");
            }}>
              {corners.length === target?.corners.length ? "清空" : "全选"}
            </button>
          </div>
          <div className="joinery-corner-list" role="group" aria-label="清角位置">
            {target.corners.map((c, i) => <div key={c.index} className={`joinery-corner-option${hoveredCorner === c.index ? " is-hovered" : ""}`}
              onPointerEnter={() => setHoveredCorner(c.index)} onPointerLeave={() => setHoveredCorner(null)}>
              <label><input type="checkbox" aria-label={`清角角点 ${i + 1}`} checked={corners.includes(c.index)} onChange={() => toggle(c.index)} />
                <span>角点 {i + 1}</span></label>
              <button type="button" aria-label={`定位角点 ${i + 1}`} data-tooltip={`放大查看角点 ${i + 1}`}
                onClick={() => locateCorner(c.index)}><LocateFixed size={14} /><span>定位</span></button>
            </div>)}
          </div>
          {!corners.length && <p className="joinery-note">勾选至少一个角点后可应用。</p>}
          {target?.corners.some(c=>c.fillet) && <p className="joinery-note">包含圆角，应用后按所选样式替换。</p>}
          </div>}
        </> : <p className="joinery-note">这个零件没有可清角的直角内角。</p>}
        {readonly && <p className="warning">{s.status === "searching" ? "请先停止排版搜索。" : `请切换到${s.project?.sheets.length ? "当前排版" : "当前图纸"}后编辑。`}</p>}
      </section>
    </div>
    <div className="joinery-footer"><span role="status">{preview.result ? `${target?.label.split(" · ")[0]} · ${corners.length} 个${style === "dogbone" ? "狗骨" : "T 骨"}清角口 · 可撤销` : "预览不会修改图纸"}</span>
      <div><button onClick={close}>取消</button><button className="primary" disabled={!preview.result || readonly} onClick={() => {
        if (part && s.applyRelief(part.id, input)) close(); else setCommitError(workbench.getState().message || "图纸已改变，请重新打开清角工具");
      }}>应用清角</button></div>
    </div>
  </>;
}
