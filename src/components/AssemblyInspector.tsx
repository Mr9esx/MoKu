import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  LockKeyhole,
  Unlock,
  X,
  Plus,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import type {
  Assembly,
  AssemblyAnalysis,
  AssemblyIssue,
  AssemblyItem,
  AssemblyStep,
  PlacementCandidate,
  Vec3,
} from "../core/assemblyTypes";
import type { Part, Project } from "../core/types";
import {
  eulerFromRotation,
  geometrySignature,
  rotationFromEuler,
} from "../core/assemblyGeometry";
import { Select } from "./Select";
import { Thumbnail } from "./Thumbnail";
import {
  alignReferences,
  referencePoints,
  referencePreviewIssue,
  type AssemblyReference,
} from "./assemblySceneUtils";

function NumberField({
  label,
  value,
  unit = "mm",
  onCommit,
  optional = false,
}: {
  label: string;
  value: number | undefined;
  unit?: string;
  onCommit: (n: number | undefined) => void;
  optional?: boolean;
}) {
  const [text, setText] = useState(
      value === undefined ? "" : String(Math.round(value * 10000) / 10000),
    ),
    [error, setError] = useState(false);
  useEffect(() => {
    setText(
      value === undefined ? "" : String(Math.round(value * 10000) / 10000),
    );
    setError(false);
  }, [value]);
  const cancelBlur = useRef(false);
  const submit = () => {
    if (cancelBlur.current) {
      cancelBlur.current = false;
      return;
    }
    if (optional && !text.trim()) {
      onCommit(undefined);
      setError(false);
      return;
    }
    const n = Number(text);
    if (!text.trim() || !Number.isFinite(n)) {
      setError(true);
      return;
    }
    setError(false);
    if (n !== value) onCommit(n);
  };
  return (
    <label className={"assembly-number" + (error ? " invalid" : "")}>
      <span>{label}</span>
      <div>
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          aria-invalid={error || undefined}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelBlur.current = true;
              setText(value === undefined ? "" : String(value));
              setError(false);
              e.currentTarget.blur();
            }
          }}
        />
        <small>{unit}</small>
      </div>
      {error && <small className="field-error">请输入有限数值</small>}
    </label>
  );
}
const round = (n: number) => Math.round(n * 100) / 100;
type Props = {
  project: Project;
  assembly: Assembly;
  selected: string | null;
  analysis: AssemblyAnalysis | null;
  pending: boolean;
  guidancePending: boolean;
  blocked: boolean;
  candidates: PlacementCandidate[];
  candidateId: string | null;
  setCandidate: (id: string) => void;
  commit: (assembly: Assembly) => boolean;
  select: (id: string) => void;
  add: (id: string) => void;
  remove: () => void;
  locate: (issue: AssemblyIssue) => void;
  previewStep: (step: AssemblyStep | null, progress: number) => void;
  clearPreview: () => void;
  playbackCancellation: { current: number };
  cancelVersion: number;
  machiningFace: "front" | "back" | null;
  setMachiningFace: (face: "front" | "back") => void;
  previewReference: (
    pose: AssemblyItem,
    markers: { partId: string; reference: AssemblyReference }[],
  ) => void;
};
export function AssemblyInspector(p: Props) {
  const part = p.project.parts.find((v) => v.id === p.selected),
    item = p.assembly.items.find((v) => v.partId === p.selected);
  const errors = p.analysis?.issues.filter((i) => i.severity === "error") ?? [],
    pendingIssues =
      p.analysis?.issues.filter((i) => i.severity === "pending") ?? [];
  const patchItem = (next: AssemblyItem) =>
    p.commit({
      ...p.assembly,
      items: p.assembly.items.map((i) => (i.partId === next.partId ? next : i)),
    });
  const dims = p.analysis?.bounds
    ? {
        width: p.analysis.bounds.max.x - p.analysis.bounds.min.x,
        depth: p.analysis.bounds.max.y - p.analysis.bounds.min.y,
        height: p.analysis.bounds.max.z - p.analysis.bounds.min.z,
      }
    : null;
  const [tab, setTab] = useState<"part" | "check" | "rules">("part");
  const [showRejected, setShowRejected] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [section, setSection] = useState<"position" | "machining">("position");
  const openDetails = (
    next: typeof tab,
    focus: typeof section = "position",
  ) => {
    p.clearPreview();
    setTab(next);
    setSection(focus);
    setExpanded(true);
  };
  const visibleCandidates = p.candidates.filter(
    (c) => showRejected || c.status !== "invalid",
  );
  const rejectedCount = p.candidates.filter(
    (c) => c.status === "invalid",
  ).length;
  useEffect(() => {
    if (p.selected) setTab("part");
  }, [p.selected]);
  if (!expanded) {
    const relevant =
      p.analysis?.issues.filter(
        (i) =>
          i.kind !== "missing" &&
          (!i.partIds.length || (part && i.partIds.includes(part.id))),
      ) ?? [];
    const needsFace = part?.pockets.some((_, index) => {
      const config = p.assembly.pocketFaces[part.id];
      return (
        !config ||
        config.signature !== geometrySignature(part) ||
        !config.faces[index]
      );
    });
    return (
      <aside
        className="assembly-inspector is-compact floating"
        aria-label="装配信息"
      >
        <div className="assembly-compact-heading">
          <span>{part ? "当前零件" : "开始组装"}</span>
          {item?.locked && <LockKeyhole size={14} aria-label="零件已锁定" />}
        </div>
        <h2>{part?.name ?? "点选，再搭建"}</h2>
        {part ? (
          <p className="assembly-compact-size">
            {round(part.width)} × {round(part.height)} × {part.thickness} mm
          </p>
        ) : (
          <p className="assembly-compact-hint">
            点击左侧零件放入场景。
            <br />
            点选零件后，直接拖动摆放。
          </p>
        )}
        {part && !item && (
          <p className="assembly-compact-hint">尚未加入 · 在左侧点击零件放入场景</p>
        )}
        {p.guidancePending && item && (
          <p className="assembly-compact-hint" role="status">
            正在寻找可放置位置…
          </p>
        )}
        {(needsFace || relevant.length > 0) && (
          <p
            className={
              "assembly-compact-notice" +
              (relevant.some((i) => i.severity === "error")
                ? " has-errors"
                : "")
            }
            role="status"
          >
            {needsFace ? "槽加工面待确认，干涉检查尚未完成。" : relevant[0].message}
          </p>
        )}
        <div className="assembly-compact-footer">
          <button onClick={() => openDetails(part ? "part" : "rules", needsFace ? "machining" : "position")}>查看详情 <ChevronRight size={12} /></button>
        </div>
      </aside>
    );
  }
  return (
    <aside className="assembly-inspector floating" aria-label="装配信息">
      <div className="panel-heading">
        <strong>装配信息</strong>
        <button
          aria-label="收起装配详情"
          onClick={() => {
            p.clearPreview();
            setExpanded(false);
          }}
        >
          <X size={16} />
        </button>
      </div>
      <nav className="assembly-inspector-tabs" aria-label="装配信息分类">
        {(["part", "check", "rules"] as const).map((t, i) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => {
              p.clearPreview();
              setTab(t);
            }}
          >
            {["零件", "检查", "装配规则"][i]}
            {t === "check" && errors.length > 0 && (
              <small>{errors.length}</small>
            )}
          </button>
        ))}
      </nav>
      <div className="assembly-inspector-body">
        <div
          className={
            "assembly-check-status " +
            (errors.length
              ? "has-errors"
              : p.pending || pendingIssues.length || !p.analysis?.complete
                ? "is-pending"
                : "is-valid")
          }
          role="status"
        >
          {errors.length ? (
            <AlertTriangle size={16} />
          ) : p.analysis?.complete ? (
            <CheckCircle2 size={16} />
          ) : (
            <span className="assembly-status-dot" />
          )}
          <span>
            {p.pending
              ? "正在检测当前装配…"
              : errors.length
                ? errors.length + " 项需要调整"
                : !p.analysis?.complete
                  ? pendingIssues.some((i) => i.id === "basis:missing")
                    ? "尚未设置检测依据"
                    : "尚未完成检测"
                  : "已设置的检测项目通过"}
          </span>
          {tab !== "check" && (
            <button aria-label="查看装配检查" onClick={() => setTab("check")}>
              <ChevronRight size={16} />
            </button>
          )}
        </div>
        {p.blocked && (
          <p className="warning">当前装配只读，请先关闭弹窗或停止排版搜索。</p>
        )}
        {tab === "part" && (
          <>
            {part ? (
              <section className="assembly-part-details">
                <div className="assembly-part-summary">
                  <div className="assembly-part-thumbnail">
                    <Thumbnail part={part} />
                  </div>
                  <div>
                    <h2>{part.name}</h2>
                    <p>
                      {round(part.width)} × {round(part.height)} ×{" "}
                      {part.thickness} mm
                    </p>
                    <small>{part.material ?? "材质未指定"}</small>
                  </div>
                </div>
                {!item ? (
                  <>
                    <p className="hint">此零件尚未加入成品。</p>
                    <button
                      className="primary wide"
                      disabled={p.blocked}
                      onClick={() => p.add(part.id)}
                    >
                      <Plus size={15} />
                      加入组装
                    </button>
                  </>
                ) : (
                  <fieldset disabled={p.blocked} className="assembly-fields">
                    <details
                      className="assembly-disclosure"
                      open={section === "position"}
                    >
                      <summary>位置与朝向</summary>
                      <div className="assembly-section-title">
                        <span>精确坐标</span>
                        <button
                          aria-label={
                            item.locked ? "解除装配锁定" : "锁定装配零件"
                          }
                          data-tooltip="仅锁定 3D 位置，不影响二维排版锁定"
                          onClick={() =>
                            patchItem({ ...item, locked: !item.locked })
                          }
                        >
                          {item.locked ? (
                            <LockKeyhole size={15} />
                          ) : (
                            <Unlock size={15} />
                          )}
                        </button>
                      </div>
                      <fieldset
                        disabled={item.locked}
                        className="assembly-fields"
                      >
                        <div className="assembly-vector-fields">
                          {(["x", "y", "z"] as const).map((axis) => (
                            <NumberField
                              key={axis}
                              label={"位置 " + axis.toUpperCase()}
                              value={item.position[axis]}
                              onCommit={(n) =>
                                patchItem({
                                  ...item,
                                  position: { ...item.position, [axis]: n },
                                })
                              }
                            />
                          ))}
                        </div>
                        <div className="assembly-vector-fields">
                          {(["x", "y", "z"] as const).map((axis) => (
                            <NumberField
                              key={axis}
                              label={"旋转 " + axis.toUpperCase()}
                              unit="°"
                              value={eulerFromRotation(item.rotation)[axis]}
                              onCommit={(n) =>
                                patchItem({
                                  ...item,
                                  rotation: rotationFromEuler({
                                    ...eulerFromRotation(item.rotation),
                                    [axis]: n,
                                  }),
                                })
                              }
                            />
                          ))}
                        </div>
                      </fieldset>
                      {item.locked && (
                        <p className="hint">已锁定。解除后可拖动或调整数值。</p>
                      )}
                      <p className="hint">
                        X 宽 · Y 深 · Z 高；旋转采用 XYZ 顺序。
                      </p>
                    </details>
                    <details
                      className="assembly-disclosure"
                      open={section === "machining"}
                    >
                      <summary>加工面与局部方向</summary>
                      <div className="assembly-face-controls">
                        <span>查看局部加工方向</span>
                        {(["front", "back"] as const).map((face) => (
                          <button
                            key={face}
                            aria-pressed={p.machiningFace === face}
                            onClick={() => p.setMachiningFace(face)}
                          >
                            {face === "front" ? "正面 +Z" : "反面 −Z"}
                          </button>
                        ))}
                      </div>
                      {part.pockets.length > 0 && (
                        <div className="assembly-machining">
                          <h3>确认槽的加工面</h3>
                          <p className="hint">正面是局部 +Z，反面是局部 −Z。</p>
                          {part.pockets.map((pocket, index) => {
                            const config = p.assembly.pocketFaces[part.id],
                              valid =
                                config?.signature === geometrySignature(part);
                            return (
                              <label key={index}>
                                <span>
                                  槽 {index + 1} · 深 {pocket.depth ?? "未知"}{" "}
                                  mm
                                </span>
                                <Select
                                  aria-label={"槽 " + (index + 1) + " 加工面"}
                                  value={
                                    valid ? (config.faces[index] ?? "") : ""
                                  }
                                  options={[
                                    { value: "", label: "请选择加工面" },
                                    { value: "front", label: "正面 +Z" },
                                    { value: "back", label: "反面 −Z" },
                                  ]}
                                  onChange={(face) => {
                                    if (!face) return;
                                    p.setMachiningFace(
                                      face as "front" | "back",
                                    );
                                    p.commit({
                                      ...p.assembly,
                                      pocketFaces: {
                                        ...p.assembly.pocketFaces,
                                        [part.id]: {
                                          signature: geometrySignature(part),
                                          faces: {
                                            ...(valid ? config.faces : {}),
                                            [index]: face as "front" | "back",
                                          },
                                        },
                                      },
                                    });
                                  }}
                                />
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </details>
                    <details className="assembly-disclosure">
                      <summary>落位建议与不匹配原因</summary>
                      <div className="assembly-section-title">
                        <h3>可放置位置</h3>
                        <small>黄色为几何可放置</small>
                      </div>
                      {visibleCandidates.length ? (
                        <div className="assembly-candidates">
                          {visibleCandidates.map((c) => (
                            <div
                              className={
                                "assembly-candidate " +
                                c.status +
                                (c.id === p.candidateId ? " is-active" : "")
                              }
                              key={c.id}
                            >
                              <button
                                className="assembly-candidate-pick"
                                onClick={() => p.setCandidate(c.id)}
                              >
                                <i />
                                <span>
                                  {c.label}
                                  <small>
                                    {c.message ??
                                      (c.status === "valid"
                                        ? "最终位置已检查 · 安装路径单独检测"
                                        : c.status === "incomplete"
                                          ? "待确认加工面或配合规则"
                                          : "此处不适合当前零件")}
                                  </small>
                                </span>
                              </button>
                              <button
                                aria-label={"对齐到 " + c.label}
                                disabled={c.status !== "valid" || item.locked}
                                data-tooltip={
                                  c.status === "valid"
                                    ? "使用预览位置和朝向对齐；可撤销"
                                    : (c.message ?? "此候选未通过检查")
                                }
                                onClick={() =>
                                  patchItem({ ...c.pose, locked: item.locked })
                                }
                              >
                                对齐
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="hint">
                          {p.guidancePending
                            ? "正在核对可放置位置…"
                            : "尚无明确配合位置。可先移动零件，再选择装配规则建立配合关系。"}
                        </p>
                      )}
                      {rejectedCount > 0 && (
                        <button
                          className="assembly-rejected-toggle"
                          onClick={() => setShowRejected((v) => !v)}
                        >
                          {showRejected
                            ? "收起不匹配位置"
                            : "查看 " + rejectedCount + " 个不匹配位置及原因"}
                        </button>
                      )}
                    </details>
                    <details
                      className="assembly-disclosure"
                      onToggle={(event) => {
                        if (!event.currentTarget.open) p.clearPreview();
                      }}
                    >
                      <summary>按面、边或角点对齐</summary>
                      <ReferenceEditor
                        key={part.id}
                        {...p}
                        part={part}
                        item={item}
                      />
                    </details>
                    <details className="assembly-disclosure">
                      <summary>零件操作</summary>
                      <button
                        className="assembly-remove"
                        onClick={p.remove}
                      >
                        移出组装，保留零件
                      </button>
                    </details>
                  </fieldset>
                )}
              </section>
            ) : (
              <section className="assembly-overview">
                <h2>成品概览</h2>
                <div className="assembly-dimension-display">
                  <span>宽 × 深 × 高</span>
                  <strong>
                    {dims
                      ? [
                          round(dims.width),
                          round(dims.depth),
                          round(dims.height),
                        ].join(" × ")
                      : "—"}
                  </strong>
                  <small>mm · 最终装配外形</small>
                </div>
                <div className="assembly-overview-count">
                  <strong>
                    {p.assembly.items.length}
                    <small> / {p.project.parts.length}</small>
                  </strong>
                  <span>零件已加入</span>
                </div>
                <p>点击左侧零件查看参数。黄色帮助找位置，红色直接指出冲突。</p>
                <button className="wide" onClick={() => setTab("rules")}>
                  设置成品尺寸与配合关系
                </button>
              </section>
            )}
          </>
        )}
        {tab === "check" && (
          <section className="assembly-checks">
            <h3>问题与定位</h3>
            {p.analysis?.issues.length ? (
              <div className="assembly-issue-list">
                {p.analysis.issues.map((issue) => (
                  <button
                    className={"assembly-issue " + issue.severity}
                    key={issue.id}
                    onClick={() => p.locate(issue)}
                  >
                    <span className="assembly-issue-dot" />
                    <span>
                      {issue.message}
                      <small>
                        {issue.partIds
                          .map(
                            (id) =>
                              p.project.parts.find((part) => part.id === id)
                                ?.name ?? id,
                          )
                          .join(" / ")}
                      </small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="hint">
                {p.pending
                  ? "正在检查实体、尺寸、配合与安装路径。"
                  : p.analysis?.complete
                    ? "当前已设置的检查项目通过。"
                    : "请加入零件并设置检测依据。"}
              </p>
            )}
            <div className="assembly-detection-note">
              <strong>检查依据</strong>
              <p>
                真实轮廓、板厚及已确认的孔槽；成品目标尺寸；声明的配合关系；指定顺序下的直线插入。
              </p>
              <p>
                接触计算阈值 0.01
                mm，曲线精度沿用导入轮廓。黄色落点与整条安装路径分别检查。
              </p>
            </div>
          </section>
        )}
        {tab === "rules" && (
          <fieldset disabled={p.blocked} className="assembly-fields">
            <section>
              <h3>成品目标尺寸</h3>
              <p className="hint">留空表示暂不检查此方向。</p>
              <div className="assembly-vector-fields">
                {(["width", "depth", "height"] as const).map((axis, i) => (
                  <NumberField
                    key={axis}
                    label={["目标宽", "目标深", "目标高"][i]}
                    value={p.assembly.targets[axis]}
                    optional
                    onCommit={(n) =>
                      p.commit({
                        ...p.assembly,
                        targets: { ...p.assembly.targets, [axis]: n },
                      })
                    }
                  />
                ))}
              </div>
              <NumberField
                label="尺寸允许偏差"
                value={p.assembly.targets.tolerance}
                onCommit={(n) =>
                  p.commit({
                    ...p.assembly,
                    targets: { ...p.assembly.targets, tolerance: n ?? 0 },
                  })
                }
              />
            </section>
            <FitEditor
              key={p.selected ?? "none"}
              {...p}
              part={part}
              item={item}
            />
            <InstallationEditor {...p} item={item} />
          </fieldset>
        )}
      </div>
    </aside>
  );
}
function FitEditor(
  p: Props & { part: Part | undefined; item: AssemblyItem | undefined },
) {
  const receivers = p.project.parts.filter(
    (v) =>
      v.id !== p.selected && p.assembly.items.some((i) => i.partId === v.id),
  );
  const [receiverId, setReceiverId] = useState(""),
    [feature, setFeature] = useState(""),
    [edge, setEdge] = useState("0"),
    [depth, setDepth] = useState(6),
    [min, setMin] = useState(0.1),
    [max, setMax] = useState(0.5);
  const receiver = receivers.find((r) => r.id === receiverId),
    part = p.part;
  const features = receiver
    ? [
        ...receiver.pockets.map((_, i) => ({
          value: "pocket:" + i,
          label: "浅槽 " + (i + 1),
        })),
        ...receiver.holes.map((_, i) => ({
          value: "hole:" + i,
          label: "通孔 " + (i + 1),
        })),
      ]
    : [];
  return (
    <section className="assembly-rule-section">
      <h3>板件与槽的配合</h3>
      {!p.item || !part ? (
        <p className="hint">先选择已加入的插入零件，再指定接收孔槽。</p>
      ) : (
        <>
          <p className="hint">插入件：{part.name}。支持直边与矩形孔槽。</p>
          <label>
            接收零件
            <Select
              aria-label="配合接收零件"
              value={receiverId}
              options={[
                { value: "", label: "选择接收零件" },
                ...receivers.map((r) => ({ value: r.id, label: r.name })),
              ]}
              onChange={(id) => {
                setReceiverId(id);
                setFeature("");
              }}
            />
          </label>
          <label>
            接收位置
            <Select
              aria-label="配合孔槽"
              value={feature}
              options={[{ value: "", label: "选择孔或槽" }, ...features]}
              onChange={setFeature}
            />
          </label>
          <label>
            插入边
            <Select
              aria-label="配合插入边"
              value={edge}
              options={part.outline
                .map((v, i) => ({
                  value: String(i),
                  label:
                    "边 " +
                    (i + 1) +
                    " · " +
                    round(
                      Math.hypot(
                        v.x - part.outline[(i + 1) % part.outline.length].x,
                        v.y - part.outline[(i + 1) % part.outline.length].y,
                      ),
                    ) +
                    " mm",
                }))
                .filter(
                  (v) => Number(v.label.split(" · ")[1].split(" ")[0]) >= 1,
                )
                .slice(0, 128)}
              onChange={setEdge}
            />
          </label>
          <NumberField
            label="要求插入深度"
            value={depth}
            onCommit={(n) => setDepth(n ?? 6)}
          />
          <div className="assembly-pair-fields">
            <NumberField
              label="最小间隙"
              value={min}
              onCommit={(n) => setMin(n ?? 0)}
            />
            <NumberField
              label="最大间隙"
              value={max}
              onCommit={(n) => setMax(n ?? 0)}
            />
          </div>
          <button
            className="wide"
            disabled={!receiver || !feature}
            onClick={() => {
              if (!receiver || !feature) return;
              const [kind, index] = feature.split(":");
              p.commit({
                ...p.assembly,
                fits: [
                  ...p.assembly.fits,
                  {
                    id: crypto.randomUUID(),
                    partId: part.id,
                    receiverId: receiver.id,
                    feature: {
                      kind: kind as "pocket" | "hole",
                      index: Number(index),
                    },
                    maleEdge: Number(edge),
                    insertionDepth: depth,
                    minClearance: min,
                    maxClearance: max,
                    partSignature: geometrySignature(part),
                    receiverSignature: geometrySignature(receiver),
                  },
                ],
              });
            }}
          >
            <Plus size={14} />
            建立配合关系
          </button>
        </>
      )}
      <div className="assembly-fit-list">
        {p.assembly.fits.map((fit) => {
          const male = p.project.parts.find((v) => v.id === fit.partId),
            female = p.project.parts.find((v) => v.id === fit.receiverId);
          const stale =
            !male ||
            !female ||
            geometrySignature(male) !== fit.partSignature ||
            geometrySignature(female) !== fit.receiverSignature;
          return (
            <div key={fit.id}>
              <div>
                <strong>
                  {male?.name ?? "零件已删除"} → {female?.name ?? "零件已删除"}
                </strong>
                <small>
                  {fit.feature.kind === "pocket" ? "槽" : "孔"}{" "}
                  {fit.feature.index + 1} · 插入 {fit.insertionDepth} mm · 间隙{" "}
                  {fit.minClearance}–{fit.maxClearance} mm
                </small>
                {stale && (
                  <span className="warning">几何已变化，请重新确认</span>
                )}
              </div>
              {stale && male && female && (
                <button
                  onClick={() =>
                    p.commit({
                      ...p.assembly,
                      fits: p.assembly.fits.map((f) =>
                        f.id === fit.id
                          ? {
                              ...f,
                              partSignature: geometrySignature(male),
                              receiverSignature: geometrySignature(female),
                            }
                          : f,
                      ),
                    })
                  }
                >
                  重新确认
                </button>
              )}
              <button
                aria-label="删除配合关系"
                onClick={() =>
                  p.commit({
                    ...p.assembly,
                    fits: p.assembly.fits.filter((f) => f.id !== fit.id),
                  })
                }
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
const directions = [
  { value: "z+", label: "从上方插入", vector: { x: 0, y: 0, z: -1 } },
  { value: "z-", label: "从下方插入", vector: { x: 0, y: 0, z: 1 } },
  { value: "x+", label: "从 X 正向插入", vector: { x: -1, y: 0, z: 0 } },
  { value: "x-", label: "从 X 负向插入", vector: { x: 1, y: 0, z: 0 } },
  { value: "y+", label: "从 Y 正向插入", vector: { x: 0, y: -1, z: 0 } },
  { value: "y-", label: "从 Y 负向插入", vector: { x: 0, y: 1, z: 0 } },
];
function InstallationEditor(p: Props & { item: AssemblyItem | undefined }) {
  const [active, setActive] = useState<number | null>(null),
    [progress, setProgress] = useState(0),
    [playing, setPlaying] = useState(false);
  const playVersion = useRef(-1);
  useEffect(() => () => p.clearPreview(), []);
  useEffect(() => {
    setPlaying(false);
    setActive(null);
  }, [p.cancelVersion]);
  useEffect(() => {
    if (p.blocked) {
      setPlaying(false);
      p.clearPreview();
    }
  }, [p.blocked]);
  useEffect(() => {
    if (
      !playing ||
      active === null ||
      playVersion.current !== p.playbackCancellation.current
    )
      return;
    const version = playVersion.current;
    let frame = 0,
      start = performance.now();
    const animate = (now: number) => {
      if (version !== p.playbackCancellation.current) return;
      const t = Math.min(1, (now - start) / 2000);
      setProgress(t);
      const step = p.assembly.steps[active];
      if (step) p.previewStep(step, t);
      if (t < 1) frame = requestAnimationFrame(animate);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [playing, active, p.assembly.steps, p.cancelVersion]);
  const patch = (index: number, next: AssemblyStep) =>
    p.commit({
      ...p.assembly,
      steps: p.assembly.steps.map((s, i) => (i === index ? next : s)),
    });
  const reorder = (index: number, delta: number) => {
    const steps = [...p.assembly.steps];
    [steps[index], steps[index + delta]] = [steps[index + delta], steps[index]];
    setActive(null);
    p.clearPreview();
    p.commit({ ...p.assembly, steps });
  };
  return (
    <section className="assembly-rule-section">
      <h3>安装顺序与路径</h3>
      <p className="hint">逐件按指定直线插入；只检查此前已安装的零件。</p>
      {p.item && !p.assembly.steps.some((s) => s.partId === p.item!.partId) && (
        <button
          className="wide"
          onClick={() =>
            p.commit({
              ...p.assembly,
              steps: [
                ...p.assembly.steps,
                {
                  partId: p.item!.partId,
                  direction: { x: 0, y: 0, z: -1 },
                  distance: 100,
                },
              ],
            })
          }
        >
          将所选零件加入步骤
        </button>
      )}
      {p.assembly.steps.map((step, index) => {
        const name =
          p.project.parts.find((v) => v.id === step.partId)?.name ??
          "零件已删除";
        const direction = directions.find(
          (d) =>
            d.vector.x === step.direction.x &&
            d.vector.y === step.direction.y &&
            d.vector.z === step.direction.z,
        );
        return (
          <div key={step.partId} className="assembly-step">
            <div className="assembly-section-title">
              <strong>
                {index + 1}. {name}
              </strong>
              <div>
                <button
                  aria-label={"上移步骤 " + (index + 1)}
                  disabled={index === 0}
                  onClick={() => reorder(index, -1)}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  aria-label={"下移步骤 " + (index + 1)}
                  disabled={index === p.assembly.steps.length - 1}
                  onClick={() => reorder(index, 1)}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  aria-label={"删除步骤 " + (index + 1)}
                  onClick={() => {
                    setActive(null);
                    p.clearPreview();
                    p.commit({
                      ...p.assembly,
                      steps: p.assembly.steps.filter((_, i) => i !== index),
                    });
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <Select
              aria-label={"步骤 " + (index + 1) + " 插入方向"}
              value={direction?.value ?? "custom"}
              options={[
                ...directions.map((d) => ({ value: d.value, label: d.label })),
                { value: "custom", label: "自定义方向" },
              ]}
              onChange={(v) => {
                if (v === "custom") {
                  patch(index, { ...step, direction: { x: 1, y: 1, z: -1 } });
                  return;
                }
                const dir = directions.find((d) => d.value === v)!;
                patch(index, { ...step, direction: dir.vector });
              }}
            />
            {!direction && (
              <div className="assembly-vector-fields">
                {(["x", "y", "z"] as const).map((axis) => (
                  <NumberField
                    key={axis}
                    label={"方向 " + axis.toUpperCase()}
                    unit=""
                    value={step.direction[axis]}
                    onCommit={(n) =>
                      patch(index, {
                        ...step,
                        direction: { ...step.direction, [axis]: n },
                      })
                    }
                  />
                ))}
              </div>
            )}
            <NumberField
              label={"步骤 " + (index + 1) + " 起始距离"}
              value={step.distance}
              onCommit={(n) => patch(index, { ...step, distance: n ?? 100 })}
            />
            <button
              onClick={() => {
                playVersion.current = p.playbackCancellation.current;
                setActive(index);
                setProgress(0);
                setPlaying(true);
                p.previewStep(step, 0);
              }}
            >
              预览此步安装
            </button>
          </div>
        );
      })}
      {active !== null && p.assembly.steps[active] && (
        <div className="assembly-step-preview">
          <label>
            安装行程 {Math.round(progress * 100)}%
            <input
              aria-label="安装行程预览"
              type="range"
              min="0"
              max="1000"
              value={Math.round(progress * 1000)}
              onChange={(e) => {
                const t = Number(e.target.value) / 1000;
                setPlaying(false);
                setProgress(t);
                p.previewStep(p.assembly.steps[active!], t);
              }}
            />
          </label>
          <button
            onClick={() => {
              setPlaying(false);
              setActive(null);
              p.clearPreview();
            }}
          >
            返回最终装配
          </button>
        </div>
      )}
      {!p.assembly.steps.length && (
        <p className="hint">
          尚未设置安装顺序。最终位置无冲突并不代表能按任意顺序安装。
        </p>
      )}
    </section>
  );
}

function ReferenceEditor(p: Props & { part: Part; item: AssemblyItem }) {
  const [kind, setKind] = useState<"face" | "edge" | "point">("face");
  const [sourceId, setSourceId] = useState("front");
  const receivers = p.assembly.items.filter((i) => i.partId !== p.item.partId);
  const [receiverId, setReceiverId] = useState(receivers[0]?.partId ?? "");
  const [targetId, setTargetId] = useState("back");
  const [previewing, setPreviewing] = useState(false);
  const cancelSeen = useRef(p.cancelVersion);
  useEffect(() => {
    if (cancelSeen.current !== p.cancelVersion) {
      setPreviewing(false);
      cancelSeen.current = p.cancelVersion;
    }
  }, [p.cancelVersion]);
  const receiver = p.assembly.items.find((i) => i.partId === receiverId);
  const targetPart = p.project.parts.find((part) => part.id === receiverId);
  const sources = referencePoints(p.part).filter((r) => r.kind === kind);
  const targets = targetPart
    ? referencePoints(targetPart).filter((r) => r.kind === kind)
    : [];
  const from = sources.find((r) => r.id === sourceId) ?? sources[0];
  const to = targets.find((r) => r.id === targetId) ?? targets[0];
  const pose =
    receiver && from && to ? alignReferences(p.item, from, receiver, to) : null;
  const reset = () => {
    p.clearPreview();
    setPreviewing(false);
  };
  const previewIssue = p.analysis
    ? referencePreviewIssue(p.analysis, [p.item.partId, receiverId])
    : undefined;
  const uncertain = !!previewIssue;
  return (
    <section className="assembly-reference-editor">
      <h3>参考对齐</h3>
      <p className="hint">
        选择面、边中点或角点。面会相向贴合，边会同向对齐；预览后应用。
      </p>
      <label>
        参考类型
        <Select
          aria-label="参考类型"
          value={kind}
          options={[
            { value: "face", label: "面" },
            { value: "edge", label: "边中点" },
            { value: "point", label: "角点" },
          ]}
          onChange={(v) => {
            reset();
            setKind(v as typeof kind);
          }}
        />
      </label>
      <label>
        所选零件参考
        <Select
          aria-label="所选零件参考"
          value={from?.id ?? ""}
          options={sources.map((r) => ({ value: r.id, label: r.label }))}
          onChange={(v) => {
            reset();
            setSourceId(v);
          }}
        />
      </label>
      <label>
        对齐到零件
        <Select
          aria-label="对齐到零件"
          value={receiverId}
          options={receivers.map((i) => ({
            value: i.partId,
            label:
              p.project.parts.find((part) => part.id === i.partId)?.name ??
              i.partId,
          }))}
          onChange={(v) => {
            reset();
            setReceiverId(v);
          }}
        />
      </label>
      <label>
        目标参考
        <Select
          aria-label="目标参考"
          value={to?.id ?? ""}
          options={targets.map((r) => ({ value: r.id, label: r.label }))}
          onChange={(v) => {
            reset();
            setTargetId(v);
          }}
        />
      </label>
      <div className="assembly-reference-actions">
        <button
          disabled={!pose || p.item.locked}
          onClick={() => {
            if (!pose || !from || !to) return;
            p.previewReference(pose, [
              { partId: p.item.partId, reference: from },
              { partId: receiverId, reference: to },
            ]);
            cancelSeen.current = p.playbackCancellation.current;
            setPreviewing(true);
          }}
        >
          预览参考对齐
        </button>
        <button
          disabled={
            !pose ||
            !previewing ||
            p.pending ||
            uncertain ||
            !p.analysis ||
            p.item.locked
          }
          onClick={() => {
            if (pose)
              p.commit({
                ...p.assembly,
                items: p.assembly.items.map((i) =>
                  i.partId === pose.partId ? pose : i,
                ),
              });
            setPreviewing(false);
          }}
        >
          应用对齐
        </button>
      </div>
      {previewing && (
        <>
          <p className="hint">
            {p.pending
              ? "正在检查预览位置…"
              : uncertain
                ? (previewIssue?.message ?? "此对齐仍需确认，请调整参考。")
                : "当前参考位置可应用；安装路径仍按装配规则检查。"}
          </p>
          <button onClick={reset}>取消参考预览</button>
        </>
      )}
    </section>
  );
}
