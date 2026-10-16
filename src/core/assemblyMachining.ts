import ClipperLib from "clipper-lib";
import type { Part, Point, Project } from "./types";
import type { Assembly, AssemblyMachiningWarning } from "./assemblyTypes";
import { geometrySignature, transformPoint } from "./assemblyGeometry";
import { pointInPolygon, pointSegmentDistance, validContour } from "./geometry";
import { reliefContours } from "./joineryRelief";

/** Merge cuts before testing corner existence, including coincident/shared walls.
 * Deeper or same-depth cuts can remove a corner along its entire insertion depth. */
function mergedCutCorners(part: Part, contours: Point[][]): Point[] {
  const scale = 100000, clipper = new ClipperLib.Clipper();
  clipper.StrictlySimple = true;
  const paths = contours.map(contour => {
    const path = contour.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.y * scale) }));
    if (!ClipperLib.Clipper.Orientation(path)) path.reverse();
    return path;
  });
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const union: ClipperLib.Paths = [];
  clipper.Execute(ClipperLib.ClipType.ctUnion, union, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  // Shared edges can leave exact collinear return-spurs in Clipper's output.
  // A sub-integer cleaning tolerance removes those without rounding real vertices.
  const cleaned = ClipperLib.Clipper.CleanPolygons(union, 0.01);
  // Normalize the signed boundaries after cleaning so adjacent cuts on an island
  // are joined to its boundary rather than remaining separate touching loops.
  const simplified = ClipperLib.Clipper.SimplifyPolygons(cleaned, ClipperLib.PolyFillType.pftNonZero);
  return ClipperLib.Clipper.CleanPolygons(simplified, 0.01).flatMap(path => {
    const points = path.map(p => ({ x: p.X / scale, y: p.Y / scale }));
    // Negative union boundaries enclose remaining material islands. Their exterior
    // convex corners need no relief; their concave notches still do.
    const island = !ClipperLib.Clipper.Orientation(path);
    const contour = island
      ? reliefContours({ ...part, outline: points, holes: [], pockets: [] })[0]
      : reliefContours({ ...part, holes: [points], pockets: [] })[1];
    return contour.corners.filter(c => !c.fillet).map(c => c.point);
  });
}

/** The drawing has sharp internal corners, but no machining process or tool diameter.
 * Report conditional milling advice, never invent a cutter radius or a collision. */
export function assemblyMachiningWarnings(project: Project, assembly: Assembly): AssemblyMachiningWarning[] {
  const warnings: AssemblyMachiningWarning[] = [], seen = new Set<string>();
  for (const item of assembly.items) {
    if (seen.has(item.partId) || assembly.sparePartIds.includes(item.partId)) continue;
    seen.add(item.partId);
    if (![...Object.values(item.position), ...Object.values(item.rotation)].every(Number.isFinite)
      || Math.hypot(item.rotation.x, item.rotation.y, item.rotation.z, item.rotation.w) < 1e-12) continue;
    const part = project.parts.find(p => p.id === item.partId);
    if (!part || !Number.isFinite(part.thickness) || part.thickness <= 0) continue;
    // Unsupported drawings already carry a pending geometry issue. Respect the model's
    // coordinate/complexity limits here too, before expensive contour or Boolean work.
    const contours = [part.outline, ...part.holes, ...part.pockets.map(p => p.outline)];
    if (part.pockets.length > 128 || contours.reduce((n, c) => n + c.length * c.length, 0) > 4_000_000
      || contours.some(c => c.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e8 || Math.abs(p.y) > 1e8))
      || !validContour(part.outline)) continue;
    const config = assembly.pocketFaces[part.id];
    const faces = config?.signature === geometrySignature(part) ? config.faces : {};
    for (const target of reliefContours(part)) {
      if (!validContour(target.points)) continue;
      const pocket = target.id.startsWith("pocket:") ? Number(target.id.slice(7)) : null;
      const face = pocket === null ? undefined : faces[pocket];
      const depth = pocket === null ? undefined : part.pockets[pocket].depth;
      const otherCuts = part.holes.filter((hole, i) => target.id !== `hole:${i}` && validContour(hole));
      if (face && depth !== null && depth !== undefined && depth > 0)
        part.pockets.forEach((p, i) => {
          if (i !== pocket && faces[i] === face && p.depth !== null && p.depth >= depth && p.depth < part.thickness && validContour(p.outline)) otherCuts.push(p.outline);
        });
      const mergedCorners = target.id !== "outline" && otherCuts.length
        ? mergedCutCorners(part, [target.points, ...otherCuts]) : null;
      const corners = target.corners.filter(corner => {
        // An explicitly drawn fillet is intentional geometry, not an omitted tool relief.
        if (corner.fillet) return false;
        if (target.id !== "outline") {
          // An open slot mouth on a free board edge has no internal corner to relieve.
          if (!pointInPolygon(corner.point, part.outline, false)) return false;
          if (part.outline.some((p, i) => pointSegmentDistance(corner.point, p, part.outline[(i + 1) % part.outline.length]) < 1e-5)) return false;
        }
        if (mergedCorners) return mergedCorners.some(p => Math.hypot(p.x - corner.point.x, p.y - corner.point.y) < 1e-5);
        return target.id !== "outline" || !otherCuts.some(hole => pointInPolygon(corner.point, hole, true));
      });
      if (!corners.length) continue;
      // Unknown pocket sides and through cuts get both faces rather than a guessed face.
      const heights = face === "front" ? [part.thickness] : face === "back" ? [0] : [0, part.thickness];
      const localPositions = corners.flatMap(c => heights.map(z => ({ ...c.point, z })));
      const label = target.id === "outline" ? "外轮廓" : pocket === null ? `通孔 ${Number(target.id.slice(5)) + 1}` : `铣槽 ${pocket + 1}`;
      warnings.push({
        id: `machining:${part.id}:${target.id}`, kind: "machining", severity: "warning",
        partIds: [part.id], target: target.id, cornerCount: corners.length, localPositions,
        position: transformPoint(localPositions[0], item),
        message: `${label}：${corners.length} 处内直角未画刀口（清角/T 骨）。使用圆柱铣刀时会留圆角，方角配件可能顶住；请在二维图纸中补画，或确认加工方式。`,
      });
    }
  }
  return warnings;
}
