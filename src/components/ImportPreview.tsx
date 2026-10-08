import { useEffect, useRef, useState } from "react";
import { useWorkbench } from "../store";
import { cancelImportDrawing, importDrawing } from "../import";
import { confirmMetadata, type ImportTarget } from "../core/importTransaction";
import type { ImportOptions } from "../core/dxf";
export function ImportPreview({
  close,
  sample = false,
}: {
  close: () => void;
  sample?: boolean;
}) {
  const s = useWorkbench(),
    input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"board" | "parts">("board"),
    [file, setFile] = useState<File>(),
    [unit, setUnit] = useState<ImportOptions["unit"]>(),
    [thickness, setThickness] = useState(""),
    [material, setMaterial] = useState(""),
    [quantity, setQuantity] = useState(1),
    [target, setTarget] = useState<ImportTarget>(sample ? "new" : "append"),
    [stocks, setStocks] = useState<
      Record<string, { thickness: number; material: string }>
    >({}),
    [error, setError] = useState("");
  useEffect(() => {
    if (sample) void importDrawing();
    return () => cancelImportDrawing();
  }, []);
  useEffect(() => {
    setStocks(
      Object.fromEntries(
        (s.draft?.sheets ?? []).map((v) => [
          v.id,
          {
            thickness: v.thickness,
            material: v.material === "未指定" ? "" : v.material,
          },
        ]),
      ),
    );
    setError("");
  }, [s.draft]);
  const parse = (
    chosen: File | undefined,
    nextMode: "board" | "parts",
    nextUnit: ImportOptions["unit"],
  ) => {
    setError("");
    void importDrawing(chosen, { mode: nextMode, unit: nextUnit });
  };
  return (
    <div className="import-preview">
      <p>本地读取，图纸不会上传。先预览核对，再确认写入；取消保留当前工作。</p>
      {!sample && (
        <div className="import-modes">
          <button
            className={mode === "board" ? "active" : ""}
            onClick={() => {
              setMode("board");
              cancelImportDrawing();
              if (file) parse(file, "board", unit);
            }}
          >
            <strong>整板图纸</strong>
            <small>板框 + 已有排版，可包含多张板</small>
          </button>
          <button
            className={mode === "parts" ? "active" : ""}
            onClick={() => {
              setMode("parts");
              cancelImportDrawing();
              if (file) parse(file, "parts", unit);
            }}
          >
            <strong>零件轮廓</strong>
            <small>独立外轮廓和孔槽，加入待放置</small>
          </button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept=".dxf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setFile(f);
            parse(f, mode, unit);
          }
          e.target.value = "";
        }}
      />
      {!sample && (
        <button className="wide" onClick={() => input.current?.click()}>
          选择本地 DXF 文件{file ? ` · ${file.name}` : ""}
        </button>
      )}
      <label>
        原文件单位
        <select
          aria-label="原文件单位"
          value={unit ?? ""}
          onChange={(e) => {
            const next = e.target.value as ImportOptions["unit"];
            setUnit(next || undefined);
            if (file || sample) parse(file, mode, next || undefined);
          }}
        >
          <option value="">读取 DXF 声明（未知时必须选择）</option>
          <option value="mm">毫米 mm</option>
          <option value="cm">厘米 cm</option>
          <option value="m">米 m</option>
          <option value="inch">英寸 inch</option>
          <option value="foot">英尺 foot</option>
        </select>
      </label>
      {s.importing && (
        <div role="status">
          正在解析…<button onClick={cancelImportDrawing}>取消解析</button>
        </div>
      )}
      {s.importMessage && (
        <p className="warning" role="alert">
          {s.importMessage}。请修正文件或单位后重新选择。
        </p>
      )}
      {s.draft && (
        <>
          <div className="import-result">
            <strong>{s.draft.name}</strong>
            <p>
              已识别 {s.draft.sheets.length} 张板材 · {s.draft.parts.length}{" "}
              个零件 · {s.draft.parts.reduce((n, p) => n + p.holes.length, 0)}{" "}
              个通孔 · {s.draft.parts.reduce((n, p) => n + p.pockets.length, 0)}{" "}
              个铣槽
            </p>
            <small>全部尺寸已转换为毫米；没有静默排除的轮廓。</small>
            <div className="preview-dimensions">
              {s.draft.parts.map((p) => (
                <span key={p.id}>
                  {p.name}：{p.width.toFixed(1)} × {p.height.toFixed(1)} mm
                </span>
              ))}
            </div>
          </div>
          {s.draft.warnings.map((w, i) => (
            <p className="warning" key={i}>
              {w}
            </p>
          ))}
          {mode === "parts" ? (
            <>
              <div className="form-grid">
                <label>
                  零件板厚 · mm
                  <input
                    aria-label="零件板厚"
                    type="number"
                    min={1}
                    max={100}
                    value={thickness}
                    placeholder="必填"
                    onChange={(e) => setThickness(e.target.value)}
                  />
                </label>
                <label>
                  数量（每种轮廓）
                  <input
                    aria-label="导入数量"
                    type="number"
                    min={1}
                    max={100}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.valueAsNumber)}
                  />
                </label>
              </div>
              <label>
                材质
                <input
                  aria-label="零件材质"
                  value={material}
                  placeholder="例如：桦木多层板"
                  onChange={(e) => setMaterial(e.target.value)}
                />
              </label>
              <p className="hint">
                确认后加入待放置，不新增板材。请拖入兼容板材或自动排版。
              </p>
            </>
          ) : (
            <div className="stock-list">
              {s.draft.sheets.map((v) => (
                <section className="import-stock" key={v.id}>
                  <strong>
                    {v.name} · {v.width} × {v.height} mm
                  </strong>
                  <div className="form-grid">
                    <label>
                      板厚 · mm
                      <input
                        aria-label={`${v.name} 导入板厚`}
                        type="number"
                        min={1}
                        max={100}
                        value={stocks[v.id]?.thickness || ""}
                        onChange={(e) =>
                          setStocks({
                            ...stocks,
                            [v.id]: {
                              ...stocks[v.id],
                              thickness: e.target.valueAsNumber,
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      材质
                      <input
                        aria-label={`${v.name} 导入材质`}
                        value={stocks[v.id]?.material ?? ""}
                        placeholder="必填"
                        onChange={(e) =>
                          setStocks({
                            ...stocks,
                            [v.id]: {
                              ...stocks[v.id],
                              material: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                </section>
              ))}
            </div>
          )}
          {s.project && (
            <label>
              导入方式
              <select
                aria-label="导入方式"
                value={target}
                onChange={(e) => setTarget(e.target.value as ImportTarget)}
              >
                <option value="append">追加到当前项目（保留现有编辑）</option>
                <option value="new">
                  打开为新项目（替换工作区，可撤销恢复）
                </option>
              </select>
            </label>
          )}
          {s.project && target === "new" && (
            <p className="warning">
              确认后替换当前工作区；可撤销恢复上一项目。本页尚未提供持久化保存，刷新会丢失工作。
            </p>
          )}
          <button
            className="primary wide"
            disabled={s.importing}
            onClick={() => {
              try {
                const draft = confirmMetadata(s.draft!, {
                  thickness: Number(thickness),
                  material,
                  quantity,
                  stocks,
                });
                s.confirmImport(draft, s.project ? target : "new");
                close();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            确认{mode === "parts" ? "导入待放置零件" : "导入整板图纸"}
          </button>
        </>
      )}
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
      <p className="hint">
        支持二维闭合多段线、圆和闭合 LINE/ARC 链。内部加工轮廓需注明 HOLE 或
        POCKET_DEPTH数值；不明确的轮廓需修正后重试。
      </p>
    </div>
  );
}
