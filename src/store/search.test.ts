// src/store/search.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DIMS } from "../search/constants";

const embed = vi.fn(async (texts: string[], kind: string) => { const v = new Float32Array(texts.length * DIMS); v[0] = kind === "query" ? 1 : 1; return v; });
const load = vi.fn(async () => "wasm" as const);
vi.mock("../search/embedClient", () => ({ getEmbedClient: () => ({ load, embed, cancel: vi.fn(), dispose: vi.fn() }) }));

const docs: { hash: string; chunks: { page: number; start: number; end: number; text: string }[]; vectors: Float32Array }[] = [];
const lib = { loadAll: vi.fn(async () => docs), list: vi.fn(async () => docs.map((d) => ({ hash: d.hash, name: d.hash, size: 1, pageCount: 1, addedAt: 1, modelId: "m", chunkCount: d.chunks.length, stale: false }))), remove: vi.fn(async (h: string) => { const i = docs.findIndex((d) => d.hash === h); if (i >= 0) docs.splice(i, 1); }), clear: vi.fn(async () => { docs.length = 0; }), get: vi.fn(async () => undefined), estimateUsage: vi.fn(async () => 1234), persistent: true, lastWriteFailed: false };
vi.mock("../search/library", () => ({ get library() { return lib; }, sha256: async (b: Uint8Array) => `h${b[0]}` }));

const indexSource = vi.fn(async (s: { bytes: Uint8Array }, _signal?: AbortSignal): Promise<{ status: "indexed"; hash: string; chunks: number } | { status: "cancelled"; hash: string }> => { const hash = `h${s.bytes[0]}`; if (!docs.find((d) => d.hash === hash)) { const v = new Float32Array(DIMS); v[0] = 1; docs.push({ hash, chunks: [{ page: 0, start: 0, end: 5, text: "hello warfarin" }], vectors: v }); } return { status: "indexed" as const, hash, chunks: 1 }; });
vi.mock("../search/indexer", () => ({ indexSource: (s: never, _d: never, _p: never, signal?: AbortSignal) => indexSource(s, signal), defaultDeps: () => ({}) }));

import { useSearchStore, retrievePassages } from "./search";
import { useDocumentStore } from "./document";

const src = (id: string, b: number) => ({ id, name: `${id}.pdf`, bytes: new Uint8Array([b]), pageCount: 1 });

describe("search store", () => {
  beforeEach(() => {
    docs.length = 0; indexSource.mockClear(); embed.mockClear();
    useSearchStore.setState({ enabled: false, model: { status: "idle", loaded: 0, total: 0 }, docs: {}, hashBySource: {}, query: "", results: [], library: [] });
    useDocumentStore.setState({ sources: new Map([["s1", src("s1", 1)]]), pages: [{ id: "p1", sourceId: "s1", sourcePageIndex: 0, rotation: 0 }] });
  });

  it("enable loads the model, indexes open sources, and records the hash per source", async () => {
    await useSearchStore.getState().enable();
    expect(useSearchStore.getState().model.status).toBe("ready");
    await vi.waitFor(() => expect(useSearchStore.getState().docs.h1?.status).toBe("indexed"));
    expect(useSearchStore.getState().hashBySource.s1).toBe("h1");
  });
  it("marks the model unavailable when loading fails and retryModel tries again", async () => {
    load.mockRejectedValueOnce(new Error("offline"));
    await useSearchStore.getState().enable();
    expect(useSearchStore.getState().model).toMatchObject({ status: "unavailable", error: "offline" });
    await useSearchStore.getState().retryModel();
    expect(useSearchStore.getState().model.status).toBe("ready");
  });
  it("search embeds the query and ranks over the library; stop-word-only queries do not call the model", async () => {
    await useSearchStore.getState().enable();
    await vi.waitFor(() => expect(useSearchStore.getState().docs.h1?.status).toBe("indexed"));
    embed.mockClear();
    useSearchStore.getState().setQuery("the a");
    await useSearchStore.getState().search();
    expect(embed).not.toHaveBeenCalled();
    expect(useSearchStore.getState().results).toEqual([]);
    useSearchStore.getState().setQuery("warfarin");
    await useSearchStore.getState().search();
    expect(embed).toHaveBeenCalledWith(["warfarin"], "query", undefined);
    expect(useSearchStore.getState().results[0]).toMatchObject({ hash: "h1", page: 0 });
  });
  it("retrievePassages maps hits to viewer page numbers for open sources only", async () => {
    await useSearchStore.getState().enable();
    await vi.waitFor(() => expect(useSearchStore.getState().docs.h1?.status).toBe("indexed"));
    const v = new Float32Array(DIMS); v[0] = 1;
    docs.push({ hash: "closed", chunks: [{ page: 0, start: 0, end: 3, text: "zzz" }], vectors: v });
    await useSearchStore.getState().refreshIndex();
    const passages = await retrievePassages("warfarin", 12);
    expect(passages).toEqual([{ page: 1, text: "hello warfarin" }]);
  });
  it("retrievePassages returns null when the model is not ready", async () => {
    expect(await retrievePassages("x", 12)).toBeNull();
  });
  it("removing an open document from the library resets its status so it re-indexes", async () => {
    await useSearchStore.getState().enable();
    await vi.waitFor(() => expect(useSearchStore.getState().docs.h1?.status).toBe("indexed"));
    await useSearchStore.getState().removeFromLibrary("h1");
    expect(useSearchStore.getState().docs.h1).toBeUndefined();
    await useSearchStore.getState().indexOpen();
    await vi.waitFor(() => expect(indexSource).toHaveBeenCalledTimes(2));
  });
  it("a source removed while its index job is pending ends with no docs entry and is not marked failed", async () => {
    indexSource.mockImplementationOnce((s, signal) => new Promise((resolve) => {
      signal?.addEventListener("abort", () => resolve({ status: "cancelled" as const, hash: `h${s.bytes[0]}` }));
    }));
    useSearchStore.setState({ model: { status: "ready", loaded: 0, total: 0, device: "wasm" } });
    const pending = useSearchStore.getState().indexOpen();
    await vi.waitFor(() => expect(indexSource).toHaveBeenCalledTimes(1));
    useDocumentStore.setState({ sources: new Map(), pages: [] });
    await pending;
    expect(useSearchStore.getState().docs.h1).toBeUndefined();
  });
});
