import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { indexSource } from "./indexer";
import { createLibrary } from "./library";
import { DIMS } from "./constants";
import type { SourceFile } from "../pdf/types";

const src = (id: string, bytes = [1, 2, 3], pageCount = 2): SourceFile => ({ id, name: `${id}.pdf`, bytes: new Uint8Array(bytes), pageCount });
const embed = vi.fn(async (texts: string[]) => { const v = new Float32Array(texts.length * DIMS); for (let i = 0; i < texts.length; i++) v[i * DIMS] = 1; return v; });
const extract = async (_s: SourceFile, page: number) => (page === 0 ? "alpha beta gamma delta" : "one two three four five");

describe("indexSource", () => {
  it("indexes a new file: one record, chunks across pages, progress per page", async () => {
    const lib = createLibrary(`t-${Math.random()}`);
    const progress: number[] = [];
    const r = await indexSource(src("s1"), { embed, lib, extract }, (d) => progress.push(d));
    expect(r.status).toBe("indexed");
    const rec = await lib.get(r.hash);
    expect(rec?.chunks.map((c) => c.page)).toEqual([0, 1]);
    expect(rec?.vectors.length).toBe(2 * DIMS);
    expect(rec?.bytes.size).toBe(3);
    expect(progress).toEqual([1, 2]);
    expect(embed).toHaveBeenCalledWith(expect.any(Array), "document", r.hash);
  });
  it("skips embedding when the hash is cached, so the same file added twice indexes once", async () => {
    const lib = createLibrary(`t-${Math.random()}`);
    embed.mockClear();
    const a = await indexSource(src("s1"), { embed, lib, extract });
    const b = await indexSource(src("s2"), { embed, lib, extract });
    expect(a.hash).toBe(b.hash);
    expect(b.status).toBe("cached");
    expect(embed).toHaveBeenCalledTimes(1);
  });
  it("writes a zero-chunk record for a document with no text", async () => {
    const lib = createLibrary(`t-${Math.random()}`);
    const r = await indexSource(src("scan", [9, 9]), { embed, lib, extract: async () => "" });
    expect(r).toMatchObject({ status: "no-text", chunks: 0 });
    expect((await lib.get(r.hash))?.chunks).toEqual([]);
    expect((await indexSource(src("scan2", [9, 9]), { embed, lib, extract: async () => "" })).status).toBe("cached");
  });
  it("reports failed when embedding throws and writes nothing", async () => {
    const lib = createLibrary(`t-${Math.random()}`);
    const r = await indexSource(src("bad", [7]), { embed: async () => { throw new Error("boom"); }, lib, extract });
    expect(r).toMatchObject({ status: "failed", message: "boom" });
    expect(await lib.get(r.hash)).toBeUndefined();
  });
});
