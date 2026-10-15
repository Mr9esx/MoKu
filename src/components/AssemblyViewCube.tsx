import { useMemo, useState } from "react";
import { House } from "lucide-react";
import { Vector3, Quaternion } from "three";
import type { Rotation3, Vec3 } from "../core/assemblyTypes";
import { projectCube, type CubePoint, type CubeZone } from "./viewCubeGeometry";

const points = (polygon: CubePoint[]) =>
  polygon.map((p) => p.x.toFixed(2) + "," + p.y.toFixed(2)).join(" ");
export function AssemblyViewCube({
  orientation,
  onOrient,
}: {
  orientation: Rotation3;
  onOrient: (direction: Vec3) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const faces = useMemo(() => projectCube(orientation), [orientation]);
  const visibleZones = useMemo(() => {
    const result = new Map<
      string,
      { zone: CubeZone; polygons: CubePoint[][] }
    >();
    for (const face of faces)
      for (const cell of face.cells) {
        const entry = result.get(cell.zone.id) ?? {
          zone: cell.zone,
          polygons: [],
        };
        entry.polygons.push(cell.polygon);
        result.set(cell.zone.id, entry);
      }
    return [...result.values()];
  }, [faces]);
  const outward = new Vector3(0, 0, 1).applyQuaternion(
    new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
  );
  return (
    <nav className="assembly-view-cube" aria-label="视角正方体">
      <svg viewBox="0 0 112 112" aria-label="点击面、棱或角切换视角">
        {faces.map((face) => (
          <polygon
            key={face.label}
            points={points(face.polygon)}
            className={"cube-face cube-face-" + face.label}
          />
        ))}
        {visibleZones.map(({ zone, polygons }) => {
          const selected =
            outward.dot(
              new Vector3(zone.direction.x, zone.direction.y, zone.direction.z),
            ) > 0.9999;
          return (
            <g
              key={zone.id}
              role="button"
              tabIndex={0}
              aria-label={"切换到" + zone.label}
              aria-pressed={selected}
              className={
                "cube-zone" +
                (hover === zone.id ? " hovered" : "") +
                (selected ? " selected" : "")
              }
              onPointerEnter={() => setHover(zone.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(zone.id)}
              onBlur={() => setHover(null)}
              onClick={() => onOrient(zone.direction)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  onOrient(zone.direction);
                }
              }}
            >
              <title>{zone.label}</title>
              {polygons.map((polygon, index) => (
                <polygon key={index} points={points(polygon)} />
              ))}
            </g>
          );
        })}
        {faces.map((face) => (
          <text
            key={face.label}
            transform={"matrix(" + face.textTransform.join(" ") + ")"}
            x="0"
            y="0.02"
            dominantBaseline="middle"
            textAnchor="middle"
            fontSize="0.25"
            className="cube-label"
          >
            {face.label}
          </text>
        ))}
      </svg>
      <div className="cube-caption">
        <span>
          {visibleZones.find((z) => z.zone.id === hover)?.zone.label ??
            "点击面 · 棱 · 角"}
        </span>
        <button
          aria-label="等轴视图"
          title="恢复等轴视图"
          onClick={() => onOrient({ x: 1, y: -1, z: 1 })}
        >
          <House size={14} />
        </button>
      </div>
    </nav>
  );
}
