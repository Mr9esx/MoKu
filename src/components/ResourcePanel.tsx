import { useState } from "react";
import { Upload, Plus, Search, Trash2 } from "lucide-react";
import { useWorkbench } from "../store";
import { Thumbnail } from "./Thumbnail";
import type { Dialog } from "./WorkspaceDialogs";
import type { Project, Layout } from "../core/types";
export function ResourcePanel({
  project,
  layout,
  open,
  onSelect,
}: {
  project: Project | null;
  layout?: Layout | null;
  open: (d: Dialog, stockId?: string) => void;
  onSelect: () => void;
}) {
  const s = useWorkbench(),
    [tab, setTab] = useState<"parts" | "stock">("parts"),
    [query, setQuery] = useState("");
  const items =
    project?.parts.filter((p) =>
      `${p.name} ${p.thickness} ${p.material ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  const stocks =
    project?.sheets.filter((p) =>
      `${p.name} ${p.material} ${p.thickness}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <aside className="parts-panel floating" aria-label="资源">
      <div className="panel-heading">
        <strong>用料清单</strong>
        <span className="section-index">01</span>
      </div>
      <div className="resource-import">
        <button className="wide" onClick={() => open("import")}>
          <Upload size={15} />
          导入 DXF
        </button>
      </div>
      <div className="resource-tabs">
        <button
          className={tab === "parts" ? "active" : ""}
          onClick={() => {
            setTab("parts");
            setQuery("");
          }}
        >
          零件 <small>{project?.parts.length ?? 0}</small>
        </button>
        <button
          className={tab === "stock" ? "active" : ""}
          onClick={() => {
            setTab("stock");
            setQuery("");
          }}
        >
          板材 <small>{project?.sheets.length ?? 0}</small>
        </button>
      </div>
      <div className="resource-actions">
        <label className="component-search">
          <Search size={14} />
          <input
            placeholder={`搜索${tab === "parts" ? "零件" : "板材"}`}
            aria-label={`搜索${tab === "parts" ? "零件" : "板材"}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          data-tooltip={`新增${tab === "parts" ? "零件" : "板材"}`}
          aria-label={`新增${tab === "parts" ? "零件" : "板材"}`}
          onClick={() => open(tab === "parts" ? "part" : "stock")}
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="parts-list">
        {tab === "parts"
          ? items.map((p) => {
              const placed = layout?.placements.find((v) => v.partId === p.id);
              return (
                <button
                  draggable={!placed && s.view === "current"}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-wood-part", p.id);
                    e.dataTransfer.effectAllowed = "copy";
                    s.select(p.id);
                  }}
                  key={p.id}
                  className={`part-row ${s.selected === p.id ? "selected" : ""}`}
                  onClick={() => {
                    s.select(p.id);
                    onSelect();
                  }}
                >
                  <span className="thumbnail">
                    <Thumbnail part={p} />
                  </span>
                  <span className="part-row-copy">
                    <strong data-tooltip-overflow={p.name}>{p.name}</strong>
                    <span data-tooltip-overflow="">
                      {p.width.toFixed(1)} × {p.height.toFixed(1)} mm
                    </span>
                    <small data-tooltip-overflow="">
                      {p.thickness || "待填"} mm ·{" "}
                      {placed
                        ? project?.sheets.find((v) => v.id === placed.sheetId)
                            ?.name
                        : "待放置"}
                    </small>
                  </span>
                  {!placed && <span className="pending-dot" data-tooltip="待放置" />}
                </button>
              );
            })
          : stocks.map((v) => {
              const count =
                layout?.placements.filter((p) => p.sheetId === v.id).length ??
                0;
              return (
                <section className="resource-stock" key={v.id}>
                  <strong data-tooltip-overflow={v.name}>{v.name}</strong>
                  <span>
                    {v.width} × {v.height} mm
                  </span>
                  <small data-tooltip-overflow="">
                    {v.thickness} mm · {v.material} · {count} 个零件
                  </small>
                  <div>
                    <button
                      disabled={s.view !== "current"}
                      onClick={() => open("stock-edit", v.id)}
                    >
                      设置
                    </button>
                    <button
                      aria-label={`删除 ${v.name}`}
                      data-tooltip={s.view !== "current" ? "当前视图只读，切换当前排版后编辑" : count ? "先移走零件后才能删除板材" : "删除空板材，可撤销"}
                      disabled={count > 0 || s.view !== "current"}
                      onClick={() => s.removeStock(v.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </section>
              );
            })}
        {!(tab === "parts" ? items.length : stocks.length) && (
          <div className="resource-empty">
            <p>
              {query
                ? "没有匹配的资源"
                : tab === "parts"
                  ? "导入零件轮廓或新增零件"
                  : "先新增板材，再放置零件"}
            </p>
            <button onClick={() => open(tab === "parts" ? "import" : "stock")}>
              {tab === "parts" ? "导入整板 / 零件" : "新增板材"}
            </button>
          </div>
        )}
      </div>
      <div className="panel-foot">
        {tab === "parts"
          ? `已放置 ${layout?.placements.length ?? 0} / ${project?.parts.length ?? 0} · 待放置 ${(project?.parts.length ?? 0) - (layout?.placements.length ?? 0)}`
          : `库存 ${project?.sheets.length ?? 0} 张 · 空板可删除`}
        <span>
          {s.view !== "current"
            ? "当前视图只读"
            : "拖动待放置零件到板材，或点选后放置"}
        </span>
      </div>
    </aside>
  );
}
