# Workspace Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Resolve the user's three workspace complaints with deletable stocks, visible analysis and a single top toolbar.

**Architecture:** Extend the existing Zustand inventory transaction with undo/source preservation. React composes a top toolbar and a dedicated analysis panel using existing geometry metrics; core parser/search contracts are unchanged.

**Tech Stack:** Existing React 19, TypeScript 6, Vite 8, Zustand, lucide-react and Vitest.

## Global Constraints

- Work in /Users/mr9esx/Documents/ChatGPT/homemade on existing codex/dxf-workbench; RiSu stays read-only. No .codegraph directory exists.
- Implement the complete design in docs/superpowers/specs/2026-10-08-workspace-refinement-design.md.
- All removal is undoable. Never delete components implicitly. Never mutate immutable source.
- Preserve complete independent validation, material identity, locked placements, source-only export gate and stale Worker protection.
- Metrics follow selected view, distinguish working inventory from layout/used sheets and explain estimated travel, conservative remnant and gross/net utilization.
- No new dependency. Reuse existing state/geometry; no parser/search refactor, no inactive buttons.

### Task 1: Inventory removal and consolidated analytical workspace

**Files:** src/store.ts, src/App.tsx, src/styles.css, src/components/WorkspaceDialogs.tsx; create src/components/LayoutAnalysis.tsx; tests/editing.test.ts (or dedicated inventory test); README.md.

**Interfaces:** Consume Project/Layout/LayoutMetrics/NestSettings and measureLayout, polygonArea, validateLayout. Produce store `removeStock(id: string): boolean`, preserving source and transaction undo. UI analysis receives selected project/layout/metrics and original/current/candidate comparisons from existing state, with memoized calculations and no geometry recomputation on pointer ghosts.

- [x] Write meaningful deletion regression cases first. Example in existing empty fixture: `st.getState().addStock({name:'empty',width:500,height:500,thickness:5}); const before=structuredClone(st.getState().current); const id=st.getState().project!.sheets[1].id; expect(st.getState().removeStock(id)).toBe(true); expect(st.getState().project!.sheets.map(s=>s.id)).toEqual(['s']); st.getState().undo(); expect(st.getState().current).toEqual(before);`. Also reject occupied stock without history/candidate mutation; delete unused stock after compact apply; invalidate active result; delete original emptied stock with moved part, validate material and reset never targets deleted stock; preserve source and support empty inventory. Use independently checked literal destinations.
- [x] Run focused tests, observe missing removeStock behavior, then implement transaction. Remove stock from working project and current layouts, update affected material associations/baseline placements to current targets. `reset` restores a source placement only when its stock still exists. Use existing invalidate/history pattern. Rerun covering tests and report red/green.
- [x] Consolidate existing toolbar actions into the topbar. Remove old bottom-toolbar/main-actions markup/styles, move sample loader into import dialog, adjust canvas/panels/zoom padding to reclaimed space. Keep keyboard/accessibility and actual button behavior; toolbar scrolls internally on narrow widths.
- [x] Add LayoutAnalysis with overall stats, per-sheet breakdown and view comparison table. Default open, toolbar toggle; selected inspector temporarily replaces it, closing inspector reveals analysis. Reuse passed main-view metrics; additional comparisons memoized; per-sheet area and net holes use real part outlines. Show invalid-layout warnings and link existing check dialog. Use restrained existing palette, clear numbers and units.
- [x] Board modal shows occupancy and disabled reason for occupied deletion; empty deletion stays in modal and visible undo restores it. README describes deletion policy and top analysis.
- [x] Run full pnpm test and pnpm build once after functional changes. Controller browser QA: top toolbar only, source/analysis counts, per-sheet percentages, original/current/candidate comparison, empty stock create/delete/undo, occupied delete disabled, panel/inspector toggle, import entry and search/cancel retained. Resolve observed bugs.
- [x] Commit owned code/tests/docs and write report. Task review and whole-change integration review precede publication to existing owner-private Site.
