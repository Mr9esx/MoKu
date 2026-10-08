import { Lock, Unlock } from "lucide-react";
import { useWorkbench } from "../store";
export function PartInspector() {
  const s = useWorkbench(),
    part = s.project?.parts.find((p) => p.id === s.selected),
    placement = s.current?.placements.find((p) => p.partId === s.selected);
  return (
    <section className="inspector">
      <div className="section-title">
        <span>01 / 零件信息</span>
        <small>{part ? "当前选中" : "点击图纸中的零件"}</small>
      </div>
      {part ? (
        <>
          <div className="part-heading">
            <h2>{part.name}</h2>
            <button
              onClick={() => s.toggleLock(part.id)}
              aria-label={placement?.locked ? "解锁零件" : "锁定零件"}
            >
              {placement?.locked ? <Lock size={16} /> : <Unlock size={16} />}
              {placement?.locked ? "已锁定" : "锁定位置"}
            </button>
          </div>
          <div className="part-dimensions">
            {Math.round(part.width)} <span>×</span> {Math.round(part.height)}{" "}
            <small>mm</small>
          </div>
          <dl>
            <div>
              <dt>板厚</dt>
              <dd>{part.thickness} mm</dd>
            </div>
            <div>
              <dt>通孔</dt>
              <dd>{part.holes.length} 处</dd>
            </div>
            <div>
              <dt>铣槽</dt>
              <dd>
                {part.pockets.length} 处
                {part.pockets.length
                  ? ` / 深 ${[...new Set(part.pockets.map((p) => p.depth))].join("、")} mm`
                  : ""}
              </dd>
            </div>
            <div>
              <dt>旋转</dt>
              <dd>{placement?.rotation ?? 0}°</dd>
            </div>
          </dl>
          <p className="hint">锁定后保留当前板材、位置与角度。</p>
        </>
      ) : (
        <div className="empty-inspector">
          <span>↖</span>
          <p>
            从轮廓开始，
            <br />
            查看每一块零件。
          </p>
        </div>
      )}
      <div className="stock-controls">
        <h3>
          板材厚度 <small>/ mm</small>
        </h3>
        {s.project?.sheets.map((sheet, i) => (
          <label key={sheet.id}>
            <span>
              板材 {String(i + 1).padStart(2, "0")}
              <small>
                {sheet.width} × {sheet.height}
              </small>
            </span>
            <input
              aria-label={`板材 ${i + 1} 厚度`}
              type="number"
              min="1"
              max="100"
              value={sheet.thickness}
              onChange={(e) => s.setThickness(sheet.id, e.target.valueAsNumber)}
            />
          </label>
        ))}
      </div>
    </section>
  );
}
