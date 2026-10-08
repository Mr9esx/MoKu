import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useWorkbench, startSearch } from "../store";
import { NestPanel } from "./NestPanel";
import { importDrawing } from "../import";
import { validateLayout } from "../core/geometry";
import { exportEligibility, exportCurrentSvg } from "../core/export";
export type Dialog =
  "settings" | "import" | "part" | "stock" | "export" | "help" | "check" | null;
export function WorkspaceDialogs({
  dialog,
  close,
}: {
  dialog: Dialog;
  close: () => void;
}) {
  const s = useWorkbench(),
    ref = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("新组件"),
    [shape, setShape] = useState<"rectangle" | "circle">("rectangle"),
    [width, setWidth] = useState(200),
    [height, setHeight] = useState(100),
    [thickness, setThickness] = useState(12),
    [error, setError] = useState(""),
    [filename, setFilename] = useState("木作-排版");
  useEffect(() => {
    if (!dialog) return;
    setError("");
    setThickness(12);
    if (dialog === "import") workbench.setState({ importMessage: "" });
    setName(dialog === "stock" ? "新板材" : "新组件");
    setWidth(dialog === "stock" ? 1220 : 200);
    setHeight(dialog === "stock" ? 2440 : 100);
    const previous = document.activeElement as HTMLElement;
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>("button,input,select")?.focus(),
    );
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input,select,[tabindex="0"]',
          ) ?? [],
        );
        const first = nodes[0],
          last = nodes.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [dialog]);
  if (!dialog) return null;
  const titles = {
    settings: "排版设置",
    import: "导入 DXF 图纸",
    part: "新增组件",
    stock: "板材设置",
    export: "导出排版",
    help: "操作帮助",
    check: "排版检查",
  };
  const numeric = (
    label: string,
    value: number,
    update: (v: number) => void,
    min: number,
    max: number,
  ) => (
    <label>
      {label}
      <div className="input-unit">
        <input
          aria-label={label}
          type="number"
          value={value}
          min={min}
          max={max}
          onChange={(e) => update(e.target.valueAsNumber)}
        />
        <span>mm</span>
      </div>
    </label>
  );
  let content: ReactNode;
  if (dialog === "settings")
    content = (
      <>
        <NestPanel
          onStart={() => {
            startSearch();
            close();
          }}
        />
        <p className="hint">
          利用率：优先尝试减少用板；加工：减少零件中心间空移；余料：保留更大的连续矩形。有限预算启发式搜索，不保证全局最优。
        </p>
      </>
    );
  else if (dialog === "check") {
    const project = s.view === "original" ? s.source : s.project;
    const layout =
      s.view === "original"
        ? s.source?.original
        : s.view === "candidate"
          ? s.candidate?.layout
          : s.current;
    const issues =
      project && layout
        ? validateLayout({ ...project, original: layout }, layout, s.settings)
        : [];
    content = (
      <>
        <p>
          {issues.length
            ? `${issues.length} 项需要核对；拖动或应用候选时会再次独立验证。`
            : "轮廓、板边、间距和板厚均通过检查。"}
        </p>
        <div className="issue-list">
          {issues.map((v, i) => (
            <button
              key={i}
              onClick={() => {
                if (v.partIds[0]) s.select(v.partIds[0]);
                close();
              }}
            >
              {v.message}
            </button>
          ))}
        </div>
        {s.project?.warnings.map((v, i) => (
          <p className="warning" key={i}>
            {v}
          </p>
        ))}
      </>
    );
  } else if (dialog === "help")
    content = (
      <div className="help">
        <p>
          <kbd>V</kbd> 选择组件；拖动当前排版中的组件，松开后检查并保存。
        </p>
        <p>
          <kbd>H</kbd> 手形平移；普通滚轮移动画布，Shift 横向移动。
        </p>
        <p>
          <kbd>Ctrl / ⌘ + 滚轮</kbd> 围绕指针缩放；<kbd>Ctrl / ⌘ + 0</kbd>{" "}
          适应全部板材。
        </p>
        <p>
          <kbd>Alt</kbd> 拖动时暂时关闭 8 像素弱磁吸。
        </p>
        <p>
          <kbd>Ctrl / ⌘ + Z</kbd> 撤销新增、移动或应用；<kbd>Esc</kbd>{" "}
          关闭弹窗或取消拖动。
        </p>
        <p>
          恢复原图只恢复导入组件的位置，保留新增板材和组件，可撤销。发生冲突的移动会保留原位置。
        </p>
      </div>
    );
  else if (dialog === "import")
    content = (
      <>
        <p>
          在浏览器内读取毫米单位
          DXF，图纸不会上传。识别板材边框、闭合组件轮廓、通孔与槽深。
        </p>
        <p className="hint">
          单位使用
          $INSUNITS=4（mm）；未声明毫米单位的文件会拒绝导入。图层约定请使用随附示例图纸：REF_STOCK
          / CUT_*MM / HOLE / POCKET_DEPTH数值，具体识别结果以解析反馈为准。
        </p>
        <input
          ref={file}
          type="file"
          accept=".dxf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importDrawing(f);
            e.target.value = "";
          }}
        />
        <button
          className="primary wide"
          disabled={s.importing}
          onClick={() => file.current?.click()}
        >
          {s.importing ? "正在解析…" : "选择本地 DXF 文件"}
        </button>
        {s.source && (
          <div className="import-result">
            <strong>{s.source.name}</strong>
            <p>
              原文件已识别 {s.source.sheets.length} 张板材 ·{" "}
              {s.source.parts.length} 个组件
            </p>
          </div>
        )}
        <p role="status">{s.importing ? "正在解析图纸…" : s.importMessage}</p>
        {s.source?.warnings.map((w, i) => (
          <p className="warning" key={i}>
            {w}
          </p>
        ))}
      </>
    );
  else if (dialog === "export") {
    const eligibility =
      s.project && s.current
        ? exportEligibility(s.project, s.current, s.settings)
        : { allowed: false, reason: "请先导入图纸" };
    content = (
      <>
        <label>
          导出格式
          <select value="svg" onChange={() => {}}>
            <option value="svg">SVG · 毫米尺寸</option>
          </select>
        </label>
        <label>
          文件名
          <input
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
          />
        </label>
        <p>
          导出当前排版的真实轮廓、通孔、铣槽及板材信息。SVG 为二维参考图，不含
          CNC 刀路。
        </p>
        <p className={!eligibility.allowed ? "warning" : "hint"} role="status">
          {eligibility.reason}
        </p>
        <button
          className="primary wide"
          disabled={!eligibility.allowed || s.importing}
          onClick={() => {
            try {
              const text = exportCurrentSvg(s.project!, s.current!, s.settings);
              const url = URL.createObjectURL(
                new Blob([text], { type: "image/svg+xml" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download =
                (filename.trim().replace(/[\\/:*?"<>|]/g, "-") || "木作-排版") +
                ".svg";
              document.body.append(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 30000);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          下载 SVG
        </button>
      </>
    );
  } else
    content = (
      <>
        {dialog === "stock" && (
          <div className="stock-list">
            {s.project?.sheets.map((v, i) => (
              <label key={v.id}>
                <span>
                  板材 {i + 1} · {v.name}
                  <small>
                    {v.width} × {v.height} mm · {v.material}
                  </small>
                </span>
                <input
                  aria-label={`板材 ${i + 1} 厚度`}
                  type="number"
                  min={1}
                  max={100}
                  value={v.thickness}
                  onChange={(e) => s.setThickness(v.id, e.target.valueAsNumber)}
                />
                <span>mm</span>
              </label>
            ))}
            <h3>新增板材</h3>
          </div>
        )}
        <label>
          名称
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {dialog === "part" && (
          <label>
            形状
            <select
              value={shape}
              onChange={(e) => setShape(e.target.value as typeof shape)}
            >
              <option value="rectangle">矩形</option>
              <option value="circle">圆形</option>
            </select>
          </label>
        )}
        <div className="form-grid">
          {numeric(
            dialog === "part" && shape === "circle" ? "直径" : "宽度",
            width,
            setWidth,
            dialog === "stock" ? 100 : 1,
            10000,
          )}
          {(dialog === "stock" || shape === "rectangle") &&
            numeric(
              "高度",
              height,
              setHeight,
              dialog === "stock" ? 100 : 1,
              10000,
            )}
          {numeric("板厚", thickness, setThickness, 1, 100)}
        </div>
        {dialog === "part" && (
          <div className="shape-preview">
            <svg viewBox="0 0 220 110" aria-label="组件参数预览">
              {shape === "circle" ? (
                <circle cx="110" cy="55" r="42" fill="#cdb68e" />
              ) : (
                <rect
                  x={110 - Math.min(180, (90 * width) / height) / 2}
                  y={55 - Math.min(90, (180 * height) / width) / 2}
                  width={Math.min(180, (90 * width) / height) || 0}
                  height={Math.min(90, (180 * height) / width) || 0}
                  fill="#cdb68e"
                />
              )}
            </svg>
            <span>
              {width || 0} {shape === "rectangle" ? `× ${height || 0}` : "直径"}{" "}
              mm · {thickness || 0} mm
            </span>
          </div>
        )}
        <p className="hint">
          {dialog === "part"
            ? "自动寻找匹配板厚、满足板边和间距的初始位置。无法放入时请先新增板材。"
            : "材质沿用同板厚板材；新增板材立即加入排版库存。"}
        </p>
        <button
          className="primary wide"
          onClick={() => {
            const ok =
              dialog === "part"
                ? s.addPart({ name, shape, width, height, thickness })
                : s.addStock({ name, width, height, thickness });
            if (ok) close();
            else setError(latestMessage());
          }}
        >
          确认新增{dialog === "part" ? "组件" : "板材"}
        </button>
      </>
    );
  return (
    <div
      className={`modal-backdrop ${dialog === "export" ? "drawer-backdrop" : ""}`}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        className={`modal ${dialog === "export" ? "export-drawer" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={titles[dialog]}
      >
        <div className="modal-title">
          <h2>{titles[dialog]}</h2>
          <button aria-label="关闭弹窗" title="关闭 · Esc" onClick={close}>
            <X size={18} />
          </button>
        </div>
        {content}
        {error && (
          <p className="warning" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
import { workbench } from "../store";
function latestMessage() {
  return workbench.getState().message;
}
