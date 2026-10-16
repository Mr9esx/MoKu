import type { Project } from "../core/types";
import { Thumbnail } from "./Thumbnail";
export function PartCanvas({ project, selected, select }: { project: Project; selected: string | null; select: (id: string) => void }) {
  return <section className="parts-drawing-stage" aria-label="零件图纸">
    <div className="parts-drawing-heading"><h2>零件图纸</h2></div>
    <div className="parts-drawing-grid">{project.parts.map(p => <button key={p.id} className="parts-drawing-card"
      aria-label={`查看零件 ${p.name}`} aria-pressed={selected === p.id} onClick={() => select(p.id)}>
      <Thumbnail part={p} />
      <strong data-tooltip-overflow={p.name}>{p.name}</strong>
      <span>{p.width.toFixed(1)} × {p.height.toFixed(1)} mm</span>
    </button>)}</div>
  </section>;
}
