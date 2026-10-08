import { describe, expect, it } from "vitest";
import {
  findInitialPlacement,
  makePart,
  snapPlacement,
  settlePlacement,
} from "../src/core/editing";
import { validateLayout } from "../src/core/geometry";
import { createWorkbenchStore, defaults } from "../src/store";
import type { Placement, Project } from "../src/core/types";

function fixture(): Project {
  const stock = {
    id: "s",
    name: "板",
    width: 500,
    height: 500,
    thickness: 12,
    material: "木",
  };
  const parts = ["a", "b"].map((id) =>
    makePart(
      {
        name: id,
        shape: "rectangle",
        width: 50,
        height: 50,
        thickness: 12,
        material: "木",
      },
      id,
      "s",
    ),
  );
  return {
    name: "gap",
    units: "mm",
    sheets: [stock],
    parts,
    warnings: [],
    original: {
      sheets: [stock],
      placements: [
        { partId: "a", sheetId: "s", x: 100, y: 100, rotation: 0 },
        { partId: "b", sheetId: "s", x: 300, y: 300, rotation: 0 },
      ],
    },
  };
}
function raw(x: number, y: number): Placement {
  return { partId: "b", sheetId: "s", x, y, rotation: 0 };
}

describe("gap-aware snapping", () => {
  it.each([
    [150, 100, 153, 100],
    [50, 100, 47, 100],
    [100, 150, 100, 153],
    [100, 50, 100, 47],
  ])("snaps (%s,%s) with a 3 mm gap to (%s,%s)", (x, y, wantX, wantY) => {
    const project = fixture();
    const result = snapPlacement(
      project,
      project.original,
      raw(x, y),
      defaults,
      8,
      true,
    );
    expect(result.placement.x).toBe(wantX);
    expect(result.placement.y).toBe(wantY);
    expect(result.valid).toBe(true);
    expect(
      validateLayout(
        project,
        {
          ...project.original,
          placements: [project.original.placements[0], result.placement],
        },
        defaults,
      ),
    ).toEqual([]);
  });
  it.each([3, 8, 12])(
    "uses the configured %s mm gap instead of a touching edge",
    (gap) => {
      const project = fixture();
      expect(
        snapPlacement(
          project,
          project.original,
          raw(150, 100),
          { ...defaults, gap },
          16,
          true,
        ).placement.x,
      ).toBe(150 + gap);
    },
  );
  it("keeps legitimate edge alignment when the other axis supplies the gap", () => {
    const project = fixture();
    const result = snapPlacement(
      project,
      project.original,
      raw(102, 153),
      defaults,
      8,
      true,
    );
    expect(result.placement).toMatchObject({ x: 100, y: 153 });
    expect(result.valid).toBe(true);
  });
  it("does not combine individually tempting alignments into an illegal corner placement", () => {
    const project = fixture();
    const result = snapPlacement(
      project,
      project.original,
      raw(150, 150),
      defaults,
      8,
      true,
    );
    expect(result.valid).toBe(true);
    expect(
      validateLayout(
        project,
        {
          ...project.original,
          placements: [project.original.placements[0], result.placement],
        },
        defaults,
      ),
    ).toEqual([]);
  });
  it("marks an undersized slot invalid and does not publish alignment guides", () => {
    const project = fixture();
    project.parts.push({ ...project.parts[0], id: "c", name: "c" });
    project.original.placements.push({
      partId: "c",
      sheetId: "s",
      x: 200,
      y: 100,
      rotation: 0,
    });
    const result = snapPlacement(
      project,
      project.original,
      raw(150, 100),
      defaults,
      8,
      true,
    );
    expect(result.placement).toEqual(raw(150, 100));
    expect(result.valid).toBe(false);
    expect(result.guides).toEqual([]);
  });
  it("disabling magnet does not disable spacing validation", () => {
    const project = fixture();
    const result = snapPlacement(
      project,
      project.original,
      raw(150, 100),
      defaults,
      8,
      false,
    );
    expect(result.placement).toEqual(raw(150, 100));
    expect(result.valid).toBe(false);
    const store = createWorkbenchStore();
    store.getState().importProject(project);
    expect(store.getState().movePart(result.placement)).toBe(false);
    expect(store.getState().history).toHaveLength(0);
    expect(store.getState().current).toEqual(project.original);
  });
  it("initial placement and committed movement enforce the same configured gap", () => {
    const project = fixture(),
      settings = { ...defaults, gap: 8, margin: 100 };
    const layout = {
      ...project.original,
      placements: [project.original.placements[0]],
    };
    const position = findInitialPlacement(
      project,
      layout,
      project.parts[1],
      settings,
    );
    expect(position).toMatchObject({ x: 158, y: 100 });
    const store = createWorkbenchStore();
    store.getState().importProject(project);
    store.getState().setSettings({ gap: 8 });
    expect(store.getState().movePart(raw(150, 100))).toBe(false);
    expect(store.getState().movePart(raw(158, 100))).toBe(true);
  });
});

describe("release placement correction", () => {
  it("corrects beside a moved and locked neighbor without moving that neighbor", () => {
    const project = fixture();
    const layout = {
      ...project.original,
      placements: [
        { ...project.original.placements[0], x: 200, locked: true },
        project.original.placements[1],
      ],
    };
    expect(settlePlacement(project, layout, raw(249, 100), defaults)).toEqual(
      raw(253, 100),
    );
    expect(layout.placements[0]).toMatchObject({ x: 200, locked: true });
    expect(
      settlePlacement(
        project,
        layout,
        { ...layout.placements[0], x: 205 },
        defaults,
      ),
    ).toBeNull();
  });

  it.each([
    [150, 100, 170, 100],
    [50, 100, 30, 100],
    [100, 150, 100, 170],
    [100, 50, 100, 30],
  ])(
    "corrects touching (%s,%s) to (%s,%s), independent of the weak magnet radius",
    (x, y, wantX, wantY) => {
      const project = fixture(),
        settings = { ...defaults, gap: 20 };
      const result = settlePlacement(
        project,
        project.original,
        raw(x, y),
        settings,
      );
      expect(result).toMatchObject({ x: wantX, y: wantY });
      expect(
        validateLayout(
          project,
          {
            ...project.original,
            placements: [project.original.placements[0], result!],
          },
          settings,
        ),
      ).toEqual([]);
    },
  );
  it("slides a slight overlap to the nearest spaced edge with one undoable move", () => {
    const project = fixture(),
      settings = { ...defaults, gap: 8 };
    const result = settlePlacement(
      project,
      project.original,
      raw(145, 100),
      settings,
    );
    expect(result).toEqual(raw(158, 100));
    const store = createWorkbenchStore();
    store.getState().importProject(project);
    store.getState().setSettings({ gap: 8 });
    expect(store.getState().movePart(result!)).toBe(true);
    expect(store.getState().current?.placements[0]).toEqual(
      project.original.placements[0],
    );
    expect(store.getState().history).toHaveLength(1);
    store.getState().undo();
    expect(store.getState().current).toEqual(project.original);
  });
  it("leaves a free legal release position unchanged", () => {
    const project = fixture();
    expect(
      settlePlacement(project, project.original, raw(350.25, 201.75), defaults),
    ).toEqual(raw(350.25, 201.75));
  });
  it("moves out of an undersized slot without colliding with either neighbor", () => {
    const project = fixture();
    project.parts.push({ ...project.parts[0], id: "c", name: "c" });
    project.original.placements.push({
      partId: "c",
      sheetId: "s",
      x: 200,
      y: 100,
      rotation: 0,
    });
    const result = settlePlacement(
      project,
      project.original,
      raw(150, 100),
      defaults,
    );
    expect(result?.x).toBe(150);
    expect(Math.abs(result!.y - 100)).toBe(53);
    expect(
      validateLayout(
        project,
        {
          ...project.original,
          placements: project.original.placements.map((p) =>
            p.partId === "b" ? result! : p,
          ),
        },
        defaults,
      ),
    ).toEqual([]);
  });
  it("keeps the configured board margin automatically", () => {
    const project = fixture();
    expect(
      settlePlacement(project, project.original, raw(-5, 200), defaults),
    ).toEqual(raw(6, 200));
  });
  it("uses rotated outline bounds rather than the unrotated dimensions", () => {
    const project = fixture();
    project.parts[1] = makePart(
      {
        name: "b",
        shape: "rectangle",
        width: 100,
        height: 50,
        thickness: 12,
        material: "木",
      },
      "b",
      "s",
    );
    expect(
      settlePlacement(
        project,
        project.original,
        { ...raw(149, 100), rotation: 90 },
        { ...defaults, gap: 8 },
      ),
    ).toEqual({ ...raw(158, 100), rotation: 90 });
  });
  it("places a pending part using the same release correction", () => {
    const project = fixture();
    const layout = {
      ...project.original,
      placements: [project.original.placements[0]],
    };
    expect(settlePlacement(project, layout, raw(149, 100), defaults)).toEqual(
      raw(153, 100),
    );
  });
  it("returns no placement when the stock is full or incompatible", () => {
    const project = fixture();
    project.parts[0] = makePart(
      {
        name: "a",
        shape: "rectangle",
        width: 488,
        height: 488,
        thickness: 12,
        material: "木",
      },
      "a",
      "s",
    );
    project.original.placements[0] = {
      partId: "a",
      sheetId: "s",
      x: 6,
      y: 6,
      rotation: 0,
    };
    expect(
      settlePlacement(project, project.original, raw(145, 100), defaults),
    ).toBeNull();
    const other = fixture();
    other.parts[1].thickness = 5;
    expect(
      settlePlacement(other, other.original, raw(145, 100), defaults),
    ).toBeNull();
  });
});
