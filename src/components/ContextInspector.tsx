import { useState } from "react";
import { ArrowLeft, Lock, Unlock, RotateCw, Copy, Trash2 } from "lucide-react";
import { useWorkbench } from "../store";
import { Thumbnail } from "./Thumbnail";
import type { Part, Placement, Project, Rotation } from "../core/types";
export function ContextInspector({
  part,
  placement,
  project,
}: {
  part: Part;
  placement?: Placement;
  project: Project;
}) {
  const s = useWorkbench(),
    [target, setTarget] = useState(""),
    [quantity, setQuantity] = useState(1),
    readonly = s.view !== "current";
  const compatible = project.sheets.filter(
    (v) =>
      v.thickness === part.thickness &&
      v.material ===
        (part.material ??
          project.sheets.find((v) => v.id === part.stockId)?.material),
  );
  const selectedTarget = compatible.some((v) => v.id === target)
    ? target
    : (compatible[0]?.id ?? "");
  return (
    <aside className="inspector floating" aria-label="零件信息">
      <div className="panel-heading">
        <strong>零件信息</strong>
        <button aria-label="返回概览" onClick={() => s.select(null)}>
          <ArrowLeft size={14} />
          概览
        </button>
      </div>
      <h2>{part.name}</h2>
      <div className="inspector-preview">
        <Thumbnail part={part} />
      </div>
      <div className="part-dimensions">
        {part.width.toFixed(1)} × {part.height.toFixed(1)} <small>mm</small>
      </div>
      <dl>
        <div>
          <dt>板厚 / 材质</dt>
          <dd>
            {part.thickness} mm ·{" "}
            {part.material ??
              project.sheets.find((v) => v.id === part.stockId)?.material ??
              "未指定"}
          </dd>
        </div>
        <div>
          <dt>所在板材</dt>
          <dd>
            {placement
              ? project.sheets.find((v) => v.id === placement.sheetId)?.name
              : "待放置"}
          </dd>
        </div>
        <div>
          <dt>通孔 / 铣槽</dt>
          <dd>
            {part.holes.length} / {part.pockets.length}
          </dd>
        </div>
        {part.pockets.length > 0 && (
          <div>
            <dt>槽深</dt>
            <dd>{part.pockets.map((v) => v.depth ?? "未知").join(" / ")} mm</dd>
          </div>
        )}
        <div>
          <dt>旋转</dt>
          <dd>{placement?.rotation ?? 0}°</dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd className="source-name" title={part.source ?? project.name}>
            {part.source ?? project.name}
          </dd>
        </div>
      </dl>
      {!placement && (
        <div className="pending-placement">
          <strong>待放置</strong>
          <p className="hint">拖入板材，或选择目标板自动寻找合法位置。</p>
          <label>
            目标板材
            <select
              aria-label="放置目标板材"
              disabled={readonly}
              value={selectedTarget}
              onChange={(e) => setTarget(e.target.value)}
            >
              {!compatible.length && <option value="">暂无兼容板材</option>}
              {compatible.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.width} × {v.height}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            disabled={readonly || !selectedTarget}
            onClick={() => s.placePart(part.id, selectedTarget)}
          >
            放置到所选板材
          </button>
          {!compatible.length && (
            <p className="hint">请新增同材质、同板厚的板材。</p>
          )}
        </div>
      )}
      <div className="inspector-actions">
        <button
          disabled={readonly || !placement}
          onClick={() => s.toggleLock(part.id)}
        >
          {placement?.locked ? <Lock size={14} /> : <Unlock size={14} />}{" "}
          {placement?.locked ? "解锁" : "锁定"}
        </button>
        <button
          disabled={
            readonly ||
            !placement ||
            placement.locked ||
            !s.settings.allowRotation
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
      <div className="duplicate-controls">
        <label>
          复制数量
          <input
            aria-label="复制数量"
            type="number"
            min={1}
            max={100}
            value={quantity}
            onChange={(e) => setQuantity(e.target.valueAsNumber)}
          />
        </label>
        <button
          disabled={
            readonly ||
            !Number.isInteger(quantity) ||
            quantity < 1 ||
            quantity > 100
          }
          onClick={() => s.duplicatePart(part.id, quantity)}
        >
          <Copy size={14} />
          复制
        </button>
        <button disabled={readonly} onClick={() => s.removePart(part.id)}>
          <Trash2 size={14} />
          删除
        </button>
      </div>
      <p className="hint">
        {readonly
          ? "原始图纸和候选方案只读。切换当前排版后编辑。"
          : "修改可撤销。Esc 或空白短点击返回概览。"}
      </p>
    </aside>
  );
}
