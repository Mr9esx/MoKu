export type Point = { x: number; y: number };
export type Rotation = 0 | 90 | 180 | 270;
export type Mode = "utilization" | "machining" | "remnant";
export type Stock = {
  id: string;
  name: string;
  width: number;
  height: number;
  thickness: number;
  material: string;
};
export type Pocket = { outline: Point[]; depth: number | null };
export type Part = {
  id: string;
  name: string;
  stockId: string;
  layer: string;
  thickness: number;
  width: number;
  height: number;
  area: number;
  outline: Point[];
  holes: Point[][];
  pockets: Pocket[];
  label: Point;
};
export type Placement = {
  partId: string;
  sheetId: string;
  x: number;
  y: number;
  rotation: Rotation;
  locked?: boolean;
};
export type Layout = { sheets: Stock[]; placements: Placement[] };
export type Project = {
  importedSource?: Project;
  name: string;
  units: "mm";
  sheets: Stock[];
  parts: Part[];
  original: Layout;
  warnings: string[];
};
export type NestSettings = {
  mode: Mode;
  gap: number;
  margin: number;
  allowRotation: boolean;
  minRemnantWidth: number;
  minRemnantHeight: number;
  iterations: number;
};
export type LayoutIssue = {
  kind: "missing" | "overlap" | "gap" | "boundary" | "thickness" | "invalid";
  message: string;
  partIds: string[];
};
export type Remnant = {
  sheetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
};
export type LayoutMetrics = {
  sheetCount: number;
  utilization: number;
  outlineArea: number;
  stockArea: number;
  travel: number;
  remnants: Remnant[];
  reusableArea: number;
};
export type NestResult = {
  layout: Layout | null;
  metrics: LayoutMetrics | null;
  originalMetrics: LayoutMetrics;
  attempts: number;
  elapsedMs: number;
  message: string;
  issues: LayoutIssue[];
};
