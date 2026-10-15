import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { positionAssemblyActions } from "./assemblySceneUtils";
import { AssemblyViewCube } from "./AssemblyViewCube";
import { viewQuaternion } from "./viewCubeGeometry";
import type { AssemblyIssue, Rotation3, Vec3 } from "../core/assemblyTypes";
import {
  Magnet,
  Scan,
  Eye,
  Layers3,
  Undo2,
  Trash2,
  Link2,
  Check,
  X,
  RotateCcw,
} from "lucide-react";
import {
  createAssemblyScene,
  type SceneState,
  type SceneCallbacks,
} from "./assemblyScene";
export type AssemblyView = "all" | "selected" | "front" | "side" | "top";
type Props = {
  children: ReactNode;
  state: SceneState;
  callbacks: SceneCallbacks;
  pending: boolean;
  guidancePending: boolean;
  error: string;
  snapped: string | null;
  onMagnet: () => void;
  onXray: () => void;
  onExplode: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onRemove: () => void;
  joinPrompt?: string;
  join: {
    stage: "source" | "target" | "preview";
    targetName?: string;
    sourceLabel?: string;
    issue?: AssemblyIssue;
    canApply: boolean;
    checked: boolean;
  } | null;
  onJoin: () => void;
  onApplyJoin: () => void;
  clearPreview: () => void;
  viewRequest: { kind: AssemblyView; seq: number };
};
export function AssemblyCanvas(props: Props) {
  const container = useRef<HTMLDivElement>(null),
    api = useRef<ReturnType<typeof createAssemblyScene> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [orientation, setOrientation] = useState<Rotation3>(() =>
    viewQuaternion({ x: 1, y: -1.4, z: 1 }),
  );
  const [webglError, setWebglError] = useState(""),
    [retry, setRetry] = useState(0);
  const [zeroAxes, setZeroAxes] = useState<(keyof Vec3)[]>([]);
  const [contextAnchor, setContextAnchor] = useState<{ x: number; y: number } | null>(null);
  const contextElement = useRef<HTMLDivElement>(null);
  const [contextSize, setContextSize] = useState({ width: 80, height: 40 });
  useEffect(() => {
    if (!container.current) return;
    try {
      api.current = createAssemblyScene(container.current, {
        select: (id) => latest.current.callbacks.select(id),
        preview: (pose) => latest.current.callbacks.preview(pose),
        commit: (pose) => latest.current.callbacks.commit(pose),
        snap: (id) => latest.current.callbacks.snap(id),
        error: (message) => latest.current.callbacks.error(message),
        orientation: setOrientation,
        originSnap: setZeroAxes,
        facePick: (partId, reference) => latest.current.callbacks.facePick?.(partId, reference),
        faceStart: (partId, reference) => latest.current.callbacks.faceStart?.(partId, reference),
        contextAnchor: setContextAnchor,
      });
      api.current.update(latest.current.state);
      setWebglError("");
    } catch {
      setWebglError(
        "当前设备无法创建 3D 场景。请检查浏览器硬件加速，二维图纸仍可使用。",
      );
    }
    return () => {
      api.current?.dispose();
      api.current = null;
    };
  }, [retry]);
  useEffect(() => {
    api.current?.update(props.state);
  }, [props.state]);
  useEffect(() => {
    api.current?.fit(props.viewRequest.kind);
  }, [props.viewRequest]);
  const selected = props.state.project.parts.find(
    (p) => p.id === props.state.selected,
  );
  const selectedItem = props.state.assembly.items.find(
    (item) => item.partId === props.state.selected,
  );
  const candidate = props.state.candidates.find(
    (c) => c.id === (props.snapped ?? props.state.candidateId),
  );
  const selectedPose = props.state.preview?.partId === props.state.selected
    ? props.state.preview
    : selectedItem;
  const showContext = !!selectedItem && !selectedItem.locked && !props.state.blocked && !props.state.exploded && !props.state.installationPreview && props.state.assembly.items.length > 1 && (!!contextAnchor || !!props.join);
  useLayoutEffect(() => {
    const element = contextElement.current;
    if (!element) return;
    const measure = () => {
      const width = element.offsetWidth, height = element.offsetHeight;
      setContextSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [showContext]);
  const contextPosition = positionAssemblyActions(
    contextAnchor ?? { x: (container.current?.clientWidth ?? 800) / 2, y: (container.current?.clientHeight ?? 600) * 0.65 },
    { width: container.current?.clientWidth ?? 800, height: container.current?.clientHeight ?? 600 },
    contextSize,
  );
  const feedback =
    props.error ||
    props.joinPrompt ||
    (props.state.exploded
      ? "爆炸查看 · 检测仍使用原装配位置"
      : props.state.installationPreview
        ? "安装步骤预览 · 未修改装配"
        : props.state.referenceMarkers?.length && props.state.preview
          ? "参考对齐预览 · 未修改装配"
          : zeroAxes.length
            ? `${zeroAxes.map(axis => axis.toUpperCase()).join(" / ")} 已吸附到 0 · 继续拖动可脱离`
          : props.snapped
            ? "已对齐 · 继续拖动可脱离"
            : props.guidancePending
              ? "正在核对可放置位置…"
              : (candidate?.label ??
                (props.pending
                  ? "检测中…"
                  : selected && !selectedItem
                    ? "此零件尚未放入场景 · 点击“放入场景”继续"
                    : selected
                      ? "拖动零件或箭头移动 · 拖动圆环旋转 · 双击接触面拼合"
                      : props.state.assembly.items.length
                        ? "点击场景中的零件即可选择，也可以直接拖动"
                        : "点击左侧零件，放入场景开始组装")));
  return (
    <section className="assembly-canvas workbench-preview" aria-label="3D 组装场景">
      <div className="assembly-scene-host" ref={container} />
      <div className="assembly-scene-heading">
        <span className="assembly-eyebrow">ASSEMBLY / MM</span>
        <strong>{selected?.name ?? "搭建你的成品"}</strong>
        <span>
          {props.state.assembly.items.length} 个已加入 · X 宽 / Y 深 / Z 高
        </span>
        {selectedPose && (
          <div className="assembly-position-readout" role="group" aria-label="当前零件 XYZ 坐标，单位毫米">
            <span>装配坐标 · mm</span>
            <dl className="assembly-position-values">
              {(["x", "y", "z"] as const).map(axis => (
                <div key={axis} data-axis={axis} className={selectedPose.position[axis] === 0 ? "is-zero" : ""}>
                  <dt>{axis.toUpperCase()}</dt>
                  <dd>{Number(selectedPose.position[axis].toFixed(2))}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        <p className="assembly-camera-guide" aria-label="三维视角操作说明">
          <span>左键拖空白：旋转视角</span>
          <span>右键拖动：平移画面</span>
          <span>滚轮：缩放</span>
          <span>中键 / Shift＋左键也可平移</span>
        </p>
      </div>
      <div className="assembly-scene-legend" aria-label="场景颜色说明">
        <span>
          <i className="legend-red" />
          冲突位置
        </span>
        <span>
          <i className="legend-yellow" />
          可放置位置
        </span>
      </div>
      <div className="assembly-scene-feedback" role="status" aria-live="polite">
        {feedback}
      </div>
      {showContext && (
        <div
          ref={contextElement}
          className="assembly-context-actions floating"
          role="group"
          aria-label="零件就地操作"
          style={contextPosition}
        >
          {!props.join ? (
            <button onClick={props.onJoin} title="拼合：也可双击板的接触面直接开始"><Link2 size={15} />拼合</button>
          ) : (
            <>
              <span>{props.join.stage === "source" ? "点击本板的接触面" : props.join.stage === "target" ? `${props.join.sourceLabel}已选 · 拖到或点击目标板` : `贴合到 ${props.join.targetName}`}</span>
              <div className="assembly-context-buttons">
                {props.join.stage === "preview" && (
                  <>
                    <button className="primary" disabled={!props.join.canApply} onClick={props.onApplyJoin}><Check size={14} />应用拼合</button>
                    <button aria-label="重新选面" title="重新选面" onClick={props.onJoin}><RotateCcw size={14} /></button>
                  </>
                )}
                <button aria-label="取消拼合" title="取消拼合 · Esc" onClick={props.clearPreview}><X size={14} /></button>
              </div>
              {props.join.stage === "preview" && (
                <small role="status" className={props.join.issue?.severity === "error" ? "has-errors" : ""}>
                  {props.pending ? "正在检查…" : !props.join.checked ? "检测暂不可用" : props.join.issue?.message ?? "接触位置未发现冲突"}
                </small>
              )}
            </>
          )}
        </div>
      )}
      <div className="assembly-view-buttons floating" aria-label="三维视图">
        {(["all", "selected"] as const).map((view, index) => (
          <button
            key={view}
            onClick={() => api.current?.fit(view)}
            disabled={view === "selected" && !selectedItem}
          >
            {["适应全部", "定位所选"][index]}
          </button>
        ))}
      </div>
      {!webglError && (
        <AssemblyViewCube
          orientation={orientation}
          onOrient={(direction) => api.current?.orient(direction)}
          onOrbit={(dx, dy) => api.current?.orbitView(dx, dy)}
        />
      )}
      {props.state.installationPreview && (
        <button
          className="assembly-end-preview floating"
          onClick={props.clearPreview}
        >
          返回最终装配
        </button>
      )}
      <div className="assembly-dimension-errors">
        {props.state.analysis?.issues
          .filter((i) => i.kind === "dimension" && i.severity === "error")
          .map((i) => (
            <span key={i.id}>{i.message}</span>
          ))}
      </div>
      <nav className="assembly-tools floating" aria-label="三维编辑工具">
        <button
          aria-label="移出所选零件"
          disabled={!selectedItem || props.state.blocked}
          onClick={props.onRemove}
          data-tooltip="移出所选零件，保留零件库，可撤销"
        >
          <Trash2 size={17} />
        </button>
        <button
          aria-label="弱磁吸"
          aria-pressed={props.state.magnet}
          className={props.state.magnet ? "active" : ""}
          onClick={props.onMagnet}
          data-tooltip="靠近落位或坐标 0 时轻微吸附 · Alt 临时暂停"
        >
          <Magnet size={17} />
          <span>磁吸</span>
        </button>
        <button
          aria-label="透视查看"
          aria-pressed={props.state.xray}
          className={props.state.xray ? "active" : ""}
          onClick={props.onXray}
          data-tooltip="看清内部的红色冲突区域"
        >
          <Eye size={17} />
        </button>
        <button
          aria-label="爆炸查看"
          aria-pressed={props.state.exploded}
          className={props.state.exploded ? "active" : ""}
          onClick={props.onExplode}
          data-tooltip="仅分开展示，装配位置与检测不变"
        >
          <Layers3 size={17} />
        </button>
        <button
          aria-label="撤销装配操作"
          disabled={!props.canUndo || props.state.blocked}
          onClick={props.onUndo}
          data-tooltip="撤销上一次装配操作，也可恢复移出的零件"
        >
          <Undo2 size={17} />
        </button>
        <button
          aria-label="适应所有零件"
          onClick={() => api.current?.fit()}
          data-tooltip="适应所有零件"
        >
          <Scan size={17} />
        </button>
      </nav>
      {webglError && (
        <div className="assembly-webgl-error floating" role="alert">
          <p>{webglError}</p>
          <button onClick={() => setRetry((n) => n + 1)}>重新尝试</button>
        </div>
      )}
      {!props.state.assembly.items.length && !webglError && (
        <div className="assembly-scene-empty">
          <span>01</span>
          <h2>从一块板件开始</h2>
          <p>
            在左侧选择零件，点击“加入组装”。
            <br />
            移动时查看黄色落点，靠近即可轻轻对齐。
          </p>
        </div>
      )}
      <div className="preview-information">{props.children}</div>
    </section>
  );
}
