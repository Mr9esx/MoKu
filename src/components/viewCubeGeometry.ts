import { Matrix4, Quaternion, Vector3 } from "three";
import type { Rotation3, Vec3 } from "../core/assemblyTypes";

const vector = (v: Vec3) => new Vector3(v.x, v.y, v.z);
export const cubeFaces = [
  { label: "右", normal: { x: 1, y: 0, z: 0 } },
  { label: "左", normal: { x: -1, y: 0, z: 0 } },
  { label: "后", normal: { x: 0, y: 1, z: 0 } },
  { label: "前", normal: { x: 0, y: -1, z: 0 } },
  { label: "上", normal: { x: 0, y: 0, z: 1 } },
  { label: "下", normal: { x: 0, y: 0, z: -1 } },
];
export type CubeZone = {
  id: string;
  label: string;
  kind: "face" | "edge" | "corner";
  direction: Vec3;
};
const zones: CubeZone[] = [];
for (const x of [-1, 0, 1])
  for (const y of [-1, 0, 1])
    for (const z of [-1, 0, 1]) {
      const count = Number(!!x) + Number(!!y) + Number(!!z);
      if (!count) continue;
      const length = Math.hypot(x, y, z),
        kind = count === 1 ? "face" : count === 2 ? "edge" : "corner";
      const label =
        (x ? (x > 0 ? "右" : "左") : "") +
        (y ? (y > 0 ? "后" : "前") : "") +
        (z ? (z > 0 ? "上" : "下") : "") +
        (count === 1 ? "视图" : count === 2 ? "边视图" : "角视图");
      zones.push({
        id: [x, y, z].join(","),
        label,
        kind,
        direction: { x: x / length, y: y / length, z: z / length },
      });
    }
export const cubeZones = () => zones;

/** Camera looks toward the origin; a tiny pole offset retains a stable Z-up azimuth. */
export function viewQuaternion(direction: Vec3) {
  const eye = vector(direction).normalize();
  if (Math.hypot(eye.x, eye.y) < 1e-10) {
    eye.y = -1e-6;
    eye.normalize();
  }
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().lookAt(eye, new Vector3(), new Vector3(0, 0, 1)),
  );
}
/** Interpolate the shortest azimuth with a stable world up, including near the poles. */
export function interpolateViewQuaternion(
  from: Rotation3,
  to: Rotation3,
  t: number,
) {
  const direction = (q: Rotation3) =>
    new Vector3(0, 0, 1).applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w));
  const a = direction(from),
    b = direction(to);
  const azimuth = Math.atan2(a.x, -a.y), end = Math.atan2(b.x, -b.y);
  const theta =
    azimuth + Math.atan2(Math.sin(end - azimuth), Math.cos(end - azimuth)) * t;
  const startPolar = Math.acos(Math.max(-1, Math.min(1, a.z)));
  const phi =
    startPolar + (Math.acos(Math.max(-1, Math.min(1, b.z))) - startPolar) * t;
  return viewQuaternion({
    x: Math.sin(phi) * Math.sin(theta),
    y: -Math.sin(phi) * Math.cos(theta),
    z: Math.cos(phi),
  });
}
export function orientationPosition(
  q: Rotation3,
  target: Vec3,
  radius: number,
) {
  return new Vector3(0, 0, radius)
    .applyQuaternion(new Quaternion(q.x, q.y, q.z, q.w))
    .add(vector(target));
}
export type CubePoint = { x: number; y: number };
export type ProjectedCubeFace = {
  label: string;
  normal: Vec3;
  polygon: CubePoint[];
  textTransform: [number, number, number, number, number, number];
  cells: { zone: CubeZone; polygon: CubePoint[] }[];
};
export function projectCube(orientation: Rotation3): ProjectedCubeFace[] {
  const inverse = new Quaternion(
    orientation.x,
    orientation.y,
    orientation.z,
    orientation.w,
  ).invert();
  const project = (point: Vector3) => {
    const p = point.clone().applyQuaternion(inverse);
    return { x: 56 + p.x * 62, y: 56 - p.y * 62 };
  };
  return cubeFaces.flatMap((face) => {
    const normal = vector(face.normal);
    if (normal.clone().applyQuaternion(inverse).z <= 1e-4) return [];
    const up =
      Math.abs(normal.z) > 0.5
        ? new Vector3(0, normal.z, 0)
        : new Vector3(0, 0, 1);
    const right = up.clone().cross(normal),
      center = normal.clone().multiplyScalar(0.5);
    const point = (u: number, v: number) =>
      project(center.clone().addScaledVector(right, u).addScaledVector(up, v));
    const polygon = (a: number, b: number, c: number, d: number) => [
      point(a, c),
      point(b, c),
      point(b, d),
      point(a, d),
    ];
    const p = point(0, 0),
      u = point(1, 0),
      v = point(0, -1);
    const cuts = [-0.5, -0.33, 0.33, 0.5],
      cells: ProjectedCubeFace["cells"] = [];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        const raw = normal
          .clone()
          .addScaledVector(right, i - 1)
          .addScaledVector(up, j - 1);
        const zone = zones.find(
          (z) => z.id === [raw.x, raw.y, raw.z].join(","),
        )!;
        cells.push({
          zone,
          polygon: polygon(cuts[i], cuts[i + 1], cuts[j], cuts[j + 1]),
        });
      }
    return [
      {
        ...face,
        polygon: polygon(-0.5, 0.5, -0.5, 0.5),
        textTransform: [u.x - p.x, u.y - p.y, v.x - p.x, v.y - p.y, p.x, p.y],
        cells,
      },
    ];
  });
}
