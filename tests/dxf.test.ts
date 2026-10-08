import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseDxf } from "../src/core/dxf";
import { validateLayout } from "../src/core/geometry";
const text = readFileSync("public/sample.dxf", "utf8");
it("imports the independently measured sample", () => {
  const p = parseDxf(text);
  expect(p.sheets.map((s) => [s.width, s.height, s.thickness])).toEqual([
    [1220, 2440, 12],
    [1220, 2440, 12],
    [1220, 2440, 5],
  ]);
  expect(p.parts).toHaveLength(53);
  expect(p.parts.reduce((n, p) => n + p.holes.length, 0)).toBe(28);
  expect(p.parts.reduce((n, p) => n + p.pockets.length, 0)).toBe(29);
  expect(p.parts.find((p) => p.name === "P42")?.width).toBeCloseTo(348);
  expect(p.parts.find((p) => p.name === "P42")?.height).toBeCloseTo(792);
  const issues = validateLayout(p, p.original, {
    mode: "utilization",
    gap: 6,
    margin: 6,
    allowRotation: true,
    minRemnantWidth: 100,
    minRemnantHeight: 100,
    iterations: 1,
  });
  expect(
    issues.some(
      (i) =>
        i.kind === "gap" &&
        i.partIds.includes(p.parts.find((p) => p.name === "P16")!.id) &&
        i.partIds.includes(p.parts.find((p) => p.name === "P17")!.id),
    ),
  ).toBe(true);
});
it("rejects unsupported units", () =>
  expect(() =>
    parseDxf(text.replace(/\$INSUNITS\s+70\s+4/, "$INSUNITS\n70\n1")),
  ).toThrow(/毫米|单位/));
const dxf = (entities: string, units = 4) =>
  `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n${units}\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const poly = (id: string, layer: string, points: number[][], closed = true) =>
  `0\nLWPOLYLINE\n5\n${id}\n8\n${layer}\n90\n${points.length}\n70\n${closed ? 1 : 0}\n` +
  points
    .map(
      ([x, y, bulge]) =>
        `10\n${x}\n20\n${y}\n${bulge === undefined ? "" : `42\n${bulge}\n`}`,
    )
    .join("");
it("normalizes a rotated stock with collinear vertices", () => {
  const p = parseDxf(
    dxf(
      poly("s", "REF_STOCK", [
        [0, 0],
        [0, 610],
        [0, 1220],
        [-2440, 1220],
        [-2440, 0],
      ]) +
        poly("p", "CUT_12MM", [
          [-20, 20],
          [-20, 50],
          [-60, 50],
          [-60, 20],
        ]),
    ),
  );
  expect(p.sheets[0].width).toBe(1220);
  expect(p.sheets[0].height).toBe(2440);
  expect(p.parts[0].width).toBe(30);
  expect(p.parts[0].height).toBe(40);
});
it("samples a bulge semicircle with analytical radius and area", () => {
  const p = parseDxf(
    dxf(
      poly("s", "REF_STOCK", [
        [0, 0],
        [100, 0],
        [100, 200],
        [0, 200],
      ]) +
        poly("p", "CUT_12MM", [
          [20, 30, 1],
          [40, 30],
        ]),
    ),
  );
  expect(p.parts[0].width).toBeCloseTo(20);
  expect(p.parts[0].height).toBeCloseTo(10, 1);
  expect(p.parts[0].area).toBeCloseTo(Math.PI * 50, 0);
});
it("rejects open, self-intersecting and unsupported machining geometry", () => {
  const stock = poly("s", "REF_STOCK", [
    [0, 0],
    [100, 0],
    [100, 200],
    [0, 200],
  ]);
  expect(() =>
    parseDxf(
      dxf(
        stock +
          poly(
            "p",
            "CUT_12MM",
            [
              [20, 20],
              [40, 20],
              [40, 40],
            ],
            false,
          ),
      ),
    ),
  ).toThrow(/闭合/);
  expect(() =>
    parseDxf(
      dxf(
        stock +
          poly("p", "CUT_12MM", [
            [20, 20],
            [40, 40],
            [20, 40],
            [40, 20],
          ]),
      ),
    ),
  ).toThrow(/自交|无效/);
  expect(() => parseDxf(dxf(stock + "0\nSPLINE\n8\nCUT_12MM\n"))).toThrow(
    /不支持/,
  );
});
it("reconstructs a closed line chain with original handles", () => {
  const stock = poly("s", "REF_STOCK", [
    [0, 0],
    [100, 0],
    [100, 200],
    [0, 200],
  ]);
  const corners = [
    [20, 20],
    [40, 20],
    [40, 40],
    [20, 40],
  ];
  const chain = corners
    .map((a, i) => {
      const b = corners[(i + 1) % 4];
      return `0\nLINE\n5\nL${i}\n8\nCUT_12MM\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}\n`;
    })
    .join("");
  const p = parseDxf(dxf(stock + chain));
  expect(p.parts[0].id).toBe("L0+L1+L2+L3");
  expect(p.parts[0].area).toBe(400);
  expect(() => parseDxf(dxf(stock + chain + chain))).toThrow(/分支/);
});
