import { expect, it } from "vitest";
import { optimizeLayout } from "../src/core/nesting";
import { validateLayout } from "../src/core/geometry";
import type { Project, NestSettings } from "../src/core/types";

const settings: NestSettings = {
  mode: "utilization", gap: 0, margin: 0, allowRotation: false,
  minRemnantWidth: 1, minRemnantHeight: 1, iterations: 3,
};

// Two full-height strips are locked. A 3-wide strip must trade places with
// a 2-wide strip before the final 2-wide strip can leave the third sheet.
function exchangeFixture(): Project {
  const sheets = ["s", "t", "u"].map(id => ({
    id, name: id, width: 10, height: 10, thickness: 12, material: "wood",
  }));
  const parts = [6, 3, 5, 2, 2, 2].map((width, index) => ({
    id: `p${index}`, name: `p${index}`, stockId: index < 2 ? "s" : index < 5 ? "t" : "u",
    material: "wood", thickness: 12, width, height: 10, area: width * 10,
    layer: "", outline: [{x:0,y:0},{x:width,y:0},{x:width,y:10},{x:0,y:10}],
    holes: [], pockets: [], label: {x:width/2,y:5},
  }));
  const placements = parts.map((part, index) => ({
    partId: part.id, sheetId: part.stockId, x: [0,6,0,5,7,0][index], y: 0,
    rotation: 0 as const, locked: index === 0 || index === 2,
  }));
  return {name:"cross-sheet exchange",units:"mm",sheets,parts,warnings:[],original:{sheets,placements}};
}

it.each(["utilization", "machining", "remnant"] as const)("%s exchanges compatible parts across sheets to eliminate a sheet while keeping locked strips", mode => {
  const project = exchangeFixture();
  expect(validateLayout(project, project.original, settings)).toEqual([]);
  const before = JSON.stringify(project);
  const result = optimizeLayout(project, { ...settings, mode });
  if (process.env.NEST_BENCHMARK) console.log(mode,result.search,result.layout?.placements);
  expect(result.metrics?.sheetCount).toBe(2);
  expect(result.layout?.placements).toHaveLength(6);
  expect(validateLayout(project, result.layout!, settings)).toEqual([]);
  for (const locked of project.original.placements.filter(p=>p.locked))
    expect(result.layout!.placements.find(p=>p.partId===locked.partId)).toEqual(locked);
  expect(JSON.stringify(project)).toBe(before);
});


it.each(["material", "thickness"] as const)("does not exchange incompatible %s groups", constraint => {
  const project = exchangeFixture();
  const stock = project.sheets.find(s => s.id === "t")!;
  if (constraint === "material") stock.material = "metal";
  else stock.thickness = 18;
  for (const part of project.parts.filter(p => p.stockId === "t")) {
    part.material = stock.material;
    part.thickness = stock.thickness;
  }
  const result = optimizeLayout(project, settings);
  expect(result.metrics?.sheetCount).toBe(3);
  expect(validateLayout(project, result.layout!, settings)).toEqual([]);
  for (const part of project.parts.filter(p => p.stockId === "t"))
    expect(result.layout!.placements.find(p => p.partId === part.id)?.sheetId).toBe("t");
});

it("keeps the source when no search attempts are requested", () => {
  const project = exchangeFixture();
  const result = optimizeLayout(project, {...settings, iterations:0});
  expect(result.layout?.placements).toEqual(project.original.placements);
  expect(result.metrics?.sheetCount).toBe(3);
});
