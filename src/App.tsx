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
} from "lucide-react";
import { useWorkbench } from "./store";
import { StockCanvas } from "./components/StockCanvas";
import { WorkspaceDialogs, type Dialog } from "./components/WorkspaceDialogs";
import { LayoutAnalysis } from "./components/LayoutAnalysis";
import { ResourcePanel } from "./components/ResourcePanel";
import { ContextInspector } from "./components/ContextInspector";
import { editingLayout } from "./core/editing";
import { measureLayout, validateLayout } from "./core/geometry";
export const formatPercent = (n: number) => `${(n * 100).toFixed(1)}%`;
export default function App() {
  const s = useWorkbench(),
    [dialog, setDialog] = useState<Dialog>(null),
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
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">木</span>
          <strong>木作</strong>
          <span className="project-title" title={s.project?.name}>
            {s.project?.name ?? "未命名项目"}
          </span>
        </div>
        <nav className="edit-tools" aria-label="编辑工具">
          <button
            title="选择 · V"
            aria-label="选择工具"
            className={tool === "select" ? "active" : ""}
            onClick={() => setTool("select")}
          >
            <MousePointer2 size={16} />
          </button>
          <button
            title="平移 · H"
            aria-label="平移工具"
            className={tool === "hand" ? "active" : ""}
            onClick={() => setTool("hand")}
          >
            <Hand size={16} />
          </button>
          <button
            title="弱磁吸 · Alt 暂时关闭"
            aria-label="弱磁吸"
            aria-pressed={magnet}
            className={magnet ? "active" : ""}
            onClick={() => setMagnet(!magnet)}
          >
            <Magnet size={16} />
          </button>
          <button
            disabled={!s.history.length}
            aria-label="撤销"
            title="撤销 · Ctrl/⌘ Z"
            onClick={s.undo}
          >
            <Undo2 size={16} />
          </button>
        </nav>
        <div className="top-actions">
          <button
            className="primary"
            aria-label={s.status === "searching" ? "取消搜索" : "自动排版"}
            title={s.status === "searching" ? "取消搜索，保留完整合法候选" : "自动排版设置"}
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
            disabled={!s.project}
            onClick={() => setDialog("export")}
          >
            <Download size={15} />
            <span>导出</span>
          </button>
          <div className="more-wrap">
            <button
              aria-label="更多"
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
      <div className={`workspace-surface mobile-${mobile}`}>
        <ResourcePanel
          project={project}
          layout={layout}
          open={setDialog}
          onSelect={() => {
            setTool("select");
            setMobile("info");
          }}
        />
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
            <div className="empty-canvas" onClick={() => s.select(null)}>
              <div>
                <span className="empty-mark">木</span>
                <h2>{project ? "零件已就绪，先准备板材" : "从一张图纸开始"}</h2>
                <p>
                  {project
                    ? `${project.parts.length} 个零件待放置。新增兼容板材后拖入或自动排版。`
                    : "导入整板排版或独立零件轮廓，在这里安排你的木作。"}
                </p>
                <button
                  className="primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDialog(project ? "stock" : "import");
                  }}
                >
                  {project ? "新增板材" : "导入 DXF"}
                </button>
              </div>
            </div>
          )}
          <div className="view-switch floating">
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
                title={
                  view === "candidate" && !s.candidate
                    ? "自动排版后可比较候选"
                    : ""
                }
                onClick={() => s.setView(view)}
              >
                {label}
              </button>
            ))}
          </div>
          {(s.candidate || s.status === "searching") && (
            <div className="candidate-bar floating">
              <span>
                {s.status === "searching"
                  ? `搜索 ${s.attempt}/${s.settings.iterations}`
                  : `候选 ${s.candidate?.metrics?.sheetCount ?? 0} 张板 · ${formatPercent(s.candidate?.metrics?.utilization ?? 0)}`}
              </span>
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
            project={project}
            layout={layout}
            metrics={metrics}
            source={s.source}
            currentProject={s.project}
            current={s.current}
            candidate={s.candidate?.layout ?? null}
            settings={s.settings}
            view={s.view}
            issues={issues}
            onCheck={() => setDialog("check")}
          />
        ) : (
          <aside className="analysis-panel floating">
            <div className="panel-heading">
              <strong>数据概览</strong>
            </div>
            <div className="analysis-body">
              <p className="hint">导入后显示真实用板、利用率和待放置数量。</p>
              <div className="utilization-summary">
                <div>
                  <span>轮廓利用率</span>
                  <strong>—</strong>
                </div>
                <div>
                  <span>使用板材</span>
                  <strong>0</strong>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
      <footer className="statusbar">
        <span role="status">
          {s.message ||
            (!project
              ? "等待导入图纸"
              : s.view !== "current"
                ? "只读视图 · 切换当前排版后编辑"
                : "拖动零件 · Alt 暂停磁吸 · Esc 返回概览")}
        </span>
        <button
          disabled={!project}
          className={issues.length ? "status-warning" : ""}
          onClick={() => setDialog("check")}
        >
          {!project
            ? "尚未检查"
            : issues.length
              ? `${issues.length} 项待核对`
              : "轮廓与间距检查通过"}
        </button>
      </footer>
      <WorkspaceDialogs dialog={dialog} close={() => setDialog(null)} />
    </main>
  );
}
