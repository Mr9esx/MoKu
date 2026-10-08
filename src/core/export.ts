import type { Project, Layout, Point, NestSettings } from "./types";
import { transformPoints, validateLayout } from "./geometry";
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
// Convert CAD positive-Y-up coordinates for SVG without flipping text glyphs.
export const displayPoints = (p: Point[], sheetHeight: number) =>
  p.map((v) => ({ x: v.x, y: sheetHeight - v.y }));
export const points = (p: Point[]) => p.map((v) => `${v.x},${v.y}`).join(" ");
export function exportSvg(project: Project, layout: Layout) {
  if (
    !layout.sheets.length ||
    layout.sheets.some(
      (s) => ![s.width, s.height, s.thickness].every(Number.isFinite),
    ) ||
    layout.placements.some(
      (p) => ![p.x, p.y, p.rotation].every(Number.isFinite),
    ) ||
    project.parts.some((p) =>
      [
        ...p.outline,
        ...p.holes.flat(),
        ...p.pockets.flatMap((v) => v.outline),
        p.label,
      ].some((v) => !Number.isFinite(v.x) || !Number.isFinite(v.y)),
    )
  )
    throw new Error("无法导出含无效坐标的排版");
  const gap = 100,
    width = layout.sheets.reduce((n, s) => n + s.width + gap, 0) - gap,
    height = Math.max(...layout.sheets.map((s) => s.height), 1);
  let offset = 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><title>${esc(project.name)} — 二维板材排版，单位 mm</title>${layout.sheets
    .map((s) => {
      const x = offset;
      offset += s.width + gap;
      return `<g transform="translate(${x} 0)" data-sheet="${esc(s.id)}" data-thickness-mm="${s.thickness}" data-material="${esc(s.material)}"><rect width="${s.width}" height="${s.height}" fill="#f3f1eb" stroke="#25382e"/>${layout.placements
        .filter((p) => p.sheetId === s.id)
        .map((p) => {
          const part = project.parts.find((v) => v.id === p.partId)!;
          const path = (poly: Point[], feature: string, fill: string) =>
            `<polygon data-feature="${feature}" points="${points(displayPoints(transformPoints(poly, part, p), s.height))}" fill="${fill}" stroke="#25382e" stroke-width="0.6"/>`;
          const label = displayPoints(
            transformPoints([part.label], part, p),
            s.height,
          )[0];
          return `<g id="part-${esc(part.id)}" data-thickness-mm="${part.thickness}"><title>${esc(part.name)}</title>${path(part.outline, "outline", part.thickness > 5 ? "#ccb58e" : "#a4b69c")}${part.pockets.map((pocket) => `<g data-pocket-depth-mm="${pocket.depth ?? "unknown"}">${path(pocket.outline, "pocket", "#e6e8da")}</g>`).join("")}${part.holes.map((h) => path(h, "hole", "#a4c2d3")).join("")}<text x="${label.x}" y="${label.y}" text-anchor="middle" font-size="18">${esc(part.name)}</text></g>`;
        })
        .join("")}</g>`;
    })
    .join("")}</svg>`;
}

/** Source placement is an inspection exception, not a claim of cutter legality. */
export function exportEligibility(
  project: Project,
  current: Layout,
  settings: NestSettings,
) {
  const originals = new Map(
    (project.importedSource ?? project).original.placements.map((p) => [
      p.partId,
      p,
    ]),
  );
  const source =
    (!project.importedSource ||
      (JSON.stringify(
        project.parts.map(
          ({ thickness: _t, stockId: _s, ...geometry }) => geometry,
        ),
      ) ===
        JSON.stringify(
          project.importedSource.parts.map(
            ({ thickness: _t, stockId: _s, ...geometry }) => geometry,
          ),
        ) &&
        JSON.stringify(
          project.sheets.map(({ thickness: _t, ...stock }) => stock),
        ) ===
          JSON.stringify(
            project.importedSource.sheets.map(
              ({ thickness: _t, ...stock }) => stock,
            ),
          ))) &&
    current.placements.length === originals.size &&
    new Set(current.placements.map((p) => p.partId)).size === originals.size &&
    current.placements.every((p) => {
      const original = originals.get(p.partId);
      return (
        original &&
        p.sheetId === original.sheetId &&
        p.x === original.x &&
        p.y === original.y &&
        p.rotation === original.rotation
      );
    });
  const issues = validateLayout(
    { ...project, original: current },
    current,
    settings,
  );
  const allowed = source || issues.length === 0;
  return {
    allowed,
    source,
    reason: !allowed
      ? `当前排版有 ${issues.length} 项冲突，请调整参数或恢复原图后导出。`
      : source && issues.length
        ? "原图排版可导出供核对"
        : "毫米单位 · 排版参考图",
  };
}
export function exportCurrentSvg(
  project: Project,
  current: Layout,
  settings: NestSettings,
) {
  const eligibility = exportEligibility(project, current, settings);
  if (!eligibility.allowed) throw new Error(eligibility.reason);
  return exportSvg(project, current);
}
