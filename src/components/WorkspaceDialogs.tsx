import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { MaterialSelect } from "./MaterialSelect";
import { StockForm } from "./StockForm";
import { useWorkbench, startSearch, startRepairSearch } from "../store";
import { NestPanel } from "./NestPanel";
import { ImportPreview } from "./ImportPreview";
import { validateLayout } from "../core/geometry";
import { exportEligibility, exportCurrentSvg } from "../core/export";
export type Dialog =
  | "settings"
  | "import"
  | "sample"
  | "restore"
  | "part"
  | "stock"
  | "stock-edit"
  | "export"
  | "help"
  | "check"
  | null;
export function WorkspaceDialogs({
  dialog,
  stockId,
  close,
}: {
  dialog: Dialog;
  stockId?: string;
  close: () => void;
}) {
  const s = useWorkbench(),
    ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("新零件"),
    [shape, setShape] = useState<"rectangle" | "circle">("rectangle"),
    [width, setWidth] = useState(200),
    [height, setHeight] = useState(100),
    [thickness, setThickness] = useState(12),
    [material, setMaterial] = useState("木材"),
    [quantity, setQuantity] = useState(1),
    [place, setPlace] = useState(false),
    [error, setError] = useState(""),
    [filename, setFilename] = useState("木作-排版");
  useEffect(() => {
    if (!dialog) return;
    setError("");
    setThickness(12);
    setQuantity(1);
    setPlace(false);
    setMaterial(s.project?.sheets[0]?.material ?? "木材");
    if (dialog === "import") workbench.setState({ importMessage: "" });
    setName("新零件");
    setWidth(200);
    setHeight(100);
    const previous = document.activeElement as HTMLElement;
    const focusFrame = requestAnimationFrame(() => {
      const target =
        ref.current?.querySelector<HTMLElement>("[data-autofocus]") ??
        ref.current?.querySelector<HTMLElement>("button,input,select");
      target?.focus();
      if (target instanceof HTMLInputElement) target.select();
    });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
      if (e.key === "Tab") {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]',
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
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [dialog]);
  if (!dialog) return null;
  const titles = {
    settings: "排版设置",
    import: "导入 DXF",
    sample: "预览示例图纸",
    restore: "恢复原图位置",
    part: "新增零件",
    stock: "新增板材",
    "stock-edit":
      s.project?.sheets.find((v) => v.id === stockId)?.name ?? "编辑板材",
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
          利用率：优先尝试减少用板；加工：减少零件中心间空移；余料：集中保留较大的连续矩形。搜索结束不代表已找到全局最优。
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
        ? validateLayout({ ...project, original: s.view === "original" ? layout : (s.current ?? layout) }, layout, s.settings)
        : [];
    const geometric = issues.filter(v => ["gap", "overlap", "boundary"].includes(v.kind));
    const blockers = issues.filter(v => !["gap", "overlap", "boundary"].includes(v.kind));
    const automaticLabels = project?.parts.filter(p => p.labelAssociation === "notch") ?? [];
    const canRepair = geometric.length > 0 && blockers.length === 0;
    const currentIssues = s.project && s.current
      ? validateLayout({ ...s.project, original: s.current }, s.current, s.settings) : [];
    content = (
      <>
        <section className="check-section">
          <h3>几何检查</h3>
          <p role="status">{issues.length
            ? `${issues.length} 项需要处理，其中 ${geometric.length} 项可尝试自动修复。`
            : "轮廓、板边、间距和板厚均通过检查。"}</p>
          <div className="issue-list">
            {issues.map((v, i) => (
              <button key={i} onClick={() => {
                if (v.partIds[0]) s.select(v.partIds[0]);
                close();
              }}>{v.message}</button>
            ))}
          </div>
          {canRepair && s.view === "original" && <>
            <p className="hint">原始图纸用于对照，修复以当前排版为起点。</p>
            <button onClick={() => s.setView("current")}>检查当前排版</button>
          </>}
          {canRepair && s.view !== "original" && <>
            <p className="hint">按当前间距 {s.settings.gap} mm、边距 {s.settings.margin} mm，使用 SVGnest 先调整问题零件及相邻零件，无法修复时再扩大重排范围。同材质、同板厚可跨板调整，锁定零件保持原位；候选通过独立检查后再应用。</p>
            <button className="primary" disabled={s.status === "searching" || s.importing || s.settings.iterations === 0}
              onClick={() => { startRepairSearch(); close(); }}>生成修复候选</button>
            {s.settings.iterations === 0 && <p className="warning">请在排版设置中将遗传代数设为大于 0。</p>}
          </>}
          {blockers.length > 0 && <p className="hint">请先处理板厚、材质、缺失零件或无效轮廓等问题，再生成候选。</p>}
          {s.view === "candidate" && issues.length === 0 && currentIssues.length > 0 &&
            <button className="primary" disabled={s.status === "searching"} onClick={() => { s.apply(); close(); }}>应用修复候选</button>}
        </section>
        {(automaticLabels.length > 0 || (project?.warnings.length ?? 0) > 0) &&
          <section className="check-section">
            <h3>图纸标注与导入提示</h3>
            {automaticLabels.length > 0 && <p>{automaticLabels.map(p => p.name).join("、")} 的凹口标注已按唯一包围框一一关联，保留原文字位置。</p>}
            {project?.warnings.map((v, i) => <p className="warning" key={i}>{v}</p>)}
            {project?.parts.some(p => p.labelAssociation === "nearest") &&
              <p className="hint">这类文字存在多个可能归属或位于零件包围框外，暂保留最近文字关联，需要核对编号。</p>}
          </section>}
      </>
    );
  } else if (dialog === "help")
    content = (
      <div className="help">
        <p>
          <kbd>V</kbd> 选择零件；拖动当前排版中的零件，松开后检查并保存。
        </p>
        <p>
          <kbd>H</kbd> 手形平移；普通滚轮移动画布，Shift 横向移动。
        </p>
        <p>
          <kbd>Ctrl / ⌘ + 滚轮</kbd> 围绕指针缩放；<kbd>Ctrl / ⌘ + 0</kbd>{" "}
          适应全部板材。
        </p>
        <p>
          <kbd>Alt</kbd> 拖动时暂时关闭 8 像素磁吸。
        </p>
        <p>
          <kbd>Ctrl / ⌘ + Z</kbd> 撤销新增、移动或应用；<kbd>Esc</kbd>{" "}
          关闭弹窗或取消拖动。
        </p>
        <p>
          恢复原图恢复仍在库存中的原板位置；已删除原板上的零件保留当前位置。新增板材和零件保留，可撤销。
        </p>
      </div>
    );
  else if (dialog === "import" || dialog === "sample")
    content = <ImportPreview close={close} sample={dialog === "sample"} />;
  else if (dialog === "restore")
    content = (
      <>
        <p>
          恢复仍在库存中的原板位置。原板已删除的零件保留当前位置；新增板材和零件保留。本次操作可撤销。
        </p>
        <button
          className="primary wide"
          onClick={() => {
            s.reset();
            close();
          }}
        >
          确认恢复原图位置
        </button>
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
  } else if (dialog === "stock" || dialog === "stock-edit")
    content = (
      <StockForm
        key={dialog === "stock" ? "new" : stockId}
        editing={dialog === "stock-edit"}
        stock={
          dialog === "stock-edit"
            ? s.project?.sheets.find((v) => v.id === stockId)
            : undefined
        }
        close={close}
      />
    );
  else
    content = (
      <>
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
            shape === "circle" ? "直径" : "宽度",
            width,
            setWidth,
            1,
            10000,
          )}
          {shape === "rectangle" &&
            numeric("高度", height, setHeight, 1, 10000)}
          {numeric("板厚", thickness, setThickness, 1, 100)}
        </div>
        <label>
          材质
          <MaterialSelect
            aria-label="材质"
            value={material}
            onChange={setMaterial}
          />
        </label>
        {dialog === "part" && (
          <>
            <label>
              数量
              <input
                aria-label="新增数量"
                type="number"
                min={1}
                max={100}
                value={quantity}
                onChange={(e) => setQuantity(e.target.valueAsNumber)}
              />
            </label>
            <label className="check-inline">
              <input
                type="checkbox"
                checked={place}
                onChange={(e) => setPlace(e.target.checked)}
              />
              立即寻找合法位置（默认加入待放置）
            </label>
          </>
        )}
        {dialog === "part" && (
          <div className="shape-preview">
            <svg viewBox="0 0 220 110" aria-label="零件参数预览">
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
            ? "加入待放置后，可拖入兼容板材或自动排版。勾选立即放置时会核对尺寸、板厚、材质与间距。"
            : "请指定板厚和材质；新增板材立即加入真实库存。"}
        </p>
        <button
          className="primary wide"
          onClick={() => {
            const ok = s.addPart({
              name,
              shape,
              width,
              height,
              thickness,
              material,
              quantity,
              place,
            });
            if (ok) close();
            else setError(latestMessage());
          }}
        >
          确认新增零件
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
        className={`modal ${dialog === "export" ? "export-drawer" : dialog === "stock" || dialog === "stock-edit" ? "stock-modal" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={titles[dialog]}
      >
        <div className="modal-title">
          <h2 data-tooltip-overflow={titles[dialog]}>{titles[dialog]}</h2>
          <button aria-label="关闭弹窗" data-tooltip="关闭 · Esc" onClick={close}>
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
