import * as THREE from "three";
import type { AssemblyItem, Vec3 } from "../core/assemblyTypes";
import type { Part } from "../core/types";
import { transformPoint } from "../core/assemblyGeometry";

export function disposeObject(group: THREE.Object3D) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry.dispose();
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(
        (m) => m.dispose(),
      );
    }
  });
}

/** A destination must be in the viewport and visible through the actual scene material. */
export function visibleSnapTarget(
  target: Vec3,
  camera: THREE.PerspectiveCamera,
  obstacles: THREE.Object3D[],
) {
  const point = new THREE.Vector3(target.x, target.y, target.z);
  const projected = point.clone().project(camera);
  if (
    projected.z < -1 ||
    projected.z > 1 ||
    Math.abs(projected.x) > 1 ||
    Math.abs(projected.y) > 1
  )
    return false;
  const origin = camera.getWorldPosition(new THREE.Vector3()),
    distance = origin.distanceTo(point);
  const ray = new THREE.Raycaster(
    origin,
    point.clone().sub(origin).normalize(),
    0,
    Math.max(0, distance - 0.02),
  );
  return ray.intersectObjects(obstacles, false).length === 0;
}

export type AssemblyReference = {
  id: string;
  kind: "face" | "edge" | "point";
  label: string;
  position: Vec3;
  normal?: Vec3;
  direction?: Vec3;
};
export function referencePoints(part: Part): AssemblyReference[] {
  const outline = part.outline;
  const xs = outline.map((p) => p.x),
    ys = outline.map((p) => p.y);
  const center = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
  const refs: AssemblyReference[] = [
    {
      id: "front",
      kind: "face",
      label: "正面 +Z",
      position: { ...center, z: part.thickness },
      normal: { x: 0, y: 0, z: 1 },
    },
    {
      id: "back",
      kind: "face",
      label: "反面 −Z",
      position: { ...center, z: 0 },
      normal: { x: 0, y: 0, z: -1 },
    },
  ];
  const area = outline.reduce((sum, p, i) => {
    const q = outline[(i + 1) % outline.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length],
      dx = q.x - p.x,
      dy = q.y - p.y,
      length = Math.hypot(dx, dy);
    const midpoint = {
      x: (p.x + q.x) / 2,
      y: (p.y + q.y) / 2,
      z: part.thickness / 2,
    };
    if (length) {
      refs.push({
        id: "wall-" + i,
        kind: "face",
        label: "侧面 " + (i + 1),
        position: midpoint,
        normal: {
          x: (dy / length) * (area > 0 ? 1 : -1),
          y: (-dx / length) * (area > 0 ? 1 : -1),
          z: 0,
        },
      });
      refs.push({
        id: "edge-" + i,
        kind: "edge",
        label: "外轮廓边 " + (i + 1) + " 中点",
        position: midpoint,
        direction: { x: dx / length, y: dy / length, z: 0 },
      });
    }
    for (const [side, z] of [
      ["front", part.thickness],
      ["back", 0],
    ] as const)
      refs.push({
        id: side + "-point-" + i,
        kind: "point",
        label: (side === "front" ? "正面" : "反面") + "角点 " + (i + 1),
        position: { ...p, z },
      });
  });
  return refs;
}
export function alignReferences(
  source: AssemblyItem,
  from: AssemblyReference,
  receiver: AssemblyItem,
  to: AssemblyReference,
): AssemblyItem {
  const q = new THREE.Quaternion(
    source.rotation.x,
    source.rotation.y,
    source.rotation.z,
    source.rotation.w,
  );
  const receiverQ = new THREE.Quaternion(
    receiver.rotation.x,
    receiver.rotation.y,
    receiver.rotation.z,
    receiver.rotation.w,
  );
  const a = from.normal ?? from.direction,
    b = to.normal ?? to.direction;
  if (a && b) {
    const u = new THREE.Vector3(a.x, a.y, a.z).applyQuaternion(q).normalize();
    const v = new THREE.Vector3(b.x, b.y, b.z)
      .applyQuaternion(receiverQ)
      .normalize();
    if (from.normal && to.normal) v.negate();
    q.premultiply(new THREE.Quaternion().setFromUnitVectors(u, v)).normalize();
  }
  const rotated = new THREE.Vector3(
    from.position.x,
    from.position.y,
    from.position.z,
  ).applyQuaternion(q);
  const target = transformPoint(to.position, receiver);
  return {
    ...source,
    position: {
      x: target.x - rotated.x,
      y: target.y - rotated.y,
      z: target.z - rotated.z,
    },
    rotation:
      a && b ? { x: q.x, y: q.y, z: q.z, w: q.w } : { ...source.rotation },
  };
}
