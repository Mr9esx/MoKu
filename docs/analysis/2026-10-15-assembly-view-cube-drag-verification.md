# View cube dragging verification — 2026-10-15

The user requested dragging the newly added orientation cube. Pressing and dragging now continuously rotates the scene camera. A 4 px threshold distinguishes a click from a drag. Pointer capture belongs to the stable SVG root, allowing the pointer to leave the cube while its visible faces change. The camera retains its current observation target and distance; Z-up is maintained at both poles. Face/edge/corner clicks, keyboard activation and isometric reset remain available.

## Automated checks

- `pnpm exec vitest run tests/assembly*.test.ts`: **8 files / 88 tests passed**. The two new regressions were observed failing before implementation. They cover horizontal/vertical orbit direction, reversal, finite pole behavior, return from a pole, Z-up, and retained target/distance.
- `pnpm build`: **passed** (TypeScript and Vite). Existing large-main-chunk advisory remains.
- `git diff --check`: **passed**.

## Browser verification

Used the separate two-part demo tab; existing project tabs were preserved. Before the change, a native drag from the corner to outside the cube left its projected coordinates unchanged. After the change:

- The same drag changed the cube and scene orientation. The endpoint had no preset direction selected, confirming the drag did not trigger a click/snap on release.
- A diagonal drag ending inside the cube also rotated the camera, retained the arbitrary angle, and cleared the dragging state on release.
- Clicking the back face after dragging reached the back view. Space on the back/top edge reached that edge view. Isometric reset worked; a native 2 px / 1 px jitter gesture on the front face still selected the front view.
- At 390 × 844, a native diagonal drag outside the cube rotated the view without selecting a preset. Computed `touch-action` on the cube SVG was `none`.
- With the insertion board selected, dragging the cube retained all six position/orientation fields: position `(70.4, 20, 6)` mm and rotation `(0, -90, 0)` degrees.
- Browser viewport restored. Captured console warnings/errors: none.

Mouse pointer gestures were tested in both viewport sizes. Physical touch/pen hardware and OS-level interruption were not directly exercised; those share the implemented Pointer Events path and were included in the code review.

Screenshots: [desktop](../design/assembly-view-cube-drag.png), [narrow layout](../design/assembly-view-cube-drag-mobile.png).

Scoped code review passed without findings. Report: `.superpowers/sdd/2026-10-14-2d-to-3d-assembly/view-cube-drag-review.md`.
