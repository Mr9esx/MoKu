import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { House } from "lucide-react";
import { Vector3, Quaternion } from "three";
import type { Rotation3, Vec3 } from "../core/assemblyTypes";
import {
  cubeZones,
  projectCube,
  type CubePoint,
  type CubeZone,
} from "./viewCubeGeometry";

const points = (polygon: CubePoint[]) =>
  polygon.map((p) => p.x.toFixed(2) + "," + p.y.toFixed(2)).join(" ");
export function AssemblyViewCube({
  orientation,
  onOrient,
  onOrbit,
}: {
  orientation: Rotation3;
  onOrient: (direction: Vec3) => void;
  onOrbit: (dx: number, dy: number) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const pendingClick = useRef<{ zone: CubeZone | undefined; suppressed: boolean }>({
    zone: undefined,
    suppressed: false,
  });
  const cancelDrag = useCallback(() => {
    const active = drag.current;
    if (!active) return;
    drag.current = null;
    pendingClick.current = { zone: undefined, suppressed: true };
    setDragging(false);
    if (svg.current?.hasPointerCapture(active.pointerId))
      svg.current.releasePointerCapture(active.pointerId);
  }, []);
  useEffect(() => {
    window.addEventListener("blur", cancelDrag);
    return () => window.removeEventListener("blur", cancelDrag);
  }, [cancelDrag]);
  const zoneAt = (target: EventTarget) => {
    const id = (target as Element)
      .closest("[data-cube-zone]")
      ?.getAttribute("data-cube-zone");
    return cubeZones().find((zone) => zone.id === id);
  };
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
    <nav
      className={"assembly-view-cube" + (dragging ? " dragging" : "")}
      aria-label="视角正方体"
    >
      <svg
        ref={svg}
        viewBox="0 0 112 112"
        aria-label="拖动正方体旋转视角，点击面、棱或角切换视角"
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0 || drag.current) return;
          drag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
          pendingClick.current = {
            zone: zoneAt(event.target),
            suppressed: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const active = drag.current;
          if (!active || active.pointerId !== event.pointerId) return;
          if (!active.moved) {
            if (
              Math.hypot(
                event.clientX - active.startX,
                event.clientY - active.startY,
              ) < 4
            ) return;
            active.moved = true;
            setDragging(true);
            setHover(null);
          }
          event.preventDefault();
          onOrbit(event.clientX - active.x, event.clientY - active.y);
          active.x = event.clientX;
          active.y = event.clientY;
        }}
        onPointerUp={(event) => {
          const active = drag.current;
          if (!active || active.pointerId !== event.pointerId) return;
          pendingClick.current.suppressed = active.moved;
          drag.current = null;
          setDragging(false);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={(event) => {
          if (drag.current?.pointerId === event.pointerId) cancelDrag();
        }}
        onLostPointerCapture={(event) => {
          if (drag.current?.pointerId === event.pointerId) cancelDrag();
        }}
        onClick={(event) => {
          // Captured pointer clicks target the SVG; assistive clicks retain the zone target.
          const zone = event.detail === 0
            ? zoneAt(event.target)
            : pendingClick.current.suppressed
              ? undefined
              : pendingClick.current.zone;
          pendingClick.current.zone = undefined;
          if (zone) onOrient(zone.direction);
        }}
      >
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
              data-cube-zone={zone.id}
              className={
                "cube-zone" +
                (hover === zone.id ? " hovered" : "") +
                (selected ? " selected" : "")
              }
              onPointerEnter={() => !drag.current?.moved && setHover(zone.id)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(zone.id)}
              onBlur={() => setHover(null)}
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
          {dragging
            ? "拖动旋转视角"
            : visibleZones.find((z) => z.zone.id === hover)?.zone.label ??
              "拖动旋转 · 点击切换"}
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
