// Frozen previous local solver, for regression comparisons only. Never imported by application code.
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
} from "../../src/core/types";
import {
  bounds,
  placedOutline,
  contoursOverlap,
  contourDistance,
  validateLayout,
  measureLayout,
  polygonArea,
  concentratedRemnantArea,
} from "../../src/core/geometry";



const EPS = 1e-7;
// User-selected time and proportional check limits bound large imported projects.
const DEFAULT_SECONDS = 5;

/** Slide a feasible layout towards a sheet corner, independently of mode scores.
 * Only complete, clearance-checked moves are committed; stopping returns a legal
 * partial compaction. Rotation, sheet assignment and locked parts are preserved.
 */
export function compactLayout(
  project: Project,
  layout: Layout,
  settings: NestSettings,
  exhausted: () => boolean = () => false,
  axes: readonly ("x" | "y")[] = ["x", "y"],
  direction: 1 | -1 = -1,
): Layout {
  const result: Layout = { sheets: layout.sheets.map(s => ({...s})),
    placements: layout.placements.map(p => ({...p})) };
  const parts = new Map(project.parts.map(p => [p.id,p]));
  const stocks = new Map(layout.sheets.map(s => [s.id,s]));
  const geometry = new Map(result.placements.map(p => {
    const poly = placedOutline(parts.get(p.partId)!,p);
    const box=bounds(poly);
    return [p.partId, {poly,box,rectangle:Math.abs(polygonArea(poly)-box.width*box.height)<EPS}];
  }));
  for (let pass=0;pass<8;pass++) {
    let moved=false;
    for (const axis of axes) {
      const min = axis === "x" ? "minX" : "minY";
      const max = axis === "x" ? "maxX" : "maxY";
      const edge=direction===-1 ? min : max;
      const moving = result.placements.filter(p => !p.locked)
        .sort((a,b) => -direction*(geometry.get(a.partId)!.box[edge] - geometry.get(b.partId)!.box[edge]));
      for (const placement of moving) {
        if (exhausted()) return result;
        const own = geometry.get(placement.partId)!;
        const stock = stocks.get(placement.sheetId)!;
        const boundary = placement[axis] + (direction===-1 ? settings.margin-own.box[min] :
          (axis==="x" ? stock.width : stock.height)-settings.margin-own.box[max]);
        if (Math.abs(placement[axis]-boundary) < 0.001) continue;
        const obstacles = result.placements.filter(p => p.partId !== placement.partId && p.sheetId === stock.id)
          .map(p => geometry.get(p.partId)!);
        const anchors = [...new Set([boundary,placement[axis],...obstacles.map(o =>
          placement[axis]+(direction===-1 ? o.box[max]+settings.gap-own.box[min] :
            o.box[min]-settings.gap-own.box[max]))])]
          .filter(v => direction*(v-boundary)<=EPS && direction*(v-placement[axis])>=-EPS)
          .sort((a,b) => -direction*(a-b));
        const legal = (value: number) => {
          if (exhausted()) return false;
          const delta = value-placement[axis];
          const poly = own.poly.map(v => ({...v,[axis]:v[axis]+delta}));
          const box = bounds(poly);
          return !obstacles.some(o => {
            const dx=Math.max(0,box.minX-o.box.maxX,o.box.minX-box.maxX);
            const dy=Math.max(0,box.minY-o.box.maxY,o.box.minY-box.maxY);
            const distance=Math.hypot(dx,dy);
            const overlap=box.minX<o.box.maxX-EPS && box.maxX>o.box.minX+EPS &&
              box.minY<o.box.maxY-EPS && box.maxY>o.box.minY+EPS;
            if (!overlap && distance>=settings.gap-EPS) return false;
            if (own.rectangle && o.rectangle) return true;
            return distance <= settings.gap+EPS &&
              (contoursOverlap(poly,o.poly) || contourDistance(poly,o.poly) < settings.gap-EPS);
          });
        };
        let target=placement[axis], previous=boundary;
        for (const anchor of anchors) {
          if (exhausted()) return result;
          if (anchor === placement[axis] || legal(anchor)) {
            target=anchor;
            break;
          }
          previous=anchor;
        }
        // Bounding-box contacts are sufficient for rectangles. Other contours
        // can slide closer: refine the last blocked interval to 0.001 mm.
        const rectangles = own.rectangle && obstacles.every(o => o.rectangle);
        if (!rectangles && Math.abs(target-previous) > 0.001) {
          let blocked=previous;
          for (let step=0;step<24 && Math.abs(target-blocked)>0.001 && !exhausted();step++) {
            const middle=(blocked+target)/2;
            if (legal(middle)) target=middle;
            else blocked=middle;
          }
        }
        if (Math.abs(placement[axis]-target) > 0.001) {
          const delta=target-placement[axis];
          placement[axis]=target;
          own.poly=own.poly.map(v => ({...v,[axis]:v[axis]+delta}));
          own.box=bounds(own.poly);
          moved=true;
        }
      }
    }
    if (!moved) break;
  }
  return result;
}
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
  onProgress?: (
    attempt: number,
    best: LayoutMetrics | null,
    bestLayout?: Layout,
  ) => void,
): NestResult {
  const searchSeconds=settings.searchSeconds ?? DEFAULT_SECONDS;
  if (
    !["utilization", "machining", "remnant"].includes(settings.mode) ||
    typeof settings.allowRotation !== "boolean" ||
    !Number.isFinite(searchSeconds) || searchSeconds < 1 || searchSeconds > 30 ||
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
    deadline = start + searchSeconds*1000,
    maxCandidates = Math.round(60000*searchSeconds/DEFAULT_SECONDS);
  let candidates = 0,
    attempts = 0,
    phaseDeadline = deadline,
    phaseCandidates = maxCandidates;
  const exhausted = () =>
    performance.now() >= phaseDeadline || candidates >= phaseCandidates;
  function withinBudget(ms: number, count: number, search: () => void) {
    phaseDeadline = Math.min(deadline, performance.now() + ms);
    phaseCandidates = Math.min(maxCandidates, candidates + count);
    try {
      search();
    } finally {
      phaseDeadline = deadline;
      phaseCandidates = maxCandidates;
    }
  }
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
  const moment = (layout: Layout) => layout.placements.reduce((sum,p) => {
    const b=bounds(placedOutline(parts.get(p.partId)!,p));
    return sum+b.minX+b.minY;
  },0);
  function rank(layout: Layout, m: LayoutMetrics): number[] {
    if (settings.mode === "machining")
      return [m.sheetCount, m.travel, extent(layout), moment(layout)];
    if (settings.mode === "remnant") {
      const frontLoads = project.sheets.map(stock =>
        -layout.placements.filter(p => p.sheetId === stock.id)
          .reduce((area, p) => area + parts.get(p.partId)!.area, 0),
      );
      return [m.sheetCount, -concentratedRemnantArea(project, m),
        ...frontLoads, -m.reusableArea, extent(layout), moment(layout), m.travel];
    }
    return [m.sheetCount, extent(layout), moment(layout), m.travel];
  }
  function better(layout: Layout, m: LayoutMetrics) {
    if (!best || !metrics) return true;
    return compareRanks(rank(layout,m),rank(best,metrics))<0;
  }
  function compareRanks(a:number[],b:number[]) {
    for(let i=0;i<a.length;i++)if(Math.abs(a[i]-b[i])>EPS)return a[i]-b[i];
    return 0;
  }
  let lastCheckpoint = -Infinity;
  let checkpoint: Layout | null = null;
  function publish(force = false) {
    if (
      best &&
      best !== checkpoint &&
      (force || performance.now() - lastCheckpoint >= 100)
    ) {
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
      (part.material ?? source?.material ?? sheet.material) === sheet.material
    );
  }
  function options(
    part: Part,
    others: Placement[],
    sheet: Stock,
    variant: number,
    maxOptions = 8,
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
          if (found.length >= maxOptions) return found;
        }
      }
    }
    return found;
  }
  const locked = project.original.placements
    .filter((p) => p.locked)
    .map((p) => ({ ...p }));
  const limit = Math.min(100, Math.floor(settings.iterations));
  function tighten(ms: number) {
    if (!best || !limit) return;
    withinBudget(ms, 10000, () => {
      const stocks=[...(best as Layout).sheets];
      for (let i=0;i<stocks.length && !exhausted();i++) {
        const stock=stocks[i];
        // Give every stock a chance; a complex first sheet must not monopolize
        // compaction. Preserve a good remnant on other thickness/material pools.
        for (const direction of [-1,1] as const) {
          for (const axes of [["x","y"],["y","x"]] as const) {
            if (exhausted()) break;
            const incumbent=best as Layout;
            const subset={sheets:[stock],placements:incumbent.placements.filter(p=>p.sheetId===stock.id)};
            const trialDeadline=Math.min(phaseDeadline,performance.now()+
              Math.max(0,phaseDeadline-performance.now())/(stocks.length-i)/4);
            const compacted=compactLayout(project,subset,settings,()=>{
              if (exhausted() || performance.now()>=trialDeadline) return true;
              candidates++;
              return false;
            },axes,direction);
            consider({sheets:incumbent.sheets,placements:[
              ...incumbent.placements.filter(p=>p.sheetId!==stock.id),...compacted.placements]});
          }
        }
      }
    });
  }
  // Compaction is preprocessing, not a score-dependent one-part proposal.
  // Moving a row together can expose usable space despite neutral intermediate scores.
  tighten(Math.min(1000,searchSeconds*250));
  if (limit && best) {
    // Try eliminating a sheet with joint reassignment before one-part hill climbing.
    // Branch on stock choice: greedy first-fit alone cannot resolve exchanges.
    withinBudget(900, 12000, () => {
      const incumbent = best as Layout;
      const removable = [...incumbent.sheets].sort(
        (a, b) =>
          incumbent.placements.filter(p => p.sheetId === a.id).length -
          incumbent.placements.filter(p => p.sheetId === b.id).length,
      );
      for (const removed of removable) {
        if (exhausted()) break;
        if (locked.some(p => p.sheetId === removed.id)) continue;
        const sheets = incumbent.sheets.filter(s => s.id !== removed.id);
        const group = project.parts.filter(p => compatible(p, removed));
        const availableArea = sheets
          .filter(s => group.length && compatible(group[0], s))
          .reduce((area, s) => area + Math.max(0, s.width - 2 * settings.margin) *
            Math.max(0, s.height - 2 * settings.margin), 0);
        if (group.reduce((area, p) => area + polygonArea(p.outline), 0) > availableArea + EPS)
          continue;
        const order = project.parts
          .filter(p => !locked.some(l => l.partId === p.id))
          .sort((a, b) => b.area - a.area);
        let nodes = 0;
        function repack(index: number, placed: Placement[]): boolean {
          if (exhausted() || ++nodes > 512) return false;
          if (index === order.length) {
            consider({ sheets, placements: placed });
            return (best as Layout).sheets.length < incumbent.sheets.length;
          }
          const part = order[index];
          const targets = [...sheets].sort((a, b) =>
            Number(!placed.some(p => p.sheetId === a.id)) -
            Number(!placed.some(p => p.sheetId === b.id)),
          );
          for (const sheet of targets) {
            if (exhausted()) break;
            if (!compatible(part, sheet)) continue;
            // Stock branches and a few contour anchors keep search bounded.
            for (const placement of options(part, placed, sheet, 0).slice(0, 2))
              if (repack(index + 1, [...placed, placement])) return true;
          }
          return false;
        }
        if (repack(0, [...locked])) break;
      }
    });

  }
  if (limit && best && settings.mode === "remnant") {
    // Fill earlier stock's existing holes before spending budget on exchanges.
    withinBudget(500, 6000, () => {
      const moving = [...(best as Layout).placements].filter(p => !p.locked)
        .sort((a, b) => project.sheets.findIndex(s => s.id === b.sheetId) -
          project.sheets.findIndex(s => s.id === a.sheetId) ||
          parts.get(a.partId)!.area - parts.get(b.partId)!.area);
      for (const current of moving) {
        if (exhausted()) break;
        const incumbent = best as Layout;
        const placement = incumbent.placements.find(p => p.partId === current.partId)!;
        const others = incumbent.placements.filter(p => p.partId !== placement.partId);
        const part = parts.get(placement.partId)!;
        const donorIndex = project.sheets.findIndex(s => s.id === placement.sheetId);
        for (const stock of project.sheets.slice(0, donorIndex)) {
          if (exhausted()) break;
          if (!compatible(part, stock)) continue;
          for (const candidate of options(part, others, stock, 0, 2))
            consider({ sheets: project.sheets, placements: [...others, candidate] });
        }
      }
    });
    // Ruin/recreate a bounded neighborhood on BOTH compatible sheets. Reassign
    // the whole group before scoring, allowing intermediate moves to be worse.
    withinBudget(1500, 18000, () => {
      const neighbors = (layout: Layout, seed: Placement, count: number) => {
        const center = (p: Placement) => {
          const b = bounds(placedOutline(parts.get(p.partId)!, p));
          return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        };
        const origin = center(seed);
        return layout.placements.filter(p => !p.locked && p.sheetId === seed.sheetId)
          .sort((a, b) => {
            const ac = center(a), bc = center(b);
            return Math.hypot(ac.x - origin.x, ac.y - origin.y) -
              Math.hypot(bc.x - origin.x, bc.y - origin.y);
          }).slice(0, count).map(p => p.partId);
      };
      const donorIds = [...(best as Layout).placements].filter(p => !p.locked)
        .sort((a, b) => parts.get(a.partId)!.area - parts.get(b.partId)!.area)
        .map(p => p.partId);
      for (const donorId of donorIds) {
        if (exhausted()) break;
        const donor = (best as Layout).placements.find(p => p.partId === donorId)!;
        const part = parts.get(donorId)!;
        const donorIndex = project.sheets.findIndex(s => s.id === donor.sheetId);
        for (const receiver of project.sheets.slice(0, donorIndex)) {
          if (exhausted()) break;
          if (!compatible(part, receiver)) continue;
          const seedIds: (string | null)[] = [null, ...(best as Layout).placements
            .filter(p => !p.locked && p.sheetId === receiver.id)
            .sort((a, b) => parts.get(a.partId)!.area - parts.get(b.partId)!.area)
            .map(p => p.partId)];
          for (const seedId of seedIds) {
            if (exhausted()) break;
            for (const size of [1, 3]) {
              if (exhausted()) break;
              const incumbent = best as Layout;
              const source = incumbent.placements.find(p => p.partId === donorId)!;
              if (source.sheetId === receiver.id) break;
              const seed = incumbent.placements.find(p => p.partId === seedId);
              const ids = new Set([...neighbors(incumbent, source, size),
                ...(seed ? neighbors(incumbent, seed, size) : [])]);
              const fixed = incumbent.placements.filter(p => !ids.has(p.partId));
              const order = [...ids].map(id => parts.get(id)!).sort((a, b) => b.area - a.area);
              const targets = project.sheets.filter(s => compatible(part, s));
              let nodes = 0;
              function refill(index: number, placed: Placement[]): boolean {
                if (exhausted() || ++nodes > 96) return false;
                if (index === order.length) {
                  const previous = best;
                  consider({ sheets: project.sheets, placements: placed });
                  return best !== previous;
                }
                for (const stock of targets) {
                  if (exhausted()) break;
                  for (const p of options(order[index], placed, stock, 0, 2))
                    if (refill(index + 1, [...placed, p])) return true;
                }
                return false;
              }
              refill(0, fixed);
            }
          }
        }
      }
    });
  }
  let searchStop: "time" | "candidates" | "iterations" = "iterations";
  // Reserve time for final exchanges and compaction.
  withinBudget(
    Math.max(0, deadline - performance.now() - 750),
    Math.max(0, maxCandidates - candidates - 12000),
    () => {
      const remaining=limit-attempts;
      for (let iteration = 0; iteration < remaining && !exhausted(); iteration++) {
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
      if (attempts<limit)
        searchStop=performance.now()>=phaseDeadline ? "time" : "candidates";
    },
  );
  if (limit && best && !exhausted()) {
    // Evaluate an exchange as a whole; neither half has to improve the score alone.
    withinBudget(250, 2000, () => {
      const moving = [...(best as Layout).placements].filter(p => !p.locked);
      for (let i = 0; i < moving.length && !exhausted(); i++)
        for (let j = i + 1; j < moving.length && !exhausted(); j++) {
          const incumbent = best as Layout;
          const a = incumbent.placements.find(p => p.partId === moving[i].partId)!;
          const b = incumbent.placements.find(p => p.partId === moving[j].partId)!;
          if (a.sheetId === b.sheetId) continue;
          const aPart = parts.get(a.partId)!, bPart = parts.get(b.partId)!;
          const aSheet = project.sheets.find(s => s.id === a.sheetId)!;
          const bSheet = project.sheets.find(s => s.id === b.sheetId)!;
          if (!compatible(aPart, bSheet) || !compatible(bPart, aSheet)) continue;
          const others = incumbent.placements.filter(p => p.partId !== a.partId && p.partId !== b.partId);
          const aOptions = options(aPart, others, bSheet, 0).slice(0, 4);
          const bOptions = options(bPart, others, aSheet, 0).slice(0, 4);
          for (const first of aOptions)
            for (const second of bOptions) {
              if (exhausted()) break;
              consider({ sheets: project.sheets, placements: [...others, first, second] });
            }
        }
    });
  }
  // Cross-sheet moves can open fresh gaps. Tighten the final arrangement again.
  tighten(500);
  publish(true);
  const elapsedMs=performance.now()-start;
  const stoppedBy=limit===0 ? "disabled" : performance.now() >= deadline ? "time" :
    candidates >= maxCandidates ? "candidates" : searchStop;
  return {
    layout: best,
    metrics,
    originalMetrics,
    attempts,
    elapsedMs,
    search: {seconds:searchSeconds,candidates,candidateLimit:maxCandidates,stoppedBy},
    message: best
      ? `候选已通过检查 · ${stoppedBy === "time" ? `按 ${searchSeconds} 秒时长限制停止搜索` : stoppedBy === "candidates" ? "达到搜索数量限制" : stoppedBy === "disabled" ? "未执行优化" : "已完成设定搜索"}`
      : "本次搜索未找到满足当前间距、边距、锁定与板材约束的完整排版",
    issues: best ? [] : sourceIssues,
  };
}
