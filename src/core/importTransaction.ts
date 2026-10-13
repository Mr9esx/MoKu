import type { Layout, Project, Stock, Part } from "./types";
export type ImportTarget = "append" | "new";
export type StockMetadata = Record<string, { thickness: number; material: string }>;
export type PartMetadata = StockMetadata;
export type ImportMetadata = { parts?: PartMetadata; thickness?: number; material?: string; quantity?: number; stocks?: StockMetadata };
/** Call with an empty previous map when the source file or import mode changes. */
export function reconcileStockMetadata(sheets: Stock[], previous: StockMetadata, sample: boolean): StockMetadata {
  return Object.fromEntries(sheets.map(s => [s.id, (Object.hasOwn(previous, s.id) ? previous[s.id] : undefined) ?? {
    thickness: s.thickness,
    material: s.material && s.material !== "未指定" ? s.material : sample ? "多层板" : "",
  }]));
}
/** Keep explicit mm values only for pending identifiers in the current file. */
export function reconcilePartMetadata(parts: Part[], previous: PartMetadata): PartMetadata {
  return Object.fromEntries(parts.filter(p => !p.stockId).map(p => [p.id,
    (Object.hasOwn(previous, p.id) ? previous[p.id] : undefined) ?? {
      thickness: p.thickness, material: p.material && p.material !== "未指定" ? p.material : "",
    }]));
}
const partMetadata = (metadata: ImportMetadata, part: Part) =>
  metadata.parts && Object.hasOwn(metadata.parts, part.id) ? metadata.parts[part.id] : undefined;
export function importMetadataIssues(draft: Project, metadata: ImportMetadata): { field: string; message: string }[] {
  const issues: { field: string; message: string }[] = [];
  const check = (thickness: number, material: string, prefix: string, name: string) => {
    if (!Number.isFinite(thickness) || thickness < 1 || thickness > 100)
      issues.push({ field: `${prefix}thickness`, message: `${name}板厚需为 1–100 mm` });
    if (!material.trim() || material.trim() === "未指定")
      issues.push({ field: `${prefix}material`, message: `${name}请选择材质` });
  };
  if (draft.sheets.length) for (const s of draft.sheets) {
    const value = metadata.stocks?.[s.id] ?? s;
    check(value.thickness, value.material, `stock.${s.id}.`, `${s.name}：`);
  } else {
    if (draft.parts.some(p => !partMetadata(metadata, p))) check(metadata.thickness ?? 0, metadata.material ?? "", "", "零件：");
    const quantity = metadata.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || quantity * draft.parts.length > 1000)
      issues.push({ field: "quantity", message: "每种轮廓数量需为 1–100 的整数，总计不超过 1000 个零件" });
  }
  for (const part of draft.parts) {
    const stock = draft.sheets.find(s => s.id === part.stockId);
    const explicit = partMetadata(metadata, part);
    const pending = !stock && (draft.sheets.length > 0 || !!explicit);
    const value = explicit ?? (draft.sheets.length ? { thickness: 0, material: "" } : { thickness: metadata.thickness ?? 0, material: metadata.material ?? "" });
    if (pending) check(value.thickness, value.material, `part.${part.id}.`, `${part.name}：`);
    const thickness = stock ? (metadata.stocks?.[stock.id]?.thickness ?? stock.thickness) : value.thickness;
    const thicknessField = stock ? `stock.${stock.id}.thickness` : pending ? `part.${part.id}.thickness` : "thickness";
    for (const pocket of part.pockets) {
      if (pocket.depth === null || !Number.isFinite(pocket.depth) || pocket.depth <= 0) issues.push({ field: "drawing", message: `${part.name}：槽深必须为大于 0 的有限数值，请在图纸中确认槽深` });
      else if (Number.isFinite(thickness) && thickness >= 1 && pocket.depth >= thickness)
        issues.push({ field: thicknessField, message: `${part.name}：槽深 ${pocket.depth} mm，板厚必须大于槽深` });
    }
  }
  return issues;
}
export type WorkspaceSnapshot = {
  project: Project | null;
  source: Project | null;
  current: Layout | null;
};
export function emptyProject(): Project {
  const baseline: Project = {
    name: "未命名项目",
    units: "mm",
    sheets: [],
    parts: [],
    original: { sheets: [], placements: [] },
    warnings: [],
  };
  return { ...baseline, importedSource: structuredClone(baseline) };
}
/** Pure, collision-safe merge. Incoming identifiers are remapped consistently across
 * parts, stocks and placements; existing working coordinates are never rebuilt. */
export function mergeImport(
  before: WorkspaceSnapshot,
  incoming: Project,
  target: ImportTarget,
): WorkspaceSnapshot {
  const draft = structuredClone(incoming);
  delete draft.importedSource;
  const used = new Set(
    [
      ...(before.project?.parts ?? []),
      ...(before.project?.sheets ?? []),
      ...(before.source?.parts ?? []),
      ...(before.source?.sheets ?? []),
    ].map((v) => v.id),
  );
  const id = (base: string) => {
    let next = base,
      n = 1;
    while (used.has(next)) next = `${base}-import-${n++}`;
    used.add(next);
    return next;
  };
  const stocks = new Map(draft.sheets.map((s) => [s.id, id(s.id)]));
  const parts = new Map(draft.parts.map((p) => [p.id, id(p.id)]));
  const remapLayout = (layout: Layout): Layout => ({
    sheets: layout.sheets.map((s) => ({ ...s, id: stocks.get(s.id)! })),
    placements: layout.placements.map((p) => ({
      ...p,
      partId: parts.get(p.partId)!,
      sheetId: stocks.get(p.sheetId)!,
    })),
  });
  const remapped: Project = {
    ...draft,
    sheets: draft.sheets.map((s) => ({ ...s, id: stocks.get(s.id)! })),
    parts: draft.parts.map((p) => ({
      ...p,
      id: parts.get(p.id)!,
      stockId: stocks.get(p.stockId) ?? "",
      material:
        p.material ??
        draft.sheets.find((s) => s.id === p.stockId)?.material ??
        "未指定",
      source: p.source ?? draft.name,
    })),
    original: remapLayout(draft.original),
  };
  const base =
    target === "append"
      ? before
      : { project: null, source: null, current: null };
  const join = (a: Project | null, b: Project): Project =>
    a
      ? {
          ...a,
          name: `${a.name} + ${b.name}`,
          sheets: [...a.sheets, ...b.sheets],
          parts: [...a.parts, ...b.parts],
          original: {
            sheets: [...a.original.sheets, ...b.original.sheets],
            placements: [...a.original.placements, ...b.original.placements],
          },
          warnings: [...a.warnings, ...b.warnings],
        }
      : b;
  const source = join(base.source, remapped);
  source.sourceFiles = [
    ...(base.source?.sourceFiles ??
      (base.source ? [structuredClone(base.source)] : [])),
    draft,
  ];
  const project = join(base.project, structuredClone(remapped));
  project.importedSource = structuredClone(source);
  const current = base.current
    ? {
        sheets: [...base.current.sheets, ...remapped.original.sheets],
        placements: [
          ...base.current.placements,
          ...remapped.original.placements,
        ],
      }
    : structuredClone(remapped.original);
  return { project, source, current };
}
/** Metadata is confirmed explicitly; this function never mutates preview geometry. */
export function confirmMetadata(
  draft: Project,
  metadata: ImportMetadata,
): Project {
  const issues = importMetadataIssues(draft, metadata);
  if (issues.length) throw Error(issues[0].message);
  const p = structuredClone(draft);
  if (p.sheets.length) {
    p.sheets = p.sheets.map((s) => ({ ...s, ...metadata.stocks?.[s.id] }));
    p.parts = p.parts.map((part) => {
      const stock = p.sheets.find((s) => s.id === part.stockId);
      const value = stock ?? partMetadata(metadata, part)!;
      return { ...part, thickness: value.thickness, material: value.material.trim() };
    });
    p.original.sheets = structuredClone(p.sheets);
  } else {
    const t = metadata.thickness ?? 0,
      m = metadata.material?.trim() ?? "",
      quantity = metadata.quantity ?? 1;
    p.parts = p.parts.flatMap((part) =>
      Array.from({ length: quantity }, (_, i) => ({
        ...structuredClone(part),
        thickness: partMetadata(metadata, part)?.thickness ?? t,
        material: partMetadata(metadata, part)?.material.trim() ?? m,
        id: quantity === 1 ? part.id : `${part.id}-copy-${i + 1}`,
        name: quantity === 1 ? part.name : `${part.name} · ${i + 1}`,
      })),
    );
  }
  p.warnings = p.warnings.filter(
    (w) => !w.includes("板厚未知") && !w.includes("请输入零件板厚"),
  );
  return p;
}
