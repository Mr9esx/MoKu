# Floating Tools Implementation Plan

> **For agentic workers:** Use inline execution for this single visual task. Steps use checkbox syntax for tracking.

**Goal:** Float the toolbar above the right information panel with consistent styling.

**Architecture:** Relocate existing React controls within workspace-surface; use shared CSS dimensions/offsets for the right cards. Preserve state and actions.

**Tech Stack:** Existing React, TypeScript and CSS; no dependencies.

## Global Constraints

- Retain every existing action and accessible names.
- No geometry or store changes; selection must not resize the canvas.
- Keep existing private Site identity and audience.

### Task 1: Right tool stack

**Files:** src/App.tsx, src/styles.css; docs/verification.md and docs/feasibility/workbench-preview.jpg.

- [x] Move header controls into `aside.floating-tools.floating` inside workspace-surface. Divide navigation into two `.toolbar-group` rows. Relocate `.brand` into the parts panel, remove stale full-width header CSS.
- [x] Share `--right-rail-width` and `--information-top` offsets. Right tools stay at top 14 px; analysis/inspector start below the tools. Set compact icon controls with preserved aria-label/title; all actions remain reachable. Align responsive rail sizes and adapt small screens without toolbar/info overlap.
- [x] Run `pnpm build`. Use the existing local preview to inspect screenshot and native DOM bounds, toggle analytics, select a component, and open import/stock dialogs. Fix actual overlap or unreachable controls. No implementation-mirroring CSS tests.
- [x] Record evidence, save screenshot, commit and package/publish the existing private Site.
