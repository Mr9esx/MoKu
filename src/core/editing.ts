import {
  bounds,
  polygonArea,
  transformPoints,
  validateLayout,
} from "./geometry";
import type { Layout, NestSettings, Part, Placement, Project } from "./types";
/** Editing shows all stock inventory; compact layout sheets still govern metrics/export. */
export function editingLayout(project: Project, layout: Layout): Layout {
  return { ...layout, sheets: project.sheets };
}

/** Reintroduce only a newly used stock to the stored compact layout. */
export function includeStock(
  project: Project,
  layout: Layout,
  sheetId: string,
): Layout {
  return {
    ...layout,
    sheets: project.sheets.filter(
      (stock) =>
        stock.id === sheetId ||
        layout.sheets.some((existing) => existing.id === stock.id),
    ),
  };
}

export type PartInput = {
  name: string;
  shape: "rectangle" | "circle";
  width: number;
  height: number;
  thickness: number;
  material?: string;
  quantity?: number;
  place?: boolean;
};
export type StockInput = {
  material?: string;
  name: string;
  width: number;
  height: number;
  thickness: number;
};
export function makePart(input: PartInput, id: string, stockId: string): Part {
  const { width: w, thickness: t } = input,
    h = input.shape === "circle" ? w : input.height;
  if (
    ![w, h, t].every(Number.isFinite) ||
    w <= 0 ||
    h <= 0 ||
    w > 10000 ||
    h > 10000 ||
    t < 1 ||
    t > 100
  )
    throw Error("尺寸需大于 0 且不超过 10000 mm，板厚 1–100 mm");
  const n = Math.max(
    16,
    4 * Math.ceil(Math.PI / Math.acos(1 - Math.min(0.1, w / 4) / (w / 2)) / 4),
  );
  const outline =
    input.shape === "circle"
      ? Array.from({ length: n }, (_, i) => ({
          x: w / 2 + (Math.cos((i * 2 * Math.PI) / n) * w) / 2,
          y: h / 2 + (Math.sin((i * 2 * Math.PI) / n) * h) / 2,
        }))
      : [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ];
  return {
    id,
    name: input.name.trim() || "新零件",
    stockId,
    material: input.material,
    source: "手动创建",
    layer: "CUSTOM",
    thickness: t,
    width: w,
    height: h,
    area: polygonArea(outline),
    outline,
    holes: [],
    pockets: [],
    label: { x: w / 2, y: h / 2 },
  };
}
/** Bounded anchors: at most 24 x 24 per compatible stock. Full independent validation follows. */
export function findInitialPlacement(
  project: Project,
  layout: Layout,
  part: Part,
  s: NestSettings,
): Placement | null {
  const occupied = layout.placements.map((p) => {
    const v = project.parts.find((v) => v.id === p.partId)!;
    return { p, part: v, bounds: bounds(transformPoints(v.outline, v, p)) };
  });
  for (const sheet of layout.sheets.filter(
    (v) =>
      v.thickness === part.thickness &&
      (!part.material || v.material === part.material),
  )) {
    const onSheet = occupied.filter((v) => v.p.sheetId === sheet.id);
    const xs = new Set([s.margin, sheet.width - s.margin - part.width]),
      ys = new Set([s.margin, sheet.height - s.margin - part.height]);
    for (const v of onSheet) {
      xs.add(v.bounds.maxX + s.gap);
      ys.add(v.bounds.maxY + s.gap);
    }
    for (let i = 1; i < 8; i++) {
      xs.add(s.margin + ((sheet.width - 2 * s.margin - part.width) * i) / 8);
      ys.add(s.margin + ((sheet.height - 2 * s.margin - part.height) * i) / 8);
    }
    for (const y of [...ys].sort((a, b) => a - b).slice(0, 24))
      for (const x of [...xs].sort((a, b) => a - b).slice(0, 24)) {
        if (
          x < s.margin ||
          y < s.margin ||
          x + part.width > sheet.width - s.margin ||
          y + part.height > sheet.height - s.margin
        )
          continue;
        const p: Placement = {
          partId: part.id,
          sheetId: sheet.id,
          x,
          y,
          rotation: 0,
        };
        // Distant contours cannot overlap or violate gap. Restrict the independent
        // validator to geometrically relevant neighbors, avoiding repeated validation
        // of unrelated imported geometry at each bounded search anchor.
        const near = onSheet.filter((v) => {
          const b = v.bounds;
          const dx = Math.max(0, b.minX - x - part.width, x - b.maxX),
            dy = Math.max(0, b.minY - y - part.height, y - b.maxY);
          return Math.hypot(dx, dy) <= s.gap + 1e-7;
        });
        const checkProject = {
          ...project,
          parts: [part, ...near.map((v) => v.part)],
          original: layout,
        };
        const next = {
          sheets: layout.sheets,
          placements: [p, ...near.map((v) => v.p)],
        };
        const issues = validateLayout(checkProject, next, s);
        if (
          !issues.some(
            (v) => v.partIds.includes(part.id) || v.partIds.length === 0,
          )
        )
          return p;
      }
  }
  return null;
}
export type Guide = { axis: "x" | "y"; value: number };
export function snapPlacement(
  project: Project,
  layout: Layout,
  p: Placement,
  s: NestSettings,
  threshold: number,
  enabled: boolean,
): { placement: Placement; guides: Guide[] } {
  const part = project.parts.find((v) => v.id === p.partId),
    sheet = layout.sheets.find((v) => v.id === p.sheetId);
  if (!enabled || !part || !sheet) return { placement: p, guides: [] };
  const b = bounds(transformPoints(part.outline, part, p));
  const gapTargets: {
    x: { anchor: number; target: number }[];
    y: { anchor: number; target: number }[];
  } = { x: [], y: [] };
  const targets = {
    x: [s.margin, sheet.width - s.margin, sheet.width / 2],
    y: [s.margin, sheet.height - s.margin, sheet.height / 2],
  };
  for (const other of layout.placements.filter(
    (v) => v.partId !== p.partId && v.sheetId === p.sheetId,
  )) {
    const q = project.parts.find((v) => v.id === other.partId)!;
    const n = bounds(transformPoints(q.outline, q, other));
    targets.x.push(n.minX, n.maxX, (n.minX + n.maxX) / 2);
    gapTargets.x.push(
      { anchor: b.maxX, target: n.minX - s.gap },
      { anchor: b.minX, target: n.maxX + s.gap },
    );
    targets.y.push(n.minY, n.maxY, (n.minY + n.maxY) / 2);
    gapTargets.y.push(
      { anchor: b.maxY, target: n.minY - s.gap },
      { anchor: b.minY, target: n.maxY + s.gap },
    );
  }
  const placement = { ...p },
    guides: Guide[] = [];
  for (const axis of ["x", "y"] as const) {
    const anchors =
      axis === "x"
        ? [b.minX, b.maxX, (b.minX + b.maxX) / 2]
        : [b.minY, b.maxY, (b.minY + b.maxY) / 2];
    let best = threshold + 1,
      target = 0;
    for (const t of targets[axis])
      for (const a of anchors) {
        const d = t - a;
        if (Math.abs(d) <= threshold && Math.abs(d) < Math.abs(best)) {
          best = d;
          target = t;
        }
      }
    for (const pair of gapTargets[axis]) {
      const d = pair.target - pair.anchor;
      if (Math.abs(d) <= threshold && Math.abs(d) < Math.abs(best)) {
        best = d;
        target = pair.target;
      }
    }
    if (Math.abs(best) <= threshold) {
      placement[axis] += best;
      guides.push({ axis, value: target });
    }
  }
  return { placement, guides };
}
