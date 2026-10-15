# Unified 2D / 3D preview layout

**Goal:** Keep assembly information inside the preview on its right and align the drawing workspace to the same layout.

**Design:** Share a 248 px resource rail and a bordered preview from 68 px below the header to 36 px above the footer. Place contextual information within that preview, inset 16 px from its top/right, using a 304 px expanded width; preserve the 224 px compact 3D summary. Bottom tools and view controls use the preview's center. Mobile keeps one active resource/preview/information surface at a time, with nested information filling the preview when requested. Retain existing components, colors, keyboard actions, selection and geometry.

**Files:** `App.tsx`, `AssemblyWorkspace.tsx`, `AssemblyCanvas.tsx` compose the nested panels; `workspacePreview.css` centralizes shared placement and responsive overrides; `assembly.css` drops obsolete external-rail rules; `StockCanvas.tsx` measures the inset information panel when fitting the drawing.

- [x] Nest both contextual panels in the preview. Share rail/preview coordinates and floating information layout; preserve compact/detail mode.
- [x] Align drawing heading, tools/view/zoom controls and no-stock cards. Measure the actual information inset so all sheets fit in the free area. Preserve candidate progress handling.
- [x] Verify desktop 2D/3D matching bounds, expanded/compact containment, drawing selection/zoom and cube view selection. Run relevant tests/build and scoped review. Review candidate/responsive branches in source.
- [x] Save screenshots and verification notes; commit only this task's files, leaving existing joinery work unchanged.

**Verification:** 94 related tests and production build passed. At 1280 × 720, both previews measured `(276, 68, 990, 616)` and both rails measured 248 px. Expanded 3D information remained entirely inside the preview and clear of the cube. Review found one obsolete responsive rail-width override; it was removed and re-review passed. Phone/1024 px browser emulation repeatedly timed out, so those cases are code-reviewed, not claimed as browser-tested. Temporary viewport reset succeeded.

**Development incident:** Entry/App updates triggered full page reloads and cleared in-memory projects. The internal `formatPercent` helper no longer exports from the App refresh boundary. Known sample content was reopened; unsaved manual edits were not recovered. Details are in `docs/analysis/2026-10-15-preview-layout-verification.md`.
