import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { Rotation, SourceFile, SourceId } from "./types";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const docs = new Map<SourceId, Promise<PDFDocumentProxy>>();

function getDoc(source: SourceFile): Promise<PDFDocumentProxy> {
  let p = docs.get(source.id);
  if (!p) {
    // pdf.js takes ownership of the array it receives; pass a copy.
    p = pdfjs.getDocument({ data: source.bytes.slice() }).promise;
    docs.set(source.id, p);
  }
  return p;
}

export interface RenderHandle { promise: Promise<void>; cancel(): void }

// Per canvas: the previous render's settle promise. A new render waits for it before resizing
// the canvas, so two pdf.js render tasks never draw on (or resize) the same canvas at once.
const settled = new WeakMap<HTMLCanvasElement, Promise<unknown>>();

export function renderPage(
  source: SourceFile,
  pageIndex: number,
  rotation: Rotation,
  scale: number,
  canvas: HTMLCanvasElement,
): RenderHandle {
  let cancelled = false;
  let task: RenderTask | null = null;

  const run = async () => {
    await settled.get(canvas);
    if (cancelled) return;
    const doc = await getDoc(source);
    const page = await doc.getPage(pageIndex + 1);
    if (cancelled) return;
    const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
    const dpr = window.devicePixelRatio || 1;
    // Sized only now, right before drawing, after any previous task has settled.
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    task = page.render({
      canvas,
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
    });
    try {
      await task.promise;
    } catch (err) {
      if (!(err instanceof pdfjs.RenderingCancelledException)) throw err;
    }
  };

  const promise = run();
  settled.set(canvas, promise.catch(() => {}));
  return {
    promise,
    cancel() {
      cancelled = true;
      task?.cancel();
    },
  };
}

export function releaseSource(sourceId: SourceId): void {
  const p = docs.get(sourceId);
  docs.delete(sourceId);
  p?.then((d) => d.loadingTask.destroy()).catch(() => {});
}
