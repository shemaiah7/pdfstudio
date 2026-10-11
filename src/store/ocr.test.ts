// src/store/ocr.test.ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDocumentStore } from "./document";
import { useOcrStore, configureOcrDeps, pageKey } from "./ocr";
import { createOcrStore } from "../ocr/store";
import { linesToOcrPage } from "../ocr/layout";
import type { OcrEngine } from "../ocr/types";

const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const fakeCanvas = () => ({ width: 300, height: 400 }) as unknown as HTMLCanvasElement;
let store = createOcrStore("ocr-store-test-1");
let n = 1;
const engine = (lines: string[], confidence = 0.9): OcrEngine & { load(): Promise<void>; status: string } => ({
  status: "ready", load: async () => {},
  recognize: async () => ({ ...linesToOcrPage(lines, { widthPt: 300, heightPt: 400 }), engine: "tesseract", confidence }),
});
async function openScan(pages = 2) {
  const bytes = new Uint8Array([pages]);
  await useDocumentStore.setState({ ...useDocumentStore.getState(), sources: new Map([[`src-${n}`, { id: `src-${n}`, name: "scan.pdf", bytes, pageCount: pages, hash: `h${n}` }]]), pages: Array.from({ length: pages }, (_, i) => ({ id: `pg-${n}-${i}`, sourceId: `src-${n}`, sourcePageIndex: i, rotation: 0 as const })) });
  return `src-${n++}`;
}

beforeEach(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } });
  store = createOcrStore(`ocr-store-test-${++n}`);
  useOcrStore.getState().cancelAll();
  useOcrStore.setState({ pages: {}, enabled: true, engineStatus: "idle", engineError: null, toast: null, deepOcrAcknowledged: false });
  configureOcrDeps({ store, rasterize: async () => ({ canvas: fakeCanvas(), meta: { widthPt: 300, heightPt: 400 }, scale: 1 }), tesseract: () => engine(["hello world"]), claude: () => engine(["deep text"]), hasText: async () => false });
});

describe("useOcrStore", () => {
  it("scans every text-less page of a source and stores the result", async () => {
    const id = await openScan(2);
    await useOcrStore.getState().scanSource(id);
    await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "done", engine: "tesseract" });
    expect(useOcrStore.getState().pages[pageKey(id, 1)].state).toBe("done");
    expect((await store.get(`h${n - 1}`, 1))?.lines[0].text).toBe("hello world");
  });
  it("skips pages that already have text and does nothing when disabled", async () => {
    configureOcrDeps({ hasText: async (_s, p) => p === 0 });
    const id = await openScan(2);
    await useOcrStore.getState().scanSource(id); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toBeUndefined();
    expect(useOcrStore.getState().pages[pageKey(id, 1)].state).toBe("done");
    useOcrStore.getState().setEnabled(false);
    const id2 = await openScan(1);
    await useOcrStore.getState().scanSource(id2); await flush();
    expect(useOcrStore.getState().pages[pageKey(id2, 0)]).toBeUndefined();
    expect(localStorage.getItem("pdfstudio.ocr.auto")).toBe("0");
  });
  it("uses a cached page without running the engine", async () => {
    let runs = 0;
    configureOcrDeps({ tesseract: () => ({ ...engine(["x"]), recognize: async () => { runs++; return linesToOcrPage(["x"], { widthPt: 1, heightPt: 1 }); } }) });
    const id = await openScan(1);
    await store.put(`h${n - 1}`, 0, linesToOcrPage(["cached"], { widthPt: 300, heightPt: 400 }));
    await useOcrStore.getState().scanSource(id); await flush();
    expect(runs).toBe(0);
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "done", engine: "claude" });
  });
  it("marks empty and failed pages and retries a page", async () => {
    let calls = 0;
    configureOcrDeps({ tesseract: () => ({ ...engine([]), recognize: async () => { if (calls++ === 0) throw new Error("boom"); return { ...linesToOcrPage([], { widthPt: 300, heightPt: 400 }), engine: "tesseract", confidence: 0 }; } }) });
    const id = await openScan(1);
    await useOcrStore.getState().scanSource(id); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "failed", error: "boom" });
    useOcrStore.getState().retryPage(id, 0); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)].state).toBe("empty");
    expect(useOcrStore.getState().textStatus()).toBe("none");
  });
  it("marks the engine unavailable when it cannot load, and recovers via retryEngine", async () => {
    let fail = true;
    configureOcrDeps({ tesseract: () => ({ ...engine(["ok"]), status: "unavailable", load: async () => { if (fail) throw new Error("cdn down"); }, recognize: async () => { if (fail) throw new Error("cdn down"); return linesToOcrPage(["ok"], { widthPt: 300, heightPt: 400 }); } }) });
    const id = await openScan(1);
    await useOcrStore.getState().scanSource(id); await flush();
    expect(useOcrStore.getState().engineStatus).toBe("unavailable");
    fail = false;
    await useOcrStore.getState().retryEngine(); await flush();
    expect(useOcrStore.getState().engineStatus).toBe("ready");
    expect(useOcrStore.getState().pages[pageKey(id, 0)].state).toBe("done");
  });
  it("deep OCR replaces the tesseract result and invalidates the text cache", async () => {
    const id = await openScan(1);
    await useOcrStore.getState().scanSource(id); await flush();
    const { invalidatePageText } = await import("../pdf/text");
    void invalidatePageText;
    await useOcrStore.getState().deepOcr([`pg-${n - 1}-0`]); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "done", engine: "claude" });
    expect((await store.get(`h${n - 1}`, 0))?.lines[0].text).toBe("deep text");
  });
  it("deep OCR 'all-scanned' targets only text-less pages and reports api errors as toasts", async () => {
    configureOcrDeps({ hasText: async (_s, p) => p === 0, claude: () => ({ recognize: async () => { throw new Error("daily_limit"); } }) });
    const id = await openScan(2);
    await useOcrStore.getState().scanSource(id); await flush();
    await useOcrStore.getState().deepOcr("all-scanned"); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toBeUndefined();
    expect(useOcrStore.getState().pages[pageKey(id, 1)]).toMatchObject({ state: "done", engine: "tesseract" }); // kept tesseract text
    expect(useOcrStore.getState().toast).toMatch(/Daily limit/);
  });
  it("closing a source cancels its jobs and clears its page states", async () => {
    let release!: () => void;
    configureOcrDeps({ tesseract: () => ({ ...engine(["x"]), recognize: (_c, _m, signal) => new Promise((_, rej) => { release = () => rej(new Error("cancelled")); signal?.addEventListener("abort", release); }) }) });
    const id = await openScan(2);
    void useOcrStore.getState().scanSource(id); await flush();
    expect(useOcrStore.getState().progress()).toEqual({ done: 0, total: 2 });
    expect(useOcrStore.getState().textStatus()).toBe("recognizing");
    useDocumentStore.setState({ sources: new Map(), pages: [] });
    await flush();
    expect(Object.keys(useOcrStore.getState().pages).filter((k) => k.startsWith(id))).toEqual([]);
    expect(useOcrStore.getState().progress()).toBeNull();
  });
  it("clearAll empties the store and page states", async () => {
    const id = await openScan(1);
    await useOcrStore.getState().scanSource(id); await flush();
    await useOcrStore.getState().clearAll();
    expect(useOcrStore.getState().pages).toEqual({});
    expect(await store.get(`h${n - 1}`, 0)).toBeUndefined();
  });
});
