// src/store/ocr.ts
import { create } from "zustand";
import { useDocumentStore } from "./document";
import { useAiStore } from "./ai";
import type { SourceFile, SourceId } from "../pdf/types";
import { extractPageText, invalidatePageText } from "../pdf/text";
import { createOcrQueue, type OcrJobState } from "../ocr/queue";
import { ocrStore as defaultOcrStore, type OcrStore } from "../ocr/store";
import { getTesseractEngine } from "../ocr/tesseractEngine";
import { createClaudeEngine } from "../ocr/claudeEngine";
import { rasterizePage, CLAUDE_MAX_EDGE, TESSERACT_MAX_EDGE } from "../ocr/raster";
import type { OcrEngine, OcrEngineName } from "../ocr/types";

export const AUTO_KEY = "pdfstudio.ocr.auto";
export const pageKey = (sourceId: string, pageIndex: number) => `${sourceId}:${pageIndex}`;
export type OcrPageState = { state: OcrJobState; engine?: OcrEngineName; error?: string };

export interface OcrDeps {
  rasterize: typeof rasterizePage;
  tesseract: () => OcrEngine & { load(): Promise<void>; status: string };
  claude: () => OcrEngine;
  store: OcrStore;
  hasText: (source: SourceFile, page: number) => Promise<boolean>;
}
const deps: OcrDeps = {
  rasterize: rasterizePage,
  tesseract: getTesseractEngine,
  claude: () => createClaudeEngine(() => useAiStore.getState().client),
  store: defaultOcrStore,
  // "Has native text": OCR-backed text does not count, so cached scans still get a badge and can be Deep OCR'd.
  hasText: async (source, page) => { const t = await extractPageText(source, page); return !t.ocr && t.text.trim().length > 0; },
};
export function configureOcrDeps(partial: Partial<OcrDeps>): void { Object.assign(deps, partial); }

export interface OcrState {
  enabled: boolean;
  engineStatus: "idle" | "loading" | "ready" | "unavailable";
  engineError: string | null;
  pages: Record<string, OcrPageState>;
  deepOcrAcknowledged: boolean;
  lastWriteFailed: boolean;
  toast: string | null;
  setEnabled(on: boolean): void;
  acknowledgeDeepOcr(): void;
  scanSource(sourceId: SourceId): Promise<void>;
  deepOcr(pageEntryIds: string[] | "all-scanned"): Promise<void>;
  retryPage(sourceId: SourceId, pageIndex: number): void;
  retryEngine(): Promise<void>;
  cancelAll(): void;
  clearToast(): void;
  clearAll(): Promise<void>;
  scannedPageEntries(): string[];
  progress(): { done: number; total: number } | null;
  textStatus(): "recognizing" | "none" | "ok";
}

const readEnabled = () => { try { return localStorage.getItem(AUTO_KEY) !== "0"; } catch { return true; } };
const scanning = new Map<string, Promise<void>>(); // single-flight per source: auto-scan on open + explicit calls share one pass
const deepPrev = new Map<string, OcrPageState>(); // Tesseract result kept while Deep OCR is in flight, restored if it fails
const scanned = new Set<string>(); // pageKeys known to have no pdf.js text
const errorCopy = (code: string): string => {
  const m = useAiStore.getState().errorMessage(code);
  return code === "Page image too large" ? code : m;
};

const queue = createOcrQueue(async (job, signal) => {
  const source = useDocumentStore.getState().sources.get(job.sourceId);
  if (!source) throw new Error("cancelled");
  const engine = job.engine === "tesseract" ? deps.tesseract() : deps.claude();
  const { canvas, meta } = await deps.rasterize(source, job.pageIndex, job.engine === "tesseract" ? TESSERACT_MAX_EDGE : CLAUDE_MAX_EDGE);
  if (signal.aborted) throw new Error("cancelled");
  return engine.recognize(canvas, meta, signal);
}, {
  onState(job, state, extra) {
    const { setState, getState } = useOcrStore;
    const k = pageKey(job.sourceId, job.pageIndex);
    const source = useDocumentStore.getState().sources.get(job.sourceId);
    if (!source) return;
    if (state === "done" && extra?.page) {
      // A late Tesseract result must never replace a Deep OCR result already on the page.
      if (job.engine === "tesseract" && getState().pages[k]?.engine === "claude" && getState().pages[k]?.state === "done") return;
      void (async () => {
        if (source.hash) {
          await deps.store.put(source.hash, job.pageIndex, extra.page!);
          if (deps.store.lastWriteFailed && !getState().lastWriteFailed) setState({ lastWriteFailed: true, toast: "OCR text could not be saved; it will be recognized again next time." });
        }
        if (!useDocumentStore.getState().sources.has(job.sourceId)) return; // closed while saving
        invalidatePageText(job.sourceId, job.pageIndex);
        deepPrev.delete(k);
        setState((s) => ({ pages: { ...s.pages, [k]: { state: "done", engine: job.engine } } }));
      })();
      return;
    }
    if (job.engine === "claude") {
      if (state === "queued") { const cur = getState().pages[k]; if (cur?.state === "done") deepPrev.set(k, cur); }
      else if (state === "failed" || state === "empty") {
        // Keep the Tesseract text if any; report the reason once.
        const prev = deepPrev.get(k);
        deepPrev.delete(k);
        setState((s) => ({
          ...(state === "failed" ? { toast: errorCopy(extra?.error ?? "upstream") } : {}),
          pages: { ...s.pages, [k]: prev ?? { state, engine: "claude", ...(extra?.error ? { error: extra.error } : {}) } },
        }));
        return;
      }
    }
    if (state === "failed" && extra?.error && /cdn|load|worker|wasm|fetch/i.test(extra.error) && deps.tesseract().status === "unavailable") {
      setState({ engineStatus: "unavailable", engineError: extra.error });
    }
    setState((s) => ({ pages: { ...s.pages, [k]: { state, engine: job.engine, ...(extra?.error ? { error: extra.error } : {}) } } }));
  },
});

async function enqueueTesseract(sourceId: string, pageIndex: number) {
  useOcrStore.setState({ engineStatus: deps.tesseract().status === "unavailable" ? "unavailable" : "loading" });
  const open = () => useDocumentStore.getState().sources.has(sourceId);
  try { await deps.tesseract().load(); useOcrStore.setState({ engineStatus: "ready", engineError: null }); }
  catch (err) {
    if (!open()) return;
    const message = err instanceof Error ? err.message : String(err);
    // Mark the page failed so retryEngine() can find and re-queue it once the engine loads.
    useOcrStore.setState((s) => ({ engineStatus: "unavailable", engineError: message, pages: { ...s.pages, [pageKey(sourceId, pageIndex)]: { state: "failed", engine: "tesseract", error: message } } }));
    return;
  }
  if (!open()) return;
  queue.enqueue({ sourceId, pageIndex, engine: "tesseract" });
}

async function scanSourceOnce(sourceId: string): Promise<void> {
  const source = useDocumentStore.getState().sources.get(sourceId);
  if (!source) return;
  for (let p = 0; p < source.pageCount; p++) {
    const open = () => useDocumentStore.getState().sources.has(sourceId);
    const hasText = await deps.hasText(source, p);
    if (!open()) return;
    if (hasText) continue;
    const k = pageKey(sourceId, p);
    scanned.add(k);
    if (useOcrStore.getState().pages[k]) continue; // already queued/finished: a repeat scan must not redo it
    const cached = source.hash ? await deps.store.get(source.hash, p) : undefined;
    if (!open()) { scanned.delete(k); return; }
    if (cached) { invalidatePageText(sourceId, p); useOcrStore.setState((s) => ({ pages: { ...s.pages, [k]: { state: "done", engine: cached.engine } } })); continue; }
    if (!useOcrStore.getState().enabled) continue;
    await enqueueTesseract(sourceId, p);
  }
}

export const useOcrStore = create<OcrState>((set, get) => ({
  enabled: readEnabled(),
  engineStatus: "idle", engineError: null, pages: {}, deepOcrAcknowledged: false, lastWriteFailed: false, toast: null,

  setEnabled(on) { try { localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch { /* ignore */ } set({ enabled: on }); },
  acknowledgeDeepOcr() { set({ deepOcrAcknowledged: true }); },
  clearToast() { set({ toast: null }); },

  scanSource(sourceId) {
    const existing = scanning.get(sourceId);
    if (existing) return existing;
    const run: Promise<void> = scanSourceOnce(sourceId).finally(() => { if (scanning.get(sourceId) === run) scanning.delete(sourceId); });
    scanning.set(sourceId, run);
    return run;
  },
  retryPage(sourceId, pageIndex) { void enqueueTesseract(sourceId, pageIndex); },
  async retryEngine() {
    set({ engineStatus: "idle", engineError: null });
    const { sources } = useDocumentStore.getState();
    for (const [id] of sources) {
      for (const [k, st] of Object.entries(get().pages)) {
        if (!k.startsWith(`${id}:`) || st.state !== "failed" || st.engine !== "tesseract") continue;
        await enqueueTesseract(id, Number(k.slice(id.length + 1)));
        if (get().engineStatus === "unavailable") return;
      }
    }
  },
  async deepOcr(target) {
    const doc = useDocumentStore.getState();
    const ids = target === "all-scanned" ? get().scannedPageEntries() : target;
    for (const id of ids) {
      const entry = doc.pages.find((p) => p.id === id);
      if (!entry) continue;
      const k = pageKey(entry.sourceId, entry.sourcePageIndex);
      if (target !== "all-scanned" && !scanned.has(k)) {
        // Not scanned yet: decide from the page itself. Pages with real text are never sent.
        const source = doc.sources.get(entry.sourceId);
        if (!source || await deps.hasText(source, entry.sourcePageIndex)) continue;
        if (!useDocumentStore.getState().sources.has(entry.sourceId)) continue;
        scanned.add(k);
      }
      queue.enqueue({ sourceId: entry.sourceId, pageIndex: entry.sourcePageIndex, engine: "claude" });
    }
  },
  cancelAll() { queue.cancelAll(); },
  async clearAll() {
    queue.cancelAll();
    await deps.store.clear();
    for (const k of scanned) { const i = k.lastIndexOf(":"); invalidatePageText(k.slice(0, i), Number(k.slice(i + 1))); }
    scanned.clear(); deepPrev.clear(); scanning.clear();
    set({ pages: {}, toast: null, lastWriteFailed: false });
    // Open sources are re-scanned so badges and Deep OCR targets come back (and pages re-OCR if enabled).
    await Promise.all([...useDocumentStore.getState().sources.keys()].map((id) => get().scanSource(id)));
  },

  scannedPageEntries() {
    const doc = useDocumentStore.getState();
    return doc.pages.filter((p) => scanned.has(pageKey(p.sourceId, p.sourcePageIndex))).map((p) => p.id);
  },
  progress() {
    const doc = useDocumentStore.getState();
    let total = 0, done = 0;
    for (const [k, st] of Object.entries(get().pages)) {
      const sid = k.slice(0, k.lastIndexOf(":"));
      if (!doc.sources.has(sid) || st.engine !== "tesseract") continue;
      if (st.state === "queued" || st.state === "running") total++;
      else { total++; done++; }
    }
    return total > done ? { done, total } : null;
  },
  textStatus() {
    const doc = useDocumentStore.getState();
    let any = false, pending = false, ok = false;
    for (const p of doc.pages) {
      const st = get().pages[pageKey(p.sourceId, p.sourcePageIndex)];
      if (!st) continue;
      any = true;
      if (st.state === "queued" || st.state === "running") pending = true;
      if (st.state === "done") ok = true;
    }
    if (pending) return "recognizing";
    return any && !ok ? "none" : "ok";
  },
}));

useDocumentStore.subscribe((s, prev) => {
  if (s.sources === prev.sources) return;
  for (const id of prev.sources.keys()) {
    if (s.sources.has(id)) continue;
    queue.cancelSource(id);
    useOcrStore.setState((st) => { const pages = { ...st.pages }; for (const k of Object.keys(pages)) if (k.startsWith(`${id}:`)) delete pages[k]; return { pages }; });
    for (const k of [...scanned]) if (k.startsWith(`${id}:`)) scanned.delete(k);
    for (const k of [...deepPrev.keys()]) if (k.startsWith(`${id}:`)) deepPrev.delete(k);
  }
  for (const id of s.sources.keys()) if (!prev.sources.has(id)) useOcrStore.getState().scanSource(id).catch((err) => console.warn("OCR scan failed", err));
});
