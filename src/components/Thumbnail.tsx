import type { Part } from "../core/types";
import { points, displayPoints } from "../core/export";
export function Thumbnail({ part }: { part: Part }) {
  return (
    <svg
      viewBox={`-8 -8 ${part.width + 16} ${part.height + 16}`}
      aria-hidden="true"
    >
      <polygon
        points={points(displayPoints(part.outline, part.height))}
        fill={part.thickness > 5 ? "#cdb68e" : "#a8b59b"}
        stroke="#877c67"
        strokeWidth="2"
      />
      {part.pockets.map((p, i) => (
        <polygon
          key={`p${i}`}
          points={points(displayPoints(p.outline, part.height))}
          fill="#e9e8d8"
        />
      ))}
      {part.holes.map((p, i) => (
        <polygon
          key={`h${i}`}
          points={points(displayPoints(p, part.height))}
          fill="#aac7d7"
        />
      ))}
    </svg>
  );
}
