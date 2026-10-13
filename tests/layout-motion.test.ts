import { expect, it } from "vitest";
import { placementMotion } from "../src/core/layoutMotion";
import { transformPoints } from "../src/core/geometry";
import type { Part, Placement } from "../src/core/types";

const part = { width: 40, height: 20 } as Part;
const pose = (rotation: Placement["rotation"], x = 5, y = 7): Placement =>
  ({ partId: "p", sheetId: "a", x, y, rotation });

it("preserves the entire rigid shape, including holes, through cross-sheet rotation and translation", () => {
  for (const from of [0, 90, 180, 270] as const) {
    for (const to of [0, 90, 180, 270] as const) {
      const previous = pose(from), next = { ...pose(to, 100, 110), sheetId: "b" };
      const motion = placementMotion(part, previous, { height: 200, offset: 60 }, next, { height: 300, offset: 420 });
      const points = [{ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 17, y: 8 }];
      const old = transformPoints(points, part, previous), end = transformPoints(points, part, next);
      const radians = motion.angle * Math.PI / 180;
      end.forEach((v, i) => {
        const x = v.x - motion.cx, y = 300 - v.y - motion.cy;
        const start = {
          x: motion.cx + x * Math.cos(radians) - y * Math.sin(radians) + motion.dx + 420,
          y: motion.cy + x * Math.sin(radians) + y * Math.cos(radians) + motion.dy,
        };
        expect(start.x).toBeCloseTo(old[i].x + 60);
        expect(start.y).toBeCloseTo(200 - old[i].y);
      });
      expect(Math.abs(motion.angle)).toBeLessThanOrEqual(180);
    }
  }
});

it("uses the short rotation across zero and leaves unchanged placements still", () => {
  const stock = { height: 200, offset: 60 };
  expect(placementMotion(part, pose(270), stock, pose(0), stock).angle).toBe(90);
  const still = placementMotion(part, pose(90), stock, pose(90), stock);
  expect([still.dx, still.dy, still.angle]).toEqual([0, 0, 0]);
});
