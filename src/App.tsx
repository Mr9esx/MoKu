import { useEffect, useMemo, useState } from "react";
import {
  Upload,
  Download,
  MousePointer2,
  Hand,
  Plus,
  Layers,
  BarChart3,
  HelpCircle,
  Play,
  Square,
  Undo2,
  RotateCcw,
  ChevronDown,
  Search,
  X,
  Lock,
  Unlock,
  RotateCw,
} from "lucide-react";
import { useWorkbench } from "./store";
import { importDrawing } from "./import";
import { StockCanvas } from "./components/StockCanvas";
import { WorkspaceDialogs, type Dialog } from "./components/WorkspaceDialogs";
import { LayoutAnalysis } from "./components/LayoutAnalysis";
import { editingLayout } from "./core/editing";
import { measureLayout, validateLayout } from "./core/geometry";
import { points, displayPoints } from "./core/export";
import type { Part, Rotation } from "./core/types";
export const formatPercent = (n: number) => `${(n * 100).toFixed(1)}%`;
function Thumbnail({ part }: { part: Part }) {
  return (
    <svg
      viewBox={`-8 -8 ${part.width + 16} ${part.height + 16}`}
      aria-hidden="true"
    >
      <polygon
        points={points(displayPoints(part.outline, part.height))}
        fill={part.thickness > 5 ? "#cdb68e" : "#a8b59b"}
        stroke="#877c67"
        strokeWidth="2"
      />
      {part.pockets.map((p, i) => (
        <polygon
          key={`p${i}`}
          points={points(displayPoints(p.outline, part.height))}
          fill="#e9e8d8"
        />
      ))}
      {part.holes.map((p, i) => (
        <polygon
          key={`h${i}`}
          points={points(displayPoints(p, part.height))}
          fill="#aac7d7"
        />
      ))}
    </svg>
  );
}
export default function App() {
  const s = useWorkbench(),
    [dialog, setDialog] = useState<Dialog>(null),
    [tool, setTool] = useState<"select" | "hand">("select"),
    [magnet, setMagnet] = useState(true),
    [query, setQuery] = useState(""),
    [collapsed, setCollapsed] = useState(false),
    [analysisOpen, setAnalysisOpen] = useState(true);
  useEffect(() => {
    void importDrawing();
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        dialog ||
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if (e.key.toLowerCase() === "v") setTool("select");
      if (e.key.toLowerCase() === "h") setTool("hand");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        s.undo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [dialog, s.undo]);
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
  const items =
    s.project?.parts.filter((v) =>
      `${v.name} ${v.id} ${v.thickness}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <main className="workspace">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">木</span>
          <strong>木作</strong>
          <span className="brand-sub">板材工作台</span>
        </div>
        <nav className="top-toolbar" aria-label="工作区工具栏">
          <button
            title="选择 · V"
            aria-label="选择工具"
            className={tool === "select" ? "active" : ""}
            onClick={() => setTool("select")}
          >
            <MousePointer2 size={18} />
          </button>
          <button
            title="平移 · H"
            aria-label="平移工具"
            className={tool === "hand" ? "active" : ""}
            onClick={() => setTool("hand")}
          >
            <Hand size={18} />
          </button>
          <span className="toolbar-divider" />
          <button title="导入本地 DXF 图纸" onClick={() => setDialog("import")}>
            <Upload size={17} />
            <span>DXF 导入</span>
          </button>
          <button
            title="新增矩形或圆形组件"
            aria-label="新增组件"
            onClick={() => setDialog("part")}
          >
            <Plus size={18} />
            <span>组件</span>
          </button>
          <button
            title="新增板材 / 板材设置"
            aria-label="板材设置"
            onClick={() => setDialog("stock")}
          >
            <Layers size={18} />
            <span>板材</span>
          </button>
          <button
            className="primary"
            disabled={!s.project || s.importing}
            title="排版设置 / 取消搜索"
            onClick={() => s.status === "searching" ? s.cancel() : setDialog("settings")}
          >
            {s.status === "searching" ? <Square size={16} /> : <Play size={16} />}
            <span>{s.status === "searching" ? "取消搜索" : "排版"}</span>
          </button>
          <button disabled={!s.history.length} title="撤销 · Ctrl/⌘ Z" aria-label="撤销" onClick={s.undo}>
            <Undo2 size={17} />
          </button>
          <button disabled={!s.project} title="恢复可用原板位置，保留新增组件，可撤销" aria-label="恢复原图" onClick={s.reset}>
            <RotateCcw size={17} />
          </button>
          <button
            title="导出 SVG"
            aria-label="导出"
            onClick={() => setDialog("export")}
          >
            <Download size={18} />
          </button>
          <button title="数据分析" aria-label="数据分析" aria-pressed={analysisOpen} className={analysisOpen ? "active" : ""} onClick={() => { setAnalysisOpen(!analysisOpen); s.select(null); }}>
            <BarChart3 size={18} /><span>数据</span>
          </button>
          <button
            title="操作帮助"
            aria-label="操作帮助"
            onClick={() => setDialog("help")}
          >
            <HelpCircle size={18} />
          </button>
        </nav>
      </header>
      <div className={`workspace-surface ${analysisOpen ? "analysis-open" : "analysis-closed"}`}>
        <aside
          className={`parts-panel floating ${collapsed ? "collapsed" : ""}`}
        >
          <div className="panel-heading">
            <button
              onClick={() => setCollapsed(!collapsed)}
              aria-expanded={!collapsed}
            >
              <ChevronDown size={14} />
              <strong>组件</strong>
              <span>{s.project?.parts.length ?? 0}</span>
            </button>
          </div>
          {!collapsed && (
            <>
              <label className="component-search">
                <Search size={14} />
                <input
                  placeholder="搜索组件"
                  aria-label="搜索组件"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="parts-list">
                {items.map((p) => {
                  const current = s.current?.placements.find(
                      (v) => v.partId === p.id,
                    ),
                    source = s.source?.original.placements.find(
                      (v) => v.partId === p.id,
                    );
                  return (
                    <button
                      key={p.id}
                      className={`part-row ${s.selected === p.id ? "selected" : ""}`}
                      onClick={() => {
                        s.select(p.id);
                        setTool("select");
                      }}
                    >
                      <span className="thumbnail">
                        <Thumbnail part={p} />
                      </span>
                      <span className="part-row-copy">
                        <strong>{p.name}</strong>
                        <span>
                          {Math.round(p.width)} × {Math.round(p.height)} mm
                        </span>
                        <small>
                          {p.thickness} mm · 当前板{" "}
                          {s.project!.sheets.findIndex(
                            (v) => v.id === current?.sheetId,
                          ) + 1}
                          {source
                            ? ` / 原板 ${s.source!.sheets.findIndex((v) => v.id === source.sheetId) + 1}`
                            : " / 新建"}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="panel-foot">
                {s.project?.sheets.length ?? 0} 张板材 · 间距 {s.settings.gap}{" "}
                mm · 板边 {s.settings.margin} mm
              </div>
            </>
          )}
        </aside>
        <div className={`canvas-region ${collapsed ? "list-collapsed" : ""}`}>
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
                disabled={view === "candidate" && !s.candidate?.layout}
                onClick={() => s.setView(view)}
              >
                {label}
              </button>
            ))}
          </div>
          {project && layout && metrics && canvasLayout!.sheets.length ? (
            <StockCanvas
              project={project}
              layout={canvasLayout!}
              metrics={metrics}
              tool={tool}
              magnet={magnet}
              onMagnet={() => setMagnet(!magnet)}
            />
          ) : (
            <div className="empty-canvas">
              <div>
                <p>{s.importing ? "正在识别 DXF 图纸…" : project ? "暂无板材，新增板材后开始编辑" : "请从顶部工具栏导入 DXF"}</p>
                <button className="primary" onClick={() => setDialog(project ? "stock" : "import")}>
                  <Plus size={16} />{project ? "新增板材" : "DXF 导入"}
                </button>
              </div>
            </div>
          )}
          {(s.message || s.candidate || s.status === "searching") && (
            <div className="progress-strip floating" role="status">
              <span>
                {s.status === "searching"
                  ? `搜索中 · ${s.attempt} / ${s.settings.iterations} 次`
                  : s.message}
              </span>
              {s.candidate?.metrics && (
                <small>
                  利用率 {formatPercent(s.candidate.metrics.utilization)} · 行程{" "}
                  {(s.candidate.metrics.travel / 1000).toFixed(2)} m · 余料{" "}
                  {(s.candidate.metrics.reusableArea / 1e6).toFixed(2)} m²
                </small>
              )}
              {s.candidate && (
                <button
                  className="primary"
                  disabled={s.status === "searching"}
                  onClick={s.apply}
                >
                  应用候选
                </button>
              )}
            </div>
          )}
        </div>
        {!part && analysisOpen && project && layout && metrics && (
          <LayoutAnalysis project={project} layout={layout} metrics={metrics}
            source={s.source} currentProject={s.project} current={s.current}
            candidate={s.candidate?.layout ?? null} settings={s.settings} view={s.view}
            issues={issues} onCheck={() => setDialog("check")} onClose={() => setAnalysisOpen(false)} />
        )}
        {part && (
          <aside className="inspector floating">
            <div className="panel-heading">
              <strong>组件属性</strong>
              <button
                aria-label="关闭组件属性"
                title="关闭"
                onClick={() => s.select(null)}
              >
                <X size={16} />
              </button>
            </div>
            <h2>{part.name}</h2>
            <div className="inspector-preview">
              <Thumbnail part={part} />
            </div>
            <div className="part-dimensions">
              {part.width.toFixed(1)} × {part.height.toFixed(1)}{" "}
              <small>mm</small>
            </div>
            <dl>
              <div>
                <dt>板厚</dt>
                <dd>{part.thickness} mm</dd>
              </div>
              <div>
                <dt>所在板材</dt>
                <dd>
                  板{" "}
                  {project!.sheets.findIndex(
                    (v) => v.id === placement?.sheetId,
                  ) + 1}
                </dd>
              </div>
              <div>
                <dt>通孔</dt>
                <dd>{part.holes.length} 处</dd>
              </div>
              <div>
                <dt>铣槽</dt>
                <dd>{part.pockets.length} 处</dd>
              </div>
              {part.pockets.length > 0 && (
                <div>
                  <dt>槽深</dt>
                  <dd>
                    {[
                      ...new Set(part.pockets.map((v) => v.depth ?? "未知")),
                    ].join(" / ")}{" "}
                    mm
                  </dd>
                </div>
              )}
              <div>
                <dt>旋转</dt>
                <dd>{placement?.rotation ?? 0}°</dd>
              </div>
            </dl>
            <div className="inspector-actions">
              <button onClick={() => s.toggleLock(part.id)}>
                {placement?.locked ? <Lock size={14} /> : <Unlock size={14} />}{" "}
                {placement?.locked ? "解锁" : "锁定"}
              </button>
              <button
                disabled={
                  !s.settings.allowRotation ||
                  placement?.locked ||
                  s.view !== "current"
                }
                onClick={() =>
                  placement &&
                  s.movePart({
                    ...placement,
                    rotation: ((placement.rotation + 90) % 360) as Rotation,
                  })
                }
              >
                <RotateCw size={14} />
                旋转 90°
              </button>
            </div>
            <p className="hint">
              {s.view === "original"
                ? "正在查看不可变原图；切换当前排版后拖动编辑。"
                : "拖动组件调整位置，蓝线表示对齐参考。"}
            </p>
          </aside>
        )}
      </div>
      <footer className="statusbar">
        <span>
          <span className="file-info">{s.project?.name ?? "等待图纸"}</span> · {tool === "select" ? "↖ 选择 · V" : "✋ 平移 · H"}{" "}
          <span className="status-help">拖动组件调整 · Alt 关闭磁吸</span>
        </span>
        <span>
          {issues.length ? (
            <button
              className="status-warning"
              onClick={() => setDialog("check")}
            >
              {issues.length} 项待核对
            </button>
          ) : (
            "轮廓与间距检查通过"
          )}{" "}
          · 已放 {layout?.placements.length ?? 0}/{project?.parts.length ?? 0} ·
          用板 {new Set(layout?.placements.map((v) => v.sheetId)).size} 张 ·
          利用率 {formatPercent(metrics?.utilization ?? 0)}
        </span>
      </footer>
      <WorkspaceDialogs dialog={dialog} close={() => setDialog(null)} />
    </main>
  );
}
