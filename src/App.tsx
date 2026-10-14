import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
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
  LoaderCircle,
  LockKeyhole,
  Drill,
  Box,
  DraftingCompass,
} from "lucide-react";
import { useWorkbench, displayedLayout, searchEditingReason } from "./store";
import { StockCanvas } from "./components/StockCanvas";
import { PartCanvas } from "./components/PartCanvas";
import { DrawingOverview } from "./components/DrawingOverview";
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
const AssemblyWorkspace = lazy(() => import("./components/AssemblyWorkspace"));
export const formatPercent = (n: number) => `${(n * 100).toFixed(1)}%`;
export default function App() {
  const s = useWorkbench(),
    [dialog, setDialog] = useState<Dialog>(null),
    [stockId, setStockId] = useState<string | undefined>(),
    [tool, setTool] = useState<"select" | "hand">("select"),
    [magnet, setMagnet] = useState(true),
    [more, setMore] = useState(false),
    [mobile, setMobile] = useState("canvas"),
    [workspaceMode, setWorkspaceMode] = useState<"drawing" | "assembly">("drawing"),
    [assemblyVisited, setAssemblyVisited] = useState(false);
  const lastDrawingView = useRef(s.view);
  const switchWorkspace = (mode: "drawing" | "assembly") => {
    if (mode === workspaceMode) return;
    if (mode === "assembly") { lastDrawingView.current = s.view; s.setView("current"); setAssemblyVisited(true); }
    else s.setView(lastDrawingView.current === "candidate" && !s.candidate ? "current" : lastDrawingView.current);
    setWorkspaceMode(mode);
  };
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
      if (workspaceMode === "assembly") return;
      if (e.key === "Escape" && !e.defaultPrevented) s.select(null);
      if (s.status === "searching") return;
      if (e.key.toLowerCase() === "v") setTool("select");
      if (e.key.toLowerCase() === "h") setTool("hand");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        s.undo();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [dialog, more, s.undo, s.status, workspaceMode]);
  const project = s.view === "original" ? (s.source ?? s.project) : s.project;
  const searching = s.status === "searching";
  const hasStocks = !!project?.sheets.length;
  const layout = displayedLayout(s);
  const analysisLayout = searching && s.view === "current" ? s.candidate?.layout ?? s.current : layout;
  const canvasLayout = useMemo(
    () =>
      project && layout && s.view === "current"
        ? editingLayout(project, layout)
        : layout,
    [project, layout, s.view],
  );
  const metrics = useMemo(
    () =>
      project && analysisLayout ? measureLayout(project, analysisLayout, s.settings) : null,
    [project, analysisLayout, s.settings],
  );
  const issues = useMemo(
    () =>
      project && analysisLayout
        ? validateLayout({ ...project, original: s.view === "original" ? analysisLayout : s.current ?? analysisLayout }, analysisLayout, s.settings)
        : [],
    [project, analysisLayout, s.current, s.settings],
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
          {!!s.project?.parts.length && <nav className="workspace-mode-switch" aria-label="二维和三维工作区">
            <button aria-label="二维图纸" aria-pressed={workspaceMode === "drawing"} className={workspaceMode === "drawing" ? "active" : ""} onClick={() => switchWorkspace("drawing")}><DraftingCompass size={15}/><span>二维图纸</span></button>
            <button aria-label="3D 组装" aria-pressed={workspaceMode === "assembly"} className={workspaceMode === "assembly" ? "active" : ""} onClick={() => switchWorkspace("assembly")}><Box size={15}/><span>3D 组装</span></button>
          </nav>}
          {project && (
            <>
              {workspaceMode === "drawing" && hasStocks && <button
                className="optimization-mode"
                aria-label={`优化模式：${modeLabels[s.settings.mode]}`}
                data-tooltip={`当前优化模式：${modeLabels[s.settings.mode]} · ${searching ? "点击查看，搜索中不可修改" : "点击调整"}`}
                onClick={() => setDialog("settings")}
              >
                {modeLabels[s.settings.mode]}
                <ChevronDown size={12} />
              </button>}
              {workspaceMode === "drawing" && (hasStocks ? <button
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
              </button> : <button onClick={() => setDialog("stock")} disabled={searching}
                data-tooltip="添加板材，开始用料排版"><Play size={14} /><span>安排用料</span></button>)}
              <button
                aria-label="导出"
                disabled={searching}
                data-tooltip={searching ? "停止搜索并应用候选后再导出" : "导出二维图纸"}
                onClick={() => setDialog(s.current?.sheets.length ? "export" : "part-export")}
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
                  disabled={!s.project || searching}
                  data-tooltip={searching ? searchEditingReason : "恢复导入位置"}
                  onClick={() => {
                    setDialog("restore");
                    setMore(false);
                  }}
                >
                  恢复原图位置
                </button>
                <button
                  disabled={searching}
                  data-tooltip={searching ? searchEditingReason : "打开示例图纸"}
                  onClick={() => {
                    setDialog("sample");
                    setMore(false);
                  }}
                >
                  打开示例图纸…
                </button>
                <button disabled={searching} onClick={async () => {
                  const { createAssemblyDemo } = await import("./core/assemblyDemo");
                  s.confirmImport(createAssemblyDemo(), "append");
                  setMore(false); switchWorkspace("assembly");
                }}>添加组装示例…</button>
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
      {project && workspaceMode === "drawing" && (
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
        style={{ display: workspaceMode === "assembly" ? "none" : undefined }}
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
              setMobile("canvas");
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
          ) : project?.parts.length ? (
            <PartCanvas project={project} selected={s.selected} select={s.select} />
          ) : (
            <EmptyWorkbench
              project={project}
              open={setDialog}
              onClear={() => s.select(null)}
            />
          )}
          {project && <nav className={`edit-tools canvas-tools floating${searching ? " is-searching" : ""}`} aria-label="编辑工具" aria-disabled={searching}>
            {searching && <span className="tools-lock"><LockKeyhole size={12} />排版中</span>}
            {hasStocks && <>
            <button
              disabled={searching}
              data-tooltip={searching ? searchEditingReason : "选择 · V"}
              aria-label="选择工具"
              aria-pressed={tool === "select"}
              className={tool === "select" ? "active" : ""}
              onClick={() => setTool("select")}
            >
              <MousePointer2 size={16} />
            </button>
            <button
              disabled={searching}
              data-tooltip={searching ? searchEditingReason : "平移 · H"}
              aria-label="平移工具"
              aria-pressed={tool === "hand"}
              className={tool === "hand" ? "active" : ""}
              onClick={() => setTool("hand")}
            >
              <Hand size={16} />
            </button>
            <button
              disabled={searching}
              data-tooltip={searching ? searchEditingReason : "磁吸 · Alt 暂时关闭"}
              aria-label="磁吸"
              aria-pressed={magnet}
              className={magnet ? "active" : ""}
              onClick={() => setMagnet(!magnet)}
            >
              <Magnet size={16} />
            </button>
            <span className="tool-divider" aria-hidden="true" />
            </>}
            <button
              disabled={!s.history.length || searching}
              aria-label="撤销"
              data-tooltip={searching ? searchEditingReason : s.history.length ? "撤销 · Ctrl/⌘ Z" : "没有可撤销的修改"}
              onClick={s.undo}
            >
              <Undo2 size={16} />
            </button>
            {part && <>
              <span className="tool-divider" aria-hidden="true" />
              <button className="corner-relief-tool" aria-label="清角/T骨" aria-haspopup="dialog"
                disabled={searching || s.view !== "current"}
                data-tooltip={searching ? searchEditingReason : s.view !== "current" ? `切换到${hasStocks ? "当前排版" : "当前图纸"}后编辑` : `修整 ${part.name} 的孔槽内角，为方角配件预留装配空间`}
                onClick={() => setDialog("joinery")}>
                <Drill size={16} /><span>清角/T骨</span>
              </button>
            </>}
          </nav>}
          {project && <div className="view-switch floating">
            {(
              [
                ["original", "原始图纸"],
                ["current", hasStocks ? "当前排版" : "当前图纸"],
                ...(hasStocks ? [["candidate", "候选方案"]] as const : []),
              ] as const
            ).map(([view, label]) => (
              <button
                key={view}
                className={s.view === view ? "active" : ""}
                disabled={
                  !s.project ||
                  (view === "original" && !s.source) ||
                  (view === "candidate" && (!s.candidate?.layout || searching))
                }
                data-tooltip={
                  view === "candidate" && searching ? "搜索结果正在当前排版中实时预览" : view === "candidate" && !s.candidate
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
            <div className={`candidate-bar floating${searching ? " is-searching" : ""}`} role={searching ? "status" : undefined} aria-live="off">
              <span>
                {searching && <strong className="search-heading"><LoaderCircle size={16} className="search-spinner" />正在排版</strong>}
                {s.status === "searching"
                  ? <SearchProgressLabel />
                  : `${modeLabels[s.settings.mode]} · ${s.candidate?.metrics?.sheetCount ?? 0} 张板 · ${formatPercent(s.candidate?.metrics?.utilization ?? 0)}`}
              </span>
              {s.status === "searching" && <button onClick={s.cancel}>停止搜索</button>}
              {s.candidate && !searching && (
                <>
                  <button
                    className="primary"
                    disabled={s.status === "searching"}
                    onClick={s.apply}
                  >
                    应用候选
                  </button>
                  <button disabled={searching} data-tooltip={searching ? "先停止搜索，再放弃候选" : "放弃候选"} onClick={s.discardCandidate}>放弃</button>
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
            onExportPart={() => setDialog("part-export")}
          />
        ) : project && !hasStocks ? (
          <DrawingOverview project={project} onStock={() => setDialog("stock")} />
        ) : project && layout && metrics ? (
          <LayoutAnalysis
            key={s.candidate ? "with-candidate" : "overview"}
            project={project}
            layout={analysisLayout ?? layout}
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
              <h3>暂无排版数据</h3>
              <button onClick={() => setDialog("help")}>操作说明 ↗</button>
            </div>
          </aside>
        ) : null}
      </div>
      {assemblyVisited && s.project && <Suspense fallback={<div className="assembly-loading">正在打开 3D 组装…</div>}>
        <AssemblyWorkspace project={s.project} active={workspaceMode === "assembly"} interactionBlocked={!!dialog || more} open={setDialog}/>
      </Suspense>}
      <footer className="statusbar" style={{ display: workspaceMode === "assembly" ? "none" : undefined }}>
        <button
          disabled={!project || !hasStocks}
          className={hasStocks && issues.length ? "status-warning" : ""}
          onClick={() => setDialog("check")}
          data-tooltip={searching && s.view === "current" ? "检查最佳完整方案，试排过程不作为最终结果" : "查看当前视图的排版检查详情"}
        >
          {!project
            ? "等待导入图纸"
            : !hasStocks ? `${project.parts.length} 个零件 · mm`
            : issues.length
              ? `排版检查：${issues.length} 项待核对 · 详情 ↗`
              : "排版检查：通过 · 详情 ↗"}
        </button>
        <span role="status" data-tooltip-overflow="">
          {s.message ||
            (!project
              ? ""
              : !hasStocks ? "选择零件，编辑榫槽或导出图纸"
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
