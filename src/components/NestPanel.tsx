import { Play, Square, Check, Undo2 } from "lucide-react";
import { useWorkbench, startSearch } from "../store";
export function NestPanel() {
  const s = useWorkbench();
  const fields = [
    ["gap", "零件间距", 0, 50],
    ["margin", "板边余量", 0, 100],
    ["minRemnantWidth", "余料最小宽", 10, 2000],
    ["minRemnantHeight", "余料最小长", 10, 4000],
    ["iterations", "尝试次数", 1, 100],
  ] as const;
  return (
    <section className="nest-panel">
      <div className="section-title">
        <span>02 / 排版设置</span>
        <small>寻找可用的下一版</small>
      </div>
      <div className="mode-select">
        {(
          [
            ["utilization", "利用率优先"],
            ["machining", "加工优先"],
            ["remnant", "余料优先"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            className={s.settings.mode === mode ? "active" : ""}
            onClick={() => s.setSettings({ mode })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="setting-grid">
        {fields.map(([key, label, min, max]) => (
          <label key={key}>
            {label}
            <div>
              <input
                aria-label={label}
                type="number"
                min={min}
                max={max}
                value={s.settings[key]}
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  if (
                    Number.isFinite(n) &&
                    n >= min &&
                    n <= max &&
                    (key !== "iterations" || Number.isInteger(n))
                  )
                    s.setSettings({ [key]: n });
                }}
              />
              <span>{key === "iterations" ? "次" : "mm"}</span>
            </div>
          </label>
        ))}
        <label className="rotation check">
          <input
            type="checkbox"
            checked={s.settings.allowRotation}
            onChange={(e) => s.setSettings({ allowRotation: e.target.checked })}
          />
          允许 90° 旋转
        </label>
      </div>
      <p className="hint">
        间距应以实际刀具为准。固定板材面积下，利用率保持不变；排版主要改善加工行程与可复用余料。
      </p>
      <div className="search-actions">
        {s.status === "searching" ? (
          <button className="primary" onClick={s.cancel}>
            <Square size={16} />
            取消搜索
          </button>
        ) : (
          <button
            className="primary"
            onClick={startSearch}
            disabled={!s.project || s.importing || !s.project.parts.length}
          >
            <Play size={16} />
            开始排版
          </button>
        )}
        <button disabled={!s.candidate?.layout} onClick={s.apply}>
          <Check size={16} />
          应用
        </button>
        <button
          disabled={!s.history.length}
          onClick={s.undo}
          title="撤销上次应用"
        >
          <Undo2 size={16} />
        </button>
      </div>
      <div
        className={`search-status ${s.status === "error" ? "error" : ""}`}
        role="status"
      >
        {s.status === "searching"
          ? `已完成 ${s.attempt} 次尝试 · 搜索中`
          : s.message || "采用有限尝试寻找可行方案，结果不保证最优。"}
      </div>
    </section>
  );
}
