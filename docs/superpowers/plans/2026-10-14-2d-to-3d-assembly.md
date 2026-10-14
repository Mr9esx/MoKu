# 2D to 3D Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Turn the existing reviewed DXF parts into real 3D solids that users assemble with red collision regions, yellow feasible placement previews and weak snapping, backed by target dimensions, declared fits and straight-line installation checks.

**Architecture:** Store assembly separately from nesting placements inside the working Project so existing snapshot undo restores it. Pure geometry constructs depth-layered solids and convex cells; a worker computes collisions, fit and continuous path checks. A lazy Three.js workspace renders the same geometry and supplies camera, transform, placement guidance and inspector controls.

**Tech Stack:** Existing React/TypeScript/Zustand/Clipper/Vitest plus exact Three.js and TypeScript definitions. No server or CAD upload.

## Global Constraints

- Preserve all existing uncommitted joinery work. Work on the existing feature branch; never stage or commit another task's changes.
- All lengths are mm; global X = width, Y = depth, Z = height; part local XY preserves drawing geometry, local Z is 0..thickness.
- Front machining = +Z; pocket faces must be explicitly confirmed. Unknown faces return incomplete detection.
- Contact numerical tolerance = 0.01 mm, separate from user manufacturing tolerances.
- Weak snap enter = 8 screen px AND <=5 mm correction; leave = >12 px OR >8 mm from unsnapped target. Respect active axes; no unsolicited rotation. Alt suspends, toolbar toggle supports touch. One drag = one undo.
- Yellow means checked final placement/declared fit; installation path has its own state. Invalid/incomplete candidates do not snap. Red shows actual collision intersection, not overlapping bounding boxes.
- Old async results cannot replace new geometry/poses. Full checks must report incomplete on resource exhaustion.
- User has approved the design and execution. Execute continuously; no additional design or implementation approval is needed.

## Shared interfaces

`src/core/assemblyTypes.ts` owns these contracts; other modules import them:

```ts
export type Vec3 = { x: number; y: number; z: number };
export type Rotation3 = Vec3 & { w: number };
export type AssemblyItem = { partId: string; position: Vec3; rotation: Rotation3; locked?: boolean };
export type PocketFace = 'front' | 'back';
export type PocketFaces = { signature: string; faces: Record<number, PocketFace> };
export type FitConstraint = {
  id: string; partId: string; receiverId: string;
  feature: { kind: 'pocket' | 'hole'; index: number }; maleEdge: number;
  insertionDepth: number; minClearance: number; maxClearance: number;
  partSignature: string; receiverSignature: string;
};
export type AssemblyStep = { partId: string; direction: Vec3; distance: number };
export type Assembly = {
  items: AssemblyItem[]; pocketFaces: Record<string, PocketFaces>;
  targets: { width?: number; depth?: number; height?: number; tolerance: number };
  fits: FitConstraint[]; steps: AssemblyStep[]; sparePartIds: string[];
};
export type ConvexCell = { vertices: Vec3[]; faces: number[][] };
export type Bounds3 = { min: Vec3; max: Vec3 };
export type AssemblyModel = { partId: string; positions: number[]; cells: ConvexCell[]; complete: boolean; issues: string[]; bounds: Bounds3 };
export type AssemblyIssue = { id: string; kind: 'collision'|'dimension'|'fit'|'geometry'|'missing'|'installation'; severity: 'error'|'pending'; message: string; partIds: string[]; position?: Vec3; constraintId?: string };
export type CollisionRegion = { partIds: [string,string]; positions: number[] };
export type AssemblyAnalysis = { issues: AssemblyIssue[]; collisions: CollisionRegion[]; bounds: Bounds3|null; complete: boolean; checkedPairs: number };
export type PlacementCandidate = { id: string; partId: string; receiverId: string; pose: AssemblyItem; target: Vec3; label: string; status: 'valid'|'incomplete'|'invalid'; message?: string; feature?: {kind:'pocket'|'hole';index:number} };
```

Core exports: `emptyAssembly(): Assembly`, `geometrySignature(part: Part): string`, `rotationFromEuler(degrees: Vec3): Rotation3`, `eulerFromRotation(rotation: Rotation3): Vec3`, `transformPoint(point: Vec3,item: AssemblyItem): Vec3`, `buildAssemblyModel(part: Part,faces?: PocketFaces): AssemblyModel`, `analyzeAssembly(project: Project,assembly: Assembly,options?: {installation?: boolean}): AssemblyAnalysis`, `placementCandidates(project: Project,assembly: Assembly,partId: string): PlacementCandidate[]`, `weakSnap(pose: AssemblyItem,candidates: PlacementCandidate[],options: {enabled:boolean;suspended?:boolean;heldId?:string|null;axes?:string;project:(point:Vec3)=>{x:number;y:number}}): {pose:AssemblyItem;candidateId:string|null}`.

Store exports existing `useWorkbench` plus `updateAssembly(assembly: Assembly): boolean` in State; Project receives optional `assembly?: Assembly`. Component consumes project assembly, copies it immutably and calls updateAssembly once per completed user operation.

### Task 1: Real solids, checks and placement guidance

**Files:** Create assemblyTypes.ts, assemblyGeometry.ts, assemblyChecks.ts, assemblyGuidance.ts, assembly.worker.ts; create tests/assembly-geometry.test.ts, assembly-checks.test.ts, assembly-guidance.test.ts.

**Interfaces:** All core contracts above; worker requests `{revision:number,project:Project,assembly:Assembly}` and responds `{revision:number,analysis:AssemblyAnalysis}` or `{revision:number,error:string}`.

- [x] Write hand-derived tests before implementation. Rectangle 100x80x12 has volume 96000; 20x10 through-hole subtracts 2400; same 20x10 pocket at depth 3 subtracts 600. Unknown pocket face must be incomplete. Include front/back pockets, concave shapes, rotated touching vs colliding and fully contained parts.
- [x] Run focused tests and observe missing feature failures.
- [x] Implement depth layers with Clipper difference and ShapeUtils triangulation. Keep only external horizontal faces and slab boundary walls. Build convex triangular prisms from the same material regions. Use normalized quaternions and bounded geometry caches.
- [x] Implement broad-phase bounds and convex SAT; compute actual collision-region triangles by clipping one convex polyhedron against the other's face planes. Test true overlapping volume, holes and containment separately; epsilon contact is allowed.
- [x] Implement target bounds checks, unavailable/backup inventory state, signature-aware declared rectangular slot fit checks (width/thickness, depth, direction, alignment and real geometry), and continuous swept SAT along user-declared fixed-rotation straight-line installation order. Unknown or unsupported rules produce pending results, never success.
- [x] Generate finite, explainable placement candidates from confirmed rectangular slots and explicit face contact. Check candidate final geometry and declared fits; keep useful incomplete candidates neutral. Generate oriented preview poses even when an explicit align action is needed, but weakSnap only translates compatible orientations and respects axes.
- [x] Test snap entry/exit literals, world cap, zoom projection, Alt, invalid candidates, axis constraint and no rotation mutation. Run focused tests and TypeScript build when integration exists.
- [x] Record tests and review in this plan's progress ledger; report changed files and concerns without committing unrelated work.

### Task 2: Project transactions and inventory integration

**Files:** Modify src/core/types.ts, src/store.ts, src/core/importTransaction.ts; create src/core/assemblyEditing.ts and tests/assembly-store.test.ts.

**Interfaces:** Project.assembly and updateAssembly as above; `validateAssemblyEdit(project:Project,assembly:Assembly): string|null`, `reconcileAssembly(project:Project): Project` preserve invalidated fit references for diagnostics.

- [x] Test independently constructed assembly actions preserve 2D current/source/candidate, write one history snapshot, undo restores exact state, reject NaN/quaternion zero/duplicate items/unknown inventory and search-locked edits.
- [x] Verify failures before adding the store action; implement validated assembly-only transaction without nesting invalidate.
- [x] Test deletion/undo removes/restores instance, duplicate remains unassembled, append retains assembly and new project resets it. Update deletion and import remapping only where needed, leaving source geometry independent.
- [x] Run assembly-store and existing editing/import tests; record results.

### Task 3: 3D workbench and red/yellow interactions

**Files:** Create src/components/AssemblyWorkspace.tsx, AssemblyCanvas.tsx, AssemblyInspector.tsx, assembly.css and assemblyScene.ts; modify src/App.tsx.

**Interfaces:** AssemblyCanvas receives working project, selected id, optional preview pose, current analysis/candidates, tool/magnet/display state, selection/preview/commit callbacks. Scene uses shared model positions and collision-region positions; inspector edits immutable assembly through the store action.

- [x] Implement a lazy-loaded full workspace that replaces the 2D surface when selected, keeping the top header/dialogs and current feature visual tokens. Add 2D/3D toggle only for projects with parts. Disable edits during search and show why. Preserve 2D view across switching.
- [x] Render physical slab/holes/pockets in a Z-up Three scene with axes/grid, orbit/zoom/pan, part raycast selection, transform gizmos and direct selected-part plane drag with a 4px threshold. Suspend orbit while dragging; dispose WebGL and listeners on unmount.
- [x] Use worker revisions for live analysis. Render exact red collision regions, yellow valid ghosts and target highlights, neutral pending ghosts; show nearest candidate and magnetic guides. Apply weakSnap to the unsnapped pose and commit once on release. Esc restores; Alt/toolbar switch disable snapping. Selected locked parts cannot move.
- [x] Add fit-all/selected and front/side/top views, explosion and X-ray viewing without changing detected geometry. Offer candidate buttons and explicit align action, numeric XYZ/angles, machining face confirmation, assembly lock, remove-from-assembly and spare inventory designation.
- [x] Build target dimension, fit relationship (slot/edge/depth/clearance), ordered installation direction/distance and step-preview controls, errors and click-to-locate issues. Use real values and incomplete statuses; provide touch alternatives and responsive resource/scene/info switching.
- [x] Use an explicit built-in assembly demonstration via a user-clicked button, independent from the existing DXF sample; include a host slotted board and insert, correct/incorrect placement and path for practical UI verification.
- [x] Run build, focused checks and real browser interaction including clear yellow placement, weak snap/release, local red overlap, no red on valid insertion, undo and 2D return. Record screenshots and limitations.

### Task 4: Review and final verification

**Files:** README.md, docs/analysis/2026-10-14-assembly-verification.md, this plan and approved spec.

- [x] Review core and integrated diff against the approved design, correct defects with reproductions and targeted tests. Check missing/unsupported semantics cannot become a passing status.
- [x] Run all meaningful new tests, existing full suite with controlled workers, production build and git diff --check. Investigate pre-existing timing failures separately from new failures; do not loosen geometry assertions.
- [x] Record exact observed validation and remaining physical/CAD/path limits. Mark delivered plan steps complete only with evidence. Keep user work intact and show the local preview in Codex.

## Completion evidence — 2026-10-14

All four tasks delivered. Final full regression:37files571tests; production build passed. Browser verifies red/yellow, weak snap and undo, dimensions, installation blockage and playback cancellation, explicit references, face highlights, hidden parts and356px responsive views. Scoped final compliance/quality review passed after repairing its findings. See `docs/analysis/2026-10-14-assembly-verification.md` for exact evidence and supported geometry/path/persistence limits. User joinery edits remain outside assembly commits.

Worker contract now includes independent `analysis` and `guidance` request kinds and revisions, with compact project payload and per-kind latest-successor backpressure. Convex cells carry real boundary metadata; installation issues additionally carry blocked movingPosition/collisionPositions for truthful preview rendering. These additions implement the original physical/cancellation requirements.
