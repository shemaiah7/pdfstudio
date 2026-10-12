// @vitest-environment node
import { describe, it, expect } from "vitest";
import { loadFixture } from "../test/loadFixture";
import { openPdf } from "../test/pdfjs";

describe("JBIG2 page images", () => {
  it("decode with the pdf.js wasm decoder and draw dark text pixels", async () => {
    const pdf = await openPdf(loadFixture("jbig2"));
    const page = await pdf.getPage(1);
    expect((await page.getTextContent()).items).toHaveLength(0);
    const viewport = page.getViewport({ scale: 1 });
    const w = Math.floor(viewport.width), h = Math.floor(viewport.height);
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise;
    const px = ctx.getImageData(0, 0, w, h).data;
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] < 128) dark++;
    const frac = dark / (w * h);
    expect(frac).toBeGreaterThan(0.003);
    expect(frac).toBeLessThan(0.5);
  });
});
