import type { Layout, Project } from "./types";
export type ImportTarget = "append" | "new";
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
  metadata: {
    thickness?: number;
    material?: string;
    quantity?: number;
    stocks?: Record<string, { thickness: number; material: string }>;
  },
): Project {
  const p = structuredClone(draft);
  const valid = (t: number, m: string) =>
    Number.isFinite(t) &&
    t >= 1 &&
    t <= 100 &&
    !!m.trim() &&
    m.trim() !== "未指定";
  if (p.sheets.length) {
    p.sheets = p.sheets.map((s) => ({ ...s, ...metadata.stocks?.[s.id] }));
    if (p.sheets.some((s) => !valid(s.thickness, s.material)))
      throw Error("请为每张板材填写 1–100 mm 板厚和材质");
    p.parts = p.parts.map((part) => {
      const stock = p.sheets.find((s) => s.id === part.stockId)!;
      return { ...part, thickness: stock.thickness, material: stock.material };
    });
    p.original.sheets = structuredClone(p.sheets);
  } else {
    const t = metadata.thickness ?? 0,
      m = metadata.material?.trim() ?? "",
      quantity = metadata.quantity ?? 1;
    if (!valid(t, m)) throw Error("请输入 1–100 mm 板厚和材质");
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100 ||
      quantity * p.parts.length > 1000
    )
      throw Error("数量需为 1–100 的整数，最多 1000 个零件");
    p.parts = p.parts.flatMap((part) =>
      Array.from({ length: quantity }, (_, i) => ({
        ...structuredClone(part),
        thickness: t,
        material: m,
        id: quantity === 1 ? part.id : `${part.id}-copy-${i + 1}`,
        name: quantity === 1 ? part.name : `${part.name} · ${i + 1}`,
      })),
    );
  }
  if (
    p.parts.some((p) =>
      p.pockets.some((v) => v.depth === null || v.depth >= p.thickness),
    )
  )
    throw Error("槽深必须已知且小于板厚");
  p.warnings = p.warnings.filter(
    (w) => !w.includes("板厚未知") && !w.includes("请输入零件板厚"),
  );
  return p;
}
