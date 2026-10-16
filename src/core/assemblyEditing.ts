import type { Assembly } from "./assemblyTypes";
import type { Project } from "./types";
import type { Shortcut } from "./keyboardShortcuts";

/** Keyboard edits affect the selected instance; inventory and declared fits remain intact. */
export function assemblyShortcut(assembly: Assembly, selected: string | null, command: Shortcut): Assembly | null {
  const item = assembly.items.find(item => item.partId === selected);
  if (!item) return null;
  if (command.type === "remove") return { ...assembly, items: assembly.items.filter(item => item.partId !== selected) };
  let next = item;
  if (command.type === "lock") next = { ...item, locked: !item.locked };
  else if (item.locked) return null;
  else if (command.type === "nudge") next = { ...item, position: { ...item.position, [command.axis]: item.position[command.axis] + command.amount } };
  else if (command.type === "rotate") {
    const s = Math.sin(command.degrees * Math.PI / 360), w = Math.SQRT1_2;
    const x = command.axis === "x" ? s : 0, y = command.axis === "y" ? s : 0, z = command.axis === "z" ? s : 0;
    const q = item.rotation;
    next = { ...item, rotation: {
      x: w * q.x + x * q.w + y * q.z - z * q.y,
      y: w * q.y - x * q.z + y * q.w + z * q.x,
      z: w * q.z + x * q.y - y * q.x + z * q.w,
      w: w * q.w - x * q.x - y * q.y - z * q.z,
    } };
  } else return null;
  return { ...assembly, items: assembly.items.map(value => value === item ? next : value) };
}
const finiteVector = (v: { x: number; y: number; z: number }) =>
  [v.x, v.y, v.z].every(Number.isFinite);
/** Validate user input before an undoable transaction; physical interference is saved for correction. */
export function validateAssemblyEdit(
  project: Project,
  assembly: Assembly,
): string | null {
  const available = new Set(project.parts.map((p) => p.id));
  const added = new Set<string>();
  for (const item of assembly.items) {
    if (!available.has(item.partId) || added.has(item.partId))
      return "装配中存在重复或不可用的零件";
    added.add(item.partId);
    if (
      !finiteVector(item.position) ||
      !finiteVector(item.rotation) ||
      !Number.isFinite(item.rotation.w) ||
      Math.abs(
        Math.hypot(
          item.rotation.x,
          item.rotation.y,
          item.rotation.z,
          item.rotation.w,
        ) - 1,
      ) > 1e-6
    )
      return "位置和旋转需为有效有限数值";
    const previous = project.assembly?.items.find(
      (p) => p.partId === item.partId,
    );
    if (
      previous?.locked &&
      item.locked &&
      (JSON.stringify(previous.position) !== JSON.stringify(item.position) ||
        JSON.stringify(previous.rotation) !== JSON.stringify(item.rotation))
    )
      return "请先解除装配锁定再移动零件";
  }
  if (
    !Number.isFinite(assembly.targets.tolerance) ||
    assembly.targets.tolerance < 0 ||
    [
      assembly.targets.width,
      assembly.targets.depth,
      assembly.targets.height,
    ].some((v) => v !== undefined && (!Number.isFinite(v) || v <= 0))
  )
    return "目标尺寸需大于 0，允许偏差不能为负数";
  if (
    new Set(assembly.sparePartIds).size !== assembly.sparePartIds.length ||
    assembly.sparePartIds.some((id) => !available.has(id) || added.has(id))
  )
    return "备用件必须是尚未加入装配的可用零件";
  const fitIds = new Set<string>();
  for (const fit of assembly.fits) {
    if (
      fitIds.has(fit.id) ||
      !fit.id ||
      fit.partId === fit.receiverId ||
      !Number.isInteger(fit.feature.index) ||
      fit.feature.index < 0 ||
      !Number.isInteger(fit.maleEdge) ||
      fit.maleEdge < 0 ||
      ![fit.insertionDepth, fit.minClearance, fit.maxClearance].every(
        Number.isFinite,
      ) ||
      fit.insertionDepth <= 0 ||
      fit.maxClearance < fit.minClearance
    )
      return "请填写有效的配合位置、插入深度和间隙范围";
    fitIds.add(fit.id);
  }
  const steps = new Set<string>();
  for (const step of assembly.steps) {
    if (
      steps.has(step.partId) ||
      !finiteVector(step.direction) ||
      Math.hypot(step.direction.x, step.direction.y, step.direction.z) < 1e-8 ||
      !Number.isFinite(step.distance) ||
      step.distance <= 0
    )
      return "安装步骤需使用唯一零件、非零方向和正行程";
    steps.add(step.partId);
  }
  for (const [partId, config] of Object.entries(assembly.pocketFaces)) {
    if (
      !available.has(partId) ||
      !config.signature ||
      Object.values(config.faces).some(
        (face) => face !== "front" && face !== "back",
      )
    )
      return "请确认零件槽的加工面";
  }
  return null;
}
/** Keep diagnostics for references made stale by deletion; instances never outlive inventory. */
export function reconcileAssembly(project: Project): Project {
  if (!project.assembly) return project;
  const available = new Set(project.parts.map((p) => p.id));
  return {
    ...project,
    assembly: {
      ...project.assembly,
      items: project.assembly.items.filter((i) => available.has(i.partId)),
      sparePartIds: project.assembly.sparePartIds.filter((id) =>
        available.has(id),
      ),
      pocketFaces: Object.fromEntries(
        Object.entries(project.assembly.pocketFaces).filter(([id]) =>
          available.has(id),
        ),
      ),
    },
  };
}
