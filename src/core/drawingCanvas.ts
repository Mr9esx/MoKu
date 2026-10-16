import { fitCanvasViewport } from "./canvasViewport";
import { resolveDrawingRule } from "./drawingReview";
import type { DrawingDocument, DrawingRole, DrawingRules } from "./drawingTypes";
import type { Point } from "./types";

export function fitDrawingCanvas(points: Point[], viewport: { width: number; height: number }) {
  const finite = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of finite) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  if (!finite.length) { minX = minY = 0; maxX = maxY = 100; }
  const fit = fitCanvasViewport({ width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }, viewport,
    { left: 30, right: 30, top: 30, bottom: 30 });
  return { ...fit, x: fit.x + minX, y: fit.y - maxY };
}

export function selectDrawingShape(ids: string[], id: string, extend: boolean): string[] {
  if (!extend) return [id];
  return ids.includes(id) ? ids.filter(selected => selected !== id) : [...ids, id];
}

/** A purpose-only action retains each selected shape's own parameters. */
export function drawingSelectionRules(document: DrawingDocument, ids: string[], layerRules: DrawingRules, shapeRules: DrawingRules, role: DrawingRole): DrawingRules {
  const result: DrawingRules = {};
  for (const shape of document.shapes) if (ids.includes(shape.id)) {
    result[shape.id] = { ...resolveDrawingRule(shape, layerRules, shapeRules), role };
  }
  return result;
}
