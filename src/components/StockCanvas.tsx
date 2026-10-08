import { useEffect, useRef, useState } from "react";
import { Maximize, Minus, Plus, Magnet } from "lucide-react";
import { useWorkbench } from "../store";
import { transformPoints } from "../core/geometry";
import { points, displayPoints } from "../core/export";
import { snapPlacement, type Guide } from "../core/editing";
import type { Layout, LayoutMetrics, Placement, Project } from "../core/types";
export function StockCanvas({
  layout,
  metrics,
  project: provided,
  tool = "select",
  magnet = true,
  onMagnet,
}: {
  layout: Layout;
  metrics: LayoutMetrics;
  project?: Project;
  tool?: "select" | "hand";
  magnet?: boolean;
  onMagnet?: () => void;
}) {
  const s = useWorkbench(),
    project = provided ?? s.project!;
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [ghost, setGhost] = useState<Placement | null>(null),
    [guides, setGuides] = useState<Guide[]>([]);
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{
      start: { x: number; y: number };
      pan: { x: number; y: number };
      placement?: Placement;
      offset?: number;
      sheetHeight?: number;
    } | null>(null);
  const offsets = layout.sheets.map((_, i) =>
    layout.sheets.slice(0, i).reduce((n, v) => n + v.width + 160, 60),
  );
  const width = Math.max(
      500,
      layout.sheets.reduce((n, v) => n + v.width + 160, 0),
    ),
    height = Math.max(500, ...layout.sheets.map((v) => v.height)) + 180;
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
      if (e.key === "Escape") clear();
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        fit();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
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
        viewBox={`${pan.x} ${pan.y} ${width / zoom} ${height / zoom}`}
        onWheel={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const scale = Math.max(
            width / zoom / rect.width,
            height / zoom / rect.height,
          );
          if (e.ctrlKey || e.metaKey) {
            const cursor = local(e.clientX, e.clientY),
              next = Math.max(
                0.4,
                Math.min(12, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)),
              );
            setPan({
              x: cursor.x - ((cursor.x - pan.x) * zoom) / next,
              y: cursor.y - ((cursor.y - pan.y) * zoom) / next,
            });
            setZoom(next);
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
            drag.current = { start: local(e.clientX, e.clientY), pan };
          }
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const cursor = local(e.clientX, e.clientY);
          if (!d.placement) {
            setPan({
              x: pan.x + d.start.x - cursor.x,
              y: pan.y + d.start.y - cursor.y,
            });
            return;
          }
          const source = d.placement;
          const x = source.x + (d.offset ?? 0) + cursor.x - d.start.x;
          const y = 85 + (d.sheetHeight ?? 0) - source.y + cursor.y - d.start.y;
          let i = layout.sheets.findIndex(
            (v, j) =>
              cursor.x >= offsets[j] &&
              cursor.x <= offsets[j] + v.width &&
              cursor.y >= 85 &&
              cursor.y <= 85 + v.height,
          );
          if (i < 0)
            i = layout.sheets.findIndex((v) => v.id === source.sheetId);
          const sheet = layout.sheets[i];
          const p = {
            ...source,
            sheetId: sheet.id,
            x: x - offsets[i],
            y: sheet.height + 85 - y,
          };
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
        onPointerUp={() => {
          if (ghost) s.movePart(ghost);
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
              width={sheet.width}
              height={sheet.height}
              fill="#fffefa"
              stroke="#a0a79b"
              strokeWidth="2"
            />
            {metrics.remnants
              .filter((r) => r.sheetId === sheet.id)
              .map((r) => (
                <rect
                  key={r.sheetId}
                  x={r.x}
                  y={sheet.height - r.y - r.height}
                  width={r.width}
                  height={r.height}
                  fill="#b7c7ab"
                  fillOpacity=".10"
                  stroke="#9aaa91"
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
                      pan,
                      placement: p,
                      offset: offsets[i],
                      sheetHeight: sheet.height,
                    };
                  }}
                >
                  <title>{`${part.name} · ${part.width.toFixed(1)} × ${part.height.toFixed(1)} mm`}</title>
                  <polygon
                    points={poly(part.outline)}
                    fill={part.thickness > 5 ? "#cdb68e" : "#a8b59b"}
                    stroke={selected ? "#26392e" : "#877c67"}
                    strokeWidth={selected ? 6 : 1.7}
                  />
                  {part.pockets.map((v, j) => (
                    <polygon
                      key={`p${j}`}
                      points={poly(v.outline)}
                      fill="#e9e8d8"
                      stroke="#aaa998"
                      strokeWidth="1.3"
                    />
                  ))}
                  {part.holes.map((v, j) => (
                    <polygon
                      key={`h${j}`}
                      points={poly(v)}
                      fill="#aac7d7"
                      stroke="#628797"
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
          title="缩小"
          aria-label="缩小"
          onClick={() => setZoom(Math.max(0.4, zoom / 1.2))}
        >
          <Minus size={15} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          title="放大"
          aria-label="放大"
          onClick={() => setZoom(Math.min(12, zoom * 1.2))}
        >
          <Plus size={15} />
        </button>
        <button
          title="适合全部板材 · Ctrl/⌘ 0"
          aria-label="适合全部板材"
          onClick={fit}
        >
          <Maximize size={15} />
        </button>
        <button
          className={magnet ? "active" : ""}
          title="弱磁吸 · Alt 暂时关闭"
          aria-label="弱磁吸"
          aria-pressed={magnet}
          onClick={onMagnet}
        >
          <Magnet size={15} />
        </button>
      </div>
    </section>
  );
}
