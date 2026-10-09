import { optimizeLayout } from "./nesting";
import { bounds, contourDistance, placedOutline, validateLayout } from "./geometry";
import type { Layout, LayoutMetrics, NestResult, NestSettings, Project, SearchProgress } from "./types";

/** Both repair scopes use SVGnest; temporary obstacles never become user locks. */
export function repairLayout(
  project: Project,
  settings: NestSettings,
  onProgress?: (generation: number, metrics: LayoutMetrics | null, layout?: Layout, progress?: SearchProgress) => void,
): NestResult {
  const start = performance.now();
  const seconds = settings.searchSeconds ?? 5;
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300)
    throw new Error("排版参数无效：搜索时长应为 1–300 秒");
  const issues = validateLayout(project, project.original, settings);
  const affected = new Set(issues.flatMap(issue => issue.partIds));
  // Adjacent parts may have to yield space for the requested clearance. Select
  // this one-hop neighborhood geometrically; SVGnest still chooses every move.
  const parts = new Map(project.parts.map(p => [p.id, p]));
  const contours = project.original.placements.flatMap(placement => {
    const part = parts.get(placement.partId);
    if (!part) return [];
    const outline = placedOutline(part, placement);
    return [{ placement, outline, box: bounds(outline) }];
  });
  const roots = contours.filter(c => affected.has(c.placement.partId));
  for (const a of roots) for (const b of contours) {
    if (a.placement.sheetId !== b.placement.sheetId || b.placement.locked) continue;
    const dx = Math.max(0, a.box.minX - b.box.maxX, b.box.minX - a.box.maxX);
    const dy = Math.max(0, a.box.minY - b.box.maxY, b.box.minY - a.box.maxY);
    if (Math.hypot(dx, dy) <= settings.gap + 1e-7 &&
        contourDistance(a.outline, b.outline) <= settings.gap + 1e-7)
      affected.add(b.placement.partId);
  }
  const original = new Map(project.original.placements.map(p => [p.partId, p]));
  const restoreLocks = (layout: Layout): Layout => ({
    ...layout,
    placements: layout.placements.map(p => {
      const { locked: _temporary, ...position } = p;
      const locked = original.get(p.partId)?.locked;
      return locked === undefined ? position : { ...position, locked };
    }),
  });
  const targeted = {
    ...project,
    original: {
      ...project.original,
      placements: project.original.placements.map(p => ({
        ...p, locked: p.locked || !affected.has(p.partId),
      })),
    },
  };
  const first = optimizeLayout(targeted, { ...settings, searchSeconds: Math.min(seconds, Math.max(1, seconds * 0.75)) },
    (generation, metrics, layout, progress) => {
      const restored = layout && restoreLocks(layout);
      if (!restored || validateLayout(project, restored, settings).length === 0)
        onProgress?.(generation, metrics, restored, progress && { ...progress, scope: "repair-nearby",
          elapsedMs: performance.now()-start, timeLimitMs:settings.stopRule === "patience" ? 0 : seconds*1000 });
    });
  if (first.layout) {
    const layout = restoreLocks(first.layout);
    if (validateLayout(project, layout, settings).length === 0)
      return { ...first, layout, message: "已生成问题零件及相邻零件的修复候选" };
  }
  const remaining = seconds - (performance.now() - start) / 1000;
  if (remaining < 1 && settings.stopRule !== "patience") return { ...first, layout: null, metrics: null, issues, elapsedMs: performance.now() - start };
  const full = optimizeLayout(project, settings.stopRule === "patience" ? settings : { ...settings, searchSeconds: remaining },
    (generation, metrics, layout, progress) => onProgress?.(first.attempts + generation, metrics, layout,
      progress && { ...progress, scope: "repair-full", elapsedMs:performance.now()-start, timeLimitMs:settings.stopRule === "patience" ? 0 : seconds*1000 }));
  return {
    ...full,
    attempts: first.attempts + full.attempts,
    elapsedMs: performance.now() - start,
    search: full.search && {
      ...full.search, seconds: settings.stopRule === "patience" ? 0 : seconds,
      generations: first.attempts + full.attempts,
      evaluations: (first.search?.evaluations ?? 0) + (full.search.evaluations ?? 0),
      candidates: (first.search?.candidates ?? 0) + full.search.candidates,
      candidateLimit: (first.search?.candidateLimit ?? 0) + full.search.candidateLimit,
      restarts: (first.search?.restarts ?? 0) + (full.search.restarts ?? 0),
    },
  };
}
