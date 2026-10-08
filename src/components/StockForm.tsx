import { useId, useRef, useState } from "react";
import type { Stock } from "../core/types";
import { parseMillimetres } from "../core/stockInput";
import { useWorkbench } from "../store";

type Field = "name" | "width" | "height" | "thickness" | "material";
type Draft = Record<Field, string>;

export function StockForm({
  stock,
  editing,
  close,
}: {
  stock?: Stock;
  editing: boolean;
  close: () => void;
}) {
  const s = useWorkbench(),
    id = useId(),
    form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<Draft>(() => ({
    name: stock?.name ?? "新板材",
    width: String(stock?.width ?? 1220),
    height: String(stock?.height ?? 2440),
    thickness: String(stock?.thickness ?? 12),
    material: stock?.material ?? s.project?.sheets[0]?.material ?? "木材",
  }));
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false),
    [saveError, setSaveError] = useState("");
  const width = parseMillimetres(draft.width, 100, 10000),
    height = parseMillimetres(draft.height, 100, 10000);
  const thickness = parseMillimetres(draft.thickness, 1, 100);
  const errors: Partial<Record<Field, string>> = {};
  if (!draft.name.trim()) errors.name = "请填写板材名称";
  if (width === undefined) errors.width = "宽度需为 100–10000 mm";
  if (height === undefined) errors.height = "高度需为 100–10000 mm";
  if (thickness === undefined) errors.thickness = "板厚需为 1–100 mm";
  if (!draft.material.trim()) errors.material = "请填写材质";
  const count =
    s.current?.placements.filter((v) => v.sheetId === stock?.id).length ?? 0;
  const changed =
    !!stock &&
    (thickness !== stock.thickness || draft.material.trim() !== stock.material);
  const fields: Field[] = editing
    ? ["thickness", "material"]
    : ["name", "width", "height", "thickness", "material"];
  const change = (field: Field, value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    setSaveError("");
  };
  const field = (
    key: Field,
    label: string,
    numeric = false,
    autofocus = false,
  ) => {
    const error = submitted || touched[key] ? errors[key] : undefined;
    return (
      <label className="stock-field" htmlFor={`${id}-${key}`}>
        <span>{label}</span>
        <div className={numeric ? "input-unit" : undefined}>
          <input
            id={`${id}-${key}`}
            name={key}
            type="text"
            data-autofocus={autofocus || undefined}
            inputMode={numeric ? "decimal" : "text"}
            autoComplete="off"
            maxLength={numeric ? 20 : 80}
            list={key === "material" ? `${id}-materials` : undefined}
            value={draft[key]}
            aria-label={label}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-${key}-error` : undefined}
            placeholder={
              numeric
                ? key === "thickness"
                  ? "1–100"
                  : "100–10000"
                : undefined
            }
            onChange={(e) => change(key, e.target.value)}
            onFocus={numeric ? (e) => e.currentTarget.select() : undefined}
            onBlur={() => {
              setTouched((t) => ({ ...t, [key]: true }));
              if (numeric) {
                const value = parseMillimetres(
                  draft[key],
                  key === "thickness" ? 1 : 100,
                  key === "thickness" ? 100 : 10000,
                );
                if (value !== undefined) change(key, String(value));
              } else change(key, draft[key].trim());
            }}
          />
          {numeric && <span>mm</span>}
        </div>
        {error && (
          <span className="field-error" id={`${id}-${key}-error`}>
            {error}
          </span>
        )}
      </label>
    );
  };
  if (editing && !stock)
    return (
      <div className="stock-form-body">
        <p role="alert">板材已不存在，请关闭后重新选择。</p>
        <button onClick={close}>关闭</button>
      </div>
    );
  return (
    <form
      ref={form}
      className="stock-form"
      noValidate
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        setSubmitted(true);
        const firstError = fields.find((key) => errors[key]);
        if (firstError) {
          form.current
            ?.querySelector<HTMLInputElement>(`[name="${firstError}"]`)
            ?.focus();
          return;
        }
        if (editing && !changed) return;
        const ok = editing
          ? s.updateStock(stock!.id, {
              thickness: thickness!,
              material: draft.material.trim(),
            })
          : s.addStock({
              name: draft.name.trim(),
              width: width!,
              height: height!,
              thickness: thickness!,
              material: draft.material.trim(),
            });
        if (ok) close();
        else
          setSaveError(
            editing
              ? "无法保存，请关闭后重新选择板材。"
              : "无法新增板材，请检查填写的参数。",
          );
      }}
    >
      <div className="stock-form-body">
        {editing ? (
          <div className="stock-summary">
            <span>
              {stock!.width} × {stock!.height} mm
            </span>
            <span>已放置 {count} 个零件</span>
          </div>
        ) : (
          <p className="stock-intro">新增一张空板材，用于放置零件。</p>
        )}
        {!editing && field("name", "名称", false, true)}
        {!editing && (
          <div className="stock-size-grid">
            {field("width", "宽度", true)}
            {field("height", "高度", true)}
          </div>
        )}
        <div className="stock-property-grid">
          {field("thickness", "板厚", true, editing)}
          {field("material", "材质")}
        </div>
        <datalist id={`${id}-materials`}>
          {[...new Set(s.project?.sheets.map((v) => v.material) ?? [])].map(
            (material) => (
              <option key={material} value={material} />
            ),
          )}
        </datalist>
        {editing &&
          changed &&
          thickness !== undefined &&
          draft.material.trim() &&
          count > 0 && (
            <p className="stock-impact" role="status">
              保存后，同时更新本板上的 {count} 个零件。
            </p>
          )}
        {saveError && (
          <p className="field-error" role="alert">
            {saveError}
          </p>
        )}
      </div>
      <div className="stock-form-footer">
        <button type="button" onClick={close}>
          取消
        </button>
        <button
          type="submit"
          className="primary"
          disabled={editing && !changed}
        >
          {editing ? "保存" : "新增板材"}
        </button>
      </div>
    </form>
  );
}
