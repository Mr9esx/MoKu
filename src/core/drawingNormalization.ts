import type { Point } from './types';
import type { DrawingGeometry, DrawingNormalization, DrawingRule, DrawingShape } from './drawingTypes';
import { validContour } from './geometry';

export const ENDPOINT_TOLERANCE_MM = 0.001;
export const endpointDistance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
// The tiny numerical allowance only compensates for arithmetic at the inclusive boundary.
export const endpointsMatch = (a: Point, b: Point) => endpointDistance(a, b) <= ENDPOINT_TOLERANCE_MM + 1e-12;
export function drawingGeometry(points: Point[], closed: boolean, reason?: string): DrawingGeometry {
  const pathValid = !reason && points.length >= 2 && points.every((p, i) => Number.isFinite(p.x) && Number.isFinite(p.y) && (i === 0 || endpointDistance(p, points[i - 1]) > 1e-6));
  return { points, closed, valid: !reason && closed && validNormalizedRegion(points), pathValid };
}
export function validNormalizedRegion(points: Point[]) {
  return points.length >= 3 && points.every((p, i) => endpointDistance(p, points[(i + 1) % points.length]) > 1e-6) && validContour(points);
}
export function normalizationRecord(original: DrawingGeometry, endpoints: Point[], first: Point): DrawingNormalization {
  return {
    original,
    endpointChanges: endpoints.map(point => ({ original: point, normalized: first, displacement: endpointDistance(point, first) })),
    repairLog: [`按 ${ENDPOINT_TOLERANCE_MM} mm 端点容差归一化，保留首点与真实弧段；移除 ${endpoints.length} 个返回端点，最大位移 ${Math.max(...endpoints.map(point => endpointDistance(point, first))).toFixed(6)} mm。`],
  };
}
/** Remove returned vertices before tessellation, never delete a bulged outgoing arc. */
export function returnedPolylineVertices<T extends Point & { bulge?: number }>(vertices: T[], physical: (point: Point) => Point) {
  const derived = vertices.slice(), endpoints: Point[] = [];
  while (derived.length > 2 && endpointsMatch(physical(derived[0]), physical(derived.at(-1)!)) && !(derived.at(-1)!.bulge ?? 0)) {
    endpoints.push(physical(derived.pop()!));
  }
  return { vertices: derived, endpoints };
}
/** Resolve once at every geometry consumer; centerlines retain the source open path. */
export function effectiveDrawingShape(shape: DrawingShape, rule: DrawingRule): DrawingShape {
  const original = shape.normalization?.original;
  if (original && (rule.geometrySource === 'original' || (rule.role === 'pocket' && rule.pocketGeometry === 'centerline' && !original.closed))) return { ...shape, ...original };
  return shape;
}

/** Only zero, one, or ambiguous matches are needed; stop at the second match. */
export function boundedEndpointMatches<T extends { point: Point; shape: unknown }>(endpoint: T, neighbors: Iterable<T>): T[] {
  const matches: T[] = [];
  for (const other of neighbors) {
    if (other.shape !== endpoint.shape && endpointsMatch(endpoint.point, other.point)) {
      matches.push(other);
      if (matches.length === 2) break;
    }
  }
  return matches;
}
