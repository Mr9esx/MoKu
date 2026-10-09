import { useWorkbench } from "../store";

/** Plot actual, independently verified utilization, never a fitness surrogate. */
export function EfficiencyChart() {
  const s = useWorkbench();
  const progress = s.searchProgress;
  const result = s.candidate?.search;
  const running = s.status === "searching";
  const curve = running ? progress?.curve : result?.curve ?? progress?.curve;
  if (!curve?.length) return null;
  const last = curve[curve.length - 1];
  const limit = running ? progress?.patience?.limit : result?.patienceLimit ?? progress?.patience?.limit;
  const points = curve.filter(p => p.efficiency !== null);
  const x = (generation: number) => 40 + 280 * generation / Math.max(1, last.generation);
  const y = (efficiency: number) => 12 + 80 * (1 - efficiency);
  const path = points.map((p, i) => i === 0
    ? `M${x(p.generation)},${y(p.efficiency!)}`
    : `H${x(p.generation)}V${y(p.efficiency!)}`).join(" ");
  const value = last.efficiency === null ? "待验证" : `${(last.efficiency * 100).toFixed(2)}%`;
  const reason = running ? "搜索中" : result?.stoppedBy === "plateau" ? "平台期停止"
    : result?.stoppedBy === "manual" || s.status === "idle" ? "手动停止"
    : limit && last.unchanged >= limit ? "平台期停止" : "搜索结束";
  return <section className="efficiency-chart" aria-label="利用率曲线">
    <div className="efficiency-heading">
      <span data-tooltip="完整排版通过独立校验后，按全部零件外轮廓面积 ÷ 实际使用板材面积计算。记录搜索中见过的最高值；候选仍按所选优化模式排序。" tabIndex={0}>
        利用率 <small>Efficiency</small>
      </span>
      <strong>{value}</strong>
    </div>
    <p className="efficiency-caption">最高已验证利用率 · {reason}</p>
    <svg viewBox="0 0 330 116" role="img" aria-label={`最高利用率 ${value}，每组已完成 ${last.generation} 代，连续 ${last.unchanged} 代未提高`}>
      <title>最高已验证利用率随每组完成代数的变化</title>
      {[0, 0.5, 1].map(v => <g key={v}>
        <line className="efficiency-grid" x1="40" x2="320" y1={y(v)} y2={y(v)} />
        <text x="32" y={y(v) + 3} textAnchor="end">{v * 100}%</text>
      </g>)}
      <text x="40" y="110">0</text>
      <text x="320" y="110" textAnchor="end">{last.generation} 代 / 组</text>
      {points.length > 0 && <>
        <path className="efficiency-line" d={path} />
        <circle className="efficiency-dot" cx={x(last.generation)} cy={y(last.efficiency!)} r="3" />
      </>}
    </svg>
    <div className="efficiency-patience">
      <span>{last.efficiency === null ? "尚无完整合法方案" : "连续未提高"}</span>
      <span>{last.unchanged} / {limit} 代</span>
    </div>
  </section>;
}
