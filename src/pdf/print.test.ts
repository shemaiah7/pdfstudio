// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const pages = [{ w: 612, h: 792 }, { w: 792, h: 612 }];
const destroy = vi.fn();
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  version: "0.0.0",
  AnnotationMode: { ENABLE_STORAGE: 2 },
  getDocument: vi.fn(() => ({
    destroy,
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: async (n: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: pages[n - 1].w * scale, height: pages[n - 1].h * scale }),
        render: vi.fn(() => ({ promise: Promise.resolve() })),
      }),
    }),
  })),
}));

import { printPdfBytes } from "./print";

let printSnapshot: { count: number; widths: string[]; heights: string[] } | null;
const print = vi.fn();
let urlN = 0;
const revoke = vi.fn();

beforeEach(() => {
  urlN = 0;
  printSnapshot = null;
  print.mockReset().mockImplementation(() => {
    const root = document.getElementById("print-root")!;
    const wraps = [...root.querySelectorAll<HTMLElement>(".print-page")];
    printSnapshot = { count: wraps.length, widths: wraps.map((w) => w.style.width), heights: wraps.map((w) => w.style.height) };
  });
  vi.stubGlobal("print", print);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["x"], { type: "image/png" })));
  HTMLImageElement.prototype.decode = vi.fn(async () => {});
  URL.createObjectURL = vi.fn(() => `blob:p${urlN++}`);
  URL.revokeObjectURL = revoke;
  revoke.mockClear(); destroy.mockClear();
});
afterEach(() => { window.dispatchEvent(new Event("afterprint")); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.getElementById("print-root")?.remove(); });

describe("printPdfBytes", () => {
  it("builds one inch-sized .print-page per page and prints once", async () => {
    const progress = vi.fn();
    await printPdfBytes(new Uint8Array([1]), { onProgress: progress });
    expect(print).toHaveBeenCalledTimes(1);
    expect(printSnapshot).toEqual({ count: 2, widths: ["8.5in", `${792 / 72}in`], heights: ["11in", "8.5in"] });
    expect(progress).toHaveBeenLastCalledWith(2, 2);
    expect(destroy).toHaveBeenCalled();
  });

  it("removes #print-root and revokes URLs on afterprint, once", async () => {
    await printPdfBytes(new Uint8Array([1]));
    expect(document.getElementById("print-root")).not.toBeNull();
    window.dispatchEvent(new Event("afterprint"));
    window.dispatchEvent(new Event("afterprint"));
    expect(document.getElementById("print-root")).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledWith("blob:p0");
    expect(revoke).toHaveBeenCalledWith("blob:p1");
  });

  it("does not print when aborted mid-render, and cleans up", async () => {
    const ac = new AbortController();
    await printPdfBytes(new Uint8Array([1]), { signal: ac.signal, onProgress: () => ac.abort() });
    expect(print).not.toHaveBeenCalled();
    expect(document.getElementById("print-root")).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("cleans up and rethrows when a page cannot be rasterized", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(null));
    await expect(printPdfBytes(new Uint8Array([1]))).rejects.toThrow("Could not rasterize page");
    expect(print).not.toHaveBeenCalled();
    expect(document.getElementById("print-root")).toBeNull();
  });
});
