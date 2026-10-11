// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { whiteToTransparent, fitSignature, fitSignatureOnPage, scaledSize } from "./image";
describe("signature image", () => {
  it("makes near-white pixels transparent", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 240, 240, 240, 255, 10, 10, 10, 255]);
    const d = (typeof ImageData === "function" ? new ImageData(data, 3, 1) : { data, width: 3, height: 1 }) as ImageData;
    const out = whiteToTransparent(d);
    expect(Array.from(out.data)).toEqual([255, 255, 255, 0, 240, 240, 240, 0, 10, 10, 10, 255]);
  });
  it("sizes from the visual width on rotated pages and swaps the stored box", () => {
    // unrotated page 300x400pt shown at 90deg: visual width is 400 -> 120 wide, 30 tall visually
    expect(fitSignatureOnPage(400, 100, 300, 400, 90)).toEqual({ x: 0, y: 0, width: 30, height: 120 });
    expect(fitSignatureOnPage(400, 100, 300, 400, 270)).toEqual({ x: 0, y: 0, width: 30, height: 120 });
    expect(fitSignatureOnPage(400, 100, 300, 400, 180)).toEqual({ x: 0, y: 0, width: 90, height: 22.5 });
    expect(fitSignatureOnPage(400, 100, 300, 400, 0)).toEqual({ x: 0, y: 0, width: 90, height: 22.5 });
  });
  it("fits to 30% of page width", () => { expect(fitSignature(400, 100, 300)).toEqual({ x: 0, y: 0, width: 90, height: 22.5 }); });
  it("scales the longest side down to 1200 only", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 1200, height: 900 });
    expect(scaledSize(800, 200)).toEqual({ width: 800, height: 200 });
  });
});
