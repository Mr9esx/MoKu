import { describe, expect, it } from "vitest";
import { createWorkbenchStore } from "../src/store";
import { mergeImport } from "../src/core/importTransaction";
import type { Assembly } from "../src/core/assemblyTypes";
import type { Project } from "../src/core/types";
const rectangle = (id: string) => ({
  id,
  name: id,
  stockId: "s",
  layer: "CUT",
  material: "木",
  thickness: 12,
  width: 100,
  height: 80,
  area: 8000,
  outline: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
    { x: 0, y: 80 },
  ],
  holes: [],
  pockets: [],
  label: { x: 50, y: 40 },
});
const fixture = (): Project => ({
  name: "test",
  units: "mm",
  sheets: [
    {
      id: "s",
      name: "stock",
      width: 500,
      height: 500,
      thickness: 12,
      material: "木",
    },
  ],
  parts: [rectangle("a"), rectangle("b")],
  original: {
    sheets: [
      {
        id: "s",
        name: "stock",
        width: 500,
        height: 500,
        thickness: 12,
        material: "木",
      },
    ],
    placements: [
      { partId: "a", sheetId: "s", x: 20, y: 20, rotation: 0 },
      { partId: "b", sheetId: "s", x: 140, y: 20, rotation: 0 },
    ],
  },
  warnings: [],
});
const assembly = (): Assembly => ({
  items: [
    {
      partId: "a",
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
  ],
  pocketFaces: {},
  targets: { width: 100, tolerance: 0.5 },
  fits: [],
  steps: [],
  sparePartIds: [],
});
const setup = () => {
  const store = createWorkbenchStore();
  store.getState().importProject(fixture());
  return store;
};
describe("assembly transactions", () => {
  it("preserves nesting candidate, layout and source while committing one undoable pose", () => {
    const store = setup();
    const initial = structuredClone(store.getState().project);
    store.setState({
      candidate: {
        layout: structuredClone(fixture().original),
        metrics: null,
        originalMetrics: {
          sheetCount: 1,
          utilization: 0.1,
          outlineArea: 16000,
          stockArea: 250000,
          travel: 0,
          remnants: [],
          reusableArea: 0,
        },
        attempts: 1,
        elapsedMs: 0,
        message: "candidate",
        issues: [],
      },
      status: "done",
    });
    const before = store.getState();
    const source = structuredClone(before.source),
      layout = structuredClone(before.current),
      candidate = structuredClone(before.candidate),
      run = before.run;
    expect(before.updateAssembly(assembly())).toBe(true);
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().project?.assembly?.items[0].position).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
    expect(store.getState().source).toEqual(source);
    expect(store.getState().current).toEqual(layout);
    expect(store.getState().candidate).toEqual(candidate);
    expect(store.getState().run).toBe(run);
    const input = assembly();
    input.items[0].position.x = 75;
    store.getState().updateAssembly(input);
    input.items[0].position.x = 999;
    expect(store.getState().project?.assembly?.items[0].position.x).toBe(75);
    store.getState().undo();
    expect(store.getState().project?.assembly?.items[0].position.x).toBe(0);
    store.getState().undo();
    expect(store.getState().project).toEqual(initial);
  });
  it.each([
    "coordinate",
    "zero-quaternion",
    "duplicate",
    "unknown",
    "target",
    "fit",
    "step",
  ] as const)(
    "rejects invalid %s without changing history or project",
    (kind) => {
      const store = setup(),
        input = assembly(),
        before = structuredClone(store.getState().project);
      if (kind === "coordinate") input.items[0].position.x = NaN;
      if (kind === "zero-quaternion") input.items[0].rotation.w = 0;
      if (kind === "duplicate")
        input.items.push(structuredClone(input.items[0]));
      if (kind === "unknown") input.items[0].partId = "missing";
      if (kind === "target") input.targets.width = -1;
      if (kind === "fit")
        input.fits.push({
          id: "f",
          partId: "a",
          receiverId: "b",
          feature: { kind: "hole", index: 0 },
          maleEdge: 0,
          insertionDepth: NaN,
          minClearance: 0,
          maxClearance: 1,
          partSignature: "a",
          receiverSignature: "b",
        });
      if (kind === "step")
        input.steps.push({
          partId: "a",
          direction: { x: 0, y: 0, z: 0 },
          distance: 100,
        });
      expect(store.getState().updateAssembly(input)).toBe(false);
      expect(store.getState().project).toEqual(before);
      expect(store.getState().history).toHaveLength(0);
    },
  );
  it("rejects search-locked assembly edits and preserves locked parts until explicitly unlocked", () => {
    const store = setup(),
      input = assembly();
    input.items[0].locked = true;
    expect(store.getState().updateAssembly(input)).toBe(true);
    const moving = structuredClone(input);
    moving.items[0].position.x = 20;
    expect(store.getState().updateAssembly(moving)).toBe(false);
    moving.items[0].locked = false;
    expect(store.getState().updateAssembly(moving)).toBe(true);
    store.getState().beginSearch();
    moving.items[0].position.x = 25;
    expect(store.getState().updateAssembly(moving)).toBe(false);
  });
  it("removes and restores deleted assembly instances and leaves copied pieces unassembled", () => {
    const store = setup();
    store.getState().updateAssembly(assembly());
    store.getState().duplicatePart("a", 1);
    expect(store.getState().project?.assembly?.items).toHaveLength(1);
    store.getState().removePart("a");
    expect(store.getState().project?.assembly?.items).toHaveLength(0);
    store.getState().undo();
    expect(store.getState().project?.assembly?.items[0].partId).toBe("a");
  });
  it("preserves existing assembly on append and restores it when undoing a new project", () => {
    const store = setup();
    store.getState().updateAssembly(assembly());
    store.getState().confirmImport(fixture(), "append");
    expect(store.getState().project?.assembly?.items[0].partId).toBe("a");
    expect(store.getState().project?.parts).toHaveLength(4);
    store.getState().confirmImport(fixture(), "new");
    expect(store.getState().project?.assembly).toBeUndefined();
    store.getState().undo();
    expect(store.getState().project?.assembly?.items[0].partId).toBe("a");
  });
  it("remaps imported assembly references consistently and does not write assembly to source", () => {
    const base = fixture();
    base.assembly = assembly();
    const incoming = fixture();
    incoming.assembly = assembly();
    incoming.assembly.steps = [
      { partId: "a", direction: { x: 0, y: 0, z: 1 }, distance: 30 },
    ];
    incoming.assembly.sparePartIds = ["b"];
    const merged = mergeImport(
      { project: base, source: fixture(), current: base.original },
      incoming,
      "append",
    );
    expect(merged.project?.assembly?.items.map((x) => x.partId)).toEqual([
      "a",
      "a-import-1",
    ]);
    expect(merged.project?.assembly?.steps[0].partId).toBe("a-import-1");
    expect(merged.project?.assembly?.sparePartIds).toEqual(["b-import-1"]);
    expect(merged.source?.assembly).toBeUndefined();
  });
});
it("does not reuse an existing declared fit id when appending another assembly", () => {
  const before = fixture(),
    incoming = fixture();
  const declared = {
    id: "same-fit",
    partId: "a",
    receiverId: "b",
    feature: { kind: "hole" as const, index: 0 },
    maleEdge: 0,
    insertionDepth: 6,
    minClearance: 0,
    maxClearance: 1,
    partSignature: "a",
    receiverSignature: "b",
  };
  before.assembly = assembly();
  before.assembly.fits = [declared];
  incoming.assembly = assembly();
  incoming.assembly.fits = [{ ...declared }];
  const result = mergeImport(
    { project: before, source: fixture(), current: before.original },
    incoming,
    "append",
  );
  expect(new Set(result.project!.assembly!.fits.map((f) => f.id)).size).toBe(2);
});
