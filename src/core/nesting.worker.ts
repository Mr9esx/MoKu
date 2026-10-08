import { optimizeLayout } from "./nesting";
import type { Project, NestSettings } from "./types";
// The caller cancels a running synchronous search by terminating this Worker.
self.onmessage = (
  event: MessageEvent<{
    type: "start";
    project: Project;
    settings: NestSettings;
  }>,
) => {
  if (event.data.type !== "start") return;
  try {
    const result = optimizeLayout(
      event.data.project,
      event.data.settings,
      (attempt, best, bestLayout) => self.postMessage({ type: "progress", attempt, best, bestLayout }),
    );
    self.postMessage({ type: "done", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
