import { describe, it, expect } from "vitest";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFields, fieldsOnPage } from "./forms";
import { buildDocument } from "./pageOps";
import type { SourceFile } from "./types";
import { loadFixture } from "../test/loadFixture";

const src = (): SourceFile => ({ id: "f", name: "form.pdf", bytes: loadFixture("form"), pageCount: 2 });
const pages = [{ id: "p0", sourceId: "f", sourcePageIndex: 0, rotation: 0 as const }, { id: "p1", sourceId: "f", sourcePageIndex: 1, rotation: 0 as const }];
const values = (m: Record<string, string | boolean | string[]>) => new Map([["f", new Map(Object.entries(m))]]);

describe("readFields", () => {
  it("reads names, types, options, widgets per page", async () => {
    const fields = await readFields(src());
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(byName.name).toMatchObject({ type: "text", widgets: [{ pageIndex: 0, rect: { x: 20, y: 300, width: 200, height: 24 } }] });
    expect(byName.agree.type).toBe("checkbox");
    expect(byName.size).toMatchObject({ type: "radio", options: ["S", "L"] });
    expect(byName.color).toMatchObject({ type: "dropdown", options: ["red", "blue"] });
    expect(byName.notes.widgets.map((w) => w.pageIndex)).toEqual([0, 1]);
    expect(byName.sig.type).toBe("unsupported");
    expect(fieldsOnPage(fields, 1).map((f) => f.name).sort()).toEqual(["grp.multi", "notes", "sig"]);
  });
});

describe("form export", () => {
  it("round-trips values through a copied page, including radio export values and checkbox on-value", async () => {
    const out = await buildDocument(new Map([["f", src()]]), pages, [], [], values({ name: "Alice", agree: true, size: "L", color: "blue", notes: "n" }));
    const doc = await PDFDocument.load(out);
    const form = doc.getForm();
    expect(form.getTextField("name").getText()).toBe("Alice");
    expect(form.getCheckBox("agree").isChecked()).toBe(true);
    expect(form.getRadioGroup("size").getSelected()).toBe("L");
    expect(form.getDropdown("color").getSelected()).toEqual(["blue"]);
    const pdf = await getDocument({ data: out.slice() }).promise;
    const anns = await (await pdf.getPage(1)).getAnnotations({ intent: "display" });
    expect(anns.find((a: any) => a.fieldName === "name")).toMatchObject({ fieldValue: "Alice", hasAppearance: true });
  });

  it("extracting only page 2 keeps just the fields with widgets there", async () => {
    const out = await buildDocument(new Map([["f", src()]]), [pages[1]], [], [], values({ notes: "only", name: "ignored" }));
    const doc = await PDFDocument.load(out);
    const names = doc.getForm().getFields().map((f) => f.getName()).sort();
    expect(names).toEqual(["grp.multi", "notes", "sig"]);
    expect(doc.getForm().getTextField("notes").getText()).toBe("only");
    expect(doc.getForm().getTextField("notes").acroField.getWidgets().length).toBe(1);
  });

  it("export without values leaves fields intact and unsupported fields untouched", async () => {
    const out = await buildDocument(new Map([["f", src()]]), pages, [], [], new Map());
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getFields().length).toBe(9);
  });

  it("keeps DR/Font/Helv and fields when a freetext annotation and filled form coexist", async () => {
    const ann = { id: "a", pageEntryId: "p0", kind: "freetext" as const, color: [0, 0, 0] as [number, number, number], box: { x: 50, y: 50, width: 100, height: 30 }, text: "hello", fontSize: 12 };
    const out = await buildDocument(new Map([["f", src()]]), pages, [], [ann], values({ name: "Bob" }));
    const doc = await PDFDocument.load(out);
    expect(doc.getForm().getTextField("name").getText()).toBe("Bob");
    expect(doc.getForm().getFields().length).toBe(9);
    const acro = doc.context.lookup(doc.catalog.get(PDFName.of("AcroForm"))!) as PDFDict;
    const dr = acro.lookup(PDFName.of("DR"), PDFDict);
    expect(dr.lookup(PDFName.of("Font"), PDFDict).has(PDFName.of("Helv"))).toBe(true);
  });

  it("accumulates fields across two sources, renaming collisions", async () => {
    const g = { ...src(), id: "g" };
    const vals = new Map([["f", new Map([["name", "F"]])], ["g", new Map([["name", "G"]])]]);
    const warnings: string[] = [];
    const out = await buildDocument(new Map([["f", src()], ["g", g]]), [pages[0], { ...pages[0], id: "q0", sourceId: "g" }], [], [], vals, (m) => warnings.push(m));
    const doc = await PDFDocument.load(out);
    const form = doc.getForm();
    expect(form.getTextField("name").getText()).toBe("F");
    expect(form.getTextField("name (2)").getText()).toBe("G");
    expect(warnings).toEqual(["Duplicate form field names in form.pdf were renamed"]);
    const widgets = form.getFields().flatMap((f) => f.acroField.getWidgets());
    expect(widgets.length).toBe(18);
    for (const w of widgets) expect(doc.context.lookup(w.dict.get(PDFName.of("P"))!)).toBeDefined();
  });

  it("keeps hierarchical fields and drops them on extract of another page", async () => {
    const fields = await readFields(src());
    expect(fields.find((f) => f.name === "addr.street")).toMatchObject({ type: "text" });
    const out = await buildDocument(new Map([["f", src()]]), pages, [], [], values({ "addr.street": "Main" }));
    expect((await PDFDocument.load(out)).getForm().getTextField("addr.street").getText()).toBe("Main");
    const p2 = await PDFDocument.load(await buildDocument(new Map([["f", src()]]), [pages[1]], [], [], new Map()));
    expect(p2.getForm().getFields().map((f) => f.getName()).some((n) => n.startsWith("addr"))).toBe(false);
  });

  it("supports option lists", async () => {
    const fields = await readFields(src());
    expect(fields.find((f) => f.name === "pick")).toMatchObject({ type: "dropdown", options: ["a", "b", "c"] });
    const out = await buildDocument(new Map([["f", src()]]), pages, [], [], values({ pick: ["a", "c"] }));
    expect((await PDFDocument.load(out)).getForm().getOptionList("pick").getSelected()).toEqual(["a", "c"]);
  });

  it("warns and still exports when the AcroForm is malformed", async () => {
    const d = await PDFDocument.load(loadFixture("form"));
    (d.context.lookup(d.catalog.get(PDFName.of("AcroForm"))!) as PDFDict).set(PDFName.of("Fields"), PDFName.of("Oops"));
    const bad: SourceFile = { id: "f", name: "bad.pdf", bytes: await d.save(), pageCount: 2 };
    const warnings: string[] = [];
    const out = await buildDocument(new Map([["f", bad]]), pages, [], [], values({ name: "x" }), (m) => warnings.push(m));
    expect(out.length).toBeGreaterThan(0);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("bad.pdf");
  });

  it("does not break export when a sticky note (with popup) and highlight sit on a form page", async () => {
    const anns = [
      { id: "n", pageEntryId: "p1", kind: "note" as const, color: [1, 0.84, 0] as [number, number, number], x: 100, y: 100, text: "hi" },
      { id: "h", pageEntryId: "p1", kind: "highlight" as const, color: [1, 0.84, 0] as [number, number, number], boxes: [{ x: 20, y: 340, width: 80, height: 20 }] },
    ];
    const out = await buildDocument(new Map([["f", src()]]), pages, [], anns, new Map());
    const doc = await PDFDocument.load(out);
    const subtypes = doc.getPage(1).node.Annots()!.asArray().map((r) => String((doc.context.lookup(r) as PDFDict).get(PDFName.of("Subtype"))));
    expect(subtypes).toEqual(expect.arrayContaining(["/Text", "/Popup", "/Highlight"]));
    expect(doc.getForm().getFields().length).toBe(9);
  });

  it("merges multi-page hierarchical fields into one field with both widgets", async () => {
    const out = await buildDocument(new Map([["f", src()]]), pages, [], [], values({ "grp.multi": "M" }));
    const doc = await PDFDocument.load(out);
    const multi = doc.getForm().getFields().filter((f) => f.getName() === "grp.multi");
    expect(multi.length).toBe(1);
    expect(multi[0].acroField.getWidgets().length).toBe(2);
    const pdf = await getDocument({ data: out.slice() }).promise;
    for (const n of [1, 2]) {
      const anns = await (await pdf.getPage(n)).getAnnotations({ intent: "display" });
      expect(anns.find((a: any) => a.fieldName === "grp.multi")).toMatchObject({ fieldValue: "M" });
    }
  });
});
