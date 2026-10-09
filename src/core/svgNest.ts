import ClipperLib from "clipper-lib";
import {
  GeneticAlgorithm,
  type Individual,
} from "../vendor/svgnest/genetic.js";
import { bounds, placedOutline, validateLayout, polygonArea } from "./geometry";
import type {
  Project,
  NestSettings,
  Point,
  Placement,
  Layout,
  Rotation,
  SearchProgress,
} from "./types";

const SCALE = 10000000; // SVGnest scale: 0.0000001 mm, within Clipper integer range.
const EPS = 1e-7;
const toClipper = (p: Point[]) =>
  p.map((v) => ({ X: Math.round(v.x * SCALE), Y: Math.round(v.y * SCALE) }));
const fromClipper = (p: ClipperLib.Path) =>
  p.map((v) => ({ x: v.X / SCALE, y: v.Y / SCALE }));

// Used only to detect convex inputs. For those shapes the linear edge merge
// computes the identical Minkowski difference; concave inputs are never hulled.
function hull(poly: Point[]): Point[] {
  const sorted = [...poly].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const chain = (points: Point[]) => {
    const out: Point[] = [];
    for (const p of points) {
      while (
        out.length > 1 &&
        cross(out[out.length - 2], out[out.length - 1], p) <= EPS
      )
        out.pop();
      out.push(p);
    }
    return out;
  };
  return [
    ...chain(sorted).slice(0, -1),
    ...chain(sorted.reverse()).slice(0, -1),
  ];
}
function convexDifference(a: Point[], b: Point[]): ClipperLib.Path {
  const start = (poly: Point[]) => {
    let at = 0;
    for (let i = 1; i < poly.length; i++)
      if (
        poly[i].y < poly[at].y ||
        (poly[i].y === poly[at].y && poly[i].x < poly[at].x)
      )
        at = i;
    return [...poly.slice(at), ...poly.slice(0, at)];
  };
  const A = start(a),
    B = start(b.map((v) => ({ x: -v.x, y: -v.y })));
  let i = 0,
    j = 0;
  const points: Point[] = [];
  while (i < A.length || j < B.length) {
    points.push({
      x: A[i % A.length].x + B[j % B.length].x,
      y: A[i % A.length].y + B[j % B.length].y,
    });
    const da = {
      x: A[(i + 1) % A.length].x - A[i % A.length].x,
      y: A[(i + 1) % A.length].y - A[i % A.length].y,
    };
    const db = {
      x: B[(j + 1) % B.length].x - B[j % B.length].x,
      y: B[(j + 1) % B.length].y - B[j % B.length].y,
    };
    const cross = da.x * db.y - da.y * db.x;
    const stepA = i < A.length && (j === B.length || cross >= -EPS);
    const stepB = j < B.length && (i === A.length || cross <= EPS);
    if (stepA) i++;
    if (stepB) j++;
  }
  return toClipper(points);
}

// The upstream Minkowski quads are unioned in batches for cooperative stopping.
// This is the same union as MinkowskiSum, without a single huge blocking union.
export function minkowskiDifference(a: ClipperLib.Path, b: ClipperLib.Path, exhausted: () => boolean) {
  const negated = b.map(v => ({X:-v.X, Y:-v.Y}));
  if (a.length * b.length <= 1024) return ClipperLib.Clipper.MinkowskiSum(a, negated, true);
  const api = ClipperLib.Clipper as typeof ClipperLib.Clipper & {
    Minkowski(pattern: ClipperLib.Path, path: ClipperLib.Path, sum: boolean, closed: boolean): ClipperLib.Paths;
  };
  const quads = api.Minkowski(a, negated, true, true);
  const unite = (paths: ClipperLib.Paths) => {
    const clipper = new ClipperLib.Clipper();
    clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
    const result: ClipperLib.Paths = [];
    clipper.Execute(ClipperLib.ClipType.ctUnion, result,
      ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    return result;
  };
  let groups: ClipperLib.Paths[] = [];
  for (let i = 0; i < quads.length; i += 256) {
    if (exhausted()) return null;
    groups.push(unite(quads.slice(i, i + 256)));
  }
  // Balanced merging avoids repeatedly rounding the same boundary hundreds of times.
  while (groups.length > 1) {
    const next: ClipperLib.Paths[] = [];
    for (let i = 0; i < groups.length; i += 2) {
      if (exhausted()) return null;
      next.push(i+1 < groups.length ? unite([...groups[i],...groups[i+1]]) : groups[i]);
    }
    groups = next;
  }
  return exhausted() ? null : groups[0] ?? [];
}

type PoolStats = { seed: number; generations: number; evaluations: number; restarts: number; nfpPairs: number; feasible: number };
type SearchControl = {
    seed?: number;
    exhausted: () => boolean;
    rank: (layout: Layout) => number[];
    onLayout: (layout: Layout) => void;
    onFeasible?: (layout: Layout) => void;
    onGeneration?: (generation: number) => void;
    onRound?: (round: number, stats: PoolStats & { groups: number; rounds: number }) => boolean;
    onStatus?: (progress: Omit<SearchProgress, "elapsedMs" | "timeLimitMs">) => void;
  };

/** SVGnest's Minkowski outer NFP and union/difference placement strategy,
 * adapted from svgnest.js and util/placementworker.js (MIT, Jack Qiao).
 * Coordinates describe the part translation, rather than its first vertex.
 * Real stock inventory, fixed obstacles and independent checks are our adapter.
 */
function* searchPool(
  project: Project,
  settings: NestSettings,
  control: SearchControl,
): Generator<PoolStats, PoolStats, void> {
  const seed = (control.seed ?? Math.floor(Math.random() * 0xffffffff)) >>> 0;
  let state = seed || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
  const stats = {
    seed,
    generations: 0,
    evaluations: 0,
    restarts: 0,
    nfpPairs: 0,
    feasible: 0,
  };
  const locked = project.original.placements
    .filter((p) => p.locked)
    .map((p) => ({ ...p }));
  const parts = new Map(project.parts.map((p) => [p.id, p]));
  const moving = project.parts.filter(
    (p) => !locked.some((l) => l.partId === p.id),
  );
  const stocks = project.sheets;
  if (
    !moving.length ||
    !stocks.length ||
    (settings.stopRule !== "patience" && !settings.iterations) ||
    control.exhausted()
  )
    return stats;
  const compatible = (id: string, s: (typeof stocks)[number]) => {
    const p = parts.get(id)!;
    const source = stocks.find((x) => x.id === p.stockId);
    return (
      p.thickness === s.thickness &&
      (p.material ?? source?.material ?? s.material) === s.material
    );
  };
  const genes = moving
    .map((p) =>
      Object.assign(
        p.outline.map((v) => ({ ...v })),
        { id: p.id },
      ),
    )
    .sort((a, b) => parts.get(b.id)!.area - parts.get(a.id)!.area);
  const ga = new GeneticAlgorithm(
    genes,
    [
      { x: 0, y: 0 },
      { x: Math.max(...stocks.map((s) => s.width)), y: 0 },
      {
        x: Math.max(...stocks.map((s) => s.width)),
        y: Math.max(...stocks.map((s) => s.height)),
      },
    ],
    {
      populationSize: 10,
      mutationRate: 10,
      rotations: settings.allowRotation ? 4 : 1,
    },
    random,
  );
  const shuffle = <T>(a: T[]) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const immigrant = (): Individual => ({
    placement: shuffle([...genes]),
    rotation: genes.map(() =>
      settings.allowRotation
        ? ((Math.floor(random() * 4) * 90) as Rotation)
        : 0,
    ),
  });
  // Diverse independent initial orders, not just adjacent mutations of one order.
  const sourceOrder = new Map(
    project.original.placements.map((p, i) => [p.partId, i]),
  );
  if (sourceOrder.size)
    ga.population[0].placement = [...genes].sort(
      (a, b) =>
        (sourceOrder.get(a.id) ?? Infinity) -
        (sourceOrder.get(b.id) ?? Infinity),
    );
  ga.population[0].rotation = ga.population[0].placement.map((g) =>
    settings.allowRotation
      ? (project.original.placements.find((p) => p.partId === g.id)?.rotation ??
        0)
      : 0,
  );
  ga.population[1] = { placement: [...genes], rotation: genes.map(() => 0) };
  for (let i = 2; i < ga.population.length; i++) {
    ga.population[i] = immigrant();
    ga.population[i].rotation = genes.map(() => 0);
  }
  ga.population[2] = {
    placement: [...genes].sort((a, b) => {
      const x = parts.get(a.id)!,
        y = parts.get(b.id)!;
      return Math.max(y.width, y.height) - Math.max(x.width, x.height);
    }),
    rotation: genes.map(() => 0),
  };
  // Width- and height-decreasing seeds are common packing starts; none pin a
  // part to its source board. Source-space orders supply two independent genes.
  ga.population[3] = {placement:[...genes].sort((a,b)=>parts.get(b.id)!.width-parts.get(a.id)!.width),rotation:genes.map(()=>settings.allowRotation ? 90 : 0)};
  ga.population[4] = {placement:[...genes].sort((a,b)=>parts.get(b.id)!.height-parts.get(a.id)!.height),rotation:genes.map(()=>0)};
  for (const [slot,axis] of [[5,"x"],[6,"y"]] as const) {
    const origins = new Map(project.original.placements.map(p=>[p.partId,p]));
    const order = [...genes].sort((a,b)=>(origins.get(a.id)?.[axis] ?? 0)-(origins.get(b.id)?.[axis] ?? 0));
    ga.population[slot] = {placement:order,rotation:order.map(g=>settings.allowRotation ? origins.get(g.id)?.rotation ?? 0 : 0)};
  }
  ga.population[7] = {placement:[...genes],rotation:genes.map(()=>settings.allowRotation ? 180 : 0)};
  const origins = new Map(project.original.placements.map(p=>[p.partId,p]));
  const reverseSource = [...genes].sort((a,b)=>(origins.get(b.id)?.y ?? 0)-(origins.get(a.id)?.y ?? 0));
  ga.population[8] = {placement:reverseSource,rotation:reverseSource.map(g=>settings.allowRotation ? ((origins.get(g.id)?.rotation ?? 0)+180)%360 as Rotation : 0)};
  ga.population[9] = immigrant();
  const polygons = new Map<string, Point[]>();
  function polygon(p: Placement) {
    const key = `${p.partId}:${p.rotation}`;
    if (!polygons.has(key))
      polygons.set(
        key,
        fromClipper(ClipperLib.Clipper.CleanPolygon(
          toClipper(placedOutline(parts.get(p.partId)!, { ...p, x: 0, y: 0 })), 0.5,
        )),
      );
    return polygons.get(key)!;
  }
  const cache = new Map<string, ClipperLib.Path>();
  let cachePoints = 0;
  const signature = (poly: Point[]) =>
    poly.map((v) => `${v.x},${v.y}`).join(";");
  const signatures = new Map<Point[], string>();
  const sig = (poly: Point[]) => {
    if (!signatures.has(poly)) signatures.set(poly, signature(poly));
    return signatures.get(poly)!;
  };
  const hulls = new Map<Point[], Point[]>();
  const getHull = (poly: Point[]) => {
    if (!hulls.has(poly)) hulls.set(poly, hull(poly));
    return hulls.get(poly)!;
  };
  function nfp(a: Point[], b: Point[]) {
    const key = `${sig(a)}|${sig(b)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const reverse = cache.get(`${sig(b)}|${sig(a)}`);
    if (reverse) return reverse.map(v => ({X:-v.X,Y:-v.Y}));
    if (control.exhausted()) return null;
    // The same Minkowski difference as SVGnest, including concave outer contours.
    const ah = getHull(a),
      bh = getHull(b);
    const convex =
      Math.abs(polygonArea(a) - polygonArea(ah)) < EPS &&
      Math.abs(polygonArea(b) - polygonArea(bh)) < EPS;
    let outer: ClipperLib.Path | undefined;
    if (convex) {
      outer = convexDifference(ah, bh);
    } else {
      const solution = minkowskiDifference(toClipper(a), toClipper(b), control.exhausted);
      if (!solution) return null;
      outer = solution.sort(
        (x, y) =>
          Math.abs(ClipperLib.Clipper.Area(y)) -
          Math.abs(ClipperLib.Clipper.Area(x)),
      )[0];
    }
    if (!outer) return null;
    if (!ClipperLib.Clipper.Orientation(outer)) outer.reverse();
    let expanded = outer;
    if (settings.gap > 0) {
      const offset = new ClipperLib.ClipperOffset(2, 0.001 * SCALE);
      offset.AddPath(
        outer,
        ClipperLib.JoinType.jtMiter,
        ClipperLib.EndType.etClosedPolygon,
      );
      const paths: ClipperLib.Paths = [];
      // Miter offsets conservatively preserve clearance; exact contacts must
      // remain possible in tight stock. The validator handles rounding.
      const diagonal = outer.some((v, i) => {
        const next = outer[(i+1)%outer.length];
        return next.X !== v.X && next.Y !== v.Y;
      });
      // Roundoff protection for oblique contacts: 0.0000003 mm, not a user gap change.
      offset.Execute(paths, settings.gap * SCALE + (diagonal ? 3 : 0));
      expanded =
        paths.sort(
          (x, y) =>
            Math.abs(ClipperLib.Clipper.Area(y)) -
            Math.abs(ClipperLib.Clipper.Area(x)),
        )[0] ?? outer;
    }
    while (
      cache.size &&
      (cache.size >= 4096 || cachePoints + expanded.length > 250000)
    ) {
      const first = cache.keys().next().value!;
      cachePoints -= cache.get(first)!.length;
      cache.delete(first);
    }
    if (expanded.length <= 250000) {
      cache.set(key, expanded);
      cachePoints += expanded.length;
    }
    stats.nfpPairs++;
    return expanded;
  }
  function place(
    id: string,
    rotation: Rotation,
    placed: Placement[],
    stock: (typeof stocks)[number],
  ): Placement | undefined {
    const origin: Placement = {
      partId: id,
      sheetId: stock.id,
      x: 0,
      y: 0,
      rotation,
    };
    const poly = polygon(origin),
      box = bounds(poly);
    const minX = settings.margin - box.minX,
      minY = settings.margin - box.minY;
    const maxX = stock.width - settings.margin - box.maxX,
      maxY = stock.height - settings.margin - box.maxY;
    if (maxX < minX - EPS || maxY < minY - EPS) return;
    const obstacles = placed
      .filter((p) => p.sheetId === stock.id)
      .map((p) => ({
        p,
        poly: polygon(p),
        box: bounds(placedOutline(parts.get(p.partId)!, p)),
      }));
    const points: Point[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    const forbidden: ClipperLib.Paths = [];
    for (const o of obstacles) {
      if (control.exhausted()) return;
      const path = nfp(o.poly, poly);
      if (!path) return;
      const translated = path.map((v) => ({
        X: v.X + Math.round(o.p.x * SCALE),
        Y: v.Y + Math.round(o.p.y * SCALE),
      }));
      forbidden.push(translated);
      const vertices = fromClipper(translated);
      points.push(...vertices);
      // When a part exactly spans a stock dimension, the inner-fit region is
      // a segment (or point), which Clipper cannot represent as a polygon.
      // Intersect NFP edges with that region instead of losing legal contacts.
      if (maxX - minX <= EPS || maxY - minY <= EPS) {
        for (let i = 0; i < vertices.length; i++) {
          const a = vertices[i], b = vertices[(i + 1) % vertices.length];
          for (const axis of ["x", "y"] as const) {
            const edge = axis === "x" ? minX : minY;
            const span = b[axis] - a[axis];
            if (Math.abs(span) <= EPS) continue;
            const t = (edge - a[axis]) / span;
            if (t >= 0 && t <= 1) points.push({x:a.x+t*(b.x-a.x), y:a.y+t*(b.y-a.y)});
          }
        }
      }
    }
    if (forbidden.length && maxX > minX + EPS && maxY > minY + EPS) {
      const union: ClipperLib.Paths = [];
      let clipper = new ClipperLib.Clipper();
      clipper.AddPaths(forbidden, ClipperLib.PolyType.ptSubject, true);
      clipper.Execute(
        ClipperLib.ClipType.ctUnion,
        union,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero,
      );
      const feasible: ClipperLib.Paths = [];
      clipper = new ClipperLib.Clipper();
      clipper.AddPath(
        toClipper(points.slice(0, 4)),
        ClipperLib.PolyType.ptSubject,
        true,
      );
      clipper.AddPaths(union, ClipperLib.PolyType.ptClip, true);
      clipper.Execute(
        ClipperLib.ClipType.ctDifference,
        feasible,
        ClipperLib.PolyFillType.pftNonZero,
        ClipperLib.PolyFillType.pftNonZero,
      );
      points.push(...feasible.flatMap(fromClipper));
    }
    const seen = new Set<string>();
    let chosen: Placement | undefined,
      score = Infinity;
    for (const anchor of points) {
      if (control.exhausted()) return;
      if (
        anchor.x < minX - EPS ||
        anchor.x > maxX + EPS ||
        anchor.y < minY - EPS ||
        anchor.y > maxY + EPS
      )
        continue;
      const key = `${anchor.x},${anchor.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const clipPoint = {
        X: Math.round(anchor.x * SCALE),
        Y: Math.round(anchor.y * SCALE),
      };
      if (
        forbidden.some(
          (path) => ClipperLib.Clipper.PointInPolygon(clipPoint, path) > 0,
        )
      )
        continue;
      const bb = {
        minX: box.minX + anchor.x,
        maxX: box.maxX + anchor.x,
        minY: box.minY + anchor.y,
        maxY: box.maxY + anchor.y,
      };
      // NFPs admit positions; independently validate the completed layout once.
      // Rechecking every contour edge pair at every NFP vertex defeats caching.
      // SVGnest's weighted bounding extent. Fitness depends only on the genome.
      const width =
        Math.max(bb.maxX, ...obstacles.map((o) => o.box.maxX)) -
        Math.min(bb.minX, ...obstacles.map((o) => o.box.minX));
      const height =
        Math.max(bb.maxY, ...obstacles.map((o) => o.box.maxY)) -
        Math.min(bb.minY, ...obstacles.map((o) => o.box.minY));
      const value =
        (2 * width + height) +
        1e-8 * (anchor.x + anchor.y);
      if (value < score) {
        score = value;
        chosen = { ...origin, ...anchor };
      }
    }
    return chosen;
  }
  const scores = new WeakMap<Individual, number[]>();
  const compare = (a: number[], b: number[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] ?? 0) - (b[i] ?? 0);
      if (Math.abs(d) > EPS) return d;
    }
    return 0;
  };
  let bestScore: number[] | undefined,
    stale = 0;
  for (
    let generation = 0;
    (settings.stopRule === "patience" || generation < Math.min(100, Math.floor(settings.iterations))) &&
    !control.exhausted();
    generation++
  ) {
    let improved = false;
    for (const individual of ga.population) {
      if (control.exhausted()) break;
      if (scores.has(individual)) continue;
      const placed = [...locked];
      for (
        let i = 0;
        i < individual.placement.length && !control.exhausted();
        i++
      ) {
        const gene = individual.placement[i];
        for (const stock of stocks) {
          if (!compatible(gene.id, stock)) continue;
          const p = place(
            gene.id,
            individual.rotation[i],
            placed,
            stock,
          );
          if (p) {
            placed.push(p);
            break;
          }
        }
      }
      if (control.exhausted()) break;
      stats.evaluations++;
      const layout = {
        sheets: stocks.filter((s) => placed.some((p) => p.sheetId === s.id)),
        placements: placed,
      };
      const issues = validateLayout(project, layout, settings);
      const complete = placed.length === project.parts.length && !issues.length;
      const score = complete
        ? [0, ...control.rank(layout)]
        : [Math.max(1, project.parts.length - placed.length + issues.filter(issue => issue.kind !== "missing").length),
          ...control.rank(layout)];
      scores.set(individual, score);
      if (complete) {
        stats.feasible++;
        control.onFeasible?.(layout);
        control.onLayout(layout);
      }
      // Progress toward a complete packing also matters; do not restart every
      // few generations merely because the first feasible layout is still absent.
      if (!bestScore || compare(score, bestScore) < 0) {
        bestScore = score;
        improved = true;
      }
    }
    if (control.exhausted()) break;
    // Ordinal fitness preserves the app's lexicographic objectives without
    // arbitrary units/weights dominating sheet count or reusable remnants.
    const ranked = [...ga.population].sort((a, b) =>
      compare(scores.get(a) ?? [Infinity], scores.get(b) ?? [Infinity]),
    );
    ranked.forEach((individual, i) => (individual.fitness = i));
    stats.generations++;
    control.onGeneration?.(stats.generations);
    ga.generation();
    stale = improved ? 0 : stale + 1;
    const restart = stale >= 10;
    if (restart) {
      stats.restarts++;
      stale = 0;
    }
    // Keep the elite but inject independent permutations even before stagnation.
    for (
      let i = restart ? 1 : ga.population.length - 2;
      i < ga.population.length;
      i++
    )
      ga.population[i] = immigrant();
    yield { ...stats };
  }
  return stats;
}


function drainPool(iterator: Generator<PoolStats, PoolStats, void>): PoolStats {
  while (true) { const step = iterator.next(); if (step.done) return step.value; }
}

/** Independent material/thickness pools share the deadline, not chromosome space.
 * A completed pool can improve the incumbent even if another pool needs longer.
 * Every emitted layout still contains the complete project, never just one pool.
 */
export function searchSvgNest(project: Project, settings: NestSettings, control: SearchControl) {
  const seed = (control.seed ?? Math.floor(Math.random()*0xffffffff)) >>> 0;
  const report = (pool: Project, group: number, count: number, generation: number) => {
    const thicknesses = new Set(pool.parts.map(p => p.thickness));
    const materials = new Set(pool.parts.map(p => p.material ?? pool.sheets.find(s => s.id === p.stockId)?.material));
    control.onStatus?.({ group, groups: count, generation,
      generationLimit: settings.stopRule === "patience" ? 0 : Math.min(100, Math.floor(settings.iterations)),
      thickness: thicknesses.size === 1 ? pool.parts[0]?.thickness ?? 0 : 0,
      material: materials.size === 1 ? [...materials][0] ?? "未指定" : "混合材料",
      phase: generation === 0 ? "preparing" : "searching" });
  };
  const groups = new Map<string, Project>();
  let ambiguous = false;
  for (const part of project.parts) {
    const source = project.sheets.find(s=>s.id===part.stockId);
    const material = part.material ?? source?.material;
    if (material === undefined) {ambiguous=true;break;}
    const key = JSON.stringify([part.thickness,material]);
    if (!groups.has(key)) {
      const stocks = project.sheets.filter(s=>s.thickness===part.thickness && s.material===material);
      groups.set(key,{...project,sheets:stocks,parts:[],original:{sheets:stocks,placements:[]}});
    }
    const pool = groups.get(key)!;
    pool.parts.push(part);
    const original = project.original.placements.find(p=>p.partId===part.id);
    if (original) pool.original.placements.push(original);
  }
  if ((ambiguous || groups.size <= 1) && settings.stopRule !== "patience") {
    report(project, 1, 1, 0);
    return {...drainPool(searchPool(project,settings,{...control,seed,onGeneration:g=>{
      control.onGeneration?.(g); report(project,1,1,g);
    }})),groups:1};
  }
  const pools = (ambiguous || groups.size === 0 ? [project] : [...groups.values()]).sort((a,b)=>
    a.parts.reduce((sum,p)=>sum+p.outline.length,0)-b.parts.reduce((sum,p)=>sum+p.outline.length,0));
  const incumbents = pools.map(pool=>validateLayout(pool,pool.original,settings).length ? null : {
    sheets:pool.original.sheets.filter(s=>pool.original.placements.some(p=>p.sheetId===s.id)),
    placements:pool.original.placements,
  });
  const ranks = incumbents.map(layout=>layout ? control.rank(layout) : undefined);
  const totals = {seed,groups:pools.length,generations:0,evaluations:0,restarts:0,nfpPairs:0,feasible:0};
  const compare = (a:number[],b:number[]) => {
    for(let i=0;i<Math.max(a.length,b.length);i++) {
      const d=(a[i]??0)-(b[i]??0);
      if(Math.abs(d)>EPS)return d;
    }
    return 0;
  };
  if (settings.stopRule === "patience") {
    // Resident generators keep each pool's population, elite, RNG and NFP cache.
    const states: PoolStats[] = pools.map((_,i)=>({seed:(seed+Math.imul(i,0x9e3779b9))>>>0,
      generations:0,evaluations:0,restarts:0,nfpPairs:0,feasible:0}));
    const active = pools.map(()=>true);
    const iterators = pools.map((pool,i)=>searchPool(pool,settings,{
      ...control,seed:states[i].seed,
      onGeneration:g=>{
        control.onGeneration?.(states.reduce((sum,s,j)=>sum+(j===i?g:s.generations),0));
        report(pool,i+1,pools.length,g);
      },
      onFeasible: control.onFeasible ? layout=>{
        if(incumbents.some((l,j)=>j!==i && l===null))return;
        const placements=incumbents.flatMap((l,j)=>(j===i?layout:l)!.placements);
        const used=new Set(placements.map(p=>p.sheetId));
        control.onFeasible?.({sheets:project.sheets.filter(s=>used.has(s.id)),placements});
      } : undefined,
      onLayout:layout=>{
        const score=control.rank(layout);
        if(ranks[i] && compare(score,ranks[i]!)>=0)return;
        incumbents[i]=layout;ranks[i]=score;
        if(incumbents.some(l=>l===null))return;
        const placements=incumbents.flatMap(l=>l!.placements);
        const used=new Set(placements.map(p=>p.sheetId));
        const complete={sheets:project.sheets.filter(s=>used.has(s.id)),placements};
        if(!validateLayout(project,complete,settings).length)control.onLayout(complete);
      },
    }));
    let rounds=0;
    while(active.some(Boolean) && !control.exhausted()) {
      let advanced=false;
      for(let i=0;i<pools.length && !control.exhausted();i++) {
        if(!active[i])continue;
        report(pools[i],i+1,pools.length,states[i].generations);
        const step=iterators[i].next();
        advanced ||= step.value.generations > states[i].generations;
        states[i]=step.value;active[i]=!step.done;
      }
      for(const key of ["generations","evaluations","restarts","nfpPairs","feasible"] as const)
        totals[key]=states.reduce((sum,s)=>sum+s[key],0);
      if(!advanced || control.exhausted())break;
      rounds++;
      if(control.onRound?.(rounds,{...totals,rounds}))break;
    }
    return {...totals,rounds};
  }
  for (let i=0;i<pools.length && !control.exhausted();i++) {
    report(pools[i],i+1,pools.length,0);
    const stats = drainPool(searchPool(pools[i],settings,{
      ...control,seed:(seed+Math.imul(i,0x9e3779b9))>>>0,
      onGeneration:g=>{control.onGeneration?.(totals.generations+g);report(pools[i],i+1,pools.length,g);},
      onFeasible: control.onFeasible ? layout=>{
        if(incumbents.some((l,j)=>j!==i && l===null))return;
        const placements=incumbents.flatMap((l,j)=>(j===i?layout:l)!.placements);
        const used=new Set(placements.map(p=>p.sheetId));
        control.onFeasible?.({sheets:project.sheets.filter(s=>used.has(s.id)),placements});
      } : undefined,
      onLayout:layout=>{
        const score=control.rank(layout);
        if(ranks[i] && compare(score,ranks[i]!)>=0)return;
        incumbents[i]=layout;
        ranks[i]=score;
        if(incumbents.some(l=>l===null))return;
        const placements=incumbents.flatMap(l=>l!.placements);
        const used=new Set(placements.map(p=>p.sheetId));
        const complete = {sheets:project.sheets.filter(s=>used.has(s.id)),placements};
        if(!validateLayout(project,complete,settings).length)control.onLayout(complete);
      },
    }));
    for(const key of ["generations","evaluations","restarts","nfpPairs","feasible"] as const)totals[key]+=stats[key];
  }
  return totals;
}
