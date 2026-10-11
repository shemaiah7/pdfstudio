import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDocumentStore, sourceReleasers } from "./document";
import { loadFixture } from "../test/loadFixture";

const three = () => ({ name: "three.pdf", bytes: loadFixture("three") });
const two = () => ({ name: "two.pdf", bytes: loadFixture("two") });

const s = () => useDocumentStore.getState();
const order = () => s().pages.map((p) => `${s().sources.get(p.sourceId)!.name}:${p.sourcePageIndex}`);

beforeEach(() => useDocumentStore.getState().reset());

describe("open and add", () => {
  it("opens a file and builds entries", async () => {
    await s().openFiles([three()]);
    expect(order()).toEqual(["three.pdf:0", "three.pdf:1", "three.pdf:2"]);
    expect(s().isDirty()).toBe(false);
  });

  it("appends a second file", async () => {
    await s().openFiles([three()]);
    await s().addFiles([two()]);
    expect(order()).toEqual(["three.pdf:0", "three.pdf:1", "three.pdf:2", "two.pdf:0", "two.pdf:1"]);
    expect(s().isDirty()).toBe(true);
  });

  it("gives the same file two ids when added twice", async () => {
    await s().openFiles([three()]);
    await s().addFiles([three()]);
    expect(s().sources.size).toBe(2);
    expect(s().pages.length).toBe(6);
  });

  it("skips unreadable files and reports them", async () => {
    const res = await s().openFiles([three(), { name: "notes.txt", bytes: new Uint8Array([1, 2, 3]) }]);
    expect(res.skipped).toEqual(["notes.txt"]);
    expect(s().pages.length).toBe(3);
  });

  it("flags oversized files", async () => {
    const big = { name: "big.pdf", bytes: loadFixture("two") };
    const res = await s().addFiles([big], 10); // 10-byte limit for the test
    expect(res.oversized).toEqual(["big.pdf"]);
    expect(s().pages.length).toBe(2); // still opened
  });
});

describe("source release", () => {
  it("calls releasers for previous source ids when files are replaced", async () => {
    const spy = vi.fn();
    sourceReleasers.push(spy);
    try {
      await s().openFiles([three()]);
      const firstId = [...s().sources.keys()][0];
      await s().openFiles([two()]);
      expect(spy).toHaveBeenCalledWith(firstId);
    } finally {
      sourceReleasers.splice(sourceReleasers.indexOf(spy), 1);
    }
  });
});

describe("page operations", () => {
  beforeEach(async () => { await s().openFiles([three()]); });

  it("reorders", () => {
    const ids = s().pages.map((p) => p.id);
    s().reorder([ids[0]], 3);
    expect(order()).toEqual(["three.pdf:1", "three.pdf:2", "three.pdf:0"]);
  });

  it("rotates and wraps", () => {
    const id = s().pages[0].id;
    s().rotate([id], -90);
    expect(s().pages[0].rotation).toBe(270);
    s().rotate([id], 90);
    expect(s().pages[0].rotation).toBe(0);
  });

  it("removes and clears selection of removed", () => {
    const [a, b] = s().pages.map((p) => p.id);
    s().select([a, b], "replace");
    s().remove([a]);
    expect(order()).toEqual(["three.pdf:1", "three.pdf:2"]);
    expect([...s().selection]).toEqual([b]);
  });

  it("deleting all then undo restores", () => {
    s().remove(s().pages.map((p) => p.id));
    expect(s().pages.length).toBe(0);
    s().undo();
    expect(s().pages.length).toBe(3);
  });

  it("undo and redo round-trip", () => {
    const before = s().pages;
    const id = s().pages[0].id;
    s().rotate([id], 90);
    s().undo();
    expect(s().pages).toEqual(before);
    expect(s().canRedo()).toBe(true);
    s().redo();
    expect(s().pages[0].rotation).toBe(90);
    expect(s().canRedo()).toBe(false);
  });

  it("new action after undo discards redo", () => {
    const id = s().pages[0].id;
    s().rotate([id], 90);
    s().undo();
    s().rotate([id], -90);
    expect(s().canRedo()).toBe(false);
  });

  it("dirty flag follows saved snapshot", () => {
    const id = s().pages[0].id;
    s().rotate([id], 90);
    expect(s().isDirty()).toBe(true);
    s().markClean();
    expect(s().isDirty()).toBe(false);
    s().undo();
    expect(s().isDirty()).toBe(true);
  });
});

describe("selection", () => {
  beforeEach(async () => { await s().openFiles([three()]); });

  it("replace, add, toggle", () => {
    const [a, b, c] = s().pages.map((p) => p.id);
    s().select([a], "replace");
    s().select([b], "add");
    expect([...s().selection].sort()).toEqual([a, b].sort());
    s().select([a], "toggle");
    expect([...s().selection]).toEqual([b]);
    s().select([c], "replace");
    expect([...s().selection]).toEqual([c]);
  });
});

describe("edits", () => {
  beforeEach(async () => { await s().openFiles([three()]); });
  const edit = (pageEntryId: string) => ({ pageEntryId, boxes: [{ x: 10, y: 300, width: 100, height: 20 }], text: "New", fontSize: 12, font: "sans" as const, color: [0, 0, 0] as [number, number, number] });

  it("adds an edit, undo removes it, redo restores it", () => {
    const id = s().addEdit(edit(s().pages[0].id));
    expect(s().edits.map((e) => e.id)).toEqual([id]);
    expect(s().isDirty()).toBe(true);
    s().undo();
    expect(s().edits).toEqual([]);
    s().redo();
    expect(s().edits.map((e) => e.id)).toEqual([id]);
  });
  it("survives rotate and reorder, is dropped when its page is deleted", () => {
    const [a, b] = s().pages.map((p) => p.id);
    s().addEdit(edit(a));
    s().rotate([a], 90);
    s().reorder([a], 3);
    expect(s().edits.length).toBe(1);
    s().remove([b]);
    expect(s().edits.length).toBe(1);
    s().remove([a]);
    expect(s().edits).toEqual([]);
  });
  it("openFiles clears edits", async () => {
    s().addEdit(edit(s().pages[0].id));
    await s().openFiles([two()]);
    expect(s().edits).toEqual([]);
  });
});
