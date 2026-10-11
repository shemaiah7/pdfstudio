import { describe, it, expect } from "vitest";
import { sampleColors } from "./colors";

function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = paint(x, y); const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
  return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
}

describe("sampleColors", () => {
  it("takes the background from the ring and the text from the darkest pixels inside", () => {
    // cream page, block at 10..40 x 10..20 with navy glyph pixels on a cream background
    const img = image(60, 40, (x, y) => (x >= 12 && x <= 38 && y >= 12 && y <= 18 && (x + y) % 3 === 0 ? [20, 30, 90] : [250, 245, 230]));
    const { background, text } = sampleColors(img, { x: 10, y: 10, width: 30, height: 10 });
    expect(background.map((c) => Math.round(c * 255))).toEqual([250, 245, 230].map((v) => Math.floor(v / 16) * 16 + 8).map((v) => Math.min(255, v)));
    expect(text[2]).toBeGreaterThan(text[0]);
    expect(text[0] * 255).toBeLessThan(60);
  });
  it("falls back to white/black when the rect is outside the image", () => {
    const img = image(10, 10, () => [255, 255, 255]);
    expect(sampleColors(img, { x: 50, y: 50, width: 5, height: 5 })).toEqual({ background: [1, 1, 1], text: [0, 0, 0] });
  });
});
