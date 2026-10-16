import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { zoomCanvasViewport, type CanvasViewport } from "../core/canvasViewport";
import { useWheelZoomFactor } from "./useWheelZoomFactor";
import { fitDrawingCanvas } from "../core/drawingCanvas";
import type { Point } from "../core/types";

export type DrawingCanvasFocus = { points: Point[] };

export function DrawingCanvas({ points, focus, resetKey, label, children, actions, clearSelection }: {
  points: Point[]; focus?: DrawingCanvasFocus | null; resetKey?: unknown; label: string;
  children: ReactNode; actions?: ReactNode; clearSelection?: () => boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const wheelFactor = useWheelZoomFactor();
  const [size, setSize] = useState({ width: 600, height: 400 });
  const [camera, setCamera] = useState<{ x: number; y: number; zoom: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; start: Point; view: CanvasViewport; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const fitted = useMemo(() => fitDrawingCanvas(points, size), [points, size]);
  const scale = camera ? size.width * camera.zoom / fitted.width : 1;
  const view: CanvasViewport = camera ? {
    x: camera.x - size.width / scale / 2, y: camera.y - size.height / scale / 2,
    width: size.width / scale, height: size.height / scale,
  } : fitted;
  const viewRef = useRef(view);
  viewRef.current = view;
  const applyView = (next: CanvasViewport) => {
    viewRef.current = next;
    setCamera({ x: next.x + next.width / 2, y: next.y + next.height / 2, zoom: fitted.width / next.width });
  };
  const fitAll = () => { setCamera(null); viewRef.current = fitted; };
  const zoomAt = (anchor: Point, factor: number) => applyView(zoomCanvasViewport(viewRef.current, anchor, factor,
    { minWidth: fitted.width / 2000, maxWidth: fitted.width * 4 }));
  const zoomCenter = (factor: number) => {
    const current = viewRef.current;
    zoomAt({ x: current.x + current.width / 2, y: current.y + current.height / 2 }, factor);
  };
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
  useLayoutEffect(() => { fitAll(); }, [resetKey]);
  useLayoutEffect(() => {
    if (focus?.points.length) applyView(fitDrawingCanvas(focus.points, size));
  }, [focus]);
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault(); event.stopPropagation();
      const matrix = node.getScreenCTM();
      if (!matrix) return;
      const anchor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      zoomAt(anchor, wheelFactor(event));
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [fitted.width, size, wheelFactor]);
  const endDrag = () => { drag.current = null; setDragging(false); };
  return <div className="drawing-review-stage drawing-canvas" onKeyDown={event => {
    if (event.key === "+" || event.key === "=") { event.preventDefault(); event.stopPropagation(); zoomCenter(1.3); }
    if (event.key === "-") { event.preventDefault(); event.stopPropagation(); zoomCenter(1 / 1.3); }
    if (event.key === "0") { event.preventDefault(); event.stopPropagation(); fitAll(); }
    if (event.key === "Escape") {
      if (drag.current) { applyView(drag.current.view); suppressClick.current = true; endDrag(); event.preventDefault(); event.stopPropagation(); }
      else if (clearSelection?.()) { event.preventDefault(); event.stopPropagation(); }
    }
  }}>
    <div className="drawing-canvas-surface">
      <svg ref={svg} role="group" tabIndex={0} aria-label={label} className={dragging ? "is-dragging" : ""}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        style={{ "--drawing-label-size": `${Math.min(11 * view.width / size.width, fitted.width / 65)}px` } as CSSProperties}
        onClickCapture={event => {
          if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; }
        }}
        onClick={event => { if (event.target === event.currentTarget) clearSelection?.(); }}
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          suppressClick.current = false;
          drag.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, view: viewRef.current, moved: false };
          event.currentTarget.focus({ preventScroll: true });
        }}
        onPointerMove={event => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          if (!(event.buttons & 1)) { endDrag(); return; }
          const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
          if (!current.moved && Math.hypot(dx, dy) <= 4) return;
          if (!current.moved) { current.moved = true; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }
          suppressClick.current = true;
          applyView({ ...current.view,
            x: current.view.x - dx * current.view.width / size.width,
            y: current.view.y - dy * current.view.height / size.height });
        }}
        onPointerUp={event => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          suppressClick.current ||= current.moved || Math.hypot(event.clientX - current.start.x, event.clientY - current.start.y) > 4;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          endDrag();
        }}
        onPointerCancel={() => { suppressClick.current = true; endDrag(); }}
        onLostPointerCapture={endDrag}>
        {children}
      </svg>
      <div className="drawing-canvas-tools" role="group" aria-label="画布视野">
        <button type="button" onClick={() => zoomCenter(1 / 1.3)} aria-label="缩小图纸" data-tooltip="缩小 · −"><Minus size={15} /></button>
        <button type="button" onClick={() => zoomCenter(1.3)} aria-label="放大图纸" data-tooltip="放大 · +"><Plus size={15} /></button>
        <button type="button" onClick={fitAll} aria-label="适应全图" data-tooltip="适应全图 · 0"><Maximize size={15} /></button>
      </div>
    </div>
    {actions && <div className="drawing-canvas-actions" role="group" aria-label="选中图形操作">{actions}</div>}
  </div>;
}
