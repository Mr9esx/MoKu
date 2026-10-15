import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Plus, Search, Package, ChevronRight } from "lucide-react";
import { useWorkbench } from "../store";
import { emptyAssembly } from "../core/assemblyTypes";
import type {
  Assembly,
  AssemblyItem,
  AssemblyIssue,
  AssemblyStep,
} from "../core/assemblyTypes";
import type { Project } from "../core/types";
import { AssemblyCanvas, type AssemblyView } from "./AssemblyCanvas";
import { AssemblyInspector } from "./AssemblyInspector";
import { Thumbnail } from "./Thumbnail";
import { useAssemblyAnalysis } from "./useAssemblyAnalysis";
import type { SceneState } from "./assemblyScene";
import type { Dialog } from "./WorkspaceDialogs";
import "./assembly.css";
const EMPTY = emptyAssembly();
export default function AssemblyWorkspace({
  project,
  active,
  open,
  interactionBlocked,
}: {
  project: Project;
  active: boolean;
  interactionBlocked: boolean;
  open: (dialog: Dialog) => void;
}) {
  const s = useWorkbench(),
    assembly = project.assembly ?? EMPTY;
  const [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [mobile, setMobile] = useState("canvas");
  const [tool, setTool] = useState<SceneState["tool"]>("select"),
    [magnet, setMagnet] = useState(true),
    [xray, setXray] = useState(false),
    [exploded, setExploded] = useState(false);
  const [preview, setPreview] = useState<AssemblyItem | null>(null),
    [snapped, setSnapped] = useState<string | null>(null),
    [candidateId, setCandidateId] = useState<string | null>(null);
  const [viewRequest, setViewRequest] = useState<{
    kind: AssemblyView;
    seq: number;
  }>({ kind: "all", seq: 0 });
  const [installationPreview, setInstallationPreview] =
      useState<SceneState["installationPreview"]>(null),
    [error, setError] = useState("");
  const [hiddenPartIds, setHiddenPartIds] = useState<string[]>([]);
  const [machiningFace, setMachiningFace] = useState<"front" | "back" | null>(
    null,
  );
  const [referenceMarkers, setReferenceMarkers] = useState<
    SceneState["referenceMarkers"]
  >([]);
  const playbackCancellation = useRef(0);
  const [cancelVersion, setCancelVersion] = useState(0);
  const clearPreview = useCallback(() => {
    playbackCancellation.current += 1;
    setCancelVersion(playbackCancellation.current);
    setInstallationPreview(null);
    setPreview(null);
    setReferenceMarkers([]);
  }, []);
  const toggleHidden = (id: string) => {
    clearPreview();
    setHiddenPartIds((ids) =>
      ids.includes(id) ? ids.filter((v) => v !== id) : [...ids, id],
    );
  };
  const blocked = s.status === "searching" || !active || interactionBlocked;
  const actual = useMemo(
    () =>
      preview
        ? {
            ...assembly,
            items: assembly.items.map((i) =>
              i.partId === preview.partId ? preview : i,
            ),
          }
        : assembly,
    [assembly, preview],
  );
  const detection = useAssemblyAnalysis(project, actual, assembly, selected);
  const candidates = detection.candidates;
  const select = useCallback(
    (id: string | null) => {
      clearPreview();
      setMachiningFace(null);
      setExploded(false);
      setSelected(id);
      setSnapped(null);
      setCandidateId(null);
      setMobile("canvas");
    },
    [clearPreview],
  );
  const commit = useCallback(
    (next: Assembly) => {
      clearPreview();
      const ok = s.updateAssembly(next);
      if (!ok) setError("未保存：请检查输入或解除装配锁定。");
      else setError("");
      return ok;
    },
    [s.updateAssembly, clearPreview],
  );
  const commitPose = (pose: AssemblyItem) => {
    setPreview(null);
    setSnapped(null);
    commit({
      ...assembly,
      items: assembly.items.map((i) =>
        i.partId === pose.partId ? { ...pose, locked: i.locked } : i,
      ),
    });
  };
  const add = (id: string) => {
    if (assembly.items.some((i) => i.partId === id)) return;
    const maxX = detection.analysis?.bounds?.max.x ?? 0;
    const next = {
      partId: id,
      position: { x: assembly.items.length ? maxX + 30 : 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    };
    if (
      commit({
        ...assembly,
        items: [...assembly.items, next],
        sparePartIds: assembly.sparePartIds.filter((v) => v !== id),
      })
    ) {
      select(id);
      setViewRequest((v) => ({ kind: "all", seq: v.seq + 1 }));
    }
  };
  const locate = (issue: AssemblyIssue) => {
    if (issue.partIds[0]) select(issue.partIds[0]);
    if (issue.kind === "installation" && issue.movingPosition)
      setInstallationPreview({
        partId: issue.partIds[0],
        position: issue.movingPosition,
        collisionPositions: issue.collisionPositions,
      });
    if (issue.kind === "collision" || issue.kind === "installation")
      setXray(true);
    setViewRequest((v) => ({
      kind: issue.partIds.length ? "selected" : "all",
      seq: v.seq + 1,
    }));
  };
  const previewStep = (step: AssemblyStep | null, progress: number) => {
    if (!step) {
      setInstallationPreview(null);
      return;
    }
    const item = assembly.items.find((i) => i.partId === step.partId);
    if (!item) return;
    const magnitude =
      Math.hypot(step.direction.x, step.direction.y, step.direction.z) || 1;
    const offset = (step.distance * (1 - progress)) / magnitude;
    setPreview(null);
    setExploded(false);
    setInstallationPreview({
      partId: step.partId,
      position: {
        x: item.position.x - step.direction.x * offset,
        y: item.position.y - step.direction.y * offset,
        z: item.position.z - step.direction.z * offset,
      },
    });
  };
  useEffect(() => {
    if (selected && !project.parts.some((p) => p.id === selected)) select(null);
  }, [project.parts, selected, select]);
  useEffect(() => {
    if (blocked) {
      clearPreview();
      setSnapped(null);
    }
  }, [blocked, clearPreview]);
  useEffect(() => {
    if (!active) return;
    const key = (e: KeyboardEvent) => {
      if (interactionBlocked) return;
      if (
        (e.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if (e.key === "Escape") {
        clearPreview();
        setSelected(null);
        e.preventDefault();
      }
      if (blocked) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        clearPreview();
        s.undo();
        return;
      }
      if (e.key.toLowerCase() === "v") setTool("select");
      if (e.key.toLowerCase() === "g") setTool("translate");
      if (e.key.toLowerCase() === "r") setTool("rotate");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, blocked, interactionBlocked, s.undo, clearPreview]);
  const visible = project.parts.filter((p) =>
    (p.name + " " + p.material + " " + p.thickness)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const errors =
    detection.analysis?.issues.filter(
      (i) => i.severity === "error" && i.kind !== "missing",
    ).length ?? 0;
  const remaining = project.parts.filter(
    (part) =>
      !assembly.items.some((i) => i.partId === part.id) &&
      !assembly.sparePartIds.includes(part.id),
  ).length;
  const sceneState: SceneState = {
    project,
    assembly: actual,
    selected,
    candidates,
    analysis: detection.analysis,
    tool,
    magnet,
    xray,
    exploded,
    blocked,
    preview,
    candidateId:
      candidateId ?? candidates.find((c) => c.status === "valid")?.id ?? null,
    installationPreview,
    hiddenPartIds,
    machiningFace,
    referenceMarkers,
  };
  return (
    <div className={"assembly-workspace mobile-" + mobile} hidden={!active}>
      <nav
        className="assembly-mobile-navigation floating"
        aria-label="组装工作区区域"
      >
        {[
          ["resources", "零件"],
          ["canvas", "场景"],
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
      <aside className="assembly-resources floating" aria-label="组装零件库">
        <div className="panel-heading">
          <strong>组装零件库</strong>
          <span className="section-index">01</span>
        </div>
        <div className="assembly-resource-actions">
          <button
            className="wide"
            disabled={blocked}
            onClick={() => open("import")}
          >
            <Upload size={15} />
            导入 DXF
          </button>
          <button
            aria-label="新增组装零件"
            disabled={blocked}
            onClick={() => open("part")}
            data-tooltip="新增矩形或圆形板件"
          >
            <Plus size={15} />
          </button>
        </div>
        <label className="component-search">
          <Search size={14} />
          <input
            aria-label="搜索组装零件"
            placeholder="名称、材质或板厚"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="assembly-resource-count">
          <span>{assembly.items.length} 已加入</span>
          <span>{assembly.sparePartIds.length} 备用</span>
        </div>
        <div className="assembly-parts-list">
          {visible.map((part) => {
            const placed = assembly.items.some((i) => i.partId === part.id),
              spare = assembly.sparePartIds.includes(part.id);
            return (
              <article
                className={
                  "assembly-resource-item" +
                  (part.id === selected ? " selected" : "")
                }
                key={part.id}
              >
                <button
                  className="assembly-resource-select"
                  aria-label={
                    (placed ? "选择组装零件 " : "放入场景 ") + part.name
                  }
                  disabled={!placed && blocked}
                  aria-pressed={part.id === selected}
                  onClick={() => {
                    if (!placed) add(part.id);
                    else {
                      if (hiddenPartIds.includes(part.id))
                        setHiddenPartIds((ids) =>
                          ids.filter((id) => id !== part.id),
                        );
                      select(part.id);
                    }
                  }}
                >
                  <div className="assembly-resource-thumb">
                    <Thumbnail part={part} />
                  </div>
                  <span>
                    <strong data-tooltip-overflow={part.name}>
                      {part.name}
                    </strong>
                    <small>
                      {Math.round(part.width * 100) / 100} ×{" "}
                      {Math.round(part.height * 100) / 100} · {part.thickness}{" "}
                      mm
                    </small>
                    <em>
                      {placed
                        ? hiddenPartIds.includes(part.id)
                          ? "已隐藏 · 点击显示"
                          : "已在场景"
                        : spare
                          ? "备用 · 点击放入场景"
                          : "点击放入场景"}
                    </em>
                  </span>
                  {placed ? <ChevronRight size={14} /> : <Plus size={15} />}
                </button>
                {placed && part.id === selected && (
                  <details className="assembly-resource-options">
                    <summary>更多操作</summary>
                    <button
                      className="assembly-rejected-toggle"
                      aria-label={
                        (hiddenPartIds.includes(part.id) ? "显示 " : "隐藏 ") +
                        part.name
                      }
                      onClick={() => toggleHidden(part.id)}
                    >
                      {hiddenPartIds.includes(part.id)
                        ? "显示零件"
                        : "隐藏零件"}
                    </button>
                  </details>
                )}
                {!placed && (
                  <details className="assembly-resource-options">
                    <summary>更多操作</summary>
                    <button
                      disabled={blocked}
                      onClick={() =>
                        commit({
                          ...assembly,
                          sparePartIds: spare
                            ? assembly.sparePartIds.filter(
                                (id) => id !== part.id,
                              )
                            : [...assembly.sparePartIds, part.id],
                        })
                      }
                    >
                      {spare ? "取消备用" : "标为备用"}
                    </button>
                  </details>
                )}
              </article>
            );
          })}
        </div>
        <div className="assembly-resource-footer">
          <Package size={14} />
          <span>
            每个零件可加入一次
            <br />
            更多数量请使用二维零件复制
          </span>
        </div>
      </aside>
      <AssemblyCanvas
        state={sceneState}
        callbacks={{
          select,
          preview: setPreview,
          commit: commitPose,
          snap: setSnapped,
          error: setError,
        }}
        pending={detection.pending}
        guidancePending={detection.guidancePending}
        error={error || detection.error || detection.guidanceError || ""}
        snapped={snapped}
        onTool={setTool}
        onMagnet={() => setMagnet((v) => !v)}
        onXray={() => setXray((v) => !v)}
        onExplode={() => {
          clearPreview();
          setExploded((v) => !v);
        }}
        onUndo={() => {
          clearPreview();
          s.undo();
        }}
        canUndo={!!s.history.length}
        viewRequest={viewRequest}
        clearPreview={clearPreview}
      />
      <AssemblyInspector
        project={project}
        assembly={assembly}
        selected={selected}
        analysis={detection.analysis}
        pending={detection.pending}
        blocked={blocked}
        candidates={candidates}
        guidancePending={detection.guidancePending}
        candidateId={sceneState.candidateId}
        setCandidate={setCandidateId}
        commit={commit}
        select={(id) => select(id)}
        add={add}
        locate={locate}
        previewStep={previewStep}
        clearPreview={clearPreview}
        playbackCancellation={playbackCancellation}
        cancelVersion={cancelVersion}
        machiningFace={machiningFace}
        setMachiningFace={setMachiningFace}
        previewReference={(pose, markers) => {
          clearPreview();
          setExploded(false);
          setPreview(pose);
          setReferenceMarkers(markers);
        }}
      />
      <div className="assembly-statusbar">
        <span>
          {detection.pending
            ? "检测中"
            : errors
              ? "装配检查：" + errors + " 项需要调整"
              : remaining
                ? assembly.items.length +
                  " 件已放入 · " +
                  remaining +
                  " 件待放入"
                : detection.analysis?.complete
                  ? "装配检查：已设置项目通过"
                  : "装配检查：尚未完成"}
        </span>
        <span>
          {blocked
            ? "当前装配只读"
            : error || "G 移动 · R 旋转 · Alt 暂停磁吸 · Esc 取消"}
        </span>
      </div>
    </div>
  );
}
