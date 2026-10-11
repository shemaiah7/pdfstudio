import "fake-indexeddb/auto";
import { openDB } from "idb";
import { describe, it, expect, beforeEach } from "vitest";
import { createLibrary, openLibraryDb, sha256, type LibraryRecord } from "./library";
import { DIMS, MODEL_TAG } from "./constants";

const rec = (hash: string, modelId = MODEL_TAG): LibraryRecord => ({
  hash, name: `${hash}.pdf`, size: 3, pageCount: 1, addedAt: 1, modelId,
  bytes: new Blob([new Uint8Array([1, 2, 3])]),
  chunks: [{ page: 0, start: 0, end: 5, text: "hello" }],
  vectors: new Float32Array(DIMS).fill(0.1),
});

describe("library", () => {
  let lib: ReturnType<typeof createLibrary>;
  beforeEach(async () => { lib = createLibrary(`test-${Math.random()}`); await lib.clear(); });

  it("hashes bytes with sha-256", async () => {
    expect(await sha256(new Uint8Array([97, 98, 99]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("puts, gets, lists without bytes/vectors, removes and clears", async () => {
    await lib.put(rec("a")); await lib.put(rec("b"));
    const got = await lib.get("a");
    expect(got?.vectors).toBeInstanceOf(Float32Array);
    expect(got?.vectors.length).toBe(DIMS);
    expect(got?.chunks[0].text).toBe("hello");
    const list = await lib.list();
    expect(list.map((r) => r.hash).sort()).toEqual(["a", "b"]);
    expect(list[0]).not.toHaveProperty("bytes");
    await lib.remove("a");
    expect(await lib.get("a")).toBeUndefined();
    await lib.clear();
    expect(await lib.list()).toEqual([]);
  });
  it("treats records from another model as absent in get but lists them as stale", async () => {
    await lib.put(rec("old", "other-model@256"));
    expect(await lib.get("old")).toBeUndefined();
    expect((await lib.list())[0].stale).toBe(true);
  });
  it("loadAll returns rank docs for current-model records only", async () => {
    await lib.put(rec("a")); await lib.put(rec("old", "x@256"));
    const docs = await lib.loadAll();
    expect(docs.map((d) => d.hash)).toEqual(["a"]);
    expect(docs[0].vectors.length).toBe(DIMS);
  });
  it("falls back to memory when IndexedDB fails", async () => {
    const broken = createLibrary("broken", () => { throw new Error("no idb"); });
    await broken.put(rec("m"));
    expect(broken.persistent).toBe(false);
    expect((await broken.get("m"))?.hash).toBe("m");
    expect((await broken.list()).length).toBe(1);
  });

  const proxied = (name: string, flags: { failPut: boolean; getAllStores: string[] }) => async () => {
    const real = await openLibraryDb(name);
    return new Proxy(real, {
      get(t, prop) {
        const v = (t as any)[prop];
        if (prop === "transaction") return (...a: any[]) => { if (flags.failPut) { flags.failPut = false; throw new Error("quota"); } return v.apply(t, a); };
        if (prop === "getAll") return (store: string, ...a: any[]) => { flags.getAllStores.push(store); return v.call(t, store, ...a); };
        return typeof v === "function" ? v.bind(t) : v;
      },
    });
  };

  it("keeps the database on write failure and merges an overlay", async () => {
    const name = `wf-${Math.random()}`;
    const flags = { failPut: false, getAllStores: [] as string[] };
    const l = createLibrary(name, proxied(name, flags));
    await l.put(rec("a"));
    flags.failPut = true;
    await l.put(rec("b"));
    expect(l.persistent).toBe(true);
    expect(l.lastWriteFailed).toBe(true);
    expect((await l.get("a"))?.hash).toBe("a");
    expect((await l.get("b"))?.hash).toBe("b");
    expect((await l.list()).map((r) => r.hash).sort()).toEqual(["a", "b"]);
    expect((await l.loadAll()).map((d) => d.hash).sort()).toEqual(["a", "b"]);
    await l.remove("a");
    const fresh = createLibrary(name);
    expect(await fresh.list()).toEqual([]);
    expect(await fresh.get("a")).toBeUndefined();
    expect(await fresh.get("b")).toBeUndefined();
  });
  it("list reads only the summaries store", async () => {
    const name = `sm-${Math.random()}`;
    const flags = { failPut: false, getAllStores: [] as string[] };
    const l = createLibrary(name, proxied(name, flags));
    await l.put(rec("a")); await l.put(rec("old", "x@256"));
    const list = await l.list();
    expect(flags.getAllStores).toEqual(["summaries"]);
    expect(list.find((r) => r.hash === "a")).toMatchObject({ chunkCount: 1, stale: false });
    expect(list.find((r) => r.hash === "old")?.stale).toBe(true);
  });
  it("treats records with inconsistent vector length as absent and stale", async () => {
    const bad = { ...rec("bad"), chunks: [{ page: 0, start: 0, end: 5, text: "hello" }, { page: 0, start: 5, end: 9, text: "more" }] };
    await lib.put(bad); await lib.put(rec("ok"));
    expect(await lib.get("bad")).toBeUndefined();
    expect((await lib.loadAll()).map((d) => d.hash)).toEqual(["ok"]);
    const list = await lib.list();
    expect(list.find((r) => r.hash === "bad")?.stale).toBe(true);
    expect(list.find((r) => r.hash === "ok")?.stale).toBe(false);
  });
  it("upgrades a v1 database that only has the documents store", async () => {
    const name = `v1-${Math.random()}`;
    const old = await openDB(name, 1, { upgrade: (d) => { d.createObjectStore("documents", { keyPath: "hash" }); } });
    old.close();
    const l = createLibrary(name);
    await l.put(rec("a"));
    expect((await l.list()).map((r) => r.hash)).toEqual(["a"]);
    expect(l.persistent).toBe(true);
  });
  it("clear resets lastWriteFailed", async () => {
    const name = `cl-${Math.random()}`;
    const flags = { failPut: true, getAllStores: [] as string[] };
    const l = createLibrary(name, proxied(name, flags));
    await l.put(rec("b"));
    expect(l.lastWriteFailed).toBe(true);
    await l.clear();
    expect(l.lastWriteFailed).toBe(false);
  });
});
