import type { FieldDef } from "../pdf/formFill";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDocumentStore, sourceReleasers } from "./document";
import { loadFixture } from "../test/loadFixture";

const three = () => ({ name: "three.pdf", bytes: loadFixture("three") });
const two = () => ({ name: "two.pdf", bytes: loadFixture("two") });

const s = () => useDocumentStore.getState();
const order = () => s().pages.map((p) => `${s().sources.get(p.sourceId)!.name}:${p.sourcePageIndex}`);

beforeEach(() => useDocumentStore.getState().reset());

describe("open and add", () => {
  it("a fresh store is not dirty", () => {
    expect(s().isDirty()).toBe(false);
  });

  it("pages added without an open are dirty", async () => {
    await s().addFiles([three()]);
    expect(s().pages.length).toBeGreaterThan(0);
    expect(s().isDirty()).toBe(true);
  });

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

describe("annotations", () => {
  beforeEach(async () => { await s().openFiles([three()]); });
  const note = (pageEntryId: string) => ({ kind: "note" as const, pageEntryId, x: 10, y: 20, text: "hi", color: [0, 0, 0] as [number, number, number] });

  it("add, update, remove with undo/redo", () => {
    const id = s().addAnnotation(note(s().pages[0].id));
    expect(s().annotations[0]).toMatchObject({ id, kind: "note", text: "hi" });
    s().updateAnnotation(id, { text: "changed" });
    expect(s().annotations[0]).toMatchObject({ text: "changed" });
    s().undo();
    expect(s().annotations[0]).toMatchObject({ text: "hi" });
    s().redo();
    s().removeAnnotation(id);
    expect(s().annotations).toEqual([]);
    s().undo();
    expect(s().annotations.length).toBe(1);
    expect(s().isDirty()).toBe(true);
  });

  it("deleting a page drops its annotations and one undo restores both", () => {
    const [a, b] = s().pages.map((p) => p.id);
    s().addAnnotation({ kind: "signature", pageEntryId: a, box: { x: 0, y: 0, width: 50, height: 20 }, png: "data:image/png;base64,AA==", color: [0, 0, 0] });
    s().addAnnotation(note(b));
    s().remove([a]);
    expect(s().annotations.map((x) => x.kind)).toEqual(["note"]);
    s().undo();
    expect(s().pages.length).toBe(3);
    expect(s().annotations.map((x) => x.kind).sort()).toEqual(["note", "signature"]);
  });

  it("survives reorder and rotate; openFiles clears", async () => {
    const a = s().pages[0].id;
    s().addAnnotation(note(a));
    s().rotate([a], 90); s().reorder([a], 3);
    expect(s().annotations.length).toBe(1);
    await s().openFiles([two()]);
    expect(s().annotations).toEqual([]);
    expect(s().formValues.size).toBe(0);
  });

  it("selection of an annotation is not part of history", () => {
    const id = s().addAnnotation(note(s().pages[0].id));
    s().selectAnnotation(id);
    expect(s().selectedAnnotationId).toBe(id);
    s().removeAnnotation(id);
    expect(s().selectedAnnotationId).toBeNull();
  });
});

describe("form values", () => {
  beforeEach(async () => { await s().openFiles([three()]); });
  it("set, clear, undo, dirty", () => {
    const src = s().pages[0].sourceId;
    s().setFormValue(src, "name", "Alice");
    s().setFormValue(src, "agree", true);
    expect(s().formValues.get(src)?.get("name")).toBe("Alice");
    expect(s().isDirty()).toBe(true);
    s().undo();
    expect(s().formValues.get(src)?.get("agree")).toBeUndefined();
    s().redo();
    const defs: FieldDef[] = [{ name: "name", type: "text", widgets: [] }, { name: "agree", type: "checkbox", widgets: [] }, { name: "pick", type: "dropdown", multiple: true, widgets: [] }];
    s().clearForm(src, defs);
    expect(s().formValues.get(src)?.get("name")).toBe("");
    expect(s().formValues.get(src)?.get("agree")).toBe(false);
    expect(s().formValues.get(src)?.get("pick")).toEqual([]);
    expect(s().isDirty()).toBe(true);
    s().undo();
    expect(s().formValues.get(src)?.get("name")).toBe("Alice");
  });
});

describe("clearForm read-only", () => {
  it("skips read-only fields", async () => {
    await s().openFiles([three()]);
    const src = s().pages[0].sourceId;
    s().setFormValue(src, "mrn", "123");
    s().setFormValue(src, "name", "A");
    const defs: FieldDef[] = [{ name: "mrn", type: "text", readOnly: true, widgets: [] }, { name: "name", type: "text", widgets: [] }];
    s().clearForm(src, defs);
    expect(s().formValues.get(src)?.has("mrn")).toBe(false);
    expect(s().formValues.get(src)?.get("name")).toBe("");
  });
});

describe("annotation store hardening", () => {
  beforeEach(async () => { await s().openFiles([three()]); });
  const mk = () => ({ kind: "note" as const, pageEntryId: s().pages[0].id, color: [0, 0, 0] as [number, number, number], x: 1, y: 2, text: "t" });

  it("updateAnnotation/removeAnnotation on an unknown id do not add history", () => {
    s().updateAnnotation("nope", { color: [1, 0, 0] });
    expect(s().canUndo()).toBe(false);
    s().addAnnotation(mk());
    const n = s().past.length;
    s().removeAnnotation("nope");
    s().updateAnnotation("nope", { color: [1, 0, 0] });
    expect(s().past.length).toBe(n);
  });

  it("undo clears a selection that no longer exists", () => {
    const id = s().addAnnotation(mk());
    s().selectAnnotation(id);
    s().undo();
    expect(s().selectedAnnotationId).toBeNull();
  });

  it("redo clears a selection not among restored annotations", () => {
    const id = s().addAnnotation(mk());
    s().undo();
    s().selectAnnotation(id);
    s().redo();
    expect(s().selectedAnnotationId).toBe(id);
    s().selectAnnotation("ghost");
    s().undo();
    expect(s().selectedAnnotationId).toBeNull();
  });

  it("isDirty skips JSON work when references are equal", () => {
    s().addAnnotation(mk());
    s().markClean();
    const spy = vi.spyOn(JSON, "stringify");
    expect(s().isDirty()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("hashing", () => {
  it("opens a file without a hash when crypto.subtle.digest throws", async () => {
    const spy = vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("insecure context"));
    try {
      const r = await s().openFiles([three()]);
      expect(r.skipped).toEqual([]);
      const src = [...s().sources.values()][0];
      expect(src.pageCount).toBe(3);
      expect(src.hash).toBeUndefined();
    } finally { spy.mockRestore(); }
  });
});

it("addEdit normalises the font and never replaces by blockKey (equal keys coexist); updateEdit patches in place", async () => {
  await s().openFiles([three()]);
  const p = s().pages[0].id;
  const a = s().addEdit({ pageEntryId: p, boxes: [{ x: 0, y: 0, width: 10, height: 10 }], text: "a", fontSize: 10, font: "sans", color: [0, 0, 0], blockKey: "k" });
  expect(s().edits[0].font).toBe("helvetica");
  const b = s().addEdit({ pageEntryId: p, boxes: [{ x: 0, y: 0, width: 10, height: 10 }], text: "b", fontSize: 10, font: "times", color: [0, 0, 0], blockKey: "k" });
  expect(b).not.toBe(a);
  expect(s().edits.map((e) => e.text)).toEqual(["a", "b"]);
  s().updateEdit(a, { font: "courier", text: "c" });
  expect(s().edits[0]).toMatchObject({ id: a, font: "courier", text: "c" });
  expect(s().edits[1]).toMatchObject({ id: b, text: "b" });
  s().undo();
  expect(s().edits[0].text).toBe("a");
});
