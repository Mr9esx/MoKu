import { useMemo } from "react";

import { measureLayout, polygonArea } from "../core/geometry";
import type {
  Layout,
  LayoutIssue,
  LayoutMetrics,
  NestSettings,
  Project,
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
  const currentMetrics = comparisons.find(
    (row) => row.key === "current",
  )?.metrics;
  const candidateMetrics = comparisons.find(
    (row) => row.key === "candidate",
  )?.metrics;
  const largest = metrics.remnants.reduce<
    (typeof metrics.remnants)[number] | null
  >((best, r) => (!best || r.area > best.area ? r : best), null);
  return (
    <aside className="analysis-panel floating" aria-label="排版数据分析">
      <div className="panel-heading">
        <strong>
          数据概览 <span>{labels[view]}</span>
        </strong>
      </div>
      <div className="analysis-body">
        <div className="utilization-summary">
          <div>
            <span>轮廓利用率</span>
            <strong>{percent(metrics.utilization)}</strong>
          </div>
          <div>
            <span>使用板材 / 库存</span>
            <strong>
              {new Set(layout.placements.map((p) => p.sheetId)).size}
              <small> / {project.sheets.length} 张</small>
            </strong>
          </div>
        </div>
        <div className="overview-secondary">
          <span>
            净利用率 {percent(metrics.stockArea ? net / metrics.stockArea : 0)}
          </span>
          <span>
            已放 {layout.placements.length} / {project.parts.length}
          </span>
        </div>
        {issues.length > 0 ? (
          <button className="analysis-warning" onClick={onCheck}>
            {project.parts.length - layout.placements.length > 0
              ? `${project.parts.length - layout.placements.length} 个待放置 · `
              : ""}
            {issues.length} 项待核对 · 查看检查
          </button>
        ) : (
          <p className="hint">轮廓与间距检查通过</p>
        )}
        {candidate && current && currentMetrics && candidateMetrics && (
          <section className="candidate-comparison">
            <strong>候选 vs 当前</strong>
            {currentProject &&
              current.placements.length < currentProject.parts.length && (
                <p className="warning">
                  当前有{" "}
                  {currentProject.parts.length - current.placements.length}{" "}
                  个待放置零件；候选包含全部零件，利用率变化也来自补齐放置。
                </p>
              )}
            <p>
              用板 {new Set(current.placements.map((p) => p.sheetId)).size} →{" "}
              {new Set(candidate.placements.map((p) => p.sheetId)).size} 张
            </p>
            <p>
              轮廓利用率 {percent(currentMetrics.utilization)} →{" "}
              {percent(candidateMetrics.utilization)}
            </p>
            <p>
              可用余料 {area(currentMetrics.reusableArea)} →{" "}
              {area(candidateMetrics.reusableArea)}
            </p>
            <p>
              估算空移 {(currentMetrics.travel / 1000).toFixed(2)} →{" "}
              {(candidateMetrics.travel / 1000).toFixed(2)} m
            </p>
            <small>应用 / 放弃入口始终保留在画布顶部。</small>
          </section>
        )}
        <h3>每张板材</h3>
        <div className="sheet-analysis-list">
          {sheets.map(({ stock, count, gross, net, remnant }, i) => (
            <section className="sheet-analysis" key={stock.id}>
              <div>
                <strong>
                  板 {i + 1} · {stock.name}
                </strong>
                <span>
                  {count} 个 · {stock.thickness} mm
                </span>
              </div>
              <small>
                {stock.width} × {stock.height} mm · {stock.material}
              </small>
              <div className="sheet-rates">
                <span>
                  轮廓 {percent(gross / (stock.width * stock.height))}
                </span>
                <span>净 {percent(net / (stock.width * stock.height))}</span>
              </div>
              <div className="utilization-track">
                <span
                  style={{
                    width: `${Math.min(100, (gross / (stock.width * stock.height)) * 100)}%`,
                  }}
                />
              </div>
              <small>
                矩形余料{" "}
                {remnant
                  ? `${Math.round(remnant.width)} × ${Math.round(remnant.height)} mm`
                  : "未达到阈值"}
              </small>
            </section>
          ))}
          {!sheets.length && <p className="hint">当前布局没有板材。</p>}
        </div>
        <details className="metric-details">
          <summary>面积、余料与加工详情</summary>
          <dl className="analysis-stats">
            <div>
              <dt>已放轮廓面积</dt>
              <dd>{area(metrics.outlineArea)}</dd>
            </div>
            <div>
              <dt>已放净面积</dt>
              <dd>{area(net)}</dd>
            </div>
            <div>
              <dt>布局板面积 · {layout.sheets.length} 张</dt>
              <dd>{area(metrics.stockArea)}</dd>
            </div>
            <div>
              <dt>库存板面积</dt>
              <dd>
                {area(
                  project.sheets.reduce((n, s) => n + s.width * s.height, 0),
                )}
              </dd>
            </div>
            <div>
              <dt>估算加工空移</dt>
              <dd>{(metrics.travel / 1000).toFixed(2)} m</dd>
            </div>
            <div>
              <dt>最大矩形余料</dt>
              <dd>
                {largest
                  ? `${Math.round(largest.width)} × ${Math.round(largest.height)} mm`
                  : "未达到阈值"}
              </dd>
            </div>
          </dl>
        </details>
        <h3>视图对比</h3>
        {source &&
          currentProject &&
          (source.parts
            .map((p) => p.id)
            .sort()
            .join("|") !==
            currentProject.parts
              .map((p) => p.id)
              .sort()
              .join("|") ||
            source.sheets
              .map((p) => p.id)
              .sort()
              .join("|") !==
              currentProject.sheets
                .map((p) => p.id)
                .sort()
                .join("|")) && (
            <p className="warning">
              原图与当前的零件或库存集合不同，利用率差异包含资源变化，不能直接视为排版提升。
            </p>
          )}
        <div className="comparison-scroll">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>视图</th>
                <th>轮廓 / 净</th>
                <th>使用 / 布局板</th>
                <th>空移</th>
              </tr>
            </thead>
            <tbody>
              {comparisons.map((row) => (
                <tr
                  key={row.key}
                  className={row.key === view ? "active-row" : ""}
                >
                  <th>{labels[row.key]}</th>
                  {row.metrics ? (
                    <>
                      <td>
                        {percent(row.metrics.utilization)}
                        <small>
                          {percent(
                            row.metrics.stockArea
                              ? row.net / row.metrics.stockArea
                              : 0,
                          )}
                        </small>
                      </td>
                      <td>
                        {row.used} / {row.metrics.sheetCount}
                        <small>{area(row.metrics.stockArea)}</small>
                      </td>
                      <td>{(row.metrics.travel / 1000).toFixed(2)} m</td>
                    </>
                  ) : (
                    <td colSpan={3}>尚无方案</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint analysis-note">
          布局板面积可因紧凑排版减少；库存仍保留。空移为零件中心访问估算，余料为保守矩形近似。
        </p>
      </div>
    </aside>
  );
}
