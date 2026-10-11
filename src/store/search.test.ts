// src/store/search.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DIMS } from "../search/constants";

const embed = vi.fn(async (texts: string[], kind: string) => { const v = new Float32Array(texts.length * DIMS); v[0] = kind === "query" ? 1 : 1; return v; });
const load = vi.fn(async (_p?: unknown, _d?: "wasm") => "wasm" as const);
vi.mock("../search/embedClient", () => ({ getEmbedClient: () => ({ load, embed, cancel: vi.fn(), dispose: vi.fn() }) }));

const docs: { hash: string; chunks: { page: number; start: number; end: number; text: string }[]; vectors: Float32Array }[] = [];
const lib = { setModelTag: vi.fn(), loadAll: vi.fn(async () => docs), list: vi.fn(async () => docs.map((d) => ({ hash: d.hash, name: d.hash, size: 1, pageCount: 1, addedAt: 1, modelId: "m", chunkCount: d.chunks.length, stale: false }))), remove: vi.fn(async (h: string) => { const i = docs.findIndex((d) => d.hash === h); if (i >= 0) docs.splice(i, 1); }), clear: vi.fn(async () => { docs.length = 0; }), get: vi.fn(async () => undefined), put: vi.fn(async () => {}), estimateUsage: vi.fn(async () => 1234), persistent: true, lastWriteFailed: false };
vi.mock("../search/library", () => ({ get library() { return lib; }, sha256: async (b: Uint8Array) => `h${b[0]}` }));

const indexSource = vi.fn(async (s: { bytes: Uint8Array }, _signal?: AbortSignal): Promise<{ status: "indexed"; hash: string; chunks: number } | { status: "cancelled"; hash: string }> => { const hash = `h${s.bytes[0]}`; if (!docs.find((d) => d.hash === hash)) { const v = new Float32Array(DIMS); v[0] = 1; docs.push({ hash, chunks: [{ page: 0, start: 0, end: 5, text: "hello warfarin" }], vectors: v }); } return { status: "indexed" as const, hash, chunks: 1 }; });
vi.mock("../search/indexer", () => ({ indexSource: (s: never, _d: never, _p: never, signal?: AbortSignal) => indexSource(s, signal), defaultDeps: () => ({}) }));

import { useSearchStore, retrievePassages } from "./search";
import { useDocumentStore } from "./document";

const src = (id: string, b: number) => ({ id, name: `${id}.pdf`, bytes: new Uint8Array([b]), pageCount: 1 });

describe("search store", () => {
  beforeEach(() => {
    docs.length = 0; indexSource.mockClear(); embed.mockClear(); lib.put.mockClear();
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
  it("maps a no-webgpu load error, then enableCpuMode loads wasm, remembers it, and scopes the library tag", async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } });
    load.mockRejectedValueOnce(Object.assign(new Error("WebGPU is not available"), { code: "no-webgpu" }));
    await useSearchStore.getState().enable();
    expect(useSearchStore.getState().model).toMatchObject({ status: "unavailable", error: "no-webgpu" });
    await useSearchStore.getState().enableCpuMode();
    expect(load.mock.calls.at(-1)?.[1]).toBe("wasm");
    expect(mem.get("pdfstudio.search.cpu")).toBe("1");
    expect(lib.setModelTag).toHaveBeenLastCalledWith(expect.stringMatching(/@fp32$/));
    expect(useSearchStore.getState().model).toMatchObject({ status: "ready", device: "wasm" });
    vi.unstubAllGlobals();
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
  it("retrievePassages clamps passage text to 4000 characters", async () => {
    await useSearchStore.getState().enable();
    await vi.waitFor(() => expect(useSearchStore.getState().docs.h1?.status).toBe("indexed"));
    docs[0].chunks[0].text = "x".repeat(5000);
    await useSearchStore.getState().refreshIndex();
    const passages = await retrievePassages("warfarin", 12);
    expect(passages?.[0].text).toHaveLength(4000);
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
  it("openHit on a closed document does not recurse when addFiles adds no source", async () => {
    lib.get.mockResolvedValue({ name: "x.pdf", bytes: new Blob([new Uint8Array([9])]) } as never);
    const original = useDocumentStore.getState().addFiles;
    const addFiles = vi.fn(async () => { if (addFiles.mock.calls.length > 3) throw new Error("runaway"); return {} as never; });
    useDocumentStore.setState({ addFiles });
    await useSearchStore.getState().openHit({ hash: "hx", page: 0, chunkIndex: 0, score: 1, snippet: "" });
    useDocumentStore.setState({ addFiles: original });
    lib.get.mockResolvedValue(undefined as never);
    expect(addFiles).toHaveBeenCalledTimes(1);
  });
  it("a job that throws marks its doc failed and does not poison the queue", async () => {
    useSearchStore.setState({ model: { status: "ready", loaded: 0, total: 0, device: "wasm" } });
    lib.loadAll.mockRejectedValueOnce(new Error("db gone"));
    await useSearchStore.getState().indexOpen();
    expect(useSearchStore.getState().docs.h1).toMatchObject({ status: "failed", error: "db gone" });
    useDocumentStore.setState({ sources: new Map([["s1", src("s1", 1)], ["s2", src("s2", 2)]]) });
    await useSearchStore.getState().indexOpen();
    await vi.waitFor(() => expect(useSearchStore.getState().docs.h2?.status).toBe("indexed"));
    expect(indexSource.mock.calls.some((c) => c[0].bytes[0] === 2)).toBe(true);
  });
  it("reopening the same file under a new source id re-queues an aborted job", async () => {
    indexSource.mockImplementationOnce((s, signal) => new Promise((resolve) => {
      signal?.addEventListener("abort", () => resolve({ status: "cancelled" as const, hash: `h${s.bytes[0]}` }));
    }));
    useSearchStore.setState({ model: { status: "ready", loaded: 0, total: 0, device: "wasm" } });
    const pending = useSearchStore.getState().indexOpen();
    await vi.waitFor(() => expect(indexSource).toHaveBeenCalledTimes(1));
    useDocumentStore.setState({ sources: new Map([["s2", src("s2", 1)]]), pages: [{ id: "p2", sourceId: "s2", sourcePageIndex: 0, rotation: 0 }] });
    await pending;
    await useSearchStore.getState().indexOpen();
    await vi.waitFor(() => expect(useSearchStore.getState().docs.h1?.status).toBe("indexed"));
    expect(indexSource).toHaveBeenCalledTimes(2);
  });
  it("clearLibrary aborts queued jobs so nothing is written after the clear", async () => {
    let release: () => void = () => {};
    indexSource.mockImplementationOnce((s) => new Promise((resolve) => { release = () => resolve({ status: "indexed" as const, hash: `h${s.bytes[0]}`, chunks: 1 }); }));
    useDocumentStore.setState({ sources: new Map([["s1", src("s1", 1)], ["s2", src("s2", 2)]]) });
    useSearchStore.setState({ model: { status: "ready", loaded: 0, total: 0, device: "wasm" } });
    const pending = useSearchStore.getState().indexOpen();
    await vi.waitFor(() => expect(indexSource).toHaveBeenCalledTimes(1));
    await useSearchStore.getState().clearLibrary();
    release();
    await pending;
    await new Promise((r) => setTimeout(r, 10));
    expect(indexSource).toHaveBeenCalledTimes(1);
    expect(lib.put).not.toHaveBeenCalled();
    expect(useSearchStore.getState().docs).toEqual({});
  });
  it("init loads the model once for a returning user and indexes open sources", async () => {
    load.mockClear();
    useSearchStore.setState({ enabled: true });
    await Promise.all([useSearchStore.getState().init(), useSearchStore.getState().init()]);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(useSearchStore.getState().docs.h1?.status).toBe("indexed"));
  });
});
