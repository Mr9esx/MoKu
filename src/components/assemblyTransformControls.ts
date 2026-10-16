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
  const handles = controls.map(control => {
    const gizmo = control.getHelper().children.find(
      child => child instanceof TransformControlsGizmo,
    ) as TransformControlsGizmo;
    return { control, picker: gizmo.picker[control.mode], visible: gizmo.gizmo[control.mode] };
  });
  const [translation, rotation] = handles;
  const rings = rotation.visible.children.filter(handle => /^[XYZ]$/.test(handle.name)).map(handle => {
    // Keep the inner radius compact, but give the arc a clearly visible stroke.
    const mesh = handle as THREE.Mesh;
    const geometry = new THREE.TorusGeometry(0.5, 0.0225, 8, 64, Math.PI);
    geometry.rotateY(Math.PI / 2);
    geometry.rotateX(Math.PI / 2);
    if (handle.name === "Y") geometry.rotateZ(-Math.PI / 2);
    if (handle.name === "Z") geometry.rotateY(Math.PI / 2);
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    const points = Array.from({ length: 65 }, (_, i) => {
      const angle = i / 64 * Math.PI, c = Math.cos(angle) * 0.5, s = Math.sin(angle) * 0.5;
      return handle.name === "X" ? new THREE.Vector3(0, c, s)
        : handle.name === "Y" ? new THREE.Vector3(c, 0, s) : new THREE.Vector3(s, c, 0);
    });
    return { handle, points };
  });
  const ray = new THREE.Raycaster(), coordinates = new THREE.Vector2();
  const projected = new THREE.Vector3();
  let active: TransformControls | null = null;
  let rotationDrag: ReturnType<typeof beginRotation> = null;

  function beginRotation(pointer: Pointer) {
    if (!active?.object || active.mode !== "rotate" || !/^[XYZ]$/.test(active.axis ?? "")) return null;
    const { width, height } = element.getBoundingClientRect();
    const pixels = (point: THREE.Vector3) => {
      projected.copy(point).project(camera);
      return new THREE.Vector2(projected.x * width / 2, projected.y * height / 2);
    };
    const normal = new THREE.Vector3(active.axis === "X" ? 1 : 0, active.axis === "Y" ? 1 : 0, active.axis === "Z" ? 1 : 0);
    const center = active.object.getWorldPosition(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);
    ray.setFromCamera(coordinates.set(pointer.x, pointer.y), camera);
    const point = ray.ray.intersectPlane(plane, new THREE.Vector3());
    const inPlane = Math.abs(ray.ray.direction.dot(normal)) > 0.2 && point !== null && point.distanceToSquared(center) > 1e-8;
    const start = new THREE.Vector2(pointer.x * width / 2, pointer.y * height / 2);
    const ring = rings.find(ring => ring.handle.name === active!.axis)!;
    let nearest = Infinity, radius = 1, closestIndex = 0;
    const closest = new THREE.Vector3(), centerScreen = pixels(center);
    for (const [index, local] of ring.points.entries()) {
      const world = local.clone().applyMatrix4(ring.handle.matrixWorld), screen = pixels(world);
      radius = Math.max(radius, screen.distanceTo(centerScreen));
      const distance = screen.distanceToSquared(start);
      if (distance < nearest) { nearest = distance; closest.copy(world); closestIndex = index; }
    }
    const tangent = normal.clone().cross(closest.clone().sub(center)).normalize();
    const screenTangent = pixels(closest.clone().add(tangent)).sub(pixels(closest));
    if (screenTangent.lengthSq() < 1e-8) {
      // At a projected endpoint the analytic tangent points into the camera.
      const step = closestIndex < ring.points.length - 1 ? 1 : -1;
      const neighbor = ring.points[closestIndex + step].clone().applyMatrix4(ring.handle.matrixWorld);
      screenTangent.copy(pixels(neighbor).sub(pixels(closest))).multiplyScalar(step * (active.axis === "X" ? 1 : -1));
    }
    screenTangent.normalize();
    return {
      width, height, normal, center, plane, inPlane, start, radius, screenTangent,
      previous: point?.sub(center).normalize() ?? new THREE.Vector3(),
      angle: 0,
      original: active.object.quaternion.clone(),
      parentInverse: active.object.parent?.getWorldQuaternion(new THREE.Quaternion()).invert() ?? new THREE.Quaternion(),
    };
  }

  function moveRotation(pointer: Pointer) {
    const drag = rotationDrag;
    if (!drag || !active?.object) return;
    if (drag.inPlane) {
      ray.setFromCamera(coordinates.set(pointer.x, pointer.y), camera);
      const point = ray.ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!point || point.distanceToSquared(drag.center) < 1e-8) return;
      const next = point.sub(drag.center).normalize();
      drag.angle += Math.atan2(drag.normal.dot(drag.previous.clone().cross(next)), drag.previous.dot(next));
      drag.previous.copy(next);
    } else {
      // An edge-on ring collapses to a line: use its projected tangent and radius.
      const delta = new THREE.Vector2(pointer.x * drag.width / 2, pointer.y * drag.height / 2).sub(drag.start);
      drag.angle = delta.dot(drag.screenTangent) / drag.radius;
    }
    const angle = active.rotationSnap ? Math.round(drag.angle / active.rotationSnap) * active.rotationSnap : drag.angle;
    const localAxis = drag.normal.clone().applyQuaternion(drag.parentInverse);
    active.object.quaternion.setFromAxisAngle(localAxis, angle).multiply(drag.original).normalize();
    active.dispatchEvent({ type: "change" });
    active.dispatchEvent({ type: "objectChange" });
  }

  function nearbyRing(pointer: Pointer) {
    const { width, height } = element.getBoundingClientRect();
    if (!width || !height) return null;
    const x = pointer.x * width / 2, y = pointer.y * height / 2;
    let axis: TransformControls["axis"] = null, nearest = 6 * 6;
    for (const { handle, points } of rings) {
      if (!handle.visible) continue;
      let previous: { x: number; y: number } | null = null;
      for (const point of points) {
        projected.copy(point).applyMatrix4(handle.matrixWorld).project(camera);
        if (projected.z < -1 || projected.z > 1) { previous = null; continue; }
        const next = { x: projected.x * width / 2, y: projected.y * height / 2 };
        if (previous) {
          const dx = next.x - previous.x, dy = next.y - previous.y;
          const t = THREE.MathUtils.clamp(((x - previous.x) * dx + (y - previous.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
          const distance = (x - previous.x - t * dx) ** 2 + (y - previous.y - t * dy) ** 2;
          if (distance < nearest) { nearest = distance; axis = handle.name as TransformControls["axis"]; }
        }
        previous = next;
      }
    }
    return axis;
  }

  function hover(pointer: Pointer) {
    if (active) return true;
    helper.updateMatrixWorld(true);
    ray.setFromCamera(coordinates.set(pointer.x, pointer.y), camera);
    let nearest: { control: TransformControls; axis: TransformControls["axis"] } | null = null;
    const canTranslate = translation.control.object && translation.control.enabled;
    // Exact arrow hits win crossings, but their broad invisible cones cannot cover the rings.
    const arrow = canTranslate && ray.intersectObject(translation.visible, true).find(hit => hit.object.visible);
    if (arrow) nearest = { control: translation.control, axis: arrow.object.name as TransformControls["axis"] };
    if (!nearest && rotation.control.object && rotation.control.enabled) {
      const axis = nearbyRing(pointer);
      if (axis) nearest = { control: rotation.control, axis };
    }
    if (!nearest && canTranslate) {
      const hit = ray.intersectObject(translation.picker, true).find(hit => hit.object.visible);
      if (hit) nearest = { control: translation.control, axis: hit.object.name as TransformControls["axis"] };
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
      rotationDrag = beginRotation(pointer);
      return active !== null;
    },
    move(pointer: Pointer) {
      if (!active) return false;
      helper.updateMatrixWorld(true);
      if (rotationDrag) moveRotation(pointer);
      else active.pointerMove(pointer as PointerEvent);
      return true;
    },
    up() {
      const owner = active;
      active = null;
      rotationDrag = null;
      owner?.pointerUp(null);
    },
    reset() {
      const owner = active;
      active = null;
      rotationDrag = null;
      owner?.reset();
      owner?.pointerUp(null);
      for (const control of controls) control.axis = null;
    },
    dispose() {
      active = null;
      rotationDrag = null;
      helper.removeFromParent();
      for (const control of controls) control.dispose();
      element.style.touchAction = touchAction;
    },
  };
}
