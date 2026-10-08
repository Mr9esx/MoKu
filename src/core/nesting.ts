import type {
  Project,
  NestSettings,
  NestResult,
  Layout,
  LayoutMetrics,
  Part,
  Placement,
  Rotation,
  Stock,
} from "./types";
import {
  bounds,
  placedOutline,
  contoursOverlap,
  contourDistance,
  validateLayout,
  measureLayout,
} from "./geometry";

const EPS = 1e-7;
// Fixed wall-clock and candidate limits bound even unusually large imported projects.
const MAX_MS = 5000;
const MAX_CANDIDATES = 60000;
// Bounded sorted axes and lazy grid/contact merge avoid allocating xs × ys.
export function* anchorCandidates(
  xs: Iterable<number>,
  ys: Iterable<number>,
  contacts: Iterable<{ x: number; y: number }>,
  variant: number,
  exhausted: () => boolean,
): Generator<{ x: number; y: number }> {
  function collect(values: Iterable<number>) {
    const result: number[] = [];
    const iterator = values[Symbol.iterator]();
    while (result.length < 512 && !exhausted()) {
      const next = iterator.next();
      if (next.done) break;
      result.push(next.value);
    }
    return result.sort((a, b) => a - b);
  }
  const xValues = collect(xs),
    yValues = collect(ys);
  if (exhausted()) return;
  const contactValues: { x: number; y: number }[] = [];
  for (const contact of contacts) {
    if (exhausted()) return;
    contactValues.push(contact);
    if (contactValues.length === 5760) break;
  }
  const compare = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    variant % 2 ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x;
  contactValues.sort(compare);
  let contactIndex = 0;
  const outer = variant % 2 ? xValues : yValues,
    inner = variant % 2 ? yValues : xValues;
  for (const a of outer)
    for (const b of inner) {
      if (exhausted()) return;
      const grid = variant % 2 ? { x: a, y: b } : { x: b, y: a };
      while (
        contactIndex < contactValues.length &&
        compare(contactValues[contactIndex], grid) <= 0
      ) {
        if (exhausted()) return;
        yield contactValues[contactIndex++];
      }
      yield grid;
    }
  while (contactIndex < contactValues.length) {
    if (exhausted()) return;
    yield contactValues[contactIndex++];
  }
}
export function optimizeLayout(
  project: Project,
  settings: NestSettings,
  onProgress?: (attempt: number, best: LayoutMetrics | null, bestLayout?: Layout) => void,
): NestResult {
  if (
    !["utilization", "machining", "remnant"].includes(settings.mode) ||
    typeof settings.allowRotation !== "boolean" ||
    [
      settings.gap,
      settings.margin,
      settings.minRemnantWidth,
      settings.minRemnantHeight,
      settings.iterations,
    ].some((v) => !Number.isFinite(v) || v < 0)
  )
    throw new Error("排版参数无效：需要有限非负数和已知模式");
  const start = performance.now(),
    deadline = start + MAX_MS;
  let candidates = 0,
    attempts = 0;
  const exhausted = () =>
    performance.now() >= deadline || candidates >= MAX_CANDIDATES;
  const parts = new Map(project.parts.map((p) => [p.id, p]));
  const originalMetrics = measureLayout(project, project.original, settings);
  const sourceIssues = validateLayout(project, project.original, settings);
  let best: Layout | null = null,
    metrics: LayoutMetrics | null = null;
  function active(layout: Layout): Layout {
    const used = new Set(layout.placements.map((p) => p.sheetId));
    return {
      sheets: layout.sheets
        .filter((s) => used.has(s.id))
        .map((s) => ({ ...s })),
      placements: layout.placements.map((p) => ({ ...p })),
    };
  }
  function extent(layout: Layout) {
    return layout.sheets.reduce((sum, s) => {
      const boxes = layout.placements
        .filter((p) => p.sheetId === s.id)
        .map((p) => bounds(placedOutline(parts.get(p.partId)!, p)));
      return (
        sum +
        Math.max(0, ...boxes.map((b) => b.maxX)) *
          Math.max(0, ...boxes.map((b) => b.maxY))
      );
    }, 0);
  }
  function rank(layout: Layout, m: LayoutMetrics): number[] {
    if (settings.mode === "machining")
      return [m.sheetCount, m.travel, extent(layout)];
    if (settings.mode === "remnant")
      return [m.sheetCount, -m.reusableArea, extent(layout), m.travel];
    return [m.sheetCount, extent(layout), m.travel];
  }
  function better(layout: Layout, m: LayoutMetrics) {
    if (!best || !metrics) return true;
    const a = rank(layout, m),
      b = rank(best, metrics);
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > EPS) return a[i] < b[i];
    }
    return false;
  }
  let lastCheckpoint = -Infinity;
  let checkpoint: Layout | null = null;
  function publish(force = false) {
    if (best && best !== checkpoint && (force || performance.now() - lastCheckpoint >= 100)) {
      onProgress?.(attempts, metrics, best);
      checkpoint = best;
      lastCheckpoint = performance.now();
    }
  }
  function consider(layout: Layout) {
    const result = active(layout);
    if (validateLayout(project, result, settings).length) return;
    const m = measureLayout(project, result, settings);
    if (better(result, m)) {
      best = result;
      metrics = m;
      publish();
    }
  }
  if (!sourceIssues.length) consider(project.original);
  const rotations = new Map<string, Rotation[]>();
  const oriented = new Map<string, ReturnType<typeof placedOutline>>();
  for (const part of project.parts) {
    const seen = new Set<string>();
    rotations.set(
      part.id,
      (settings.allowRotation ? [0, 90, 180, 270] : [0]).filter((r) => {
        const poly = placedOutline(part, {
          partId: part.id,
          sheetId: "",
          x: 0,
          y: 0,
          rotation: r as Rotation,
        });
        oriented.set(`${part.id}:${r}`, poly);
        const key = poly
          .map((v) => `${v.x.toFixed(6)},${v.y.toFixed(6)}`)
          .sort()
          .join(";");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }) as Rotation[],
    );
  }
  function compatible(part: Part, sheet: Stock) {
    const source = project.sheets.find((s) => s.id === part.stockId);
    return (
      part.thickness === sheet.thickness &&
      (!source || source.material === sheet.material)
    );
  }
  function options(
    part: Part,
    others: Placement[],
    sheet: Stock,
    variant: number,
  ) {
    const existing: {
      poly: ReturnType<typeof placedOutline>;
      box: ReturnType<typeof bounds>;
    }[] = [];
    for (const p of others) {
      if (exhausted()) return [];
      if (p.sheetId !== sheet.id) continue;
      const poly = placedOutline(parts.get(p.partId)!, p);
      existing.push({ poly, box: bounds(poly) });
    }
    const found: Placement[] = [];
    for (const rotation of rotations.get(part.id)!) {
      const origin = {
        partId: part.id,
        sheetId: sheet.id,
        x: 0,
        y: 0,
        rotation,
      };
      const poly = oriented.get(`${part.id}:${rotation}`)!,
        box = bounds(poly);
      const xs = new Set([
        settings.margin - box.minX,
        sheet.width - settings.margin - box.maxX,
      ]);
      const ys = new Set([
        settings.margin - box.minY,
        sheet.height - settings.margin - box.maxY,
      ]);
      for (const { box: b } of existing) {
        if (exhausted()) return found;
        if (xs.size >= 512 || ys.size >= 512) break;
        xs.add(b.maxX + settings.gap - box.minX);
        xs.add(b.minX - settings.gap - box.maxX);
        xs.add(b.minX - box.minX);
        ys.add(b.maxY + settings.gap - box.minY);
        ys.add(b.minY - settings.gap - box.maxY);
        ys.add(b.minY - box.minY);
      }
      // Contour vertex contacts admit overlapping bounding boxes for concave parts.
      const contacts: { x: number; y: number }[] = [];
      for (const e of existing.slice(0, 20))
        for (const a of e.poly.slice(0, 12))
          for (const b of poly.slice(0, 12)) {
            if (exhausted()) return found;
            contacts.push(
              { x: a.x - b.x + settings.gap, y: a.y - b.y },
              { x: a.x - b.x, y: a.y - b.y + settings.gap },
            );
          }
      const anchors = anchorCandidates(xs, ys, contacts, variant, exhausted);
      for (const anchor of anchors) {
        if (exhausted()) return found;
        candidates++;
        const p = { ...origin, ...anchor },
          bb = {
            minX: box.minX + p.x,
            maxX: box.maxX + p.x,
            minY: box.minY + p.y,
            maxY: box.maxY + p.y,
          };
        if (
          bb.minX < settings.margin - EPS ||
          bb.minY < settings.margin - EPS ||
          bb.maxX > sheet.width - settings.margin + EPS ||
          bb.maxY > sheet.height - settings.margin + EPS
        )
          continue;
        const contour = poly.map((v) => ({ x: v.x + p.x, y: v.y + p.y }));
        const illegal = existing.some((e) => {
          const dx = Math.max(0, bb.minX - e.box.maxX, e.box.minX - bb.maxX),
            dy = Math.max(0, bb.minY - e.box.maxY, e.box.minY - bb.maxY);
          return (
            Math.hypot(dx, dy) <= settings.gap + EPS &&
            (contoursOverlap(contour, e.poly) ||
              contourDistance(contour, e.poly) < settings.gap - EPS)
          );
        });
        if (!illegal) {
          found.push(p);
          if (found.length >= 8) return found;
        }
      }
    }
    return found;
  }
  const locked = project.original.placements
    .filter((p) => p.locked)
    .map((p) => ({ ...p }));
  const limit = Math.min(100, Math.floor(settings.iterations));
  for (let iteration = 0; iteration < limit && !exhausted(); iteration++) {
    // Relocate individual parts from the validated incumbent, retaining its dense packing.
    if (best) {
      const moving = [...(best as Layout).placements]
        .filter((p) => !p.locked)
        .sort((a, b) => (iteration % 2 ? a.x - b.x : b.y - a.y));
      for (const current of moving) {
        if (exhausted()) break;
        const incumbent = best as Layout,
          others = incumbent.placements.filter(
            (p) => p.partId !== current.partId,
          ),
          part = parts.get(current.partId)!;
        for (const sheet of project.sheets.filter((s) => compatible(part, s))) {
          for (const p of options(
            part,
            others,
            sheet,
            iteration + (settings.mode === "machining" ? 1 : 0),
          )) {
            if (exhausted()) break;
            consider({ sheets: project.sheets, placements: [...others, p] });
          }
        }
      }
    }
    // Independent restart prioritizes hard/large parts and varies rows versus columns.
    const order = project.parts
      .filter((p) => !locked.some((l) => l.partId === p.id))
      .sort((a, b) =>
        iteration % 3 === 0
          ? b.area - a.area
          : iteration % 3 === 1
            ? Math.max(b.width, b.height) - Math.max(a.width, a.height)
            : b.height - a.height,
      );
    const placed = [...locked];
    for (const part of order) {
      if (exhausted()) break;
      let chosen: Placement | undefined;
      const sheets = [...project.sheets].sort(
        (a, b) =>
          Number(!placed.some((p) => p.sheetId === a.id)) -
          Number(!placed.some((p) => p.sheetId === b.id)),
      );
      for (const sheet of sheets) {
        if (!compatible(part, sheet)) continue;
        chosen = options(
          part,
          placed,
          sheet,
          iteration + (settings.mode === "machining" ? 1 : 0),
        )[0];
        if (chosen) break;
      }
      if (!chosen) break;
      placed.push(chosen);
    }
    if (placed.length === project.parts.length)
      consider({ sheets: project.sheets, placements: placed });
    attempts++;
    publish(true);
    onProgress?.(attempts, metrics);
  }
  return {
    layout: best,
    metrics,
    originalMetrics,
    attempts,
    elapsedMs: performance.now() - start,
    message: best
      ? "已找到并验证可行排版（有限预算启发式）"
      : "预算内未找到满足当前间距、边距、锁定与板材约束的完整排版",
    issues: best ? [] : sourceIssues,
  };
}
