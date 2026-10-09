import { useEffect, useMemo, useState } from "react";
import {
  Download,
  MousePointer2,
  Hand,
  Magnet,
  Play,
  Square,
  Undo2,
  MoreHorizontal,
  ChevronDown,
} from "lucide-react";
import { useWorkbench } from "./store";
import { StockCanvas } from "./components/StockCanvas";
import { WorkspaceDialogs, type Dialog } from "./components/WorkspaceDialogs";
import { LayoutAnalysis } from "./components/LayoutAnalysis";
import { ResourcePanel } from "./components/ResourcePanel";
import { ContextInspector } from "./components/ContextInspector";
import { EmptyWorkbench } from "./components/EmptyWorkbench";
import { SearchProgressLabel } from "./components/SearchProgressLabel";
import { TooltipLayer } from "./components/TooltipLayer";
import { editingLayout } from "./core/editing";
import { modeLabels } from "./core/types";
import { measureLayout, validateLayout } from "./core/geometry";
export const formatPercent = (n: number) => `${(n * 100).toFixed(1)}%`;
export default function App() {
  const s = useWorkbench(),
    [dialog, setDialog] = useState<Dialog>(null),
    [stockId, setStockId] = useState<string | undefined>(),
    [tool, setTool] = useState<"select" | "hand">("select"),
    [magnet, setMagnet] = useState(true),
    [more, setMore] = useState(false),
    [mobile, setMobile] = useState("canvas");
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        dialog ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if (e.key === "Escape" && more) {
        setMore(false);
        e.preventDefault();
        return;
      }
      if (e.key === "Escape" && !e.defaultPrevented) s.select(null);
      if (e.key.toLowerCase() === "v") setTool("select");
      if (e.key.toLowerCase() === "h") setTool("hand");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        s.undo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [dialog, more, s.undo]);
  const project = s.view === "original" ? (s.source ?? s.project) : s.project;
  const layout =
    s.view === "original"
      ? project?.original
      : s.view === "candidate"
        ? s.candidate?.layout
        : s.current;
  const canvasLayout = useMemo(
    () =>
      project && layout && s.view === "current"
        ? editingLayout(project, layout)
        : layout,
    [project, layout, s.view],
  );
  const metrics = useMemo(
    () =>
      project && layout ? measureLayout(project, layout, s.settings) : null,
    [project, layout, s.settings],
  );
  const issues = useMemo(
    () =>
      project && layout
        ? validateLayout({ ...project, original: layout }, layout, s.settings)
        : [],
    [project, layout, s.settings],
  );
  const part = project?.parts.find((v) => v.id === s.selected),
    placement = layout?.placements.find((v) => v.partId === s.selected);
  return (
    <main className="workspace">
      <TooltipLayer />
      <header className="topbar floating">
        <div className="brand">
          <img className="brand-mark" src="/woodwork-logo.webp" alt="" />
          <div className="brand-name">
            <strong>木作</strong>
            <small>WOODWORK</small>
          </div>
          <span className="project-title" data-tooltip-overflow={s.project?.name} tabIndex={0}>
            {s.project?.name ?? "未命名项目"}
          </span>
        </div>
        <div className="top-actions">
          {project && (
            <>
              <button
                className="optimization-mode"
                aria-label={`优化模式：${modeLabels[s.settings.mode]}`}
                data-tooltip={`当前优化模式：${modeLabels[s.settings.mode]} · 点击调整`}
                onClick={() => setDialog("settings")}
              >
                {modeLabels[s.settings.mode]}
                <ChevronDown size={12} />
              </button>
              <button
                className="primary"
                aria-label={s.status === "searching" ? "取消搜索" : "自动排版"}
                data-tooltip={
                  s.status === "searching"
                    ? "取消搜索，保留完整合法候选"
                    : s.project?.parts.length ? "自动排版设置" : "请先导入或新增零件"
                }
                disabled={!s.project?.parts.length}
                onClick={() =>
                  s.status === "searching" ? s.cancel() : setDialog("settings")
                }
              >
                {s.status === "searching" ? (
                  <Square size={14} />
                ) : (
                  <Play size={14} />
                )}
                <span>{s.status === "searching" ? "取消搜索" : "自动排版"}</span>
              </button>
              <button
                aria-label="导出"
                data-tooltip="导出当前排版"
                onClick={() => setDialog("export")}
              >
                <Download size={15} />
                <span>导出</span>
              </button>
            </>
          )}
          <div className="more-wrap">
            <button
              aria-label="更多"
              data-tooltip="更多操作与帮助"
              aria-expanded={more}
              onClick={() => setMore(!more)}
            >
              <MoreHorizontal size={18} />
            </button>
            {more && (
              <div className="more-menu floating">
                <button
                  disabled={!s.project}
                  onClick={() => {
                    setDialog("restore");
                    setMore(false);
                  }}
                >
                  恢复原图位置
                </button>
                <button
                  onClick={() => {
                    setDialog("sample");
                    setMore(false);
                  }}
                >
                  打开示例图纸…
                </button>
                <button
                  onClick={() => {
                    setDialog("help");
                    setMore(false);
                  }}
                >
                  操作帮助
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {project && (
        <nav className="mobile-navigation" aria-label="工作区区域">
          {[
            ["resources", "资源"],
            ["canvas", "画布"],
            ["info", "信息"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={mobile === key ? "active" : ""}
              onClick={() => setMobile(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
      <div
        className={`workspace-surface mobile-${mobile}${project ? "" : " workspace-initial"}`}
      >
        {project && (
          <ResourcePanel
            project={project}
            layout={layout}
            open={(dialog, stockId) => {
              setStockId(stockId);
              setDialog(dialog);
            }}
            onSelect={() => {
              setTool("select");
              setMobile("info");
            }}
          />
        )}
        <div className="canvas-region">
          {project && layout && metrics && canvasLayout?.sheets.length ? (
            <StockCanvas
              project={project}
              layout={canvasLayout}
              metrics={metrics}
              tool={tool}
              magnet={magnet}
              interactionBlocked={!!dialog || more}
            />
          ) : (
            <EmptyWorkbench
              project={project}
              open={setDialog}
              onClear={() => s.select(null)}
            />
          )}
          {project && <nav className="edit-tools canvas-tools floating" aria-label="编辑工具">
            <button
              data-tooltip="选择 · V"
              aria-label="选择工具"
              aria-pressed={tool === "select"}
              className={tool === "select" ? "active" : ""}
              onClick={() => setTool("select")}
            >
              <MousePointer2 size={16} />
            </button>
            <button
              data-tooltip="平移 · H"
              aria-label="平移工具"
              aria-pressed={tool === "hand"}
              className={tool === "hand" ? "active" : ""}
              onClick={() => setTool("hand")}
            >
              <Hand size={16} />
            </button>
            <button
              data-tooltip="磁吸 · Alt 暂时关闭"
              aria-label="磁吸"
              aria-pressed={magnet}
              className={magnet ? "active" : ""}
              onClick={() => setMagnet(!magnet)}
            >
              <Magnet size={16} />
            </button>
            <span className="tool-divider" aria-hidden="true" />
            <button
              disabled={!s.history.length}
              aria-label="撤销"
              data-tooltip={s.history.length ? "撤销 · Ctrl/⌘ Z" : "没有可撤销的修改"}
              onClick={s.undo}
            >
              <Undo2 size={16} />
            </button>
          </nav>}
          {project && <div className="view-switch floating">
            {(
              [
                ["original", "原始图纸"],
                ["current", "当前排版"],
                ["candidate", "候选方案"],
              ] as const
            ).map(([view, label]) => (
              <button
                key={view}
                className={s.view === view ? "active" : ""}
                disabled={
                  !s.project ||
                  (view === "original" && !s.source) ||
                  (view === "candidate" && !s.candidate?.layout)
                }
                data-tooltip={
                  view === "candidate" && !s.candidate
                    ? "自动排版后可比较候选"
                    : ""
                }
                onClick={() => s.setView(view)}
              >
                {label}
              </button>
            ))}
          </div>}
          {(s.candidate || s.status === "searching") && (
            <div className="candidate-bar floating">
              <span>
                {s.status === "searching"
                  ? <SearchProgressLabel />
                  : `${modeLabels[s.settings.mode]} · ${s.candidate?.metrics?.sheetCount ?? 0} 张板 · ${formatPercent(s.candidate?.metrics?.utilization ?? 0)}`}
              </span>
              {s.status === "searching" && <button onClick={s.cancel}>停止搜索</button>}
              {s.candidate && (
                <>
                  <button
                    className="primary"
                    disabled={s.status === "searching"}
                    onClick={s.apply}
                  >
                    应用候选
                  </button>
                  <button onClick={s.discardCandidate}>放弃</button>
                </>
              )}
            </div>
          )}
        </div>
        {part && project ? (
          <ContextInspector
            key={part.id}
            part={part}
            placement={placement}
            project={project}
          />
        ) : project && layout && metrics ? (
          <LayoutAnalysis
            key={s.candidate ? "with-candidate" : "overview"}
            project={project}
            layout={layout}
            metrics={metrics}
            source={s.source}
            currentProject={s.project}
            current={s.current}
            candidate={s.candidate?.layout ?? null}
            searchResult={s.candidate}
            settings={s.settings}
            view={s.view}
            issues={issues}
            onCheck={() => setDialog("check")}
          />
        ) : project ? (
          <aside className="analysis-panel floating analysis-empty" aria-label="排版概览">
            <div className="panel-heading">
              <strong>排版概览</strong>
              <span className="section-index">02</span>
            </div>
            <div className="analysis-body">
              <div className="overview-empty-illustration" aria-hidden="true">
                <svg viewBox="0 0 80 100">
                  <path d="M15 7h36l16 17v68H15Z" fill="none" stroke="currentColor" />
                  <path d="M51 7v17h16M26 41h29M26 50h23M26 59h29" fill="none" stroke="currentColor" strokeWidth=".8" />
                  <path d="M23 80h31" stroke="var(--accent)" strokeWidth="2" />
                </svg>
              </div>
              <h3>等待你的第一张图纸</h3>
              <p className="hint">导入后，这里会显示用板情况<br />和需要处理的问题。</p>
              <button onClick={() => setDialog("help")}>操作说明 ↗</button>
            </div>
          </aside>
        ) : null}
      </div>
      <footer className="statusbar">
        <button
          disabled={!project}
          className={issues.length ? "status-warning" : ""}
          onClick={() => setDialog("check")}
          data-tooltip="查看当前视图的排版检查详情"
        >
          {!project
            ? "等待导入图纸"
            : issues.length
              ? `排版检查：${issues.length} 项待核对 · 详情 ↗`
              : "排版检查：通过 · 详情 ↗"}
        </button>
        <span role="status" data-tooltip-overflow="">
          {s.message ||
            (!project
              ? "导入 DXF 或载入示例开始"
              : s.view !== "current"
                ? "只读视图 · 切换当前排版后编辑"
                : "拖动零件 · Alt 暂停磁吸 · Esc 返回概览")}
        </span>
      </footer>
      <WorkspaceDialogs
        dialog={dialog}
        stockId={stockId}
        close={() => setDialog(null)}
      />
    </main>
  );
}
