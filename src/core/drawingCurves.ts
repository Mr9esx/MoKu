// https://github.com/thibauts/b-spline
// b-spline's documented rational de Boor evaluator has no published TypeScript declarations.
// @ts-expect-error Untyped dependency; its API is narrowed at this boundary.
import bspline from "b-spline";
import type { Point } from "./types";
export const CURVE_ERROR = 0.025;
export const MAX_ENTITY_POINTS = 4096;
export const MAX_TOTAL_POINTS = 50000;
export class DrawingComplexityError extends Error {
  constructor() {
    super(
      "图纸轮廓过于复杂：每个实体最多 4096 个采样顶点，总计最多 50000 个；块实例最多 10000 个，请拆分图纸后导入",
    );
  }
}
export type PointBudget = { used: number };
export function reserve(count: number, budget: PointBudget) {
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > MAX_ENTITY_POINTS ||
    budget.used + count > MAX_TOTAL_POINTS
  )
    throw new DrawingComplexityError();
  budget.used += count;
}
export function rounded(p: Point): Point {
  return { x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 };
}
export function arcSegments(radiusBound: number, sweep: number) {
  if (!Number.isFinite(radiusBound) || radiusBound <= 0)
    throw new Error("曲线尺寸无效");
  const step = 2 * Math.acos(Math.max(-1, 1 - CURVE_ERROR / radiusBound));
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / step));
  if (!Number.isSafeInteger(n) || n + 1 > MAX_ENTITY_POINTS)
    throw new DrawingComplexityError();
  return n;
}
// Rational curves remain inside their weighted control hull for positive weights.
// Bounds of homogeneous derivative control vectors bound F'' on each knot span;
// the linear interpolation error is at most max|F''| * parameterStep² / 8.
export function splinePoints(
  points: Point[],
  knots: number[],
  degree: number,
  weights: number[],
  budget: PointBudget,
): Point[] {
  if (
    !Number.isInteger(degree) ||
    degree < 1 ||
    degree > 16 ||
    points.length <= degree ||
    knots.length !== points.length + degree + 1 ||
    weights.length !== points.length ||
    weights.some((w) => !Number.isFinite(w) || w <= 0) ||
    knots.some((k, i) => !Number.isFinite(k) || (i > 0 && k < knots[i - 1]))
  )
    throw new Error(
      "SPLINE 控制点、阶数、节点或权重无效（需正权重控制点样条）",
    );
  if (points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error("SPLINE 控制点坐标无效");
  const low = knots[degree],
    high = knots[points.length];
  if (!(high > low)) throw new Error("SPLINE 参数范围无效");
  // Discontinuities cannot be connected by fabricated segments.
  for (let i = degree + 1; i < points.length; i++)
    if (knots[i] > low && knots[i] < high) {
      let count = 1;
      while (i + 1 < knots.length && knots[i + 1] === knots[i]) {
        count++;
        i++;
      }
      if (count > degree) throw new Error("SPLINE 包含不连续节点，请拆分曲线");
    }
  const origin = points[0];
  const homogeneous = points.map((p, i) => [
    (p.x - origin.x) * weights[i],
    (p.y - origin.y) * weights[i],
    weights[i],
  ]);
  const derivative = (data: number[][], p: number, u: number[]) =>
    data.slice(0, -1).map((a, i) => {
      const span = u[i + p + 1] - u[i + 1];
      return a.map((v, j) =>
        span === 0 ? 0 : (p * (data[i + 1][j] - v)) / span,
      );
    });
  const first = derivative(homogeneous, degree, knots),
    second =
      degree > 1 ? derivative(first, degree - 1, knots.slice(1, -1)) : [];
  const bound = (data: number[][], weight = false) =>
    Math.max(
      0,
      ...data.map((v) => (weight ? Math.abs(v[2]) : Math.hypot(v[0], v[1]))),
    );
  const w = Math.min(...weights),
    x = bound(homogeneous),
    dx = bound(first),
    ddx = bound(second),
    dw = bound(first, true),
    ddw = bound(second, true);
  const acceleration =
    ddx / w +
    (x * ddw) / (w * w) +
    (2 * dx * dw) / (w * w) +
    (2 * x * dw * dw) / (w * w * w);
  const spans: { a: number; b: number; n: number }[] = [];
  let count = 1;
  for (let i = degree; i < points.length; i++)
    if (knots[i + 1] > knots[i]) {
      const a = knots[i],
        b = knots[i + 1],
        n = Math.max(
          1,
          Math.ceil((b - a) * Math.sqrt(acceleration / (8 * CURVE_ERROR))),
        );
      count += n;
      if (!Number.isSafeInteger(count) || count > MAX_ENTITY_POINTS)
        throw new DrawingComplexityError();
      spans.push({ a, b, n });
    }
  reserve(count, budget);
  const evaluate = bspline as (
    t: number,
    degree: number,
    points: number[][],
    knots: number[],
    weights: number[],
  ) => number[];
  const input = points.map((p) => [p.x - origin.x, p.y - origin.y]);
  const at = (u: number) => {
    const p = evaluate(
      Math.min(1, Math.max(0, (u - low) / (high - low))),
      degree,
      input,
      knots,
      weights,
    );
    if (!p.every(Number.isFinite)) throw new Error("SPLINE 计算产生无效坐标");
    return rounded({ x: p[0] + origin.x, y: p[1] + origin.y });
  };
  const result = [at(low)];
  for (const { a, b, n } of spans)
    for (let i = 1; i <= n; i++) result.push(at(a + ((b - a) * i) / n));
  return result;
}
