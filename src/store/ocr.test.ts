// src/store/ocr.test.ts
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDocumentStore } from "./document";
import { useAiStore } from "./ai";
import { useOcrStore, configureOcrDeps, pageKey, applyQuota } from "./ocr";
import { createClaudeEngine } from "../ocr/claudeEngine";
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
    await store.put(`h${n}`, 0, linesToOcrPage(["cached"], { widthPt: 300, heightPt: 400 }));
    const id = await openScan(1);
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
    expect(useAiStore.getState().ocrTextStatus).toBe("recognizing");
    useDocumentStore.setState({ sources: new Map(), pages: [] });
    await flush();
    expect(Object.keys(useOcrStore.getState().pages).filter((k) => k.startsWith(id))).toEqual([]);
    expect(useOcrStore.getState().progress()).toBeNull();
  });
  it("clearAll empties the store and page states", async () => {
    const id = await openScan(1);
    await useOcrStore.getState().scanSource(id); await flush();
    useOcrStore.getState().setEnabled(false); // clearAll re-scans open sources; with auto OCR off nothing is re-recognized
    await useOcrStore.getState().clearAll();
    expect(useOcrStore.getState().pages).toEqual({});
    expect(await store.get(`h${n - 1}`, 0)).toBeUndefined();
  });
  it("a run that resolves after its source closed leaves no page state or scanned key", async () => {
    let finish!: () => void;
    configureOcrDeps({ tesseract: () => ({ ...engine(["x"]), recognize: () => new Promise((res) => { finish = () => res({ ...linesToOcrPage(["late"], { widthPt: 300, heightPt: 400 }), engine: "tesseract", confidence: 0.9 }); }) }) });
    const id = await openScan(1);
    void useOcrStore.getState().scanSource(id); await flush();
    expect(useOcrStore.getState().scannedPageEntries().length).toBe(1);
    useDocumentStore.setState({ sources: new Map(), pages: [] }); await flush();
    finish(); await flush();
    expect(Object.keys(useOcrStore.getState().pages).filter((k) => k.startsWith(id))).toEqual([]);
    useDocumentStore.setState({ ...useDocumentStore.getState(), pages: [{ id: "pg-x", sourceId: id, sourcePageIndex: 0, rotation: 0 as const }] });
    expect(useOcrStore.getState().scannedPageEntries()).toEqual([]);
    useDocumentStore.setState({ pages: [] });
  });
  it("clearAll re-scans open sources so the page is recognized again", async () => {
    let runs = 0;
    configureOcrDeps({ tesseract: () => ({ ...engine(["again"]), recognize: async () => { runs++; return { ...linesToOcrPage(["again"], { widthPt: 300, heightPt: 400 }), engine: "tesseract", confidence: 0.9 }; } }) });
    const id = await openScan(1);
    await useOcrStore.getState().scanSource(id); await flush();
    expect(runs).toBe(1);
    await useOcrStore.getState().clearAll(); await flush();
    expect(runs).toBe(2);
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "done", engine: "tesseract" });
    expect((await store.get(`h${n - 1}`, 0))?.lines[0].text).toBe("again");
    expect(useOcrStore.getState().scannedPageEntries()).toEqual([`pg-${n - 1}-0`]);
  });
  it("deep OCR on an unscanned explicit page checks native text first", async () => {
    configureOcrDeps({ hasText: async () => true });
    const id = await openScan(1);
    await useOcrStore.getState().scanSource(id); await flush();
    await useOcrStore.getState().deepOcr([`pg-${n - 1}-0`]); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toBeUndefined();
    configureOcrDeps({ hasText: async () => false });
    useOcrStore.getState().cancelAll();
    await useOcrStore.getState().deepOcr([`pg-${n - 1}-0`]); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "done", engine: "claude" });
  });
  it("drops a late Tesseract result when the page already holds a Deep OCR result", async () => {
    let finish!: () => void;
    configureOcrDeps({ tesseract: () => ({ ...engine(["x"]), recognize: () => new Promise((res) => { finish = () => res({ ...linesToOcrPage(["late tess"], { widthPt: 300, heightPt: 400 }), engine: "tesseract", confidence: 0.9 }); }) }) });
    const id = await openScan(1);
    void useOcrStore.getState().scanSource(id); await flush();
    await useOcrStore.getState().deepOcr([`pg-${n - 1}-0`]); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "done", engine: "claude" });
    finish(); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "done", engine: "claude" });
    expect((await store.get(`h${n - 1}`, 0))?.lines[0].text).toBe("deep text");
  });
  const hang = (_c: HTMLCanvasElement, _m: unknown, signal?: AbortSignal) => new Promise<never>((_, rej) => signal?.addEventListener("abort", () => rej(new Error("cancelled"))));
  it("cancelAll fails queued and running pages as cancelled, so progress and text status settle", async () => {
    configureOcrDeps({ tesseract: () => ({ ...engine(["x"]), recognize: hang }), claude: () => ({ recognize: hang }) });
    const id = await openScan(3);
    void useOcrStore.getState().scanSource(id); await flush();
    await useOcrStore.getState().deepOcr([`pg-${n - 1}-2`]); await flush();
    expect(useOcrStore.getState().textStatus()).toBe("recognizing");
    useOcrStore.getState().cancelAll(); await flush();
    for (let p = 0; p < 3; p++) expect(useOcrStore.getState().pages[pageKey(id, p)]).toMatchObject({ state: "failed", error: "cancelled" });
    expect(useOcrStore.getState().progress()).toBeNull();
    expect(useOcrStore.getState().textStatus()).not.toBe("recognizing");
    expect(useAiStore.getState().ocrTextStatus).not.toBe("recognizing");
  });
  it("cancelAll restores the Tesseract text of a page with a pending Deep OCR job", async () => {
    configureOcrDeps({ claude: () => ({ recognize: hang }) });
    const id = await openScan(1);
    await useOcrStore.getState().scanSource(id); await flush();
    await useOcrStore.getState().deepOcr([`pg-${n - 1}-0`]); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "running", engine: "claude" });
    useOcrStore.getState().cancelAll(); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toEqual({ state: "done", engine: "tesseract" });
  });
  it("cancelRecognition fails only Tesseract pages and leaves Deep OCR jobs alone", async () => {
    configureOcrDeps({ tesseract: () => ({ ...engine(["x"]), recognize: hang }), claude: () => ({ recognize: hang }) });
    const id = await openScan(4);
    void useOcrStore.getState().scanSource(id); await flush();
    await useOcrStore.getState().deepOcr([`pg-${n - 1}-2`, `pg-${n - 1}-3`]); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 2)]).toMatchObject({ state: "running", engine: "claude" });
    expect(useOcrStore.getState().pages[pageKey(id, 3)]).toMatchObject({ state: "queued", engine: "claude" });
    useOcrStore.getState().cancelRecognition(); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "failed", engine: "tesseract", error: "cancelled" });
    expect(useOcrStore.getState().pages[pageKey(id, 1)]).toMatchObject({ state: "failed", engine: "tesseract", error: "cancelled" });
    expect(useOcrStore.getState().pages[pageKey(id, 2)]).toMatchObject({ state: "running", engine: "claude" });
    expect(useOcrStore.getState().pages[pageKey(id, 3)]).toMatchObject({ state: "queued", engine: "claude" });
    useOcrStore.getState().cancelAll();
  });
  it("shows the formatted reset time when Deep OCR hits the daily limit", async () => {
    const resetAt = 1_800_000_000;
    configureOcrDeps({ claude: () => ({ recognize: async () => { throw Object.assign(new Error("daily_limit"), { resetAt }); } }) });
    const id = await openScan(1);
    await useOcrStore.getState().scanSource(id); await flush();
    await useOcrStore.getState().deepOcr([`pg-${n - 1}-0`]); await flush();
    const t = new Date(resetAt * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    expect(useOcrStore.getState().toast).toBe(`Daily limit reached. Resets at ${t}.`);
  });
  it("pushes remaining quota into the AI store after a Deep OCR success", async () => {
    const api = { runOcr: async () => ({ pages: [{ page: 1, lines: ["deep"] }], failed: [], remaining: { requests: 0, tokens: 5 }, resetAt: 777 }) };
    configureOcrDeps({ claude: () => createClaudeEngine(() => api, { onQuota: applyQuota }), rasterize: async () => ({ canvas: { width: 10, height: 10, toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["x"])) } as unknown as HTMLCanvasElement, meta: { widthPt: 300, heightPt: 400 }, scale: 1 }) });
    useAiStore.setState({ remaining: null, limitedUntil: null });
    const id = await openScan(1);
    await useOcrStore.getState().scanSource(id); await flush();
    await useOcrStore.getState().deepOcr([`pg-${n - 1}-0`]); await flush(10);
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "done", engine: "claude" });
    expect(useAiStore.getState().remaining).toEqual({ requests: 0, tokens: 5, resetAt: 777 });
    expect(useAiStore.getState().limitedUntil).toBe(777);
    useAiStore.setState({ remaining: null, limitedUntil: null });
  });
  it("a batch-fatal Deep OCR error cancels the remaining Deep OCR jobs, keeps Tesseract text, and toasts once", async () => {
    let calls = 0;
    configureOcrDeps({ claude: () => ({ recognize: async () => { calls++; throw new Error("too_fast"); } }) });
    const id = await openScan(3);
    await useOcrStore.getState().scanSource(id); await flush();
    useOcrStore.setState({ toast: null });
    const toasts: (string | null)[] = [];
    const unsub = useOcrStore.subscribe((st, prev) => { if (st.toast !== prev.toast) toasts.push(st.toast); });
    await useOcrStore.getState().deepOcr([0, 1, 2].map((p) => `pg-${n - 1}-${p}`)); await flush(10);
    unsub();
    expect(calls).toBe(1);
    for (let p = 0; p < 3; p++) expect(useOcrStore.getState().pages[pageKey(id, p)]).toEqual({ state: "done", engine: "tesseract" });
    expect(toasts).toEqual(["Slow down a little and try again in a few seconds."]);
  });
  it("a batch-fatal error on pages without Tesseract text marks the rest failed with that code", async () => {
    configureOcrDeps({ claude: () => ({ recognize: async () => { throw new Error("network"); } }) });
    const id = await openScan(2);
    useOcrStore.getState().setEnabled(false);
    await useOcrStore.getState().scanSource(id); // auto OCR off: pages just become Deep OCR targets
    await useOcrStore.getState().deepOcr([`pg-${n - 1}-0`, `pg-${n - 1}-1`]); await flush(10);
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toMatchObject({ state: "failed", engine: "claude", error: "network" });
    expect(useOcrStore.getState().pages[pageKey(id, 1)]).toMatchObject({ state: "failed", engine: "claude", error: "network" });
  });
  it("a Tesseract result landing during Deep OCR is what a failed Deep OCR restores", async () => {
    let finishTess!: () => void;
    configureOcrDeps({
      tesseract: () => ({ ...engine(["x"]), recognize: () => new Promise((res) => { finishTess = () => res({ ...linesToOcrPage(["tess"], { widthPt: 300, heightPt: 400 }), engine: "tesseract", confidence: 0.9 }); }) }),
      claude: () => ({ recognize: async () => { await new Promise((r) => setTimeout(r, 30)); throw new Error("upstream"); } }),
    });
    const id = await openScan(1);
    void useOcrStore.getState().scanSource(id); await flush();
    await useOcrStore.getState().deepOcr([`pg-${n - 1}-0`]); await flush(2);
    finishTess();
    await new Promise((r) => setTimeout(r, 80)); await flush();
    expect(useOcrStore.getState().pages[pageKey(id, 0)]).toEqual({ state: "done", engine: "tesseract" });
  });
});
