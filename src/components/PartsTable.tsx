import { useWorkbench } from "../store";
export function PartsTable() {
  const s = useWorkbench();
  return (
    <section className="parts-table">
      <div className="section-title">
        <span>03 / 零件清单</span>
        <small>{s.project?.parts.length ?? 0} 件 · 可用键盘选择</small>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>板材</th>
              <th>尺寸 / mm</th>
              <th>板厚</th>
              <th>孔 / 槽</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {s.project?.parts.map((p) => (
              <tr key={p.id} className={s.selected === p.id ? "selected" : ""}>
                <td>
                  <button onClick={() => s.select(p.id)}>{p.name}</button>
                </td>
                <td>
                  {s.project!.sheets.findIndex((v) => v.id === p.stockId) + 1}
                </td>
                <td>
                  {Math.round(p.width)} × {Math.round(p.height)}
                </td>
                <td>{p.thickness} mm</td>
                <td>
                  {p.holes.length} / {p.pockets.length}
                </td>
                <td>
                  {s.current?.placements.find((v) => v.partId === p.id)?.locked
                    ? "锁定"
                    : "自由"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
