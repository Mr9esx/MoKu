import { transformPoints } from "../core/geometry";
import type { Part, Point, Project } from "../core/types";

const path = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") + " Z";
function PartShape({ part, outline, holes, pockets }: { part: Part; outline: Point[]; holes: Point[][]; pockets: Point[][] }) {
  return <g data-tooltip={`${part.name} · ${part.width.toFixed(1)} × ${part.height.toFixed(1)} mm`}>
    <title>{`${part.name} · ${part.width.toFixed(1)} × ${part.height.toFixed(1)} mm`}</title>
    <path className="import-part-shape" d={[outline, ...holes].map(path).join(" ")} fillRule="evenodd" />
    {pockets.map((p, i) => <path key={i} className="import-pocket-shape" d={path(p)}
      data-tooltip={`${part.name} · 铣槽，${part.pockets[i].width ? `宽 ${part.pockets[i].width} mm，` : ""}深 ${part.pockets[i].depth} mm`}>
      <title>{`${part.name} · 铣槽，${part.pockets[i].width ? `宽 ${part.pockets[i].width} mm，` : ""}深 ${part.pockets[i].depth} mm`}</title></path>)}
    {holes.map((hole, i) => <path key={i} className="import-hole-shape" d={path(hole)}
      data-tooltip={`${part.name} · 通孔`}><title>{`${part.name} · 通孔`}</title></path>)}
  </g>;
}
export function ImportDrawingPreview({ draft, stockId, selectStock }: {
  draft: Project; stockId: string; selectStock: (id: string) => void;
}) {
  const stock = draft.sheets.find(s => s.id === stockId) ?? draft.sheets[0];
  const legend = <p className="import-legend"><span className="legend-outline">零件轮廓</span><span className="legend-hole">通孔</span><span className="legend-pocket">铣槽</span></p>;
  const placedIds = new Set(draft.original.placements.map(p => p.partId));
  const pending = draft.parts.filter(p => !placedIds.has(p.id));
  const gallery = !!pending.length && <details className="import-pending-preview" aria-label="待放置零件预览" open={!stock}>
    <summary>待放置零件 <span>{pending.length} 个</span></summary>
    <div className="import-part-gallery">{pending.map(part => {
      const padding = Math.max(part.width, part.height) * 0.08 || 1;
      return <figure key={part.id}>
        <svg role="img" aria-label={`${part.name} 轮廓预览`} viewBox={`${-padding} ${-padding} ${part.width + padding * 2} ${part.height + padding * 2}`}>
          <g transform={`translate(0 ${part.height}) scale(1 -1)`}>
            <PartShape part={part} outline={part.outline} holes={part.holes} pockets={part.pockets.map(p => p.outline)} />
          </g>
        </svg>
        <figcaption><strong data-tooltip-overflow={part.name}>{part.name}</strong><span>{part.width.toFixed(1)} × {part.height.toFixed(1)} mm</span></figcaption>
      </figure>;
    })}</div>
  </details>;
  if (!stock) return <section className="import-visual" aria-label="零件图形预览">{gallery}{legend}</section>;
  const padding = Math.max(stock.width, stock.height) * 0.04;
  const parts = new Map(draft.parts.map(p => [p.id, p]));
  const placements = draft.original.placements.filter(p => p.sheetId === stock.id);
  return <section className="import-visual" aria-label="板材图形预览">
    <div className="import-board-tabs" role="group" aria-label="选择预览板材">
      {draft.sheets.map(s => <button key={s.id} aria-pressed={s.id === stock.id} onClick={() => selectStock(s.id)}>{s.name}</button>)}
    </div>
    <div className="import-board-stage">
      <svg role="img" aria-label={`${stock.name} · ${placements.length} 个零件图形预览`}
        viewBox={`${-padding} ${-padding} ${stock.width + padding * 2} ${stock.height + padding * 2}`}>
        <rect className="import-stock-shape" width={stock.width} height={stock.height} />
        <g transform={`translate(0 ${stock.height}) scale(1 -1)`}>
          {placements.map(placement => {
            const part = parts.get(placement.partId);
            if (!part) return null;
            return <PartShape key={part.id} part={part} outline={transformPoints(part.outline, part, placement)}
              holes={part.holes.map(h => transformPoints(h, part, placement))}
              pockets={part.pockets.map(p => transformPoints(p.outline, part, placement))} />;
          })}
        </g>
      </svg>
    </div>
    <div className="import-board-caption"><span>{stock.width.toFixed(0)} × {stock.height.toFixed(0)} mm</span><span>{placements.length} 个零件</span></div>
    {gallery}
    {legend}
  </section>;
}
