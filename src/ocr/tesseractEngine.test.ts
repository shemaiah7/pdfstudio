// src/ocr/tesseractEngine.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker } from "tesseract.js";
import { rasterScale } from "./raster";
import { createTesseractEngine, recognizeImage, TESSDATA_URL, type TessRunner } from "./tesseractEngine";

describe("rasterScale", () => {
  it("uses 300 dpi unless the long edge would exceed maxEdge", () => {
    expect(rasterScale({ widthPt: 300, heightPt: 400 }, 2500)).toBeCloseTo(300 / 72);
    expect(rasterScale({ widthPt: 612, heightPt: 792 }, 1568)).toBeCloseTo(1568 / 792);
  });
});

describe("createTesseractEngine", () => {
  it("loads lazily once, reports status, and converts results", async () => {
    let made = 0;
    const runner: TessRunner = {
      recognize: async () => ({ confidence: 80, lines: [{ text: "hi", bbox: { x0: 0, y0: 0, x1: 20, y1: 10 }, confidence: 80, words: [{ text: "hi", bbox: { x0: 0, y0: 0, x1: 20, y1: 10 }, confidence: 80 }] }] }),
      terminate: async () => {},
    };
    const engine = createTesseractEngine(async () => { made++; return runner; });
    expect(engine.status).toBe("idle");
    const canvas = { width: 200, height: 100, toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["x"])) } as unknown as HTMLCanvasElement;
    const page = await engine.recognize(canvas, { widthPt: 100, heightPt: 50 });
    await engine.recognize(canvas, { widthPt: 100, heightPt: 50 });
    expect(made).toBe(1);
    expect(engine.status).toBe("ready");
    expect(page.lines[0].words[0].box).toEqual({ x: 0, y: 45, width: 10, height: 5 });
  });
  it("becomes unavailable when the runner cannot be created and recovers on retry", async () => {
    let attempt = 0;
    const engine = createTesseractEngine(async () => { if (attempt++ === 0) throw new Error("cdn down"); return { recognize: async () => ({ confidence: 0, lines: [] }), terminate: async () => {} }; });
    await expect(engine.load()).rejects.toThrow("cdn down");
    expect(engine.status).toBe("unavailable");
    await engine.load();
    expect(engine.status).toBe("ready");
  });
  it("rejects with 'cancelled' when the signal aborts before the job runs", async () => {
    const engine = createTesseractEngine(async () => ({ recognize: () => new Promise(() => {}), terminate: async () => {} }));
    const c = new AbortController(); c.abort();
    await expect(engine.recognize({} as HTMLCanvasElement, { widthPt: 1, heightPt: 1 }, c.signal)).rejects.toThrow("cancelled");
  });
});

describe("createTesseractEngine abort", () => {
  it("terminates and recreates the runner when a recognize is aborted mid-run", async () => {
    let made = 0, terminated = 0;
    const engine = createTesseractEngine(async () => {
      made++;
      return { recognize: made === 1 ? () => new Promise(() => {}) : async () => ({ confidence: 0, lines: [] }), terminate: async () => { terminated++; } };
    });
    const canvas = { width: 200, height: 100, toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["x"])) } as unknown as HTMLCanvasElement;
    const meta = { widthPt: 100, heightPt: 50 };
    const c = new AbortController();
    const p = engine.recognize(canvas, meta, c.signal);
    await new Promise((r) => setTimeout(r, 0));
    c.abort();
    await expect(p).rejects.toThrow("cancelled");
    await new Promise((r) => setTimeout(r, 0));
    expect(terminated).toBe(1);
    await engine.recognize(canvas, meta);
    expect(made).toBe(2);
  });
});

describe("real Tesseract on the scan fixture", () => {
  it("reads the printed words", async () => {
    const worker = await createWorker("eng", 1, { langPath: TESSDATA_URL, cachePath: tmpdir() });
    const runner: TessRunner = {
      recognize: async (image) => { const r = await worker.recognize(image as Buffer, {}, { blocks: true, text: true }); return { confidence: r.data.confidence, lines: (r.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) }; },
      terminate: async () => { await worker.terminate(); },
    };
    try {
      const png = readFileSync(join(process.cwd(), "src/test/fixtures/scan.png"));
      const page = await recognizeImage(runner, png, 200 / 72, { widthPt: 300, heightPt: 400 });
      const text = page.lines.map((l) => l.text).join("\n");
      expect(text).toMatch(/Patient/); expect(text).toMatch(/hypertension/); expect(text).toMatch(/lisinopril/);
      expect(page.confidence).toBeGreaterThan(0.6);
      const first = page.lines[0].box;
      expect(first.y).toBeGreaterThan(300); expect(first.y).toBeLessThan(400);
    } finally { await runner.terminate(); }
  }, 120_000);
});
