import type { ComponentProps } from "react";
import { Select } from "./Select";
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
}: Omit<ComponentProps<typeof Select>, "value" | "onChange" | "options"> & {
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
  return <Select {...props} value={value} onChange={onChange} options={[
    { value: "", label: "请选择材质", disabled: true },
    ...options.map(material => ({ value: material, label: material })),
    { value: "其他", label: "其他" },
  ]} />;
}
