import { describe, expect, it } from "vitest";
import { Vector3, Quaternion } from "three";
import { faceReferenceAt, alignReferences } from "../src/components/assemblySceneUtils";
import { rotationFromEuler, transformPoint } from "../src/core/assemblyGeometry";
import { createAssemblyDemo } from "../src/core/assemblyDemo";
import { createWorkbenchStore } from "../src/store";

describe("picking contact faces", () => {
  it("converts a world-space click to a local contact point on a rotated part", () => {
    const item = { partId: "moving", position: { x: 10, y: 20, z: 30 }, rotation: rotationFromEuler({ x: 0, y: 0, z: 90 }) };
    const reference = faceReferenceAt(item, { x: 6, y: 23, z: 42 }, { x: 0, y: 0, z: 2 })!;
    expect(reference.position.x).toBeCloseTo(3);
    expect(reference.position.y).toBeCloseTo(4);
    expect(reference.position.z).toBeCloseTo(12);
    expect(reference.normal).toEqual({ x: 0, y: 0, z: 1 });
  });

  it("mates clicked side and top surfaces, preserving the receiver and making normals oppose", () => {
    const moving = { partId: "moving", position: { x: 200, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
    const host = { ...moving, partId: "host", position: { x: 0, y: 0, z: 0 } };
    const source = faceReferenceAt(moving, { x: 200, y: 40, z: 6 }, { x: -1, y: 0, z: 0 })!;
    const target = faceReferenceAt(host, { x: 50, y: 40, z: 12 }, { x: 0, y: 0, z: 1 })!;
    const pose = alignReferences(moving, source, host, target);
    expect(transformPoint(source.position, pose)).toEqual({ x: 50, y: 40, z: 12 });
    const normal = new Vector3(-1, 0, 0).applyQuaternion(new Quaternion(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w));
    expect(normal.z).toBeCloseTo(-1);
    expect(host.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(moving.position.x).toBe(200);
  });

  it("rejects invalid points, normals and rotations before creating a preview", () => {
    const item = createAssemblyDemo().assembly!.items[1];
    expect(faceReferenceAt(item, { x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeNull();
    expect(faceReferenceAt(item, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).toBeNull();
    expect(faceReferenceAt({ ...item, rotation: { x: 0, y: 0, z: 0, w: 0 } }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })).toBeNull();
  });

  it("saves a complete mating pose as one undoable operation while preserving stock and host", () => {
    const project = createAssemblyDemo();
    const store = createWorkbenchStore();
    store.getState().importProject(project);
    const before = structuredClone(store.getState().project!);
    const assembly = before.assembly!;
    const [host, moving] = assembly.items;
    const source = faceReferenceAt(moving, transformPoint({ x: 0, y: 40, z: 6 }, moving), { x: -1, y: 0, z: 0 })!;
    const target = faceReferenceAt(host, { x: 60, y: 60, z: 12 }, { x: 0, y: 0, z: 1 })!;
    const pose = alignReferences(moving, source, host, target);
    expect(store.getState().updateAssembly({ ...assembly, items: [host, pose] })).toBe(true);
    expect(store.getState().project!.parts).toEqual(before.parts);
    expect(store.getState().project!.assembly!.items[0]).toEqual(host);
    expect(store.getState().history).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().project).toEqual(before);
  });
});
