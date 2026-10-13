import { describe, expect, it } from "vitest";
import { previewRelief, reliefTargets } from "../src/core/joineryRelief";
import { bounds, pointInPolygon, polygonArea, validContour } from "../src/core/geometry";
import { createWorkbenchStore } from "../src/store";
import { exportPartSvg, exportSvg } from "../src/core/export";
import type { Part, Point, Project } from "../src/core/types";

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
];
const part = (): Part => ({ id: "p", name: "榫槽板", stockId: "s", layer: "CUT", material: "多层板", thickness: 12,
  width: 100, height: 80, area: 8000, outline: rect(0, 0, 100, 80), holes: [rect(20, 20, 40, 20)],
  pockets: [{ outline: rect(70, 20, 15, 30), depth: 3 }], label: { x: 50, y: 40 } });
const project = (): Project => {
  const sheet = { id: "s", name: "板材", width: 300, height: 200, thickness: 12, material: "多层板" };
  return { name: "清角", units: "mm", sheets: [sheet], parts: [part()], warnings: [],
    original: { sheets: [sheet], placements: [{ partId: "p", sheetId: "s", x: 10, y: 10, rotation: 0 }] } };
};
const input = { target: "hole:0", corners: [0, 1, 2, 3], diameter: 6, style: "dogbone" as const, direction: "long" as const };

describe("joinery corner relief", () => {
  it("finds cut-area convex corners without offering the part's exterior corners", () => {
    const targets = reliefTargets(part());
    expect(targets.map(t => [t.id, t.corners.length])).toEqual([["hole:0", 4], ["pocket:0", 4]]);
    const p = part(); p.holes[0].reverse(); p.pockets[0].outline.reverse();
    expect(reliefTargets(p).map(t => t.corners.length)).toEqual([4, 4]);
  });
  it("cuts actual dogbones with hand-checked radius and retains source and other machining", () => {
    const original = part(); const before = structuredClone(original);
    const result = previewRelief(original, input);
    expect(original).toEqual(before);
    expect(result.circles).toHaveLength(4);
    expect(result.circles[0].center.x).toBeCloseTo(22.1213203436, 8);
    expect(result.circles[0].center.y).toBeCloseTo(22.1213203436, 8);
    expect(result.circles[0].radius).toBe(3);
    expect(validContour(result.part.holes[0])).toBe(true);
    expect(polygonArea(result.part.holes[0])).toBeGreaterThan(800);
    expect(bounds(result.part.holes[0]).minX).toBeCloseTo(19.1213203436, 2);
    expect(result.part.pockets).toEqual(before.pockets);
    expect(result.part.outline).toEqual(before.outline);
    expect(reliefTargets(result.part).some(t => t.id === "hole:0")).toBe(false);
  });
  it("supports one chosen corner and the two T-bone directions", () => {
    const long = previewRelief(part(), { ...input, style: "tbone", corners: [0] });
    expect(long.circles[0].center).toEqual({ x: 23, y: 20 });
    expect(bounds(long.part.holes[0]).minY).toBe(17);
    expect(bounds(long.part.holes[0]).minX).toBe(20);
    const short = previewRelief(part(), { ...input, style: "tbone", direction: "short", corners: [0] });
    expect(short.circles[0].center).toEqual({ x: 20, y: 23 });
    expect(bounds(short.part.holes[0]).minX).toBe(17);
    expect(reliefTargets(long.part).find(t => t.id === "hole:0")!.corners).toHaveLength(3);
  });
  it("removes material at open-slot inner corners and recalculates area", () => {
    const p = part(); p.holes = []; p.pockets = [];
    p.outline = [{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:60,y:80},{x:60,y:50},{x:40,y:50},{x:40,y:80},{x:0,y:80}];
    p.area = 7400;
    expect(reliefTargets(p).map(t => [t.id, t.corners.map(c => c.index)])).toEqual([["outline", [4, 5]]]);
    const next = previewRelief(p, { ...input, target: "outline", corners: [4, 5] }).part;
    expect(next.area).toBeLessThan(7400);
    expect(validContour(next.outline)).toBe(true);
    expect(bounds(next.outline)).toEqual(bounds(p.outline));
  });
  it("preserves shallow slot depth and drops its obsolete centerline representation", () => {
    const p = part(); p.pockets[0].centerline = [{x:77.5,y:20},{x:77.5,y:50}]; p.pockets[0].width = 15;
    const next = previewRelief(p, { ...input, target: "pocket:0" }).part;
    expect(next.pockets[0].depth).toBe(3);
    expect(next.pockets[0].centerline).toBeUndefined();
    expect(next.pockets[0].width).toBeUndefined();
  });
  it.each([0, -1, NaN, Infinity, 101])("rejects invalid cutter diameter %s", diameter => {
    expect(() => previewRelief(part(), { ...input, diameter })).toThrow(/直径/);
  });
  it("rejects empty, duplicate, stale corners, and cutters crossing unrelated edges", () => {
    for (const corners of [[], [0, 0], [999]]) expect(() => previewRelief(part(), { ...input, corners })).toThrow(/角/);
    expect(() => previewRelief(part(), { ...input, diameter: 50 })).toThrow(/空间|尺寸|边/);
    const p = part(); p.holes = [rect(0.2, 20, 40, 20)];
    expect(() => previewRelief(p, input)).toThrow(/外轮廓|边/);
  });
  it("refuses to merge separate machining features", () => {
    const p = part(); p.holes.push(rect(60.2, 19, 5, 22));
    expect(() => previewRelief(p, input)).toThrow(/加工|重叠|相交/);
  });
  it("rejects a cutter wider than the slot even when relief circles could expand its ends", () => {
    expect(() => previewRelief(part(), { ...input, diameter: 22 })).toThrow(/空间|尺寸|宽/);
  });
  it("exports a relieved unplaced part at its actual size with machining metadata", () => {
    const changed = previewRelief(part(), input).part;
    changed.name = '<榫槽 & "test">';
    const svg = exportPartSvg(changed);
    expect(svg).toContain('width="100mm" height="80mm"');
    expect(svg).toContain('&lt;榫槽 &amp; &quot;test&quot;&gt;');
    expect(svg).toContain('data-feature="hole"');
    expect(svg).toContain('data-pocket-depth-mm="3"');
    expect(svg).toContain('19.12132');
    expect(svg).not.toContain('data-sheet=');
    changed.holes[0][0].x = Infinity;
    expect(() => exportPartSvg(changed)).toThrow(/无效/);
  });
  it("retains an existing edge-open pocket when editing another hole", () => {
    const p = part(); p.pockets[0].outline = rect(70, 0, 15, 30);
    expect(previewRelief(p, input).part.pockets).toEqual(p.pockets);
  });
  it("can relieve internal corners of an edge-open shallow pocket without cutting through the rim", () => {
    const p = part(); p.pockets[0].outline = rect(70, 0, 15, 30);
    const next = previewRelief(p, { ...input, target: "pocket:0", corners: [2, 3] }).part;
    expect(bounds(next.pockets[0].outline).minY).toBe(0);
    expect(polygonArea(next.pockets[0].outline)).toBeGreaterThan(450);
    expect(() => previewRelief(p, { ...input, target: "pocket:0", corners: [0] })).toThrow(/外轮廓|边/);
  });
  it("uses the same geometric result for both contour windings", () => {
    const p = part(); p.holes[0].reverse();
    const a = previewRelief(part(), input).part.holes[0];
    const b = previewRelief(p, input).part.holes[0];
    expect(polygonArea(b)).toBeCloseTo(polygonArea(a), 4);
    expect(bounds(b)).toEqual(bounds(a));
    expect(a.every(v => pointInPolygon(v, part().outline))).toBe(true);
  });
});

describe("joinery edit transaction", () => {
  it("applies once, preserves source and placement, exports modified geometry, and undoes exactly", () => {
    const st = createWorkbenchStore(); st.getState().importProject(project());
    const before = structuredClone({ project: st.getState().project, source: st.getState().source, current: st.getState().current });
    expect(st.getState().applyRelief("p", input)).toBe(true);
    expect(st.getState().history).toHaveLength(1);
    expect(st.getState().source).toEqual(before.source);
    expect(st.getState().current).toEqual(before.current);
    expect(exportSvg(st.getState().project!, st.getState().current!)).not.toEqual(exportSvg(before.project!, before.current!));
    st.getState().undo();
    expect(st.getState().project).toEqual(before.project);
    expect(st.getState().current).toEqual(before.current);
    expect(st.getState().source).toEqual(before.source);
  });
  it("blocks read-only, running searches and invalid edits without writing history", () => {
    const st = createWorkbenchStore(); st.getState().importProject(project());
    st.getState().setView("original"); expect(st.getState().applyRelief("p", input)).toBe(false);
    st.getState().setView("current"); st.getState().beginSearch(); expect(st.getState().applyRelief("p", input)).toBe(false);
    st.getState().cancel(); expect(st.getState().applyRelief("p", { ...input, diameter: NaN })).toBe(false);
    expect(st.getState().history).toHaveLength(0);
  });
  it("supports unplaced pieces", () => {
    const st = createWorkbenchStore(); const p = project(); p.original.placements = [];
    st.getState().importProject(p);
    expect(st.getState().applyRelief("p", input)).toBe(true);
    expect(st.getState().current!.placements).toEqual([]);
  });
  it("invalidates a previous complete candidate", () => {
    const st = createWorkbenchStore(); const p = project(); st.getState().importProject(p);
    const run = st.getState().beginSearch(); st.getState().receiveResult(run, { layout: p.original } as any);
    expect(st.getState().candidate).not.toBeNull();
    st.getState().setView("current");
    expect(st.getState().applyRelief("p", input)).toBe(true);
    expect(st.getState().candidate).toBeNull();
  });
});
