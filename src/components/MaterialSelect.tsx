import type { ComponentProps } from "react";
import { useWorkbench } from "../store";

const materials = [
  "多层板",
  "实木",
  "密度板",
  "刨花板",
  "桦木",
  "松木",
  "杉木",
  "木材",
];

export function MaterialSelect({
  value,
  onChange,
  ...props
}: Omit<ComponentProps<"select">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  const { project } = useWorkbench();
  const options = [
    ...new Set([
      ...materials,
      ...(project?.sheets.map((v) => v.material) ?? []),
      ...(project?.parts.map((v) => v.material ?? "") ?? []),
      value,
    ]),
  ].filter((v) => v && v !== "其他" && v !== "未指定");
  return (
    <select {...props} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        请选择材质
      </option>
      {options.map((material) => (
        <option key={material} value={material}>
          {material}
        </option>
      ))}
      <option value="其他">其他</option>
    </select>
  );
}
