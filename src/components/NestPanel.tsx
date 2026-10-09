import { Play, Square, Check, Undo2 } from "lucide-react";
import { useWorkbench, startSearch } from "../store";
import { modeLabels } from "../core/types";
import { SearchProgressLabel } from "./SearchProgressLabel";
import { EfficiencyChart } from "./EfficiencyChart";
export function NestPanel({ onStart = startSearch }: { onStart?: () => void }) {
  const s = useWorkbench();
  const fields = [
    ["gap", "零件间距", 0, 50],
    ["margin", "板边余量", 0, 100],
    ["minRemnantWidth", "余料最小宽", 10, 2000],
    ["minRemnantHeight", "余料最小长", 10, 4000],
    ...(s.settings.stopRule === "patience"
      ? [["patienceGenerations", "耐心代数", 1, 1000] as const]
      : [["iterations", "遗传代数", 1, 100] as const, ["searchSeconds", "搜索时长", 1, 300] as const]),
  ] as const;
  return (
    <section className="nest-panel">
      <div className="section-title">
        <span>02 / 排版设置</span>
        <small>寻找可用的下一版</small>
      </div>
      <div className="mode-select">
        {(["utilization", "machining", "remnant"] as const).map((mode) => (
          <button
            key={mode}
            className={s.settings.mode === mode ? "active" : ""}
            aria-pressed={s.settings.mode === mode}
            onClick={() => s.setSettings({ mode })}
          >
            {modeLabels[mode]}
          </button>
        ))}
      </div>
      <label className="stop-rule">自动停止条件
        <select aria-label="自动停止条件" value={s.settings.stopRule ?? "limits"}
          onChange={e=>s.setSettings({stopRule:e.target.value as "patience" | "limits"})}>
          <option value="patience">利用率平台期</option>
          <option value="limits">时间与代数限制</option>
        </select>
      </label>
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
                value={s.settings[key] ?? (key === "patienceGenerations" ? 50 : 5)}
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  if (
                    Number.isFinite(n) &&
                    n >= min &&
                    n <= max &&
                    (!["iterations","patienceGenerations"].includes(key) || Number.isInteger(n))
                  )
                    s.setSettings({ [key]: n });
                }}
              />
              <span>{["iterations","patienceGenerations"].includes(key) ? "代" : key === "searchSeconds" ? "秒" : "mm"}</span>
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
        SVGnest 根据轮廓与间距寻找接触位置，通过遗传搜索重新组合顺序和旋转。同板厚、同材质零件可跨板重新分配，锁定零件保持原位。
      </p>
      <p className="hint">{s.settings.stopRule === "patience"
        ? `最高已验证利用率连续 ${s.settings.patienceGenerations ?? 50} 代未提高时停止，不受时间和总代数上限截断。每个材质、板厚组都完成一代才计一次耐心；利用率提高会重新计数。`
        : `搜索时长 ${s.settings.searchSeconds ?? 5} 秒。各板厚、材质组分别计算代数，共享搜索时长。`}</p>
      {s.settings.stopRule === "patience" && <p className="hint">判定只看利用率，余料形状改善不重置计数。平台期停止不代表全局最优，可随时手动停止并保留最好候选。</p>}
      <EfficiencyChart />
      <div className="search-actions">
        {s.status === "searching" ? (
          <button className="primary" onClick={s.cancel}>
            <Square size={16} />
            取消搜索
          </button>
        ) : (
          <button
            className="primary"
            onClick={onStart}
            disabled={!s.project || s.importing || !s.project.parts.length}
          >
            <Play size={16} />
            开始排版
          </button>
        )}
        <button
          disabled={!s.candidate?.layout || s.status === "searching"}
          onClick={s.apply}
        >
          <Check size={16} />
          应用
        </button>
        <button
          disabled={!s.history.length}
          onClick={s.undo}
          data-tooltip="撤销上次应用"
        >
          <Undo2 size={16} />
        </button>
      </div>
      <div
        className={`search-status ${s.status === "error" ? "error" : ""}`}
        role="status"
      >
        {s.status === "searching"
          ? <SearchProgressLabel />
          : s.message || "SVGnest 轮廓排版与遗传搜索，保留最佳已验证方案。"}
      </div>
    </section>
  );
}
