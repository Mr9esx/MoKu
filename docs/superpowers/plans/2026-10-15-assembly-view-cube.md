# Assembly navigation cube implementation plan

**Goal:** Replace front/side/top text shortcuts with an orientation cube based on the user's explicit RiSu reference.

**Reference:** `/Users/mr9esx/RiSu/app/src/features/viewport/components/ViewCube.tsx`: six labelled faces, 0.17-wide border zones for edges/corners, hover highlight, live camera synchronization and smooth navigation. RiSu uses Y-up; this workbench remains Z-up. Reference repository stays read-only.

**Design:** Project a real unit cube into SVG from the existing camera quaternion. Face regions form 26 unique camera directions; shared edges/corners act as single accessible controls. No additional renderer or React Three dependency. Navigation preserves the camera target and distance and never modifies assembly/history. Retain fit-all/selected as two text controls, add an isometric reset on the cube. Desktop lower-right; narrow canvas upper-right so it cannot overlap the bottom toolbar.

- [x] Add failing geometry tests for 26 directions, Z-up face mapping, visible-face projection/label orientation and pole-safe camera quaternions.
- [x] Implement independent cube geometry and accessible SVG component. Match existing paper/ink styling, with blue hover and Chinese labels.
- [x] Connect orientation updates from scene render, implement cancellable 500 ms camera movement preserving focus/distance, cancel on user camera gestures/fit/unmount.
- [x] Replace three view text buttons, verify real browser face/edge/corner clicks, orbit synchronization, keyboard access and narrow layout. Run focused regressions/build and scoped review; preserve existing user edits and open project state.

**Review repairs:** Use spherical azimuth/polar interpolation with Z-up throughout the animation. This avoids roll jumps when the user interrupts a camera transition. Move the installation-preview exit to the upper left so it stays clear of the cube on narrow screens. Add regressions covering all 26 × 26 direction pairs and shortest-path azimuth across ±π.

**Verification:** 86 assembly tests passed; production build passed. Browser checks and screenshots are recorded in `docs/analysis/2026-10-15-assembly-view-cube-verification.md`. Scoped review and repair re-review passed.
