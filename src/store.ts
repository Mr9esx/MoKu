import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { measureLayout, validateLayout } from "./core/geometry";
import type { Project, Layout, NestSettings, NestResult } from "./core/types";
export const defaults: NestSettings = {
  mode: "remnant",
  gap: 3,
  margin: 6,
  allowRotation: true,
  minRemnantWidth: 100,
  minRemnantHeight: 100,
  iterations: 24,
};
type State = {
  project: Project | null;
  current: Layout | null;
  candidate: NestResult | null;
  history: Layout[];
  selected: string | null;
  settings: NestSettings;
  status: "idle" | "searching" | "done" | "error";
  message: string;
  attempt: number;
  run: number;
  importRun: number;
  importing: boolean;
  view: "original" | "current" | "candidate";
  importProject: (p: Project) => void;
  beginImport: () => number;
  finishImport: (id: number, p: Project) => void;
  failImport: (id: number, error: string) => void;
  setSettings: (s: Partial<NestSettings>) => void;
  setThickness: (id: string, n: number) => void;
  toggleLock: (id: string) => void;
  select: (id: string) => void;
  setView: (v: State["view"]) => void;
  beginSearch: () => number;
  receiveResult: (id: number, r: NestResult) => void;
  progress: (id: number, n: number, bestLayout?: Layout) => void;
  cancel: () => void;
  apply: () => void;
  undo: () => void;
  reset: () => void;
};
let worker: Worker | null = null;
export function stopWorker() {
  worker?.terminate();
  worker = null;
}
export function createWorkbenchStore() {
  return createStore<State>((set, get) => {
    const invalidate = () => {
      stopWorker();
      return {
        candidate: null,
        status: "idle" as const,
        run: get().run + 1,
        view: "current" as const,
        message: "",
        attempt: 0,
      };
    };
    const load = (project: Project) =>
      set({
        ...invalidate(),
        project: structuredClone(project),
        current: structuredClone(project.original),
        history: [],
        selected: null,
        importing: false,
      });
    return {
      project: null,
      current: null,
      candidate: null,
      history: [],
      selected: null,
      settings: defaults,
      status: "idle",
      message: "",
      attempt: 0,
      run: 0,
      importRun: 0,
      importing: false,
      view: "current",
      importProject: load,
      beginImport: () => {
        const id = get().importRun + 1;
        set({ ...invalidate(), importRun: id, importing: true });
        return id;
      },
      finishImport: (id, p) => {
        if (id === get().importRun) load(p);
      },
      failImport: (id, message) => {
        if (id === get().importRun)
          set({ importing: false, message, status: "error" });
      },
      setSettings: (s) =>
        set({ ...invalidate(), settings: { ...get().settings, ...s } }),
      setThickness: (id, n) => {
        if (!Number.isFinite(n) || n <= 0 || n > 100) return;
        const p = get().project,
          c = get().current;
        if (!p || !c) return;
        const sheets = (ss: Layout["sheets"]) =>
          ss.map((s) => (s.id === id ? { ...s, thickness: n } : s));
        set({
          ...invalidate(),
          project: {
            ...p,
            sheets: sheets(p.sheets),
            parts: p.parts.map((part) =>
              part.stockId === id ? { ...part, thickness: n } : part,
            ),
            original: { ...p.original, sheets: sheets(p.original.sheets) },
          },
          current: { ...c, sheets: sheets(c.sheets) },
          history: [],
        });
      },
      toggleLock: (id) => {
        const c = get().current;
        if (c)
          set({
            ...invalidate(),
            current: {
              ...c,
              placements: c.placements.map((p) =>
                p.partId === id ? { ...p, locked: !p.locked } : p,
              ),
            },
          });
      },
      select: (selected) => set({ selected }),
      setView: (view) => set({ view }),
      beginSearch: () => {
        const run = get().run + 1;
        stopWorker();
        set({
          run,
          status: "searching",
          candidate: null,
          message: "正在寻找完整可行排版…",
          attempt: 0,
          view: "current",
        });
        return run;
      },
      receiveResult: (id, r) => {
        if (id !== get().run || get().status !== "searching") return;
        stopWorker();
        const s = get();
        const valid =
          r.layout &&
          s.project &&
          s.current &&
          validateLayout(
            { ...s.project, original: s.current },
            r.layout,
            s.settings,
          ).length === 0;
        set({
          candidate: valid ? r : null,
          status: valid ? "done" : "error",
          message: r.message,
          attempt: r.attempts,
          view: valid ? "candidate" : "current",
        });
      },
      progress: (id, attempt, bestLayout) => {
        const s = get();
        if (id !== s.run || s.status !== "searching") return;
        set({ attempt });
        if (!bestLayout || !s.project || !s.current ||
          validateLayout({ ...s.project, original: s.current }, bestLayout, s.settings).length) return;
        set({ candidate: {
          layout: structuredClone(bestLayout),
          metrics: measureLayout(s.project, bestLayout, s.settings),
          originalMetrics: s.candidate?.originalMetrics ?? measureLayout(s.project, s.current, s.settings),
          attempts: attempt, elapsedMs: 0, issues: [],
          message: "已收到完整合法候选",
        } });
      },
      cancel: () => {
        stopWorker();
        const s = get();
        set({ run: s.run + 1, status: "idle",
          view: s.candidate ? "candidate" : "current",
          message: s.candidate ? "搜索已取消，最佳合法候选已保留，尚未应用。" : "搜索已取消，当前排版保留。" });
      },
      apply: () => {
        const s = get();
        if (!s.candidate?.layout || !s.current || !s.project || s.status === "searching" ||
          validateLayout({ ...s.project, original: s.current }, s.candidate.layout, s.settings).length) return;
        set({
          history: [...s.history, structuredClone(s.current)],
          current: structuredClone(s.candidate.layout),
          candidate: null,
          view: "current",
          status: "idle",
          message: "候选排版已应用",
        });
      },
      undo: () => {
        const s = get();
        if (s.history.length)
          set({
            ...invalidate(),
            current: s.history.at(-1)!,
            history: s.history.slice(0, -1),
          });
      },
      reset: () => {
        const s = get();
        if (s.project && s.current)
          set({
            ...invalidate(),
            history: [...s.history, structuredClone(s.current)],
            current: structuredClone(s.project.original),
          });
      },
    };
  });
}
export const workbench = createWorkbenchStore();
export function useWorkbench() {
  return useStore(workbench);
}
export function startSearch() {
  const s = workbench.getState();
  if (!s.project || !s.current || s.importing) return;
  const run = s.beginSearch();
  worker = new Worker(new URL("./core/nesting.worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = (e) => {
    if (e.data.type === "progress")
      workbench.getState().progress(run, e.data.attempt, e.data.bestLayout);
    if (e.data.type === "done")
      workbench.getState().receiveResult(run, e.data.result);
    if (e.data.type === "error" && workbench.getState().run === run) {
      stopWorker();
      workbench.setState({
        status: "error",
        message: e.data.message,
        candidate: null,
      });
    }
  };
  worker.onerror = () => {
    if (workbench.getState().run === run) {
      stopWorker();
      workbench.setState({
        status: "error",
        message: "搜索线程发生错误，请重试。",
        candidate: null,
      });
    }
  };
  worker.postMessage({
    type: "start",
    project: { ...s.project, original: s.current },
    settings: s.settings,
  });
}
