import * as pdfjs from "pdfjs-dist";
import { cappedScale } from "../edit/flatten";
import { wasmUrl } from "./render";

export interface PrintOptions { dpi?: number; onProgress?: (done: number, total: number) => void; signal?: AbortSignal }

const FALLBACK_CLEANUP_MS = 30_000;

/** Browser only: rasterizes the PDF into a print-only container and opens the system print dialog. */
export async function printPdfBytes(bytes: Uint8Array, opts: PrintOptions = {}): Promise<void> {
  const { dpi = 150, onProgress, signal } = opts;
  document.getElementById("print-root")?.remove();
  const root = document.createElement("div");
  root.id = "print-root";
  const urls: string[] = [];
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.removeEventListener("afterprint", onAfterPrint);
    root.remove();
    for (const u of urls) URL.revokeObjectURL(u);
  };
  const onAfterPrint = () => cleanup();

  // pdf.js takes ownership of the array it receives; pass a copy.
  const task = pdfjs.getDocument({ data: bytes.slice(), wasmUrl: wasmUrl() });
  try {
    const doc = await task.promise;
    const total = doc.numPages;
    const imgs: HTMLImageElement[] = [];
    for (let i = 1; i <= total; i++) {
      if (signal?.aborted) { cleanup(); return; }
      const page = await doc.getPage(i);
      const pt = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: cappedScale(pt.width, pt.height, dpi) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) throw new Error("Could not rasterize page");
      // intent "print" also avoids requestAnimationFrame pacing, which stalls in hidden tabs.
      await page.render({ canvas, canvasContext, viewport, annotationMode: pdfjs.AnnotationMode.ENABLE_STORAGE, intent: "print" }).promise;
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      canvas.width = canvas.height = 0;
      if (!blob) throw new Error("Could not rasterize page");
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      const wrap = document.createElement("div");
      wrap.className = "print-page";
      wrap.style.width = `${pt.width / 72}in`;
      wrap.style.height = `${pt.height / 72}in`;
      wrap.append(img);
      root.append(wrap);
      imgs.push(img);
      onProgress?.(i, total);
    }
    if (signal?.aborted) { cleanup(); return; }
    document.body.append(root);
    await Promise.all(imgs.map((img) => img.decode()));
    if (signal?.aborted) { cleanup(); return; }
    window.addEventListener("afterprint", onAfterPrint);
    window.print();
    // print() blocks in Chrome/Electron; Safari may return while the dialog is still open, so wait for afterprint with a fallback.
    if (!cleaned) setTimeout(cleanup, FALLBACK_CLEANUP_MS);
  } catch (err) {
    cleanup();
    throw err;
  } finally {
    void task.destroy();
  }
}
