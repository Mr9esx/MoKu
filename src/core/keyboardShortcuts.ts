import type { workbench } from "../store";

export type WorkspaceMode = "drawing" | "assembly";
export type ViewShortcut = "all" | "selected" | "zoom-in" | "zoom-out" | "front" | "side" | "top" | "iso";
export type Shortcut =
  | { type: "undo" | "help" | "import" | "export" | "escape" | "remove" | "duplicate" | "lock" | "magnet" | "xray" | "explode" }
  | { type: "workspace"; workspace: WorkspaceMode }
  | { type: "tool"; tool: "select" | "hand" }
  | { type: "view"; view: ViewShortcut }
  | { type: "nudge"; axis: "x" | "y" | "z"; amount: number }
  | { type: "rotate"; axis: "x" | "y" | "z"; degrees: 90 | -90 };
export type ShortcutEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "isComposing" | "defaultPrevented" | "target"> & { keyCode?: number };

export function keyboardShortcut(event: ShortcutEvent, mode: WorkspaceMode): Shortcut | null {
  const target = event.target as Element | null;
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || target?.closest?.(
    'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="slider"],[role="spinbutton"]',
  )) return null;
  const key = event.key.toLowerCase();
  let command: Shortcut | null = null;
  if (event.altKey) {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && ["Digit2", "Digit3"].includes(event.code))
      command = { type: "workspace", workspace: event.code === "Digit2" ? "drawing" : "assembly" };
  } else if (event.ctrlKey || event.metaKey) {
    if (key === "z" && !event.shiftKey) command = { type: "undo" };
    if (key === "o" && !event.shiftKey) command = { type: "import" };
    if (key === "e" && event.shiftKey) command = { type: "export" };
    if (key === "d" && !event.shiftKey && mode === "drawing") command = { type: "duplicate" };
    if (key === "0" && !event.shiftKey) command = { type: "view", view: "all" };
  } else {
    const amount = event.shiftKey ? 10 : 1;
    if (key === "escape") command = { type: "escape" };
    else if (key === "?" || key === "f1") command = { type: "help" };
    else if (key === "delete" || key === "backspace") command = { type: "remove" };
    else if (key === "arrowleft" || key === "arrowright") command = { type: "nudge", axis: "x", amount: key === "arrowleft" ? -amount : amount };
    else if (key === "arrowup" || key === "arrowdown") command = { type: "nudge", axis: "y", amount: key === "arrowdown" ? -amount : amount };
    else if (key === "r" || mode === "assembly" && ["x", "y", "z"].includes(key)) command = { type: "rotate", axis: key === "r" ? "z" : key as "x" | "y" | "z", degrees: event.shiftKey ? -90 : 90 };
    else if (key === "l") command = { type: "lock" };
    else if (key === "m") command = { type: "magnet" };
    else if (key === "f") command = { type: "view", view: event.shiftKey ? "all" : "selected" };
    else if (key === "0") command = { type: "view", view: "all" };
    else if (key === "+" || key === "=") command = { type: "view", view: "zoom-in" };
    else if (key === "-" || key === "_") command = { type: "view", view: "zoom-out" };
    else if (mode === "drawing" && ["v", "h"].includes(key)) command = { type: "tool", tool: key === "v" ? "select" : "hand" };
    else if (mode === "assembly") {
      if (key === "pageup" || key === "pagedown") command = { type: "nudge", axis: "z", amount: key === "pageup" ? amount : -amount };
      else if (key === "t") command = { type: "xray" };
      else if (key === "b") command = { type: "explode" };
      else if (!event.shiftKey) {
        const view = ({ "1": "front", "3": "side", "7": "top", "9": "iso" } as const)[key as "1" | "3" | "7" | "9"];
        if (view) command = { type: "view", view };
      }
    }
  }
  if (event.repeat && command?.type !== "nudge" && !(command?.type === "view" && command.view.startsWith("zoom-"))) return null;
  return command;
}

/** Reuse store transactions: shortcut edits cannot bypass layout checks or read-only views. */
export function applyDrawingShortcut(state: ReturnType<typeof workbench.getState>, command: Shortcut): boolean {
  if (state.status === "searching" || state.importing) return false;
  if (command.type === "undo") { state.undo(); return true; }
  if (state.view !== "current" || !state.selected || !state.project) return false;
  const placement = state.current?.placements.find(p => p.partId === state.selected);
  if (command.type === "remove") return state.removePart(state.selected);
  if (command.type === "duplicate") return state.duplicatePart(state.selected, 1);
  if (!placement) return false;
  if (command.type === "lock") { state.toggleLock(state.selected); return true; }
  if (placement.locked) return false;
  if (command.type === "nudge" && command.axis !== "z")
    return state.movePart({ ...placement, [command.axis]: placement[command.axis] + command.amount });
  if (command.type === "rotate" && command.axis === "z" && state.settings.allowRotation)
    return state.movePart({ ...placement, rotation: ((placement.rotation + command.degrees + 360) % 360) as 0 | 90 | 180 | 270 });
  return false;
}
