import { describe, expect, it } from "vitest";
import { fitCanvasViewport } from "../src/core/canvasViewport";

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
