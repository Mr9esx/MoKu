import { describe, it, expect } from "vitest";
import { parseDxf } from "../src/core/dxf";
import { createWorkbenchStore, defaults } from "../src/store";
import { validateLayout, measureLayout } from "../src/core/geometry";
import { exportEligibility } from "../src/core/export";
import { optimizeLayout } from "../src/core/nesting";
import type { Project } from "../src/core/types";
const poly = (layer: string, id: string, coords: number[], closed = true) =>
  `0\nLWPOLYLINE\n5\n${id}\n8\n${layer}\n90\n${coords.length / 2}\n70\n${closed ? 1 : 0}\n${coords.map((v, i) => `${i % 2 ? 20 : 10}\n${v}`).join("\n")}\n`;
const dxf = (entities: string, unit = 4) =>
  `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${unit}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const standalone = dxf(
  poly("0", "p", [10, 20, 110, 20, 110, 70, 10, 70]) +
    poly("HOLE", "h", [20, 30, 30, 30, 30, 40, 20, 40]),
);
const parts = () =>
  parseDxf(standalone, "shelf.dxf", {
    mode: "parts",
    thickness: 12,
    material: "桦木",
    quantity: 1,
  });
const stock = {
  id: "s",
  name: "板",
  width: 500,
  height: 500,
  thickness: 12,
  material: "桦木",
};
const board = (): Project => ({
  name: "board",
  units: "mm",
  warnings: [],
  sheets: [stock],
  parts: [
    {
      id: "p",
      name: "shelf",
      stockId: "s",
      material: "桦木",
      source: "board.dxf",
      layer: "CUT",
      thickness: 12,
      width: 50,
      height: 50,
      area: 2500,
      outline: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 50 },
        { x: 0, y: 50 },
      ],
      holes: [],
      pockets: [],
      label: { x: 25, y: 25 },
    },
  ],
  original: {
    sheets: [stock],
    placements: [{ partId: "p", sheetId: "s", x: 10, y: 10, rotation: 0 }],
  },
});

describe("standalone import", () => {
  it("normalizes a default-layer outline and its explicit hole with no inventory", () => {
    const p = parts();
    expect(p.sheets).toEqual([]);
    expect(p.original.placements).toEqual([]);
    expect(p.parts[0]).toMatchObject({
      width: 100,
      height: 50,
      area: 5000,
      thickness: 12,
      material: "桦木",
      source: "shelf.dxf",
    });
    expect(p.parts[0].outline[0]).toEqual({ x: 0, y: 0 });
    expect(p.parts[0].holes[0][0]).toEqual({ x: 10, y: 10 });
  });
  it("requires an explicit unknown unit and converts an inch override to 25.4 mm", () => {
    const text = dxf(poly("0", "p", [0, 0, 1, 0, 1, 1, 0, 1]), 0);
    expect(() => parseDxf(text, "inch", { mode: "parts" })).toThrow(/单位/);
    const p = parseDxf(text, "inch", {
      mode: "parts",
      unit: "inch",
      thickness: 12,
      material: "桦木",
      quantity: 2,
    });
    expect(p.parts[0].width).toBeCloseTo(25.4);
    expect(p.parts).toHaveLength(2);
    expect(new Set(p.parts.map((p) => p.id)).size).toBe(2);
  });
  it("rejects ambiguous internal cuts, open paths and self intersections", () => {
    expect(() =>
      parseDxf(
        dxf(
          poly("0", "a", [0, 0, 100, 0, 100, 100, 0, 100]) +
            poly("0", "b", [20, 20, 30, 20, 30, 30, 20, 30]),
        ),
        "x",
        { mode: "parts" },
      ),
    ).toThrow(/内部|归属|重叠/);
    expect(() =>
      parseDxf(
        dxf(poly("0", "a", [0, 0, 100, 0, 100, 100, 0, 100], false)),
        "x",
        { mode: "parts" },
      ),
    ).toThrow(/闭合/);
    expect(() =>
      parseDxf(dxf(poly("0", "a", [0, 0, 100, 100, 100, 0, 0, 100])), "x", {
        mode: "parts",
      }),
    ).toThrow(/自交|无效/);
  });
  it("infers only an unambiguous containing rectangular board", () => {
    const p = parseDxf(
      dxf(
        poly("0", "s", [0, 0, 500, 0, 500, 500, 0, 500]) +
          poly("0", "p", [10, 10, 60, 10, 60, 60, 10, 60]),
      ),
      "board",
    );
    expect(p.sheets).toHaveLength(1);
    expect(p.parts).toHaveLength(1);
  });
});
describe("import transactions and pending resources", () => {
  it("preview/cancel leaves current, history, candidate and active search intact", () => {
    const st = createWorkbenchStore();
    st.getState().importProject(board());
    const run = st.getState().beginSearch();
    st.getState().progress(run, 1, st.getState().current!);
    const before = st.getState();
    const id = before.beginImport();
    st.getState().previewImport(id, board());
    st.getState().cancelImport();
    const after = st.getState();
    for (const key of [
      "project",
      "source",
      "current",
      "history",
      "candidate",
      "run",
      "status",
    ] as const)
      expect(after[key]).toEqual(before[key]);
  });
  it("appends repeated identifiers atomically and undo restores original coordinates and source", () => {
    const st = createWorkbenchStore();
    st.getState().importProject(board());
    st.getState().movePart({
      partId: "p",
      sheetId: "s",
      x: 80,
      y: 90,
      rotation: 0,
    });
    const before = structuredClone({
      project: st.getState().project,
      current: st.getState().current,
      source: st.getState().source,
    });
    st.getState().confirmImport(board(), "append");
    st.getState().confirmImport(board(), "append");
    const after = st.getState();
    expect(after.project!.parts).toHaveLength(3);
    expect(new Set(after.project!.parts.map((p) => p.id)).size).toBe(3);
    expect(new Set(after.project!.sheets.map((p) => p.id)).size).toBe(3);
    expect(after.current!.placements[0]).toMatchObject({ x: 80, y: 90 });
    expect(after.source!.original.placements[0]).toMatchObject({
      x: 10,
      y: 10,
    });
    expect(after.project!.parts.every((p) => p.material === "桦木")).toBe(true);
    st.getState().undo();
    st.getState().undo();
    expect(st.getState().project).toEqual(before.project);
    expect(st.getState().current).toEqual(before.current);
    expect(st.getState().source).toEqual(before.source);
  });
  it("places pending only on compatible stock, preserves geometry, and allows other edits", () => {
    const st = createWorkbenchStore();
    st.getState().importProject(parts());
    expect(st.getState().addStock({ ...stock, material: "松木" })).toBe(true);
    const wrong = st.getState().project!.sheets[0].id;
    expect(
      st.getState().movePart({
        partId: st.getState().project!.parts[0].id,
        sheetId: wrong,
        x: 10,
        y: 10,
        rotation: 0,
      }),
    ).toBe(false);
    st.getState().addStock(stock);
    const target = st.getState().project!.sheets[1].id;
    const id = st.getState().project!.parts[0].id,
      geometry = structuredClone(st.getState().project!.parts[0]);
    st.getState().addPart({
      name: "pending",
      shape: "rectangle",
      width: 20,
      height: 20,
      thickness: 12,
      material: "桦木",
      place: false,
    });
    expect(
      st
        .getState()
        .movePart({ partId: id, sheetId: target, x: 10, y: 10, rotation: 0 }),
    ).toBe(true);
    expect(st.getState().project!.parts[0]).toEqual(geometry);
    expect(
      st
        .getState()
        .movePart({ partId: id, sheetId: target, x: 40, y: 50, rotation: 0 }),
    ).toBe(true);
    expect(
      validateLayout(st.getState().project!, st.getState().current!, defaults, {
        requireAll: false,
      }),
    ).toEqual([]);
    expect(
      validateLayout(
        st.getState().project!,
        st.getState().current!,
        defaults,
      ).some((i) => i.kind === "missing"),
    ).toBe(true);
    expect(
      measureLayout(st.getState().project!, st.getState().current!, defaults)
        .outlineArea,
    ).toBe(5000);
    expect(
      exportEligibility(
        st.getState().project!,
        st.getState().current!,
        defaults,
      ).allowed,
    ).toBe(false);
  });
  it("packs all pending parts from real inventory and prevents empty source exports", () => {
    const p = parts();
    expect(exportEligibility(p, p.original, defaults).allowed).toBe(false);
    p.sheets = [stock];
    const result = optimizeLayout(p, { ...defaults, iterations: 1 });
    expect(result.layout?.placements).toHaveLength(1);
    expect(validateLayout(p, result.layout!, defaults)).toEqual([]);
  });
  it("deletes and duplicates pending geometry with undo preserving immutable sources", () => {
    const st = createWorkbenchStore();
    st.getState().importProject(parts());
    const before = structuredClone(st.getState().source);
    const id = st.getState().project!.parts[0].id;
    st.getState().duplicatePart(id, 2);
    expect(st.getState().project!.parts).toHaveLength(3);
    st.getState().removePart(id);
    expect(st.getState().project!.parts).toHaveLength(2);
    expect(st.getState().source).toEqual(before);
    st.getState().undo();
    st.getState().undo();
    expect(st.getState().project!.parts).toEqual(before!.parts);
    expect(st.getState().source).toEqual(before);
  });
});

describe("metadata and creation contracts", () => {
  it("manual creation defaults to pending without stock and undo restores empty workspace", () => {
    const st = createWorkbenchStore();
    expect(
      st.getState().addPart({
        name: "panel",
        shape: "rectangle",
        width: 80,
        height: 40,
        thickness: 12,
        material: "桦木",
      }),
    ).toBe(true);
    expect(st.getState().current!.placements).toEqual([]);
    expect(st.getState().project!.sheets).toEqual([]);
    st.getState().undo();
    expect(st.getState().project).toBeNull();
    expect(st.getState().source).toBeNull();
  });
  it("metadata confirmation validates required board fields and copies without mutating the draft", async () => {
    const { confirmMetadata } = await import("../src/core/importTransaction");
    const draft = parts(),
      before = structuredClone(draft);
    expect(() =>
      confirmMetadata(draft, { thickness: 12, material: "" }),
    ).toThrow(/材质/);
    expect(() =>
      confirmMetadata(draft, {
        thickness: 12,
        material: "桦木",
        quantity: 101,
      }),
    ).toThrow(/数量/);
    const copy = confirmMetadata(draft, {
      thickness: 18,
      material: "橡木",
      quantity: 2,
    });
    expect(copy.parts).toHaveLength(2);
    expect(copy.parts[0].material).toBe("橡木");
    expect(draft).toEqual(before);
    expect(() =>
      confirmMetadata(board(), {
        stocks: { s: { thickness: 0, material: "桦木" } },
      }),
    ).toThrow(/板厚/);
  });
  it("stock settings and lock are undoable without rewriting the source", () => {
    const st = createWorkbenchStore();
    st.getState().importProject(board());
    const before = structuredClone({
      project: st.getState().project,
      current: st.getState().current,
      source: st.getState().source,
    });
    st.getState().setMaterial("s", "橡木");
    st.getState().setThickness("s", 18);
    st.getState().toggleLock("p");
    expect(st.getState().project!.parts[0]).toMatchObject({
      material: "橡木",
      thickness: 18,
    });
    st.getState().undo();
    st.getState().undo();
    st.getState().undo();
    expect(st.getState().current).toEqual(before.current);
    expect(st.getState().project).toEqual(before.project);
    expect(st.getState().source).toEqual(before.source);
  });
  it("new project import and first import are both undoable including source", () => {
    const st = createWorkbenchStore();
    st.getState().confirmImport(board(), "new");
    const before = structuredClone(st.getState().source);
    st.getState().confirmImport(parts(), "new");
    expect(st.getState().project!.sheets).toEqual([]);
    st.getState().undo();
    expect(st.getState().source).toEqual(before);
    st.getState().undo();
    expect(st.getState().project).toBeNull();
  });
  it("search includes pending alongside locked placements and never moves a lock", () => {
    const p = board();
    p.original.placements[0].locked = true;
    p.parts.push({ ...structuredClone(p.parts[0]), id: "pending" });
    const result = optimizeLayout(p, { ...defaults, iterations: 1 });
    expect(result.layout?.placements).toHaveLength(2);
    expect(result.layout?.placements.find((p) => p.partId === "p")).toEqual({
      partId: "p",
      sheetId: "s",
      x: 10,
      y: 10,
      rotation: 0,
      locked: true,
    });
  });
});
it("does not silently place a manually created part when placement was not requested", () => {
  const st = createWorkbenchStore();
  st.getState().importProject(board());
  st.getState().addPart({
    name: "panel",
    shape: "rectangle",
    width: 80,
    height: 40,
    thickness: 12,
    material: "桦木",
  });
  expect(st.getState().current!.placements).toHaveLength(1);
});
it("rejects explicitly empty material in resource creation", () => {
  const st = createWorkbenchStore();
  expect(st.getState().addStock({ ...stock, material: " " })).toBe(false);
  expect(
    st.getState().addPart({
      name: "panel",
      shape: "rectangle",
      width: 80,
      height: 40,
      thickness: 12,
      material: " ",
    }),
  ).toBe(false);
});
it("converts board pocket depths with declared drawing units", () => {
  const p = parseDxf(
    dxf(
      poly("REF_STOCK", "s", [0, 0, 20, 0, 20, 20, 0, 20]) +
        poly("CUT_12MM", "p", [1, 1, 5, 1, 5, 5, 1, 5]) +
        poly("POCKET_DEPTH0.1", "h", [2, 2, 3, 2, 3, 3, 2, 3]),
      1,
    ),
    "inch-board",
  );
  expect(p.parts[0].pockets[0].depth).toBeCloseTo(2.54);
});
it("rejects undeclared internal-cut semantics even when a board is supplied", () => {
  expect(() =>
    parseDxf(
      dxf(
        poly("REF_STOCK", "s", [0, 0, 500, 0, 500, 500, 0, 500]) +
          poly("0", "p", [10, 10, 110, 10, 110, 110, 10, 110]) +
          poly("0", "inner", [20, 20, 30, 20, 30, 30, 20, 30]),
      ),
      "ambiguous-board",
    ),
  ).toThrow(/内部|语义/);
});
it("never treats manually created geometry as an imported-source export exception", () => {
  const st = createWorkbenchStore();
  st.getState().addStock(stock);
  st.getState().addPart({
    name: "manual",
    shape: "rectangle",
    width: 100,
    height: 100,
    thickness: 12,
    material: "桦木",
    place: true,
  });
  st.getState().setSettings({ margin: 100 });
  expect(
    exportEligibility(
      st.getState().project!,
      st.getState().current!,
      st.getState().settings,
    ).allowed,
  ).toBe(false);
});
it("rejects intersecting through-hole contours rather than double-counting their area", () => {
  const text = dxf(
    poly("0", "p", [0, 0, 100, 0, 100, 100, 0, 100]) +
      poly("HOLE", "h1", [10, 10, 30, 10, 30, 30, 10, 30]) +
      poly("HOLE", "h2", [20, 20, 40, 20, 40, 40, 20, 40]),
  );
  expect(() => parseDxf(text, "bad-holes", { mode: "parts" })).toThrow(
    /孔|相交|重叠/,
  );
});
it("keeps a newly created part selected in readonly candidate view", () => {
  const st = createWorkbenchStore();
  st.getState().importProject(board());
  st.getState().addPart({
    name: "new",
    shape: "rectangle",
    width: 40,
    height: 40,
    thickness: 12,
    material: "桦木",
    place: true,
  });
  const current = st.getState().current!,
    run = st.getState().beginSearch();
  st.getState().receiveResult(run, {
    layout: current,
    metrics: measureLayout(st.getState().project!, current, defaults),
    originalMetrics: measureLayout(st.getState().project!, current, defaults),
    attempts: 1,
    elapsedMs: 0,
    message: "ok",
    issues: [],
  });
  st.getState().select(st.getState().project!.parts[1].id);
  expect(st.getState().view).toBe("candidate");
});
it("rejects final layouts that invent stock or enlarge real stock", () => {
  const p = board();
  expect(
    validateLayout(
      p,
      {
        sheets: [{ ...stock, id: "invented" }],
        placements: [{ ...p.original.placements[0], sheetId: "invented" }],
      },
      defaults,
    ).some((i) => i.kind === "invalid"),
  ).toBe(true);
  expect(
    exportEligibility(
      p,
      { ...p.original, sheets: [{ ...stock, width: 1000 }] },
      defaults,
    ).allowed,
  ).toBe(false);
});
