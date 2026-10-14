import type { Assembly } from "./assemblyTypes";
import type { Project } from "./types";
export type AssemblyWorkerRequest = {
  kind: "analysis" | "guidance";
  revision: number;
  project: Project;
  assembly: Assembly;
  partId?: string | null;
};
/** Detection never needs the recursively retained original import or nesting inventory. */
export function assemblyCheckProject(project: Project): Project {
  return {
    name: project.name,
    units: project.units,
    parts: project.parts,
    sheets: [],
    original: { sheets: [], placements: [] },
    warnings: [],
  };
}
/** One running request per kind plus its newest successor, rather than a gesture backlog. */
export function createAssemblyRequestQueue(
  send: (request: AssemblyWorkerRequest) => void,
) {
  const busy = new Set<AssemblyWorkerRequest["kind"]>(),
    pending = new Map<AssemblyWorkerRequest["kind"], AssemblyWorkerRequest>();
  const enqueue = (request: AssemblyWorkerRequest) => {
    if (busy.has(request.kind)) {
      pending.set(request.kind, request);
      return;
    }
    busy.add(request.kind);
    send(request);
  };
  return {
    enqueue,
    complete(kind: AssemblyWorkerRequest["kind"]) {
      busy.delete(kind);
      const next = pending.get(kind);
      pending.delete(kind);
      if (next) enqueue(next);
    },
    clear() {
      busy.clear();
      pending.clear();
    },
  };
}
