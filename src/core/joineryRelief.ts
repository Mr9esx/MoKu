import ClipperLib from "clipper-lib";
import { contourDistance, contoursOverlap, pointInPolygon, pointSegmentDistance, polygonArea, signedArea, validContour } from "./geometry";
import type { Part, Point } from "./types";

export type ReliefInput = {
  target: string;
  corners: number[];
  diameter: number;
  style: "dogbone" | "tbone";
  direction: "long" | "short";
};
export type ReliefCorner = { index: number; point: Point; previous: Point; next: Point };
export type ReliefTarget = { id: string; label: string; points: Point[]; corners: ReliefCorner[] };
export type ReliefCircle = { corner: number; center: Point; radius: number; points: Point[] };
const SCALE = 100000;
const EPS = 1e-5;

/** Only straight right angles are offered; sampled curves are not corner candidates. */
export function reliefTargets(part: Part): ReliefTarget[] {
  const contours = [
    { id: "outline", label: "开口槽 · 外轮廓内角", points: part.outline },
    ...part.holes.map((points, i) => ({ id: `hole:${i}`, label: `通孔 ${i + 1}`, points })),
    ...part.pockets.map((p, i) => ({ id: `pocket:${i}`, label: `铣槽 ${i + 1} · 深 ${p.depth ?? "未知"} mm`, points: p.outline })),
  ];
  return contours.map(target => {
    const winding = Math.sign(signedArea(target.points));
    const corners = target.points.flatMap((v, index): ReliefCorner[] => {
      const previous = target.points[(index + target.points.length - 1) % target.points.length];
      const next = target.points[(index + 1) % target.points.length];
      const ax = previous.x - v.x, ay = previous.y - v.y, bx = next.x - v.x, by = next.y - v.y;
      const a = Math.hypot(ax, ay), b = Math.hypot(bx, by);
      if (a < EPS || b < EPS || Math.abs((ax * bx + ay * by) / (a * b)) > 1e-5) return [];
      const turn = (-ax * by + ay * bx) * winding;
      if (target.id === "outline" ? turn >= -EPS : turn <= EPS) return [];
      return [{ index, point: v, previous, next }];
    });
    return { ...target, corners };
  }).filter(target => target.corners.length);
}

function reliefCircle(corner: ReliefCorner, input: ReliefInput): ReliefCircle {
  const v = corner.point, r = input.diameter / 2;
  const a = Math.hypot(corner.previous.x - v.x, corner.previous.y - v.y);
  const b = Math.hypot(corner.next.x - v.x, corner.next.y - v.y);
  let dx: number, dy: number;
  if (input.style === "dogbone") {
    dx = (corner.previous.x - v.x) / a + (corner.next.x - v.x) / b;
    dy = (corner.previous.y - v.y) / a + (corner.next.y - v.y) / b;
    const length = Math.hypot(dx, dy); dx /= length; dy /= length;
  } else {
    const alongPrevious = input.direction === "long" ? a > b : a <= b;
    const edge = alongPrevious ? corner.previous : corner.next;
    const length = alongPrevious ? a : b;
    dx = (edge.x - v.x) / length; dy = (edge.y - v.y) / length;
  }
  const center = { x: v.x + dx * r, y: v.y + dy * r };
  // Align a sample with the original vertex, retaining the exact corner in the arc.
  const phase = Math.atan2(v.y - center.y, v.x - center.x);
  const count = Math.max(32, 8 * Math.ceil(Math.PI / Math.acos(1 - Math.min(0.005, r / 4) / r) / 8));
  const points = Array.from({ length: count }, (_, i) => {
    const angle = phase + i * 2 * Math.PI / count;
    return i === 0 ? { ...v } : { x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r };
  });
  return { corner: corner.index, center, radius: r, points };
}

const integerPath = (points: Point[]) => points.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
const contained = (inner: Point[], outer: Point[]) => inner.every(p => pointInPolygon(p, outer, true)) && contourDistance(inner, outer) > EPS;
function pocketWithinPart(inner: Point[], outer: Point[]) {
  const clipper = new ClipperLib.Clipper();
  clipper.AddPath(integerPath(inner), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPath(integerPath(outer), ClipperLib.PolyType.ptClip, true);
  const outside: ClipperLib.Paths = [];
  clipper.Execute(ClipperLib.ClipType.ctDifference, outside, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return outside.length === 0;
}

/** Build a preview without changing the part. The store repeats this validation at commit. */
export function previewRelief(part: Part, input: ReliefInput): { part: Part; circles: ReliefCircle[] } {
  if (!Number.isFinite(input.diameter) || input.diameter < 0.1 || input.diameter > 100) throw Error("刀具直径需为 0.1–100 mm");
  if (!["dogbone", "tbone"].includes(input.style) || !["long", "short"].includes(input.direction)) throw Error("请选择清角样式与方向");
  const target = reliefTargets(part).find(t => t.id === input.target);
  if (!target || !input.corners.length || new Set(input.corners).size !== input.corners.length || input.corners.length > 128) throw Error("请选择有效的清角角点（最多 128 个）");
  if (!validContour(target.points) || target.points.some(p => Math.abs(p.x * SCALE) > 1e14 || Math.abs(p.y * SCALE) > 1e14)) throw Error("加工轮廓无效或尺寸超出范围");
  const circles = input.corners.map(index => {
    const corner = target.corners.find(c => c.index === index);
    if (!corner) throw Error("角点已改变，请重新选择清角位置");
    const available = Math.min(Math.hypot(corner.previous.x - corner.point.x, corner.previous.y - corner.point.y),
      Math.hypot(corner.next.x - corner.point.x, corner.next.y - corner.point.y));
    if (input.diameter > available + EPS) throw Error("刀具直径大于角点相邻边的局部尺寸，请减小直径");
    const circle = reliefCircle(corner, input);
    const inside = pointInPolygon(circle.center, target.points, target.id === "outline");
    if (target.id === "outline" ? inside : !inside) throw Error("角点附近空间不足，请减小刀具直径");
    for (let i = 0; i < target.points.length; i++) {
      if (i === index || (i + 1) % target.points.length === index) continue;
      if (pointSegmentDistance(circle.center, target.points[i], target.points[(i + 1) % target.points.length]) <= circle.radius + EPS)
        throw Error("刀具尺寸超出局部空间，会切到其他边，请减小直径");
    }
    return circle;
  });
  const clipper = new ClipperLib.Clipper();
  clipper.AddPath(integerPath(target.points), ClipperLib.PolyType.ptSubject, true);
  clipper.AddPaths(circles.map(c => integerPath(c.points)), ClipperLib.PolyType.ptClip, true);
  const paths: ClipperLib.Paths = [];
  clipper.Execute(target.id === "outline" ? ClipperLib.ClipType.ctDifference : ClipperLib.ClipType.ctUnion,
    paths, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  if (paths.length !== 1) throw Error("清角会使零件断开或产生多个边界，请减小刀具直径");
  const points = paths[0].map(p => ({ x: p.X / SCALE, y: p.Y / SCALE }));
  if (points.length > 4096 || !validContour(points)) throw Error("清角后的加工轮廓自交或过于复杂，请减少角点");
  if (Math.sign(signedArea(points)) !== Math.sign(signedArea(target.points))) points.reverse();
  const next = structuredClone(part);
  if (target.id === "outline") { next.outline = points; next.area = polygonArea(points); }
  else if (target.id.startsWith("hole:")) next.holes[Number(target.id.split(":")[1])] = points;
  else {
    const i = Number(target.id.split(":")[1]);
    next.pockets[i] = { outline: points, depth: part.pockets[i].depth };
  }
  const features = [
    ...next.holes.map((points, i) => ({ id: `hole:${i}`, kind: "hole", points })),
    ...next.pockets.map((p, i) => ({ id: `pocket:${i}`, kind: "pocket", points: p.outline })),
  ];
  for (const feature of features) {
    if (target.id !== "outline" && feature.id !== target.id) continue;
    if (!(feature.kind === "pocket" ? pocketWithinPart(feature.points, next.outline) : contained(feature.points, next.outline)))
      throw Error("清角会切穿零件外轮廓或碰到板边，请减小刀具直径");
  }
  const changed = features.find(f => f.id === target.id);
  if (changed) for (const other of features.filter(f => f.id !== changed.id)) {
    if (!contoursOverlap(changed.points, other.points) && contourDistance(changed.points, other.points) > EPS) continue;
    // A through-hole fully within a pocket remains a supported counterbore.
    const nested = changed.kind !== other.kind && (contained(changed.points, other.points) || contained(other.points, changed.points));
    if (!nested) throw Error("清角会与其他加工区域相交，请减小刀具直径或取消相邻角点");
  }
  return { part: next, circles };
}
