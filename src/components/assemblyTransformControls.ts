import * as THREE from "three";
import {
  TransformControls,
  TransformControlsGizmo,
} from "three/addons/controls/TransformControls.js";

type Pointer = { x: number; y: number; button: number };

/** Both helpers stay visible; one picked handle owns the whole pointer gesture. */
export function createAssemblyTransformControls(
  camera: THREE.Camera,
  element: HTMLElement,
) {
  const touchAction = element.style.touchAction;
  const controls = ["translate", "rotate"].map((mode) => {
    const control = new TransformControls(camera, element);
    // The scene routes captured gestures so two independent DOM listeners cannot edit together.
    control.disconnect();
    control.setMode(mode as "translate" | "rotate");
    control.setSpace("world");
    control.setSize(mode === "translate" ? 0.35 : 0.24);
    control.setColors("#3861b4", "#658774", "#7e879b", "#dfb322");
    control.showXY = control.showYZ = control.showXZ = false;
    control.showE = control.showXYZE = false;
    return control;
  });
  element.style.touchAction = "none";
  const helper = new THREE.Group();
  helper.add(...controls.map(control => control.getHelper()));
  const pickers = controls.map(control => ({
    control,
    picker: (control.getHelper().children.find(
      child => child instanceof TransformControlsGizmo,
    ) as TransformControlsGizmo).picker[control.mode],
  }));
  const ray = new THREE.Raycaster(), coordinates = new THREE.Vector2();
  let active: TransformControls | null = null;

  function hover(pointer: Pointer) {
    if (active) return true;
    helper.updateMatrixWorld(true);
    ray.setFromCamera(coordinates.set(pointer.x, pointer.y), camera);
    let nearest: { control: TransformControls; axis: TransformControls["axis"]; distance: number } | null = null;
    for (const { control, picker } of pickers) {
      if (!control.object || !control.enabled) continue;
      const hit = ray.intersectObject(picker, true).find(hit => hit.object.visible);
      if (hit && (!nearest || hit.distance < nearest.distance)) {
        nearest = { control, axis: hit.object.name as TransformControls["axis"], distance: hit.distance };
        // Edge-on rotation rings project across arrows; arrows win that overlap.
        if (control.mode === "translate") break;
      }
    }
    for (const control of controls)
      control.axis = nearest?.control === control ? nearest.axis : null;
    return nearest !== null;
  }

  return {
    helper,
    controls,
    get active() { return active; },
    attach(object: THREE.Object3D) {
      for (const control of controls)
        if (control.object !== object) control.attach(object);
    },
    detach() {
      this.reset();
      for (const control of controls) control.detach();
    },
    hover,
    clearHover() {
      if (!active) for (const control of controls) control.axis = null;
    },
    down(pointer: Pointer) {
      if (active) return true;
      if (pointer.button !== 0 || !hover(pointer)) return false;
      active = controls.find(control => control.axis !== null) ?? null;
      helper.updateMatrixWorld(true);
      active?.pointerDown(pointer as PointerEvent);
      if (!active?.dragging) active = null;
      return active !== null;
    },
    move(pointer: Pointer) {
      if (!active) return false;
      helper.updateMatrixWorld(true);
      active.pointerMove(pointer as PointerEvent);
      return true;
    },
    up() {
      const owner = active;
      active = null;
      owner?.pointerUp(null);
    },
    reset() {
      const owner = active;
      active = null;
      owner?.reset();
      owner?.pointerUp(null);
      for (const control of controls) control.axis = null;
    },
    dispose() {
      active = null;
      helper.removeFromParent();
      for (const control of controls) control.dispose();
      element.style.touchAction = touchAction;
    },
  };
}
