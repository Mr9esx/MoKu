import DxfParser from "dxf-parser";
import ClipperLib from "clipper-lib";
import type { Point, Part, Project, Stock, Placement } from "./types";
import {
  bounds,
  polygonArea,
  pointInPolygon,
  pointSegmentDistance,
  validContour,
} from "./geometry";
type Entity = {
  type: string;
  handle?: string;
  layer?: string;
  shape?: boolean;
  vertices?: (Point & { bulge?: number })[];
  center?: Point;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  text?: string;
  startPoint?: Point;
  position?: Point;
};
const fail = (message: string): never => {
  throw new Error(message);
};
const rounded = (p: Point): Point => ({
  x: Math.round(p.x * 1e6) / 1e6,
  y: Math.round(p.y * 1e6) / 1e6,
});
function arc(center: Point, r: number, start: number, sweep: number) {
  const step = 2 * Math.acos(Math.max(-1, 1 - 0.025 / r)),
    n = Math.max(2, Math.ceil(Math.abs(sweep) / step));
  return Array.from({ length: n + 1 }, (_, i) =>
    rounded({
      x: center.x + r * Math.cos(start + (sweep * i) / n),
      y: center.y + r * Math.sin(start + (sweep * i) / n),
    }),
  );
}
function contour(e: Entity): Point[] {
  if (e.type === "CIRCLE") {
    if (!e.center || !e.radius || e.radius <= 0) fail("圆形尺寸无效");
    return arc(e.center!, e.radius!, 0, Math.PI * 2).slice(0, -1);
  }
  if (e.type === "ARC") {
    if (
      !e.center ||
      !e.radius ||
      e.radius <= 0 ||
      !Number.isFinite(e.startAngle) ||
      !Number.isFinite(e.endAngle)
    )
      fail("圆弧尺寸无效");
    let sweep = (e.endAngle! - e.startAngle!) % (Math.PI * 2);
    if (sweep <= 0) sweep += Math.PI * 2;
    return arc(e.center!, e.radius!, e.startAngle!, sweep);
  }
  const vertices = (e.vertices ?? []).slice();
  if (
    e.type !== "LINE" &&
    vertices.length > 1 &&
    Math.hypot(
      vertices[0].x - vertices.at(-1)!.x,
      vertices[0].y - vertices.at(-1)!.y,
    ) < 1e-7
  )
    vertices.pop();
  if (e.type === "LINE") return vertices.map(rounded);
  if (!e.shape) fail(`图层 ${e.layer} 存在未闭合轮廓，请闭合后重新导入`);
  const out: Point[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i],
      b = vertices[(i + 1) % vertices.length];
    out.push(rounded(a));
    if (a.bulge) {
      const chord = Math.hypot(b.x - a.x, b.y - a.y),
        bulge = a.bulge,
        r = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge)),
        offset = (chord * (1 - bulge * bulge)) / (4 * bulge),
        center = {
          x: (a.x + b.x) / 2 - ((b.y - a.y) / chord) * offset,
          y: (a.y + b.y) / 2 + ((b.x - a.x) / chord) * offset,
        };
      out.push(
        ...arc(
          center,
          r,
          Math.atan2(a.y - center.y, a.x - center.x),
          4 * Math.atan(bulge),
        ).slice(1, -1),
      );
    }
  }
  return out.filter(
    (p, i) => !i || Math.hypot(p.x - out[i - 1].x, p.y - out[i - 1].y) > 1e-7,
  );
}
function nearInside(p: Point, poly: Point[]) {
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
function containsFeature(feature: Point[], parent: Point[]) {
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

// dxf-parser drops POLYLINE elevation and some vertex flags. Validate raw groups
// before parsing so unsupported 3D/OCS geometry can never become an XY contour.
function validatePlanarGroup(entityType: string, code: string, value: string) {
  if (
    !["LWPOLYLINE", "POLYLINE", "VERTEX", "LINE", "ARC", "CIRCLE"].includes(
      entityType,
    )
  )
    return;
  const number = Number(value);
  if (
    ["30", "31", "32", "38", "39"].includes(code) &&
    (!Number.isFinite(number) || number !== 0)
  )
    fail(
      `实体 ${entityType} 包含三维坐标、高程或挤出厚度，请导出 Z=0 的二维平面图纸`,
    );
  if (
    ["210", "220", "230"].includes(code) &&
    number !== (code === "230" ? 1 : 0)
  )
    fail(
      `实体 ${entityType} 使用非默认 OCS 坐标系，请转换到世界 XY 平面后导入`,
    );
  if (
    code === "70" &&
    entityType === "POLYLINE" &&
    number & (2 | 4 | 8 | 16 | 32 | 64)
  )
    fail("不支持 3D POLYLINE、网格或拟合曲线，请转换为二维闭合多段线");
  if (
    code === "70" &&
    entityType === "VERTEX" &&
    number & (1 | 2 | 8 | 16 | 32 | 64 | 128)
  )
    fail("不支持三维、网格或拟合曲线顶点，请转换为二维闭合多段线");
}
function stockAxes(poly: Point[]) {
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
export function parseDxf(text: string, name = "导入图纸"): Project {
  // Reject unsupported entities before dxf-parser can silently discard them.
  const pairs = text.split(/\r?\n/);
  let inEntities = false;
  let entityType = "";
  for (let i = 0; i < pairs.length - 1; i += 2) {
    const code = pairs[i].trim(),
      value = pairs[i + 1].trim();
    if (code === "2" && value === "ENTITIES") inEntities = true;
    if (inEntities && code === "0" && value === "ENDSEC") inEntities = false;
    if (inEntities && code === "0") entityType = value;
    if (inEntities) validatePlanarGroup(entityType, code, value);
    if (
      inEntities &&
      code === "0" &&
      ![
        "LWPOLYLINE",
        "POLYLINE",
        "VERTEX",
        "SEQEND",
        "LINE",
        "ARC",
        "CIRCLE",
        "HATCH",
        "TEXT",
        "MTEXT",
      ].includes(value)
    )
      fail(`不支持实体 ${value}，请转换为闭合多段线后导入`);
  }
  let parsed;
  try {
    parsed = new DxfParser().parseSync(text);
  } catch {
    fail("DXF 解析失败，请导出有效的 ASCII DXF 文件");
  }
  if (!parsed || parsed.header?.$INSUNITS !== 4)
    fail("图纸 HEADER 必须明确声明毫米单位（$INSUNITS=4）");
  const entities = parsed!.entities as unknown as Entity[];
  const shapes: { e: Entity; points: Point[] }[] = [];
  const chains = new Map<string, Entity[]>();
  for (const e of entities) {
    if (["HATCH", "TEXT", "MTEXT"].includes(e.type)) continue;
    if (!/^(CUT|HOLE|POCKET|REF_STOCK)/i.test(e.layer ?? ""))
      fail(
        `无法识别图层 ${e.layer} 的加工语义，请指定 CUT/HOLE/POCKET/REF_STOCK`,
      );
    if (["LINE", "ARC"].includes(e.type)) {
      const list = chains.get(e.layer!) ?? [];
      list.push(e);
      chains.set(e.layer!, list);
    } else shapes.push({ e, points: contour(e) });
  }
  for (const [layer, list] of chains) {
    const endpoints = list.flatMap((e) => {
      const path = contour(e);
      return [path[0], path.at(-1)!];
    });
    for (const point of endpoints) {
      const degree = endpoints.filter(
        (other) => Math.hypot(point.x - other.x, point.y - other.y) < 0.001,
      ).length;
      if (degree !== 2)
        fail(
          `图层 ${layer} 的 LINE/ARC 链未闭合或存在分支，请转换为独立闭合多段线`,
        );
    }
    while (list.length) {
      const first = list.shift()!,
        points = contour(first),
        handles = [first.handle];
      while (
        Math.hypot(
          points[0].x - points.at(-1)!.x,
          points[0].y - points.at(-1)!.y,
        ) > 0.001
      ) {
        const end = points.at(-1)!;
        let found = -1,
          reverse = false;
        for (let i = 0; i < list.length; i++) {
          const path = contour(list[i]);
          if (Math.hypot(end.x - path[0].x, end.y - path[0].y) < 0.001) {
            found = i;
            break;
          }
          if (
            Math.hypot(end.x - path.at(-1)!.x, end.y - path.at(-1)!.y) < 0.001
          ) {
            found = i;
            reverse = true;
            break;
          }
        }
        if (found < 0) fail(`图层 ${layer} 的 LINE/ARC 链未闭合`);
        const e = list.splice(found, 1)[0],
          path = contour(e);
        if (reverse) path.reverse();
        points.push(...path.slice(1));
        handles.push(e.handle);
      }
      points.pop();
      shapes.push({ e: { ...first, handle: handles.join("+") }, points });
    }
  }
  for (const shape of shapes)
    if (!validContour(shape.points))
      fail(`实体 ${shape.e.handle} 轮廓自交或无效`);
  const frames = shapes.filter((s) => /^REF_STOCK/i.test(s.e.layer!));
  if (!frames.length) fail("没有识别到 REF_STOCK 正交板框");
  const sheets: Stock[] = [],
    parts: Part[] = [],
    placements: Placement[] = [],
    warnings: string[] = [];
  const labels = entities
    .filter((e) => e.type === "TEXT" && /^P\d+$/i.test(e.text ?? ""))
    .map((e) => ({ e, point: e.startPoint ?? e.position!, used: false }));
  const cuts = shapes.filter((s) => /^CUT/i.test(s.e.layer!));
  const assigned = new Set<(typeof cuts)[number]>();
  const sourceParts = new Map<(typeof cuts)[number], Part>();
  for (const [i, frame] of frames.entries()) {
    const axes = stockAxes(frame.points),
      stock: Stock = {
        id: frame.e.handle ?? `stock-${i + 1}`,
        name: `板材 ${i + 1}`,
        width: axes.width,
        height: axes.height,
        thickness: 0,
        material: "未指定",
      };
    sheets.push(stock);
    for (const cut of cuts) {
      if (!cut.points.every((p) => nearInside(p, frame.points))) continue;
      if (assigned.has(cut)) fail("零件被多个板框包含，请去除重叠板框");
      assigned.add(cut);
      const outline = cut.points.map(axes.toLocal),
        box = bounds(outline),
        local = (p: Point) => rounded({ x: p.x - box.minX, y: p.y - box.minY });
      const thickness = Number(
        cut.e.layer?.match(/(\d+(?:\.\d+)?)MM$/i)?.[1] ?? 0,
      );
      const insideLabel = labels.find(
        (l) => !l.used && pointInPolygon(l.point, cut.points),
      );
      if (insideLabel) insideLabel.used = true;
      const part: Part = {
        id: cut.e.handle ?? `part-${parts.length + 1}`,
        name: insideLabel?.e.text ?? "",
        stockId: stock.id,
        layer: cut.e.layer!,
        thickness,
        width: box.width,
        height: box.height,
        area: polygonArea(outline),
        outline: outline.map(local),
        holes: [],
        pockets: [],
        label: insideLabel
          ? local(axes.toLocal(insideLabel.point))
          : { x: box.width / 2, y: box.height / 2 },
      };
      parts.push(part);
      sourceParts.set(cut, part);
      placements.push({
        partId: part.id,
        sheetId: stock.id,
        x: box.minX,
        y: box.minY,
        rotation: 0,
      });
    }
    const thicknesses = [
      ...new Set(
        parts.filter((p) => p.stockId === stock.id).map((p) => p.thickness),
      ),
    ];
    if (thicknesses.length === 1) stock.thickness = thicknesses[0];
    else if (thicknesses.length > 1) fail("同一板框内零件厚度不一致");
  }
  if (assigned.size !== cuts.length) fail("存在未被板框完整包含的零件");
  for (const part of parts.filter((p) => !p.name)) {
    const placement = placements.find((p) => p.partId === part.id)!,
      frame = frames[sheets.findIndex((s) => s.id === part.stockId)],
      axes = stockAxes(frame.points);
    const remaining = labels.filter(
      (l) => !l.used && nearInside(l.point, frame.points),
    );
    remaining.sort((a, b) => {
      const distance = (l: typeof a) => {
        const q = axes.toLocal(l.point),
          p = { x: q.x - placement.x, y: q.y - placement.y };
        return Math.min(
          ...part.outline.map((v, i) =>
            pointSegmentDistance(
              p,
              v,
              part.outline[(i + 1) % part.outline.length],
            ),
          ),
        );
      };
      return distance(a) - distance(b);
    });
    const label = remaining[0];
    if (label) {
      label.used = true;
      part.name = label.e.text!;
      const q = axes.toLocal(label.point);
      part.label = { x: q.x - placement.x, y: q.y - placement.y };
      warnings.push(`${part.name} 标注位于凹口，按最近未匹配文字关联，请核对`);
    } else part.name = `零件 ${part.id}`;
  }
  for (const feature of shapes.filter((s) =>
    /^(HOLE|POCKET)/i.test(s.e.layer!),
  )) {
    const owners = cuts.filter((c) =>
      containsFeature(feature.points, c.points),
    );
    if (owners.length !== 1) fail(`孔槽 ${feature.e.handle} 无法唯一归属零件`);
    const part = sourceParts.get(owners[0])!,
      placement = placements.find((p) => p.partId === part.id)!,
      axes = stockAxes(
        frames[sheets.findIndex((s) => s.id === part.stockId)].points,
      );
    const outline = feature.points.map((p) => {
      const q = axes.toLocal(p);
      return rounded({ x: q.x - placement.x, y: q.y - placement.y });
    });
    if (/^HOLE/i.test(feature.e.layer!)) {
      const thickness = Number(
        feature.e.layer?.match(/(\d+(?:\.\d+)?)MM$/i)?.[1] ?? 0,
      );
      if (thickness && thickness !== part.thickness)
        fail("孔图层厚度与所属零件不匹配");
      part.holes.push(outline);
    } else {
      const depth =
        Number(feature.e.layer?.match(/DEPTH(\d+(?:\.\d+)?)$/i)?.[1] ?? 0) ||
        null;
      if (depth === null)
        fail("铣槽深度未知，请使用 POCKET_DEPTH 数值图层后导入");
      if (part.thickness > 0 && depth! >= part.thickness)
        fail("槽深必须小于板厚");
      part.pockets.push({ outline, depth });
    }
  }
  if (labels.some((l) => !l.used)) fail("存在未匹配的零件编号，请核对图纸");
  if (
    new Set(parts.map((p) => p.id)).size !== parts.length ||
    new Set(sheets.map((s) => s.id)).size !== sheets.length
  )
    fail("源实体 ID 重复，请修复图纸");
  if (parts.some((p) => !p.thickness))
    warnings.push("零件板厚未知，请填写板厚后排版");
  return {
    name,
    units: "mm",
    sheets,
    parts,
    original: { sheets: sheets.map((s) => ({ ...s })), placements },
    warnings,
  };
}
