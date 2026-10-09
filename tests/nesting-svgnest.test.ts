import { expect, it, vi } from "vitest";
import { optimizeLayout } from "../src/core/nesting";
import ClipperLib from "clipper-lib";
import { minkowskiDifference, searchSvgNest } from "../src/core/svgNest";
import {
  pointSegmentDistance,
  concentratedRemnantArea,
  bounds,
  measureLayout,
  placedOutline,
  validateLayout,
} from "../src/core/geometry";
import type { Project, NestSettings, Point, Layout } from "../src/core/types";

const settings: NestSettings = {
  mode: "utilization",
  gap: 0,
  margin: 0,
  allowRotation: true,
  minRemnantWidth: 1,
  minRemnantHeight: 1,
  iterations: 8,
  searchSeconds: 2,
};
function projectOf(
  outlines: Point[][],
  widths = [12, 12],
  height = 12,
): Project {
  const sheets = widths.map((width, i) => ({
    id: `s${i}`,
    name: `s${i}`,
    width,
    height,
    thickness: 12,
    material: "wood",
  }));
  const parts = outlines.map((outline, i) => {
    const b = bounds(outline);
    return {
      id: `p${i}`,
      name: `p${i}`,
      stockId: sheets[i % sheets.length].id,
      material: "wood",
      thickness: 12,
      layer: "",
      width: b.width,
      height: b.height,
      area: 1,
      outline,
      holes: [],
      pockets: [],
      label: { x: 0, y: 0 },
    };
  });
  return {
    name: "general contour fixture",
    units: "mm",
    sheets,
    parts,
    warnings: [],
    original: { sheets, placements: [] },
  };
}
const rect = (w: number, h: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
function run(project: Project, config = settings, seed = 23) {
  const proposals: Layout[] = [];
  const stats = searchSvgNest(project, config, {
    seed,
    exhausted: () => false,
    rank: (layout) => {
      const m = measureLayout(project, layout, config);
      return [m.sheetCount, m.travel];
    },
    onLayout: (layout) => {
      expect(validateLayout(project, layout, config)).toEqual([]);
      proposals.push(layout);
    },
  });
  return {
    stats,
    proposals,
    best: proposals.sort((a, b) => a.sheets.length - b.sheets.length)[0],
  };
}

it("nests two concave L contours together, with overlapping bounding boxes", () => {
  // A rotated L occupies the opposite corner; they fit within a 16×12 sheet with a shared bounding region.
  const L: Point[] = [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 12 },
    { x: 0, y: 12 },
  ];
  const p = projectOf([L, L], [16, 16]);
  const { best, stats } = run(p);
  expect(best?.sheets).toHaveLength(1);
  expect(best?.placements).toHaveLength(2);
  const boxes = best.placements.map((v) =>
    bounds(placedOutline(p.parts.find((x) => x.id === v.partId)!, v)),
  );
  expect(boxes[0].maxX - boxes[1].minX).toBeGreaterThan(0);
  expect(boxes[0].maxY - boxes[1].minY).toBeGreaterThan(0);
  expect(stats.generations).toBeGreaterThan(1);
});
it.each([0, 2, 5])(
  "obeys %s mm clearance when packing finite sheets",
  (gap) => {
    const p = projectOf(
      [rect(8, 8), rect(8, 8), rect(8, 8)],
      [30, 30],
      12 + gap,
    );
    const before = JSON.stringify(p);
    const { best } = run(p, {
      ...settings,
      gap,
      margin: 1,
      allowRotation: false,
    });
    expect(best?.placements).toHaveLength(3);
    expect(best?.sheets).toHaveLength(gap === 5 ? 2 : 1);
    expect(JSON.stringify(p)).toBe(before);
  },
);
it("respects locks, material, thickness and stock-specific dimensions", () => {
  const p = projectOf(
    [rect(6, 10), rect(4, 10), rect(8, 4), rect(3, 3)],
    [10, 4, 9],
    10,
  );
  p.sheets[1].thickness = 18;
  p.sheets[2].material = "metal";
  Object.assign(p.parts[2], { stockId: "s1", thickness: 18 });
  Object.assign(p.parts[3], { stockId: "s2", material: "metal" });
  p.original.placements = [
    { partId: "p0", sheetId: "s0", x: 0, y: 0, rotation: 0, locked: true },
  ];
  const { best } = run(p);
  expect(best?.placements).toHaveLength(4);
  expect(best?.placements.find((x) => x.partId === "p0")).toEqual(
    p.original.placements[0],
  );
  expect(best?.placements.find((x) => x.partId === "p2")?.sheetId).toBe("s1");
  expect(best?.placements.find((x) => x.partId === "p2")?.rotation % 180).toBe(
    90,
  );
  expect(best?.placements.find((x) => x.partId === "p3")?.sheetId).toBe("s2");
});
it("does not invent sheets or publish incomplete layouts for oversized demand", () => {
  const p = projectOf([rect(8, 8), rect(8, 8)], [8], 8);
  const { proposals } = run(p);
  expect(proposals).toHaveLength(0);
});
it("never publishes a partially evaluated layout when stopped", () => {
  const p = projectOf(
    Array.from({ length: 10 }, () => rect(3, 3)),
    [12],
    12,
  );
  let checks = 0;
  const proposals: Layout[] = [];
  const stats = searchSvgNest(p, settings, {
    seed: 4,
    exhausted: () => ++checks > 15,
    rank: () => [],
    onLayout: (l) => proposals.push(l),
  });
  expect(stats.evaluations).toBeLessThan(4);
  for (const layout of proposals) {
    expect(layout.placements).toHaveLength(10);
    expect(validateLayout(p, layout, settings)).toEqual([]);
  }
});
it("reproduces geometry and exploration statistics with a fixed seed", () => {
  const p = projectOf(
    [rect(6, 4), rect(5, 8), rect(3, 3), rect(8, 2)],
    [12],
    12,
  );
  const a = run(p, {...settings, iterations:24}, 391),
    b = run(p, {...settings, iterations:24}, 391);
  expect(a.proposals).toEqual(b.proposals);
  expect(a.stats).toEqual(b.stats);
  expect(a.stats.restarts).toBeGreaterThan(0);
});

it("handles finely sampled convex contours without quadratic NFP stalls", () => {
  const circle = Array.from({ length: 360 }, (_, i) => ({
    x: 4 + 4 * Math.cos((i * Math.PI) / 180),
    y: 4 + 4 * Math.sin((i * Math.PI) / 180),
  }));
  const p = projectOf([circle, circle], [16], 8);
  const start = performance.now();
  const { best } = run(p, { ...settings, iterations: 2, allowRotation: false });
  expect(best?.placements).toHaveLength(2);
  expect(best?.sheets).toHaveLength(1);
  expect(performance.now() - start).toBeLessThan(2000);
});

it("routes production optimization through genetic search and publishes only legal incumbents", () => {
  const p = projectOf(
    [rect(6, 4), rect(5, 8), rect(3, 3), rect(8, 2)],
    [12],
    12,
  );
  const checkpoints: Layout[] = [];
  const result = optimizeLayout(p, settings, (_attempt, _metrics, layout) => {
    if (layout) checkpoints.push(layout);
  });
  expect(result.layout?.placements).toHaveLength(4);
  expect(result.search?.evaluations).toBeGreaterThan(0);
  expect(result.search?.generations).toBeGreaterThan(0);
  expect(checkpoints.length).toBeGreaterThan(0);
  for (const layout of checkpoints)
    expect(validateLayout(p, layout, settings)).toEqual([]);
});


it("preserves concave fit regions when straight edges have many sampled points", () => {
  const corners: Point[] = [{x:0,y:0},{x:12,y:0},{x:12,y:4},{x:4,y:4},{x:4,y:12},{x:0,y:12}];
  const dense = corners.flatMap((a, i) => {
    const b = corners[(i+1)%corners.length];
    return Array.from({length:30}, (_, j) => ({x:a.x+(b.x-a.x)*j/30,y:a.y+(b.y-a.y)*j/30}));
  });
  const {best} = run(projectOf([dense,dense], [16,16]));
  expect(best?.sheets).toHaveLength(1);
  expect(best?.placements).toHaveLength(2);
});


it("batched concave Minkowski union agrees with upstream within integer rounding", () => {
  const star = Array.from({length:40}, (_, i) => {
    const r = i%2 ? 70000000 : 120000000, a = i*Math.PI/20;
    return {X:Math.round(r*Math.cos(a)),Y:Math.round(r*Math.sin(a))};
  });
  const other = star.map(v=>({X:v.X+240,Y:v.Y-110}));
  const upstream = ClipperLib.Clipper.MinkowskiSum(star, other.map(v=>({X:-v.X,Y:-v.Y})), true);
  const batched = minkowskiDifference(star,other,()=>false)!;
  const clipper = new ClipperLib.Clipper(), diff: ClipperLib.Paths = [];
  clipper.AddPaths(upstream,ClipperLib.PolyType.ptSubject,true);
  clipper.AddPaths(batched,ClipperLib.PolyType.ptClip,true);
  clipper.Execute(ClipperLib.ClipType.ctXor,diff,ClipperLib.PolyFillType.pftNonZero,ClipperLib.PolyFillType.pftNonZero);
  const area = upstream.reduce((sum,p)=>sum+Math.abs(ClipperLib.Clipper.Area(p)),0);
  const difference = diff.reduce((sum,p)=>sum+Math.abs(ClipperLib.Clipper.Area(p)),0);
  expect(difference / area).toBeLessThan(1e-8);
  for (const path of batched) for (const v of path) {
    const distance=Math.min(...upstream.flatMap(p=>p.map((a,i)=>pointSegmentDistance(
      {x:v.X,y:v.Y},{x:a.X,y:a.Y},{x:p[(i+1)%p.length].X,y:p[(i+1)%p.length].Y}))));
    expect(distance).toBeLessThanOrEqual(3);
  }
});


it("publishes a complete project when one independent pool improves before a complex pool finishes", () => {
  const random = vi.spyOn(Math,"random").mockReturnValue(0.25);
  let time=0;
  const clock=vi.spyOn(performance,"now").mockImplementation(()=>time);
  try {
    const circle = Array.from({length:360},(_,i)=>({x:4+4*Math.cos(i*Math.PI/180),y:4+4*Math.sin(i*Math.PI/180)}));
    const p=projectOf([rect(3,3),rect(3,3),circle],[16,16],16);
    p.sheets[0].thickness=18;
    p.sheets[1].thickness=5;
    for (let i=0;i<3;i++) Object.assign(p.parts[i],{stockId:i<2?"s1":"s0",thickness:i<2?5:18,area:i<2?9:Math.PI*16});
    p.original.placements=[
      {partId:"p0",sheetId:"s1",x:2,y:2,rotation:0},
      {partId:"p1",sheetId:"s1",x:11,y:11,rotation:0},
      {partId:"p2",sheetId:"s0",x:4,y:4,rotation:0},
    ];
    const before=JSON.stringify(p), config={...settings,mode:"remnant" as const,gap:1,margin:1,
      minRemnantWidth:1,minRemnantHeight:1,iterations:100,searchSeconds:2};
    const proposals:Layout[]=[];
    const result=optimizeLayout(p,config,(g,_m,layout)=>{if(layout)proposals.push(layout);if(g>=100)time=2100;});
    expect(result.search?.groups).toBe(2);
    expect(result.search?.improved).toBe(true);
    expect(concentratedRemnantArea(p,result.metrics!)).toBeGreaterThan(concentratedRemnantArea(p,result.originalMetrics));
    for (const layout of proposals) {
      expect(layout.placements).toHaveLength(3);
      expect(layout.sheets.map(s=>s.id)).toEqual(p.sheets.filter(s=>layout.placements.some(v=>v.sheetId===s.id)).map(s=>s.id));
      expect(validateLayout(p,layout,config)).toEqual([]);
    }
    expect(result.layout?.placements.find(v=>v.partId==="p2")).toEqual(p.original.placements[2]);
    expect(result.search?.stoppedBy).toBe("time");
    expect(JSON.stringify(p)).toBe(before);
  } finally {random.mockRestore();clock.mockRestore();}
});

it("repairs an invalid gap using SVGnest and independently validates every candidate", () => {
  const p = projectOf([rect(4, 4), rect(4, 4)], [12], 12);
  p.original.placements = [
    { partId: "p0", sheetId: "s0", x: 1, y: 1, rotation: 0 },
    { partId: "p1", sheetId: "s0", x: 5.5, y: 1, rotation: 0 },
  ];
  const config = { ...settings, gap: 1, margin: 1 };
  expect(validateLayout(p, p.original, config).map(i => i.kind)).toContain("gap");
  const before = structuredClone(p.original);
  const checkpoints: Layout[] = [];
  const result = optimizeLayout(p, config, (_, __, layout) => { if (layout) checkpoints.push(layout); });
  expect(result.layout).not.toBeNull();
  expect(validateLayout(p, result.layout!, config)).toEqual([]);
  for (const layout of checkpoints) expect(validateLayout(p, layout, config)).toEqual([]);
  expect(p.original).toEqual(before);
});
it("does not claim repair when locked parts violate the requested gap", () => {
  const p = projectOf([rect(4, 4), rect(4, 4)], [12], 12);
  p.original.placements = [
    { partId: "p0", sheetId: "s0", x: 1, y: 1, rotation: 0, locked: true },
    { partId: "p1", sheetId: "s0", x: 5.5, y: 1, rotation: 0, locked: true },
  ];
  const result = optimizeLayout(p, { ...settings, gap: 1, margin: 1 });
  expect(result.layout).toBeNull();
  expect(result.issues.some(i => i.kind === "gap")).toBe(true);
});
