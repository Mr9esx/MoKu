import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Focus, Maximize, Minus, Plus } from "lucide-react";
import { bounds } from "../core/geometry";
import { fitCanvasViewport, zoomCanvasViewport, type CanvasViewport } from "../core/canvasViewport";
import type { ReliefTarget } from "../core/joineryRelief";
import type { Part, Point } from "../core/types";

export type ReliefFocus = { points: Point[] };
const svgPoints = (points: Point[]) => points.map(p => `${p.x},${-p.y}`).join(" ");
const inset = { left: 36, right: 36, top: 36, bottom: 36 };

export function JoineryCanvas({ part, drawing, targets, targetId, corners, hasResult, focus, hoveredCorner,
  selectTarget, toggleCorner, hoverCorner }: {
  part: Part; drawing: Part; targets: ReliefTarget[]; targetId: string; corners: number[]; hasResult: boolean;
  focus: ReliefFocus | null; hoveredCorner: number | null;
  selectTarget: (id: string) => void; toggleCorner: (index: number) => void; hoverCorner: (index: number | null) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 600, height: 400 });
  const [camera, setCamera] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null);
  const drag = useRef<{ pointer: number; start: Point; view: CanvasViewport; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const target = targets.find(t => t.id === targetId);
  const targetCenter = useMemo(() => {
    const box = bounds(target?.points ?? part.outline);
    return { x: (box.minX + box.maxX) / 2, y: -(box.minY + box.maxY) / 2 };
  }, [target, part]);
  const fitPoints = (points: Point[]) => {
    const box = bounds(points);
    const fit = fitCanvasViewport(box, size, inset);
    return { ...fit, x: fit.x + box.minX, y: fit.y - box.maxY };
  };
  const fitted = useMemo(() => fitPoints(part.outline), [part, size]);
  const scale = camera ? size.width * camera.zoom / fitted.width : 1;
  const view: CanvasViewport = camera ? {
    x: camera.x - size.width / scale / 2, y: camera.y - size.height / scale / 2,
    width: size.width / scale, height: size.height / scale,
  } : fitted;
  const viewRef = useRef(view);
  viewRef.current = view;
  const pixel = view.width / size.width;
  const applyView = (next: CanvasViewport) => {
    viewRef.current = next;
    setCamera({ x: next.x + next.width / 2, y: next.y + next.height / 2, zoom: fitted.width / next.width });
  };
  const zoomAt = (anchor: Point, factor: number) => applyView(zoomCanvasViewport(viewRef.current, anchor, factor,
    { minWidth: fitted.width / 80, maxWidth: fitted.width * 2 }));
  const local = (clientX: number, clientY: number): Point => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x: view.x + view.width / 2, y: view.y + view.height / 2 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  };
  const zoomCenter = (factor: number) => zoomAt({ x: view.x + view.width / 2, y: view.y + view.height / 2 }, factor);
  const fitAll = () => { setCamera(null); viewRef.current = fitted; };
  const fitSelected = () => { if (target) applyView(fitPoints(target.points)); };
  useLayoutEffect(() => {
    const node = svg.current;
    if (!node) return;
    const measure = () => {
      const box = node.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) setSize({ width: box.width, height: box.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!focus) return;
    applyView(fitPoints(focus.points));
    // On stacked layouts, locating a corner must bring the drawing back into view.
    const layout = svg.current?.closest<HTMLElement>(".joinery-layout");
    if (layout && layout.scrollHeight > layout.clientHeight) layout.scrollTop = 0;
  }, [focus]);
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault(); e.stopPropagation();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.height : 1);
      zoomAt(local(e.clientX, e.clientY), Math.exp(-Math.max(-80, Math.min(80, delta)) * 0.008));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [fitted.width, size]);

  const contour = (id: string, points: Point[], className: string) => <g key={id}
    className={`joinery-contour${hoveredTarget === id ? " is-hovered" : ""}${targetId === id ? " is-active" : ""}`}>
    <polygon className={className} points={svgPoints(points)} pointerEvents="none" />
    <polygon className="joinery-contour-hit" points={svgPoints(points)} role="button" tabIndex={0}
      aria-label={`选择${targets.find(t => t.id === id)?.label ?? "加工轮廓"}`} aria-pressed={targetId === id}
      onPointerEnter={() => setHoveredTarget(id)} onPointerLeave={() => setHoveredTarget(null)}
      onClick={() => selectTarget(id)} onKeyDown={(e: KeyboardEvent<SVGPolygonElement>) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); selectTarget(id); }
      }}><title>{targets.find(t => t.id === id)?.label}</title></polygon>
  </g>;
  const currentBoundary = targetId === "outline" ? drawing.outline
    : targetId.startsWith("hole:") ? drawing.holes[Number(targetId.split(":")[1])]
    : drawing.pockets[Number(targetId.split(":")[1])]?.outline;
  const endDrag = () => { drag.current = null; setDragging(false); };
  return <section className="joinery-preview" aria-label="清角图纸预览">
    <div className="joinery-preview-heading"><strong>{part.name}</strong><span>点选孔槽</span></div>
    <svg ref={svg} role="group" tabIndex={0} aria-label={`${part.name} · 清角交互预览`}
      className={dragging ? "is-dragging" : ""} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
      onClickCapture={e => {
        if (suppressClick.current) { e.preventDefault(); e.stopPropagation(); suppressClick.current = false; }
      }}
      onPointerDown={e => {
        if (e.button !== 0) return;
        suppressClick.current = false;
        drag.current = { pointer: e.pointerId, start: { x: e.clientX, y: e.clientY }, view: viewRef.current, moved: false };
      }}
      onPointerMove={e => {
        const d = drag.current;
        if (!d || d.pointer !== e.pointerId) return;
        const dx = e.clientX - d.start.x, dy = e.clientY - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) <= 4) return;
        if (!d.moved) { d.moved = true; e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }
        suppressClick.current = true;
        applyView({ ...d.view, x: d.view.x - dx * d.view.width / size.width, y: d.view.y - dy * d.view.height / size.height });
      }}
      onPointerUp={e => {
        if (drag.current?.pointer !== e.pointerId) return;
        suppressClick.current ||= drag.current.moved || Math.hypot(e.clientX - drag.current.start.x, e.clientY - drag.current.start.y) > 4;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        endDrag();
      }}
      onPointerCancel={() => { suppressClick.current = true; endDrag(); }}
      onKeyDown={e => {
        if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomCenter(1.3); }
        if (e.key === "-") { e.preventDefault(); zoomCenter(1 / 1.3); }
        if (e.key === "0") { e.preventDefault(); fitAll(); }
      }}>
      {contour("outline", drawing.outline, "joinery-part")}
      {drawing.pockets.map((p, i) => contour(`pocket:${i}`, p.outline, "joinery-pocket"))}
      {drawing.holes.map((h, i) => contour(`hole:${i}`, h, "joinery-hole"))}
      {currentBoundary && <polygon className="joinery-result" points={svgPoints(currentBoundary)} pointerEvents="none" />}
      {target && hasResult && <polygon className="joinery-original" points={svgPoints(target.points)} pointerEvents="none" />}
      {target?.corners.map((c, i) => {
        const x = c.point.x + (c.point.x < targetCenter.x ? -20 : 20) * pixel;
        const y = -c.point.y + (-c.point.y < targetCenter.y ? -20 : 20) * pixel;
        return <g key={c.index} role="button" tabIndex={0}
        aria-label={`预览角点 ${i + 1}`} aria-pressed={corners.includes(c.index)}
        className={`joinery-corner${corners.includes(c.index) ? " is-selected" : ""}${hoveredCorner === c.index ? " is-hovered" : ""}`}
        onPointerEnter={() => hoverCorner(c.index)} onPointerLeave={() => hoverCorner(null)}
        onClick={e => { e.stopPropagation(); toggleCorner(c.index); }} onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleCorner(c.index); }
        }}>
        <line className="joinery-corner-leader" x1={c.point.x} y1={-c.point.y} x2={x} y2={y} pointerEvents="none" />
        <circle className="joinery-corner-point" cx={c.point.x} cy={-c.point.y} r={2 * pixel} pointerEvents="none" />
        <circle className="joinery-corner-hit" cx={x} cy={y} r={22 * pixel} />
        <circle className="joinery-corner-halo" cx={x} cy={y} r={15 * pixel} pointerEvents="none" />
        <circle className="joinery-corner-dot" cx={x} cy={y} r={10 * pixel} pointerEvents="none" />
        <text x={x} y={y} fontSize={11 * pixel} textAnchor="middle" dominantBaseline="central">{i + 1}</text>
      </g>;
      })}
    </svg>
    <div className="joinery-view-tools" role="group" aria-label="预览视图控制">
      <button type="button" onClick={fitAll} data-tooltip="适配整个零件 · 0"><Maximize size={15} />整个零件</button>
      <button type="button" onClick={fitSelected} disabled={!target} data-tooltip="放大当前加工轮廓"><Focus size={15} />放大所选</button>
      <div className="joinery-zoom">
        <button type="button" aria-label="缩小清角预览" onClick={() => zoomCenter(1 / 1.3)}><Minus size={16} /></button>
        <output aria-label="预览缩放比例">{Math.round(fitted.width / view.width * 100)}%</output>
        <button type="button" aria-label="放大清角预览" onClick={() => zoomCenter(1.3)}><Plus size={16} /></button>
      </div>
    </div>
    <div className="joinery-preview-caption"><div className="joinery-legend">{hasResult ? <><span>原轮廓</span><span>清角后</span></> : <span>所选轮廓</span>}</div><span>单位 mm</span></div>
    <p>滚轮缩放 · 拖动平移 · 点击编号勾选清角位置</p>
  </section>;
}
