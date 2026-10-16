import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { createAssemblyCameraControls } from "../src/components/assemblyCameraControls";
import { wheelZoomFactor } from "../src/core/canvasViewport";

function fixture() {
  const root = new EventTarget();
  const element = Object.assign(new EventTarget(), {
    style: { touchAction: "", cursor: "" },
    clientWidth: 800, clientHeight: 600,
    getBoundingClientRect: () => ({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 600 }),
    getRootNode: () => root,
    ownerDocument: root,
    setPointerCapture: () => {}, releasePointerCapture: () => {},
  }) as unknown as HTMLElement;
  const camera = new PerspectiveCamera(38, 4 / 3, 0.1, 10000);
  camera.up.set(0, 0, 1);
  camera.position.set(240, -300, 220);
  const controls = createAssemblyCameraControls(camera, element);
  controls.target.set(60, 60, 25);
  controls.update();
  camera.updateMatrixWorld();
  const pointer = (type: string, x: number, y: number, button = 0) => {
    (type === "pointerdown" ? element : root).dispatchEvent(Object.assign(new Event(type, { cancelable: true }), {
      pointerId: 1, pointerType: "mouse", clientX: x, clientY: y, button,
      ctrlKey: false, metaKey: false, shiftKey: false,
    }));
  };
  return { camera, controls, element, root, pointer };
}

describe("assembly canvas navigation", () => {
  it("pans with a left drag in the screen plane without rotating or zooming", () => {
    const { camera, controls, pointer } = fixture();
    try {
      const orientation = camera.quaternion.clone();
      const offset = camera.position.clone().sub(controls.target);
      const target = controls.target.clone();
      const right = new Vector3(1, 0, 0).applyQuaternion(orientation);
      pointer("pointerdown", 400, 300);
      pointer("pointermove", 480, 300);
      pointer("pointerup", 480, 300);
      const movement = controls.target.clone().sub(target);
      expect(movement.length()).toBeGreaterThan(0);
      expect(movement.clone().normalize().dot(right)).toBeCloseTo(-1);
      expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-6);
      expect(camera.position.clone().sub(controls.target).distanceTo(offset)).toBeLessThan(1e-6);
    } finally { controls.dispose(); }
  });

  it("rotates with a right drag around the current focus without changing distance", () => {
    const { camera, controls, pointer } = fixture();
    try {
      const orientation = camera.quaternion.clone();
      const target = controls.target.clone();
      const distance = camera.position.distanceTo(target);
      pointer("pointerdown", 400, 300, 2);
      pointer("pointermove", 480, 330, 2);
      pointer("pointerup", 480, 330, 2);
      expect(camera.quaternion.angleTo(orientation)).toBeGreaterThan(0.1);
      expect(controls.target.distanceTo(target)).toBeLessThan(1e-6);
      expect(camera.position.distanceTo(target)).toBeCloseTo(distance);
    } finally { controls.dispose(); }
  });

  it("zooms toward the cursor on a plain wheel event while preserving orientation", () => {
    const { camera, controls, element } = fixture();
    try {
      camera.updateMatrixWorld();
      const anchor = new Vector3(90, 60, 25);
      const before = anchor.clone().project(camera);
      const orientation = camera.quaternion.clone();
      const distance = camera.position.distanceTo(controls.target);
      element.dispatchEvent(Object.assign(new Event("wheel", { cancelable: true }), {
        clientX: (before.x + 1) * 400, clientY: (1 - before.y) * 300,
        deltaY: -100, deltaMode: 0, ctrlKey: false,
      }));
      camera.updateMatrixWorld();
      const after = anchor.clone().project(camera);
      expect(camera.position.distanceTo(controls.target)).toBeLessThan(distance);
      expect(after.x).toBeCloseTo(before.x);
      expect(after.y).toBeCloseTo(before.y);
      expect(camera.quaternion.angleTo(orientation)).toBeLessThan(1e-6);
    } finally { controls.dispose(); }
  });

  it.each(["plain wheel", "physical Ctrl + wheel", "trackpad pinch"])(
    "uses the same 2D and 3D zoom speed for %s", mode => {
      const { camera, controls, element, root } = fixture();
      try {
        const controlKeyDown = mode === "physical Ctrl + wheel";
        const event = { deltaY: -100, deltaMode: 0, ctrlKey: mode !== "plain wheel" };
        if (controlKeyDown) root.dispatchEvent(Object.assign(new Event("keydown"), { key: "Control" }));
        const distance = camera.position.distanceTo(controls.target);
        element.dispatchEvent(Object.assign(new Event("wheel", { cancelable: true }), {
          ...event, clientX: 400, clientY: 300,
        }));
        expect(distance / camera.position.distanceTo(controls.target))
          .toBeCloseTo(wheelZoomFactor(event, controlKeyDown));
      } finally { controls.dispose(); }
    },
  );
});
