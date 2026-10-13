import ClipperLib from "clipper-lib";
import type {Point, Part} from "./types";
import { bounds, pointInPolygon, pointSegmentDistance, contoursOverlap } from "./geometry";
const fail = (message:string):never=>{throw Error(message)};
const rounded=(p:Point):Point=>({x:Math.round(p.x*1e6)/1e6,y:Math.round(p.y*1e6)/1e6});
export function nearInside(p: Point, poly: Point[]) {
  return (
    pointInPolygon(p, poly) ||
    poly.some(
      (v, i) => pointSegmentDistance(p, v, poly[(i + 1) % poly.length]) <= 0.05,
    )
  );
}
// Ownership tolerates only the thin mismatch caused by independent arc sampling.
// Subtracting a buffered parent tests every point along feature edges and interiors,
// including diagonals crossing concave cutouts; vertex containment alone cannot.
const OWNERSHIP_TOLERANCE = 0.05;
const CLIP_SCALE = 1e6;
export function containsFeature(feature: Point[], parent: Point[]) {
  if (!feature.every((point) => nearInside(point, parent))) return false;
  const toPath = (points: Point[]) =>
    points.map((point) => ({
      X: Math.round(point.x * CLIP_SCALE),
      Y: Math.round(point.y * CLIP_SCALE),
    }));
  const parentPath = toPath(parent);
  if (!ClipperLib.Clipper.Orientation(parentPath)) parentPath.reverse();
  const offset = new ClipperLib.ClipperOffset(2, 0.001 * CLIP_SCALE);
  offset.AddPath(
    parentPath,
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon,
  );
  const buffered: ClipperLib.Paths = [];
  offset.Execute(buffered, OWNERSHIP_TOLERANCE * CLIP_SCALE);
  const clipper = new ClipperLib.Clipper();
  clipper.AddPath(toPath(feature), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(buffered, ClipperLib.PolyType.ptClip, true);
  const outside: ClipperLib.Paths = [];
  clipper.Execute(
    ClipperLib.ClipType.ctDifference,
    outside,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero,
  );
  return outside.length === 0;
}

export function stockAxes(poly: Point[]) {
  let vertices = poly.slice();
  let changed = true;
  while (changed && vertices.length > 4) {
    changed = false;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[(i + vertices.length - 1) % vertices.length],
        b = vertices[i],
        c = vertices[(i + 1) % vertices.length];
      if (
        Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 1e-5
      ) {
        vertices.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  if (vertices.length !== 4) fail("板框必须为真实正交矩形");
  const a = vertices[0],
    b = vertices[1],
    c = vertices[2],
    d = vertices[3],
    u = { x: b.x - a.x, y: b.y - a.y },
    v = { x: d.x - a.x, y: d.y - a.y };
  const lu = Math.hypot(u.x, u.y),
    lv = Math.hypot(v.x, v.y);
  if (
    lu <= 0 ||
    lv <= 0 ||
    Math.abs(u.x * v.x + u.y * v.y) > lu * lv * 1e-7 ||
    Math.hypot(c.x - b.x - d.x + a.x, c.y - b.y - d.y + a.y) > 0.001
  )
    fail("板框必须为真实正交矩形");
  let xAxis = lu <= lv ? u : v,
    yAxis = lu <= lv ? v : u,
    width = Math.min(lu, lv),
    height = Math.max(lu, lv);
  xAxis = { x: xAxis.x / width, y: xAxis.y / width };
  yAxis = { x: yAxis.x / height, y: yAxis.y / height }; // Choose positive handed local coordinates.
  if (xAxis.x * yAxis.y - xAxis.y * yAxis.x < 0)
    yAxis = { x: -yAxis.x, y: -yAxis.y };
  const projected = vertices.map((p) => ({
      x: p.x * xAxis.x + p.y * xAxis.y,
      y: p.x * yAxis.x + p.y * yAxis.y,
    })),
    origin = bounds(projected);
  return {
    width: Math.round(width * 1e6) / 1e6,
    height: Math.round(height * 1e6) / 1e6,
    toLocal: (p: Point) =>
      rounded({
        x: p.x * xAxis.x + p.y * xAxis.y - origin.minX,
        y: p.x * yAxis.x + p.y * yAxis.y - origin.minY,
      }),
  };
}
export function validateHoles(parts: Part[]) {
  for (const part of parts)
    for (let i = 0; i < part.holes.length; i++)
      for (let j = i + 1; j < part.holes.length; j++)
        if (contoursOverlap(part.holes[i], part.holes[j]))
          fail(`${part.name} 通孔轮廓相交或重叠，请合并或修正后导入`);
}
