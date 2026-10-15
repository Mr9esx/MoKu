import { expect, it } from "vitest";
import { PerspectiveCamera, Box3, Vector3 } from "three";
import { assemblyContextAnchor, positionAssemblyActions } from "../src/components/assemblySceneUtils";

const camera = () => {
  const value = new PerspectiveCamera(45, 1, 0.1, 100);
  value.position.set(0, 0, 10);
  value.lookAt(0, 0, 0);
  value.updateMatrixWorld();
  return value;
};
it("follows a selected part when its projected position changes", () => {
  const view = camera();
  const a = assemblyContextAnchor(new Box3(new Vector3(-1,-1,0),new Vector3(1,1,1)), view, { width: 800, height: 600 });
  const b = assemblyContextAnchor(new Box3(new Vector3(1,-1,0),new Vector3(3,1,1)), view, { width: 800, height: 600 });
  expect(a?.x).toBeCloseTo(400);
  expect(b!.x).toBeGreaterThan(a!.x);
  expect(a!.y).toBeLessThan(300);
});
it("keeps the controls inside the viewport when a part approaches an edge", () => {
  const view = camera();
  const point = assemblyContextAnchor(new Box3(new Vector3(3,3,0),new Vector3(4,4,1)),view,{width:400,height:300});
  expect(point!.x).toBeLessThanOrEqual(260);
  expect(point!.y).toBeGreaterThanOrEqual(32);
});
it("hides controls for parts behind the camera, outside the view, or a collapsed viewport", () => {
  const view = camera();
  expect(assemblyContextAnchor(new Box3(new Vector3(-1,-1,11),new Vector3(1,1,12)),view,{width:800,height:600})).toBeNull();
  expect(assemblyContextAnchor(new Box3(new Vector3(100,0,0),new Vector3(101,1,1)),view,{width:800,height:600})).toBeNull();
  expect(assemblyContextAnchor(new Box3(new Vector3(0,0,0),new Vector3(1,1,1)),view,{width:0,height:0})).toBeNull();
});
it("keeps a multiline confirmation strip visible at the top and right edges", () => {
  expect(positionAssemblyActions({ x: 390, y: 32 }, { width: 400, height: 300 }, { width: 240, height: 110 })).toEqual({ left: 148, top: 12 });
  expect(positionAssemblyActions({ x: 200, y: 250 }, { width: 400, height: 300 }, { width: 240, height: 110 })).toEqual({ left: 80, top: 140 });
});
