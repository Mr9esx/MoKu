# Assembly view cube verification — 2026-10-15

The user requested a view-selection cube referencing `/Users/mr9esx/RiSu`. The reference was inspected read-only. Its face/edge/corner navigation was adapted to the workbench's Z-up coordinates with an independent SVG implementation and no new dependencies.

## Behavior

- Six labelled faces, twelve edges and eight corners select 26 camera directions. Adjacent polygons belonging to one edge/corner share one keyboard-accessible control.
- Hover and keyboard focus highlight the region in blue. The cube follows the scene camera during orbiting and view transitions.
- View changes take 500 ms with cubic easing and retain the current orbit target and camera distance. Spherical interpolation keeps Z-up throughout, including when interrupted by further navigation or camera gestures.
- The cube includes an isometric reset. Fit-all and fit-selected remain separate controls. Camera navigation does not invoke assembly pose/history callbacks.
- On desktop the cube sits in the lower-right corner; narrow canvases put it above the toolbar. The installation-preview exit sits on the left.

## Automated checks

`pnpm exec vitest run tests/assembly*.test.ts`: **8 files / 86 tests passed**. The six view-cube tests cover 26 unique unit directions, Z-up face mapping, projection and readable label transforms, all six axial views and both poles, preserved focus/distance, all 26 × 26 direction-pair intermediate orientations, and the shortest azimuth across ±π. New tests were observed failing before their implementation.

`pnpm build`: **passed** (TypeScript and Vite). Vite retains its existing advisory about a main chunk over 500 kB; this is not a build failure.

`git diff --check`: **passed**.

## Real browser checks

Verified in a separate local demo tab, preserving the user's existing project tabs and data:

- Front face click, front/top edge click and right/front/top corner click each reached the matching pressed state and visibly changed the scene view.
- Enter on the top-face control reached a stable top view. Isometric reset restored the three visible front/right/top faces.
- Consecutive view selections completed without freezing controls. Orbiting the empty scene changed both the model view and the cube's projected polygon coordinates.
- A native pointer click on the corner highlighted its three adjoining polygons and showed the corner's Chinese label.
- At 390 × 844, a native pointer click on the front face reached the front view. The cube remained above the bottom controls.
- Started the second installation step on the phone layout. The cube and preview-exit rectangles did not overlap; clicking “返回最终装配” exited the preview successfully.
- Restored the normal browser viewport. The demo tab reported no captured console warnings or errors.

The timing-sensitive interruption repair is covered by the intermediate Z-up regression and scoped mathematical review. A browser drag after view navigation was also verified; the automation's click timing did not isolate a mid-animation frame.

Screenshots: [desktop](../design/assembly-view-cube.png), [phone](../design/assembly-view-cube-mobile.png).

## Review

Scoped review initially identified roll reset on interruption and a narrow-screen preview-exit overlap. Both were fixed and the follow-up review passed. The local review report is `.superpowers/sdd/2026-10-14-2d-to-3d-assembly/view-cube-review.md`.
