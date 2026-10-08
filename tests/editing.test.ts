import { describe, it, expect } from "vitest";
import { createWorkbenchStore } from "../src/store";
import { snapPlacement } from "../src/core/editing";
import { exportEligibility } from "../src/core/export";
import type { Project } from "../src/core/types";
const stock = {
  id: "s",
  name: "板",
  width: 500,
  height: 500,
  thickness: 12,
  material: "木",
};
const fixture = (): Project => ({
  name: "test",
  units: "mm",
  sheets: [stock],
  parts: [],
  original: { sheets: [stock], placements: [] },
  warnings: [],
});
function setup() {
  const st = createWorkbenchStore();
  st.getState().importProject(fixture());
  return st;
}
describe("workspace editing", () => {
  it("creates board and part with immutable source and exact undo", () => {
    const st = setup();
    expect(
      st
        .getState()
        .addStock({ name: "新板", width: 600, height: 700, thickness: 5 }),
    ).toBe(true);
    expect(
      st.getState().addPart({
        name: "圆",
        shape: "circle",
        width: 80,
        height: 80,
        thickness: 5,
      }),
    ).toBe(true);
    const s = st.getState();
    expect(s.source?.parts).toHaveLength(0);
    expect(s.project?.parts).toHaveLength(1);
    expect(s.current?.placements[0].sheetId).not.toBe("s");
    s.undo();
    expect(st.getState().project?.parts).toHaveLength(0);
    st.getState().undo();
    expect(st.getState().project?.sheets).toHaveLength(1);
  });
  it("rejects no-fit without mutating inventory and assigns unique ids", () => {
    const st = setup();
    const add = st.getState().addPart;
    expect(
      add({
        name: "大",
        shape: "rectangle",
        width: 900,
        height: 900,
        thickness: 12,
      }),
    ).toBe(false);
    expect(st.getState().project?.parts).toHaveLength(0);
    for (let i = 0; i < 2; i++)
      expect(
        add({
          name: "小",
          shape: "rectangle",
          width: 50,
          height: 50,
          thickness: 12,
        }),
      ).toBe(true);
    expect(new Set(st.getState().project?.parts.map((p) => p.id)).size).toBe(2);
  });
  it("validates move, lock, thickness, undo and invalidates stale search", () => {
    const st = setup();
    st.getState().addPart({
      name: "矩形",
      shape: "rectangle",
      width: 50,
      height: 50,
      thickness: 12,
    });
    const p = st.getState().current!.placements[0];
    const run = st.getState().beginSearch();
    expect(st.getState().movePart({ ...p, x: 150, y: 150 })).toBe(true);
    expect(st.getState().run).toBeGreaterThan(run);
    expect(st.getState().candidate).toBe(null);
    st.getState().undo();
    expect(st.getState().current!.placements[0]).toEqual(p);
    expect(st.getState().movePart({ ...p, x: -1 })).toBe(false);
    st.getState().addStock({
      name: "薄",
      width: 500,
      height: 500,
      thickness: 5,
    });
    expect(
      st
        .getState()
        .movePart({ ...p, sheetId: st.getState().project!.sheets[1].id }),
    ).toBe(false);
    st.getState().toggleLock(p.partId);
    expect(st.getState().movePart({ ...p, x: 100 })).toBe(false);
  });
  it("never grants original export exception to invalid custom inventory", () => {
    const st = setup();
    st.getState().addPart({
      name: "矩形",
      shape: "rectangle",
      width: 50,
      height: 50,
      thickness: 12,
    });
    const s = st.getState();
    expect(
      exportEligibility(s.project!, s.current!, { ...s.settings, margin: 100 })
        .allowed,
    ).toBe(false);
  });
});
describe("weak magnet", () => {
  it("snaps margin within threshold and leaves distant or disabled placements", () => {
    const st = setup();
    st.getState().addPart({
      name: "矩形",
      shape: "rectangle",
      width: 50,
      height: 50,
      thickness: 12,
    });
    const s = st.getState(),
      p = { ...s.current!.placements[0], x: 10, y: 200 };
    expect(
      snapPlacement(s.project!, s.current!, p, s.settings, 8, true).placement.x,
    ).toBe(6);
    expect(
      snapPlacement(
        s.project!,
        s.current!,
        { ...p, x: 20 },
        s.settings,
        8,
        true,
      ).placement.x,
    ).toBe(20);
    expect(
      snapPlacement(s.project!, s.current!, p, s.settings, 8, false).placement
        .x,
    ).toBe(10);
  });
  it("snaps neighbor gap and center, excluding own and other-board parts", () => {
    const st = setup();
    for (let i = 0; i < 2; i++)
      st.getState().addPart({
        name: "矩形",
        shape: "rectangle",
        width: 50,
        height: 50,
        thickness: 12,
      });
    const s = st.getState(),
      [a, b] = s.current!.placements;
    const layout = { ...s.current!, placements: [{ ...a, x: 100, y: 100 }, b] };
    const result = snapPlacement(
      s.project!,
      layout,
      { ...b, x: 156, y: 104 },
      s.settings,
      4,
      true,
    );
    expect(result.placement.x).toBe(153);
    expect(result.placement.y).toBe(100);
    expect(result.guides.length).toBe(2);
    const other = {
      ...layout,
      placements: [{ ...a, sheetId: "other", x: 100, y: 100 }, b],
    };
    expect(
      snapPlacement(
        s.project!,
        other,
        { ...b, x: 156, y: 104 },
        s.settings,
        4,
        true,
      ).placement.x,
    ).toBe(156);
  });
});
it("keeps source geometry immutable across cross-board thickness changes and restoration", () => {
  const st = setup();
  st.getState().addPart({
    name: "矩形",
    shape: "rectangle",
    width: 50,
    height: 50,
    thickness: 12,
  });
  st.getState().addStock({
    name: "第二板",
    width: 500,
    height: 500,
    thickness: 12,
  });
  const p = st.getState().current!.placements[0],
    second = st.getState().project!.sheets[1];
  expect(
    st.getState().movePart({ ...p, sheetId: second.id, x: 100, y: 100 }),
  ).toBe(true);
  st.getState().setThickness(second.id, 15);
  expect(st.getState().project!.parts[0].thickness).toBe(15);
  expect(st.getState().source).toEqual(fixture());
  st.getState().reset();
  expect(st.getState().project!.parts).toHaveLength(1);
  expect(st.getState().current!.placements[0].sheetId).toBe(second.id);
});
it("rejects overlapping move and preserves placement and history", () => {
  const st = setup();
  for (let i = 0; i < 2; i++)
    st.getState().addPart({
      name: "矩形",
      shape: "rectangle",
      width: 50,
      height: 50,
      thickness: 12,
    });
  const before = structuredClone(st.getState().current),
    [a, b] = before!.placements,
    h = st.getState().history.length;
  expect(st.getState().movePart({ ...b, x: a.x, y: a.y })).toBe(false);
  expect(st.getState().current).toEqual(before);
  expect(st.getState().history).toHaveLength(h);
});
it("snap threshold is inclusive, centers align and no self snap occurs", () => {
  const st = setup();
  st.getState().addPart({
    name: "矩形",
    shape: "rectangle",
    width: 50,
    height: 50,
    thickness: 12,
  });
  const s = st.getState(),
    p = s.current!.placements[0];
  expect(
    snapPlacement(
      s.project!,
      s.current!,
      { ...p, x: 14, y: 160 },
      s.settings,
      8,
      true,
    ).placement.x,
  ).toBe(6);
  expect(
    snapPlacement(
      s.project!,
      s.current!,
      { ...p, x: 14.01, y: 160 },
      s.settings,
      8,
      true,
    ).placement.x,
  ).toBe(14.01);
  expect(
    snapPlacement(
      s.project!,
      s.current!,
      { ...p, x: 222, y: 160 },
      s.settings,
      8,
      true,
    ).placement.x,
  ).toBe(225);
  expect(
    snapPlacement(
      s.project!,
      s.current!,
      { ...p, x: 19, y: 160 },
      s.settings,
      8,
      true,
    ).placement.x,
  ).toBe(19);
});
it("bounds creation work with real imported contours and finds the added empty board", async () => {
  const { readFileSync } = await import("node:fs");
  const { parseDxf } = await import("../src/core/dxf");
  const project = parseDxf(readFileSync("public/sample.dxf", "utf8"), "sample");
  const st = createWorkbenchStore();
  st.getState().importProject(project);
  st.getState().addStock({
    name: "测试薄板",
    width: 1220,
    height: 2440,
    thickness: 5,
  });
  const start = performance.now();
  expect(
    st.getState().addPart({
      name: "测试侧板",
      shape: "rectangle",
      width: 600,
      height: 300,
      thickness: 5,
    }),
  ).toBe(true);
  expect(performance.now() - start).toBeLessThan(1000);
  expect(st.getState().project!.parts).toHaveLength(project.parts.length + 1);
});
it("keeps import feedback separate from edit errors and failed import preserves creation history", () => {
  const st = setup();
  st.getState().addPart({
    name: "矩形",
    shape: "rectangle",
    width: 50,
    height: 50,
    thickness: 12,
  });
  const before = structuredClone(st.getState().current),
    historyLength = st.getState().history.length;
  st.getState().movePart({ ...before!.placements[0], x: -100 });
  expect(st.getState().message).toContain("修改未应用");
  expect(st.getState().importMessage).toBe("");
  const run = st.getState().beginImport();
  st.getState().failImport(run, "图层错误");
  expect(st.getState().importMessage).toBe("图层错误");
  expect(st.getState().current).toEqual(before);
  expect(st.getState().history).toHaveLength(historyLength);
  st.getState().finishImport(run, fixture());
  expect(st.getState().importMessage).toBe("");
  expect(st.getState().history).toHaveLength(0);
});
function compactAppliedStore() {
  const st = setup();
  st.getState().addPart({
    name: "厚板组件",
    shape: "rectangle",
    width: 50,
    height: 50,
    thickness: 12,
  });
  st.getState().addStock({
    name: "未使用薄板",
    width: 500,
    height: 500,
    thickness: 5,
  });
  st.getState().addStock({
    name: "未使用厚板",
    width: 500,
    height: 500,
    thickness: 12,
  });
  const state = st.getState(),
    compact = { ...state.current!, sheets: [state.project!.sheets[0]] };
  const run = state.beginSearch();
  st.getState().progress(run, 1, compact);
  st.getState().cancel();
  st.getState().apply();
  return st;
}
it("creates on existing inventory omitted by an applied compact candidate and undoes exactly", () => {
  const st = compactAppliedStore(),
    before = structuredClone(st.getState().current);
  expect(before!.sheets).toHaveLength(1);
  expect(st.getState().project!.sheets).toHaveLength(3);
  expect(
    st
      .getState()
      .addPart({
        name: "薄板组件",
        shape: "rectangle",
        width: 100,
        height: 100,
        thickness: 5,
      }),
  ).toBe(true);
  expect(st.getState().current!.placements.at(-1)!.sheetId).toBe(
    st.getState().project!.sheets[1].id,
  );
  expect(st.getState().current!.sheets).toHaveLength(2);
  st.getState().undo();
  expect(st.getState().current).toEqual(before);
  expect(st.getState().project!.parts).toHaveLength(1);
});
it("allows dragging to existing unused inventory after compaction and undoes exactly", () => {
  const st = compactAppliedStore(),
    before = structuredClone(st.getState().current),
    p = before!.placements[0],
    target = st.getState().project!.sheets[2];
  expect(
    st.getState().movePart({ ...p, sheetId: target.id, x: 100, y: 100 }),
  ).toBe(true);
  expect(st.getState().current!.sheets.some((v) => v.id === target.id)).toBe(
    true,
  );
  expect(st.getState().current!.placements[0].sheetId).toBe(target.id);
  st.getState().undo();
  expect(st.getState().current).toEqual(before);
  expect(st.getState().project!.sheets).toHaveLength(3);
});
it("expands only the editing projection while retaining compact metric and export sheets", async () => {
  const { editingLayout } = await import("../src/core/editing");
  const { measureLayout } = await import("../src/core/geometry");
  const { exportCurrentSvg } = await import("../src/core/export");
  const st = compactAppliedStore(),
    s = st.getState();
  const rendered = editingLayout(s.project!, s.current!);
  expect(rendered.sheets).toEqual(s.project!.sheets);
  expect(rendered.placements).toEqual(s.current!.placements);
  expect(s.current!.sheets).toHaveLength(1);
  expect(measureLayout(s.project!, s.current!, s.settings).stockArea).toBe(
    250000,
  );
  expect(exportCurrentSvg(s.project!, s.current!, s.settings)).not.toContain(
    `data-sheet="${s.project!.sheets[1].id}"`,
  );
});

describe("stock removal", () => {
  it("deletes empty stock and undo restores the full working model", () => {
    const st = setup();
    st.getState().addStock({ name: "empty", width: 500, height: 500, thickness: 5 });
    const before = structuredClone({ project: st.getState().project, current: st.getState().current });
    const source = structuredClone(st.getState().source);
    const id = st.getState().project!.sheets[1].id;
    expect(st.getState().removeStock(id)).toBe(true);
    expect(st.getState().project!.sheets.map(s => s.id)).toEqual(["s"]);
    expect(st.getState().current!.sheets.map(s => s.id)).toEqual(["s"]);
    expect(st.getState().project!.original.sheets.map(s => s.id)).toEqual(["s"]);
    expect(st.getState().source).toEqual(source);
    st.getState().undo();
    expect(st.getState().project).toEqual(before.project);
    expect(st.getState().current).toEqual(before.current);
  });
  it("rejects occupied or unknown stock without changing history or a valid candidate", () => {
    const st = setup();
    st.getState().addPart({ name: "part", shape: "rectangle", width: 50, height: 50, thickness: 12 });
    const run = st.getState().beginSearch();
    st.getState().progress(run, 1, st.getState().current!);
    const before = structuredClone(st.getState().current), candidate = st.getState().candidate, history = st.getState().history;
    expect(st.getState().removeStock("s")).toBe(false);
    expect(st.getState().removeStock("missing")).toBe(false);
    expect(st.getState().current).toEqual(before);
    expect(st.getState().candidate).toBe(candidate);
    expect(st.getState().history).toBe(history);
    expect(st.getState().run).toBe(run);
  });
  it("deletes unused inventory omitted by compact apply and invalidates stale results", () => {
    const st = compactAppliedStore();
    const id = st.getState().project!.sheets[1].id;
    const run = st.getState().beginSearch();
    st.getState().progress(run, 1, st.getState().current!);
    expect(st.getState().removeStock(id)).toBe(true);
    expect(st.getState().current!.sheets.map(s => s.id)).toEqual(["s"]);
    expect(st.getState().project!.sheets).toHaveLength(2);
    expect(st.getState().candidate).toBeNull();
    expect(st.getState().status).toBe("idle");
    expect(st.getState().run).toBeGreaterThan(run);
    st.getState().progress(run, 2, { ...st.getState().current!, sheets: [stock] });
    expect(st.getState().candidate).toBeNull();
  });
  it("reassociates an imported moved part when its emptied original board is removed and reset keeps the destination", async () => {
    const { makePart } = await import("../src/core/editing");
    const { validateLayout } = await import("../src/core/geometry");
    const second = { ...stock, id: "target", name: "target" };
    const project: Project = { ...fixture(), sheets: [stock, second], parts: [makePart({ name: "part", shape: "rectangle", width: 50, height: 50, thickness: 12 }, "p", "s")], original: { sheets: [stock, second], placements: [{ partId: "p", sheetId: "s", x: 10, y: 10, rotation: 0 }] } };
    const st = createWorkbenchStore();
    st.getState().importProject(project);
    expect(st.getState().movePart({ partId: "p", sheetId: "target", x: 100, y: 100, rotation: 90 })).toBe(true);
    expect(st.getState().removeStock("s")).toBe(true);
    expect(st.getState().project!.parts[0].stockId).toBe("target");
    expect(st.getState().project!.original.placements[0]).toEqual({ partId: "p", sheetId: "target", x: 100, y: 100, rotation: 90, locked: undefined });
    expect(validateLayout(st.getState().project!, st.getState().current!, st.getState().settings)).toEqual([]);
    st.getState().reset();
    expect(st.getState().current!.placements[0].sheetId).toBe("target");
    expect(st.getState().current!.placements[0].x).toBe(100);
    expect(st.getState().message).toContain("已删除");
    expect(st.getState().source).toEqual(project);
    st.getState().undo();
    st.getState().undo();
    expect(st.getState().project!.parts[0].stockId).toBe("s");
    expect(st.getState().project!.sheets.map(s => s.id)).toEqual(["s", "target"]);
  });
  it("allows the last empty board to be removed and recreated", () => {
    const st = setup();
    expect(st.getState().removeStock("s")).toBe(true);
    expect(st.getState().project!.sheets).toEqual([]);
    expect(st.getState().current).toEqual({ sheets: [], placements: [] });
    expect(st.getState().addStock({ name: "replacement", width: 500, height: 500, thickness: 12 })).toBe(true);
    expect(st.getState().project!.sheets).toHaveLength(1);
  });
});
