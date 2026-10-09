import type { Part } from "../core/types";
import { points, displayPoints } from "../core/export";
export function Thumbnail({ part }: { part: Part }) {
  return (
    <svg
      viewBox={`-8 -8 ${part.width + 16} ${part.height + 16}`}
      aria-hidden="true"
    >
      <polygon
        className={`part-outline ${part.thickness > 5 ? "thick" : "thin"}`}
        points={points(displayPoints(part.outline, part.height))}
        strokeWidth="2"
      />
      {part.pockets.map((p, i) => (
        <polygon
          className="pocket-outline"
          key={`p${i}`}
          points={points(displayPoints(p.outline, part.height))}
        />
      ))}
      {part.holes.map((p, i) => (
        <polygon
          className="hole-outline"
          key={`h${i}`}
          points={points(displayPoints(p, part.height))}
        />
      ))}
    </svg>
  );
}
