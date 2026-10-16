import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createAssemblyTransformControls } from "../src/components/assemblyTransformControls";

function fixture(size = 800, camera: THREE.Camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100)) {
  const element = Object.assign(new EventTarget(), {
    style: { touchAction: "" },
    getBoundingClientRect: () => ({ width: size, height: size }),
  }) as unknown as HTMLElement;
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene(), object = new THREE.Group();
  const gizmo = createAssemblyTransformControls(camera, element);
  scene.add(object, gizmo.helper);
  gizmo.attach(object);
  scene.updateMatrixWorld(true);
  return { gizmo, object, scene, camera };
}
const pointer = (x: number, y: number, button = 0) => ({ x, y, button });

describe("combined assembly manipulation", () => {
  it("grabs the visible rotation arc inside the arrow's oversized hidden hit area", () => {
    const { gizmo, object } = fixture();
    try {
      expect(gizmo.down(pointer(0.058, 0.015))).toBe(true);
      expect(gizmo.active?.mode).toBe("rotate");
      expect(gizmo.active?.axis).toBe("Z");
      gizmo.move(pointer(-0.015, 0.058, -1));
      gizmo.up();
      expect(object.position.toArray()).toEqual([0, 0, 0]);
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 2, 2);
    } finally { gizmo.dispose(); }
  });

  it("accepts a near miss within six screen pixels of the ring", () => {
    const { gizmo, object } = fixture();
    try {
      // The ring radius is 24 px here; this lands about 5 px outside it.
      expect(gizmo.down(pointer(0.068, 0.026))).toBe(true);
      expect(gizmo.active?.mode).toBe("rotate");
      expect(gizmo.active?.axis).toBe("Z");
      gizmo.move(pointer(-0.026, 0.068, -1));
      gizmo.up();
      expect(object.position.toArray()).toEqual([0, 0, 0]);
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 2, 2);
    } finally { gizmo.dispose(); }
  });

  it.each([[400, 0.0601], [800, 0.0513], [1200, 0.0483]])(
    "keeps the same five-pixel margin in a %i px viewport",
    (size, coordinate) => {
      const { gizmo, object } = fixture(size);
      try {
        expect(gizmo.down(pointer(coordinate, coordinate))).toBe(true);
        expect(gizmo.active?.mode).toBe("rotate");
        expect(gizmo.active?.axis).toBe("Z");
        gizmo.move(pointer(-coordinate, coordinate, -1));
        gizmo.up();
        expect(object.position.toArray()).toEqual([0, 0, 0]);
        expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 2, 2);
      } finally { gizmo.dispose(); }
    },
  );

  it("leaves distant empty space available for scene navigation", () => {
    const { gizmo } = fixture();
    try {
      expect(gizmo.down(pointer(0.15, 0.15))).toBe(false);
      expect(gizmo.active).toBeNull();
    } finally { gizmo.dispose(); }
  });

  it("picks the matching arc with a perspective camera looking down on an off-center part", () => {
    const { gizmo, object, scene, camera } = fixture(800, new THREE.PerspectiveCamera(38, 1, 0.1, 1000));
    try {
      camera.position.set(60, 60, 360);
      camera.lookAt(60, 60, 30);
      object.position.set(70.4, 20, 6);
      for (const control of gizmo.controls) control.setRotationSnap(Math.PI / 2);
      scene.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      const from = new THREE.Vector3(65, 25.4, 6).project(camera);
      const to = new THREE.Vector3(65, 14.6, 6).project(camera);
      expect(gizmo.down(pointer(from.x, from.y))).toBe(true);
      expect(gizmo.active?.mode).toBe("rotate");
      expect(gizmo.active?.axis).toBe("Z");
      gizmo.move(pointer(to.x, to.y, -1));
      gizmo.up();
      expect(object.position.toArray()).toEqual([70.4, 20, 6]);
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 2, 2);
    } finally { gizmo.dispose(); }
  });

  it("rotates an edge-on ring by dragging along its visible tangent", () => {
    const { gizmo, object } = fixture();
    try {
      for (const control of gizmo.controls) control.setRotationSnap(Math.PI / 2);
      expect(gizmo.down(pointer(0.01, 0.03))).toBe(true);
      expect(gizmo.active?.axis).toBe("X");
      gizmo.move(pointer(0.01, -0.06425, -1));
      gizmo.up();
      expect(object.position.toArray()).toEqual([0, 0, 0]);
      expect(object.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))).toBeCloseTo(0);
    } finally { gizmo.dispose(); }
  });

  it("still rotates when grabbing the projected endpoint of an edge-on ring", () => {
    const { gizmo, object } = fixture();
    try {
      for (const control of gizmo.controls) control.setRotationSnap(Math.PI / 2);
      expect(gizmo.down(pointer(-0.01, 0.065))).toBe(true);
      expect(gizmo.active?.mode).toBe("rotate");
      expect(gizmo.active?.axis).toBe("X");
      gizmo.move(pointer(-0.01, -0.035, -1));
      gizmo.up();
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 2, 2);
      expect(object.position.toArray()).toEqual([0, 0, 0]);
    } finally { gizmo.dispose(); }
  });

  it("can suspend angle snapping during a gesture for a precise rotation", () => {
    const { gizmo, object } = fixture();
    try {
      for (const control of gizmo.controls) control.setRotationSnap(Math.PI / 2);
      gizmo.down(pointer(0.042426, 0.042426));
      gizmo.move(pointer(0.015529, 0.057956, -1));
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0);
      for (const control of gizmo.controls) control.setRotationSnap(null);
      gizmo.move(pointer(0.015529, 0.057956, -1));
      gizmo.up();
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 6, 3);
      expect(object.position.toArray()).toEqual([0, 0, 0]);
    } finally { gizmo.dispose(); }
  });

  it("preserves world-axis rotation under a rotated parent and can cancel it", () => {
    const { gizmo, object, scene } = fixture();
    try {
      const parent = new THREE.Group();
      parent.rotation.y = Math.PI / 6;
      scene.add(parent);
      parent.add(object);
      scene.updateMatrixWorld(true);
      expect(gizmo.down(pointer(0.042, 0.042))).toBe(true);
      gizmo.move(pointer(-0.042, 0.042, -1));
      scene.updateMatrixWorld(true);
      const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2).multiply(parent.quaternion);
      expect(object.getWorldQuaternion(new THREE.Quaternion()).angleTo(expected)).toBeCloseTo(0);
      gizmo.reset();
      gizmo.move(pointer(-0.042, -0.042, -1));
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0);
      expect(object.position.toArray()).toEqual([0, 0, 0]);
      expect(gizmo.active).toBeNull();
    } finally { gizmo.dispose(); }
  });

  it("moves and then rotates the same selection without switching tools", () => {
    const { gizmo, object, scene } = fixture();
    try {
      expect(gizmo.down(pointer(0.08, 0))).toBe(true);
      expect(gizmo.active?.mode).toBe("translate");
      gizmo.move(pointer(0.28, 0, -1));
      gizmo.up();
      expect(object.position.x).toBeCloseTo(0.4);
      expect(object.position.y).toBeCloseTo(0);
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0);
      scene.updateMatrixWorld(true);
      expect(gizmo.down(pointer(0.242, 0.042))).toBe(true);
      expect(gizmo.active?.mode).toBe("rotate");
      gizmo.move(pointer(0.158, 0.042, -1));
      gizmo.up();
      expect(object.position.x).toBeCloseTo(0.4);
      expect(object.position.y).toBeCloseTo(0);
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 2, 2);
    } finally { gizmo.dispose(); }
  });

  it("keeps one handle in charge until release even when crossing another handle", () => {
    const { gizmo, object } = fixture();
    try {
      gizmo.down(pointer(0.08, 0));
      const owner = gizmo.active;
      gizmo.hover(pointer(0.042, 0.042));
      gizmo.down(pointer(0.042, 0.042));
      expect(gizmo.active).toBe(owner);
      expect(gizmo.controls.filter(control => control.dragging)).toHaveLength(1);
      gizmo.move(pointer(0.28, 0.042, -1));
      gizmo.up();
      expect(object.position.x).toBeCloseTo(0.4);
      expect(object.position.y).toBeCloseTo(0);
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0);
    } finally { gizmo.dispose(); }
  });

  it("cancels a drag completely before accepting a different operation", () => {
    const { gizmo, object, scene } = fixture();
    try {
      gizmo.down(pointer(0.08, 0));
      gizmo.move(pointer(0.28, 0, -1));
      gizmo.reset();
      gizmo.move(pointer(0.6, 0, -1));
      expect(object.position.toArray()).toEqual([0, 0, 0]);
      expect(gizmo.active).toBeNull();
      expect(gizmo.controls.some(control => control.dragging)).toBe(false);
      scene.updateMatrixWorld(true);
      expect(gizmo.down(pointer(0.042, 0.042))).toBe(true);
      gizmo.move(pointer(-0.042, 0.042, -1));
      gizmo.up();
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 2, 2);
    } finally { gizmo.dispose(); }
  });

  it("does not edit detached objects or consume right-button scene navigation", () => {
    const { gizmo, object } = fixture();
    try {
      expect(gizmo.down(pointer(0.08, 0, 2))).toBe(false);
      gizmo.detach();
      expect(gizmo.down(pointer(0.08, 0))).toBe(false);
      expect(gizmo.down(pointer(0.042, 0.042))).toBe(false);
      gizmo.move(pointer(0.5, 0.5, -1));
      expect(object.position.toArray()).toEqual([0, 0, 0]);
      expect(object.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0);
    } finally { gizmo.dispose(); }
  });
});
