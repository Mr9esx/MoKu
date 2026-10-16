import ClipperLib from "clipper-lib";
import { bounds, contourDistance, contoursOverlap, pointInPolygon, pointSegmentDistance, polygonArea, signedArea, validContour } from "./geometry";
import type { Part, Point } from "./types";

export type ReliefInput = {
  target: string;
  corners: number[];
  diameter: number;
  style: "dogbone" | "tbone";
  direction: "long" | "short";
};
export type ReliefCorner = { index: number; point: Point; previous: Point; next: Point; fillet?: { end: number; radius: number } };
export type ReliefTarget = { id: string; label: string; points: Point[]; corners: ReliefCorner[] };
export type ReliefCircle = { corner: number; center: Point; radius: number; points: Point[] };
const SCALE = 100000;
const EPS = 1e-5;

function straightSide(points: Point[], index: number, step: 1 | -1) {
  const n = points.length, origin = points[index];
  let end = (index + step + n) % n;
  const dx = points[end].x - origin.x, dy = points[end].y - origin.y, length = Math.hypot(dx, dy);
  const edges = [step === 1 ? index : end];
  if (length > EPS) for (let count = 1; count < n - 1; count++) {
    const next = (end + step + n) % n, point = points[next];
    const cross = Math.abs((point.x-origin.x)*dy-(point.y-origin.y)*dx)/length;
    const forward = (point.x-points[end].x)*dx+(point.y-points[end].y)*dy;
    if (next === index || cross > EPS || forward <= EPS*length) break;
    edges.push(step === 1 ? end : next); end = next;
  }
  return { point: points[end], edges };
}

function isInnerCorner(v: Point, previous: Point, next: Point, winding: number, outline: boolean) {
  const ax=previous.x-v.x, ay=previous.y-v.y, bx=next.x-v.x, by=next.y-v.y;
  const length=Math.hypot(ax,ay)*Math.hypot(bx,by);
  if (length < EPS*EPS || Math.abs((ax*bx+ay*by)/length) > 1e-5) return false;
  const turn=(-ax*by+ay*bx)*winding/length;
  return outline ? turn < -EPS : turn > EPS;
}

/** Recover a right-angle fillet only when a circular quarter arc joins two tangent straight sides.
 * Semicircular slot ends, circles, ellipses and existing dogbone/T-bone arcs do not satisfy this. */
function circleThrough(a: Point, b: Point, c: Point) {
  const bx=b.x-a.x, by=b.y-a.y, cx=c.x-a.x, cy=c.y-a.y, d=2*(bx*cy-by*cx);
  if (Math.abs(d)<1e-12) return;
  const bb=bx*bx+by*by, cc=cx*cx+cy*cy;
  const center={x:a.x+(cy*bb-by*cc)/d,y:a.y+(bx*cc-cx*bb)/d};
  const radius=Math.hypot(a.x-center.x,a.y-center.y);
  return {center,radius};
}

function roundedCorner(points: Point[], index: number, extent: number): ReliefCorner | undefined {
  const n=points.length, a=points[index];
  const initial=circleThrough(a,points[(index+1)%n],points[(index+2)%n]);
  if (!initial) return;
  const {center,radius}=initial;
  if (!Number.isFinite(radius) || radius<EPS || radius>extent+EPS) return;
  const previous=straightSide(points,index,-1).point;
  const ix=a.x-previous.x, iy=a.y-previous.y, incoming=Math.hypot(ix,iy);
  const angleTolerance=1e-4, scanTolerance=1e-3, fitTolerance=Math.max(0.002,radius*1e-5);
  if (incoming<EPS || Math.abs(ix*(a.x-center.x)+iy*(a.y-center.y))/(incoming*radius)>scanTolerance) return;
  let sweep=0, last=a, direction=0;
  for (let offset=1;offset<n-1;offset++) {
    const end=(index+offset)%n, point=points[end];
    if (Math.abs(Math.hypot(point.x-center.x,point.y-center.y)-radius)>fitTolerance) return;
    const lx=last.x-center.x, ly=last.y-center.y, px=point.x-center.x, py=point.y-center.y;
    const delta=Math.atan2(lx*py-ly*px,lx*px+ly*py);
    if (!direction) direction=Math.sign(delta);
    if (delta*direction<=0) return;
    sweep+=delta; last=point;
    if (Math.abs(sweep)>Math.PI/2+scanTolerance) return;
    if (offset<2 || Math.abs(Math.abs(sweep)-Math.PI/2)>scanTolerance) continue;
    // Widely separated samples avoid amplifying the integer rounding from a previous edit.
    const fitted=circleThrough(a,points[(index+Math.floor(offset/2))%n],point);
    if (!fitted) return;
    const fc=fitted.center, fr=fitted.radius, radialTolerance=Math.max(5e-5,fr*1e-5);
    for (let k=0;k<=offset;k++) {
      const sample=points[(index+k)%n];
      if (Math.abs(Math.hypot(sample.x-fc.x,sample.y-fc.y)-fr)>radialTolerance) return;
    }
    const sx=a.x-fc.x, sy=a.y-fc.y, ex=point.x-fc.x, ey=point.y-fc.y;
    if (Math.abs(Math.abs(Math.atan2(sx*ey-sy*ex,sx*ex+sy*ey))-Math.PI/2)>angleTolerance
      || Math.abs(ix*sx+iy*sy)/(incoming*fr)>angleTolerance) return;
    const next=straightSide(points,end,1).point;
    const ox=next.x-point.x, oy=next.y-point.y, outgoing=Math.hypot(ox,oy);
    if (outgoing<EPS || Math.abs(ox*ex+oy*ey)/(outgoing*fr)>angleTolerance) return;
    const denominator=ix*oy-iy*ox;
    if (Math.abs(denominator)<EPS*incoming*outgoing) return;
    const t=((point.x-a.x)*oy-(point.y-a.y)*ox)/denominator;
    return {index,point:{x:a.x+t*ix,y:a.y+t*iy},previous,next,fillet:{end,radius:fr}};
  }
}

/** All machining contours remain selectable, even when they have no relief candidates. */
export function reliefContours(part: Part): ReliefTarget[] {
  const contours = [
    { id: "outline", label: "外轮廓", points: part.outline },
    ...part.holes.map((points, i) => {
      const size=bounds(points);
      return { id: `hole:${i}`, label: `通孔 ${i + 1} · ${size.width.toFixed(1)} × ${size.height.toFixed(1)} mm`, points };
    }),
    ...part.pockets.map((p, i) => ({ id: `pocket:${i}`, label: `铣槽 ${i + 1} · 深 ${p.depth ?? "未知"} mm`, points: p.outline })),
  ];
  return contours.map(target => {
    const winding = Math.sign(signedArea(target.points)), size=bounds(target.points);
    const corners = target.points.flatMap((v, index): ReliefCorner[] => {
      const previous=straightSide(target.points,index,-1).point, next=straightSide(target.points,index,1).point;
      const corner=isInnerCorner(v,previous,next,winding,target.id==="outline")
        ? {index,point:v,previous,next} : roundedCorner(target.points,index,Math.max(size.width,size.height));
      if (!corner || !isInnerCorner(corner.point,corner.previous,corner.next,winding,target.id==="outline")) return [];
      // The mouth of an edge-open pocket has no material beyond its corner to relieve.
      if (target.id!=="outline" && !pointInPolygon(corner.point,part.outline,true)) return [];
      return [corner];
    });
    return { ...target, corners };
  });
}

export function reliefTargets(part: Part): ReliefTarget[] {
  return reliefContours(part).filter(target=>target.corners.length);
}

function workingContour(target: ReliefTarget, corners: ReliefCorner[]) {
  const replacements=new Map<number,Point>(), skipped=new Set<number>();
  for (const corner of corners) if (corner.fillet) {
    replacements.set(corner.index,corner.point);
    for (let i=(corner.index+1)%target.points.length;i!==(corner.fillet.end+1)%target.points.length;i=(i+1)%target.points.length) skipped.add(i);
  }
  const points: Point[]=[], indexes=new Map<number,number>();
  target.points.forEach((point,index)=>{
    if (skipped.has(index)) { if (replacements.has(index)) throw Error("圆角相互重叠，无法还原为独立角点"); return; }
    indexes.set(index,points.length); points.push(replacements.get(index)??point);
  });
  return {points,indexes};
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
  const chosen=input.corners.map(index=>{
    const corner = target.corners.find(c => c.index === index);
    if (!corner) throw Error("角点已改变，请重新选择清角位置");
    return corner;
  });
  const working=workingContour(target,chosen);
  if (!validContour(working.points)) throw Error("圆角无法还原为有效直角，请核对轮廓");
  const circles = chosen.map(original => {
    const index=working.indexes.get(original.index)!;
    const before=straightSide(working.points,index,-1), after=straightSide(working.points,index,1);
    const corner={index:original.index,point:working.points[index],previous:before.point,next:after.point};
    const available = Math.min(Math.hypot(corner.previous.x - corner.point.x, corner.previous.y - corner.point.y),
      Math.hypot(corner.next.x - corner.point.x, corner.next.y - corner.point.y));
    if (input.diameter > available + EPS) throw Error("刀具直径大于角点相邻边的局部尺寸，请减小直径");
    const circle = reliefCircle(corner, input);
    const inside = pointInPolygon(circle.center, working.points, target.id === "outline");
    if (target.id === "outline" ? inside : !inside) throw Error("角点附近空间不足，请减小刀具直径");
    const incident=new Set([...before.edges,...after.edges]);
    for (let i = 0; i < working.points.length; i++) {
      if (incident.has(i)) continue;
      if (pointSegmentDistance(circle.center, working.points[i], working.points[(i + 1) % working.points.length]) <= circle.radius + EPS)
        throw Error("刀具尺寸超出局部空间，会切到其他边，请减小直径");
    }
    return circle;
  });
  const clipper = new ClipperLib.Clipper();
  clipper.AddPath(integerPath(working.points), ClipperLib.PolyType.ptSubject, true);
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
