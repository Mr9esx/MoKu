import { expect, it } from "vitest";
import {
  polygonArea,
  transformPoints,
  validateLayout,
  measureLayout,
} from "../src/core/geometry";
import type { Part, Project, NestSettings } from "../src/core/types";
const outline = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 40 },
  { x: 0, y: 40 },
];
const part: Part = {
  id: "a",
  name: "a",
  stockId: "s",
  layer: "CUT_12MM",
  thickness: 12,
  width: 40,
  height: 40,
  area: 700,
  outline,
  holes: [],
  pockets: [],
  label: { x: 5, y: 5 },
};
const settings: NestSettings = {
  mode: "utilization",
  gap: 0,
  margin: 0,
  allowRotation: true,
  minRemnantWidth: 1,
  minRemnantHeight: 1,
  iterations: 1,
};
const p: Project = {
  name: "x",
  units: "mm",
  sheets: [
    {
      id: "s",
      name: "s",
      width: 100,
      height: 100,
      thickness: 12,
      material: "",
    },
  ],
  parts: [part],
  warnings: [],
  original: { sheets: [], placements: [] },
};
it("preserves analytical area and normalizes all rotated detail", () => {
  expect(polygonArea(outline)).toBe(700);
  expect(
    transformPoints([{ x: 5, y: 7 }], part, {
      partId: "a",
      sheetId: "s",
      x: 2,
      y: 3,
      rotation: 90,
    }),
  ).toEqual([{ x: 35, y: 8 }]);
});
it("uses contours for concave parts with overlapping bounding boxes", () => {
  const b = { ...part, id: "b" };
  const project = { ...p, parts: [part, b] };
  expect(
    validateLayout(
      project,
      {
        sheets: p.sheets,
        placements: [
          { partId: "a", sheetId: "s", x: 0, y: 0, rotation: 0 },
          { partId: "b", sheetId: "s", x: 12, y: 12, rotation: 180 },
        ],
      },
      settings,
    ).some((i) => i.kind === "overlap"),
  ).toBe(false);
});
it("rejects identity, thickness, boundary, settings and finite errors", () => {
  expect(
    validateLayout(p, { sheets: p.sheets, placements: [] }, settings)[0].kind,
  ).toBe("missing");
  const pl = { partId: "a", sheetId: "s", x: -1, y: 0, rotation: 0 as const };
  expect(
    validateLayout(p, { sheets: p.sheets, placements: [pl, pl] }, settings).map(
      (i) => i.kind,
    ),
  ).toContain("boundary");
  expect(
    validateLayout(
      p,
      { sheets: [{ ...p.sheets[0], thickness: 0 }], placements: [pl] },
      settings,
    ).map((i) => i.kind),
  ).toContain("thickness");
  expect(
    validateLayout(
      p,
      { sheets: p.sheets, placements: [{ ...pl, x: NaN }] },
      { ...settings, gap: -1 },
    ).map((i) => i.kind),
  ).toContain("invalid");
});
it("reports a free remnant conservatively", () => {
  const metrics = measureLayout(
    p,
    {
      sheets: p.sheets,
      placements: [{ partId: "a", sheetId: "s", x: 0, y: 0, rotation: 0 }],
    },
    settings,
  );
  expect(metrics.utilization).toBe(0.07);
  expect(metrics.remnants[0].area).toBeGreaterThanOrEqual(6000);
});
it("checks edge distance, disallows nesting in holes and honors locks", () => {
  const rectangle = {
    ...part,
    outline: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
    area: 1600,
    holes: [
      [
        { x: 5, y: 5 },
        { x: 35, y: 5 },
        { x: 35, y: 35 },
        { x: 5, y: 35 },
      ],
    ],
  };
  const smaller = {
    ...rectangle,
    id: "b",
    width: 5,
    height: 5,
    area: 25,
    outline: [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 5 },
    ],
  };
  const project = { ...p, parts: [rectangle, smaller] };
  const placements = [
    { partId: "a", sheetId: "s", x: 0, y: 0, rotation: 0 as const },
    { partId: "b", sheetId: "s", x: 10, y: 10, rotation: 0 as const },
  ];
  expect(
    validateLayout(project, { sheets: p.sheets, placements }, settings).map(
      (i) => i.kind,
    ),
  ).toContain("overlap");
  placements[1].x = 43;
  placements[1].y = 0;
  expect(
    validateLayout(
      project,
      { sheets: p.sheets, placements },
      { ...settings, gap: 6 },
    ).map((i) => i.kind),
  ).toContain("gap");
  const original = {
    sheets: p.sheets,
    placements: [{ ...placements[0], locked: true }],
  };
  expect(
    validateLayout(
      { ...p, original },
      { sheets: p.sheets, placements: [{ ...placements[0], x: 1 }] },
      settings,
    ).map((i) => i.kind),
  ).toContain("invalid");
});
it("erodes remnants to retain the requested clearance", () => {
  const rect = {
    ...part,
    width: 40,
    height: 40,
    area: 1600,
    outline: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 0, y: 40 },
    ],
  };
  const m = measureLayout(
    { ...p, parts: [rect] },
    {
      sheets: p.sheets,
      placements: [{ partId: "a", sheetId: "s", x: 30, y: 30, rotation: 0 }],
    },
    { ...settings, gap: 6 },
  );
  for (const r of m.remnants)
    expect(
      r.x + r.width <= 24 || r.x >= 76 || r.y + r.height <= 24 || r.y >= 76,
    ).toBe(true);
});
it("rejects transferring equal-thickness parts to a different material", () => {
  const source = { ...p.sheets[0], material: "wood" };
  const target = { ...source, id: "target", material: "metal" };
  const project = { ...p, sheets: [source, target] };
  const layout = {
    sheets: [target],
    placements: [
      { partId: "a", sheetId: "target", x: 0, y: 0, rotation: 0 as const },
    ],
  };
  expect(
    validateLayout(project, layout, settings).some((i) =>
      i.message.includes("材料"),
    ),
  ).toBe(true);
});
it.each([null, NaN, Infinity, 6])(
  "rejects unknown or excessive pocket depth %s after thickness changes",
  (depth) => {
    const project = {
      ...p,
      parts: [
        { ...part, thickness: 5, pockets: [{ outline: part.outline, depth }] },
      ],
      sheets: p.sheets.map((s) => ({ ...s, thickness: 5 })),
    };
    const layout = {
      sheets: project.sheets,
      placements: [
        { partId: "a", sheetId: "s", x: 0, y: 0, rotation: 0 as const },
      ],
    };
    expect(
      validateLayout(project, layout, settings).some((i) =>
        i.message.includes("槽深"),
      ),
    ).toBe(true);
  },
);
