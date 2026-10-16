import { describe, expect, it } from "vitest";
import { drawingSelectionRules, fitDrawingCanvas, selectDrawingShape } from "../src/core/drawingCanvas";
import type { DrawingDocument } from "../src/core/drawingTypes";

describe("drawing preview navigation", () => {
  it("fits CAD coordinates into the actual canvas with Y upward", () => {
    const view = fitDrawingCanvas([{ x: 100, y: 200 }, { x: 300, y: 300 }], { width: 300, height: 200 });
    expect(view.x).toBe(75);
    expect(view.y).toBeCloseTo(-1000 / 3);
    expect(view.width).toBe(250);
    expect(view.height).toBeCloseTo(500 / 3);
  });
  it("ignores nonfinite drawing coordinates instead of losing the entire preview", () => {
    const view = fitDrawingCanvas([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: Infinity, y: 1 }, { x: 2, y: NaN }], { width: 160, height: 160 });
    expect(view).toEqual({ x: -30, y: -130, width: 160, height: 160 });
  });
  it("has a finite recoverable overview when no usable points exist", () => {
    const view = fitDrawingCanvas([], { width: 300, height: 200 });
    expect(Object.values(view).every(Number.isFinite)).toBe(true);
    expect(view.width / view.height).toBeCloseTo(1.5);
    expect(view.width).toBeGreaterThan(0);
  });
});

describe("drawing canvas selection", () => {
  it("replaces the previous selection on an ordinary click", () => {
    expect(selectDrawingShape(["outer", "hole"], "pocket", false)).toEqual(["pocket"]);
  });
  it("adds and removes shapes across layers without changing the other selected shapes", () => {
    expect(selectDrawingShape(["outer"], "hole", true)).toEqual(["outer", "hole"]);
    expect(selectDrawingShape(["outer", "hole", "pocket"], "hole", true)).toEqual(["outer", "pocket"]);
  });
  it("clears the selection when its last shape is toggled off", () => {
    expect(selectDrawingShape(["hole"], "hole", true)).toEqual([]);
  });
});

it("changes only selected purposes and retains each pocket's own machining parameters", () => {
  const document: DrawingDocument = {
    name: "drawing", unitKnown: true, importInfo: { sourceUnit: "毫米", scale: 1, overridden: false },
    spaces: ["Model"], labels: [], diagnostics: [],
    shapes: ["a", "b", "c"].map(id => ({ id, layer: id, space: "Model", entityType: "LWPOLYLINE", sourceIds: [id], closed: true, valid: true, points: [] })),
  };
  const result = drawingSelectionRules(document, ["a", "b"], {
    a: { role: "pocket", depth: 3, pocketGeometry: "centerline", slotWidth: 4, geometrySource: "original" },
    b: { role: "pocket", depth: 6, thickness: 12 },
    c: { role: "outer" },
  }, {}, "pocket");
  expect(result.a).toMatchObject({ role: "pocket", depth: 3, pocketGeometry: "centerline", slotWidth: 4, geometrySource: "original" });
  expect(result.b).toMatchObject({ role: "pocket", depth: 6, thickness: 12 });
  expect(result).not.toHaveProperty("c");
  const ignored = drawingSelectionRules(document, ["a", "b"], {}, result, "ignore");
  const restored = drawingSelectionRules(document, ["a", "b"], {}, ignored, "pocket");
  expect(restored.a).toMatchObject({ role: "pocket", depth: 3, pocketGeometry: "centerline", slotWidth: 4, geometrySource: "original" });
  expect(restored.b).toMatchObject({ role: "pocket", depth: 6, thickness: 12 });
});
