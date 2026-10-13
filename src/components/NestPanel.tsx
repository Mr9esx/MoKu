import { Play, Square, Check, Undo2 } from "lucide-react";
import { useWorkbench, startSearch, searchEditingReason } from "../store";
import { modeLabels, modeGoals } from "../core/types";
const modeDescriptions = {
  utilization: "减少用板面积，节省材料。",
  machining: "减少预计空移，辅助加工。",
  remnant: "留整块余料，方便下次使用。",
};
export function NestPanel({ onStart = startSearch }: { onStart?: () => void }) {
  const s = useWorkbench();
  const fields = [
    ["gap", "零件间距", 0, 50],
    ["margin", "板边余量", 0, 100],
    ["minRemnantWidth", "余料最小宽度", 10, 2000],
    ["minRemnantHeight", "余料最小长度", 10, 4000],
  ] as const;
  const numberInput = (
    key: (typeof fields)[number][0] | "patienceGenerations" | "iterations" | "searchSeconds",
    label: string, min: number, max: number,
  ) => <input
    aria-label={label}
    aria-describedby={key === "gap" ? "gap-description" : undefined}
    type="number"
    min={min}
    max={max}
    value={s.settings[key] ?? (key === "patienceGenerations" ? 50 : 5)}
    onChange={(e) => {
      const n = e.target.valueAsNumber;
      if (Number.isFinite(n) && n >= min && n <= max &&
        (!["iterations", "patienceGenerations"].includes(key) || Number.isInteger(n)))
        s.setSettings({ [key]: n });
    }}
  />;
  const numericField = ([key, label, min, max]: (typeof fields)[number]) => (
    <label key={key}>
      {label}
      <div className="input-unit">
        {numberInput(key, label, min, max)}
        <span>mm</span>
      </div>
      {key === "gap" && <small id="gap-description" className="setting-description">间距需大于或等于刀径。</small>}
    </label>
  );
  return (
    <section className="nest-panel">
      <div className="settings-scroll">
      <fieldset className="search-settings" disabled={s.status === "searching"} data-tooltip={s.status === "searching" ? searchEditingReason : undefined}>
      <section className="settings-group" aria-labelledby="nest-target-heading">
      <h3 id="nest-target-heading">排版目标</h3>
      <div className="mode-select">
        {(["utilization", "machining", "remnant"] as const).map((mode) => (
          <button
            key={mode}
            className={s.settings.mode === mode ? "active" : ""}
            aria-label={modeLabels[mode]}
            aria-describedby={`mode-${mode}-description`}
            aria-pressed={s.settings.mode === mode}
            onClick={() => s.setSettings({ mode })}
          >
            <strong>{modeLabels[mode]}</strong>
            <small id={`mode-${mode}-description`}>{modeDescriptions[mode]}</small>
          </button>
        ))}
      </div>
      </section>
      <section className="settings-group" aria-labelledby="nest-cut-heading">
      <h3 id="nest-cut-heading">加工约束</h3>
      <div className="setting-grid">
        {fields.slice(0, 2).map(numericField)}
      </div>
        <label className="rotation check" aria-describedby="rotation-description">
          <input
            type="checkbox"
            checked={s.settings.allowRotation}
            onChange={(e) => s.setSettings({ allowRotation: e.target.checked })}
          />
          允许改变零件方向
        </label>
        <p id="rotation-description" className="setting-description rotation-description">可选方向：0°、90°、180°、270°。</p>
      </section>
      <section className="settings-group" aria-labelledby="nest-remnant-heading">
      <h3 id="nest-remnant-heading">可用余料</h3>
      <div className="setting-grid">{fields.slice(2).map(numericField)}</div>
      <p className="setting-description remnant-description">小于此尺寸的余料不计为可用余料。</p>
      </section>
      <section className="settings-group" aria-labelledby="nest-stop-heading">
      <h3 id="nest-stop-heading">停止条件</h3>
      <div className={`stop-choice${s.settings.stopRule === "patience" ? " selected" : ""}`}>
        <label className="stop-choice-label">
          <input type="radio" name="stop-rule" value="patience" checked={s.settings.stopRule === "patience"}
            onChange={() => s.setSettings({ stopRule: "patience" })} />
          连续没有改善时停止
        </label>
        {s.settings.stopRule === "patience" && <div className="stop-sentence">
          <span className="stop-sentence-start">连续 {numberInput("patienceGenerations", "连续未改善轮数", 1, 1000)}</span>
          <span>轮没有更好的排版时停止。</span>
        </div>}
        {s.settings.stopRule === "patience" && <p className="setting-description stop-criterion">{modeGoals[s.settings.mode].description}</p>}
      </div>
      <div className={`stop-choice${s.settings.stopRule !== "patience" ? " selected" : ""}`}>
        <label className="stop-choice-label">
          <input type="radio" name="stop-rule" value="limits" checked={s.settings.stopRule !== "patience"}
            onChange={() => s.setSettings({ stopRule: "limits" })} />
          达到时间或次数上限时停止
        </label>
        {s.settings.stopRule !== "patience" && <div className="stop-limits">
          <label>最长时间 <span>{numberInput("searchSeconds", "最长排版时间", 1, 300)} 秒</span></label>
          <label data-tooltip="同材质、同板厚的零件为一组。每轮会评估多个排列，并非只尝试一次。">每组最多搜索 <span>{numberInput("iterations", "每组最多搜索轮数", 1, 100)} 轮</span></label>
        </div>}
      </div>
      </section>
      </fieldset>
      </div>
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
          aria-label="撤销上次应用"
          disabled={!s.history.length || s.status === "searching"}
          onClick={s.undo}
          data-tooltip={s.status === "searching" ? searchEditingReason : "撤销上次应用"}
        >
          <Undo2 size={16} />
        </button>
      </div>
      {s.status === "error" && <p className="error" role="alert">{s.message}</p>}
    </section>
  );
}
