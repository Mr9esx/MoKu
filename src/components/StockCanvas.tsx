import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { useWorkbench } from "../store";
import { transformPoints } from "../core/geometry";
import { points, displayPoints } from "../core/export";
import { settlePlacement, snapPlacement, type Guide } from "../core/editing";
import { fitCanvasViewport } from "../core/canvasViewport";
import type { Layout, LayoutMetrics, Placement, Project } from "../core/types";
export function StockCanvas({
  layout,
  metrics,
  project: provided,
  tool = "select",
  magnet = true,
  interactionBlocked = false,
}: {
  layout: Layout;
  metrics: LayoutMetrics;
  project?: Project;
  tool?: "select" | "hand";
  magnet?: boolean;
  interactionBlocked?: boolean;
}) {
  const s = useWorkbench(),
    project = provided ?? s.project!;
  const candidateVisible = !!s.candidate || s.status === "searching";
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [ghost, setGhost] = useState<Placement | null>(null),
    [guides, setGuides] = useState<Guide[]>([]);
  const [viewport, setViewport] = useState({
    width: 1,
    height: 1,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  });
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{
      start: { x: number; y: number };
      clientStart: { x: number; y: number };
      moved: boolean;
      pan: { x: number; y: number };
      placement?: Placement;
      offset?: number;
      sheetHeight?: number;
    } | null>(null);
  useLayoutEffect(() => {
    const node = svg.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect(),
        style = getComputedStyle(node);
      const inset = (side: string) =>
        parseFloat(style.getPropertyValue(`--canvas-fit-${side}`)) || 0;
      setViewport({
        width: rect.width,
        height: rect.height,
        left: inset("left"),
        right: inset("right"),
        top: inset("top"),
        bottom: inset("bottom"),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [candidateVisible]);
  const offsets = layout.sheets.map((_, i) =>
    layout.sheets.slice(0, i).reduce((n, v) => n + v.width + 160, 60),
  );
  const width = Math.max(
      500,
      layout.sheets.reduce((n, v) => n + v.width + 160, 0),
    ),
    height = Math.max(500, ...layout.sheets.map((v) => v.height)) + 180;
  const fitted = fitCanvasViewport({ width, height }, viewport, viewport);
  const fit = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const local = (x: number, y: number) => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return { x, y };
    const p = new DOMPoint(x, y).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  };
  const draggedPlacement = (
    d: NonNullable<typeof drag.current>,
    cursor: { x: number; y: number },
  ): Placement => {
    const source = d.placement!;
    const x = source.x + (d.offset ?? 0) + cursor.x - d.start.x;
    const y = 85 + (d.sheetHeight ?? 0) - source.y + cursor.y - d.start.y;
    let i = layout.sheets.findIndex(
      (v, j) =>
        cursor.x >= offsets[j] &&
        cursor.x <= offsets[j] + v.width &&
        cursor.y >= 85 &&
        cursor.y <= 85 + v.height,
    );
    if (i < 0) i = layout.sheets.findIndex((v) => v.id === source.sheetId);
    const sheet = layout.sheets[i];
    const p: Placement = {
      ...source,
      sheetId: sheet.id,
      x: x - offsets[i],
      y: sheet.height + 85 - y,
    };
    return p;
  };
  const zoomAround = (next: number, cursor: { x: number; y: number }) => {
    setPan({
      x: cursor.x - ((cursor.x - fitted.x - pan.x) * zoom) / next - fitted.x,
      y: cursor.y - ((cursor.y - fitted.y - pan.y) * zoom) / next - fitted.y,
    });
    setZoom(next);
  };
  const adjustZoom = (factor: number) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAround(
      Math.max(0.4, Math.min(12, zoom * factor)),
      local(
        rect.left + (viewport.width + viewport.left - viewport.right) / 2,
        rect.top + (viewport.height + viewport.top - viewport.bottom) / 2,
      ),
    );
  };
  const clear = () => {
    drag.current = null;
    setGhost(null);
    setGuides([]);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if (interactionBlocked) return;
      if (e.key === "Escape" && drag.current) {
        e.preventDefault();
        clear();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        fit();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [interactionBlocked]);
  useEffect(() => {
    clear();
  }, [layout]);
  useEffect(() => {
    const node = svg.current;
    if (!node) return;
    const prevent = (event: WheelEvent) => event.preventDefault();
    node.addEventListener("wheel", prevent, { passive: false });
    return () => node.removeEventListener("wheel", prevent);
  }, []);
  return (
    <section className={`drawing tool-${tool}`}>
      <svg
        ref={svg}
        className="stock-svg"
        aria-label="板材和零件二维预览"
        viewBox={`${fitted.x + pan.x} ${fitted.y + pan.y} ${fitted.width / zoom} ${fitted.height / zoom}`}
        onDragOver={(e) => {
          if (
            s.view === "current" &&
            e.dataTransfer.types.includes("application/x-wood-part")
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (s.view !== "current") return;
          const id = e.dataTransfer.getData("application/x-wood-part"),
            part = project.parts.find((p) => p.id === id);
          if (!part || layout.placements.some((p) => p.partId === id)) return;
          const cursor = local(e.clientX, e.clientY),
            i = layout.sheets.findIndex(
              (v, j) =>
                cursor.x >= offsets[j] &&
                cursor.x <= offsets[j] + v.width &&
                cursor.y >= 85 &&
                cursor.y <= 85 + v.height,
            );
          if (i < 0) return;
          const placement = settlePlacement(
            project,
            layout,
            {
              partId: id,
              sheetId: layout.sheets[i].id,
              x: cursor.x - offsets[i],
              y: layout.sheets[i].height + 85 - cursor.y - part.height,
              rotation: 0,
            },
            s.settings,
          );
          if (placement) s.movePart(placement);
        }}
        onWheel={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const scale = Math.max(
            fitted.width / zoom / rect.width,
            fitted.height / zoom / rect.height,
          );
          if (e.ctrlKey || e.metaKey) {
            const cursor = local(e.clientX, e.clientY),
              next = Math.max(
                0.4,
                Math.min(12, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)),
              );
            zoomAround(next, cursor);
          } else {
            setPan({
              x: pan.x + (e.shiftKey ? e.deltaY : e.deltaX) * scale,
              y: pan.y + (e.shiftKey ? 0 : e.deltaY) * scale,
            });
          }
        }}
        onPointerDown={(e) => {
          if (!drag.current) {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = {
              start: local(e.clientX, e.clientY),
              clientStart: { x: e.clientX, y: e.clientY },
              moved: false,
              pan,
            };
          }
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          d.moved ||=
            Math.hypot(
              e.clientX - d.clientStart.x,
              e.clientY - d.clientStart.y,
            ) > 4;
          if (!d.moved) return;
          const cursor = local(e.clientX, e.clientY);
          if (!d.placement) {
            setPan({
              x: pan.x + d.start.x - cursor.x,
              y: pan.y + d.start.y - cursor.y,
            });
            return;
          }
          const p = draggedPlacement(d, cursor);
          const scale = 1 / (svg.current?.getScreenCTM()?.a ?? 1);
          const snapped = snapPlacement(
            project,
            layout,
            p,
            s.settings,
            8 * scale,
            magnet && !e.altKey,
          );
          setGhost(snapped.placement);
          setGuides(snapped.guides);
        }}
        onPointerUp={(e) => {
          if (drag.current)
            drag.current.moved ||=
              Math.hypot(
                e.clientX - drag.current.clientStart.x,
                e.clientY - drag.current.clientStart.y,
              ) > 4;
          if (drag.current?.placement && drag.current.moved) {
            const raw = draggedPlacement(
              drag.current,
              local(e.clientX, e.clientY),
            );
            const scale = 1 / (svg.current?.getScreenCTM()?.a ?? 1);
            const snapped = snapPlacement(
              project,
              layout,
              raw,
              s.settings,
              8 * scale,
              magnet && !e.altKey,
            );
            const placement = settlePlacement(
              project,
              layout,
              snapped.placement,
              s.settings,
            );
            if (placement) s.movePart(placement);
          } else if (
            drag.current &&
            !drag.current.placement &&
            !drag.current.moved
          )
            s.select(null);
          clear();
        }}
        onPointerCancel={clear}
      >
        {layout.sheets.map((sheet, i) => (
          <g key={sheet.id} transform={`translate(${offsets[i]} 85)`}>
            <text className="sheet-title" y={-36}>
              {String(
                project.sheets.findIndex((v) => v.id === sheet.id) + 1,
              ).padStart(2, "0")}{" "}
              / {sheet.thickness} mm{" "}
              {s.source && !s.source.sheets.some((v) => v.id === sheet.id)
                ? "· 新增板材"
                : ""}
            </text>
            <text
              className="dimension"
              x={sheet.width}
              y={-36}
              textAnchor="end"
            >
              {sheet.width} × {sheet.height}
            </text>
            <rect
              className="sheet-outline"
              width={sheet.width}
              height={sheet.height}
              strokeWidth="2"
            />
            {metrics.remnants
              .filter((r) => r.sheetId === sheet.id)
              .map((r) => (
                <rect
                  className="remnant-outline"
                  key={r.sheetId}
                  x={r.x}
                  y={sheet.height - r.y - r.height}
                  width={r.width}
                  height={r.height}
                  strokeDasharray="12 8"
                  strokeWidth="1"
                  pointerEvents="none"
                />
              ))}
            {[
              ...layout.placements.filter((p) => p.sheetId === sheet.id),
              ...(ghost?.sheetId === sheet.id ? [ghost] : []),
            ].map((p, index) => {
              const part = project.parts.find((v) => v.id === p.partId);
              if (!part) return null;
              const isGhost = p === ghost,
                selected = s.selected === part.id;
              const label = displayPoints(
                transformPoints([part.label], part, p),
                sheet.height,
              )[0];
              const poly = (outline: typeof part.outline) =>
                points(
                  displayPoints(
                    transformPoints(outline, part, p),
                    sheet.height,
                  ),
                );
              return (
                <g
                  key={`${p.partId}-${index}`}
                  className={`part ${selected ? "selected" : ""}`}
                  opacity={isGhost ? 0.6 : ghost?.partId === part.id ? 0.35 : 1}
                  pointerEvents={isGhost ? "none" : undefined}
                  onPointerDown={(e) => {
                    if (tool === "hand") return;
                    e.stopPropagation();
                    s.select(part.id);
                    if (s.view !== "current") return;
                    if (p.locked) return;
                    svg.current?.setPointerCapture(e.pointerId);
                    drag.current = {
                      start: local(e.clientX, e.clientY),
                      clientStart: { x: e.clientX, y: e.clientY },
                      moved: false,
                      pan,
                      placement: p,
                      offset: offsets[i],
                      sheetHeight: sheet.height,
                    };
                  }}
                >
                  <title>{`${part.name} · ${part.width.toFixed(1)} × ${part.height.toFixed(1)} mm`}</title>
                  <polygon
                    className={`part-outline ${part.thickness > 5 ? "thick" : "thin"}`}
                    points={poly(part.outline)}
                    strokeWidth={selected ? 6 : 1.7}
                  />
                  {part.pockets.map((v, j) => (
                    <polygon
                      className="pocket-outline"
                      key={`p${j}`}
                      points={poly(v.outline)}
                      strokeWidth="1.3"
                    />
                  ))}
                  {part.holes.map((v, j) => (
                    <polygon
                      className="hole-outline"
                      key={`h${j}`}
                      points={poly(v)}
                      strokeWidth="1.4"
                    />
                  ))}
                  {(selected ||
                    zoom > 1.6 ||
                    Math.min(part.width, part.height) > 65) && (
                    <text
                      className="part-label"
                      x={label.x}
                      y={label.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize={selected ? 27 : 21}
                    >
                      {part.name}
                      {p.locked ? " · L" : ""}
                    </text>
                  )}
                </g>
              );
            })}
            {ghost?.sheetId === sheet.id &&
              guides.map((g, j) => (
                <line
                  key={j}
                  x1={g.axis === "x" ? g.value : 0}
                  x2={g.axis === "x" ? g.value : sheet.width}
                  y1={g.axis === "y" ? sheet.height - g.value : 0}
                  y2={g.axis === "y" ? sheet.height - g.value : sheet.height}
                  stroke="#2781c4"
                  strokeWidth="2"
                  strokeDasharray="8 5"
                  pointerEvents="none"
                />
              ))}
          </g>
        ))}
      </svg>
      <div className="zoom-controls floating">
        <button
          data-tooltip="缩小"
          aria-label="缩小"
          onClick={() => adjustZoom(1 / 1.2)}
        >
          <Minus size={15} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button data-tooltip="放大" aria-label="放大" onClick={() => adjustZoom(1.2)}>
          <Plus size={15} />
        </button>
        <button
          data-tooltip="适合全部板材 · Ctrl/⌘ 0"
          aria-label="适合全部板材"
          onClick={fit}
        >
          <Maximize size={15} />
        </button>
      </div>
    </section>
  );
}
