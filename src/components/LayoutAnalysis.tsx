import { useMemo, useState } from "react";
import { EfficiencyChart } from "./EfficiencyChart";

import { measureLayout, polygonArea, concentratedRemnantArea } from "../core/geometry";
import { modeLabels } from "../core/types";
import type {
  Layout,
  LayoutIssue,
  LayoutMetrics,
  NestSettings,
  Project,
  NestResult,
} from "../core/types";

const percent = (n: number) => `${(n * 100).toFixed(1)}%`;
const area = (n: number) => `${(n / 1e6).toFixed(3)} m²`;
const netArea = (project: Project, layout: Layout) =>
  project.parts
    .filter((p) => layout.placements.some((v) => v.partId === p.id))
    .reduce(
      (sum, part) =>
        sum +
        polygonArea(part.outline) -
        part.holes.reduce((holes, outline) => holes + polygonArea(outline), 0),
      0,
    );
const labels = {
  original: "原始图纸",
  current: "当前排版",
  candidate: "候选方案",
};

export function LayoutAnalysis({
  project,
  layout,
  metrics,
  source,
  currentProject,
  current,
  candidate,
  searchResult,
  settings,
  view,
  issues,
  onCheck,
}: {
  project: Project;
  layout: Layout;
  metrics: LayoutMetrics;
  source: Project | null;
  currentProject: Project | null;
  current: Layout | null;
  candidate: Layout | null;
  searchResult?: NestResult | null;
  settings: NestSettings;
  view: "original" | "current" | "candidate";
  issues: LayoutIssue[];
  onCheck: () => void;
}) {
  const net = useMemo(() => netArea(project, layout), [project, layout]);
  const sheets = useMemo(() => {
    const parts = new Map(project.parts.map((part) => [part.id, part]));
    return layout.sheets.map((stock) => {
      const placed = layout.placements.filter((p) => p.sheetId === stock.id);
      let gross = 0,
        net = 0;
      for (const placement of placed) {
        const part = parts.get(placement.partId);
        if (!part) continue;
        const outline = polygonArea(part.outline);
        gross += outline;
        net +=
          outline -
          part.holes.reduce((sum, hole) => sum + polygonArea(hole), 0);
      }
      return {
        stock,
        count: placed.length,
        gross,
        net,
        remnant: metrics.remnants.find((r) => r.sheetId === stock.id),
      };
    });
  }, [project, layout, metrics]);
  const comparisons = useMemo(
    () =>
      (
        [
          { key: "original", project: source, layout: source?.original },
          { key: "current", project: currentProject, layout: current },
          { key: "candidate", project: currentProject, layout: candidate },
        ] as const
      ).map((row) => {
        if (!row.project || !row.layout)
          return { ...row, metrics: null, net: 0, used: 0 };
        const measured =
          row.project === project && row.layout === layout
            ? metrics
            : measureLayout(row.project, row.layout, settings);
        return {
          ...row,
          metrics: measured,
          net: netArea(row.project, row.layout),
          used: new Set(row.layout.placements.map((p) => p.sheetId)).size,
        };
      }),
    [
      source,
      currentProject,
      current,
      candidate,
      project,
      layout,
      metrics,
      settings,
    ],
  );
  const [tab, setTab] = useState<"overview" | "compare">(
    candidate ? "compare" : "overview",
  );
  const [baseline, setBaseline] = useState<"current" | "original">("current");
  const reference = comparisons.find((row) => row.key === baseline)!;
  const proposal = comparisons.find((row) => row.key === "candidate")!;
  const canCompare = !!proposal.metrics && !!reference.metrics;
  const showComparison = !!candidate && tab === "compare" && canCompare;
  const sourceDiffers = source && currentProject && (
    source.parts.map((p) => p.id).sort().join("|") !==
      currentProject.parts.map((p) => p.id).sort().join("|") ||
    source.sheets.map((p) => p.id).sort().join("|") !==
      currentProject.sheets.map((p) => p.id).sort().join("|")
  );
  const missing = project.parts.length - layout.placements.length;
  const largest = metrics.remnants.reduce<
    (typeof metrics.remnants)[number] | null
  >((best, r) => (!best || r.area > best.area ? r : best), null);
  const travelDelta = canCompare
    ? (reference.metrics!.travel - proposal.metrics!.travel) / 1000
    : 0;
  const referenceRemnant = reference.metrics && reference.project
    ? concentratedRemnantArea(reference.project, reference.metrics) : 0;
  const proposalRemnant = proposal.metrics && proposal.project
    ? concentratedRemnantArea(proposal.project, proposal.metrics) : 0;
  const remnantDelta = (proposalRemnant - referenceRemnant) / 1e6;
  const crossSheetChanges = useMemo(() => {
    const before = new Map(reference.layout?.placements.map(p => [p.partId, p.sheetId]));
    return candidate?.placements.filter(p => before.has(p.partId) && before.get(p.partId) !== p.sheetId).length ?? 0;
  }, [reference.layout, candidate]);
  return (
    <aside className="analysis-panel floating" aria-label="排版数据分析">
      <div className="panel-heading">
        <strong>排版概览</strong>
        <span className="analysis-mode">{modeLabels[settings.mode]}</span>
      </div>
      <div className="analysis-body">
        <EfficiencyChart />
        {candidate && (
          <nav className="analysis-tabs" aria-label="排版分析内容">
            <button
              className={!showComparison ? "active" : ""}
              aria-pressed={!showComparison}
              onClick={() => setTab("overview")}
            >概览</button>
            <button
              className={showComparison ? "active" : ""}
              aria-pressed={showComparison}
              disabled={!canCompare}
              onClick={() => setTab("compare")}
            >对比</button>
          </nav>
        )}
        {issues.length > 0 && (
          <button className="analysis-warning" onClick={onCheck}>
            <strong>
              {missing > 0 ? `${missing} 个零件尚未放置` : `${issues.length} 项需要核对`}
            </strong>
            <span>{issues.length} 项待核对 · 查看问题并定位 ↗</span>
          </button>
        )}
        {showComparison ? (
          <>
            <p className="comparison-intro">先核对变化，再决定是否应用。</p>
            <label className="comparison-baseline">
              比较基准
              <select
                aria-label="对比基准"
                value={baseline}
                onChange={(e) => setBaseline(e.target.value as "current" | "original")}
              >
                <option value="current">当前排版</option>
                {source && <option value="original">原始图纸</option>}
              </select>
            </label>
            {baseline === "original" && sourceDiffers && (
              <p className="warning comparison-caveat">
                原图与当前的零件或库存集合不同，利用率差异包含资源变化，不能直接视为排版提升。
              </p>
            )}
            {reference.project && reference.layout &&
              reference.layout.placements.length < reference.project.parts.length && (
              <p className="warning comparison-caveat">
                {labels[baseline]}有 {reference.project.parts.length - reference.layout.placements.length} 个待放置零件；候选包含全部零件，利用率变化也来自补齐放置。
              </p>
            )}
            <table className="comparison-table compact-comparison">
              <thead><tr><th>指标</th><th>{baseline === "current" ? "当前" : "原图"}</th><th>候选</th></tr></thead>
              <tbody>
                <tr><th>使用板材</th><td>{reference.used} 张</td><td>{proposal.used} 张</td></tr>
                <tr><th>轮廓利用率</th><td>{percent(reference.metrics!.utilization)}</td><td>{percent(proposal.metrics!.utilization)}</td></tr>
                {settings.mode === "remnant" ? (
                  <tr><th data-tooltip="按板厚和材质分组，每组保留的最大可用矩形余料合计" tabIndex={0}>连续余料</th><td>{area(referenceRemnant)}</td><td>{area(proposalRemnant)}</td></tr>
                ) : (
                  <tr><th>估算空移</th><td>{(reference.metrics!.travel / 1000).toFixed(2)} m</td><td>{(proposal.metrics!.travel / 1000).toFixed(2)} m</td></tr>
                )}
                <tr><th>跨板调整</th><td>—</td><td>{crossSheetChanges} 个零件</td></tr>
              </tbody>
            </table>
            <div className="comparison-insight">
              {settings.mode === "remnant" ? "连续余料变化" : "估算空移变化"}
              <strong>{settings.mode === "remnant"
                ? (Math.abs(remnantDelta) < 0.0005 ? "基本相同" : `${remnantDelta > 0 ? "增加" : "减少"} ${Math.abs(remnantDelta).toFixed(3)} m²`)
                : (Math.abs(travelDelta) < 0.005 ? "基本相同" : `${travelDelta > 0 ? "减少" : "增加"} ${Math.abs(travelDelta).toFixed(2)} m`)}</strong>
            </div>
            <details className="panel-disclosure comparison-details">
              <summary data-tooltip="比较净利用率、布局板面积与可用余料" data-tooltip-collapsed>对比详情</summary>
              <table className="comparison-table compact-comparison">
                <thead><tr><th>指标</th><th>{baseline === "current" ? "当前" : "原图"}</th><th>候选</th></tr></thead>
                <tbody>
                <tr><th>净利用率</th><td>{percent(reference.metrics!.stockArea ? reference.net / reference.metrics!.stockArea : 0)}</td><td>{percent(proposal.metrics!.stockArea ? proposal.net / proposal.metrics!.stockArea : 0)}</td></tr>
                <tr><th>布局板面积</th><td>{area(reference.metrics!.stockArea)}</td><td>{area(proposal.metrics!.stockArea)}</td></tr>
                <tr><th>可用余料</th><td>{area(reference.metrics!.reusableArea)}</td><td>{area(proposal.metrics!.reusableArea)}</td></tr>
                {settings.mode === "remnant" && <tr><th>估算空移</th><td>{(reference.metrics!.travel / 1000).toFixed(2)} m</td><td>{(proposal.metrics!.travel / 1000).toFixed(2)} m</td></tr>}
                </tbody>
              </table>
            </details>
            <p className="analysis-definition">
              空移为零件中心访问估算，非 CNC 刀路。布局板面积可因紧凑排版减少；库存仍保留。余料为保守矩形近似。
            </p>
          </>
        ) : (
          <>
            <div className="utilization-summary">
              <div><span>轮廓利用率</span><strong>{percent(metrics.utilization)}</strong></div>
              <div><span>使用 / 库存板材</span><strong>{new Set(layout.placements.map((p) => p.sheetId)).size}<small> / {project.sheets.length} 张</small></strong></div>
            </div>
            <p className="placement-count">{layout.placements.length} / {project.parts.length} 个零件已放置</p>
            <h3 className="analysis-group-title">用板明细 · {layout.sheets.length} 张</h3>
            <div className="sheet-analysis-list">
              {sheets.map(({ stock, count, gross, net: sheetNet, remnant }) => (
                <details className="compact-sheet-analysis" key={stock.id}>
                  <summary>
                    <div className="sheet-summary-row">
                      <strong data-tooltip-overflow={stock.name}>{stock.name}</strong>
                      <span>{percent(gross / (stock.width * stock.height))}<i>›</i></span>
                    </div>
                    <div className="utilization-track"><span style={{ width: `${Math.min(100, (gross / (stock.width * stock.height)) * 100)}%` }} /></div>
                  </summary>
                  <dl className="analysis-stats">
                    <div><dt>尺寸</dt><dd>{stock.width} × {stock.height} mm</dd></div>
                    <div><dt>板厚 / 材质</dt><dd>{stock.thickness} mm · {stock.material}</dd></div>
                    <div><dt>已放置</dt><dd>{count} 个零件</dd></div>
                    <div><dt>净利用率</dt><dd>{percent(sheetNet / (stock.width * stock.height))}</dd></div>
                    <div><dt>矩形余料</dt><dd>{remnant ? `${Math.round(remnant.width)} × ${Math.round(remnant.height)} mm` : "未达到阈值"}</dd></div>
                  </dl>
                </details>
              ))}
              {!sheets.length && <p className="hint">当前布局没有板材。</p>}
            </div>
            <details className="panel-disclosure">
              <summary data-tooltip="查看净利用率、面积、余料和估算加工空移" data-tooltip-collapsed>指标详情</summary>
              <dl className="analysis-stats">
                <div><dt>净利用率</dt><dd>{percent(metrics.stockArea ? net / metrics.stockArea : 0)}</dd></div>
                <div><dt>已放轮廓面积</dt><dd>{area(metrics.outlineArea)}</dd></div>
                <div><dt>已放净面积</dt><dd>{area(net)}</dd></div>
                <div><dt>布局板面积 · {layout.sheets.length} 张</dt><dd>{area(metrics.stockArea)}</dd></div>
                <div><dt>库存板面积</dt><dd>{area(project.sheets.reduce((n, stock) => n + stock.width * stock.height, 0))}</dd></div>
                <div><dt>可用余料</dt><dd>{area(metrics.reusableArea)}</dd></div>
                <div><dt>估算加工空移</dt><dd>{(metrics.travel / 1000).toFixed(2)} m</dd></div>
                <div><dt>最大矩形余料</dt><dd>{largest ? `${Math.round(largest.width)} × ${Math.round(largest.height)} mm` : "未达到阈值"}</dd></div>
              </dl>
              <p className="analysis-definition">轮廓利用率按外轮廓面积计算；净利用率扣除通孔。布局板与库存板分别计量；空移为零件中心访问估算，余料为保守矩形近似。</p>
            </details>
            {candidate && canCompare && (
              <div className="candidate-callout">
                候选方案已就绪
                <button onClick={() => setTab("compare")}>查看候选对比 ↗</button>
              </div>
            )}
          </>
        )}
        {candidate && searchResult?.search && (
          <details className="panel-disclosure search-details">
            <summary data-tooltip="查看实际用时、搜索次数与停止原因" data-tooltip-collapsed>搜索详情</summary>
            <dl className="analysis-stats">
              {searchResult.search.engine && <div><dt>排版引擎</dt><dd>{searchResult.search.engine}</dd></div>}
              {searchResult.search.improved !== undefined && <div><dt>本次结果</dt><dd>{searchResult.search.improved ? "找到更优完整排法" : "保留当前排版"}</dd></div>}
              {searchResult.search.engine && <div><dt>遗传搜索</dt><dd>{searchResult.search.groups ?? 1} 组 · {searchResult.search.generations} 代 · {searchResult.search.evaluations} 个排列</dd></div>}
              {searchResult.search.engine && <div><dt>已验证分组排列</dt><dd>{searchResult.search.feasible ?? 0} 个</dd></div>}
              {searchResult.search.engine && <div><dt>独立种群重启</dt><dd>{searchResult.search.restarts} 次</dd></div>}
              <div><dt>停止原因</dt><dd>{({time:"搜索时长限制",candidates:"搜索数量限制",iterations:"完成设定搜索",disabled:"未执行优化",plateau:"利用率平台期",manual:"手动停止",exhausted:"无可继续搜索的零件"})[searchResult.search.stoppedBy]}</dd></div>
              <div><dt>{searchResult.search.patienceLimit ? "实际用时" : "实际用时 / 时长上限"}</dt><dd>{(searchResult.elapsedMs/1000).toFixed(2)}{searchResult.search.patienceLimit ? "" : ` / ${searchResult.search.seconds}`} 秒</dd></div>
              <div><dt>已完成代数</dt><dd>{searchResult.attempts}{searchResult.search.patienceLimit ? "" : ` / ${settings.iterations * (searchResult.search.groups ?? 1)}`} 代</dd></div>
              {searchResult.search.patienceLimit && <div><dt>利用率未提高</dt><dd>{searchResult.search.unchanged}/{searchResult.search.patienceLimit} 代</dd></div>}
              <div><dt>轮廓配对计算</dt><dd>{(searchResult.search.nfpPairs ?? 0).toLocaleString()} 组</dd></div>
            </dl>
            <p className="analysis-definition">各板厚、材质组独立进行 SVGnest 搜索，总代数按组累计；完整排版通过原始轮廓校验后才保留候选。{searchResult.search.patienceLimit ? "每组完成一代才计一次耐心；只看最高利用率，余料形状改善不重置计数。平台期停止不代表全局最优。" : "搜索不保证全局最优；几何计算和校验可能使实际用时略超设置。"}</p>
          </details>
        )}
      </div>
      <div className="information-footer">
        {showComparison
          ? "应用 / 放弃在画布顶部 · 核对后再决定"
          : `${labels[view]} · ${view === "current" ? "点击板材行查看规格与余料" : "只读视图"}`}
      </div>
    </aside>
  );
}
