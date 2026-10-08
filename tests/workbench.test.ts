import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseDxf } from "../src/core/dxf";
import { createWorkbenchStore } from "../src/store";
import { exportSvg } from "../src/core/export";
const project = () => parseDxf(readFileSync("public/sample.dxf", "utf8"));
it("invalidates candidates on settings and rejects stale results", () => {
  const s = createWorkbenchStore();
  s.getState().importProject(project());
  const run = s.getState().beginSearch();
  s.getState().setSettings({ gap: 6 });
  s.getState().receiveResult(run, { layout: project().original } as any);
  expect(s.getState().candidate).toBeNull();
  expect(s.getState().status).toBe("idle");
});
it("undo restores exact geometry and thickness invalidates history", () => {
  const s = createWorkbenchStore();
  s.getState().importProject(project());
  const old = structuredClone(s.getState().current!);
  const run = s.getState().beginSearch();
  s.getState().receiveResult(run, {
    layout: structuredClone(old),
    message: "ok",
    attempts: 1,
  } as any);
  s.getState().apply();
  s.getState().undo();
  expect(s.getState().current).toEqual(old);
  s.getState().setThickness(old.sheets[0].id, 5);
  expect(s.getState().history).toEqual([]);
  expect(s.getState().project!.original.placements).toEqual(old.placements);
});
it("a newer import wins and failed import keeps the prior project", () => {
  const s = createWorkbenchStore();
  const a = s.getState().beginImport();
  const b = s.getState().beginImport();
  s.getState().finishImport(b, project());
  s.getState().finishImport(a, { ...project(), name: "stale" });
  expect(s.getState().project!.name).not.toBe("stale");
  const c = s.getState().beginImport();
  s.getState().failImport(c, "bad");
  expect(s.getState().project).not.toBeNull();
  expect(s.getState().importing).toBe(false);
});
it("exports millimetres and transforms holes and pockets with rotation", () => {
  const p = project();
  const part = p.parts.find((p) => p.holes.length && p.pockets.length)!;
  const l = {
    sheets: p.sheets,
    placements: [
      {
        partId: part.id,
        sheetId: part.stockId,
        x: 11,
        y: 22,
        rotation: 90 as const,
      },
    ],
  };
  const svg = exportSvg(p, l);
  expect(svg).toContain('mm"');
  expect(svg).toContain('data-feature="hole"');
  expect(svg).toContain('data-feature="pocket"');
  expect(svg).toContain(part.name);
});
it("escapes user supplied SVG metadata and refuses nonfinite coordinates", () => {
  const p = project();
  p.name = '图纸 <wood> & "test"';
  p.parts[0].name = "P<1>&";
  p.sheets[0].material = '木 & "板"';
  const svg = exportSvg(p, p.original);
  expect(svg).toContain("图纸 &lt;wood&gt; &amp; &quot;test&quot;");
  expect(svg).toContain("P&lt;1&gt;&amp;");
  p.original.placements[0].x = Infinity;
  expect(() => exportSvg(p, p.original)).toThrow(/无效坐标/);
});
it("locks against current geometry without changing imported coordinates", () => {
  const s = createWorkbenchStore();
  s.getState().importProject(project());
  const original = structuredClone(s.getState().project!.original);
  const current = structuredClone(s.getState().current!);
  current.placements[0].x += 1;
  s.setState({ current });
  s.getState().toggleLock(current.placements[0].partId);
  expect(s.getState().current!.placements[0].locked).toBe(true);
  expect(s.getState().project!.original).toEqual(original);
});
it("presents CAD positive Y upward in SVG while leaving text upright and coordinates unchanged", () => {
  const p = project();
  const source = structuredClone(p.original);
  const part = p.parts[0];
  const placement = p.original.placements[0];
  const sheet = p.sheets.find((s) => s.id === placement.sheetId)!;
  const svg = exportSvg(p, p.original);
  const first = part.outline[0];
  expect(svg).toContain(
    `points="${placement.x + first.x},${sheet.height - placement.y - first.y}`,
  );
  expect(svg).toContain(
    `x="${placement.x + part.label.x}" y="${sheet.height - placement.y - part.label.y}"`,
  );
  expect(svg).not.toContain("scale(1 -1)");
  expect(p.original).toEqual(source);
});
