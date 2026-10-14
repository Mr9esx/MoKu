import type { Part, Project } from "./types";
import { geometrySignature, rotationFromEuler } from "./assemblyGeometry";
import { emptyAssembly } from "./assemblyTypes";
const rectangle = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
export function createAssemblyDemo(): Project {
  const base: Part = {
    id: "assembly-base",
    name: "带槽底板",
    stockId: "",
    layer: "示例",
    material: "多层板",
    thickness: 12,
    width: 120,
    height: 120,
    area: 14400,
    outline: rectangle(0, 0, 120, 120),
    holes: [],
    pockets: [{ outline: rectangle(53.8, 20, 12.4, 80), depth: 6 }],
    label: { x: 60, y: 60 },
  };
  const insert: Part = {
    id: "assembly-insert",
    name: "竖向插板",
    stockId: "",
    layer: "示例",
    material: "多层板",
    thickness: 12,
    width: 60,
    height: 80,
    area: 4800,
    outline: rectangle(0, 0, 60, 80),
    holes: [],
    pockets: [],
    label: { x: 30, y: 40 },
  };
  const assembly = emptyAssembly();
  assembly.items = [
    {
      partId: base.id,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      locked: true,
    },
    {
      partId: insert.id,
      position: { x: 70.4, y: 20, z: 6 },
      rotation: rotationFromEuler({ x: 0, y: -90, z: 0 }),
    },
  ];
  assembly.pocketFaces[base.id] = {
    signature: geometrySignature(base),
    faces: { 0: "front" },
  };
  assembly.targets = { width: 120, depth: 120, height: 66, tolerance: 0.5 };
  assembly.fits = [
    {
      id: "assembly-example-fit",
      partId: insert.id,
      receiverId: base.id,
      feature: { kind: "pocket", index: 0 },
      maleEdge: 3,
      insertionDepth: 6,
      minClearance: 0.2,
      maxClearance: 0.6,
      partSignature: geometrySignature(insert),
      receiverSignature: geometrySignature(base),
    },
  ];
  assembly.steps = [
    { partId: base.id, direction: { x: 0, y: 0, z: 1 }, distance: 150 },
    { partId: insert.id, direction: { x: 0, y: 0, z: -1 }, distance: 100 },
  ];
  return {
    name: "组装示例",
    units: "mm",
    sheets: [],
    parts: [base, insert],
    original: { sheets: [], placements: [] },
    warnings: [],
    assembly,
  };
}
