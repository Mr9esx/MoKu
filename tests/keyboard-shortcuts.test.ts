import { describe, expect, it } from "vitest";
import { keyboardShortcut, applyDrawingShortcut, type ShortcutEvent } from "../src/core/keyboardShortcuts";
import { assemblyShortcut } from "../src/core/assemblyEditing";
import { createWorkbenchStore } from "../src/store";
import { createAssemblyDemo } from "../src/core/assemblyDemo";
import { Quaternion, Vector3 } from "three";

const key = (key: string, extra: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key, code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false, defaultPrevented: false, target: null, ...extra,
});

describe("workspace shortcut decoding", () => {
  it.each(["drawing", "assembly"] as const)("shares predictable commands in %s", mode => {
    expect(keyboardShortcut(key("z", { metaKey: true }), mode)).toEqual({ type: "undo" });
    expect(keyboardShortcut(key("z", { ctrlKey: true }), mode)).toEqual({ type: "undo" });
    expect(keyboardShortcut(key("F"), mode)).toEqual({ type: "view", view: "selected" });
    expect(keyboardShortcut(key("F", { shiftKey: true }), mode)).toEqual({ type: "view", view: "all" });
    expect(keyboardShortcut(key("0", { ctrlKey: true }), mode)).toEqual({ type: "view", view: "all" });
    expect(keyboardShortcut(key("+", { shiftKey: true }), mode)).toEqual({ type: "view", view: "zoom-in" });
    expect(keyboardShortcut(key("ArrowUp", { shiftKey: true }), mode)).toEqual({ type: "nudge", axis: "y", amount: 10 });
    expect(keyboardShortcut(key("R", { shiftKey: true }), mode)).toEqual({ type: "rotate", axis: "z", degrees: -90 });
    expect(keyboardShortcut(key("Delete"), mode)).toEqual({ type: "remove" });
    expect(keyboardShortcut(key("?", { shiftKey: true }), mode)).toEqual({ type: "help" });
    expect(keyboardShortcut(key("o", { metaKey: true }), mode)).toEqual({ type: "import" });
    expect(keyboardShortcut(key("E", { ctrlKey: true, shiftKey: true }), mode)).toEqual({ type: "export" });
  });

  it("uses physical digit codes for Option/Alt workspace switching on macOS", () => {
    expect(keyboardShortcut(key("™", { code: "Digit2", altKey: true }), "assembly")).toEqual({ type: "workspace", workspace: "drawing" });
    expect(keyboardShortcut(key("£", { code: "Digit3", altKey: true }), "drawing")).toEqual({ type: "workspace", workspace: "assembly" });
  });

  it("keeps the mode-specific commands separate", () => {
    expect(keyboardShortcut(key("d", { metaKey: true }), "drawing")).toEqual({ type: "duplicate" });
    expect(keyboardShortcut(key("d", { metaKey: true }), "assembly")).toBeNull();
    expect(keyboardShortcut(key("H"), "drawing")).toEqual({ type: "tool", tool: "hand" });
    expect(keyboardShortcut(key("X"), "assembly")).toEqual({ type: "rotate", axis: "x", degrees: 90 });
    expect(keyboardShortcut(key("PageDown"), "assembly")).toEqual({ type: "nudge", axis: "z", amount: -1 });
    expect(keyboardShortcut(key("7"), "assembly")).toEqual({ type: "view", view: "top" });
    expect(keyboardShortcut(key("7"), "drawing")).toBeNull();
    expect(keyboardShortcut(key("t"), "assembly")).toEqual({ type: "xray" });
  });

  it("leaves native editing, IME and unassigned modifier combinations alone", () => {
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { defaultPrevented: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(keyboardShortcut(key("r", extra), "assembly")).toBeNull();
    }
    expect(keyboardShortcut(key("z", { ctrlKey: true, shiftKey: true }), "drawing")).toBeNull();
    const input = { closest: () => ({}) } as unknown as EventTarget;
    expect(keyboardShortcut(key("Delete", { target: input }), "drawing")).toBeNull();
  });

  it("repeats precise movement and zoom, but not destructive or toggle operations", () => {
    expect(keyboardShortcut(key("ArrowRight", { repeat: true }), "assembly")).toEqual({ type: "nudge", axis: "x", amount: 1 });
    expect(keyboardShortcut(key("-", { repeat: true }), "drawing")).toEqual({ type: "view", view: "zoom-out" });
    for (const name of ["Delete", "r", "l", "m", "?"]) expect(keyboardShortcut(key(name, { repeat: true }), "assembly")).toBeNull();
  });
});

function drawing() {
  const store = createWorkbenchStore();
  store.getState().importProject({ name: "keys", units: "mm", parts: [], sheets: [], original: { sheets: [], placements: [] }, warnings: [] });
  store.getState().addStock({ name: "板", width: 500, height: 500, thickness: 12 });
  store.getState().addPart({ name: "件", shape: "rectangle", width: 50, height: 40, thickness: 12, place: true });
  const placement = store.getState().current!.placements[0];
  store.getState().movePart({ ...placement, x: 100, y: 100 });
  store.getState().select(placement.partId);
  store.setState({ history: [] });
  return { store, id: placement.partId };
}

describe("shortcuts use existing undoable editing checks", () => {
  it("nudges, rotates, locks and undoes the actual 2D layout", () => {
    const { store } = drawing();
    expect(applyDrawingShortcut(store.getState(), { type: "nudge", axis: "x", amount: 1 })).toBe(true);
    expect(store.getState().current!.placements[0].x).toBe(101);
    expect(applyDrawingShortcut(store.getState(), { type: "rotate", axis: "z", degrees: -90 })).toBe(true);
    expect(store.getState().current!.placements[0].rotation).toBe(270);
    applyDrawingShortcut(store.getState(), { type: "lock" });
    expect(applyDrawingShortcut(store.getState(), { type: "nudge", axis: "x", amount: 10 })).toBe(false);
    store.getState().undo(); store.getState().undo(); store.getState().undo();
    expect(store.getState().current!.placements[0]).toMatchObject({ x: 100, y: 100, rotation: 0 });
  });

  it("respects read-only views, search, rotation settings and invalid geometry", () => {
    const { store } = drawing();
    store.getState().setView("original");
    expect(applyDrawingShortcut(store.getState(), { type: "remove" })).toBe(false);
    store.getState().setView("current");
    store.getState().setSettings({ allowRotation: false });
    expect(applyDrawingShortcut(store.getState(), { type: "rotate", axis: "z", degrees: 90 })).toBe(false);
    expect(applyDrawingShortcut(store.getState(), { type: "nudge", axis: "x", amount: -1000 })).toBe(false);
    store.setState({ status: "searching" });
    expect(applyDrawingShortcut(store.getState(), { type: "duplicate" })).toBe(false);
    expect(store.getState().project!.parts).toHaveLength(1);
  });

  it("duplicates and deletes through the real store, each with one undo step", () => {
    const { store, id } = drawing();
    applyDrawingShortcut(store.getState(), { type: "duplicate" });
    expect(store.getState().project!.parts).toHaveLength(2);
    store.getState().undo(); store.getState().select(id);
    applyDrawingShortcut(store.getState(), { type: "remove" });
    expect(store.getState().project!.parts).toHaveLength(0);
    store.getState().undo();
    expect(store.getState().project!.parts).toHaveLength(1);
  });

  it("moves and rotates a 3D instance in world coordinates while preserving locks", () => {
    const assembly = createAssemblyDemo().assembly!, id = assembly.items[1].partId;
    const nudged = assemblyShortcut(assembly, id, { type: "nudge", axis: "z", amount: 10 })!;
    expect(nudged.items[1].position.z).toBe(16);
    expect(assembly.items[1].position.z).toBe(6);
    const rotated = assemblyShortcut(nudged, id, { type: "rotate", axis: "x", degrees: 90 })!;
    const original = assembly.items[1].rotation;
    const expected = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2).multiply(new Quaternion(original.x, original.y, original.z, original.w));
    const actual = rotated.items[1].rotation;
    expect(new Quaternion(actual.x, actual.y, actual.z, actual.w).angleTo(expected)).toBeCloseTo(0);
    const locked = assemblyShortcut(rotated, id, { type: "lock" })!;
    expect(assemblyShortcut(locked, id, { type: "rotate", axis: "y", degrees: -90 })).toBeNull();
    expect(assemblyShortcut(locked, id, { type: "nudge", axis: "x", amount: 1 })).toBeNull();
    const removed = assemblyShortcut(assembly, id, { type: "remove" })!;
    expect(removed.items).toHaveLength(1);
    expect(assembly.items).toHaveLength(2);
    expect(assemblyShortcut(assembly, "missing", { type: "lock" })).toBeNull();
  });
});
