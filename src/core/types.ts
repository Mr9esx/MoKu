export type Point = { x: number; y: number };
export type Rotation = 0 | 90 | 180 | 270;
export type Mode = "utilization" | "machining" | "remnant";
export const modeLabels: Record<Mode, string> = {
  utilization: "利用率优先",
  machining: "加工优先",
  remnant: "余料优先",
};
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
  material?: string;
  source?: string;
  layer: string;
  thickness: number;
  width: number;
  height: number;
  area: number;
  outline: Point[];
  holes: Point[][];
  pockets: Pocket[];
  label: Point;
  /** Association evidence for labels outside a concave contour; source position is preserved. */
  labelAssociation?: "notch" | "nearest";
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
  sourceFiles?: Project[];
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
  searchSeconds?: number;
  stopRule?: "limits" | "patience";
  patienceGenerations?: number;
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
export type EfficiencyPoint = { generation: number; efficiency: number | null; unchanged: number };
export type SearchProgress = {
  group: number;
  groups: number;
  material: string;
  thickness: number;
  generation: number;
  generationLimit: number;
  phase: "preparing" | "searching" | "finalizing";
  elapsedMs: number;
  timeLimitMs: number;
  scope?: "repair-nearby" | "repair-full";
  patience?: { limit: number; unchanged: number };
  curve?: EfficiencyPoint[];
  rounds?: number;
  evaluations?: number;
  restarts?: number;
};
export type NestResult = {
  layout: Layout | null;
  metrics: LayoutMetrics | null;
  originalMetrics: LayoutMetrics;
  attempts: number;
  elapsedMs: number;
  search?: {
    engine?: string;
    improved?: boolean;
    groups?: number;
    generations?: number;
    evaluations?: number;
    restarts?: number;
    seed?: number;
    nfpPairs?: number;
    feasible?: number;
    seconds: number;
    candidates: number;
    candidateLimit: number;
    stoppedBy: "time" | "candidates" | "iterations" | "disabled" | "plateau" | "manual" | "exhausted";
    patienceLimit?: number;
    unchanged?: number;
    rounds?: number;
    curve?: EfficiencyPoint[];
  };
  message: string;
  issues: LayoutIssue[];
};
