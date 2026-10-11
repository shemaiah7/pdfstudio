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
  const dispose = () => { const r = runner; runner = null; status = "idle"; void r?.then((x) => x.terminate()).catch(() => {}); };
  return {
    get status() { return status; },
    load,
    dispose,
    async recognize(canvas: HTMLCanvasElement, meta: PageMetaPt, signal?: AbortSignal): Promise<OcrPage> {
      if (signal?.aborted) throw new Error("cancelled");
      await load();
      if (signal?.aborted) throw new Error("cancelled");
      const current = runner!;
      const r = await current;
      const scale = canvas.width / meta.widthPt;
      const work = (async () => recognizeImage(r, await canvasToBlob(canvas, "image/png"), scale, meta))();
      if (!signal) return work;
      work.catch(() => {}); // an abandoned run may still reject later
      let onAbort!: () => void;
      const aborted = new Promise<never>((_, rej) => { onAbort = () => rej(new Error("cancelled")); signal.addEventListener("abort", onAbort, { once: true }); });
      try { return await Promise.race([work, aborted]); }
      catch (err) {
        // The worker may still be busy with the abandoned page: replace it so the next page does not queue behind it.
        if (signal.aborted && runner === current) dispose();
        throw err;
      }
      finally { signal.removeEventListener("abort", onAbort); }
    },
  } satisfies OcrEngine & { load(): Promise<void>; dispose(): void; readonly status: string };
}

let singleton: ReturnType<typeof createTesseractEngine> | null = null;
export function getTesseractEngine() { return (singleton ??= createTesseractEngine()); }
