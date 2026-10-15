# Unified preview layout verification — 2026-10-15

The user requested assembly information inside the preview on its right, and the 2D interface aligned to 3D. Both context panels are now children of their preview, sharing the frame placement and resource-rail width. Expanded information uses a 304 px inset panel; the existing compact assembly summary stays 224 px wide. Drawing tools and view controls now sit at the bottom of the preview. The drawing fit measures the information panel's actual rectangle so all sheets fit in the remaining area.

## Verification

- `pnpm exec vitest run tests/assembly*.test.ts tests/canvas-viewport.test.ts`: **9 files / 94 tests passed**.
- `pnpm build`: **passed** (TypeScript and Vite). The existing main-chunk-size advisory remains.
- `git diff --check`: **passed**.
- Scoped review passed after removing the obsolete 901–1150 px assembly rail-width override. Review also checked nested mobile visibility, scroll containers, candidate insets, observer cleanup and lazy-loaded CSS order. Report: `.superpowers/sdd/2026-10-14-2d-to-3d-assembly/preview-layout-review.md`.

Real browser observations at 1280 × 720:

- 2D and 3D both measured preview `x=276, y=68, width=990, height=616`, with a 248 px resource rail.
- Expanded 3D information measured `x=945, y=85, width=304, height=442`. It was fully contained by the preview and did not overlap the orientation cube. Compact mode and expansion were both inspected visually.
- Selected P01 in 2D, zoomed in, then fitted all sheets. All three sheets remained visible in the free area; the selected-part inspector remained inside the preview.
- Added P01 to 3D, clicked the front face of the cube, restored isometric view, and opened precise adjustment. View switching and the nested information panel worked.
- Screenshots: [2D](../design/preview-layout-2d.png), [3D](../design/preview-layout-3d.png).

## Boundaries

Phone-size emulation repeatedly timed out and reset the browser-control session. The 1024 px and phone cases, live candidate progress, physical touch gestures and mobile scrolling were not completed in this browser pass. Their source paths were reviewed; this report does not claim browser verification for them. The temporary viewport override was reset successfully.

## Development reload incident

Changing the entry stylesheet import and later the App module caused full page reloads, clearing in-memory projects. This was disclosed to the user. Inspection of the installed React refresh runtime confirmed that the exported non-component `formatPercent` function changed identity on App updates and invalidated the refresh boundary. It is now an internal helper, with no external consumers. Removing that export can itself trigger one final invalidation; this change is not a persistence guarantee.

The known 53-part sample was reopened in the layout preview tab and the two-part assembly demo was reopened in its prior tab. Older project tabs could not be inspected because their debugger connections timed out. Unsaved manual adjustments were not recovered. Existing joinery source changes in the working tree were preserved and are outside this commit.
