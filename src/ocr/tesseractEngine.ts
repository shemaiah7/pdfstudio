import { createWorker } from "tesseract.js";
import { tesseractToOcrPage, type TessLine } from "./layout";
import { canvasToBlob } from "./raster";
import type { OcrEngine, OcrPage, PageMetaPt } from "./types";

export const TESSDATA_URL = "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int";

export interface TessRunner { recognize(image: unknown): Promise<{ lines: TessLine[]; confidence: number }>; terminate(): Promise<void> }

async function defaultRunner(): Promise<TessRunner> {
  const worker = await createWorker("eng", 1, { langPath: TESSDATA_URL });
  return {
    async recognize(image) {
      const r = await worker.recognize(image as never, {}, { blocks: true, text: true });
      return { confidence: r.data.confidence, lines: (r.data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) };
    },
    terminate: async () => { await worker.terminate(); },
  };
}

export async function recognizeImage(runner: TessRunner, image: unknown, scale: number, meta: PageMetaPt): Promise<OcrPage> {
  const r = await runner.recognize(image);
  return tesseractToOcrPage(r.lines, r.confidence, scale, meta.heightPt);
}

export function createTesseractEngine(makeRunner: () => Promise<TessRunner> = defaultRunner) {
  let runner: Promise<TessRunner> | null = null;
  let status: "idle" | "loading" | "ready" | "unavailable" = "idle";
  const load = async () => {
    if (!runner) {
      status = "loading";
      runner = makeRunner().then((r) => { status = "ready"; return r; }, (e) => { status = "unavailable"; runner = null; throw e; });
    }
    await runner;
  };
  return {
    get status() { return status; },
    load,
    dispose() { const r = runner; runner = null; status = "idle"; void r?.then((x) => x.terminate()).catch(() => {}); },
    async recognize(canvas: HTMLCanvasElement, meta: PageMetaPt, signal?: AbortSignal): Promise<OcrPage> {
      if (signal?.aborted) throw new Error("cancelled");
      await load();
      if (signal?.aborted) throw new Error("cancelled");
      const r = await runner!;
      const scale = canvas.width / meta.widthPt;
      const blob = await canvasToBlob(canvas, "image/png");
      return recognizeImage(r, blob, scale, meta);
    },
  } satisfies OcrEngine & { load(): Promise<void>; dispose(): void; readonly status: string };
}

let singleton: ReturnType<typeof createTesseractEngine> | null = null;
export function getTesseractEngine() { return (singleton ??= createTesseractEngine()); }
