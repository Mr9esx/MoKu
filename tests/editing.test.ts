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
