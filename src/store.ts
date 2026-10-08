import {
  emptyProject,
  mergeImport,
  type WorkspaceSnapshot,
  type ImportTarget,
} from "./core/importTransaction";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { measureLayout, validateLayout } from "./core/geometry";
import type {
  Project,
  Layout,
  NestSettings,
  NestResult,
  Placement,
} from "./core/types";
import {
  findInitialPlacement,
  editingLayout,
  includeStock,
  makePart,
  type PartInput,
  type StockInput,
} from "./core/editing";
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
  source: Project | null;
  addStock: (input: StockInput) => boolean;
  removeStock: (id: string) => boolean;
  addPart: (input: PartInput) => boolean;
  movePart: (p: Placement) => boolean;
  current: Layout | null;
  candidate: NestResult | null;
  history: WorkspaceSnapshot[];
  draft: Project | null;
  previewImport: (id: number, p: Project) => void;
  cancelImport: () => void;
  confirmImport: (p: Project, target: ImportTarget) => void;
  discardCandidate: () => void;
  setMaterial: (id: string, material: string) => void;
  removePart: (id: string) => boolean;
  duplicatePart: (id: string, quantity: number) => boolean;
  placePart: (id: string, sheetId: string) => boolean;
  selected: string | null;
  settings: NestSettings;
  status: "idle" | "searching" | "done" | "error";
  message: string;
  attempt: number;
  run: number;
  importRun: number;
  importing: boolean;
  importMessage: string;
  view: "original" | "current" | "candidate";
  importProject: (p: Project) => void;
  beginImport: () => number;
  finishImport: (id: number, p: Project) => void;
  failImport: (id: number, error: string) => void;
  setSettings: (s: Partial<NestSettings>) => void;
  setThickness: (id: string, n: number) => void;
  toggleLock: (id: string) => void;
  select: (id: string | null) => void;
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
    const snapshot = (): WorkspaceSnapshot =>
      structuredClone({
        project: get().project,
        current: get().current,
        source: get().source,
      });
    const load = (project: Project) =>
      set({
        ...invalidate(),
        project: {
          ...structuredClone(project),
          importedSource: structuredClone(project),
        },
        source: structuredClone(project),
        view: "current",
        current: structuredClone(project.original),
        history: [],
        selected: null,
        importing: false,
        importMessage: "",
      });
    return {
      draft: null,
      project: null,
      source: null,
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
      importMessage: "",
      view: "current",
      importProject: load,
      previewImport: (id, p) => {
        if (id === get().importRun)
          set({ draft: p, importing: false, importMessage: "" });
      },
      cancelImport: () =>
        set({
          draft: null,
          importing: false,
          importMessage: "",
          importRun: get().importRun + 1,
        }),
      confirmImport: (p, target) => {
        const s = get(),
          before = snapshot(),
          merged = mergeImport(before, p, target);
        set({
          ...invalidate(),
          ...merged,
          history: [...s.history, before],
          draft: null,
          importing: false,
          importMessage: "",
          selected: null,
          importRun: s.importRun + 1,
          message:
            target === "append"
              ? "已追加导入，可撤销"
              : "已打开新项目，可撤销恢复上一项目",
        });
      },
      discardCandidate: () =>
        set({ ...invalidate(), message: "已放弃候选，当前排版保留" }),
      beginImport: () => {
        const id = get().importRun + 1;
        set({
          draft: null,
          importRun: id,
          importing: true,
          importMessage: "",
        });
        return id;
      },
      finishImport: (id, p) => {
        if (id === get().importRun) load(p);
      },
      failImport: (id, message) => {
        if (id === get().importRun)
          set({
            importing: false,
            importMessage: message,
            draft: null,
          });
      },
      setSettings: (s) =>
        set({ ...invalidate(), settings: { ...get().settings, ...s } }),
      setThickness: (id, n) => {
        if (!Number.isFinite(n) || n < 1 || n > 100) return;
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
              c.placements.find((v) => v.partId === part.id)?.sheetId === id
                ? { ...part, thickness: n, stockId: id }
                : part,
            ),
            original: { ...p.original, sheets: sheets(p.original.sheets) },
          },
          current: { ...c, sheets: sheets(c.sheets) },
          history: [...get().history, snapshot()],
        });
      },
      toggleLock: (id) => {
        const c = get().current;
        if (c)
          set({
            ...invalidate(),
            history: [...get().history, snapshot()],
            current: {
              ...c,
              placements: c.placements.map((p) =>
                p.partId === id ? { ...p, locked: !p.locked } : p,
              ),
            },
          });
      },
      addStock: (input) => {
        const s = get();
        const project = s.project ?? emptyProject(),
          current = s.current ?? project.original;
        if (
          (input.material !== undefined && !input.material.trim()) ||
          ![input.width, input.height, input.thickness].every(
            Number.isFinite,
          ) ||
          input.width < 100 ||
          input.width > 10000 ||
          input.height < 100 ||
          input.height > 10000 ||
          input.thickness < 1 ||
          input.thickness > 100
        ) {
          set({ message: "请填写材质；板材宽高 100–10000 mm，板厚 1–100 mm" });
          return false;
        }
        const stock = {
          ...input,
          id: crypto.randomUUID(),
          material:
            input.material?.trim() ||
            project.sheets.find((v) => v.thickness === input.thickness)
              ?.material ||
            project.sheets[0]?.material ||
            "木材",
        };
        set({
          ...invalidate(),
          history: [
            ...s.history,
            {
              source: structuredClone(s.source),
              project: structuredClone(s.project),
              current: structuredClone(s.current),
            },
          ],
          project: {
            ...project,
            sheets: [...project.sheets, stock],
            original: {
              ...project.original,
              sheets: [...project.original.sheets, stock],
            },
          },
          current: { ...current, sheets: [...current.sheets, stock] },
          message: "已新增板材",
        });
        return true;
      },
      removeStock: (id) => {
        const s = get();
        if (
          !s.project ||
          !s.current ||
          !s.project.sheets.some((v) => v.id === id)
        )
          return false;
        if (s.current.placements.some((v) => v.sheetId === id)) {
          set({ message: "板材仍有零件，请先移走零件" });
          return false;
        }
        const placements = new Map(
          s.current.placements.map((v) => [v.partId, v]),
        );
        set({
          ...invalidate(),
          history: [
            ...s.history,
            {
              source: structuredClone(s.source),
              project: structuredClone(s.project),
              current: structuredClone(s.current),
            },
          ],
          project: {
            ...s.project,
            sheets: s.project.sheets.filter((v) => v.id !== id),
            parts: s.project.parts.map((part) => {
              const current = placements.get(part.id);
              return part.stockId === id && current
                ? { ...part, stockId: current.sheetId }
                : part;
            }),
            original: {
              sheets: s.project.original.sheets.filter((v) => v.id !== id),
              placements: s.project.original.placements.map((v) =>
                v.sheetId === id ? placements.get(v.partId)! : v,
              ),
            },
          },
          current: {
            ...s.current,
            sheets: s.current.sheets.filter((v) => v.id !== id),
          },
          message: "已删除空板材，可撤销恢复",
        });
        return true;
      },
      addPart: (input) => {
        const s = get(),
          project = s.project ?? emptyProject(),
          current = s.current ?? project.original;
        try {
          if (input.material !== undefined && !input.material.trim())
            throw Error("请填写零件材质");
          const quantity = input.quantity ?? 1;
          if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
            throw Error("数量需为 1–100 的整数");
          const stock = project.sheets.find(
            (v) =>
              v.thickness === input.thickness &&
              (!input.material || v.material === input.material),
          );
          const parts = [],
            placements = [];
          let next = current;
          for (let i = 0; i < quantity; i++) {
            const part = makePart(
              {
                ...input,
                material: input.material ?? stock?.material ?? "木材",
              },
              crypto.randomUUID(),
              stock?.id ?? "",
            );
            const placement =
              input.place !== true
                ? null
                : findInitialPlacement(
                    { ...project, parts: [...project.parts, ...parts] },
                    editingLayout(project, next),
                    part,
                    s.settings,
                  );
            if (input.place === true && !placement)
              throw Error("未找到兼容的合法位置；请新增板材或选择待放置");
            if (placement) {
              part.stockId = placement.sheetId;
              placements.push(placement);
              next = {
                ...includeStock(project, next, placement.sheetId),
                placements: [...next.placements, placement],
              };
            }
            parts.push(part);
          }
          set({
            ...invalidate(),
            history: [...s.history, snapshot()],
            project: {
              ...project,
              parts: [...project.parts, ...parts],
              original: {
                ...project.original,
                placements: [...project.original.placements, ...placements],
              },
            },
            current: next,
            selected: parts[0].id,
            message: placements.length
              ? "已新增零件"
              : "已新增待放置零件，请拖入板材或自动排版",
          });
          return true;
        } catch (e) {
          set({ message: (e as Error).message });
          return false;
        }
      },
      placePart: (id, sheetId) => {
        const s = get(),
          part = s.project?.parts.find((p) => p.id === id);
        if (!s.project || !s.current || !part) return false;
        const placement = findInitialPlacement(
          s.project,
          {
            ...s.current,
            sheets: s.project.sheets.filter((v) => v.id === sheetId),
          },
          part,
          s.settings,
        );
        if (!placement) {
          set({
            message: "目标板材没有兼容的合法位置，请核对尺寸、板厚和材质",
          });
          return false;
        }
        return get().movePart(placement);
      },
      removePart: (id) => {
        const s = get();
        if (
          !s.project ||
          !s.current ||
          !s.project.parts.some((p) => p.id === id)
        )
          return false;
        set({
          ...invalidate(),
          history: [...s.history, snapshot()],
          project: {
            ...s.project,
            parts: s.project.parts.filter((p) => p.id !== id),
            original: {
              ...s.project.original,
              placements: s.project.original.placements.filter(
                (p) => p.partId !== id,
              ),
            },
          },
          current: {
            ...s.current,
            placements: s.current.placements.filter((p) => p.partId !== id),
          },
          selected: null,
          message: "已删除零件，可撤销",
        });
        return true;
      },
      duplicatePart: (id, quantity) => {
        const s = get(),
          part = s.project?.parts.find((p) => p.id === id);
        if (
          !part ||
          !s.project ||
          !s.current ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 100
        )
          return false;
        const copies = Array.from({ length: quantity }, (_, i) => ({
          ...structuredClone(part),
          id: crypto.randomUUID(),
          name: `${part.name} · 副本 ${i + 1}`,
        }));
        set({
          ...invalidate(),
          history: [...s.history, snapshot()],
          project: { ...s.project, parts: [...s.project.parts, ...copies] },
          message: `已复制 ${quantity} 个待放置零件`,
        });
        return true;
      },
      setMaterial: (id, material) => {
        const s = get();
        if (!s.project || !s.current || !material.trim()) return;
        const stock = s.project.sheets.find((v) => v.id === id);
        if (!stock || stock.material === material.trim()) return;
        const sheets = (ss: Layout["sheets"]) =>
          ss.map((v) =>
            v.id === id ? { ...v, material: material.trim() } : v,
          );
        set({
          ...invalidate(),
          history: [...s.history, snapshot()],
          project: {
            ...s.project,
            sheets: sheets(s.project.sheets),
            parts: s.project.parts.map((p) =>
              s.current!.placements.some(
                (v) => v.partId === p.id && v.sheetId === id,
              )
                ? { ...p, material: material.trim() }
                : p,
            ),
          },
          current: { ...s.current, sheets: sheets(s.current.sheets) },
        });
      },
      movePart: (p) => {
        const s = get();
        if (!s.project || !s.current) return false;
        const previous = s.current.placements.find(
          (v) => v.partId === p.partId,
        );
        if (
          !s.project.parts.some((v) => v.id === p.partId) ||
          previous?.locked
        ) {
          set({ message: "零件已锁定，无法移动或旋转" });
          return false;
        }
        const next = {
          ...includeStock(s.project, s.current, p.sheetId),
          placements: previous
            ? s.current.placements.map((v) =>
                v.partId === p.partId ? { ...p, locked: previous.locked } : v,
              )
            : [...s.current.placements, p],
        };
        const issues = validateLayout(
          { ...s.project, original: s.current },
          next,
          s.settings,
          { requireAll: false },
        );
        if (issues.length) {
          set({ message: `修改未应用：${issues[0].message}` });
          return false;
        }
        set({
          ...invalidate(),
          history: [
            ...s.history,
            {
              source: structuredClone(s.source),
              project: structuredClone(s.project),
              current: structuredClone(s.current),
            },
          ],
          current: next,
          message: "位置已更新",
        });
        return true;
      },
      select: (selected) => set({ selected }),
      setView: (view) => {
        const p = view === "original" ? get().source : get().project;
        set({
          view,
          selected: p?.parts.some((p) => p.id === get().selected)
            ? get().selected
            : null,
        });
      },
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
        if (
          !bestLayout ||
          !s.project ||
          !s.current ||
          validateLayout(
            { ...s.project, original: s.current },
            bestLayout,
            s.settings,
          ).length
        )
          return;
        set({
          candidate: {
            layout: structuredClone(bestLayout),
            metrics: measureLayout(s.project, bestLayout, s.settings),
            originalMetrics:
              s.candidate?.originalMetrics ??
              measureLayout(s.project, s.current, s.settings),
            attempts: attempt,
            elapsedMs: 0,
            issues: [],
            message: "已收到完整合法候选",
          },
        });
      },
      cancel: () => {
        stopWorker();
        const s = get();
        set({
          run: s.run + 1,
          status: "idle",
          view: s.candidate ? "candidate" : "current",
          message: s.candidate
            ? "搜索已取消，最佳合法候选已保留，尚未应用。"
            : "搜索已取消，当前排版保留。",
        });
      },
      apply: () => {
        const s = get();
        if (
          !s.candidate?.layout ||
          !s.current ||
          !s.project ||
          s.status === "searching" ||
          validateLayout(
            { ...s.project, original: s.current },
            s.candidate.layout,
            s.settings,
          ).length
        )
          return;
        set({
          history: [
            ...s.history,
            {
              source: structuredClone(s.source),
              project: structuredClone(s.project!),
              current: structuredClone(s.current),
            },
          ],
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
            ...s.history.at(-1)!,
            selected: null,
            history: s.history.slice(0, -1),
          });
      },
      reset: () => {
        const s = get();
        if (s.project && s.current) {
          const available = new Set(s.project.sheets.map((v) => v.id));
          const retained =
            s.source?.original.placements.filter(
              (v) => !available.has(v.sheetId),
            ).length ?? 0;
          set({
            ...invalidate(),
            history: [
              ...s.history,
              {
                source: structuredClone(s.source),
                project: structuredClone(s.project!),
                current: structuredClone(s.current),
              },
            ],
            current: {
              ...structuredClone(s.current),
              sheets: structuredClone(s.project.sheets),
              placements: s.current.placements.map((p) => {
                const original = s.source?.original.placements.find(
                  (v) => v.partId === p.partId,
                );
                return original && available.has(original.sheetId)
                  ? { ...original, locked: p.locked }
                  : p;
              }),
            },
            message: retained
              ? `已恢复可用原板位置；${retained} 个零件的原板已删除，保留当前位置`
              : "已恢复导入零件原始位置，保留新增零件",
          });
        }
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
