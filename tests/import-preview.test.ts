import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseDxf } from "../src/core/dxf";
import * as imports from "../src/core/importTransaction";

const text = readFileSync("public/sample.dxf", "utf8");
it("retains edited metadata when the same drawing is reparsed with an explicit unit", () => {
  const original = parseDxf(text), scaled = parseDxf(text, "sample", { unit: "mm" });
  const edited = { [original.sheets[0].id]: { thickness: 18, material: "桦木" } };
  const metadata = imports.reconcileStockMetadata(scaled.sheets, edited, true);
  expect(metadata[scaled.sheets[0].id]).toEqual({ thickness: 18, material: "桦木" });
  expect(scaled.sheets[0].width).toBe(1220);
  expect(imports.confirmMetadata(scaled, { stocks: metadata }).sheets[0].thickness).toBe(18);
});
it("does not assign an old stock's edits to a newly recognized stock", () => {
  const draft = parseDxf(text);
  const metadata = imports.reconcileStockMetadata([{ ...draft.sheets[0], id: "new" }],
    { [draft.sheets[0].id]: { thickness: 18, material: "桦木" } }, false);
  expect(metadata.new).toEqual({ thickness: 12, material: "" });
});
it("reports the exact board and field that prevent confirmation", () => {
  const draft = parseDxf(text);
  expect(() => imports.confirmMetadata(draft, { stocks: {
    [draft.sheets[0].id]: { thickness: 12, material: "桦木" },
    [draft.sheets[1].id]: { thickness: 101, material: "桦木" },
    [draft.sheets[2].id]: { thickness: 5, material: "桦木" },
  } })).toThrow(/板材 2.*板厚/);
});
it("exposes the input unit and actual conversion factor without changing geometry", () => {
  const drawing = [0,"SECTION",2,"HEADER",9,"$INSUNITS",70,4,0,"ENDSEC",0,"SECTION",2,"ENTITIES",
    0,"LWPOLYLINE",5,"part",8,"CUT",90,4,70,1,10,0,20,0,10,20,20,0,10,20,20,10,10,0,20,10,
    0,"ENDSEC",0,"EOF",""].join("\n");
  const auto = parseDxf(drawing, "part", { mode: "parts" }), explicit = parseDxf(drawing, "part", { mode: "parts", unit: "cm" });
  expect(auto.importInfo).toEqual({ sourceUnit: "毫米", scale: 1, overridden: false });
  expect(explicit.importInfo).toEqual({ sourceUnit: "厘米", scale: 10, overridden: true });
  expect(auto.parts[0].width).toBe(20);
  expect(explicit.parts[0].width).toBe(200);
});
it("uses declared machining layers to distinguish identical inner contours", () => {
  const drawing = (layer: string) => [0,"SECTION",2,"HEADER",9,"$INSUNITS",70,4,0,"ENDSEC",0,"SECTION",2,"ENTITIES",
    0,"LWPOLYLINE",5,"part",8,"CUT",90,4,70,1,10,0,20,0,10,20,20,0,10,20,20,10,10,0,20,10,
    0,"CIRCLE",5,"feature",8,layer,10,10,20,5,40,2,0,"ENDSEC",0,"EOF",""].join("\n");
  const hole = parseDxf(drawing("HOLE"), "part", { mode: "parts" }).parts[0];
  const pocket = parseDxf(drawing("POCKET_DEPTH3"), "part", { mode: "parts" }).parts[0];
  expect(hole.holes).toHaveLength(1);
  expect(hole.pockets).toHaveLength(0);
  expect(pocket.holes).toHaveLength(0);
  expect(pocket.pockets[0]).toMatchObject({ depth: 3, outline: hole.holes[0] });
  expect(() => parseDxf(drawing("CUT"), "part", { mode: "parts" })).toThrow(/加工语义不明确/);
});
