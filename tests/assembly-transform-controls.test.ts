import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createAssemblyTransformControls } from "../src/components/assemblyTransformControls";

function fixture() {
  const element = Object.assign(new EventTarget(), { style: { touchAction: "" } }) as unknown as HTMLElement;
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const scene = new THREE.Scene(), object = new THREE.Group();
  const gizmo = createAssemblyTransformControls(camera, element);
  scene.add(object, gizmo.helper);
  gizmo.attach(object);
  scene.updateMatrixWorld(true);
  return { gizmo, object, scene };
}
const pointer = (x: number, y: number, button = 0) => ({ x, y, button });

describe("combined assembly manipulation", () => {
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
