# View cube dragging implementation plan

**Goal:** Dragging the orientation cube rotates the assembly camera continuously; clicking faces, edges and corners still selects views.

**Design:** Reuse the existing Z-up camera, target and radius. Pointer movement on the SVG drives incremental azimuth/polar rotation immediately. Capture the primary pointer on the stable SVG root so dragging can continue outside the cube while projected faces change. A 4 px movement threshold separates clicks from drags; dragging or cancellation must not activate a view on release. Mouse, pen and touch use Pointer Events; touch scrolling is disabled only over the cube. Keep the compact layout and add a short drag hint and grab/grabbing cursors.

**Alternatives considered:** Re-emitting mouse events into OrbitControls would couple two unrelated DOM surfaces; a separate trackball would introduce roll incompatible with existing Z-up orbiting. Direct camera orbit uses the existing coordinate conventions and makes click/drag separation explicit.

- [x] Add and observe failing regression tests for horizontal/vertical direction, reversible drags, pole stability and retained focus/distance in `tests/assembly-view-cube.test.ts`.
- [x] Implement `dragViewQuaternion(q, dx, dy)` in `viewCubeGeometry.ts`, and expose scene `orbitView(dx, dy)` through `AssemblyCanvas.tsx`. It cancels navigation animation and pending part drags, moves only the camera, updates OrbitControls and requests rendering.
- [x] Add captured pointer drag handling to `AssemblyViewCube.tsx`. Preserve keyboard/assistive clicks, exclude secondary pointers, cancel on pointer-cancel/lost capture/window blur, and suppress click after a drag. Add cursors/hint in `assembly.css`.
- [x] Verify real desktop drag beyond the cube, diagonal/vertical drag, release without snapping, subsequent face/edge/corner/keyboard clicks, and narrow layout. Run focused assembly regressions, production build and scoped review, then commit only these changes.

**Evidence:** 88 assembly tests and production build passed. Browser checks passed for desktop and 390 × 844 layouts, including native drags ending inside/outside the SVG, 2 px click jitter and unchanged selected-part coordinates. Scoped review passed without findings. See `docs/analysis/2026-10-15-assembly-view-cube-drag-verification.md`.
