import { useEffect, useState } from "react";
import { useWorkbench } from "../store";
import { modeLabels } from "../core/types";

/** Group generations and wall time are separate; neither is a percent complete. */
export function SearchProgressLabel() {
  const s = useWorkbench();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [s.searchStartedAt]);
  const p = s.searchProgress;
  const elapsed = Math.max(p?.elapsedMs ?? 0,
    s.searchStartedAt === null ? 0 : now - s.searchStartedAt);
  const limit = p?.timeLimitMs ?? (s.settings.stopRule === "patience" ? 0 : (s.settings.searchSeconds ?? 5) * 1000);
  const group = p?.group ? `第 ${p.group}/${p.groups} 组 · ${p.thickness ? `${p.thickness} mm ` : ""}${p.material}` : "准备搜索";
  const scope = p?.scope === "repair-nearby" ? "相邻零件修复 · "
    : p?.scope === "repair-full" ? "扩大重排范围 · " : "";
  const phase = limit > 0 && elapsed > limit ? "正在收尾"
    : p?.phase === "finalizing" ? "校验并整理结果"
    : p?.phase === "searching" ? `当前组已完成 ${p.generation}${p.generationLimit ? `/${p.generationLimit}` : ""} 代`
    : "计算轮廓与接触位置";
  return <span className="search-progress-label">
    <span>{modeLabels[s.settings.mode]} · {scope}{group}</span>
    <small>{phase} · 已用 {Math.floor(elapsed / 1000)} 秒{limit > 0 ? ` / 上限 ${Math.ceil(limit / 1000)} 秒` : ""}</small>
    {p?.patience && <small>最高利用率未提高 · {p.patience.unchanged}/{p.patience.limit} 代</small>}
  </span>;
}
