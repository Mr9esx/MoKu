import { useMemo, useRef, useState } from "react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useWorkbench } from "../store";
import { measureLayout, transformPoints } from "../core/geometry";
import { points, displayPoints } from "../core/export";
import type { Layout } from "../core/types";
export function StockCanvas({ layout }: { layout: Layout }) {
  const s = useWorkbench(),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [remnants, setRemnants] = useState(true);
  const drag = useRef<{ x: number; y: number; pan: typeof pan } | null>(null);
  const project = s.project!;
  const metrics = useMemo(
    () => measureLayout(project, layout, s.settings),
    [project, layout, s.settings],
  );
  const thicknessLegend = (thick: boolean) =>
    [
      ...new Set(
        layout.sheets
          .filter((sheet) => sheet.thickness > 5 === thick)
          .map((sheet) => sheet.thickness),
      ),
    ]
      .sort((a, b) => a - b)
      .join(" / ") + " mm 板材";
  const gap = 160,
    total = layout.sheets.reduce((n, v) => n + v.width + gap, 0) - gap,
    height = Math.max(...layout.sheets.map((v) => v.height));
  const width = total + 120,
    fullHeight = height + 180;
  const offsets = layout.sheets.map((_, i) =>
    layout.sheets.slice(0, i).reduce((n, v) => n + v.width + gap, 60),
  );
  const changeZoom = (n: number) => setZoom(Math.max(1, Math.min(7, n)));
  return (
    <section className="drawing">
      <div className="drawing-toolbar">
        <span>
          二维排版 <small>/ 单位 mm</small>
        </span>
        <div>
          <label className="check">
            <input
              type="checkbox"
              checked={remnants}
              onChange={(e) => setRemnants(e.target.checked)}
            />
            余料参考
          </label>
          <button title="缩小" onClick={() => changeZoom(zoom / 1.3)}>
            <ZoomOut size={17} />
          </button>
          <button title="放大" onClick={() => changeZoom(zoom * 1.3)}>
            <ZoomIn size={17} />
          </button>
          <button
            title="适合全部板材"
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            <Maximize size={17} />
          </button>
        </div>
      </div>
      <svg
        aria-label="板材和零件二维预览"
        className="stock-svg"
        viewBox={`${pan.x} ${pan.y} ${width / zoom} ${fullHeight / zoom}`}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            changeZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
          }
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, pan };
          }
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const scale =
              width / zoom / e.currentTarget.getBoundingClientRect().width;
            setPan({
              x: drag.current.pan.x - (e.clientX - drag.current.x) * scale,
              y: drag.current.pan.y - (e.clientY - drag.current.y) * scale,
            });
          }
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {layout.sheets.map((sheet, i) => (
          <g key={sheet.id} transform={`translate(${offsets[i]} 85)`}>
            <text className="sheet-title" x={0} y={-42}>
              {String(i + 1).padStart(2, "0")} / {sheet.thickness} mm
            </text>
            <text
              className="dimension"
              x={sheet.width}
              y={-42}
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
            {remnants &&
              metrics.remnants
                .filter((r) => r.sheetId === sheet.id)
                .map((r) => (
                  <g key={r.sheetId}>
                    <rect
                      x={r.x}
                      y={sheet.height - r.y - r.height}
                      width={r.width}
                      height={r.height}
                      fill="#b7c7ab"
                      fillOpacity=".16"
                      stroke="#648060"
                      strokeDasharray="12 8"
                      strokeWidth="2"
                    />
                    <text
                      x={r.x + 10}
                      y={sheet.height - r.y - r.height + 28}
                      fontSize="22"
                      fill="#648060"
                    >
                      {Math.floor(r.width)} × {Math.floor(r.height)}
                    </text>
                  </g>
                ))}
            {layout.placements
              .filter((p) => p.sheetId === sheet.id)
              .map((p) => {
                const part = project.parts.find((v) => v.id === p.partId)!;
                const label = displayPoints(
                  transformPoints([part.label], part, p),
                  sheet.height,
                )[0];
                const selected = s.selected === part.id;
                return (
                  <g
                    key={part.id}
                    className={`part ${selected ? "selected" : ""}`}
                    onClick={() => s.select(part.id)}
                  >
                    <title>
                      {part.name} · {Math.round(part.width)} ×{" "}
                      {Math.round(part.height)} mm · {part.thickness} mm
                      {p.locked ? " · 已锁定" : ""}
                    </title>
                    <polygon
                      points={points(
                        displayPoints(
                          transformPoints(part.outline, part, p),
                          sheet.height,
                        ),
                      )}
                      fill={part.thickness > 5 ? "#cdb68e" : "#a8b59b"}
                      stroke={selected ? "#25382e" : "#877c67"}
                      strokeWidth={selected ? 9 : 2}
                    />
                    {part.pockets.map((pocket, j) => (
                      <polygon
                        key={`p${j}`}
                        points={points(
                          displayPoints(
                            transformPoints(pocket.outline, part, p),
                            sheet.height,
                          ),
                        )}
                        fill="#e9e8d8"
                        stroke="#aaa998"
                        strokeWidth="1.3"
                      />
                    ))}
                    {part.holes.map((hole, j) => (
                      <polygon
                        key={`h${j}`}
                        points={points(
                          displayPoints(
                            transformPoints(hole, part, p),
                            sheet.height,
                          ),
                        )}
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
                        fontSize={selected ? 29 : 23}
                      >
                        {part.name}
                        {p.locked ? " · L" : ""}
                      </text>
                    )}
                  </g>
                );
              })}
            <text
              className="dimension"
              transform={`translate(-24 ${sheet.height / 2}) rotate(-90)`}
              textAnchor="middle"
            >
              {sheet.height} mm
            </text>
          </g>
        ))}
      </svg>
      <div className="legend">
        {layout.sheets.some((sheet) => sheet.thickness > 5) && (
          <span>
            <i className="tan" />
            {thicknessLegend(true)}
          </span>
        )}
        {layout.sheets.some((sheet) => sheet.thickness <= 5) && (
          <span>
            <i className="sage" />
            {thicknessLegend(false)}
          </span>
        )}
        <span>
          <i className="blue" />
          通孔
        </span>
        <span>
          <i className="pale" />
          铣槽
        </span>
        <small>点击零件查看 · Ctrl / ⌘ + 滚轮缩放 · 拖动空白平移</small>
      </div>
    </section>
  );
}
