import { useEffect, useMemo, useRef } from "react";
import { Upload, Download, ArrowUpRight, RotateCcw } from "lucide-react";
import { useWorkbench } from "./store";
import { importDrawing } from "./import";
import { StockCanvas } from "./components/StockCanvas";
import { NestPanel } from "./components/NestPanel";
import { PartInspector } from "./components/PartInspector";
import { PartsTable } from "./components/PartsTable";
import { measureLayout, validateLayout } from "./core/geometry";
import { exportCurrentSvg, exportEligibility } from "./core/export";
export const formatPercent = (n: number) => `${(n * 100).toFixed(1)}%`;
export default function App() {
  const s = useWorkbench(),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void importDrawing();
  }, []);
  const layout =
    s.view === "original"
      ? s.project?.original
      : s.view === "candidate"
        ? s.candidate?.layout
        : s.current;
  const metrics = useMemo(
    () =>
      s.project && layout ? measureLayout(s.project, layout, s.settings) : null,
    [s.project, layout, s.settings],
  );
  const baseline = useMemo(
    () =>
      s.project
        ? measureLayout(s.project, s.project.original, s.settings)
        : null,
    [s.project, s.settings],
  );
  const issues = useMemo(
    () =>
      s.project && layout && s.current
        ? validateLayout(
            { ...s.project, original: s.current },
            layout,
            s.settings,
          )
        : [],
    [s.project, layout, s.current, s.settings],
  );
  const exportStatus = useMemo(
    () =>
      s.project && s.current
        ? exportEligibility(s.project, s.current, s.settings)
        : { allowed: false, reason: "请先导入图纸" },
    [s.project, s.current, s.settings],
  );
  function download() {
    if (
      !s.project ||
      !s.current ||
      s.importing ||
      !exportEligibility(s.project, s.current, s.settings).allowed
    )
      return;
    const blob = new Blob(
      [exportCurrentSvg(s.project, s.current, s.settings)],
      {
        type: "image/svg+xml;charset=utf-8",
      },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = s.project.name.replace(/\.dxf$/i, "") + "-排版.svg";
    // Attach the temporary anchor for browser download compatibility.
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Retain the blob URL long enough for browsers that begin transfers lazily.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return (
    <main>
      <header>
        <a className="brand" href="#">
          <span className="brand-mark">木</span>
          <span>
            木作 <i>/</i> 板材工作台<small>WOODWORK · MATERIAL STUDY</small>
          </span>
        </a>
        <div className="header-actions">
          <button onClick={() => void importDrawing()} disabled={s.importing}>
            载入示例
            <ArrowUpRight size={15} />
          </button>
          <button className="primary" onClick={() => input.current?.click()}>
            <Upload size={16} />
            导入 DXF
          </button>
          <input
            ref={input}
            hidden
            type="file"
            accept=".dxf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importDrawing(f);
              e.target.value = "";
            }}
          />
        </div>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">从图纸，到更从容的下料。</p>
          <h1>
            每一块板，
            <br className="mobile-break" />
            都值得好好安排。
          </h1>
          <p className="source-name">
            {s.importing
              ? "正在读取图纸…"
              : (s.project?.name ?? "导入毫米单位二维 DXF")}{" "}
            <span>
              {s.project
                ? `${s.project.sheets.length} 张板材 / ${s.project.parts.length} 个零件`
                : ""}
            </span>
          </p>
        </div>
        <div className="intro-note">
          保留真实轮廓与孔槽
          <br />
          检查间距，寻找可用余料<span>二维板材排版 · 01</span>
        </div>
      </section>
      {metrics && (
        <section className="metrics">
          <div>
            <span>轮廓利用率</span>
            <strong>{formatPercent(metrics.utilization)}</strong>
            <small>按当前排版板材总面积</small>
          </div>
          <div>
            <span>近似加工行程</span>
            <strong>
              {(metrics.travel / 1000).toFixed(2)}
              <em>m</em>
            </strong>
            <small>
              原图 {(baseline!.travel / 1000).toFixed(2)} m · 零件中心间空移
            </small>
          </div>
          <div>
            <span>可复用矩形余料</span>
            <strong>
              {(metrics.reusableArea / 1e6).toFixed(2)}
              <em>m²</em>
            </strong>
            <small>
              原图 {(baseline!.reusableArea / 1e6).toFixed(2)} m² ·
              每板保守最大矩形
            </small>
          </div>
          <div className="metric-export">
            <button
              onClick={download}
              disabled={s.importing || !exportStatus.allowed}
              title={exportStatus.reason}
            >
              <Download size={17} />
              导出当前 SVG
            </button>
            <small
              className={!exportStatus.allowed ? "export-blocked" : undefined}
            >
              {exportStatus.reason}
            </small>
          </div>
        </section>
      )}
      <div className="workbench">
        <div className="main-drawing">
          <div className="view-switch">
            <div>
              {(
                [
                  ["original", "原始图纸"],
                  ["current", "当前排版"],
                  ["candidate", "候选方案"],
                ] as const
              ).map(([v, label]) => (
                <button
                  className={s.view === v ? "active" : ""}
                  key={v}
                  disabled={v === "candidate" && !s.candidate?.layout}
                  onClick={() => s.setView(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button onClick={s.reset} disabled={!s.project || s.importing}>
              <RotateCcw size={14} />
              恢复原图
            </button>
          </div>
          {layout && s.project ? (
            <StockCanvas layout={layout} metrics={metrics!} />
          ) : (
            <div className="loading-paper">
              {s.importing ? "正在解析真实 DXF 轮廓…" : "等待图纸"}
            </div>
          )}
          <div className="validation">
            <div className="section-title">
              <span>排版检查</span>
              <small>
                {issues.length
                  ? `${issues.length} 项需要核对`
                  : "当前参数下未发现冲突"}
              </small>
            </div>
            {issues.length ? (
              <div className="issue-list">
                {issues.map((issue, i) => (
                  <button
                    key={i}
                    onClick={() =>
                      issue.partIds[0] && s.select(issue.partIds[0])
                    }
                  >
                    {issue.message}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="hint">
                轮廓、板边、间距和板厚均已检查。请在加工前核对刀具、槽深与原始图纸。
              </p>
            )}
            {s.project?.warnings.map((w, i) => (
              <p className="warning" key={i}>
                {w}
              </p>
            ))}
          </div>
        </div>
        <aside>
          <PartInspector />
          <NestPanel />
        </aside>
      </div>
      <PartsTable />
      <footer>
        <span>木作 / 板材工作台</span>
        <span>浏览器内处理 · 图纸不上传 · SVG 非 CNC 刀路</span>
      </footer>
    </main>
  );
}
