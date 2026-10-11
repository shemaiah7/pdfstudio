// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { whiteToTransparent, fitSignature } from "./image";
describe("signature image", () => {
  it("makes near-white pixels transparent", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 240, 240, 240, 255, 10, 10, 10, 255]);
    const d = (typeof ImageData === "function" ? new ImageData(data, 3, 1) : { data, width: 3, height: 1 }) as ImageData;
    const out = whiteToTransparent(d);
    expect(Array.from(out.data)).toEqual([255, 255, 255, 0, 240, 240, 240, 0, 10, 10, 10, 255]);
  });
  it("fits to 30% of page width", () => { expect(fitSignature(400, 100, 300)).toEqual({ x: 0, y: 0, width: 90, height: 22.5 }); });
});
