// src/store/search.ts
import { create } from "zustand";
import { getEmbedClient } from "../search/embedClient";
import { library, sha256 } from "../search/library";
import type { LibrarySummary } from "../search/library";
import { indexSource, defaultDeps } from "../search/indexer";
import { rank, queryTerms, type Hit, type RankDoc } from "../search/ranker";
import { ASK_PASSAGES, DIMS, SEARCH_LIMIT, THRESHOLD, modelTag } from "../search/constants";
import { useDocumentStore } from "./document";
import type { SourceId } from "../pdf/types";

type ModelStatus = "idle" | "downloading" | "ready" | "unavailable";
type DocStatus = "queued" | "indexing" | "indexed" | "no-text" | "failed";
export interface SearchState {
  enabled: boolean;
  model: { status: ModelStatus; loaded: number; total: number; device?: "webgpu" | "wasm"; error?: string };  // error "no-webgpu" = no adapter; CPU mode needs an explicit opt-in
  docs: Record<string, { status: DocStatus; done: number; total: number; error?: string }>;
  hashBySource: Record<SourceId, string>;
  persistent: boolean;
  lastWriteFailed: boolean;
  query: string; results: Hit[]; searching: boolean;
  library: LibrarySummary[];
  usage: number | null;
  init(): Promise<void>;
  enable(): Promise<void>;
  retryModel(): Promise<void>;
  enableCpuMode(): Promise<void>;
  indexOpen(): Promise<void>;
  retryDoc(hash: string): Promise<void>;
  refreshIndex(): Promise<void>;
  refreshLibrary(): Promise<void>;
  setQuery(q: string): void;
  search(): Promise<void>;
  findSimilar(hash: string, chunkIndex: number): Promise<void>;
  openHit(hit: Hit): Promise<void>;
  removeFromLibrary(hash: string): Promise<void>;
  clearLibrary(): Promise<void>;
}

const ENABLED_KEY = "pdfstudio.search.enabled";
const CPU_KEY = "pdfstudio.search.cpu";
const cpuPreferred = () => { try { return localStorage.getItem(CPU_KEY) === "1"; } catch { return false; } };
let index: RankDoc[] = [];                    // in-memory copy of the library
let debounce: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<void> = Promise.resolve();  // one document at a time
const controllers = new Map<string, AbortController>(); // one per hash being indexed

async function loadModel(set: (p: Partial<SearchState>) => void, device?: "wasm") {
  set({ model: { status: "downloading", loaded: 0, total: 0 } });
  try {
    const client = getEmbedClient();
    const loaded = await client.load((loaded, total) => set({ model: { status: "downloading", loaded, total } }), device);
    // fp32 (CPU) and q4 (WebGPU) vectors differ, so the library only trusts records indexed under the active dtype.
    library.setModelTag(modelTag(client.dtype ?? (loaded === "wasm" ? "fp32" : "q4")));
    set({ model: { status: "ready", loaded: 0, total: 0, device: loaded } });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    set({ model: { status: "unavailable", loaded: 0, total: 0, error: code === "no-webgpu" ? "no-webgpu" : err instanceof Error ? err.message : String(err) } });
  }
}

async function start() {
  const { setState, getState } = useSearchStore;
  await loadModel(setState, cpuPreferred() ? "wasm" : undefined);
  if (getState().model.status === "ready") { await getState().refreshIndex(); await getState().indexOpen(); }
}

let revealTimer: ReturnType<typeof setTimeout> | null = null;
function cancelReveal() { if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; } }

function reveal(sourceId: SourceId, hit: Hit) {
  cancelReveal();
  attemptReveal(sourceId, hit, 0);
}
function attemptReveal(sourceId: SourceId, hit: Hit, waited: number) {
  const entry = useDocumentStore.getState().pages.find((p) => p.sourceId === sourceId && p.sourcePageIndex === hit.page);
  if (!entry || typeof document === "undefined") return;
  const el = document.getElementById(`page-${entry.id}`);
  // A document just opened from the library may not have rendered (page or text layer) yet: retry for up to 3 s.
  if (!el || !el.querySelector(".textLayer span")) {
    if (waited < 3000) revealTimer = setTimeout(() => attemptReveal(sourceId, hit, waited + 100), 100);
    else el?.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  revealTimer = null;
  el.scrollIntoView({ block: "start", behavior: "smooth" });
  const chunk = index.find((d) => d.hash === hit.hash)?.chunks[hit.chunkIndex];
  if (chunk) flashChunk(entry.id, chunk.text);
}

export const useSearchStore = create<SearchState>((set, get) => ({
  enabled: (() => { try { return localStorage.getItem(ENABLED_KEY) === "1"; } catch { return false; } })(),
  model: { status: "idle", loaded: 0, total: 0 },
  docs: {}, hashBySource: {}, persistent: true, lastWriteFailed: false,
  query: "", results: [], searching: false, library: [], usage: null,

  async init() {
    if (!get().enabled || get().model.status !== "idle") return;
    await start();
  },
  async enable() {
    try { localStorage.setItem(ENABLED_KEY, "1"); } catch { /* ignore */ }
    set({ enabled: true });
    await start();
  },
  async retryModel() { await loadModel(set, cpuPreferred() ? "wasm" : undefined); if (get().model.status === "ready") { await get().refreshIndex(); await get().indexOpen(); } },
  async enableCpuMode() {
    try { localStorage.setItem(CPU_KEY, "1"); } catch { /* ignore */ }
    await loadModel(set, "wasm");
    if (get().model.status === "ready") { await get().refreshIndex(); await get().indexOpen(); }
  },
  async refreshIndex() { index = await library.loadAll(); set({ persistent: library.persistent, lastWriteFailed: library.lastWriteFailed }); },
  async refreshLibrary() { set({ library: await library.list(), usage: await library.estimateUsage() }); },

  async indexOpen() {
    if (get().model.status !== "ready") return;
    const { sources } = useDocumentStore.getState();
    for (const source of sources.values()) {
      const hash = get().hashBySource[source.id] ?? (await sha256(source.bytes));
      set((s) => ({ hashBySource: { ...s.hashBySource, [source.id]: hash } }));
      const status = get().docs[hash]?.status;
      if (status && status !== "failed" && !controllers.get(hash)?.signal.aborted) continue;
      const controller = new AbortController();
      controllers.set(hash, controller);
      set((s) => ({ docs: { ...s.docs, [hash]: { status: "queued", done: 0, total: source.pageCount } } }));
      const isCurrent = () => controllers.get(hash) === controller;
      const dropDoc = () => { if (isCurrent()) set((s) => { const d = { ...s.docs }; delete d[hash]; return { docs: d }; }); };
      const job = async () => {
        try {
          if (controller.signal.aborted) { dropDoc(); return; }
          if (!useDocumentStore.getState().sources.has(source.id)) {
            controller.abort(); getEmbedClient().cancel(hash); dropDoc(); return;
          }
          set((s) => ({ docs: { ...s.docs, [hash]: { ...s.docs[hash], status: "indexing" } } }));
          const r = await indexSource(source, defaultDeps(), (done, total) => { if (isCurrent()) set((s) => ({ docs: { ...s.docs, [hash]: { ...s.docs[hash], done, total } } })); }, controller.signal);
          if (r.status === "cancelled") { dropDoc(); return; }
          if (!isCurrent()) return;
          if (r.status === "failed") set((s) => ({ docs: { ...s.docs, [hash]: { ...s.docs[hash], status: "failed", error: r.message } } }));
          else {
            set((s) => ({ docs: { ...s.docs, [hash]: { ...s.docs[hash], status: r.status === "no-text" || r.chunks === 0 ? "no-text" : "indexed" } } }));
            if (r.status !== "cached") await get().refreshIndex();
            else if (!index.some((d) => d.hash === hash)) await get().refreshIndex();
          }
          await get().refreshLibrary();
        } catch (err) {
          if (isCurrent()) set((s) => ({ docs: { ...s.docs, [hash]: { ...s.docs[hash], status: "failed", error: err instanceof Error ? err.message : String(err) } } }));
        } finally {
          if (isCurrent()) controllers.delete(hash);
        }
      };
      queue = queue.then(job).catch(() => {});
    }
    await queue;
  },
  async retryDoc(hash) { set((s) => { const d = { ...s.docs }; delete d[hash]; return { docs: d }; }); await get().indexOpen(); },

  setQuery(query) {
    set({ query });
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { void get().search(); }, 250);
  },
  async search() {
    const q = get().query.trim();
    const terms = queryTerms(q);
    if (get().model.status !== "ready" || terms.length === 0) { set({ results: [], searching: false }); return; }
    set({ searching: true });
    try {
      const v = await getEmbedClient().embed([q], "query", undefined);
      if (get().query.trim() !== q) { set({ searching: false }); return; }
      set({ results: rank(v, index, terms, { limit: SEARCH_LIMIT }), searching: false });
    } catch { set({ results: [], searching: false }); }
  },
  async findSimilar(hash, chunkIndex) {
    if (debounce) { clearTimeout(debounce); debounce = null; }
    const d = index.find((x) => x.hash === hash);
    if (!d) return;
    const v = d.vectors.subarray(chunkIndex * DIMS, (chunkIndex + 1) * DIMS);
    set({ query: "", results: rank(new Float32Array(v), index, [], { limit: SEARCH_LIMIT, exclude: { hash, chunkIndex } }) });
  },
  async openHit(hit) {
    const doc = useDocumentStore.getState();
    const sourceId = Object.entries(get().hashBySource).find(([sid, h]) => h === hit.hash && doc.sources.has(sid))?.[0];
    if (!sourceId) {
      const rec = await library.get(hit.hash);
      if (!rec) return;
      const bytes = new Uint8Array(await rec.bytes.arrayBuffer());
      const before = new Set(doc.sources.keys());
      await doc.addFiles([{ name: rec.name, bytes }]);
      const newId = [...useDocumentStore.getState().sources.keys()].find((id) => !before.has(id));
      if (!newId) return;
      set((s) => ({ hashBySource: { ...s.hashBySource, [newId]: hit.hash } }));
      void get().indexOpen();
      reveal(newId, hit);
      return;
    }
    reveal(sourceId, hit);
  },
  async removeFromLibrary(hash) {
    await library.remove(hash);
    set((s) => { const d = { ...s.docs }; delete d[hash]; return { docs: d, results: s.results.filter((r) => r.hash !== hash) }; });
    await get().refreshIndex(); await get().refreshLibrary();
  },
  async clearLibrary() {
    for (const [hash, c] of controllers) { c.abort(); getEmbedClient().cancel(hash); }
    controllers.clear();
    cancelReveal();
    queue = Promise.resolve();
    await library.clear();
    try { localStorage.removeItem(ENABLED_KEY); } catch { /* ignore */ }
    getEmbedClient().dispose();
    set({ enabled: false, model: { status: "idle", loaded: 0, total: 0 }, docs: {}, results: [], query: "", library: [], usage: null });
    index = [];
  },
}));

/** Highlights text-layer spans whose text appears in the chunk, for 2 seconds. */
export function flashChunk(pageEntryId: string, chunkText: string) {
  if (typeof document === "undefined") return;
  const page = document.getElementById(`page-${pageEntryId}`);
  if (!page) return;
  const spans = [...page.querySelectorAll<HTMLElement>(".textLayer span")];
  const hit = spans.filter((s) => { const t = s.textContent?.trim() ?? ""; return t.length >= 4 && chunkText.includes(t); });
  for (const s of hit) s.classList.add("search-flash");
  setTimeout(() => { for (const s of hit) s.classList.remove("search-flash"); }, 2000);
}

/** Top passages over the open documents for Ask; null when the model is not ready. */
export async function retrievePassages(question: string, limit = ASK_PASSAGES): Promise<{ page: number; text: string }[] | null> {
  const s = useSearchStore.getState();
  if (s.model.status !== "ready") return null;
  const doc = useDocumentStore.getState();
  const openHashes = new Set(Object.entries(s.hashBySource).filter(([sid]) => doc.sources.has(sid)).map(([, h]) => h));
  const docs = index.filter((d) => openHashes.has(d.hash));
  if (docs.length === 0) return [];
  const v = await getEmbedClient().embed([question], "query", undefined);
  const hits = rank(v, docs, queryTerms(question), { limit }).filter((h) => h.score >= THRESHOLD);
  const out: { page: number; text: string }[] = [];
  for (const h of hits) {
    const sid = Object.entries(s.hashBySource).find(([id, hash]) => hash === h.hash && doc.sources.has(id))?.[0];
    const idx = doc.pages.findIndex((p) => p.sourceId === sid && p.sourcePageIndex === h.page);
    const chunk = index.find((d) => d.hash === h.hash)?.chunks[h.chunkIndex];
    if (idx >= 0 && chunk) out.push({ page: idx + 1, text: chunk.text.slice(0, 4000) });
  }
  return out.slice(0, limit);
}

useDocumentStore.subscribe((s, prev) => {
  if (s.sources === prev.sources) return;
  const st = useSearchStore.getState();
  // Abort jobs whose source just closed (and is not open under another id).
  const openHashes = new Set(Object.entries(st.hashBySource).filter(([sid]) => s.sources.has(sid)).map(([, h]) => h));
  for (const [sid, hash] of Object.entries(st.hashBySource)) {
    if (s.sources.has(sid) || openHashes.has(hash)) continue;
    const status = st.docs[hash]?.status;
    if (status === "indexing" || status === "queued") { controllers.get(hash)?.abort(); getEmbedClient().cancel(hash); }
  }
  if (st.model.status === "ready") void st.indexOpen();
});
