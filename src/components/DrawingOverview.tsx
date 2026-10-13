import type { Project } from "../core/types";
export function DrawingOverview({ project, onStock }: { project: Project; onStock: () => void }) {
  return <aside className="analysis-panel floating" aria-label="图纸概览">
    <div className="panel-heading"><strong>图纸概览</strong><span className="section-index">02</span></div>
    <div className="analysis-body">
      <dl className="analysis-stats">
        <div><dt>零件</dt><dd>{project.parts.length} 个</dd></div>
        <div><dt>通孔</dt><dd>{project.parts.reduce((n, p) => n + p.holes.length, 0)} 个</dd></div>
        <div><dt>铣槽</dt><dd>{project.parts.reduce((n, p) => n + p.pockets.length, 0)} 个</dd></div>
        <div><dt>图纸单位</dt><dd>mm</dd></div>
      </dl>
      <p className="hint">选择一个零件，查看轮廓、编辑榫槽或导出图纸。</p>
      <div className="drawing-stock-entry"><h3>安排用料</h3><p className="hint">需要排版时，先添加板材。</p>
        <button onClick={onStock}>新增板材</button></div>
    </div>
  </aside>;
}
