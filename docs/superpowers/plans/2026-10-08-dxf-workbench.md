# DXF Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver a usable React workbench that imports the supplied DXF, previews/selects all parts and generates validated layouts in three modes.

**Architecture:** Browser DXF parser creates immutable part geometry plus stock and placement records. A pure geometry module validates layouts; a Web Worker searches legal arrangements. React/Zustand renders interactive SVG stock panels and compares/applies/reverts candidate layouts.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Zustand, dxf-parser, clipper-lib, Vitest, lucide-react. RiSu remains read-only reference; 3D will use its R3F/Drei stack in a later stage.

## Global Constraints

- Work in /Users/mr9esx/Documents/ChatGPT/homemade on codex/dxf-workbench; do not modify RiSu.
- Match the user image: warm off-white #f3f1eb, forest text #25382e, tan parts, muted green parts, blue holes, pale pockets; restrained lines and generous whitespace.
- Scope is 2D import/preview/reordering now. Preserve geometry interfaces for later 3D; no nonfunctional 3D button.
- Millimeter geometry; every part keeps its identity, thickness, holes, pockets, and immutable local outline. Layout changes placements only.
- Modes are utilization / machining / remnant. Hard constraints apply to all modes: thickness grouping, stock boundary, configured gap/margin, locks, permitted rotations, all parts placed exactly once.
- Default search cannot increase stock count. Failure is explicit and never presented as a valid candidate. Unknown thickness must be supplied before search.
- Approximate search must be labeled as heuristic, not globally optimal. Utilization changes only when sheet count/area changes. Machining metrics are estimates, not generated toolpaths.
- Initial stock detection requires actual 1220×2440 rectangles; support extra collinear vertices, translation and rotation. Prioritize reference-stock layers and avoid confusing parts with stock.
- Binary, unitless/non-mm, unsupported machining entities, open/self-intersecting contours, ambiguous ownership must have explicit import error or actionable warnings that prevent unsafe optimization. Ignore decorative hatch/reference annotation as geometry.
- Sample is public/sample.dxf. Expected 3 stocks, 53 parts, 28 through-hole contours, 29 pockets; two 348×792 mm doors with diameter 25 mm holes. Source layout has a 3 mm gap P16/P17.
- Importer/geometry and optimizer require test-first meaningful regression checks; UI is verified in browser. Record fresh checks and commits in task reports.

### Task 1: Importer and geometry contract

**Files:** src/core/types.ts, src/core/dxf.ts, src/core/geometry.ts, tests/dxf.test.ts, tests/geometry.test.ts.

**Interfaces:** Implement and export these types from types.ts:

```ts
export type Point = { x: number; y: number };
export type Rotation = 0 | 90 | 180 | 270;
export type Mode = 'utilization' | 'machining' | 'remnant';
export type Stock = { id: string; name: string; width: number; height: number; thickness: number; material: string };
export type Pocket = { outline: Point[]; depth: number | null };
export type Part = { id: string; name: string; stockId: string; layer: string; thickness: number; width: number; height: number; area: number; outline: Point[]; holes: Point[][]; pockets: Pocket[]; label: Point };
export type Placement = { partId: string; sheetId: string; x: number; y: number; rotation: Rotation; locked?: boolean };
export type Layout = { sheets: Stock[]; placements: Placement[] };
export type Project = { name: string; units: 'mm'; sheets: Stock[]; parts: Part[]; original: Layout; warnings: string[] };
export type NestSettings = { mode: Mode; gap: number; margin: number; allowRotation: boolean; minRemnantWidth: number; minRemnantHeight: number; iterations: number };
export type LayoutIssue = { kind: 'missing' | 'overlap' | 'gap' | 'boundary' | 'thickness' | 'invalid'; message: string; partIds: string[] };
export type Remnant = { sheetId: string; x: number; y: number; width: number; height: number; area: number };
export type LayoutMetrics = { sheetCount: number; utilization: number; outlineArea: number; stockArea: number; travel: number; remnants: Remnant[]; reusableArea: number };
export type NestResult = { layout: Layout | null; metrics: LayoutMetrics | null; originalMetrics: LayoutMetrics; attempts: number; elapsedMs: number; message: string; issues: LayoutIssue[] };
```

Contract semantics: Part outline/holes/pockets/label are translated to its ORIGINAL bounding-box minimum; local Y points upward. Placement x/y are the bounding-box minimum of the ROTATED part; rotate outline and every detail around local origin then normalize using rotated original bbox. Stock is normalized to its own local axes; original placements use stock-normalized coordinates. Stock thickness 0 means unknown, requiring UI entry.

Export parseDxf(text: string, name?: string): Project from dxf.ts; throw Error with actionable Chinese message on fatal import problems. Sample must import accurately; HEADER units required. Support closed polylines and circles; reconstruct closed LINE/ARC chains if present. Respect bulge arcs with <=0.1mm sampling error. Recognize stock dimensions by orthogonal geometry, not bbox alone; reject self intersections. Ignore HATCH and reference text. Identify CUT/HOLE/POCKET semantics by layer, infer thickness/depth by numeric suffix, use containment for features and labels plus nearest unmatched label when a label falls in a concave cutout. Preserve source IDs; generate deterministic IDs for unnumbered parts. Ambiguous/unsupported machining geometry needs an explicit warning plus blocked reordering (fatal rejection is acceptable for this first release). No silent missing entities.

Export signedArea(points), polygonArea(points), bounds(points), transformPoints(points, part, placement), placedOutline(part, placement), validateLayout(project, layout, settings), measureLayout(project, layout, settings) from geometry.ts. Bounds returns {minX,minY,maxX,maxY,width,height}. validateLayout checks exactly-once identity, valid finite placements, matching stock thickness, allowed rotations, real contour intersections and minimum edge-to-edge distance, stock margin. It returns LayoutIssue[]. No hole nesting. Pocket/holes are not obstacles for packing. Include unknown thickness failure, locks against project.original when locked, and negative/NaN settings rejection. measureLayout computes immutable area ratio, estimates center-to-center CNC rapid travel per stock (nearest-neighbor path), and finds conservative largest free axis-aligned rectangular remnant per sheet; describe approximation in docs. Remnant rectangles may not intersect outer parts, and should be eroded enough to respect gap where applicable. Retain large-area edges rather than bounding box only for true shape checking.

- [x] Write failing tests using the real sample and hand-derived fixtures before implementation. Key independent assertions:

```ts
expect(project.sheets.map(s => [s.width, s.height, s.thickness])).toEqual([[1220,2440,12],[1220,2440,12],[1220,2440,5]]);
expect(project.parts).toHaveLength(53);
expect(project.parts.reduce((n,p) => n+p.holes.length, 0)).toBe(28);
expect(project.parts.reduce((n,p) => n+p.pockets.length, 0)).toBe(29);
expect(project.parts.find(p => p.name === 'P42')?.width).toBeCloseTo(348);
expect(project.parts.find(p => p.name === 'P42')?.height).toBeCloseTo(792);
```

Also test rotated 1220×2440 stock with collinear vertices, bulge semicircle has expected radius/area, sample source flags P16/P17 with 6mm gap, two L-shapes whose bboxes overlap but contours don't, gap/boundary violation, missing/duplicate parts, wrong thickness, holes stay aligned after 90° rotation, remnant doesn't overlap a placed rectangle, unsupported unit/open contour rejection.
- [x] Run pnpm test tests/dxf.test.ts tests/geometry.test.ts to observe missing behavior; then implement the specified interfaces and parser/geometry.
- [x] Re-run targeted tests and pnpm exec tsc --noEmit. Record actual results, approximation limits and source mapping decisions.
- [x] Commit only task-owned files, write the report and return status.

### Task 2: Validated three-mode optimizer and worker

**Files:** src/core/nesting.ts, src/core/nesting.worker.ts, tests/nesting.test.ts.

**Consumes:** All Task 1 types, transformPoints/placedOutline/bounds/validateLayout/measureLayout/area functions. Main UI will send a Project with original set to CURRENT baseline layout, including locked Placement records.

**Produces:** export optimizeLayout(project: Project, settings: NestSettings, onProgress?: (attempt: number, best: LayoutMetrics | null) => void): NestResult. Worker protocol accepts {type:'start',project,settings} and posts {type:'progress',attempt,best}, then {type:'done',result}, or {type:'error',message}. Cancellation is Worker.terminate() in UI. Function doesn't mutate project.

Algorithm: use true external contours, clipper geometry or contour-based candidate placement (NFP contact candidates acceptable). Offset/spacing must be obeyed and independently revalidated. Multi-start heuristic changes part order, rotation and candidate placements; deduplicate equivalent orientations when possible, cache geometry, prioritize large/hard pieces, and try different anchors. Keep groups by thickness/material. No new sheets by default. Locked pieces go in first at identical coordinates. Search util mode minimizes sheet count then occupied extent; machining mode favors estimated rapid travel and orderly rows; remnant mode favors usable free rectangles meeting minimum width/height (orient the usable-remnant minimum consistently and document). A feasible original remains candidate but must be validated against CURRENT settings. Invalid originals cannot be the claimed best result. Distinct ranking rules and candidate placement anchors must allow materially different modes. Never drop unplaced parts. Null layout on no legal solution plus explicit reason. Budget bounded to avoid runaway synchronous work; UI Worker keeps responsive.

- [x] Write tests before implementing; run to observe missing behavior.

```ts
const result = optimizeLayout(project, settings);
expect(result.layout?.placements.map(p=>p.partId).sort()).toEqual(['a','b','c']);
expect(validateLayout(project,result.layout!,settings)).toEqual([]);
```

Additional hand-made cases: 2 stocks compacted to 1 with three small pieces; locked piece unchanged; narrow piece fits only with rotation; wrong thickness never mixed; impossible pieces/gap return null; original illegal gap never passes through; shape interlocking placement; all three modes produce valid candidates, remnant mode improves largest qualifying rectangle on a suitable fixture; input is unchanged; budgets/progress work. Include sample real geometry, complete 53 pieces with legal default 3mm gap/6mm margin; testing 6mm gap may legitimately report no feasible solution within budget but cannot return invalid candidate.
- [x] Implement search and worker protocol, ensuring all returned layouts independently pass validateLayout.
- [x] Run pnpm test tests/nesting.test.ts and core tests; pnpm exec tsc --noEmit. Record actual runtime for sample and limitations (heuristic, no globally optimal guarantee).
- [x] Commit task files, write report, return status.

### Task 3: Interactive React SVG workbench

**Files:** src/main.tsx, src/App.tsx, src/styles.css, src/store.ts, src/components/StockCanvas.tsx, src/components/NestPanel.tsx, src/components/PartInspector.tsx, src/components/PartsTable.tsx, src/core/export.ts, README.md; UI may add focused components.

**Consumes:** Project/Layout/NestSettings/NestResult, parseDxf, geometry validation/metrics, Task2 Worker protocol. Real sample is fetched from /sample.dxf. No mocked sample geometry.

**Produces:** working responsive site, runnable pnpm dev and pnpm build. Initial view auto-loads sample and shows all 3 stocks and 53 parts. Model and applied layout live in Zustand (project/currentLayout/candidate/history/selectedPart/settings/search status). Keep source immutable and reset history on import. Edit stock thickness updates associated parts and source stock thickness consistently and invalidates stale candidate. Changing ANY packing setting, lock or model revision invalidates candidate and terminates stale Worker. Worker results gated by run ID, no stale response accepted. History stores geometry thickness with layout if relevant, or clear history when thickness changes.

UI: editorial header '木作 / 板材工作台', file name and useful counts; buttons upload DXF and load sample. Responsive three-stock SVG preview dominant; warm reference palette and high-quality simple line icon controls. Use small label density (selected labels emphasized, hide overcrowded labels at fit scale), dimension annotations, legend. Pan/zoom via wheel and pointer, fit/reset controls; no page-scroll trap. Click parts selects with keyboard accessible alternative in parts table; outline, holes and pocket details follow each placement. Hover tooltip contains number/size. A sidebar identifies selected part, dims/thickness/holes/pockets and locks; show stock thickness controls and original imports warnings. Layout issue list links/selects affected parts, including sample3mm gap at 6mm setting.

Nest panel: mode selector Chinese '利用率优先 / 加工优先 / 余料优先'; margin/gap mm, allow90°rotation, minimum remnant width/height, iterations with sane validated bounds. A useful default is gap3mm,margin6mm (matches sample feasibility), explicitly label that user's actual cutter determines gap. Start/Cancel search with live attempt count, no fake progress percentage or time promise. Show candidate geometry switch Original/Current/Candidate, real before/after metrics and approximate CNC travel, shaded remnant rect overlays toggle. Explicit failed search state never enables Apply. Apply moves valid candidate to current, pushes undo state; Undo restores exact layout; return to original supported. Settings explain fixed-sheet area ratio and heuristic results in concise Chinese user-facing language. Avoid showing developer implementation jargon in the product.

Export current legal-or-source arrangement as SVG in mm with identifiers, holes/pockets and sheet metadata; don't call it CNC toolpath. Prevent browser file overflow using DXF size limit and clear errors; file upload no network. Unsupported DXF error is visible and keeps prior valid project. Empty imported stock cannot manufacture parts. Mobile layout stacks sections, controls tappable, table scrolls. Pending imports can't overwrite newer imports; errors consistently clear busy states. User can inspect sample 25mm holes and changing thickness genuinely updates data.

- [x] Implement app components and store using real imported geometry, no placeholder interactions or inactive buttons.
- [x] Add only meaningful state/export tests where behavior warrants (stale candidates, undo, transforms in exported SVG); run failing tests before corresponding state/export implementation.
- [x] Run pnpm test and pnpm build. Add README with startup, supported formats, actual algorithm, current scope and limitations.
- [x] Launch pnpm dev; controller browser QA covers upload/sample, selection, modes/search/cancel, candidate/apply/undo, settings invalidation, thickness, responsive layout and download. Resolve actual failures before finishing.
- [x] Commit task-owned files, write task report including actual checks, return status.


### Task 4: NestMaxx 工作区布局与新增组件/板材、磁吸拖动

用户追加要求优先于先前页面布局。实际浏览器参考记录在 docs/reference/nestmaxx-observations.md，详细要求保存在 docs/superpowers/specs/2026-10-08-nestmaxx-workspace.md；复用已验证核心。

- [ ] 全屏画布、左侧组件、工具栏 DXF 导入、选中属性、设置弹窗、导出抽屉与快捷键。
- [ ] 可新增矩形/圆形组件及板材，保持原始导入快照与模型级撤销。
- [ ] 拖动与旋转、8像素弱磁吸和对齐线，独立合法性验证、锁定和过期候选保护。
- [ ] 新编辑/磁吸测试观察 red/green，完整测试与构建，浏览器 QA 并修复。
- [ ] 提交任务代码、审查与整体验证，再发布 owner-private Site。
