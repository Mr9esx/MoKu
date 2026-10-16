import { MOUSE, TOUCH, type PerspectiveCamera } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createAssemblyCameraControls(camera: PerspectiveCamera, element: HTMLElement) {
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = false;
  controls.mouseButtons = { LEFT: MOUSE.PAN, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE };
  controls.touches = { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE };
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  return controls;
}
