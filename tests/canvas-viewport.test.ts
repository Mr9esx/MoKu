import { describe, expect, it } from "vitest";
import { fitCanvasViewport, zoomCanvasViewport } from "../src/core/canvasViewport";

describe("full canvas fitting", () => {
  it("keeps the viewport full size while fitting content between floating panels", () => {
    const fit = fitCanvasViewport(
      { width: 1000, height: 500 },
      { width: 1600, height: 900 },
      { left: 280, right: 320, top: 80, bottom: 80 },
    );
    expect(fit).toEqual({ x: -280, y: -200, width: 1600, height: 900 });
  });
  it("fits tall content below mobile tools with no side rails", () => {
    const fit = fitCanvasViewport(
      { width: 800, height: 1600 },
      { width: 400, height: 800 },
      { left: 20, right: 20, top: 140, bottom: 100 },
    );
    expect(fit.x).toBeCloseTo(-171.428571);
    expect(fit.y).toBeCloseTo(-400);
    expect(fit.width).toBeCloseTo(1142.857143);
    expect(fit.height).toBeCloseTo(2285.714286);
  });
  it("fits every sheet after the available viewport narrows", () => {
    const fit = fitCanvasViewport(
      { width: 1000, height: 500 },
      { width: 900, height: 900 },
      { left: 280, right: 320, top: 80, bottom: 80 },
    );
    expect(fit.x).toBeCloseTo(-933.333333);
    expect(fit.width).toBeCloseTo(3000);
    expect(fit.y).toBeCloseTo(-1250);
    expect(fit.height).toBeCloseTo(3000);
  });
});

describe("pointer-anchored preview zoom", () => {
  const view = { x: -100, y: 50, width: 800, height: 400 };
  const limits = { minWidth: 100, maxWidth: 1600 };
  it("keeps the drawing point under the pointer when zooming in", () => {
    expect(zoomCanvasViewport(view, { x: 100, y: 150 }, 2, limits))
      .toEqual({ x: 0, y: 100, width: 400, height: 200 });
  });
  it("stops at the close-up limit without shifting the anchor or distorting the drawing", () => {
    expect(zoomCanvasViewport(view, { x: 100, y: 150 }, 1000, limits))
      .toEqual({ x: 75, y: 137.5, width: 100, height: 50 });
  });
  it("keeps a recoverable overview when zooming out repeatedly", () => {
    expect(zoomCanvasViewport(view, { x: 100, y: 150 }, 0.001, limits))
      .toEqual({ x: -300, y: -50, width: 1600, height: 800 });
  });
});
