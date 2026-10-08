import { describe, it, expect } from "vitest";
import { createWorkbenchStore } from "../src/store";

function inventory() {
  const store = createWorkbenchStore();
  store.getState().addStock({
    name: "A",
    width: 1220,
    height: 2440,
    thickness: 12,
    material: "桦木",
  });
  store.getState().addStock({
    name: "B",
    width: 1220,
    height: 2440,
    thickness: 12,
    material: "桦木",
  });
  store.getState().addPart({
    name: "面板",
    shape: "rectangle",
    width: 200,
    height: 100,
    thickness: 12,
    material: "桦木",
    place: true,
  });
  store.getState().addPart({
    name: "待放置",
    shape: "rectangle",
    width: 100,
    height: 100,
    thickness: 12,
    material: "桦木",
    place: false,
  });
  store
    .getState()
    .addPart({
      name: "另一板",
      shape: "rectangle",
      width: 100,
      height: 100,
      thickness: 12,
      material: "桦木",
      place: false,
    });
  const project = store.getState().project!;
  store.getState().placePart(project.parts[2].id, project.sheets[1].id);
  store.setState({ history: [] });
  return store;
}

describe("save stock settings", () => {
  it("saves thickness and material together and restores both with one undo", () => {
    const store = inventory(),
      before = structuredClone(store.getState().project);
    const id = before!.sheets[0].id;
    expect(
      store.getState().updateStock(id, { thickness: 18.5, material: " 松木 " }),
    ).toBe(true);
    const saved = store.getState();
    expect(saved.project!.sheets[0]).toMatchObject({
      thickness: 18.5,
      material: "松木",
    });
    expect(saved.current!.sheets[0]).toMatchObject({
      thickness: 18.5,
      material: "松木",
    });
    expect(saved.project!.parts[0]).toMatchObject({
      thickness: 18.5,
      material: "松木",
    });
    expect(saved.project!.parts[1]).toMatchObject({
      thickness: 12,
      material: "桦木",
    });
    expect(saved.project!.parts[2]).toMatchObject({
      thickness: 12,
      material: "桦木",
    });
    expect(saved.project!.sheets[1]).toMatchObject({
      thickness: 12,
      material: "桦木",
    });
    expect(saved.history).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().project).toEqual(before);
    expect(store.getState().history).toHaveLength(0);
  });
  it.each([NaN, 0, 100.1, Infinity])(
    "rejects thickness %s without changing material or undo history",
    (thickness) => {
      const store = inventory(),
        before = store.getState().project;
      expect(
        store
          .getState()
          .updateStock(before!.sheets[0].id, { thickness, material: "松木" }),
      ).toBe(false);
      expect(store.getState().project).toBe(before);
      expect(store.getState().history).toHaveLength(0);
    },
  );
  it("rejects empty material and missing board without changing inventory", () => {
    const store = inventory(),
      before = store.getState().project;
    expect(
      store
        .getState()
        .updateStock(before!.sheets[0].id, { thickness: 18, material: "  " }),
    ).toBe(false);
    expect(
      store
        .getState()
        .updateStock("missing", { thickness: 18, material: "松木" }),
    ).toBe(false);
    expect(store.getState().project).toBe(before);
    expect(store.getState().history).toHaveLength(0);
  });
  it("does not invalidate candidates or add history for unchanged values", () => {
    const store = inventory(),
      before = store.getState();
    expect(
      store.getState().updateStock(before.project!.sheets[0].id, {
        thickness: 12,
        material: " 桦木 ",
      }),
    ).toBe(true);
    expect(store.getState().project).toBe(before.project);
    expect(store.getState().run).toBe(before.run);
    expect(store.getState().history).toHaveLength(0);
  });
  it("preserves imported source and refuses edits from a read-only view", () => {
    const store = inventory();
    store.getState().importProject(structuredClone(store.getState().project!));
    const source = structuredClone(store.getState().source),
      id = source!.sheets[0].id;
    store.getState().setView("original");
    expect(
      store.getState().updateStock(id, { thickness: 18, material: "松木" }),
    ).toBe(false);
    store.getState().setView("current");
    expect(
      store.getState().updateStock(id, { thickness: 18, material: "松木" }),
    ).toBe(true);
    expect(store.getState().source).toEqual(source);
  });
});
