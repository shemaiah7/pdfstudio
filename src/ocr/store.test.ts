import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { openDB } from "idb";
import { createOcrStore, openOcrDb } from "./store";
import { linesToOcrPage } from "./layout";

const page = (t: string) => linesToOcrPage([t], { widthPt: 100, heightPt: 100 }, 1);
let n = 0;
const fresh = () => createOcrStore(`ocr-test-${++n}`);

describe("OcrStore", () => {
  it("round-trips pages by hash and index", async () => {
    const s = fresh();
    await s.put("h1", 0, page("a"));
    await s.put("h1", 2, page("c"));
    expect((await s.get("h1", 0))?.lines[0].text).toBe("a");
    expect(await s.get("h1", 1)).toBeUndefined();
    const all = await s.getAll("h1");
    expect([...all.keys()]).toEqual([0, 2]);
    expect(s.persistent).toBe(true);
  });
  it("remove deletes every page of a hash and clear empties the store", async () => {
    const s = fresh();
    await s.put("h1", 0, page("a")); await s.put("h2", 0, page("b"));
    await s.remove("h1");
    expect(await s.get("h1", 0)).toBeUndefined();
    expect(await s.get("h2", 0)).toBeDefined();
    await s.clear();
    expect(await s.get("h2", 0)).toBeUndefined();
  });
  it("keeps records in memory when the write fails", async () => {
    const name = `ocr-test-${++n}`;
    const broken = createOcrStore(name, async () => {
      const db = await openOcrDb(name);
      return new Proxy(db, { get(t, p) { if (p === "transaction") return () => { throw new Error("quota"); }; return Reflect.get(t, p); } }) as typeof db;
    });
    await broken.put("h1", 0, page("a"));
    expect(broken.lastWriteFailed).toBe(true);
    expect((await broken.get("h1", 0))?.lines[0].text).toBe("a");
  });
  it("falls back to memory only when the database cannot open", async () => {
    const s = createOcrStore("x", async () => { throw new Error("blocked"); });
    await s.put("h1", 0, page("a"));
    expect(s.persistent).toBe(false);
    expect((await s.get("h1", 0))?.lines[0].text).toBe("a");
  });
  it("opens with the pages store keyed by hash:pageIndex", async () => {
    const db = await openDB(`ocr-test-${++n}`, 1, { upgrade(d) { d.createObjectStore("pages"); } });
    db.close();
    const s = createOcrStore(`ocr-test-${n}`);
    await s.put("h", 3, page("z"));
    expect((await s.get("h", 3))?.lines[0].text).toBe("z");
  });
});
