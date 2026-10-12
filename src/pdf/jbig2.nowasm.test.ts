// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { loadFixture } from "../test/loadFixture";

// Separate file on purpose: pdf.js caches the instantiated wasm module statically, so ordering inside one file
// would be fragile. Vitest isolates modules per file, which makes "no wasmUrl" deterministic here.
// pdf.js logs "wasmUrl" / Jbig2Error warnings during this test; that is expected.
describe("JBIG2 page images without wasmUrl", () => {
  it("render blank, which is the production bug this guards against", async () => {
    const pdf = await getDocument({ data: loadFixture("jbig2").slice() }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const w = Math.floor(viewport.width), h = Math.floor(viewport.height);
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext("2d");
    await page.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise;
    const px = ctx.getImageData(0, 0, w, h).data;
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] < 128) dark++;
    expect(dark / (w * h)).toBe(0);
  });
});
