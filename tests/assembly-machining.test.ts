import { describe, expect, it } from "vitest";
import { analyzeAssembly } from "../src/core/assemblyChecks";
import { createAssemblyDemo } from "../src/core/assemblyDemo";
import { assemblyMachiningWarnings } from "../src/core/assemblyMachining";
import { emptyAssembly, type AssemblyItem } from "../src/core/assemblyTypes";
import { geometrySignature, rotationFromEuler } from "../src/core/assemblyGeometry";
import { previewRelief, reliefContours } from "../src/core/joineryRelief";
import type { Part, Point, Project } from "../src/core/types";

const rect = (x: number, y: number, w: number, h: number): Point[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const plate = (): Part => ({ id: "p", name: "底板", stockId: "", layer: "CUT", thickness: 12, width: 100, height: 80, area: 8000, outline: rect(0, 0, 100, 80), holes: [rect(20, 20, 40, 20)], pockets: [], label: { x: 50, y: 40 } });
const pose = (): AssemblyItem => ({ partId: "p", position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } });
const project = (part: Part): Project => ({ name: "test", units: "mm", parts: [part], sheets: [], original: { sheets: [], placements: [] }, warnings: [] });
function fixture(part = plate()) {
  const assembly = emptyAssembly(); assembly.items = [pose()];
  return { part, assembly, project: project(part) };
}
const relief = (part: Part, style: "dogbone" | "tbone", direction: "long" | "short", corners = [0, 1, 2, 3]) => previewRelief(part, { target: "hole:0", corners, diameter: 6, style, direction }).part;

it("warns about an unrelieved groove even when the drawn solids fit", () => {
  const project = createAssemblyDemo(), assembly = project.assembly!;
  assembly.items[1].position.x = 66;
  const result = analyzeAssembly(project, assembly, { machining: true });
  expect(result.issues).toHaveLength(0);
  expect(result.complete).toBe(true);
  expect(result.machiningWarnings).toEqual([
    expect.objectContaining({
      partIds: ["assembly-base"], target: "pocket:0", cornerCount: 4,
      message: expect.stringContaining("未画刀口"),
    }),
  ]);
});

describe("drawing-based tool relief advice", () => {
  it("groups the real corners by hole, groove and concave outline without changing the drawing", () => {
    const f = fixture();
    f.part.outline = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 60, y: 80 }, { x: 60, y: 60 }, { x: 40, y: 60 }, { x: 40, y: 80 }, { x: 0, y: 80 }];
    f.part.pockets = [{ outline: rect(70, 20, 15, 30), depth: 3 }];
    const before = structuredClone(f);
    expect(assemblyMachiningWarnings(f.project, f.assembly).map(w => [w.target, w.cornerCount])).toEqual([["outline", 2], ["hole:0", 4], ["pocket:0", 4]]);
    expect(f).toEqual(before);
  });
  it.each(["dogbone", "tbone-long", "tbone-short"])("does not warn after actual %s geometry is drawn", style => {
    const f = fixture(relief(plate(), style === "dogbone" ? "dogbone" : "tbone", style === "tbone-short" ? "short" : "long"));
    expect(assemblyMachiningWarnings(f.project, f.assembly)).toEqual([]);
  });
  it("keeps only the missing corners after a partial relief edit", () => {
    const f = fixture(relief(plate(), "dogbone", "long", [0]));
    const [warning] = assemblyMachiningWarnings(f.project, f.assembly);
    expect(warning.cornerCount).toBe(3);
    expect(warning.localPositions.filter(p => p.z === 0)).toEqual([{ x: 60, y: 20, z: 0 }, { x: 60, y: 40, z: 0 }, { x: 20, y: 40, z: 0 }]);
  });
  it("does not mistake a circular hole or an explicitly drawn fillet for an omitted relief", () => {
    const f = fixture();
    const rounded = [[57, 23, -Math.PI / 2], [57, 37, 0], [23, 37, Math.PI / 2], [23, 23, Math.PI]]
      .flatMap(([cx, cy, start]) => Array.from({ length: 9 }, (_, i) => ({ x: cx + 3 * Math.cos(start + i * Math.PI / 16), y: cy + 3 * Math.sin(start + i * Math.PI / 16) })));
    f.part.holes = [rounded, Array.from({ length: 64 }, (_, i) => ({ x: 80 + 6 * Math.cos(i * Math.PI / 32), y: 60 + 6 * Math.sin(i * Math.PI / 32) }))];
    expect(reliefContours(f.part)[1].corners).toHaveLength(4);
    expect(assemblyMachiningWarnings(f.project, f.assembly)).toEqual([]);
  });
  it.each([0, -10])("excludes the free mouth of a groove starting at Y=%s", y => {
    const f = fixture(); f.part.holes = [];
    f.part.pockets = [{ outline: rect(70, y, 15, 30 - y), depth: 3 }];
    const [warning] = assemblyMachiningWarnings(f.project, f.assembly);
    expect(warning.cornerCount).toBe(2);
    expect(warning.localPositions.every(p => p.y === 30)).toBe(true);
  });
  it("does not depend on contour winding or extra collinear samples", () => {
    const f = fixture();
    f.part.holes[0].splice(1, 0, { x: 40, y: 20 });
    f.part.holes[0].reverse(); f.part.outline.reverse();
    expect(assemblyMachiningWarnings(f.project, f.assembly)[0].cornerCount).toBe(4);
  });
  it.each(["front", "back", "unknown", "stale"] as const)("marks the %s cutting face without guessing", face => {
    const f = fixture(); f.part.pockets = [{ outline: f.part.holes[0], depth: 3 }]; f.part.holes = [];
    if (face !== "unknown") f.assembly.pocketFaces.p = { signature: face === "stale" ? "stale" : geometrySignature(f.part), faces: { 0: face === "back" ? "back" : "front" } };
    const [warning] = assemblyMachiningWarnings(f.project, f.assembly);
    expect([...new Set(warning.localPositions.map(p => p.z))]).toEqual(face === "front" ? [12] : face === "back" ? [0] : [0, 12]);
  });
  it("keeps local corner markers and transforms the location with the receiving part", () => {
    const f = fixture(); f.assembly.items[0] = { ...pose(), position: { x: 100, y: 200, z: 300 }, rotation: rotationFromEuler({ x: 0, y: 0, z: 90 }) };
    const [warning] = assemblyMachiningWarnings(f.project, f.assembly);
    expect(warning.localPositions[0]).toEqual({ x: 20, y: 20, z: 0 });
    expect(warning.position!.x).toBeCloseTo(80); expect(warning.position!.y).toBeCloseTo(220); expect(warning.position!.z).toBe(300);
  });
  it("checks only placed inventory, skips spare parts, and does not duplicate warnings", () => {
    const f = fixture(); f.assembly.items = [];
    expect(assemblyMachiningWarnings(f.project, f.assembly)).toEqual([]);
    f.assembly.items = [pose(), pose()];
    expect(assemblyMachiningWarnings(f.project, f.assembly)).toHaveLength(1);
    f.assembly.sparePartIds = ["p"];
    expect(assemblyMachiningWarnings(f.project, f.assembly)).toEqual([]);
  });
  it("does not create non-finite locations for an invalid assembly pose", () => {
    const f = fixture(); f.assembly.items[0].position.x = NaN;
    expect(assemblyMachiningWarnings(f.project, f.assembly)).toEqual([]);
    f.assembly.items[0] = pose(); f.assembly.items[0].rotation.w = 0;
    expect(assemblyMachiningWarnings(f.project, f.assembly)).toEqual([]);
  });
  it("leaves unsupported coordinate and complexity drawings to the pending geometry check", () => {
    const f = fixture(); f.part.holes[0][0].x = 1e10;
    expect(assemblyMachiningWarnings(f.project, f.assembly)).toEqual([]);
    f.part.holes = [Array.from({ length: 2100 }, (_, i) => ({ x: 50 + 10 * Math.cos(i), y: 40 + 10 * Math.sin(i) }))];
    expect(assemblyMachiningWarnings(f.project, f.assembly)).toEqual([]);
  });
  it.each([3, 6])("does not warn about corners removed by a confirmed same-face %s mm groove", depth => {
    const f = fixture(); f.part.holes = [];
    f.part.pockets = [{ outline: rect(20, 20, 40, 20), depth: 3 }, { outline: rect(40, 30, 40, 20), depth }];
    f.assembly.pocketFaces.p = { signature: geometrySignature(f.part), faces: { 0: "front", 1: "front" } };
    const warnings = assemblyMachiningWarnings(f.project, f.assembly);
    expect(warnings.find(w => w.target === "pocket:0")!.cornerCount).toBe(3);
    expect(warnings.find(w => w.target === "pocket:0")!.localPositions).not.toContainEqual({ x: 60, y: 40, z: 12 });
    expect(warnings.find(w => w.target === "pocket:1")!.cornerCount).toBe(depth === 3 ? 3 : 4);
  });
  it("does not invent inner corners along the straight join of two adjacent cuts", () => {
    const f = fixture(); f.part.holes.push(rect(60, 20, 20, 20));
    const warnings = assemblyMachiningWarnings(f.project, f.assembly);
    expect(warnings.map(w => w.cornerCount)).toEqual([2, 2]);
    expect(warnings.flatMap(w => w.localPositions).some(p => p.x === 60)).toBe(false);
  });
  it("preserves material islands when merged grooves form a ring", () => {
    const f = fixture(); f.part.holes = []; f.part.outline = rect(0, 0, 100, 100);
    f.part.pockets = [rect(20, 20, 60, 10), rect(70, 30, 10, 40), rect(20, 70, 60, 10), rect(20, 20, 10, 60)].map(outline => ({ outline, depth: 3 }));
    f.assembly.pocketFaces.p = { signature: geometrySignature(f.part), faces: { 0: "front", 1: "front", 2: "front", 3: "front" } };
    const warnings = assemblyMachiningWarnings(f.project, f.assembly);
    const points = warnings.flatMap(w => w.localPositions);
    expect(points.some(p => p.x === 70 && (p.y === 30 || p.y === 70))).toBe(false);
    // A notch cut into that island DOES have two material concave corners.
    f.part.pockets.push({ outline: rect(40, 30, 10, 10), depth: 3 });
    f.assembly.pocketFaces.p = { signature: geometrySignature(f.part), faces: { ...f.assembly.pocketFaces.p.faces, 4: "front" } };
    const notch = assemblyMachiningWarnings(f.project, f.assembly).find(w => w.target === "pocket:4")!;
    expect(notch.cornerCount).toBe(2);
    expect(notch.localPositions).toEqual([{ x: 50, y: 40, z: 12 }, { x: 40, y: 40, z: 12 }]);
  });
  it.each(["back", "unknown"])("retains a corner when the overlapping groove's %s face cannot remove it", otherFace => {
    const f = fixture(); f.part.holes = [];
    f.part.pockets = [{ outline: rect(20, 20, 40, 20), depth: 3 }, { outline: rect(40, 30, 40, 20), depth: 3 }];
    f.assembly.pocketFaces.p = { signature: geometrySignature(f.part), faces: otherFace === "back" ? { 0: "front", 1: "back" } : { 0: "front" } };
    expect(assemblyMachiningWarnings(f.project, f.assembly).map(w => w.cornerCount)).toEqual([4, 4]);
  });
  it("keeps warnings separate from exact contact and installation checks", () => {
    const p = createAssemblyDemo(), a = p.assembly!; a.items[1].position.x = 66;
    const geometric = analyzeAssembly(p, a, { installation: true });
    const withMachining = analyzeAssembly(p, a, { installation: true, machining: true });
    expect(geometric.machiningWarnings).toBeUndefined();
    expect(withMachining.issues).toEqual(geometric.issues);
    expect(withMachining.collisions).toEqual(geometric.collisions);
    expect(withMachining.complete).toBe(geometric.complete);
    expect(withMachining.machiningWarnings![0].message).toContain("可能顶住");
  });
});
