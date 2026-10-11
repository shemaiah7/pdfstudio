import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import { indexSource } from "./indexer";
import { createLibrary } from "./library";
import { DIMS } from "./constants";
import { sha256 } from "../pdf/hash";
import type { SourceFile } from "../pdf/types";

const src = (id: string, bytes = [1, 2, 3], pageCount = 2): SourceFile => ({ id, name: `${id}.pdf`, bytes: new Uint8Array(bytes), pageCount });
const embed = vi.fn(async (texts: string[]) => { const v = new Float32Array(texts.length * DIMS); for (let i = 0; i < texts.length; i++) v[i * DIMS] = 1; return v; });
const extract = async (_s: SourceFile, page: number) => (page === 0 ? "alpha beta gamma delta" : "one two three four five");

describe("indexSource", () => {
  it("indexes a new file: one record, chunks across pages, progress per page", async () => {
    const lib = createLibrary(`t-${Math.random()}`);
    const progress: [number, string][] = [];
    const r = await indexSource(src("s1"), { embed, lib, extract }, (d, _t, phase) => progress.push([d, phase]));
    expect(r.status).toBe("indexed");
    const rec = await lib.get(r.hash);
    expect(rec?.chunks.map((c) => c.page)).toEqual([0, 1]);
    expect(rec?.vectors.length).toBe(2 * DIMS);
    expect(rec?.bytes.size).toBe(3);
    expect(progress).toEqual([[1, "extract"], [2, "extract"], [1, "embed"]]);
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
    expect((await lib.get(r.hash))?.bytes.size).toBe(0);
    expect((await lib.get(r.hash))?.size).toBe(2);
    expect((await indexSource(src("scan2", [9, 9]), { embed, lib, extract: async () => "" })).status).toBe("cached");
  });
  it("reports failed when embedding throws and writes nothing", async () => {
    const lib = createLibrary(`t-${Math.random()}`);
    const r = await indexSource(src("bad", [7]), { embed: async () => { throw new Error("boom"); }, lib, extract });
    expect(r).toMatchObject({ status: "failed", message: "boom" });
    expect(await lib.get(r.hash)).toBeUndefined();
  });
  const manyWords = async () => Array.from({ length: 1000 }, (_, i) => `w${i}`).join(" ");
  it("returns cancelled when aborted during embedding and writes nothing", async () => {
    const lib = createLibrary(`t-${Math.random()}`);
    const controller = new AbortController();
    const stub = vi.fn(async (texts: string[]) => { controller.abort(); return new Float32Array(texts.length * DIMS); });
    const r = await indexSource(src("c", [5], 3), { embed: stub, lib, extract: manyWords }, undefined, controller.signal);
    expect(r.status).toBe("cancelled");
    expect(await lib.get(r.hash)).toBeUndefined();
    expect(stub.mock.calls.length).toBeLessThanOrEqual(1);
  });
  it("treats an embed rejection of 'cancelled' as cancelled", async () => {
    const lib = createLibrary(`t-${Math.random()}`);
    const r = await indexSource(src("c2", [6]), { embed: async () => { throw new Error("cancelled"); }, lib, extract });
    expect(r.status).toBe("cancelled");
    expect(await lib.get(r.hash)).toBeUndefined();
  });
  it("fails when the embedding result has the wrong length", async () => {
    const lib = createLibrary(`t-${Math.random()}`);
    const two = async (_s: SourceFile, p: number) => (p === 0 ? "alpha beta gamma delta" : "one two three four five");
    const r = await indexSource(src("short", [8]), { embed: async () => new Float32Array(DIMS), lib, extract: two });
    expect(r).toMatchObject({ status: "failed", message: `embedding returned ${DIMS} values, expected ${2 * DIMS}` });
    expect(await lib.get(r.hash)).toBeUndefined();
  });
});

it("re-indexes when the OCR version is newer than the cached record", async () => {
  const lib = createLibrary(`idx-ocr-${Date.now()}`);
  let version = 0;
  const embedCalls: number[] = [];
  const deps = { lib, extract: async () => "alpha beta gamma delta", embed: async (texts: string[]) => { embedCalls.push(texts.length); return new Float32Array(texts.length * DIMS).fill(0.1); }, ocrVersion: async () => version };
  const source = { id: "s", name: "s.pdf", bytes: new Uint8Array([1, 2, 3]), pageCount: 1 };
  expect((await indexSource(source, deps)).status).toBe("indexed");
  expect((await indexSource(source, deps)).status).toBe("cached");
  version = 5;
  expect((await indexSource(source, deps)).status).toBe("indexed");
  expect(embedCalls).toHaveLength(2);
  expect((await lib.get(await sha256(source.bytes)))?.ocrVersion).toBe(5);
});
