import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  cubeFaces,
  cubeZones,
  projectCube,
  viewQuaternion,
  orientationPosition,
  interpolateViewQuaternion,
  dragViewQuaternion,
} from "../src/components/viewCubeGeometry";

describe("assembly orientation cube", () => {
  it("offers six faces, twelve edges and eight corners with unique unit directions", () => {
    const zones = cubeZones();
    expect(zones).toHaveLength(26);
    expect(new Set(zones.map((z) => z.id)).size).toBe(26);
    expect(zones.filter((z) => z.kind === "face")).toHaveLength(6);
    expect(zones.filter((z) => z.kind === "edge")).toHaveLength(12);
    expect(zones.filter((z) => z.kind === "corner")).toHaveLength(8);
    zones.forEach((z) =>
      expect(
        Math.hypot(z.direction.x, z.direction.y, z.direction.z),
      ).toBeCloseTo(1, 12),
    );
    expect(cubeFaces.find((f) => f.label === "前")?.normal).toEqual({
      x: 0,
      y: -1,
      z: 0,
    });
    expect(cubeFaces.find((f) => f.label === "上")?.normal).toEqual({
      x: 0,
      y: 0,
      z: 1,
    });
  });
  it("projects front/right/top for the positive-X negative-Y positive-Z view with upright readable labels", () => {
    const faces = projectCube(viewQuaternion({ x: 1, y: -1, z: 1 }));
    expect(faces.map((f) => f.label).sort()).toEqual(["上", "前", "右"].sort());
    faces.forEach((face) => {
      const [a, b, c, d] = face.textTransform;
      expect(a * d - b * c).toBeGreaterThan(0);
      face.polygon.forEach((p) => {
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(112);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(112);
      });
    });
  });
  it("shows a single facing face at each axial view, including top and bottom", () => {
    cubeFaces.forEach((face) => {
      const q = viewQuaternion(face.normal);
      expect([q.x, q.y, q.z, q.w].every(Number.isFinite)).toBe(true);
      expect(projectCube(q).map((f) => f.label)).toEqual([face.label]);
      const outward = new Vector3(0, 0, 1).applyQuaternion(q);
      expect(
        outward.dot(new Vector3(face.normal.x, face.normal.y, face.normal.z)),
      ).toBeGreaterThan(0.999999);
    });
  });
  it("changes direction around the existing focus without changing zoom distance", () => {
    const target = { x: 312, y: -40, z: 65 },
      radius = 427;
    cubeZones().forEach((zone) => {
      const q = viewQuaternion(zone.direction),
        position = orientationPosition(q, target, radius);
      const delta = new Vector3(
        position.x - target.x,
        position.y - target.y,
        position.z - target.z,
      );
      expect(delta.length()).toBeCloseTo(radius, 10);
      expect(
        delta
          .normalize()
          .dot(
            new Vector3(zone.direction.x, zone.direction.y, zone.direction.z),
          ),
      ).toBeGreaterThan(0.999999);
    });
  });
  it("keeps every intermediate view Z-up so interrupting navigation cannot reset roll", () => {
    for (const a of cubeZones())
      for (const b of cubeZones()) {
        const from = viewQuaternion(a.direction),
          to = viewQuaternion(b.direction);
        for (const t of [0, 0.1, 0.5, 0.9, 1]) {
          const q = interpolateViewQuaternion(from, to, t);
          expect(Math.abs(new Vector3(1, 0, 0).applyQuaternion(q).z)).toBeLessThan(
            1e-9,
          );
          if (t === 0) expect(q.angleTo(from)).toBeLessThan(1e-6);
          if (t === 1) expect(q.angleTo(to)).toBeLessThan(1e-6);
        }
      }
  });
  it("uses the shorter azimuth across the back view", () => {
    const a = (170 * Math.PI) / 180;
    const from = viewQuaternion({
      x: Math.sin(a), y: -Math.cos(a), z: 0.5,
    });
    const to = viewQuaternion({
      x: -Math.sin(a), y: -Math.cos(a), z: 0.5,
    });
    const q = interpolateViewQuaternion(from, to, 0.5);
    const direction = new Vector3(0, 0, 1).applyQuaternion(q);
    expect(Math.abs(direction.x)).toBeLessThan(1e-9);
    expect(direction.y).toBeGreaterThan(0.8);
  });
  it("orbits horizontally and vertically in the same directions as scene dragging", () => {
    const from = viewQuaternion({ x: 0, y: -1, z: 0 });
    const horizontal = new Vector3(0, 0, 1).applyQuaternion(
      dragViewQuaternion(from, 20, 0),
    );
    expect(horizontal.x).toBeLessThan(0);
    expect(horizontal.y).toBeLessThan(0);
    expect(horizontal.z).toBeCloseTo(0, 10);
    const vertical = new Vector3(0, 0, 1).applyQuaternion(
      dragViewQuaternion(from, 0, 20),
    );
    expect(vertical.x).toBeCloseTo(0, 10);
    expect(vertical.y).toBeLessThan(0);
    expect(vertical.z).toBeGreaterThan(0);
    expect(
      dragViewQuaternion(dragViewQuaternion(from, 20, 15), -20, -15).angleTo(from),
    ).toBeLessThan(1e-6);
  });
  it("keeps pole drags finite and Z-up without changing the current focus or zoom", () => {
    const target = new Vector3(312, -40, 65);
    for (const zone of cubeZones()) {
      for (const dy of [-10000, 10000]) {
        const q = dragViewQuaternion(viewQuaternion(zone.direction), 18, dy);
        expect([q.x, q.y, q.z, q.w].every(Number.isFinite)).toBe(true);
        expect(Math.abs(new Vector3(1, 0, 0).applyQuaternion(q).z)).toBeLessThan(
          1e-9,
        );
        const position = orientationPosition(q, target, 427);
        expect(position.distanceTo(target)).toBeCloseTo(427, 9);
        const outward = new Vector3(0, 0, 1).applyQuaternion(q);
        expect(Math.hypot(outward.x, outward.y)).toBeGreaterThan(1e-7);
        const reversed = dragViewQuaternion(q, 0, dy > 0 ? -20 : 20);
        expect(q.angleTo(reversed)).toBeGreaterThan(0.01);
      }
    }
  });
});
