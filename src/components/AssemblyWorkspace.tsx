import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload, Plus, Search, ChevronRight } from "lucide-react";
import { useWorkbench } from "../store";
import { emptyAssembly } from "../core/assemblyTypes";
import { assemblyShortcut } from "../core/assemblyEditing";
import { keyboardShortcut } from "../core/keyboardShortcuts";
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
  const [magnet, setMagnet] = useState(true),
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
  const blocked = s.status === "searching" || s.importing || !active || interactionBlocked;
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
  const removeSelected = () => {
    if (blocked || !assembly.items.some(i => i.partId === selected)) return;
    commit({ ...assembly, items: assembly.items.filter(i => i.partId !== selected) });
    setSnapped(null);
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
      const command = keyboardShortcut(e, "assembly");
      if (!command || ["workspace", "help", "import", "export"].includes(command.type)) return;
      if (command.type === "escape") {
        clearPreview();
        setSelected(null);
        e.preventDefault();
        return;
      }
      if (command.type === "view") {
        e.preventDefault();
        const kind = command.view === "selected" && (!assembly.items.some(i => i.partId === selected) || hiddenPartIds.includes(selected!)) ? "all" : command.view;
        setViewRequest(v => ({ kind, seq: v.seq + 1 }));
        return;
      }
      if (blocked) return;
      e.preventDefault();
      if (command.type === "undo") {
        clearPreview();
        setSnapped(null);
        s.undo();
      } else if (command.type === "magnet") setMagnet(v => !v);
      else if (command.type === "xray") setXray(v => !v);
      else if (command.type === "explode") { clearPreview(); setExploded(v => !v); }
      else if (command.type === "remove") removeSelected();
      else if (!exploded && !installationPreview && !referenceMarkers?.length && !hiddenPartIds.includes(selected!)) {
        const next = assemblyShortcut(assembly, selected, command);
        if (next) commit(next);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [active, blocked, interactionBlocked, s.undo, clearPreview, assembly, selected, hiddenPartIds, exploded, installationPreview, referenceMarkers, commit]);
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
    editingDisabled: !!preview && !!referenceMarkers?.length,
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
      <aside className="assembly-resources floating" aria-label="零件库">
        <div className="panel-heading">
          <strong>零件库</strong>
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
                    {(placed || spare) && <em>
                      {placed
                        ? hiddenPartIds.includes(part.id)
                          ? "已隐藏"
                          : "已在场景"
                        : "备用"}
                    </em>}
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
        onRemove={removeSelected}
        viewRequest={viewRequest}
        clearPreview={clearPreview}
      >
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
          remove={removeSelected}
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
      </AssemblyCanvas>
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
                  ? detection.analysis.machiningWarnings?.length
                    ? "装配检查：几何项目通过 · 刀口待确认"
                    : "装配检查：已设置项目通过"
                  : "装配检查：尚未完成"}
        </span>
        <span>
          {blocked
            ? "当前装配只读"
            : error}
        </span>
      </div>
    </div>
  );
}
