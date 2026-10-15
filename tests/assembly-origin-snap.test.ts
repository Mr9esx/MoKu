import { describe, expect, it } from "vitest";
import { weakMoveSnap } from "../src/core/assemblyGuidance";
import type { AssemblyItem, PlacementCandidate } from "../src/core/assemblyTypes";

const pose = (x: number, y = 10, z = 10): AssemblyItem => ({
  partId: "moving", position: { x, y, z }, rotation: { x: 0, y: 0, z: 0, w: 1 },
});
const options = { enabled: true, axes: "X", project: (p: { x: number; y: number; z: number }) => ({ x: p.x, y: p.z }) };

describe("assembly origin magnet", () => {
  it("zeros positive and negative coordinates only on the moving axes", () => {
    const original = pose(-2, 1, 2);
    const result = weakMoveSnap(original, [], { ...options, axes: "XZ" });
    expect(result.pose.position).toEqual({ x: 0, y: 1, z: 0 });
    expect(result.zeroAxes).toEqual(["x", "z"]);
    expect(result.pose.rotation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(original.position).toEqual({ x: -2, y: 1, z: 2 });
  });

  it("requires both a short world distance and a small screen displacement", () => {
    expect(weakMoveSnap(pose(3), [], options).pose.position.x).toBe(0);
    expect(weakMoveSnap(pose(3.001), [], options).pose.position.x).toBe(3.001);
    const zoomed = { ...options, project: (p: { x: number; z: number }) => ({ x: p.x * 3, y: p.z }) };
    expect(weakMoveSnap(pose(2.5), [], zoomed).zeroAxes).toEqual([]);
    expect(weakMoveSnap(pose(-2), [], zoomed).pose.position.x).toBe(0);
  });

  it("holds near zero without jitter and releases when the pointer moves away", () => {
    const held = { ...options, heldOriginAxes: ["x"] as ("x" | "y" | "z")[] };
    expect(weakMoveSnap(pose(4), [], options).zeroAxes).toEqual([]);
    expect(weakMoveSnap(pose(4), [], held).pose.position.x).toBe(0);
    expect(weakMoveSnap(pose(6.001), [], held).pose.position.x).toBe(6.001);
    expect(weakMoveSnap(pose(4), [], { ...held, project: p => ({ x: p.x * 3, y: p.z }) }).zeroAxes).toEqual([]);
  });

  it("does not move the fixed height during an XY body drag", () => {
    const result = weakMoveSnap(pose(1, -2, 1), [], { ...options, axes: "xy" });
    expect(result.pose.position).toEqual({ x: 0, y: 0, z: 1 });
    expect(result.zeroAxes).toEqual(["x", "y"]);
  });

  it("releases for Alt, the magnet switch and locked parts", () => {
    const original = pose(1);
    for (const settings of [{ ...options, suspended: true }, { ...options, enabled: false }]) {
      const result = weakMoveSnap(original, [], { ...settings, heldOriginAxes: ["x"] });
      expect(result.pose).toBe(original);
      expect(result.zeroAxes).toEqual([]);
    }
    const locked = { ...original, locked: true };
    expect(weakMoveSnap(locked, [], options).pose).toBe(locked);
  });

  it("preserves a valid assembly target rather than shifting it to the origin", () => {
    const candidate: PlacementCandidate = {
      id: "contact", partId: "moving", receiverId: "host", pose: pose(1),
      target: { x: 1, y: 10, z: 10 }, label: "surface", status: "valid",
    };
    const result = weakMoveSnap(pose(2), [candidate], options);
    expect(result.pose.position).toEqual({ x: 1, y: 10, z: 10 });
    expect(result.candidateId).toBe("contact");
    expect(result.zeroAxes).toEqual([]);
    expect(weakMoveSnap(pose(2), [{ ...candidate, status: "invalid" }], options).pose.position.x).toBe(0);
  });

  it("ignores nonfinite projections and invalid coordinates", () => {
    expect(weakMoveSnap(pose(1), [], { ...options, project: () => ({ x: Infinity, y: 0 }) }).zeroAxes).toEqual([]);
    const invalid = pose(NaN);
    expect(weakMoveSnap(invalid, [], options).pose).toBe(invalid);
  });
});
