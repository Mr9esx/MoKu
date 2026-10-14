import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import {
  disposeObject,
  visibleSnapTarget,
  referencePoints,
  alignReferences,
} from "../src/components/assemblySceneUtils";
import { createAssemblyDemo } from "../src/core/assemblyDemo";
import {
  transformPoint,
  rotationFromEuler,
} from "../src/core/assemblyGeometry";

describe("assembly scene resources and visible targets", () => {
  it("disposes ordinary contour lines, segments and mesh resources", () => {
    const group = new THREE.Group();
    for (const Constructor of [THREE.Line, THREE.LineSegments, THREE.Mesh]) {
      const geometry = new THREE.BufferGeometry(),
        material = new THREE.MeshBasicMaterial();
      group.add(new Constructor(geometry, material));
      vi.spyOn(geometry, "dispose");
      vi.spyOn(material, "dispose");
    }
    disposeObject(group);
    group.children.forEach((child) => {
      const obj = child as THREE.Mesh;
      expect(obj.geometry.dispose).toHaveBeenCalledOnce();
      expect((obj.material as THREE.Material).dispose).toHaveBeenCalledOnce();
    });
  });
  it("excludes targets behind the camera, offscreen or behind another part", () => {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(4, 4, 1),
      new THREE.MeshBasicMaterial(),
    );
    wall.position.z = 5;
    wall.updateMatrixWorld();
    expect(visibleSnapTarget({ x: 0, y: 0, z: 0 }, camera, [wall])).toBe(false);
    expect(visibleSnapTarget({ x: 0, y: 0, z: 6 }, camera, [wall])).toBe(true);
    expect(visibleSnapTarget({ x: 0, y: 0, z: 11 }, camera, [])).toBe(false);
    expect(visibleSnapTarget({ x: 100, y: 0, z: 0 }, camera, [])).toBe(false);
  });
});
describe("explicit assembly references", () => {
  it("aligns faces in world coordinates after existing rotations without moving the selected contact point", () => {
    const project = createAssemblyDemo(),
      part = project.parts[1],
      host = project.parts[0];
    const source = referencePoints(part).find((r) => r.id === "front")!;
    const target = referencePoints(host).find((r) => r.id === "back")!;
    const male = {
      ...project.assembly!.items[1],
      rotation: rotationFromEuler({ x: 20, y: 35, z: 60 }),
    };
    const receiver = {
      ...project.assembly!.items[0],
      rotation: rotationFromEuler({ x: 10, y: 15, z: 30 }),
    };
    const pose = alignReferences(male, source, receiver, target);
    const a = transformPoint(source.position, pose),
      b = transformPoint(target.position, receiver);
    expect(a.x).toBeCloseTo(b.x, 8);
    expect(a.y).toBeCloseTo(b.y, 8);
    expect(a.z).toBeCloseTo(b.z, 8);
    const normal = new THREE.Vector3(
      ...[source.normal!.x, source.normal!.y, source.normal!.z],
    ).applyQuaternion(
      new THREE.Quaternion(
        pose.rotation.x,
        pose.rotation.y,
        pose.rotation.z,
        pose.rotation.w,
      ),
    );
    const other = new THREE.Vector3(
      target.normal!.x,
      target.normal!.y,
      target.normal!.z,
    ).applyQuaternion(
      new THREE.Quaternion(
        receiver.rotation.x,
        receiver.rotation.y,
        receiver.rotation.z,
        receiver.rotation.w,
      ),
    );
    expect(normal.dot(other)).toBeCloseTo(-1, 8);
  });
  it("exposes individual edge and vertex references and translates point alignment without changing orientation", () => {
    const project = createAssemblyDemo(),
      refs = referencePoints(project.parts[1]);
    expect(refs.filter((r) => r.kind === "edge")).toHaveLength(4);
    expect(refs.filter((r) => r.kind === "point")).toHaveLength(8);
    const male = project.assembly!.items[1],
      receiver = project.assembly!.items[0];
    const source = refs.find((r) => r.kind === "point")!,
      target = referencePoints(project.parts[0]).find(
        (r) => r.kind === "point",
      )!;
    const pose = alignReferences(male, source, receiver, target);
    expect(pose.rotation).toEqual(male.rotation);
    expect(transformPoint(source.position, pose)).toEqual(
      transformPoint(target.position, receiver),
    );
  });
});
