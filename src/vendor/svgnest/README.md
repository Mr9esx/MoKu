# SVGnest integration

Source: Jack000/SVGnest, commit `1248dc21efd3f90d1aa52ba5785e27e5217ed2c9`.
License: MIT, Copyright 2015 Jack Qiao. Full license: `LICENSE.txt`; production
attribution: `public/THIRD_PARTY_NOTICES.txt`.

`genetic.js` extracts the upstream GeneticAlgorithm from `svgnest.js`. Changes:
ES module export, injectable random number generator, bounds/rotation shim, and
swapping a part's angle together with its position during mutation.

`src/core/svgNest.ts` ports the upstream default Minkowski NFP construction and
`util/placementworker.js` union/difference placement strategy into typed project
coordinates. The production optimizer uses this engine for every proposal.
The previous local optimizer exists only in `tests/support/local-nesting-baseline.ts`.

Adaptations around the upstream engine:

- Independent material/thickness pools, sharing the deadline. Complete pool
  results are combined with other validated incumbents before publication.
- Actual finite stock inventory, dimensions, material/thickness compatibility and
  fixed obstacles; no unlimited copies of a bin.
- Rectangle inner-fit regions, including point/segment cases when a part exactly
  spans one stock dimension.
- App-specific lexicographic fitness for stock count, travel and continuous remnants.
- Upstream population size 10 and mutation rate 10; diverse seeds, immigrants and
  stagnation restarts, with the elite preserved.
- Upstream scale 1e7. CleanPolygon removes duplicate/collinear vertices within half
  an integer unit; it never replaces a concave contour with its convex hull.
- For convex inputs only, an exact linear Minkowski edge merge replaces the same
  quadratic computation. Concave inputs use Clipper's Minkowski construction.
- Large Minkowski unions use the library's original quads, unioned in balanced batches to
  check the deadline. No interrupted NFP is cached or used for placement.
- Clearance offset and translation coordinates replace first-vertex coordinates.
  Oblique NFP contacts receive three integer units of rounding protection.
- Bounded per-search NFP cache and independent complete-layout validation against
  original geometry before publishing. Original holes/pockets/export geometry
  are retained; hole nesting remains disabled.

This is a constraints adapter and port of SVGnest, not an unmodified upstream
application. Genetic search cannot certify a global optimum. A legal current
layout remains the incumbent if the selected duration finds no better complete
layout. No fallback local solver is run.
