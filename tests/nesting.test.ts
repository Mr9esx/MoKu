import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { optimizeLayout } from "../src/core/nesting";
import { validateLayout } from "../src/core/geometry";
import { parseDxf } from "../src/core/dxf";
import type { Project, NestSettings, Part } from "../src/core/types";
const settings: NestSettings = {
  mode: "utilization",
  gap: 1,
  margin: 1,
  allowRotation: true,
  minRemnantWidth: 10,
  minRemnantHeight: 10,
  iterations: 3,
};
function fixture(w = 20, h = 20): Project {
  const sheets = [
    {
      id: "s",
      name: "s",
      width: 70,
      height: 50,
      thickness: 12,
      material: "wood",
    },
    {
      id: "t",
      name: "t",
      width: 70,
      height: 50,
      thickness: 12,
      material: "wood",
    },
  ];
  const parts: Part[] = ["a", "b", "c"].map((id) => ({
    id,
    name: id,
    stockId: "s",
    layer: "",
    thickness: 12,
    width: w,
    height: h,
    area: w * h,
    outline: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    holes: [],
    pockets: [],
    label: { x: 1, y: 1 },
  }));
  return {
    name: "fixture",
    units: "mm",
    sheets,
    parts,
    warnings: [],
    original: {
      sheets,
      placements: parts.map((p, i) => ({
        partId: p.id,
        sheetId: i === 2 ? "t" : "s",
        x: 1 + (i % 2) * 22,
        y: 1,
        rotation: 0,
      })),
    },
  };
}
it("compacts sheets, preserves all parts, validates and does not mutate", () => {
  const p = fixture(),
    before = JSON.stringify(p);
  const r = optimizeLayout(p, settings);
  expect(r.layout?.placements.map((p) => p.partId).sort()).toEqual([
    "a",
    "b",
    "c",
  ]);
  expect(r.metrics?.sheetCount).toBe(1);
  expect(validateLayout(p, r.layout!, settings)).toEqual([]);
  expect(JSON.stringify(p)).toBe(before);
});
it("keeps locked placement unchanged", () => {
  const p = fixture();
  p.original.placements[0].locked = true;
  const r = optimizeLayout(p, settings);
  expect(r.layout?.placements.find((v) => v.partId === "a")).toEqual(
    p.original.placements[0],
  );
});
it("rotates narrow pieces when required", () => {
  const p = fixture(45, 15);
  p.parts = p.parts.slice(0, 1);
  p.sheets = p.sheets.slice(0, 1).map((s) => ({ ...s, width: 30, height: 55 }));
  p.original = { sheets: p.sheets, placements: [] };
  const r = optimizeLayout(p, settings);
  expect(r.layout?.placements[0].rotation % 180).toBe(90);
});
it("rejects impossible geometry, incompatible thickness and invalid settings", () => {
  const p = fixture(100, 100);
  expect(optimizeLayout(p, settings).layout).toBeNull();
  p.parts[0].thickness = 15;
  expect(optimizeLayout(p, settings).layout).toBeNull();
  expect(() => optimizeLayout(fixture(), { ...settings, gap: NaN })).toThrow();
  expect(() =>
    optimizeLayout(fixture(), { ...settings, mode: "bad" as never }),
  ).toThrow();
});
it("never passes through an illegal source and reports bounded progress", () => {
  const p = fixture();
  p.original.placements[1].x = 2;
  let progress = 0;
  const r = optimizeLayout(p, settings, () => progress++);
  expect(validateLayout(p, r.layout!, settings)).toEqual([]);
  expect(progress).toBeGreaterThan(0);
  expect(r.attempts).toBeLessThanOrEqual(settings.iterations);
});
it.each(["utilization", "machining", "remnant"] as const)(
  "validates %s candidates",
  (mode) => {
    const p = fixture();
    const r = optimizeLayout(p, { ...settings, mode });
    expect(validateLayout(p, r.layout!, { ...settings, mode })).toEqual([]);
  },
);
it("preserves real 53-part sample as feasible seed and never returns illegal gap", () => {
  const p = parseDxf(readFileSync("public/sample.dxf", "utf8"), "sample");
  for (const gap of [3, 6]) {
    const s = { ...settings, gap, margin: 6, iterations: 1 };
    const r = optimizeLayout(p, s);
    console.log("sample", gap, r.elapsedMs, r.message, {
      metrics: r.metrics,
      original: r.originalMetrics,
      moved: r.layout?.placements.filter((v) => {
        const o = p.original.placements.find((o) => o.partId === v.partId)!;
        return (
          o.x !== v.x ||
          o.y !== v.y ||
          o.rotation !== v.rotation ||
          o.sheetId !== v.sheetId
        );
      }).length,
    });
    if (r.layout) {
      expect(r.layout.placements).toHaveLength(53);
      expect(validateLayout(p, r.layout, s)).toEqual([]);
    }
    if (gap === 3) expect(r.layout).not.toBeNull();
  }
}, 30000);
it("keeps equal thickness materials separate", () => {
  const p = fixture();
  p.sheets[1].material = "metal";
  p.parts[2].stockId = "t";
  const r = optimizeLayout(p, settings);
  expect(r.layout?.placements.find((v) => v.partId === "c")?.sheetId).toBe("t");
  expect(validateLayout(p, r.layout!, settings)).toEqual([]);
});
it("interlocks concave shapes using contour candidates", () => {
  const p = fixture();
  p.parts = p.parts.slice(0, 2).map((part) => ({
    ...part,
    width: 40,
    height: 40,
    area: 700,
    outline: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 40 },
      { x: 0, y: 40 },
    ],
  }));
  p.sheets = p.sheets.slice(0, 1).map((s) => ({ ...s, width: 52, height: 52 }));
  p.original = { sheets: p.sheets, placements: [] };
  const s = { ...settings, gap: 0, margin: 1, iterations: 4 };
  const r = optimizeLayout(p, s);
  expect(r.layout).not.toBeNull();
  expect(validateLayout(p, r.layout!, s)).toEqual([]);
});
it("remnant mode improves a scattered valid source", () => {
  const p = fixture();
  p.original.placements = p.parts.map((part, i) => ({
    partId: part.id,
    sheetId: "s",
    x: 1 + i * 22,
    y: i === 1 ? 28 : 1,
    rotation: 0,
  }));
  p.original.sheets = p.sheets.slice(0, 1);
  const r = optimizeLayout(p, { ...settings, mode: "remnant" });
  expect(r.metrics!.reusableArea).toBeGreaterThan(
    r.originalMetrics.reusableArea,
  );
});
it("runs bounded real-sample search in each mode with visible relocation", () => {
  const p = parseDxf(readFileSync("public/sample.dxf", "utf8"), "sample");
  const results = [];
  for (const mode of ["utilization", "machining", "remnant"] as const) {
    const s = { ...settings, mode, gap: 3, margin: 6, iterations: 24 };
    const r = optimizeLayout(p, s);
    expect(r.layout?.placements).toHaveLength(53);
    expect(validateLayout(p, r.layout!, s)).toEqual([]);
    expect(r.elapsedMs).toBeLessThan(6500);
    results.push({
      mode,
      elapsed: r.elapsedMs,
      attempts: r.attempts,
      travel: r.metrics!.travel,
      remnant: r.metrics!.reusableArea,
      placements: r.layout!.placements,
    });
  }
  console.log(
    "modes",
    results.map(({ placements, ...r }) => r),
  );
  expect(
    new Set(results.map((r) => JSON.stringify(r.placements))).size,
  ).toBeGreaterThan(1);
}, 30000);

it("Worker emits progress/done and error protocol", async () => {
  const messages: unknown[] = [];
  const surface = {
    postMessage: (value: unknown) => messages.push(value),
    onmessage: null as ((event: { data: unknown }) => void) | null,
  };
  vi.stubGlobal("self", surface);
  try {
    await import("../src/core/nesting.worker");
    surface.onmessage!({
      data: { type: "start", project: fixture(), settings },
    });
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "progress" }),
        expect.objectContaining({ type: "done" }),
      ]),
    );
    surface.onmessage!({
      data: {
        type: "start",
        project: fixture(),
        settings: { ...settings, gap: Infinity },
      },
    });
    expect(messages.at(-1)).toEqual(expect.objectContaining({ type: "error" }));
  } finally {
    vi.unstubAllGlobals();
  }
});
