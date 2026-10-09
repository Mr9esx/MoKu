import { repairLayout } from "./repair";
import { optimizeLayout } from "./nesting";
import type { Project, NestSettings } from "./types";
// The caller cancels a running synchronous search by terminating this Worker.
self.onmessage = (
  event: MessageEvent<{
    type: "start";
    project: Project;
    settings: NestSettings;
    purpose?: "repair";
  }>,
) => {
  if (event.data.type !== "start") return;
  try {
    let lastSent = -Infinity;
    let lastGroup = -1;
    let lastPhase = "";
    let lastScope = "";
    let lastRound = -1;
    const result = (event.data.purpose === "repair" ? repairLayout : optimizeLayout)(
      event.data.project,
      event.data.settings,
      (attempt, best, bestLayout, progress) => {
        const now = performance.now();
        if (!bestLayout && now-lastSent < 200 && progress?.group===lastGroup &&
            progress.phase===lastPhase && (progress.scope ?? "")===lastScope &&
            progress.generation!==progress.generationLimit && (progress.rounds ?? -1)===lastRound) return;
        lastSent=now;lastGroup=progress?.group ?? -1;lastPhase=progress?.phase ?? "";lastScope=progress?.scope ?? "";lastRound=progress?.rounds ?? -1;
        self.postMessage({ type: "progress", attempt, best, bestLayout, progress });
      },
    );
    self.postMessage({ type: "done", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
