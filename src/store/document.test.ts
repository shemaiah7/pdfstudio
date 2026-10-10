import { describe, it, expect, beforeEach } from "vitest";
import { useDocumentStore } from "./document";
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
