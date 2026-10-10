import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
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

export async function renderPage(
  source: SourceFile,
  pageIndex: number,
  rotation: Rotation,
  scale: number,
  canvas: HTMLCanvasElement,
): Promise<void> {
  const doc = await getDoc(source);
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale, rotation: page.rotate + rotation });
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
  }).promise;
}

export function releaseSource(sourceId: SourceId): void {
  const p = docs.get(sourceId);
  docs.delete(sourceId);
  p?.then((d) => d.loadingTask.destroy()).catch(() => {});
}
