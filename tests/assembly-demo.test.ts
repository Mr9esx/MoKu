import { expect, it } from "vitest";
import { createAssemblyDemo } from "../src/core/assemblyDemo";
import { createWorkbenchStore } from "../src/store";
it("offers a physically sized slotted board example as an undoable import without replacing user parts", () => {
  const demo = createAssemblyDemo();
  expect(demo.parts.map((p) => [p.width, p.height, p.thickness])).toEqual([
    [120, 120, 12],
    [60, 80, 12],
  ]);
  expect(demo.parts[0].pockets[0].depth).toBe(6);
  expect(demo.assembly?.items[1].position).toEqual({ x: 70.4, y: 20, z: 6 });
  const store = createWorkbenchStore();
  store.getState().importProject({ ...demo, assembly: undefined });
  store.getState().confirmImport(demo, "append");
  expect(store.getState().project?.parts).toHaveLength(4);
  expect(store.getState().project?.assembly?.items).toHaveLength(2);
  store.getState().undo();
  expect(store.getState().project?.parts).toHaveLength(2);
});
