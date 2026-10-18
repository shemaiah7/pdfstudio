import { describe, it, expect } from "vitest";
import { fitWidthScale } from "./fitScale";

describe("fitWidthScale", () => {
  it("fits a letter page into the area minus the gutter", () => expect(fitWidthScale(680, 612)).toBe(1.03));
  it("clamps low", () => expect(fitWidthScale(100, 612)).toBe(0.4));
  it("clamps high", () => expect(fitWidthScale(5000, 100)).toBe(3));
  it("returns null for zero width", () => { expect(fitWidthScale(0, 612)).toBeNull(); expect(fitWidthScale(680, 0)).toBeNull(); });
});
