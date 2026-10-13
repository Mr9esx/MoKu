import type { Point, Part, Stock, Placement, Project } from "./types";
import type { DrawingDocument, DrawingRole, DrawingDiagnostic } from "./drawingTypes";
import type { ImportOptions } from "./drawingReview";
import { bounds, polygonArea, pointInPolygon, pointSegmentDistance, contoursOverlap } from "./geometry";
import { nearInside, containsFeature, stockAxes, validateHoles } from "./dxfDomainGeometry";
const fail = (message: string): never => { throw Error(message); };
const rounded = (p: Point): Point => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 });
export type ResolvedShape = { e: { handle: string; layer: string; role: DrawingRole; thickness?: number; depth?: number }; points: Point[]; centerline?: Point[]; width?: number; boundaryClosedByUser?: boolean };
/** Explicit stock roles are authoritative. Legacy sample inference remains opt-in. */
function drawingGroups(shapes: ResolvedShape[], options: ImportOptions) {
  let frames = options.mode === "parts" ? [] : shapes.filter(s => s.e.role === "stock");
  const outer = shapes.filter(s => s.e.role === "outer");
  if (!frames.length && options.mode !== "parts" && options.inferStock) {
    frames = outer.filter(c => !outer.some(other => other !== c && containsFeature(c.points, other.points)));
    if (!frames.length || frames.some(c => !outer.some(other => other !== c && containsFeature(other.points, c.points))))
      fail("未找到明确板框；请将板框标为 REF_STOCK，或改用零件轮廓导入");
  }
  return { frames, cuts: outer.filter(c => !frames.includes(c)), features: shapes.filter(s => s.e.role === "hole" || s.e.role === "pocket") };
}
function placementFor(cut: ResolvedShape, frames: ResolvedShape[], options: ImportOptions) {
  if (options.mode === "parts") return { eligible: [], involved: [], frame: undefined };
  const eligible = frames.filter(frame => containsFeature(cut.points, frame.points));
  const involved = frames.filter(frame => eligible.includes(frame) || contoursOverlap(cut.points, frame.points));
  const rule = Object.hasOwn(options.placementRules ?? {}, cut.e.handle) ? options.placementRules![cut.e.handle] : undefined;
  if (rule?.mode === "pending") return { eligible, involved, frame: undefined };
  if (rule?.mode === "stock") {
    const frame = eligible.find(frame => frame.e.handle === rule.stockId);
    return { eligible, involved, frame, message: frame ? undefined : "所选板框未完整包含零件；请选择有效板框或作为待放置零件" };
  }
  // A contour crossing a second frame still needs a decision, even if one frame contains it.
  const conflict = eligible.length > 1 || involved.length > eligible.length;
  return { eligible, involved, frame: !conflict && eligible.length === 1 ? eligible[0] : undefined,
    message: conflict ? eligible.length > 1 ? "零件被多个板框完整包含，请选择板框或作为待放置零件" : "零件与板框边界相交或部分位于板框内，请作为待放置零件或选择完整包含的板框" : undefined };
}
/** Pure relationship review, shared by compilation and the source review UI. */
export function resolvedDrawingIssues(doc: DrawingDocument, options: ImportOptions, shapes: ResolvedShape[]): DrawingDiagnostic[] {
  const issues: DrawingDiagnostic[] = [], space = options.space ?? doc.spaces[0];
  let groups: ReturnType<typeof drawingGroups>;
  try { groups = drawingGroups(shapes, options); } catch { return issues; } // Legacy inference failures are reported by compilation.
  const { frames, cuts, features } = groups;
  const issue = (shape: ResolvedShape, code: DrawingDiagnostic["code"], message: string, related: ResolvedShape[] = [], eligibleStockIds?: string[]) => {
    issues.push({ id: `${code}-${shape.e.handle}-${related.map(s => s.e.handle).join('-')}`, layer: shape.e.layer, space, shapeId: shape.e.handle,
      shapeIds: [shape.e.handle, ...related.map(s => s.e.handle)], code, message, severity: "blocking", ...(eligibleStockIds ? { eligibleStockIds } : {}) });
  };
  for (const frame of frames) try { stockAxes(frame.points); } catch (e) { issue(frame, "invalid-geometry", (e as Error).message); }
  for (const cut of cuts) {
    const placement = placementFor(cut, frames, options);
    if (placement.message) issue(cut, "placement-conflict", placement.message, placement.involved, placement.eligible.map(s => s.e.handle));
  }
  for (let i = 0; i < cuts.length; i++) for (let j = i + 1; j < cuts.length; j++) {
    if (containsFeature(cuts[i].points, cuts[j].points) || containsFeature(cuts[j].points, cuts[i].points))
      issue(cuts[i], "relationship-conflict", "内部轮廓的加工语义不明确，请确认内轮廓为通孔或铣槽", [cuts[j]]);
    else if (options.mode === "parts" && contoursOverlap(cuts[i].points, cuts[j].points))
      issue(cuts[i], "relationship-conflict", "零件外轮廓重叠或内部加工语义不明确，请修正后导入", [cuts[j]]);
  }
  for (const feature of features) {
    const owners = cuts.filter(c => containsFeature(feature.points, c.points));
    if (owners.length !== 1) issue(feature, "relationship-conflict", `孔槽 ${feature.e.handle} 无法唯一归属零件（${owners.length} 个完整包含的外轮廓）`, owners);
  }
  for (let i = 0; i < features.length; i++) for (let j = i + 1; j < features.length; j++) {
    const a = features[i], b = features[j];
    const aInsideB = containsFeature(a.points, b.points), bInsideA = containsFeature(b.points, a.points);
    // A through-hole within a larger shallow pocket is explicit counterbore machining,
    // representable by the existing independent hole and pocket regions. The reverse
    // would place a pocket in removed material; same-role nesting has unresolved islands.
    const counterbore = a.e.role === "hole" && b.e.role === "pocket" && aInsideB && !bInsideA ||
      b.e.role === "hole" && a.e.role === "pocket" && bInsideA && !aInsideB;
    if ((aInsideB || bInsideA) && !counterbore)
      issue(a, "relationship-conflict", "孔槽轮廓嵌套：当前不支持加工岛，请修正加工语义或明确忽略辅助轮廓", [b]);
    else if (a.e.role === "hole" && b.e.role === "hole" && contoursOverlap(a.points, b.points))
      issue(a, "relationship-conflict", "通孔轮廓相交或重叠，请合并或修正后导入", [b]);
  }
  return issues;
}
export function buildDrawingProject(doc: DrawingDocument, options: ImportOptions, shapes: ResolvedShape[]): Project {
  const { frames, cuts, features } = drawingGroups(shapes, options);
  if (options.mode !== "parts" && !frames.length) fail("请确认板框用途，或改用零件轮廓导入");
  if (!cuts.length) fail("没有可导入的零件外轮廓");
  if (cuts.length > 1000) fail("一次最多导入 1000 个零件，请拆分文件");
  const issues = resolvedDrawingIssues(doc, options, shapes);
  if (issues.length) fail(issues[0].message);
  const warnings: string[] = [], placements: Placement[] = [];
  const boards = frames.map((frame, i) => {
    const axes = stockAxes(frame.points);
    return { frame, axes, stock: {
      id: frame.e.handle, name: `板材 ${i + 1}`, width: axes.width, height: axes.height,
      thickness: frame.e.thickness ?? 0, material: "未指定",
    } satisfies Stock };
  });
  const sheets = boards.map(b => b.stock);
  const labels = doc.labels.filter(l => l.space === (options.space ?? doc.spaces[0])).map(l => ({ ...l, used: false, numbered: /^P\d+$/i.test(l.text) }));
  // Every cut gets a single context. Pending cuts use source axes; board cuts use board axes.
  const contexts = cuts.map(cut => {
    const frame = placementFor(cut, frames, options).frame, board = boards.find(b => b.frame === frame);
    const toAxes = board?.axes.toLocal ?? ((p: Point) => p), outline = cut.points.map(toAxes), box = bounds(outline);
    const local = (p: Point) => { const q = toAxes(p); return rounded({ x: q.x - box.minX, y: q.y - box.minY }); };
    const insideLabel = labels.find(l => !l.used && pointInPolygon(l.point, cut.points) && cuts.filter(c => pointInPolygon(l.point, c.points)).length === 1);
    if (insideLabel) insideLabel.used = true;
    const part: Part = {
      id: cut.e.handle, name: insideLabel?.text ?? "", stockId: board?.stock.id ?? "", material: board?.stock.material ?? options.material?.trim() ?? "未指定",
      source: doc.name, layer: cut.e.layer, thickness: board ? cut.e.thickness ?? frame?.e.thickness ?? 0 : options.thickness ?? cut.e.thickness ?? 0,
      width: box.width, height: box.height, area: polygonArea(outline), outline: cut.points.map(local), holes: [], pockets: [],
      label: insideLabel ? local(insideLabel.point) : { x: box.width / 2, y: box.height / 2 },
    };
    if (board) placements.push({ partId: part.id, sheetId: board.stock.id, x: box.minX, y: box.minY, rotation: 0 });
    return { cut, part, board, local };
  });
  const parts = contexts.map(c => c.part);
  for (const { stock, frame } of boards) {
    const thicknesses = [...new Set(parts.filter(p => p.stockId === stock.id).map(p => p.thickness))];
    if (thicknesses.length === 1) stock.thickness = frame.e.thickness ?? thicknesses[0];
    else if (thicknesses.length > 1) {
      if (!options.deferThicknessCheck) fail("同一板框内零件厚度不一致");
      warnings.push(`${stock.name}：图层厚度提示不一致，请填写实际板厚`);
    }
  }
  for (let i = 0; i < cuts.length; i++) for (let j = i + 1; j < cuts.length; j++)
    if (contoursOverlap(cuts[i].points, cuts[j].points)) warnings.push(`外轮廓 ${cuts[i].e.handle} 与 ${cuts[j].e.handle} 相交，请核对原始排版`);
  const envelopes = contexts.map(c => ({ ...c, box: bounds(c.cut.points) }));
  const candidates = labels.filter(l => !l.used && l.numbered).map(label => ({ label, owners: envelopes.filter(({ box }) => label.point.x >= box.minX && label.point.x <= box.maxX && label.point.y >= box.minY && label.point.y <= box.maxY) }));
  for (const { label, owners } of candidates) {
    if (owners.length !== 1) continue;
    const context = owners[0];
    if (context.part.name || candidates.filter(c => c.owners.some(o => o.cut === context.cut)).length !== 1) continue;
    context.part.name = label.text; context.part.label = context.local(label.point); context.part.labelAssociation = "notch"; label.used = true;
  }
  for (const { part, board, local } of contexts.filter(c => !c.part.name)) {
    // Preserve the original board-only nearest-label fallback; pending contours have no board neighborhood.
    const remaining = board ? labels.filter(l => !l.used && l.numbered && nearInside(l.point, board.frame.points)) : [];
    const distance = (l: typeof labels[number]) => Math.min(...part.outline.map((v, i) => pointSegmentDistance(local(l.point), v, part.outline[(i + 1) % part.outline.length])));
    remaining.sort((a, b) => distance(a) - distance(b));
    const label = remaining[0];
    if (label) {
      label.used = true; part.name = label.text; part.label = local(label.point); part.labelAssociation = "nearest";
      warnings.push(`${part.name} 标注归属不唯一，已暂按最近未匹配文字关联，请核对`);
    } else part.name = `零件 ${part.id}`;
  }
  for (const feature of features) {
    const context = contexts.find(c => containsFeature(feature.points, c.cut.points))!;
    const { part, local } = context, outline = feature.points.map(local);
    if (feature.e.role === "hole") {
      if (!options.deferThicknessCheck && feature.e.thickness && part.thickness && feature.e.thickness !== part.thickness) fail("孔图层厚度与所属零件不匹配");
      part.holes.push(outline);
    } else {
      const depth = feature.e.depth ?? 0;
      if (!Number.isFinite(depth) || depth <= 0) fail("铣槽深度未知，请填写大于 0 的槽深");
      if (!options.deferThicknessCheck && part.thickness > 0 && depth >= part.thickness) fail("槽深必须小于板厚");
      part.pockets.push({ outline, depth, ...(feature.centerline ? { centerline: feature.centerline.map(local), width: feature.width } : {}), ...(feature.boundaryClosedByUser ? { boundaryClosedByUser: true } : {}) });
    }
  }
  validateHoles(parts);
  if (labels.some(l => !l.used && l.numbered)) warnings.push("存在未匹配的零件编号，请核对原图标注");
  if (new Set([...parts.map(p => p.id), ...sheets.map(s => s.id)]).size !== parts.length + sheets.length) fail("源实体 ID 重复，请修复图纸");
  if (parts.some(p => !p.thickness)) warnings.push("零件板厚未知，请填写板厚后排版");
  const quantity = options.mode === "parts" ? options.quantity ?? 1 : 1;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || parts.length * quantity > 1000) fail("数量需为 1–100 的整数，导入最多 1000 个零件");
  const copies = quantity === 1 ? parts : parts.flatMap(p => Array.from({ length: quantity }, (_, i) => ({ ...structuredClone(p), id: `${p.id}-copy-${i + 1}`, name: `${p.name} · ${i + 1}` })));
  return { name: doc.name, units: "mm", importInfo: doc.importInfo, sheets, parts: copies, original: { sheets: structuredClone(sheets), placements }, warnings };
}
