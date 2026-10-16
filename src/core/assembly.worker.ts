import type { AssemblyWorkerRequest } from "./assemblyRequests";
import { analyzeAssembly } from "./assemblyChecks";
import { placementCandidates } from "./assemblyGuidance";
self.onmessage = (event: MessageEvent<AssemblyWorkerRequest>) => {
  const { revision, project, assembly, partId, kind = "analysis" } = event.data;
  try {
    if (kind === "guidance")
      self.postMessage({
        kind,
        revision,
        candidates: partId
          ? placementCandidates(project, assembly, partId)
          : [],
      });
    else
      self.postMessage({
        kind,
        revision,
        analysis: analyzeAssembly(project, assembly, { installation: true, machining: true }),
      });
  } catch (error) {
    self.postMessage({
      kind,
      revision,
      error: error instanceof Error ? error.message : "装配检查失败",
    });
  }
};
