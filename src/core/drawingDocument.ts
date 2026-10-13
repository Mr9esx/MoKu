import DxfParser from "dxf-parser";
// @ts-expect-error b-spline has no TypeScript declarations; narrowed at the boundary below.
import bspline from "b-spline";
import type { Point } from "./types";
import type { DrawingDocument, DrawingShape } from "./drawingTypes";
import { validContour, bounds, pointSegmentDistance } from "./geometry";
import {
  arcSegments,
  DrawingComplexityError,
  MAX_ENTITY_POINTS,
  MAX_TOTAL_POINTS,
  reserve,
  rounded,
  splinePoints,
  type PointBudget,
} from "./drawingCurves";

import { boundedEndpointMatches, drawingGeometry, endpointsMatch, normalizationRecord, returnedPolylineVertices, validNormalizedRegion } from "./drawingNormalization";

type Group = { code: number; value: string };
type RecordEntity = {
  type: string;
  groups: Group[];
  index: number;
  children?: RecordEntity[];
};
type Matrix = [number, number, number, number, number, number];
type Entity = {
  type: string;
  vertices?: Array<Point & { bulge?: number }>;
  center?: Point;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  shape?: boolean;
  majorAxisEndPoint?: Point;
  axisRatio?: number;
  controlPoints?: Point[];
  knotValues?: number[];
  degreeOfSplineCurve?: number;
  closed?: boolean;
  periodic?: boolean;
  name?: string;
  position?: Point;
  text?: string;
  startPoint?: Point;
  color?: number;
};
type Context = {
  matrix: Matrix;
  layer: string;
  space: string;
  path: string;
  sourceIds: string[];
  stack: string[];
};
const get = (r: RecordEntity, code: number) =>
  r.groups.find((g) => g.code === code)?.value;
const num = (r: RecordEntity, code: number, fallback = 0) =>
  get(r, code) === undefined ? fallback : Number(get(r, code));
const transform = (p: Point, m: Matrix): Point => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
// Largest singular value gives a conservative physical error under nonuniform scaling.
const stretch = (m: Matrix) => {
  const a = m[0] * m[0] + m[1] * m[1],
    b = m[2] * m[2] + m[3] * m[3],
    c = m[0] * m[2] + m[1] * m[3];
  return Math.sqrt((a + b + Math.hypot(a - b, 2 * c)) / 2);
};
const near = endpointsMatch;
const serialize = (r: RecordEntity): string =>
  `0\n${r.type}\n` +
  r.groups.map((g) => `${g.code}\n${g.value}\n`).join("") +
  (r.children ?? []).map(serialize).join("");
const supported = new Set([
  "LINE",
  "ARC",
  "CIRCLE",
  "LWPOLYLINE",
  "POLYLINE",
  "ELLIPSE",
  "SPLINE",
  "INSERT",
]);
const annotations = new Set([
  "VIEWPORT",
  "DIMENSION",
  "HATCH",
  "POINT",
  "ATTDEF",
  "TEXT",
  "MTEXT",
  "ATTRIB",
]);

function inventory(text: string) {
  if (text.startsWith("AutoCAD Binary DXF"))
    throw new Error("请导出 ASCII DXF 文件");
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/);
  while (lines.at(-1) === "") lines.pop();
  if (lines.length % 2) throw new Error("DXF 解析失败：组码和值不成对");
  const groups: Group[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code) || code < 0 || code > 1071)
      throw new Error("DXF 解析失败：无效组码");
    groups.push({ code, value: lines[i + 1].trim() });
  }
  let section = "",
    current: RecordEntity | undefined,
    index = 0,
    insunits = 0,
    headerName = "";
  const raw: RecordEntity[] = [],
    blockRecords: RecordEntity[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (g.code === 0 && g.value === "SECTION") {
      section = groups[++i]?.value ?? "";
      current = undefined;
      continue;
    }
    if (g.code === 0 && g.value === "ENDSEC") {
      section = "";
      current = undefined;
      continue;
    }
    if (section === "HEADER") {
      if (g.code === 9) headerName = g.value;
      else if (headerName === "$INSUNITS" && g.code === 70)
        insunits = Number(g.value);
      continue;
    }
    if (section !== "ENTITIES" && section !== "BLOCKS") continue;
    if (g.code === 0) {
      current = { type: g.value, groups: [], index: index++ };
      (section === "ENTITIES" ? raw : blockRecords).push(current);
    } else current?.groups.push(g);
  }
  if (!groups.some((g) => g.code === 0 && g.value === "EOF"))
    throw new Error("DXF 解析失败：缺少 EOF");
  const combine = (list: RecordEntity[]) => {
    const result: RecordEntity[] = [];
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.type === "POLYLINE") {
        r.children = [];
        while (i + 1 < list.length && list[i + 1].type === "VERTEX")
          r.children.push(list[++i]);
        if (list[i + 1]?.type === "SEQEND") r.children.push(list[++i]);
      } else if (r.type === "INSERT" && num(r, 66) === 1) {
        r.children = [];
        while (list[i + 1]?.type === "ATTRIB") r.children.push(list[++i]);
        if (list[i + 1]?.type === "SEQEND") r.children.push(list[++i]);
      }
      result.push(r);
    }
    return result;
  };
  const blocks = new Map<
    string,
    { base: Point; entities: RecordEntity[]; record: RecordEntity }
  >();
  const duplicateBlocks = new Set<string>();
  for (let i = 0; i < blockRecords.length; i++)
    if (blockRecords[i].type === "BLOCK") {
      const r = blockRecords[i],
        name = get(r, 2) ?? get(r, 3) ?? `unnamed-${r.index}`,
        members: RecordEntity[] = [];
      while (
        i + 1 < blockRecords.length &&
        blockRecords[i + 1].type !== "ENDBLK"
      )
        members.push(blockRecords[++i]);
      if (blocks.has(name)) duplicateBlocks.add(name);
      else
        blocks.set(name, {
          record: r,
          base: { x: num(r, 10), y: num(r, 20) },
          entities: combine(members),
        });
    }
  return { entities: combine(raw), blocks, insunits, duplicateBlocks };
}

function planar(r: RecordEntity): number {
  const all = [r, ...(r.children ?? [])];
  for (const entity of all)
    for (const { code, value } of entity.groups)
      if (
        [30, 31, 32, 33, 38, 39].includes(code) &&
        (!Number.isFinite(Number(value)) || Number(value) !== 0)
      )
        throw new Error("包含三维坐标、高程或挤出厚度，请导出 Z=0 的二维图纸");
  if (r.type === "POLYLINE" && num(r, 70) & (2 | 4 | 8 | 16 | 32 | 64))
    throw new Error("不支持 3D POLYLINE、网格或拟合曲线，请转换为二维多段线");
  if (
    r.children?.some(
      (c) =>
        c.type === "VERTEX" && num(c, 70) & (1 | 2 | 8 | 16 | 32 | 64 | 128),
    )
  )
    throw new Error("包含三维、网格或拟合曲线顶点");
  const x = num(r, 210),
    y = num(r, 220),
    z = num(r, 230, 1);
  if (
    !Number.isFinite(x + y + z) ||
    x !== 0 ||
    y !== 0 ||
    (z !== 1 && z !== -1)
  )
    throw new Error("使用不支持的 OCS 坐标系，请转换到世界 XY 平面");
  return z;
}

function polylinePoints(
  vertices: Array<Point & { bulge?: number }>,
  closed: boolean,
  matrix: Matrix,
  budget: PointBudget,
): Point[] {
  const points: Point[] = [];
  const at = (p: Point) => rounded(transform(p, matrix));
  const sampleArc = (
    center: Point,
    radius: number,
    start: number,
    sweep: number,
    count: number,
  ) =>
    Array.from({ length: count + 1 }, (_, i) =>
      at({
        x: center.x + radius * Math.cos(start + (sweep * i) / count),
        y: center.y + radius * Math.sin(start + (sweep * i) / count),
      }),
    );
  if (vertices.length < 2) throw new Error("多段线顶点不足");
  const segments: (
    | { center: Point; radius: number; start: number; sweep: number; n: number }
    | undefined
  )[] = [];
  let count = vertices.length;
  for (let i = 0; i < (closed ? vertices.length : vertices.length - 1); i++) {
    const a = vertices[i],
      b = vertices[(i + 1) % vertices.length],
      bulge = a.bulge ?? 0;
    if (!Number.isFinite(bulge)) throw new Error("多段线 bulge 无效");
    if (bulge === 0) {
      segments.push(undefined);
      continue;
    }
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    if (chord === 0) throw new Error("多段线弧段端点重复");
    const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge)),
      offset = (chord * (1 - bulge * bulge)) / (4 * bulge),
      center = {
        x: (a.x + b.x) / 2 - ((b.y - a.y) / chord) * offset,
        y: (a.y + b.y) / 2 + ((b.x - a.x) / chord) * offset,
      },
      sweep = 4 * Math.atan(bulge),
      n = arcSegments(radius * stretch(matrix), sweep);
    count += n - 1;
    segments.push({
      center,
      radius,
      start: Math.atan2(a.y - center.y, a.x - center.x),
      sweep,
      n,
    });
  }
  reserve(count, budget);
  for (let i = 0; i < vertices.length; i++) {
    points.push(at(vertices[i]));
    const segment = segments[i];
    if (segment)
      points.push(
        ...sampleArc(
          segment.center,
          segment.radius,
          segment.start,
          segment.sweep,
          segment.n,
        ).slice(1, -1),
      );
  }
  return points;
}

export function readDrawing(
  text: string,
  name = "导入图纸",
  options: { unit?: "mm" | "cm" | "m" | "inch" | "foot" } = {},
): DrawingDocument {
  const source = inventory(text),
    scales: Record<number, number> = {
      1: 25.4,
      2: 304.8,
      4: 1,
      5: 10,
      6: 1000,
      7: 1e6,
      8: 0.0000254,
      9: 0.0254,
      10: 914.4,
      11: 1e-7,
      12: 1e-6,
      13: 0.001,
      14: 100,
      15: 10000,
      16: 100000,
      17: 1e12,
      18: 149597870700000,
      19: 9460730472580800000,
      20: 30856775814913700000,
      21: 1200000 / 3937,
      22: 100 / 3937,
      23: 3600000 / 3937,
      24: 6336000000 / 3937,
    };
  const overrides = { mm: 1, cm: 10, m: 1000, inch: 25.4, foot: 304.8 },
    names: Record<string, string> = {
      mm: "毫米",
      cm: "厘米",
      m: "米",
      inch: "英寸",
      foot: "英尺",
    },
    unitNames: Record<number, string> = {
      1: "英寸",
      2: "英尺",
      4: "毫米",
      5: "厘米",
      6: "米",
    };
  const declared = options.unit
      ? overrides[options.unit]
      : scales[source.insunits],
    scale = declared ?? 1;
  const doc: DrawingDocument = {
    name,
    unitKnown: declared !== undefined,
    importInfo: {
      sourceUnit: options.unit
        ? names[options.unit]
        : (unitNames[source.insunits] ??
          (declared ? `DXF 单位代码 ${source.insunits}` : "未知")),
      scale,
      overridden: !!options.unit,
    },
    spaces: ["model"],
    shapes: [],
    labels: [],
    diagnostics: [],
  };
  const budget: PointBudget = { used: 0 },
    handles = new Map<string, number>(),
    decoded = new Map<number, Entity>(),
    usedBlocks = new Set<string>();
  let instances = 0,
    visited = 0;
  const diagnostic = (
    id: string,
    layer: string,
    space: string,
    message: string,
    severity: "info" | "blocking" = "blocking",
    shapeId?: string,
  ) =>
    doc.diagnostics.push({
      id,
      layer,
      space,
      message,
      severity,
      ...(shapeId ? { shapeId } : {}),
    });
  if (!doc.unitKnown)
    diagnostic(
      "units",
      "",
      "model",
      "图纸单位未知，请明确选择原文件单位后重新预览",
    );
  const parents = [
    ...source.entities,
    ...[...source.blocks.values()].flatMap((b) => b.entities),
  ];
  const allRecords = parents.flatMap((r) => [r, ...(r.children ?? [])]);
  let rawCount = 0;
  for (const r of allRecords) {
    const handle = get(r, 5);
    if (handle) handles.set(handle, (handles.get(handle) ?? 0) + 1);
    const count = [r, ...(r.children ?? [])].reduce(
      (sum, e) => sum + e.groups.filter((g) => g.code === 10).length,
      0,
    );
    if (supported.has(r.type)) {
      if (count > MAX_ENTITY_POINTS || rawCount + count > MAX_TOTAL_POINTS)
        throw new DrawingComplexityError();
      rawCount += count;
    }
  }
  const decode = (r: RecordEntity): Entity => {
    const cached = decoded.get(r.index);
    if (cached) return cached;
    if (r.type === "POLYLINE" && r.children?.at(-1)?.type !== "SEQEND")
      throw new Error("POLYLINE 缺少 SEQEND");
    if (
      r.type === "LWPOLYLINE" &&
      num(r, 90) !== r.groups.filter((g) => g.code === 10).length
    )
      throw new Error("LWPOLYLINE 顶点数量与声明不一致");
    if (
      r.type === "SPLINE" &&
      (
        [
          [73, 10],
          [72, 40],
          [74, 11],
        ] as const
      ).some(
        ([countCode, pointCode]) =>
          get(r, countCode) !== undefined &&
          num(r, countCode) !==
            r.groups.filter((g) => g.code === pointCode).length,
      )
    )
      throw new Error("SPLINE 控制点、节点或拟合点数量与声明不一致");
    const parsed = new DxfParser().parseSync(
      `0\nSECTION\n2\nENTITIES\n${serialize(r)}0\nENDSEC\n0\nEOF\n`,
    );
    const e = parsed?.entities?.[0] as unknown as Entity | undefined;
    if (!e) throw new Error(`不能解析实体 ${r.type}`);
    decoded.set(r.index, e);
    return e;
  };
  const finish = (shape: DrawingShape, reason?: string) => {
    const geometry = drawingGeometry(shape.points, shape.closed, reason);
    Object.assign(shape, geometry);
    const valid = shape.valid;
    if (reason || !valid)
      diagnostic(
        `${shape.id}:geometry`,
        shape.layer,
        shape.space,
        reason ??
          (!shape.closed
            ? "轮廓未闭合，可定义为开放铣槽并选择画法，或确认忽略"
            : "轮廓自交或无效"),
        "blocking",
        shape.id,
      );
    if(reason || !valid) doc.diagnostics.at(-1)!.code = !reason && !shape.closed && shape.pathValid ? "open-path" : "invalid-geometry";
    doc.shapes.push(shape);
  };
  const chains = new Map<string, DrawingShape[]>();
  const physicalEnds = new Map<DrawingShape, [Point, Point]>();
  const hatches: {
    r: RecordEntity;
    ctx: Context;
    id: string;
    layer: string;
    space: string;
  }[] = [];
  const emit = (r: RecordEntity, ctx: Context) => {
    if (++visited > 100000) throw new DrawingComplexityError();
    const handle = get(r, 5) ?? `entity-${r.index}`,
      id = ctx.path
        ? `${ctx.path}/${handle}@${r.index}`
        : (handles.get(handle) ?? 0) > 1
          ? `${handle}@${r.index}`
          : handle;
    const layer = (get(r, 8) ?? "0") === "0" ? ctx.layer : get(r, 8)!,
      rawSpace = ctx.path
        ? ctx.space
        : (get(r, 410) ?? (num(r, 67) ? "paper" : "model")),
      space = /^model$/i.test(rawSpace) ? "model" : rawSpace;
    if (!doc.spaces.includes(space)) doc.spaces.push(space);
    const sourceIds = [
      ...ctx.sourceIds,
      handle,
      ...(r.type === "POLYLINE"
        ? (r.children ?? [])
            .filter((c) => c.type === "VERTEX" && get(c, 5))
            .map((c) => get(c, 5)!)
        : []),
    ];
    const report = (
      message: string,
      severity: "info" | "blocking" = "blocking",
    ) =>
      diagnostic(
        `${id}:source`,
        layer,
        space,
        `实体 ${handle} (${r.type})：${message}`,
        severity,
      );
    if ((handles.get(handle) ?? 0) > 1)
      diagnostic(
        `${id}:duplicate`,
        layer,
        space,
        `源实体 ID ${handle} 重复；已保留独立稳定标识`,
      );
    if (r.type === "HATCH") {
      hatches.push({ r, ctx, id, layer, space });
      return;
    }
    if (annotations.has(r.type)) {
      if (["TEXT", "MTEXT", "ATTRIB", "ATTDEF"].includes(r.type))
        try {
          const e =
              r.type === "ATTRIB"
                ? {
                    startPoint: { x: num(r, 10, NaN), y: num(r, 20, NaN) },
                    text: get(r, 1),
                  }
                : decode(r),
            point = e.startPoint ?? ("position" in e ? e.position : undefined);
          const normal = planar({
              ...r,
              groups: r.groups.filter(
                (g) => ![30, 31, 32, 33, 38, 39].includes(g.code),
              ),
            }),
            matrix =
              normal === -1 && r.type !== "MTEXT"
                ? multiply(ctx.matrix, [-1, 0, 0, 1, 0, 0])
                : ctx.matrix;
          if (point && Number.isFinite(point.x) && Number.isFinite(point.y))
            doc.labels.push({
              id,
              layer,
              space,
              text:
                e.text ??
                r.groups
                  .filter((g) => g.code === 1 || g.code === 3)
                  .map((g) => g.value)
                  .join(""),
              point: rounded(transform(point, matrix)),
            });
          else report("标注位置无效", "info");
        } catch {
          report("标注解析失败", "info");
        }
      else
        report(
          r.type === "HATCH"
            ? "填充显示对象；未转换为加工边界"
            : "辅助显示对象；未转换为加工轮廓",
          "info",
        );
      return;
    }
    if (!supported.has(r.type)) {
      report(`不支持实体 ${r.type}，请转换为二维多段线或明确忽略此对象`);
      return;
    }
    try {
      const normal = planar(
        r.type === "INSERT" ? { ...r, children: undefined } : r,
      );
      if (r.type === "INSERT") {
        const blockName = get(r, 2) ?? "",
          block = source.blocks.get(blockName);
        if (!block) throw new Error(`未找到块定义 ${blockName}`);
        if (source.duplicateBlocks.has(blockName))
          throw new Error(`块定义 ${blockName} 重复，无法唯一确定几何`);
        planar(block.record);
        if (ctx.stack.includes(blockName) || ctx.stack.length >= 32)
          throw new Error(`块 ${blockName} 存在循环递归或嵌套超过 32 层`);
        const sx = num(r, 41, 1),
          sy = num(r, 42, 1),
          angle = (num(r, 50) * Math.PI) / 180,
          cols = num(r, 70, 1),
          rows = num(r, 71, 1),
          x = num(r, 10),
          y = num(r, 20),
          dx = num(r, 44),
          dy = num(r, 45);
        if (
          ![sx, sy, angle, x, y, dx, dy].every(Number.isFinite) ||
          sx === 0 ||
          sy === 0
        )
          throw new Error("块变换无效");
        if (
          !Number.isSafeInteger(cols) ||
          !Number.isSafeInteger(rows) ||
          cols < 1 ||
          rows < 1 ||
          cols * rows > 10000 ||
          instances + cols * rows > 10000
        )
          throw new DrawingComplexityError();
        usedBlocks.add(blockName);
        instances += cols * rows;
        const c = Math.cos(angle),
          s = Math.sin(angle);
        for (let row = 0; row < rows; row++)
          for (let col = 0; col < cols; col++) {
            // MINSERT spacing follows rotated OCS axes; it is not multiplied by block scale.
            const local: Matrix = [
              normal * c * sx,
              s * sx,
              -normal * s * sy,
              c * sy,
              normal * (x + c * col * dx - s * row * dy),
              y + s * col * dx + c * row * dy,
            ];
            local[4] -= local[0] * block.base.x + local[2] * block.base.y;
            local[5] -= local[1] * block.base.x + local[3] * block.base.y;
            const next = {
              matrix: multiply(ctx.matrix, local),
              layer,
              space,
              path: `${id}[${row},${col}]`,
              sourceIds,
              stack: [...ctx.stack, blockName],
            };
            for (const member of block.entities) emit(member, next);
          }
        if (r.children?.length) {
          if (r.children.at(-1)?.type !== "SEQEND")
            report("INSERT 属性序列缺少 SEQEND");
          for (const attribute of r.children)
            if (attribute.type === "ATTRIB")
              emit(attribute, {
                ...ctx,
                layer,
                space,
                path: `${id}/attributes`,
                sourceIds,
              });
        }
        return;
      }
      const e = decode(r);
      let matrix = ctx.matrix;
      if (
        normal === -1 &&
        ["LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC"].includes(r.type)
      )
        matrix = multiply(matrix, [-1, 0, 0, 1, 0, 0]);
      let points: Point[] = [],
        closed = false;
      let normalization: DrawingShape["normalization"];
      let endpoints: [Point, Point] | undefined;
      const at = (p: Point) => rounded(transform(p, matrix));
      const sampleArc = (
        center: Point,
        radius: number,
        start: number,
        sweep: number,
        count: number,
      ) =>
        Array.from({ length: count + 1 }, (_, i) =>
          at({
            x: center.x + radius * Math.cos(start + (sweep * i) / count),
            y: center.y + radius * Math.sin(start + (sweep * i) / count),
          }),
        );
      if (["CIRCLE", "ARC"].includes(r.type)) {
        if (!e.center || !Number.isFinite(e.radius) || e.radius! <= 0)
          throw new Error("圆形或圆弧尺寸无效");
        const start = r.type === "CIRCLE" ? 0 : e.startAngle!,
          end = r.type === "CIRCLE" ? 2 * Math.PI : e.endAngle!;
        if (!Number.isFinite(start + end)) throw new Error("圆弧角度无效");
        let sweep = (end - start) % (2 * Math.PI);
        if (sweep <= 0) sweep += 2 * Math.PI;
        const n = arcSegments(e.radius! * stretch(matrix), sweep);
        reserve(n + 1, budget);
        points = sampleArc(e.center, e.radius!, start, sweep, n);
        endpoints = [start, start + sweep].map(angle => transform({ x: e.center!.x + e.radius! * Math.cos(angle), y: e.center!.y + e.radius! * Math.sin(angle) }, matrix)) as [Point, Point];
        closed = r.type === "CIRCLE";
        if (closed) points.pop();
      } else if (r.type === "ELLIPSE") {
        const a = e.majorAxisEndPoint,
          center = e.center,
          ratio = e.axisRatio!,
          start = e.startAngle ?? 0,
          end = e.endAngle ?? 2 * Math.PI;
        if (
          !a ||
          !center ||
          !Number.isFinite(ratio) ||
          ratio <= 0 ||
          ratio > 1 ||
          !Number.isFinite(start + end) ||
          Math.hypot(a.x, a.y) <= 0
        )
          throw new Error("ELLIPSE 轴向、比例或角度无效");
        let sweep = (end - start) % (2 * Math.PI);
        if (sweep <= 0) sweep += 2 * Math.PI;
        // A complete parameter revolution is source-closed; near returns are judged
        // by physical endpoints after every transform rather than an angular epsilon.
        closed = sweep === 2 * Math.PI;
        const n = arcSegments(Math.hypot(a.x, a.y) * stretch(matrix), sweep);
        reserve(n + 1, budget);
        const physicalAt = (t: number) => transform({
          x: center.x + a.x * Math.cos(t) - normal * a.y * ratio * Math.sin(t),
          y: center.y + a.y * Math.cos(t) + normal * a.x * ratio * Math.sin(t),
        }, matrix);
        endpoints = [physicalAt(start), physicalAt(start + sweep)];
        points = Array.from({ length: n + 1 }, (_, i) => rounded(physicalAt(start + (sweep * i) / n)));
        if (closed) points.pop();
        else if (near(endpoints[0], endpoints[1])) {
          const original = drawingGeometry(points, false), candidate = points.slice(0, -1);
          if (validNormalizedRegion(candidate)) {
            reserve(candidate.length, budget);
            points = candidate; closed = true;
            normalization = normalizationRecord(original, [endpoints[1]], endpoints[0]);
          }
        }
      } else if (r.type === "SPLINE") {
        const control = e.controlPoints ?? [];
        if (control.length > MAX_ENTITY_POINTS)
          throw new DrawingComplexityError();
        const weights = r.groups
          .filter((g) => g.code === 41)
          .map((g) => Number(g.value));
        points = splinePoints(
          control.map((p) => transform(p, matrix)),
          e.knotValues ?? [],
          e.degreeOfSplineCurve ?? 0,
          weights.length ? weights : control.map(() => 1),
          budget,
        );
        closed = !!(e.closed || e.periodic);
        const original = drawingGeometry(points, closed);
        const physicalControl = control.map(p => transform(p, matrix)), origin = physicalControl[0];
        const evaluate = bspline as (t: number, degree: number, points: number[][], knots: number[], weights: number[]) => number[];
        endpoints = [0, 1].map(t => {
          const p = evaluate(t, e.degreeOfSplineCurve!, physicalControl.map(point => [point.x - origin.x, point.y - origin.y]), e.knotValues!, weights.length ? weights : control.map(() => 1));
          return { x: p[0] + origin.x, y: p[1] + origin.y };
        }) as [Point, Point];
        if (closed && !near(endpoints[0], endpoints[1]))
          throw new Error("SPLINE 标记闭合但端点不相接");
        if (near(endpoints[0], endpoints[1])) {
          const candidate = points.slice(0, -1);
          if (validNormalizedRegion(candidate)) {
            const terminal = points.at(-1)!;
            points = candidate; closed = true;
            if (!original.closed || terminal.x !== points[0].x || terminal.y !== points[0].y) {
              reserve(points.length, budget);
              normalization = normalizationRecord(original, [terminal], points[0]);
            }
          }
        }
      } else {
        const vertices = (e.vertices ?? []).slice();
        closed = !!e.shape;
        if (r.type === "LINE") {
          if (vertices.length !== 2) throw new Error("LINE 端点无效");
          reserve(2, budget);
          points = vertices.map(at);
          endpoints = vertices.map(p => transform(p, matrix)) as [Point, Point];
        } else {
          const originalPoints = polylinePoints(vertices, closed, matrix, budget);
          points = originalPoints;
          const original = drawingGeometry(originalPoints, closed);
          const returned = returnedPolylineVertices(vertices, p => transform(p, matrix));
          if (returned.endpoints.length) {
            const candidate = polylinePoints(returned.vertices, true, matrix, budget);
            if (validNormalizedRegion(candidate)) {
              points = candidate;
              closed = true;
              // An explicitly closed duplicate endpoint is ordinary DXF representation,
              // not a repair. Source coordinate precision is resolved by the sampler.
              if (!original.closed || returned.endpoints.some(p => {
                const roundedEndpoint = rounded(p), first = at(vertices[0]);
                return roundedEndpoint.x !== first.x || roundedEndpoint.y !== first.y;
              })) normalization = normalizationRecord(original, returned.endpoints, transform(vertices[0], matrix));
            }
          } else if (!closed && vertices.length >= 2 && near(transform(vertices[0], matrix), transform(vertices.at(-1)!, matrix)) && points.length > 3) {
            // An almost-full bulge can contribute a valid region despite only two source vertices.
            const candidate = points.slice(0, -1);
            if (validNormalizedRegion(candidate)) {
              points = candidate;
              closed = true;
              normalization = normalizationRecord(original, [at(vertices.at(-1)!)], at(vertices[0]));
            }
          }
        }
      }
      if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
        throw new Error("几何坐标无效");
      const shape: DrawingShape = {
        id,
        layer,
        space,
        entityType: r.type,
        points,
        closed,
        valid: false,
        sourceIds,
        ...(normalization ? { normalization } : {}),
        ...(e.color === undefined ? {} : { color: e.color }),
      };
      if (r.type === "LINE" || r.type === "ARC") {
        physicalEnds.set(shape, endpoints!);
        const key = JSON.stringify([layer, space, ctx.path]);
        const list = chains.get(key) ?? [];
        list.push(shape);
        chains.set(key, list);
      } else finish(shape);
    } catch (error) {
      if (error instanceof DrawingComplexityError) throw error;
      report(error instanceof Error ? error.message : "实体几何解析失败");
    }
  };
  const root: Context = {
    matrix: [scale, 0, 0, scale, 0, 0],
    layer: "0",
    space: "model",
    path: "",
    sourceIds: [],
    stack: [],
  };
  for (const r of source.entities) emit(r, root);
  // Unreferenced definitions still receive an inventory diagnostic if their geometry is unreadable.
  for (const [name, block] of source.blocks)
    if (!usedBlocks.has(name))
      for (const r of block.entities)
        if (!supported.has(r.type) && !annotations.has(r.type))
          diagnostic(
            `block:${name}/${get(r, 5) ?? r.index}`,
            get(r, 8) ?? "0",
            `block:${name}`,
            `未使用块 ${name} 中的实体 ${get(r, 5) ?? r.index} (${r.type}) 未读取`,
            "info",
          );
  for (const list of chains.values()) {
    type Endpoint = { point: Point; shape: DrawingShape; side: 0 | 1 };
    const buckets = new Map<string, Endpoint[]>(), ends = new Map<DrawingShape, [Endpoint, Endpoint]>();
    const cell = (p: Point) => [Math.floor(p.x / 0.001), Math.floor(p.y / 0.001)];
    for (const shape of list) {
      const pair: [Endpoint, Endpoint] = [
        { point: physicalEnds.get(shape)![0], shape, side: 0 },
        { point: physicalEnds.get(shape)![1], shape, side: 1 },
      ];
      ends.set(shape, pair);
      for (const end of pair) {
        const key = cell(end.point).join(","), bucket = buckets.get(key) ?? [];
        bucket.push(end); buckets.set(key, bucket);
      }
    }
    const candidates = new Map<Endpoint, Endpoint[]>();
    function* nearby(end: Endpoint): Generator<Endpoint> {
      const [x, y] = cell(end.point);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
        yield* buckets.get(`${x + dx},${y + dy}`) ?? [];
    }
    for (const pair of ends.values()) for (const end of pair)
      candidates.set(end, boundedEndpointMatches(end, nearby(end)));
    // A connection is accepted only when BOTH endpoints have exactly one candidate.
    // Pairwise matching never turns A-near-B-near-C into a transitive welded vertex.
    const partner = (end: Endpoint): Endpoint | undefined => {
      const matches = candidates.get(end)!;
      return matches.length === 1 && candidates.get(matches[0])!.length === 1 ? matches[0] : undefined;
    };
    const ambiguous = (end: Endpoint) => candidates.get(end)!.length > 0 && !partner(end);
    const remaining = new Set(list);
    const ordered = [...list.filter(s => ends.get(s)!.some(e => !partner(e))), ...list];
    for (const first of ordered) {
      if (!remaining.delete(first)) continue;
      const firstEnds = ends.get(first)!;
      const reverse = !!partner(firstEnds[0]) && !partner(firstEnds[1]);
      const initial = firstEnds[reverse ? 1 : 0];
      let terminal = firstEnds[reverse ? 0 : 1];
      const points = reverse ? first.points.slice().reverse() : first.points.slice();
      const originalPoints = points.slice(), sourceIds = first.sourceIds.slice(), ids = [first.id];
      const changed: { original: Point; normalized: Point; displacement: number }[] = [];
      let branch = firstEnds.some(ambiguous);
      while (true) {
        const match = partner(terminal);
        if (!match || !remaining.has(match.shape)) break;
        const next = match.shape;
        remaining.delete(next);
        const path = match.side === 0 ? next.points.slice() : next.points.slice().reverse();
        if (points.length + path.length - 1 > MAX_ENTITY_POINTS || originalPoints.length + path.length > MAX_ENTITY_POINTS)
          throw new DrawingComplexityError();
        const displacement = Math.hypot(terminal.point.x - match.point.x, terminal.point.y - match.point.y);
        if (displacement > 0) {
          originalPoints.push(...path);
          changed.push({ original: match.point, normalized: terminal.point, displacement });
        } else originalPoints.push(...path.slice(1));
        points.push(...path.slice(1));
        ids.push(next.id); sourceIds.push(...next.sourceIds);
        branch ||= ends.get(next)!.some(ambiguous);
        terminal = ends.get(next)![match.side === 0 ? 1 : 0];
      }
      const canClose = ids.length === 1 ? first.entityType === "ARC" && near(initial.point, terminal.point) : partner(terminal) === initial;
      const candidate = canClose ? points.slice(0, -1) : points;
      const validClosure = canClose && validNormalizedRegion(candidate);
      const closureGap = Math.hypot(initial.point.x - terminal.point.x, initial.point.y - terminal.point.y);
      if (validClosure && closureGap > 0) changed.push({ original: terminal.point, normalized: initial.point, displacement: closureGap });
      const exactClosed = canClose && closureGap === 0 && changed.length === 0;
      const closed = exactClosed || validClosure;
      const shape: DrawingShape = {
        ...first, id: ids.join("+"), entityType: ids.length > 1 ? "CHAIN" : first.entityType,
        points: closed ? candidate : points, sourceIds: [...new Set(sourceIds)], closed,
      };
      if (changed.length && validClosure && !branch) {
        reserve(shape.points.length, budget);
        shape.normalization = {
          original: drawingGeometry(originalPoints, false), endpointChanges: changed,
          repairLog: [`按 0.001 mm 容差连接 ${changed.length} 对唯一匹配端点；保留源采样路径。`],
        };
      } else if (changed.length) {
        // Do not apply a partial weld to an open or invalid chain.
        shape.points = originalPoints; shape.closed = false;
      }
      finish(shape, branch ? "LINE/ARC 链存在分支或端点匹配歧义，请修正或明确忽略辅助线" : undefined);
    }
  }
  for (const { r, ctx, id, layer, space } of hatches) {
    try {
      const normal = planar(r),
        matrix =
          normal === -1
            ? multiply(ctx.matrix, [-1, 0, 0, 1, 0, 0])
            : ctx.matrix;
      const paths: Point[][] = [];
      for (let i = 0; i < r.groups.length; i++)
        if (r.groups[i].code === 92) {
          if (!(Number(r.groups[i].value) & 2))
            throw new Error("暂不支持边线型 HATCH 边界");
          const groups: Group[] = [];
          while (
            i + 1 < r.groups.length &&
            r.groups[i + 1].code !== 92 &&
            r.groups[i + 1].code !== 97
          )
            groups.push(r.groups[++i]);
          const vertices: Array<Point & { bulge?: number }> = [];
          for (let j = 0; j < groups.length; j++)
            if (groups[j].code === 10) {
              const vertex: Point & { bulge?: number } = {
                x: Number(groups[j].value),
                y: NaN,
              };
              while (j + 1 < groups.length && groups[j + 1].code !== 10) {
                const g = groups[++j];
                if (g.code === 20) vertex.y = Number(g.value);
                if (g.code === 42) vertex.bulge = Number(g.value);
              }
              if (!Number.isFinite(vertex.x + vertex.y))
                throw new Error("HATCH 边界坐标无效");
              vertices.push(vertex);
            }
          if (vertices.length > MAX_ENTITY_POINTS)
            throw new DrawingComplexityError();
          paths.push(polylinePoints(vertices, true, matrix, budget));
        }
      if (paths.length === 0 || paths.length !== num(r, 91))
        throw new Error("HATCH 边界未读取完整");
      const onBoundary = (point: Point, path: Point[]) =>
        path.some(
          (p, i) =>
            pointSegmentDistance(point, p, path[(i + 1) % path.length]) <= 0.05,
        );
      const matched = paths.every((path) => {
        const box = bounds(path);
        return doc.shapes.some((shape) => {
          if (!shape.closed || !shape.valid || shape.space !== space)
            return false;
          const other = bounds(shape.points);
          if (
            Math.abs(box.minX - other.minX) > 0.05 ||
            Math.abs(box.minY - other.minY) > 0.05 ||
            Math.abs(box.maxX - other.maxX) > 0.05 ||
            Math.abs(box.maxY - other.maxY) > 0.05
          )
            return false;
          return (
            path.every((p) => onBoundary(p, shape.points)) &&
            shape.points.every((p) => onBoundary(p, path))
          );
        });
      });
      diagnostic(
        `${id}:source`,
        layer,
        space,
        matched
          ? `实体 ${get(r, 5) ?? r.index} (HATCH)：填充边界与已有闭合轮廓一致，保留为显示对象`
          : `实体 ${get(r, 5) ?? r.index} (HATCH)：存在未匹配的填充边界；请导出独立闭合轮廓或明确忽略此对象`,
        matched ? "info" : "blocking",
      );
    } catch (error) {
      if (error instanceof DrawingComplexityError) throw error;
      diagnostic(
        `${id}:source`,
        layer,
        space,
        `实体 ${get(r, 5) ?? r.index} (HATCH)：${error instanceof Error ? error.message : "边界解析失败"}；请导出独立闭合轮廓或明确忽略此对象`,
      );
    }
  }

  return doc;
}
