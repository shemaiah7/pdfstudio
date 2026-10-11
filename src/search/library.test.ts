import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { createLibrary, sha256, type LibraryRecord } from "./library";
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
});
