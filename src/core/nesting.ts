import type { Project, NestSettings, NestResult, Layout, LayoutMetrics, SearchProgress, SearchTrial } from "./types";
import { bounds, placedOutline, validateLayout, measureLayout, concentratedRemnantArea, polygonArea } from "./geometry";
import { PatienceTracker } from "./patience";
import { searchSvgNest } from "./svgNest";
import { modeGoals } from "./types";

/** Business objectives around SVGnest. No placement or local refinement lives here. */
export function optimizeLayout(
  project: Project,
  settings: NestSettings,
  onProgress?: (generation: number, best: LayoutMetrics | null, bestLayout?: Layout, progress?: SearchProgress) => void,
  onTrial?: (trial: SearchTrial) => void,
): NestResult {
  const searchSeconds = settings.searchSeconds ?? 5;
  if (
    !["utilization", "machining", "remnant"].includes(settings.mode) ||
    typeof settings.allowRotation !== "boolean" ||
    !Number.isFinite(searchSeconds) || searchSeconds < 1 || searchSeconds > 300 ||
    [settings.gap, settings.margin, settings.minRemnantWidth, settings.minRemnantHeight, settings.iterations]
      .some(v => !Number.isFinite(v) || v < 0)
  ) throw new Error("排版参数无效：需要有限非负数和已知模式");
  const plateauRule = settings.stopRule === "patience";
  const patienceLimit = settings.patienceGenerations ?? 50;
  if (plateauRule && (!Number.isInteger(patienceLimit) || patienceLimit < 1 || patienceLimit > 1000))
    throw new Error("耐心代数应为 1–1000 的整数");
  const start = performance.now();
  const deadline = plateauRule ? Infinity : start + searchSeconds * 1000;
  const parts = new Map(project.parts.map(p => [p.id, p]));
  const outlineArea = project.parts.reduce((sum,p)=>sum+polygonArea(p.outline),0);
  const originalMetrics = measureLayout(project, project.original, settings);
  const sourceIssues = validateLayout(project, project.original, settings);
  let best: Layout | null = null;
  let metrics: LayoutMetrics | null = null;
  let bestRank: number[] | undefined;
  let bestGoalRank: number[] | undefined;
  let objectiveImproved = false;
  let generation = 0;
  let improved = false;
  let bestEfficiency: number | null = null;
  let tracker: PatienceTracker | undefined;
  let plateauReached = false;
  let progress: SearchProgress = { group:0,groups:0,material:"",thickness:0,generation:0,
    generationLimit:plateauRule ? 0 : Math.min(100,Math.floor(settings.iterations)),phase:"preparing",elapsedMs:0,timeLimitMs:plateauRule ? 0 : searchSeconds*1000 };
  let lastPulse = start;
  const emitProgress = (layout?: Layout, now = performance.now()) => {
    lastPulse = now;
    progress = { ...progress, elapsedMs: now - start };
    onProgress?.(generation, metrics, layout, progress);
  };
  function objectiveRank(layout: Layout, m: LayoutMetrics): number[] {
    if (settings.mode === "machining") return [m.sheetCount, m.travel];
    if (settings.mode === "remnant") {
      const frontLoads = project.sheets.map(s => -layout.placements.filter(p => p.sheetId === s.id)
        .reduce((sum, p) => sum + parts.get(p.partId)!.area, 0));
      return [m.sheetCount, -concentratedRemnantArea(project, m), ...frontLoads, -m.reusableArea];
    }
    // For a fixed complete set of parts, less stock area means higher utilization.
    return [m.stockArea];
  }
  function rank(layout: Layout, m = measureLayout(project, layout, settings)): number[] {
    let extent = 0, moment = 0;
    for (const stock of layout.sheets) {
      const boxes = layout.placements.filter(p => p.sheetId === stock.id)
        .map(p => bounds(placedOutline(parts.get(p.partId)!, p)));
      extent += Math.max(0, ...boxes.map(b => b.maxX)) * Math.max(0, ...boxes.map(b => b.maxY));
      moment += boxes.reduce((sum, b) => sum + b.minX + b.minY, 0);
    }
    const objective = objectiveRank(layout, m);
    return settings.mode === "utilization" ? [...objective, m.sheetCount, extent, moment, m.travel]
      : [...objective, extent, moment, ...(settings.mode === "remnant" ? [m.travel] : [])];
  }
  function consider(layout: Layout, generated = true) {
    // Checkpoints and final results use original contours, never the NFP representation.
    if (validateLayout(project, layout, settings).length) return;
    const used = new Set(layout.placements.map(p => p.sheetId));
    const trial: Layout = {sheets: layout.sheets.filter(s => used.has(s.id)).map(s => ({...s})),
      placements: layout.placements.map(p => ({...p}))};
    const measured = measureLayout(project, trial, settings);
    bestEfficiency = bestEfficiency === null ? measured.utilization : Math.max(bestEfficiency, measured.utilization);
    const score = rank(trial, measured);
    // Ignore geometric tie-breakers when counting a machining/remnant plateau.
    const goalScore = objectiveRank(trial, measured);
    const firstGoal = bestGoalRank ? goalScore.findIndex((v, i) => Math.abs(v - bestGoalRank![i]) > 1e-7) : 0;
    if (!bestGoalRank || (firstGoal !== -1 && goalScore[firstGoal] < bestGoalRank[firstGoal])) {
      bestGoalRank = goalScore;
      objectiveImproved ||= generated;
    }
    if (bestRank) {
      const first = score.findIndex((v, i) => Math.abs(v - bestRank![i]) > 1e-7);
      if (first === -1 || score[first] >= bestRank[first]) return;
    }
    improved = generated;
    best = trial;
    metrics = measured;
    bestRank = score;
    emitProgress(best);
  }
  if (!sourceIssues.length) consider(project.original, false);
  if (plateauRule) {
    tracker = new PatienceTracker(patienceLimit,bestEfficiency);
    progress = { ...progress,patience:{limit:patienceLimit,unchanged:0,mode:settings.mode},curve:tracker.curve,rounds:0 };
    emitProgress();
  }
  const stats = searchSvgNest(project, settings, {
    onTrial,
    exhausted: () => {
      const now = performance.now();
      if (now - lastPulse >= 250) emitProgress(undefined, now);
      return now >= deadline;
    },
    rank,
    onLayout: layout => consider(layout),
    onFeasible: plateauRule ? layout => {
      const used = new Set(layout.placements.map(p=>p.sheetId));
      const area = layout.sheets.filter(s=>used.has(s.id)).reduce((sum,s)=>sum+s.width*s.height,0);
      const efficiency = area ? outlineArea/area : 0;
      // Pool incumbents may reject a candidate on the selected business objective;
      // the efficiency curve still observes every complete independently legal improvement.
      if ((bestEfficiency === null || efficiency > bestEfficiency + 1e-9) &&
          validateLayout(project,layout,settings).length===0) bestEfficiency=efficiency;
    } : undefined,
    onGeneration: count => {generation = count;},
    onStatus: status => { progress = { ...progress, ...status }; emitProgress(); },
    onRound: (round,stats) => {
      plateauReached = tracker!.observe(round,bestEfficiency,settings.mode === "utilization" ? undefined : objectiveImproved);
      objectiveImproved = false;
      progress = { ...progress,rounds:round,evaluations:stats.evaluations,restarts:stats.restarts,
        patience:{limit:patienceLimit,unchanged:tracker!.unchanged,mode:settings.mode},curve:tracker!.curve };
      emitProgress();
      return plateauReached;
    },
  });
  progress = { ...progress, phase: "finalizing" };
  emitProgress();
  const stoppedBy = plateauRule ? (plateauReached ? "plateau" : "exhausted")
    : !settings.iterations ? "disabled" : performance.now() >= deadline ? "time" : "iterations";
  return {
    layout: best, metrics, originalMetrics, attempts: stats.generations,
    elapsedMs: performance.now() - start,
    search: {...stats, improved, engine: "SVGnest · NFP + 遗传搜索", seconds: plateauRule ? 0 : searchSeconds,
      candidates: stats.evaluations, candidateLimit: plateauRule ? 0 : Math.min(100, Math.floor(settings.iterations)) * 10 * stats.groups, stoppedBy,
      ...(tracker ? {patienceLimit,patienceMode:settings.mode,unchanged:tracker.unchanged,curve:tracker.curve} : {})},
    message: best ? `${improved ? "找到更优完整排法" : "未找到改进，保留当前排版"} · ${stoppedBy === "plateau" ? `${modeGoals[settings.mode].label}连续 ${patienceLimit} 轮未改善，自动停止` : stoppedBy === "exhausted" ? "没有可继续搜索的未锁定零件" : stoppedBy === "time" ? "达到搜索时长，保留最佳方案" : stoppedBy === "disabled" ? "未执行优化" : "完成设定搜索轮数"}`
      : `${plateauReached ? `连续 ${patienceLimit} 轮未找到更好方案，自动停止；` : ""}本次搜索未找到满足间距、边距、锁定与板材约束的完整排版`,
    issues: best ? [] : sourceIssues,
  };
}
