import { transformPoints } from "./geometry";
import type { Part, Placement } from "./types";

type CanvasStock = { height: number; offset: number };

/** Transform the final drawing back to the previous pose, in the new sheet's coordinates.
 * Translation outside rotation keeps outlines, holes and labels together across sheets. */
export function placementMotion(
  part: Part, previous: Placement, from: CanvasStock, next: Placement, to: CanvasStock,
) {
  const center = [{ x: part.width / 2, y: part.height / 2 }];
  const start = transformPoints(center, part, previous)[0];
  const end = transformPoints(center, part, next)[0];
  return {
    dx: start.x + from.offset - end.x - to.offset,
    dy: from.height - start.y - (to.height - end.y),
    cx: end.x, cy: to.height - end.y,
    angle: ((next.rotation - previous.rotation + 540) % 360) - 180,
  };
}
