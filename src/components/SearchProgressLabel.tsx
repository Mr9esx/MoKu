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
  const phase = limit > 0 && elapsed > limit ? "正在收尾"
    : p?.phase === "finalizing" ? "整理结果"
    : p?.phase === "searching" ? `第 ${p.group} 组 · ${p.generation} 轮`
    : "准备中";
  return <span className="search-progress-label">
    <span>{modeLabels[s.settings.mode]} · {phase} · {Math.floor(elapsed / 1000)} 秒</span>
  </span>;
}
