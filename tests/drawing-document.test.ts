import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readDrawing } from "../src/core/drawingDocument";
import { bounds, polygonArea } from "../src/core/geometry";
const dxf = (entities: string, units = 4, blocks = "") =>
  `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${units}\n0\nENDSEC\n${blocks ? `0\nSECTION\n2\nBLOCKS\n${blocks}0\nENDSEC\n` : ""}0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const poly = (
  id: string,
  layer = "anything",
  points = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  closed = true,
) =>
  `0\nLWPOLYLINE\n5\n${id}\n8\n${layer}\n90\n${points.length}\n70\n${closed ? 1 : 0}\n` +
  points
    .map(
      ([x, y, bulge]) =>
        `10\n${x}\n20\n${y}\n${bulge === undefined ? "" : `42\n${bulge}\n`}`,
    )
    .join("");
const line = (id: string, a: number[], b: number[], layer = "anything") =>
  `0\nLINE\n5\n${id}\n8\n${layer}\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}\n`;
const circle = (id: string, r = 10) =>
  `0\nCIRCLE\n5\n${id}\n8\nround\n10\n0\n20\n0\n40\n${r}\n`;
const block = (name: string, body: string, base = [0, 0]) =>
  `0\nBLOCK\n2\n${name}\n10\n${base[0]}\n20\n${base[1]}\n${body}0\nENDBLK\n`;
const insert = (id: string, name: string, x = 0, y = 0, extra = "") =>
  `0\nINSERT\n5\n${id}\n8\nassembled\n2\n${name}\n10\n${x}\n20\n${y}\n${extra}`;
const blocking = (doc: ReturnType<typeof readDrawing>) =>
  doc.diagnostics.filter((d) => d.severity === "blocking");
describe("general local DXF reader", () => {
  it("preserves arbitrary layer names, source coordinates and handles", () => {
    const doc = readDrawing(
      dxf(
        poly("A", "TOP-CUT-INSIDE_18.000MM", [
          [42, -7],
          [52, -7],
          [52, 3],
          [42, 3],
        ]),
      ),
    );
    expect(doc.shapes).toHaveLength(1);
    expect(doc.shapes[0]).toMatchObject({
      layer: "TOP-CUT-INSIDE_18.000MM",
      space: "model",
      sourceIds: ["A"],
      closed: true,
      valid: true,
      points: [
        { x: 42, y: -7 },
        { x: 52, y: -7 },
        { x: 52, y: 3 },
        { x: 42, y: 3 },
      ],
    });
    expect(blocking(doc)).toEqual([]);
  });
  it("requires explicit unknown units while preserving a raw preview", () => {
    const text = dxf(poly("A"), 0),
      doc = readDrawing(text);
    expect(doc.unitKnown).toBe(false);
    expect(doc.importInfo.scale).toBe(1);
    expect(doc.shapes[0].points[1].x).toBe(10);
    expect(blocking(doc).some((d) => /单位/.test(d.message))).toBe(true);
    const resolved = readDrawing(text, "cm", { unit: "cm" });
    expect(resolved.unitKnown).toBe(true);
    expect(resolved.shapes[0].points[1].x).toBe(100);
    expect(blocking(resolved)).toEqual([]);
  });
  it("converts inch units before curve sampling", () => {
    const doc = readDrawing(dxf(poly("a"), 1));
    expect(doc.shapes[0].points[1].x).toBe(254);
    expect(doc.importInfo.scale).toBe(25.4);
  });
  it("separates layouts and model space and retains all text labels", () => {
    const text =
      "0\nMTEXT\n5\nt\n8\nnotes\n410\nLayout1\n67\n1\n10\n5\n20\n6\n1\nhello\n";
    const viewport =
      "0\nVIEWPORT\n5\nv\n8\nviews\n410\nLayout1\n67\n1\n10\n0\n20\n0\n30\n99\n";
    const dimension = "0\nDIMENSION\n5\nd\n8\nnotes\n";
    const doc = readDrawing(
      dxf(
        poly("a") +
          poly("b") +
          "410\nLayout1\n67\n1\n" +
          text +
          viewport +
          dimension,
      ),
    );
    expect(doc.spaces).toEqual(["model", "Layout1"]);
    expect(doc.shapes.map((s) => s.space)).toEqual(["model", "Layout1"]);
    expect(doc.labels[0]).toMatchObject({
      text: "hello",
      layer: "notes",
      space: "Layout1",
      point: { x: 5, y: 6 },
    });
    expect(blocking(doc)).toEqual([]);
    expect(doc.diagnostics.some((d) => /VIEWPORT/.test(d.message))).toBe(true);
  });
  it("retains open chains and stitches closed LINE/ARC contours with every handle", () => {
    const triangle =
      line("a", [0, 0], [10, 0]) +
      line("b", [10, 10], [10, 0]) +
      line("c", [10, 10], [0, 0]);
    const doc = readDrawing(dxf(triangle + line("open", [20, 0], [30, 0])));
    expect(doc.shapes).toHaveLength(2);
    expect(doc.shapes.find((s) => s.closed)).toMatchObject({
      closed: true,
      valid: true,
      sourceIds: ["a", "b", "c"],
    });
    expect(doc.shapes.find((s) => !s.closed)).toMatchObject({
      closed: false,
      valid: false,
      sourceIds: ["open"],
    });
    expect(blocking(doc).some((d) => /闭合/.test(d.message))).toBe(true);
    const arc =
      "0\nARC\n5\narc\n8\nanything\n10\n0\n20\n0\n40\n10\n50\n0\n51\n180\n";
    const curved = readDrawing(dxf(arc + line("diameter", [-10, 0], [10, 0])));
    expect(curved.shapes[0].closed).toBe(true);
    expect(polygonArea(curved.shapes[0].points)).toBeCloseTo(Math.PI * 50, 0);
  });
  it("diagnoses branched and self crossing geometry without losing other shapes", () => {
    const doc = readDrawing(
      dxf(
        poly("good", "safe") +
          poly("bad", "cross", [
            [0, 0],
            [10, 10],
            [0, 10],
            [10, 0],
          ]) +
          line("a", [20, 0], [30, 0]) +
          line("b", [30, 0], [30, 10]) +
          line("c", [30, 0], [40, 0]),
      ),
    );
    expect(doc.shapes.find((s) => s.sourceIds.includes("good"))?.valid).toBe(
      true,
    );
    expect(doc.shapes.find((s) => s.sourceIds.includes("bad"))?.valid).toBe(
      false,
    );
    expect(blocking(doc).some((d) => /分支/.test(d.message))).toBe(true);
  });
  it("samples bulges and circles within the physical chord error", () => {
    const doc = readDrawing(
      dxf(
        poly("bulge", "curve", [
          [20, 30, 1],
          [40, 30],
        ]) + circle("circle"),
      ),
    );
    const bulge = doc.shapes[0];
    expect(bounds(bulge.points).width).toBe(20);
    expect(bounds(bulge.points).height).toBeCloseTo(10, 1);
    expect(polygonArea(bulge.points)).toBeCloseTo(Math.PI * 50, 0);
    const points = doc.shapes[1].points;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      expect(
        10 - Math.hypot((a.x + b.x) / 2, (a.y + b.y) / 2),
      ).toBeLessThanOrEqual(0.025001);
    }
  });
  it("expands nested blocks with base points, mirrored scales, rotation and layer inheritance", () => {
    const blocks =
      block(
        "inner",
        poly("p", "0", [
          [1, 2],
          [11, 2],
          [11, 7],
          [1, 7],
        ]),
        [1, 2],
      ) +
      block(
        "outer",
        insert("nested", "inner", 3, 4, "41\n-2\n42\n3\n50\n90\n"),
      );
    const doc = readDrawing(
      dxf(
        insert("first", "outer", 100, 200) +
          insert("second", "outer", 300, 200),
        4,
        blocks,
      ),
    );
    expect(blocking(doc)).toEqual([]);
    expect(doc.shapes).toHaveLength(2);
    expect(doc.shapes[0].layer).toBe("assembled");
    expect(doc.shapes[0].points).toEqual([
      { x: 103, y: 204 },
      { x: 103, y: 184 },
      { x: 88, y: 184 },
      { x: 88, y: 204 },
    ]);
    expect(new Set(doc.shapes.map((s) => s.id)).size).toBe(2);
    expect(doc.shapes[0].sourceIds).toEqual(["first", "nested", "p"]);
  });
  it("keeps touching contours in separate block instances and expands bounded grids", () => {
    const body = block("lines", line("a", [0, 0], [10, 0]));
    const doc = readDrawing(
      dxf(
        insert("grid", "lines", 0, 0, "70\n2\n71\n2\n44\n10\n45\n20\n"),
        4,
        body,
      ),
    );
    expect(doc.shapes).toHaveLength(4);
    expect(doc.shapes.every((s) => s.points.length === 2)).toBe(true);
    expect(new Set(doc.shapes.map((s) => s.id)).size).toBe(4);
  });
  it("rejects recursive and missing blocks with identifiable diagnostics", () => {
    const doc = readDrawing(
      dxf(
        insert("loop", "recursive") + insert("missing", "absent"),
        4,
        block("recursive", insert("again", "recursive")),
      ),
    );
    expect(blocking(doc).some((d) => /循环|递归/.test(d.message))).toBe(true);
    expect(blocking(doc).some((d) => /absent/.test(d.message))).toBe(true);
  });
  it("samples a rotated ellipse with known axes", () => {
    const ellipse =
      "0\nELLIPSE\n5\nellipse\n8\nellipses\n10\n5\n20\n10\n11\n0\n21\n20\n40\n0.5\n41\n0\n42\n6.283185307179586\n";
    const doc = readDrawing(dxf(ellipse));
    expect(blocking(doc)).toEqual([]);
    expect(doc.shapes[0]).toMatchObject({ closed: true, valid: true });
    expect(bounds(doc.shapes[0].points).width).toBeCloseTo(20, 1);
    expect(bounds(doc.shapes[0].points).height).toBeCloseTo(40, 1);
    expect(
      Math.abs(polygonArea(doc.shapes[0].points) - Math.PI * 200),
    ).toBeLessThan(2);
  });
  it("evaluates a rational spline quarter circle without dropping weights", () => {
    const spline =
      "0\nSPLINE\n5\nspline\n8\nsplines\n70\n12\n71\n2\n72\n6\n73\n3\n40\n0\n40\n0\n40\n0\n40\n1\n40\n1\n40\n1\n41\n1\n41\n0.7071067811865476\n41\n1\n10\n10\n20\n0\n10\n10\n20\n10\n10\n0\n20\n10\n";
    const doc = readDrawing(dxf(spline));
    expect(doc.shapes).toHaveLength(1);
    expect(doc.shapes[0].points[0]).toEqual({ x: 10, y: 0 });
    expect(doc.shapes[0].points.at(-1)).toEqual({ x: 0, y: 10 });
    expect(doc.shapes[0].points.length).toBeGreaterThan(10);
    for (const p of doc.shapes[0].points)
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 5);
    expect(blocking(doc).every((d) => /闭合/.test(d.message))).toBe(true);
  });
  it("detects dropped unsupported entities including block members", () => {
    const unknown = "0\n3DSOLID\n5\nsolid\n8\nvolume\n";
    const doc = readDrawing(
      dxf(
        poly("valid") + unknown + insert("i", "bad"),
        4,
        block("bad", "0\nREGION\n5\nr\n8\n0\n"),
      ),
    );
    expect(doc.shapes).toHaveLength(1);
    expect(
      blocking(doc).some(
        (d) => d.layer === "volume" && /3DSOLID/.test(d.message),
      ),
    ).toBe(true);
    expect(blocking(doc).some((d) => /REGION/.test(d.message))).toBe(true);
  });
  it("blocks nonplanar geometry while accepting minus-Z planar OCS correctly", () => {
    const tilted = poly("tilted") + "210\n0\n220\n1\n230\n0\n";
    const high = poly("high") + "38\n5\n";
    const mirror = poly("mirror", "mirror") + "210\n0\n220\n0\n230\n-1\n";
    const doc = readDrawing(dxf(tilted + high + mirror));
    expect(blocking(doc).some((d) => /OCS/.test(d.message))).toBe(true);
    expect(blocking(doc).some((d) => /三维|高程/.test(d.message))).toBe(true);
    expect(
      doc.shapes.find((s) => s.sourceIds.includes("mirror"))?.points[1],
    ).toEqual({ x: -10, y: 0 });
  });
  it("recovers subsequent valid entities after one malformed record", () => {
    const doc = readDrawing(
      dxf("0\nCIRCLE\n5\nbad\n8\nround\n10\n0\n40\n-1\n" + poly("ok")),
    );
    expect(doc.shapes.some((s) => s.sourceIds.includes("ok") && s.valid)).toBe(
      true,
    );
    expect(blocking(doc)).toHaveLength(1);
  });
  it("gives duplicate handles unique stable ids and diagnoses the source issue", () => {
    const text = dxf(poly("same") + poly("same", "other"));
    const a = readDrawing(text),
      b = readDrawing(text);
    expect(new Set(a.shapes.map((s) => s.id)).size).toBe(2);
    expect(a.shapes.map((s) => s.id)).toEqual(b.shapes.map((s) => s.id));
    expect(a.shapes.every((s) => s.sourceIds[0] === "same")).toBe(true);
    expect(blocking(a).some((d) => /重复/.test(d.message))).toBe(true);
  });
  it("checks per entity and total point budgets before oversized allocation", () => {
    expect(() => readDrawing(dxf(circle("huge", 1e300)))).toThrow(/4096|复杂/);
    expect(() =>
      readDrawing(
        dxf(
          poly(
            "raw",
            "huge",
            Array.from({ length: 4097 }, (_, i) => [i, 0]),
          ),
        ),
      ),
    ).toThrow(/4096|复杂/);
    expect(() =>
      readDrawing(
        dxf(
          Array.from({ length: 30 }, (_, i) => circle(`c${i}`, 20000)).join(""),
        ),
      ),
    ).toThrow(/50000|复杂/);
    expect(() =>
      readDrawing(
        dxf(
          insert("huge", "p", 0, 0, "70\n1000000\n71\n1000000\n"),
          4,
          block("p", poly("p")),
        ),
      ),
    ).toThrow(/实例|复杂/);
  });
  it("blocks unmatched HATCH boundaries but identifies duplicate fill boundaries", () => {
    const hatch =
      "0\nHATCH\n5\nhatch\n8\nfill\n91\n1\n92\n2\n72\n0\n73\n1\n93\n4\n10\n0\n20\n0\n10\n10\n20\n0\n10\n10\n20\n10\n10\n0\n20\n10\n97\n0\n";
    const absent = readDrawing(
      dxf(
        hatch +
          poly("other", "part", [
            [20, 20],
            [30, 20],
            [30, 30],
            [20, 30],
          ]),
      ),
    );
    expect(
      blocking(absent).some(
        (d) => d.layer === "fill" && /HATCH/.test(d.message),
      ),
    ).toBe(true);
    const duplicate = readDrawing(dxf(hatch + poly("outline")));
    expect(blocking(duplicate)).toEqual([]);
    expect(duplicate.shapes).toHaveLength(1);
    expect(
      duplicate.diagnostics.some(
        (d) => d.severity === "info" && /HATCH/.test(d.message),
      ),
    ).toBe(true);
  });
  it("retains INSERT attributes and their existing world positions", () => {
    const attribute =
      "0\nATTRIB\n5\nattribute\n8\n0\n10\n105\n20\n206\n1\npart label\n0\nSEQEND\n";
    const doc = readDrawing(
      dxf(
        insert("i", "part", 100, 200, "66\n1\n") + attribute,
        4,
        block("part", poly("part", "0")),
      ),
    );
    expect(blocking(doc)).toEqual([]);
    expect(doc.labels[0]).toMatchObject({
      layer: "assembled",
      text: "part label",
      point: { x: 105, y: 206 },
    });
  });
  it("keeps valid closed chains independent of disconnected branches on the same layer", () => {
    const edges =
      line("a", [0, 0], [10, 0]) +
      line("b", [10, 0], [10, 10]) +
      line("c", [10, 10], [0, 0]);
    const branch =
      line("d", [20, 0], [30, 0]) +
      line("e", [30, 0], [40, 0]) +
      line("f", [30, 0], [30, 10]);
    const doc = readDrawing(dxf(edges + branch));
    const valid = doc.shapes.find((s) => s.sourceIds.includes("a"))!;
    expect(valid.valid).toBe(true);
    expect(doc.diagnostics.some((d) => d.shapeId === valid.id)).toBe(false);
  });
  it("recognizes explicit repeated endpoints while diagnosing mismatched DXF vertex counts", () => {
    const repeated = poly(
      "repeated",
      "closed",
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 0],
      ],
      false,
    );
    const wrong = poly("wrong").replace("90\n4\n", "90\n3\n");
    const doc = readDrawing(dxf(repeated + wrong));
    expect(
      doc.shapes.find((s) => s.sourceIds.includes("repeated")),
    ).toMatchObject({ closed: true, valid: true });
    expect(blocking(doc).some((d) => /顶点|数量/.test(d.message))).toBe(true);
  });
  it("applies physical sampling tolerance after nonuniform mirrored curve transforms", () => {
    const doc = readDrawing(
      dxf(
        insert("i", "curve", 100, 200, "41\n-2\n42\n3\n"),
        4,
        block("curve", circle("round")),
      ),
    );
    const shape = doc.shapes[0];
    expect(blocking(doc)).toEqual([]);
    expect(bounds(shape.points).width).toBeCloseTo(40, 1);
    expect(bounds(shape.points).height).toBeCloseTo(60, 1);
    for (const point of shape.points)
      expect(
        Math.pow((point.x - 100) / 20, 2) + Math.pow((point.y - 200) / 30, 2),
      ).toBeCloseTo(1, 5);
  });
  it("reads closed linear splines across every nonzero knot span", () => {
    const spline =
      "0\nSPLINE\n5\nsquare\n8\nspline\n70\n9\n71\n1\n72\n7\n73\n5\n" +
      [2, 2, 3, 4, 5, 6, 6].map((k) => `40\n${k}\n`).join("") +
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ]
        .map(([x, y]) => `10\n${x}\n20\n${y}\n`)
        .join("");
    const doc = readDrawing(dxf(spline));
    expect(blocking(doc)).toEqual([]);
    expect(doc.shapes[0]).toMatchObject({ closed: true, valid: true });
    expect(polygonArea(doc.shapes[0].points)).toBe(100);
  });
  it("retains elevated text as a label without treating it as machining geometry", () => {
    const text =
      "0\nTEXT\n5\nannotation\n8\nnotes\n10\n3\n20\n4\n30\n5\n1\nhello\n";
    const doc = readDrawing(dxf(text + poly("part")));
    expect(blocking(doc)).toEqual([]);
    expect(doc.labels[0]).toMatchObject({
      text: "hello",
      point: { x: 3, y: 4 },
    });
  });
  it("diagnoses duplicate and elevated block definitions", () => {
    const duplicate = block("part", poly("a")) + block("part", poly("b"));
    const elevated = block("high", poly("high")).replace(
      "20\n0\n",
      "20\n0\n30\n5\n",
    );
    const doc = readDrawing(
      dxf(insert("i", "part") + insert("j", "high"), 4, duplicate + elevated),
    );
    expect(blocking(doc).some((d) => /块.*重复|重复.*块/.test(d.message))).toBe(
      true,
    );
    expect(blocking(doc).some((d) => /三维|高程/.test(d.message))).toBe(true);
  });
  it("retains the handles of legacy polyline vertices", () => {
    const legacy =
      "0\nPOLYLINE\n5\nparent\n8\nlegacy\n70\n1\n" +
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ]
        .map(([x, y], i) => `0\nVERTEX\n5\nv${i}\n10\n${x}\n20\n${y}\n`)
        .join("") +
      "0\nSEQEND\n";
    const doc = readDrawing(dxf(legacy));
    expect(blocking(doc)).toEqual([]);
    expect(doc.shapes[0].sourceIds).toEqual(["parent", "v0", "v1", "v2", "v3"]);
  });
  it("normalizes the DXF reserved Model layout name", () => {
    const doc = readDrawing(dxf(poly("model") + "410\nModel\n"));
    expect(doc.spaces).toEqual(["model"]);
    expect(doc.shapes[0].space).toBe("model");
  });
  it("recovers valid entities after nonfinite spline control coordinates", () => {
    const spline =
      "0\nSPLINE\n5\nbad\n8\nspline\n71\n1\n40\n0\n40\n0\n40\n1\n40\n1\n10\nNaN\n20\n0\n10\n10\n20\n10\n";
    const doc = readDrawing(dxf(spline + poly("good")));
    expect(doc.shapes[0].sourceIds).toEqual(["good"]);
    expect(blocking(doc).some((d) => /坐标/.test(d.message))).toBe(true);
  });
  it("preserves the sample inventory and source points exactly", () => {
    const text = readFileSync("public/sample.dxf", "utf8"),
      doc = readDrawing(text);
    expect(blocking(doc)).toEqual([]);
    for (const [prefix, count] of [
      ["REF_STOCK", 3],
      ["CUT", 53],
      ["HOLE", 28],
      ["POCKET", 29],
    ] as const)
      expect(doc.shapes.filter((s) => s.layer.startsWith(prefix))).toHaveLength(
        count,
      );
    expect(doc.labels).toHaveLength(60);
    expect(doc.labels.filter((l) => /^P\d+$/.test(l.text))).toHaveLength(53);
    expect(doc.shapes.every((s) => s.closed && s.valid)).toBe(true);
    const match = text.match(
      /0\s+LWPOLYLINE\s+5\s+(\S+)[\s\S]*?10\s+([\d.-]+)\s+20\s+([\d.-]+)/,
    )!;
    expect(
      doc.shapes.find((s) => s.sourceIds.includes(match[1]))?.points[0],
    ).toEqual({ x: Number(match[2]), y: Number(match[3]) });
  });
});
