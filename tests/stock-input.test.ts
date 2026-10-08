import { describe, it, expect } from "vitest";
import { parseMillimetres } from "../src/core/stockInput";
describe("millimetre entry", () => {
  it.each([
    ["12.5", 12.5],
    ["１２．５", 12.5],
    [" 0012.50 ", 12.5],
    ["1.", 1],
    ["100", 100],
  ])("accepts %s as %s mm", (raw, expected) => {
    expect(parseMillimetres(raw, 1, 100)).toBe(expected);
  });
  it.each([
    "",
    " ",
    ".",
    "0",
    "100.01",
    "-12",
    "1e2",
    "12mm",
    "12,5",
    "Infinity",
  ])("rejects %s without silently replacing it", (raw) => {
    expect(parseMillimetres(raw, 1, 100)).toBeUndefined();
  });
  it("keeps decimal precision and validates stock size boundaries", () => {
    expect(parseMillimetres("1220.125", 100, 10000)).toBe(1220.125);
    expect(parseMillimetres("99.999", 100, 10000)).toBeUndefined();
    expect(parseMillimetres("10000.001", 100, 10000)).toBeUndefined();
  });
});
