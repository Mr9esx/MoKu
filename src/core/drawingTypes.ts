import type { Point } from "./types";
export type DrawingRole = "unknown" | "outer" | "hole" | "pocket" | "stock" | "ignore";
export type DrawingRule = { role: DrawingRole; depth?: number; thickness?: number; pocketGeometry?: "area" | "centerline" | "close-boundary"; slotWidth?: number; geometrySource?: "normalized" | "original" };
export type DrawingRules = Record<string, DrawingRule>;
export type DrawingGeometry = { points: Point[]; closed: boolean; valid: boolean; pathValid: boolean };
export type DrawingNormalization = {
  original: DrawingGeometry;
  endpointChanges: Array<{ original: Point; normalized: Point; displacement: number }>;
  repairLog: string[];
};
export type DrawingShape = {
  id: string; layer: string; space: string; entityType: string;
  points: Point[]; closed: boolean; valid: boolean; pathValid?: boolean; sourceIds: string[]; color?: number; normalization?: DrawingNormalization;
};
export type DrawingLabel = { id: string; layer: string; space: string; text: string; point: Point };
export type DrawingDiagnostic = { id: string; layer: string; space: string; message: string; severity: "info" | "blocking"; shapeId?: string; shapeIds?: string[]; eligibleStockIds?: string[]; code?: "open-path" | "invalid-geometry" | "placement-conflict" | "relationship-conflict" };
export type DrawingDocument = {
  name: string; importInfo: { sourceUnit: string; scale: number; overridden: boolean };
  unitKnown: boolean; spaces: string[]; shapes: DrawingShape[]; labels: DrawingLabel[]; diagnostics: DrawingDiagnostic[];
};
