import type {
  Point,
  Part,
  Placement,
  Project,
  Layout,
  NestSettings,
  LayoutIssue,
  LayoutMetrics,
  Remnant,
} from "./types";
const EPS = 1e-7;
export function signedArea(p: Point[]) {
  return (
    p.reduce((a, v, i) => {
      const w = p[(i + 1) % p.length];
      return a + v.x * w.y - w.x * v.y;
    }, 0) / 2
  );
}
export function polygonArea(p: Point[]) {
  return Math.abs(signedArea(p));
}
export function bounds(p: Point[]) {
  const minX = Math.min(...p.map((v) => v.x)),
    minY = Math.min(...p.map((v) => v.y)),
    maxX = Math.max(...p.map((v) => v.x)),
    maxY = Math.max(...p.map((v) => v.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
export function transformPoints(points: Point[], part: Part, p: Placement) {
  return points.map((v) => {
    switch (p.rotation) {
      case 90:
        return { x: p.x + part.height - v.y, y: p.y + v.x };
      case 180:
        return { x: p.x + part.width - v.x, y: p.y + part.height - v.y };
      case 270:
        return { x: p.x + v.y, y: p.y + part.width - v.x };
      default:
        return { x: p.x + v.x, y: p.y + v.y };
    }
  });
}
export function placedOutline(part: Part, p: Placement) {
  return transformPoints(part.outline, part, p);
}
const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function pointSegmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function properIntersect(a: Point, b: Point, c: Point, d: Point) {
  return (
    cross(a, b, c) * cross(a, b, d) < -EPS &&
    cross(c, d, a) * cross(c, d, b) < -EPS
  );
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  return properIntersect(a, b, c, d)
    ? 0
    : Math.min(
        pointSegmentDistance(a, c, d),
        pointSegmentDistance(b, c, d),
        pointSegmentDistance(c, a, b),
        pointSegmentDistance(d, a, b),
      );
}
export function pointInPolygon(v: Point, p: Point[], strict = false) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[j],
      b = p[i];
    if (pointSegmentDistance(v, a, b) < EPS) return !strict;
    if (
      a.y > v.y !== b.y > v.y &&
      v.x < ((b.x - a.x) * (v.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function contourDistance(a: Point[], b: Point[]) {
  let distance = Infinity;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      distance = Math.min(
        distance,
        segmentDistance(
          a[i],
          a[(i + 1) % a.length],
          b[j],
          b[(j + 1) % b.length],
        ),
      );
  return distance;
}
export function contoursOverlap(a: Point[], b: Point[]) {
  if (
    a.some((v) => pointInPolygon(v, b, true)) ||
    b.some((v) => pointInPolygon(v, a, true))
  )
    return true;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (
        properIntersect(
          a[i],
          a[(i + 1) % a.length],
          b[j],
          b[(j + 1) % b.length],
        )
      )
        return true; // Coincident contours/edges: test an inward offset from each edge.
  for (const poly of [a, b]) {
    const other = poly === a ? b : a,
      sign = Math.sign(signedArea(poly));
    for (let i = 0; i < poly.length; i++) {
      const u = poly[i],
        v = poly[(i + 1) % poly.length],
        len = Math.hypot(v.x - u.x, v.y - u.y);
      if (!len) continue;
      const m = {
        x: (u.x + v.x) / 2 - ((sign * (v.y - u.y)) / len) * 1e-5,
        y: (u.y + v.y) / 2 + ((sign * (v.x - u.x)) / len) * 1e-5,
      };
      if (pointInPolygon(m, poly, true) && pointInPolygon(m, other, true))
        return true;
    }
  }
  return false;
}
export function validContour(p: Point[]) {
  if (
    p.length < 3 ||
    p.some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y)) ||
    polygonArea(p) < EPS
  )
    return false;
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.length - 1)) continue;
      if (
        segmentDistance(
          p[i],
          p[(i + 1) % p.length],
          p[j],
          p[(j + 1) % p.length],
        ) < EPS
      )
        return false;
    }
  return true;
}
export function validateLayout(
  project: Project,
  layout: Layout,
  s: NestSettings,
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const add = (
    kind: LayoutIssue["kind"],
    message: string,
    partIds: string[] = [],
  ) => issues.push({ kind, message, partIds });
  if (
    [s.gap, s.margin, s.minRemnantWidth, s.minRemnantHeight, s.iterations].some(
      (v) => !Number.isFinite(v) || v < 0,
    )
  ) {
    add("invalid", "排版参数必须为有限非负数");
    return issues;
  }
  if (new Set(layout.sheets.map((v) => v.id)).size !== layout.sheets.length)
    add("invalid", "板材 ID 重复");
  for (const stock of layout.sheets)
    if (![stock.width, stock.height].every((v) => Number.isFinite(v) && v > 0))
      add("invalid", "板材尺寸无效");
  for (const part of project.parts) {
    const count = layout.placements.filter((p) => p.partId === part.id).length;
    if (count !== 1)
      add("missing", `${part.name} 必须且只能放置一次`, [part.id]);
  }
  const placed: { part: Part; p: Placement; outline: Point[] }[] = [];
  for (const p of layout.placements) {
    const part = project.parts.find((v) => v.id === p.partId),
      stock = layout.sheets.find((v) => v.id === p.sheetId);
    if (
      !part ||
      !stock ||
      ![p.x, p.y].every(Number.isFinite) ||
      ![0, 90, 180, 270].includes(p.rotation) ||
      (!s.allowRotation && p.rotation !== 0)
    ) {
      add("invalid", "零件、板材或旋转坐标无效", [p.partId]);
      continue;
    }
    if (!validContour(part.outline)) {
      add("invalid", "零件轮廓无效", [part.id]);
      continue;
    }
    if (
      !Number.isFinite(stock.thickness) ||
      stock.thickness <= 0 ||
      part.thickness <= 0 ||
      stock.thickness !== part.thickness
    )
      add("thickness", `${part.name} 板厚未知或不匹配`, [part.id]);
    if (
      part.pockets.some(
        (pocket) =>
          pocket.depth === null ||
          !Number.isFinite(pocket.depth) ||
          pocket.depth <= 0 ||
          pocket.depth >= part.thickness,
      )
    )
      add("invalid", `${part.name} 槽深未知或超出板厚`, [part.id]);
    const sourceStock = project.sheets.find((s) => s.id === part.stockId);
    if (sourceStock && sourceStock.material !== stock.material)
      add("invalid", `${part.name} 材料不匹配`, [part.id]);
    const original = project.original.placements.find(
      (v) => v.partId === part.id,
    );
    if (
      (p.locked || original?.locked) &&
      (!original ||
        p.sheetId !== original.sheetId ||
        p.rotation !== original.rotation ||
        Math.abs(p.x - original.x) > EPS ||
        Math.abs(p.y - original.y) > EPS)
    )
      add("invalid", `${part.name} 已锁定`, [part.id]);
    const outline = placedOutline(part, p),
      b = bounds(outline);
    if (
      b.minX < s.margin - EPS ||
      b.minY < s.margin - EPS ||
      b.maxX > stock.width - s.margin + EPS ||
      b.maxY > stock.height - s.margin + EPS
    )
      add("boundary", `${part.name} 越过板材边距`, [part.id]);
    placed.push({ part, p, outline });
  }
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i],
        b = placed[j];
      if (a.p.sheetId !== b.p.sheetId) continue;
      const ab = bounds(a.outline),
        bb = bounds(b.outline);
      // Bounding boxes only prune distant pairs; candidate pairs retain every edge.
      const dx = Math.max(0, ab.minX - bb.maxX, bb.minX - ab.maxX);
      const dy = Math.max(0, ab.minY - bb.maxY, bb.minY - ab.maxY);
      if (Math.hypot(dx, dy) > s.gap + EPS) continue;
      if (contoursOverlap(a.outline, b.outline))
        add("overlap", `${a.part.name} 与 ${b.part.name} 重叠`, [
          a.part.id,
          b.part.id,
        ]);
      else if (contourDistance(a.outline, b.outline) < s.gap - EPS)
        add("gap", `${a.part.name} 与 ${b.part.name} 间距不足`, [
          a.part.id,
          b.part.id,
        ]);
    }
  return issues;
}
export function measureLayout(
  project: Project,
  layout: Layout,
  s: NestSettings,
): LayoutMetrics {
  let travel = 0;
  const remnants: Remnant[] = [];
  for (const stock of layout.sheets) {
    const polys = layout.placements
      .filter((p) => p.sheetId === stock.id)
      .map((p) => {
        const part = project.parts.find((v) => v.id === p.partId);
        return part ? placedOutline(part, p) : [];
      })
      .filter((p) => p.length);
    const boxes = polys.map(bounds);
    let current = { x: 0, y: 0 };
    const centers = boxes.map((b) => ({
      x: (b.minX + b.maxX) / 2,
      y: (b.minY + b.maxY) / 2,
    }));
    while (centers.length) {
      let best = 0;
      for (let i = 1; i < centers.length; i++)
        if (
          Math.hypot(centers[i].x - current.x, centers[i].y - current.y) <
          Math.hypot(centers[best].x - current.x, centers[best].y - current.y)
        )
          best = i;
      const next = centers.splice(best, 1)[0];
      travel += Math.hypot(next.x - current.x, next.y - current.y);
      current = next;
    }
    // Largest rectangle in a coordinate grid excluding expanded part bounding boxes.
    // Deliberately underestimates concave free space; guarantees collision-free remnants.
    const obstacles = boxes.map((b) => ({
      minX: b.minX - s.gap,
      minY: b.minY - s.gap,
      maxX: b.maxX + s.gap,
      maxY: b.maxY + s.gap,
    }));
    const xs = [
      ...new Set([
        s.margin,
        stock.width - s.margin,
        ...obstacles.flatMap((b) => [
          Math.max(s.margin, b.minX),
          Math.min(stock.width - s.margin, b.maxX),
        ]),
      ]),
    ]
      .filter((x) => x >= s.margin && x <= stock.width - s.margin)
      .sort((a, b) => a - b);
    const ys = [
      ...new Set([
        s.margin,
        stock.height - s.margin,
        ...obstacles.flatMap((b) => [
          Math.max(s.margin, b.minY),
          Math.min(stock.height - s.margin, b.maxY),
        ]),
      ]),
    ]
      .filter((y) => y >= s.margin && y <= stock.height - s.margin)
      .sort((a, b) => a - b);
    let best: Remnant | undefined;
    for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < xs.length; j++) {
        const width = xs[j] - xs[i];
        if (width < s.minRemnantWidth) continue;
        let start: number | undefined;
        for (let k = 0; k < ys.length - 1; k++) {
          const blocked = obstacles.some(
            (b) =>
              b.minX < xs[j] - EPS &&
              b.maxX > xs[i] + EPS &&
              b.minY < ys[k + 1] - EPS &&
              b.maxY > ys[k] + EPS,
          );
          if (blocked) {
            start = undefined;
            continue;
          }
          start ??= ys[k];
          const height = ys[k + 1] - start,
            area = width * height;
          if (height >= s.minRemnantHeight && (!best || area > best.area))
            best = {
              sheetId: stock.id,
              x: xs[i],
              y: start,
              width,
              height,
              area,
            };
        }
      }
    if (best) remnants.push(best);
  }
  const outlineArea = project.parts.reduce((n, p) => n + p.area, 0),
    stockArea = layout.sheets.reduce((n, s) => n + s.width * s.height, 0);
  return {
    sheetCount: layout.sheets.length,
    utilization: stockArea ? outlineArea / stockArea : 0,
    outlineArea,
    stockArea,
    travel,
    remnants,
    reusableArea: remnants.reduce((n, r) => n + r.area, 0),
  };
}
