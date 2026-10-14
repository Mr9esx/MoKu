import { expect, it } from "vitest";
import {
  createAssemblyRequestQueue,
  assemblyCheckProject,
} from "../src/core/assemblyRequests";
import type { AssemblyWorkerRequest } from "../src/core/assemblyRequests";
const job = (
  revision: number,
  kind: AssemblyWorkerRequest["kind"] = "analysis",
) => ({
  revision,
  kind,
  project: {} as AssemblyWorkerRequest["project"],
  assembly: {} as AssemblyWorkerRequest["assembly"],
});
it("keeps one worker job in flight and replaces superseded preview requests", () => {
  const sent: number[] = [];
  const queue = createAssemblyRequestQueue((r) => sent.push(r.revision));
  queue.enqueue(job(1));
  for (let id = 2; id <= 100; id++) queue.enqueue(job(id));
  expect(sent).toEqual([1]);
  queue.complete("analysis");
  expect(sent).toEqual([1, 100]);
  queue.complete("analysis");
  expect(sent).toEqual([1, 100]);
});
it("schedules candidate and collision work independently and clears obsolete requests on unmount", () => {
  const sent: string[] = [];
  const queue = createAssemblyRequestQueue((r) =>
    sent.push(r.kind + ":" + r.revision),
  );
  queue.enqueue(job(1));
  queue.enqueue(job(2, "guidance"));
  queue.enqueue(job(3, "guidance"));
  queue.enqueue(job(4));
  expect(sent).toEqual(["analysis:1", "guidance:2"]);
  queue.complete("guidance");
  expect(sent).toEqual(["analysis:1", "guidance:2", "guidance:3"]);
  queue.clear();
  queue.complete("analysis");
  expect(sent).toEqual(["analysis:1", "guidance:2", "guidance:3"]);
});
it("sends working parts without recursively cloning source files, layouts and imported baselines", () => {
  const project = {
    name: "source",
    units: "mm" as const,
    parts: [],
    sheets: [],
    original: { sheets: [], placements: [] },
    warnings: [],
    sourceFiles: [{ name: "heavy" }],
    importedSource: { name: "heavy" },
    assembly: { items: [] },
  };
  const input = assemblyCheckProject(project as never);
  expect(input).toEqual({
    name: "source",
    units: "mm",
    parts: [],
    sheets: [],
    original: { sheets: [], placements: [] },
    warnings: [],
  });
  expect(input.parts).toBe(project.parts);
});
