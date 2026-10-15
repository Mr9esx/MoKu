import { useEffect, useRef, useState } from "react";
import {
  Move,
  Rotate3D,
  MousePointer2,
  Magnet,
  Scan,
  Eye,
  Layers3,
  Undo2,
} from "lucide-react";
import {
  createAssemblyScene,
  type SceneState,
  type SceneCallbacks,
} from "./assemblyScene";
export type AssemblyView = "all" | "selected" | "front" | "side" | "top";
type Props = {
  state: SceneState;
  callbacks: SceneCallbacks;
  pending: boolean;
  guidancePending: boolean;
  error: string;
  snapped: string | null;
  onTool: (tool: SceneState["tool"]) => void;
  onMagnet: () => void;
  onXray: () => void;
  onExplode: () => void;
  onUndo: () => void;
  canUndo: boolean;
  clearPreview: () => void;
  viewRequest: { kind: AssemblyView; seq: number };
};
export function AssemblyCanvas(props: Props) {
  const container = useRef<HTMLDivElement>(null),
    api = useRef<ReturnType<typeof createAssemblyScene> | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [webglError, setWebglError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!container.current) return;
    try {
      api.current = createAssemblyScene(container.current, {
        select: (id) => latest.current.callbacks.select(id),
        preview: (pose) => latest.current.callbacks.preview(pose),
        commit: (pose) => latest.current.callbacks.commit(pose),
        snap: (id) => latest.current.callbacks.snap(id),
        error: (message) => latest.current.callbacks.error(message),
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
  const feedback =
    props.error ||
    (props.state.exploded
      ? "爆炸查看 · 检测仍使用原装配位置"
      : props.state.installationPreview
        ? "安装步骤预览 · 未修改装配"
        : props.state.referenceMarkers?.length && props.state.preview
          ? "参考对齐预览 · 未修改装配"
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
                      ? "直接拖动零件 · 空白处拖动转动视角"
                      : props.state.assembly.items.length
                        ? "点击场景中的零件即可选择，也可以直接拖动"
                        : "点击左侧零件，放入场景开始组装")));
  return (
    <section className="assembly-canvas" aria-label="3D 组装场景">
      <div className="assembly-scene-host" ref={container} />
      <div className="assembly-scene-heading">
        <span className="assembly-eyebrow">ASSEMBLY / MM</span>
        <strong>{selected?.name ?? "搭建你的成品"}</strong>
        <span>
          {props.state.assembly.items.length} 个已加入 · X 宽 / Y 深 / Z 高
        </span>
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
      <div className="assembly-view-buttons floating" aria-label="三维视图">
        {(["all", "selected", "front", "side", "top"] as const).map(
          (view, index) => (
            <button
              key={view}
              onClick={() => api.current?.fit(view)}
              disabled={view === "selected" && !selectedItem}
            >
              {["适应全部", "定位所选", "前视", "侧视", "顶视"][index]}
            </button>
          ),
        )}
      </div>
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
        {(
          [
            ["select", "选择", MousePointer2],
            ["translate", "移动", Move],
            ["rotate", "旋转", Rotate3D],
          ] as const
        ).map(([tool, label, Icon]) => (
          <button
            key={tool}
            aria-label={label}
            aria-pressed={props.state.tool === tool}
            className={props.state.tool === tool ? "active" : ""}
            onClick={() => props.onTool(tool)}
            disabled={props.state.blocked}
            data-tooltip={
              tool === "select"
                ? "点选或直接拖动零件；拖动空白转动视角"
                : tool === "translate"
                  ? "显示三轴移动控件"
                  : "显示旋转控件"
            }
          >
            <Icon size={17} />
            <span>{label}</span>
          </button>
        ))}
        <span className="tool-divider" />
        <button
          aria-label="弱磁吸"
          aria-pressed={props.state.magnet}
          className={props.state.magnet ? "active" : ""}
          onClick={props.onMagnet}
          data-tooltip="靠近可放置位置时轻微吸附 · Alt 临时暂停"
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
          data-tooltip="一次撤销恢复拖动前的位置"
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
    </section>
  );
}
